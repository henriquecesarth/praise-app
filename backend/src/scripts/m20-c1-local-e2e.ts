/**
 * Isolated local backend runner for M20-C1. Run from backend with:
 *   npx tsx src/scripts/m20-c1-local-e2e.ts --smoke
 *   npx tsx src/scripts/m20-c1-local-e2e.ts --serve
 *
 * It refuses non-test projects and non-loopback Firebase endpoints, clears
 * inherited credentials/provider settings, and changes to an empty temp cwd
 * before importing app modules (unifiedConfig calls dotenv.config()).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ID = 'demo-m20-c1';
const FIRESTORE_HOST = '127.0.0.1:8080';
const AUTH_HOST = '127.0.0.1:9099';
const PORT = Number(process.env.M20_C1_LOCAL_PORT || 3107);
const MODE = process.argv.includes('--smoke') ? 'smoke' : 'serve';

function assertSafeEnvironment(): void {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
    throw new Error('Refusing to run unless NODE_ENV=test.');
  }
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== PROJECT_ID) {
    throw new Error(`Refusing unexpected Firebase project: ${process.env.FIREBASE_PROJECT_ID}`);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_HOST) {
    throw new Error('Refusing unexpected Firestore emulator host.');
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_HOST) {
    throw new Error('Refusing unexpected Auth emulator host.');
  }
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
    throw new Error('M20_C1_LOCAL_PORT must be a valid unprivileged TCP port.');
  }
}

function applyIsolatedEnvironment(): void {
  // Prevent ambient credentials and cloud routing from entering Firebase Admin.
  for (const name of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'FIREBASE_CONFIG', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT',
    'VERCEL', 'VERCEL_ENV', 'PREVIEW_MODE', 'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY', 'FIREBASE_DATABASE_URL', 'FIREBASE_WEB_API_KEY',
    'FIREBASE_STAGING_PROJECT_ID', 'FIREBASE_STAGING_CLIENT_EMAIL',
    'FIREBASE_STAGING_PRIVATE_KEY', 'FIREBASE_STAGING_DATABASE_URL',
    'FIREBASE_STAGING_WEB_API_KEY', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN',
    'META_APP_SECRET', 'ZERNIO_API_KEY', 'ZERNIO_WEBHOOK_SECRET',
  ]) delete process.env[name];

  process.env.NODE_ENV = 'test';
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.JWT_SECRET = 'm20-c1-local-e2e-only-secret-not-for-deployment';
  process.env.PORT = String(PORT);
  process.chdir(mkdtempSync(join(tmpdir(), 'm20-c1-local-e2e-')));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected JSON object, received HTTP ${response.status}.`);
  }
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  assertSafeEnvironment();
  applyIsolatedEnvironment();

  // Dynamic import is intentional: app/config/Firebase must see only the
  // isolated environment above, and dotenv must resolve in the empty cwd.
  const { default: app } = await import('../app');
  const server = await new Promise<import('node:http').Server>((resolve, reject) => {
    const listener = app.listen(PORT, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`M20-C1 backend ready: ${baseUrl} (Firestore ${FIRESTORE_HOST}; Auth ${AUTH_HOST}; project ${PROJECT_ID})`);

  if (MODE === 'serve') {
    console.log('Serving until SIGINT/SIGTERM. Use this API URL from the local Android test target.');
    await new Promise<void>((resolve) => {
      const stop = (): void => { server.close(() => resolve()); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return;
  }

  try {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `m20-c1-${suffix}@example.test`;
    const password = `Local-${suffix}-Pass!`;
    const signupResponse = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'M20 C1 local E2E' }),
    });
    if (signupResponse.status !== 201) throw new Error(`Local signup failed: HTTP ${signupResponse.status}.`);
    const signup = await readJson(signupResponse);
    const token = signup.token;
    const user = signup.user as Record<string, unknown> | undefined;
    if (typeof token !== 'string' || typeof user?.id !== 'string') throw new Error('Signup response omitted API token or user id.');
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, { headers });
    if (meResponse.status !== 200) throw new Error(`Authenticated profile read failed: HTTP ${meResponse.status}.`);

    const importResponse = await fetch(`${baseUrl}/api/v1/smart-chords/import/url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'https://www.cifraclub.com.br/morada/pra-onde-eu-irei/',
        musical_html: '<h1 class="t1">Pra Onde Eu Irei</h1><h2 class="t3">Morada</h2><div id="cifra_tom">Tom: G</div><div class="cifra_cnt"><pre>G\nMeu Deus</pre></div>',
      }),
    });
    if (importResponse.status !== 200) throw new Error(`Local HTML import failed: HTTP ${importResponse.status}.`);
    const draft = await readJson(importResponse);
    const createResponse = await fetch(`${baseUrl}/api/v1/smart-chords`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: draft.title,
        artist_name: draft.artist_name,
        original_key: draft.original_key,
        content: draft.content,
        source_url: draft.source_url,
        displayed_key: draft.displayed_key,
        capo: draft.capo,
      }),
    });
    if (createResponse.status !== 201) throw new Error(`Smart Chord save failed: HTTP ${createResponse.status}.`);
    const created = await readJson(createResponse);
    if (typeof created.id !== 'string') throw new Error('Smart Chord save response omitted id.');

    const reopenResponse = await fetch(`${baseUrl}/api/v1/smart-chords/${encodeURIComponent(created.id)}`, { headers });
    if (reopenResponse.status !== 200) throw new Error(`Smart Chord reopen failed: HTTP ${reopenResponse.status}.`);
    const reopened = await readJson(reopenResponse);
    if (reopened.id !== created.id || reopened.user_id !== user.id || reopened.content !== draft.content) {
      throw new Error('Reopened Smart Chord did not match the created user-owned draft.');
    }

    const deleteResponse = await fetch(`${baseUrl}/api/v1/smart-chords/${encodeURIComponent(created.id)}`, {
      method: 'DELETE', headers,
    });
    if (deleteResponse.status !== 204) throw new Error(`Emulator cleanup failed: HTTP ${deleteResponse.status}.`);
    console.log('M20-C1 LOCAL E2E PASS: Auth emulator signup, Firestore profile, authenticated parse/save/reopen, and cleanup.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'M20-C1 local E2E failed.');
  process.exitCode = 1;
});
