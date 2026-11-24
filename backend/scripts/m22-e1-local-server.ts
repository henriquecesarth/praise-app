/**
 * M22-D-E1 — live local scenario for the ministry audio library.
 *
 * Boots the REAL Express app against the Firebase Auth/Firestore EMULATORS with
 * the signed-object simulator, seeds synthetic data (never real music or real
 * credentials) and keeps serving until stopped. Refuses to run unless every
 * local-emulator gate of `ministryAudioSimulatorEnabled` holds.
 *
 *   NODE_ENV=test LOUVAIO_LOCAL_EMULATORS=1 MINISTRY_AUDIO_EMULATOR=1
 *   FIREBASE_PROJECT_ID=demo-louvaio FIRESTORE_EMULATOR_HOST=127.0.0.1:<p>
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<p> E1_STATE_FILE=<path> [E1_PORT=3107]
 *   npx tsx scripts/m22-e1-local-server.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ministryAudioSimulatorEnabled } from '../src/features/ministry_audio/ministry-audio.routes';

const STEM_IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
type StemId = (typeof STEM_IDS)[number];

// Each instrument gets its own artificial tone so a wrong channel mapping is audible/measurable.
export const STEM_TONE_HZ: Record<StemId, number> = {
  vocals: 440, drums: 220, bass: 110, guitar: 330, piano: 523, other: 660,
};
export const SAMPLE_RATE = 8_000;
export const FRAMES = 32_000; // 4 s
export const PASSWORD = 'E1-Local-Pass-123!';

export function wavFor(stem: StemId): Buffer {
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
  if (!ministryAudioSimulatorEnabled(process.env)) {
    throw new Error('Local emulator gates are not satisfied; refusing to start.');
  }
  const port = Number(process.env.E1_PORT ?? 3107);
  const origin = `http://127.0.0.1:${port}`;
  process.env.MINISTRY_AUDIO_DIRECT_SIMULATOR = '1';
  process.env.MINISTRY_AUDIO_DIRECT_SIMULATOR_ORIGIN = origin;
  const stateFile = process.env.E1_STATE_FILE;
  if (!stateFile) throw new Error('E1_STATE_FILE is required.');

  // Imported only after the gates and env are fixed (the router is wired at import time).
  const { default: app } = await import('../src/app');
  const { db } = await import('../src/lib/firebase');
  const { UserRepository } = await import('../src/repositories/UserRepository');
  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  // Request counters (evidence only: they never alter handling). They let a device run prove
  // that reopening a cached recording revalidates online (playback) without re-downloading stems.
  const stats = { playbackGets: 0, objectGets: 0, libraryGets: 0 };
  server.prependListener('request', (request) => {
    const url = request.url ?? '';
    if (request.method !== 'GET') return;
    if (url.startsWith('/api/local/ministry-audio-objects/')) stats.objectGets++;
    else if (/\/audio-library\/[a-f0-9]{64}\/playback/.test(url)) stats.playbackGets++;
    else if (/\/audio-library\/?(\?|$)/.test(url)) stats.libraryGets++;
  });
  const { createServer } = await import('node:http');
  createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(stats));
  }).listen(port + 1, '127.0.0.1');

  const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
  const users = new UserRepository();
  const tag = randomUUID().slice(0, 8);
  const accounts = {
    admin: { email: `e1-admin-${tag}@louvaio.test`, name: 'E1 Admin' },
    member: { email: `e1-member-${tag}@louvaio.test`, name: 'E1 Membro' },
    outsider: { email: `e1-outsider-${tag}@louvaio.test`, name: 'E1 Externo' },
  } as const;
  const ids: Record<string, string> = {};
  for (const [key, account] of Object.entries(accounts)) {
    const created = await users.createUser({ ...account, password: PASSWORD });
    ids[key] = created.id;
  }

  async function idToken(email: string): Promise<string> {
    const response = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-local-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    });
    const body = (await response.json()) as { idToken?: string };
    if (!response.ok || !body.idToken) throw new Error('Auth emulator sign-in failed.');
    return body.idToken;
  }

  const ministries = { a: `e1_ministry_a_${tag}`, b: `e1_ministry_b_${tag}` };
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
  const api = (ministry: string, path: string, method = 'GET', body?: unknown) =>
    fetch(`${origin}/api/v1/ministries/${ministry}/audio-library${path}`, {
      method,
      headers: { authorization: `Bearer ${adminToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async <T>(response: Response): Promise<T> => {
    const text = await response.text();
    if (!response.ok) throw new Error(`Seed request failed: ${response.status}`);
    return JSON.parse(text) as T;
  };

  async function publish(ministry: string, title: string): Promise<string> {
    const wavs = STEM_IDS.map((id) => ({ id, bytes: wavFor(id) }));
    const upload = await json<{ id: string }>(await api(ministry, '/uploads', 'POST', {
      idempotencyKey: randomUUID(), confirmed: true, title, artist: 'Sinais Sintéticos', version: 'E1',
      model: { id: 'htdemucs_6s', version: '1.0.0' },
      stems: wavs.map(({ id, bytes }) => manifestFor(id, bytes)),
    }));
    for (const { id, bytes } of wavs) {
      const grant = await json<{ url: string; headers: Record<string, string>; attempt: number }>(
        await api(ministry, `/uploads/${upload.id}/stems/${id}/upload-url`, 'POST'));
      const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(bytes) });
      if (!put.ok) throw new Error(`Seed PUT failed: ${put.status}`);
      await json(await api(ministry, `/uploads/${upload.id}/stems/${id}/complete`, 'POST', { attempt: grant.attempt }));
    }
    const recording = await json<{ id: string }>(await api(ministry, `/uploads/${upload.id}/finalize`, 'POST'));
    return recording.id;
  }

  const recordingA = await publish(ministries.a, 'Gravação Sintética A');
  const recordingB = await publish(ministries.b, 'Gravação Sintética B');

  writeFileSync(stateFile, JSON.stringify({
    origin, port, password: PASSWORD, accounts, ids, ministries,
    recordings: { a: recordingA, b: recordingB },
    stemToneHz: STEM_TONE_HZ, sampleRate: SAMPLE_RATE, frames: FRAMES,
    authEmulator: process.env.FIREBASE_AUTH_EMULATOR_HOST, projectId: process.env.FIREBASE_PROJECT_ID,
  }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`E1_READY ${origin}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('E1_FAILED', error instanceof Error ? error.message : error);
  process.exit(1);
});
