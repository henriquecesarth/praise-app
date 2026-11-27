// Loopback-only test proxy for M20-C7A. It forwards to local Auth and the
// isolated local API and can delay responses without logging request bodies.
import http from 'node:http';

const gates = new Map();
const waiters = new Map();
const heldResponses = new Map();
const targets = { auth: 9099, api: 3107 };

function reply(response, status, value) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(value));
}

function completeWaiters(name) {
  const pending = waiters.get(name) ?? [];
  waiters.delete(name);
  for (const done of pending) done();
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') return reply(response, 200, {});
  const control = /^\/_control\/(arm|wait|release)\/(signin|signup|authme|auth401|refresh)$/.exec(request.url ?? '');
  if (control) {
    const [, action, name] = control;
    if (action === 'arm') {
      if (gates.has(name)) return reply(response, 409, {});
      gates.set(name, true);
      return reply(response, 200, { armed: true });
    }
    if (action === 'release') {
      if (!heldResponses.has(name)) return reply(response, 409, { held: false });
      heldResponses.get(name)?.();
      heldResponses.delete(name);
      gates.delete(name);
      return reply(response, 200, { released: true });
    }
    if (!gates.has(name)) return reply(response, 409, {});
    if (heldResponses.has(name)) return reply(response, 200, { held: true });
    const timer = setTimeout(() => {
      const pending = waiters.get(name) ?? [];
      waiters.set(name, pending.filter((done) => done !== finish));
      reply(response, 408, {});
    }, 15000);
    const finish = () => { clearTimeout(timer); reply(response, 200, { held: true }); };
    const pending = waiters.get(name) ?? [];
    pending.push(finish);
    waiters.set(name, pending);
    return;
  }

  const isApi = (request.url ?? '').startsWith('/api/v1/');
  const decodedPath = decodeURIComponent(request.url ?? '').split('?')[0];
  const target = isApi ? 'api' : 'auth';
  console.log(`M20-C7A route ${target} ${request.method} ${decodedPath}`);
  const port = targets[target];
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    const upstream = http.request({
      hostname: '127.0.0.1', port, path: request.url, method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${port}` },
    }, (incoming) => {
      const data = [];
      incoming.on('data', (chunk) => data.push(chunk));
      incoming.on('end', () => {
        const signup = isApi && request.url?.startsWith('/api/v1/auth/signup');
        const signIn = !isApi && (
          decodedPath.includes('accounts:signInWithPassword') ||
          decodedPath.endsWith('/relyingparty/verifyPassword')
        );
        const authMe = isApi && request.method === 'GET' && request.url === '/api/v1/auth/me';
        const auth401 = authMe && gates.has('auth401');
        const refresh = !isApi && decodedPath.includes('/token');
        const gateName = signup ? 'signup' : signIn ? 'signin' : auth401 ? 'auth401' : authMe ? 'authme' : refresh ? 'refresh' : null;
        const forward = () => {
          response.writeHead(auth401 ? 401 : incoming.statusCode ?? 502, {
            ...incoming.headers,
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          });
          response.end(Buffer.concat(data));
        };
        if (gateName && gates.has(gateName)) {
          const timeout = setTimeout(() => {
            heldResponses.delete(gateName);
            gates.delete(gateName);
            response.writeHead(504, { 'content-type': 'application/json' });
            response.end('{}');
          }, 30000);
          const release = () => {
            clearTimeout(timeout);
            heldResponses.delete(gateName);
            gates.delete(gateName);
            forward();
          };
          heldResponses.set(gateName, release);
          completeWaiters(gateName);
        } else forward();
      });
    });
    upstream.on('error', () => reply(response, 502, {}));
    if (body.length) upstream.write(body);
    upstream.end();
  });
});

server.listen(19098, '127.0.0.1', () => {
  console.log('M20-C7A local Auth/API response gate ready on 127.0.0.1:19098');
});
