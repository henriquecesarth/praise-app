/**
 * M22-D-E2 — Android homologation server against the PRIVATE DEVELOPMENT R2 bucket.
 *
 * Boots the REAL Express app on loopback with the Firebase Auth/Firestore EMULATORS and the real R2 adapter
 * (never the signed-object simulator), then seeds INDEPENDENT synthetic sets through the real API
 * (uploads -> signed PUT to R2 -> complete -> finalize). The tablet reaches the API through `adb reverse` and
 * downloads the stems DIRECTLY from R2 over HTTPS, so this process cannot count those downloads: the evidence
 * comes from the instrumented client transport in the integration test, not from here.
 *
 *   NODE_ENV=test LOUVAIO_LOCAL_EMULATORS=1 MINISTRY_AUDIO_EMULATOR=1 MINISTRY_AUDIO_R2_DEV=1 M22C_R2_LIVE_TESTS=1
 *   MINISTRY_AUDIO_DIRECT_SIMULATOR=0 FIREBASE_PROJECT_ID=demo-louvaio FIRESTORE_EMULATOR_HOST=127.0.0.1:<p>
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<p> E1_STATE_FILE=<path> E2R2_INVENTORY=<path>
 *   [E1_PORT=3107] [E2R2_SETS=4] npx --no-install tsx scripts/m22-e2-r2-server.ts
 *
 * Output files (credentials are never written): the state file (accounts of the emulator, ids, stem sizes and
 * SHA-256) and the inventory (ministry and recording ids of this run, used only by m22-e2-r2-cleanup.ts).
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const STEM_IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
type StemId = (typeof STEM_IDS)[number];
const STEM_TONE_HZ: Record<StemId, number> = { vocals: 440, drums: 220, bass: 110, guitar: 330, piano: 523, other: 660 };
const SAMPLE_RATE = 8_000;
const FRAMES = 32_000; // 4 s
const PASSWORD = 'E1-Local-Pass-123!';
const LOOPBACK = /^127\.0\.0\.1:\d{2,5}$/;

function assertIsolation(): void {
  const env = process.env;
  if (env.NODE_ENV !== 'test' || env.M22C_R2_LIVE_TESTS !== '1' || env.VERCEL || env.VERCEL_ENV ||
      env.LOUVAIO_LOCAL_EMULATORS !== '1' || env.MINISTRY_AUDIO_EMULATOR !== '1' ||
      !/^demo-[a-z0-9-]+$/.test(env.FIREBASE_PROJECT_ID ?? '') ||
      !LOOPBACK.test(env.FIRESTORE_EMULATOR_HOST ?? '') || !LOOPBACK.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
      env.MINISTRY_AUDIO_R2_DEV !== '1' || env.MINISTRY_AUDIO_DIRECT_SIMULATOR === '1') {
    throw new Error('Isolation guard failed.');
  }
}

function wavFor(stem: StemId): Buffer {
  const bytes = Buffer.alloc(44 + FRAMES * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(FRAMES * 4, 40);
  for (let i = 0; i < FRAMES; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * STEM_TONE_HZ[stem] * i) / SAMPLE_RATE) * 0.25 * 32767);
    bytes.writeInt16LE(sample, 44 + i * 4);
    bytes.writeInt16LE(sample, 46 + i * 4);
  }
  return bytes;
}

function manifestFor(stem: StemId, bytes: Buffer) {
  return {
    id: stem, codec: 'pcm_s16le', sampleRate: SAMPLE_RATE, channels: 2, frames: FRAMES,
    durationSeconds: FRAMES / SAMPLE_RATE, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function main() {
  assertIsolation();
  const stateFile = process.env.E1_STATE_FILE;
  const inventoryFile = process.env.E2R2_INVENTORY;
  if (!stateFile || !inventoryFile) throw new Error('E1_STATE_FILE and E2R2_INVENTORY are required.');
  const setCount = Number(process.env.E2R2_SETS ?? 4);
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 8) throw new Error('E2R2_SETS must be 1..8.');
  const port = Number(process.env.E1_PORT ?? 3107);
  const origin = `http://127.0.0.1:${port}`;
  // Sanitized failure trace for R2 commands (command, key class, error name/status/code only: never keys, URLs or messages).
  const { S3Client } = await import('@aws-sdk/client-s3');
  const originalSend = S3Client.prototype.send as unknown as (this: unknown, command: { constructor: { name: string }; input?: { Key?: string } }, ...rest: unknown[]) => Promise<unknown>;
  (S3Client.prototype as unknown as { send: typeof originalSend }).send = function send(this: unknown, command, ...rest) {
    return originalSend.call(this, command, ...rest).catch((error: unknown) => {
      const e = error as { name?: string; code?: string; cause?: { code?: string }; $metadata?: { httpStatusCode?: number } };
      const key = command.input?.Key ?? '';
      const place = key.startsWith('staging/') ? 'staging' : key.startsWith('objects/') ? 'final' : 'other';
      const status = e.$metadata?.httpStatusCode;
      if (status !== 404 && status !== 412) {
        // eslint-disable-next-line no-console
        console.error(`R2_FAIL ${command.constructor.name} ${place} name=${e.name} status=${status} code=${e.code ?? e.cause?.code}`);
      }
      throw error;
    });
  };
  // Validates the dedicated bucket name and the credentials without printing them.
  const { getR2DevelopmentConfig } = await import('../src/features/ministry_audio/r2-development-config');
  getR2DevelopmentConfig(process.env);

  // Imported only after the guard passed (the router is wired at import time); dotenv runs on import, so check again.
  const { default: app } = await import('../src/app');
  assertIsolation();
  const { db } = await import('../src/lib/firebase');
  const { UserRepository } = await import('../src/repositories/UserRepository');
  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  // Control surface (loopback only, counters of API requests; never keys, URLs or content).
  const stats = { playbackGets: 0, libraryGets: 0 };
  server.prependListener('request', (request) => {
    const url = request.url ?? '';
    if (request.method !== 'GET') return;
    if (/\/audio-library\/[a-f0-9]{64}\/playback/.test(url)) stats.playbackGets++;
    else if (/\/audio-library\/?(\?|$)/.test(url)) stats.libraryGets++;
  });
  createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(stats));
  }).listen(port + 1, '127.0.0.1');

  const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
  const users = new UserRepository();
  const runId = randomUUID();
  const inventory: { ministryId: string; recordingId: string }[] = [];
  const wavs = STEM_IDS.map((id) => ({ id, bytes: wavFor(id) }));
  const stems = Object.fromEntries(wavs.map(({ id, bytes }) => {
    const { sizeBytes, sha256 } = manifestFor(id, bytes);
    return [id, { sizeBytes, sha256 }];
  }));

  async function idToken(email: string): Promise<string> {
    const response = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-local-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    });
    const body = (await response.json()) as { idToken?: string };
    if (!response.ok || !body.idToken) throw new Error('Auth emulator sign-in failed.');
    return body.idToken;
  }

  async function seedSet(index: number) {
    const tag = `${runId.slice(0, 8)}${index}`;
    const accounts = {
      admin: { email: `e2r2-admin-${tag}@louvaio.test`, name: 'E1 Admin' },
      member: { email: `e2r2-member-${tag}@louvaio.test`, name: 'E1 Membro' },
      outsider: { email: `e2r2-outsider-${tag}@louvaio.test`, name: 'E1 Externo' },
    } as const;
    const ids: Record<string, string> = {};
    for (const [key, account] of Object.entries(accounts)) {
      ids[key] = (await users.createUser({ ...account, password: PASSWORD })).id;
    }
    // m22e2r2-<run uuid>-s<set>-<a|b>: the only shape the cleanup accepts.
    const ministries = { a: `m22e2r2-${runId}-s${index}-a`, b: `m22e2r2-${runId}-s${index}-b` };
    const batch = db.batch();
    for (const [key, id] of Object.entries(ministries)) {
      batch.set(db.collection('ministries').doc(id), {
        name: key === 'a' ? 'Ministério E1 A' : 'Ministério E1 B', owner_user_id: ids.admin,
      });
      batch.set(db.collection('ministry_members').doc(`${id}_${ids.admin}`), {
        ministry_id: id, user_id: ids.admin, role: 'admin', status: 'active',
      });
      batch.set(db.collection('ministry_members').doc(`${id}_${ids.member}`), {
        ministry_id: id, user_id: ids.member, role: 'member', status: 'active',
      });
    }
    await batch.commit();

    const adminToken = await idToken(accounts.admin.email);
    // A transient provider 503 (e.g. connection reset while sealing) is retried: upload-url, complete and finalize are
    // idempotent by contract; only 503 is retried, never a 4xx.
    const api = async (ministry: string, path: string, method = 'GET', body?: unknown) => {
      for (let attempt = 1; ; attempt++) {
        const response = await fetch(`${origin}/api/v1/ministries/${ministry}/audio-library${path}`, {
          method,
          headers: { authorization: `Bearer ${adminToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (response.status !== 503 || attempt >= 6) return response;
        await new Promise((resolve) => setTimeout(resolve, 3_000 * attempt));
      }
    };
    const json = async <T>(response: Response): Promise<T> => {
      const text = await response.text();
      if (!response.ok) throw new Error(`Seed request failed: ${response.status}`);
      return JSON.parse(text) as T;
    };
    async function publish(ministry: string, title: string): Promise<string> {
      const upload = await json<{ id: string }>(await api(ministry, '/uploads', 'POST', {
        idempotencyKey: randomUUID(), confirmed: true, title, artist: 'Sinais Sintéticos', version: 'E2R2',
        model: { id: 'htdemucs_6s', version: '1.0.0' },
        stems: wavs.map(({ id, bytes }) => manifestFor(id, bytes)),
      }));
      // Inventory BEFORE the first byte reaches R2, so a failed run still leaves every key it could have created.
      inventory.push({ ministryId: ministry, recordingId: upload.id });
      writeFileSync(inventoryFile!, JSON.stringify({ runId, entries: inventory }, null, 2));
      for (const { id, bytes } of wavs) {
        const grant = await json<{ url: string; headers: Record<string, string>; attempt: number }>(
          await api(ministry, `/uploads/${upload.id}/stems/${id}/upload-url`, 'POST'));
        if (!/^https:\/\/[a-z0-9-]{1,64}\.r2\.cloudflarestorage\.com\//.test(grant.url)) throw new Error('Seed target is not R2.');
        const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(bytes) });
        if (!put.ok) throw new Error(`Seed PUT failed: ${put.status}`);
        await json(await api(ministry, `/uploads/${upload.id}/stems/${id}/complete`, 'POST', { attempt: grant.attempt }));
      }
      return (await json<{ id: string }>(await api(ministry, `/uploads/${upload.id}/finalize`, 'POST'))).id;
    }
    // E2R2_PUBLISH=0 (M22-D-E3): only accounts and ministries; the operator publishes a REAL song through the Web UI.
    if (process.env.E2R2_PUBLISH === '0') return { index, accounts, ids, ministries, recordings: null };
    const recordings = { a: await publish(ministries.a, 'Gravação Sintética A'), b: await publish(ministries.b, 'Gravação Sintética B') };
    return { index, accounts, ids, ministries, recordings };
  }

  const sets = [];
  for (let i = 1; i <= setCount; i++) sets.push(await seedSet(i));

  writeFileSync(stateFile, JSON.stringify({
    origin, port, password: PASSWORD, runId, sets, stems,
    stemToneHz: STEM_TONE_HZ, sampleRate: SAMPLE_RATE, frames: FRAMES,
    authEmulator: process.env.FIREBASE_AUTH_EMULATOR_HOST, projectId: process.env.FIREBASE_PROJECT_ID,
  }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`E2R2_READY ${origin} sets=${sets.length}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('E2R2_FAILED', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
