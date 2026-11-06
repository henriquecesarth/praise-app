/**
 * Isolated local backend/emulator bridge for M20-C4C. Run only after the
 * demo-m20-c4c Auth and Firestore emulators are ready:
 *   npx tsx src/scripts/m20-c4c-local-server.ts
 *
 * The API and control server bind to loopback. Firestore Admin connects to a
 * loopback HTTP/2 proxy on 8080, which forwards to the real emulator on 18080.
 * This script never reads request payloads, logs credentials, or imports app
 * modules until after clearing ambient cloud settings and changing to an empty
 * temporary cwd (unifiedConfig calls dotenv.config()).
 */
import { mkdtempSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import {
  connect as connectHttp2,
  createServer as createHttp2Server,
  type ClientHttp2Session,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type Http2Server,
  type ServerHttp2Session,
  type ServerHttp2Stream,
} from 'node:http2';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = '127.0.0.1';
const PROJECT_ID = 'demo-m20-c4c';
const AUTH_HOST = '127.0.0.1:9099';
const FIRESTORE_PROXY_HOST = '127.0.0.1:8080';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 18080;
const API_PORT = 3108;
const CONTROL_PORT = 18081;

const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host',
]);
const WRITE_RPCS = new Set([
  '/google.firestore.v1.Firestore/Commit',
  '/google.firestore.v1.Firestore/Write',
]);

interface ProxyStats {
  requests: number;
  blockedWrites: number;
  byRpc: Record<string, number>;
}

function validateInheritedEnvironment(): void {
  const expected = new Map<string, string>([
    ['NODE_ENV', 'test'],
    ['FIREBASE_PROJECT_ID', PROJECT_ID],
    ['FIREBASE_AUTH_EMULATOR_HOST', AUTH_HOST],
    ['FIRESTORE_EMULATOR_HOST', FIRESTORE_PROXY_HOST],
  ]);
  for (const [name, value] of expected) {
    const inherited = process.env[name];
    if (inherited && inherited !== value) {
      throw new Error(`Refusing unexpected ${name} setting.`);
    }
  }
}

function prepareIsolatedEnvironment(): void {
  for (const name of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'FIREBASE_CONFIG', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
    'VERCEL', 'VERCEL_ENV', 'PREVIEW_MODE', 'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY', 'FIREBASE_DATABASE_URL', 'FIREBASE_WEB_API_KEY',
    'FIREBASE_STAGING_PROJECT_ID', 'FIREBASE_STAGING_CLIENT_EMAIL',
    'FIREBASE_STAGING_PRIVATE_KEY', 'FIREBASE_STAGING_DATABASE_URL',
    'FIREBASE_STAGING_WEB_API_KEY', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN',
    'META_APP_SECRET', 'ZERNIO_API_KEY', 'ZERNIO_WEBHOOK_SECRET',
  ]) delete process.env[name];

  process.env.NODE_ENV = 'test';
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_PROXY_HOST;
  process.env.JWT_SECRET = 'm20-c4c-local-only-secret-not-for-deployment';
  process.env.PORT = String(API_PORT);
  process.chdir(mkdtempSync(join(tmpdir(), 'm20-c4c-local-')));
}

function listen(server: HttpServer | Http2Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

function grpcFailure(stream: ServerHttp2Stream, code: string, message: string): void {
  stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
  stream.on('wantTrailers', () => {
    if (!stream.destroyed) {
      stream.sendTrailers({ 'grpc-status': code, 'grpc-message': encodeURIComponent(message) });
    }
  });
  stream.end();
}

function forwardRequestHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = {
    ':method': headers[':method'],
    ':path': headers[':path'],
  };
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(':') || HOP_BY_HOP_HEADERS.has(name) || value === undefined) continue;
    forwarded[name] = value;
  }
  return forwarded;
}

function createFirestoreProxy(session: ClientHttp2Session, stats: ProxyStats, shouldFailWrites: () => boolean): Http2Server {
  const proxy = createHttp2Server();
  proxy.on('stream', (downstream, requestHeaders) => {
    const responseStream = downstream as ServerHttp2Stream;
    const path = String(requestHeaders[':path'] || '');
    const rpc = path || '<unknown-rpc>';
    stats.requests++;
    stats.byRpc[rpc] = (stats.byRpc[rpc] || 0) + 1;

    if (shouldFailWrites() && WRITE_RPCS.has(path)) {
      stats.blockedWrites++;
      grpcFailure(responseStream, '7', 'local Firestore write failure injected');
      return;
    }

    const upstream = session.request(forwardRequestHeaders(requestHeaders));
    let responseTrailers: OutgoingHttpHeaders | undefined;
    let responseStarted = false;

    upstream.on('response', responseHeaders => {
      responseStarted = true;
      responseStream.respond(responseHeaders, { waitForTrailers: true });
      upstream.pipe(downstream, { end: false });
    });
    upstream.on('trailers', trailers => { responseTrailers = trailers; });
    upstream.on('end', () => {
      if (!responseStarted) {
        grpcFailure(responseStream, '14', 'local Firestore emulator transport unavailable');
        return;
      }
      downstream.end();
    });
    downstream.on('wantTrailers', () => {
      if (!downstream.destroyed) responseStream.sendTrailers(responseTrailers || {});
    });
    upstream.on('error', () => {
      if (!downstream.destroyed) {
        if (!responseStream.headersSent) grpcFailure(responseStream, '14', 'local Firestore emulator transport unavailable');
        else downstream.destroy();
      }
    });
    downstream.on('close', () => {
      if (!upstream.closed) upstream.close();
    });
    downstream.pipe(upstream);
  });
  return proxy;
}

function createControlServer(
  stats: ProxyStats,
  setFailWrites: (enabled: boolean) => void,
  getFailWrites: () => boolean,
): HttpServer {
  return createHttpServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'POST' && request.url === '/fail-writes') {
      setFailWrites(true);
      response.statusCode = 200;
      response.end(JSON.stringify({ failWrites: true }));
      return;
    }
    if (request.method === 'POST' && request.url === '/allow-writes') {
      setFailWrites(false);
      response.statusCode = 200;
      response.end(JSON.stringify({ failWrites: false }));
      return;
    }
    if (request.method === 'GET' && request.url === '/stats') {
      response.statusCode = 200;
      response.end(JSON.stringify({ ...stats, failWrites: getFailWrites() }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
}

async function closeHttpServer(server: HttpServer | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>(resolve => server.close(() => resolve()));
}

async function closeHttp2Server(
  server: Http2Server,
  sessions: Set<ServerHttp2Session>,
): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>(resolve => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(destroyTimer);
      clearTimeout(forceTimer);
      for (const session of sessions) session.destroy();
      sessions.clear();
      resolve();
    };

    const destroyTimer = setTimeout(() => {
      for (const session of sessions) session.destroy();
    }, 500);
    const forceTimer = setTimeout(finish, 1500);
    server.close(finish);
  });
}

async function main(): Promise<void> {
  validateInheritedEnvironment();
  prepareIsolatedEnvironment();

  const upstreamSession = connectHttp2(`http://${FIRESTORE_EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firestore emulator is not ready on the configured local endpoint.')), 3000);
    upstreamSession.once('connect', () => {
      clearTimeout(timer);
      const address = upstreamSession.socket.remoteAddress;
      const port = upstreamSession.socket.remotePort;
      if (address !== HOST || port !== FIRESTORE_EMULATOR_PORT) {
        reject(new Error('Firestore proxy connected to an unexpected endpoint.'));
      } else resolve();
    });
    upstreamSession.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Firestore emulator is not ready on the configured local endpoint.'));
    });
  });

  const stats: ProxyStats = { requests: 0, blockedWrites: 0, byRpc: {} };
  let failWrites = false;
  const proxy = createFirestoreProxy(upstreamSession, stats, () => failWrites);
  const downstreamSessions = new Set<ServerHttp2Session>();
  proxy.on('session', session => {
    downstreamSessions.add(session);
    session.once('close', () => downstreamSessions.delete(session));
  });
  const control = createControlServer(stats, value => { failWrites = value; }, () => failWrites);
  let apiServer: HttpServer | undefined;

  try {
    await listen(proxy, 8080);
    await listen(control, CONTROL_PORT);

    // Load the real Express app only after env isolation and the proxy listener.
    const { default: app } = await import('../app');
    apiServer = app.listen(API_PORT, HOST);
    await new Promise<void>((resolve, reject) => {
      apiServer!.once('listening', resolve);
      apiServer!.once('error', reject);
    });

    console.log(`M20-C4C local API ready at http://${HOST}:${API_PORT} (${PROJECT_ID}).`);
    console.log(`Firestore HTTP/2 proxy ${FIRESTORE_PROXY_HOST} -> ${FIRESTORE_EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}; Auth emulator ${AUTH_HOST}.`);
    console.log(`Local fault control: http://${HOST}:${CONTROL_PORT}/fail-writes, /allow-writes, /stats.`);
    await waitForSignal();
  } finally {
    await Promise.all([closeHttpServer(apiServer), closeHttpServer(control)]);
    await closeHttp2Server(proxy, downstreamSessions);
    upstreamSession.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'M20-C4C local server failed.');
  process.exitCode = 1;
});
