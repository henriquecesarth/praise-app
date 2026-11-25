// M22-C.5D-B — MP3 v2 persistence and finalization against the Firestore Emulator and the local object simulator.
// The codec is opened ONLY inside this test file (it mutates the in-memory profile and restores it); the publishable
// build has no switch, route or option that does the same. Nothing here touches R2 or production Firebase.
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebase';
import { errorHandler } from '../../middleware/error-handler';
import { UserRepository } from '../../repositories/UserRepository';
import { CODEC_PROFILES } from './audio-codec';
import { buildManifest, requestHashOf } from './audio-manifest';
import { createMinistryAudioRouter } from './ministry-audio.routes';
import { STEM_IDS, type AudioManifest, type StemId } from './ministry-audio.schema';
import type { Mp3StemManifest } from './mp3-stream-validator';
import { SimulatedDirectStemStorage } from './simulated-direct-storage';
import type { StemStorage } from './storage';

const objectRoute = '/api/local/ministry-audio-objects';
const minute = 60_000;
const fixtures = join(__dirname, '../../../../shared/fixtures/ministry-audio-mp3-v1');
const cases = JSON.parse(readFileSync(join(fixtures, 'real-encoder-cases.json'), 'utf8')) as {
  cases: Array<{ name: string; manifest: Mp3StemManifest; base64: string }>;
};
const webCases = JSON.parse(readFileSync(join(__dirname, '../../../../shared/fixtures/ministry-audio-mp3-v2-lame/web-encoder-cases.json'), 'utf8')) as {
  sixStems44100: Array<{ manifest: Mp3StemManifest; base64: string }>;
};
const valid = cases.cases.find((c) => c.name === 'valid-44100-12000')!;
const mp3 = Buffer.from(valid.base64, 'base64');
const stemManifest = (id: StemId, patch: Partial<Mp3StemManifest> = {}): Mp3StemManifest => ({ ...valid.manifest, id, ...patch });
const six = () => STEM_IDS.map((id) => stemManifest(id));
const model = { id: 'htdemucs_6s', version: '1.0.0' };

type SignedRequest = { url: string; headers: Record<string, string> };
type UploadGrant = SignedRequest & { attempt: number; expiresAt: number };
type Upload = { id: string; status: string; transfer: 'direct'; uploadedStemIds: StemId[]; expiresAt: number };
type Playback = { transfer: 'direct'; manifest: AudioManifest; tracks: Array<SignedRequest & { id: StemId }> };

async function json<T = unknown>(response: Response, status = 200): Promise<T> {
  const body = await response.text();
  expect(response.status, body).toBe(status);
  return JSON.parse(body) as T;
}
async function status(response: Response): Promise<number> {
  await response.arrayBuffer();
  return response.status;
}

describe('MP3 v2 persistence and finalization (Firestore Emulator + local simulator)', { timeout: 40_000 }, () => {
  const users = new UserRepository();
  const legacyStorage: StemStorage = {
    put: vi.fn().mockRejectedValue(new Error('Unexpected proxy write')),
    verify: vi.fn().mockRejectedValue(new Error('Unexpected proxy verification')),
    open: vi.fn().mockRejectedValue(new Error('Unexpected proxy read')),
    remove: vi.fn().mockRejectedValue(new Error('Unexpected proxy deletion')),
  };
  const profile = CODEC_PROFILES.mp3_cbr256 as { serverByteValidation: boolean };
  let server: Server;
  let origin: string;
  let storage: SimulatedDirectStemStorage;
  let clock: number;
  let ministryId: string;
  let otherMinistryId: string;
  let adminToken: string;
  let memberToken: string;
  let otherAdminToken: string;

  beforeAll(async () => {
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    storage = new SimulatedDirectStemStorage(origin, () => clock, process.env.M22S3_LONG_DIR ? 256 * 1024 * 1024 : undefined);
    app.use(objectRoute, storage.router);
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage: legacyStorage, directStorage: storage, now: () => clock,
    }));
    app.use(errorHandler);
  });

  beforeEach(async () => {
    profile.serverByteValidation = false;
    clock = Date.UTC(2026, 10, 20, 12);
    ministryId = `audio-mp3-${randomUUID()}`;
    otherMinistryId = `audio-mp3-${randomUUID()}`;
    const adminId = `admin-${randomUUID()}`;
    const memberId = `member-${randomUUID()}`;
    const otherAdminId = `other-${randomUUID()}`;
    adminToken = users.generateAuthToken(adminId, 'admin@example.test');
    memberToken = users.generateAuthToken(memberId, 'member@example.test');
    otherAdminToken = users.generateAuthToken(otherAdminId, 'other@example.test');
    const batch = db.batch();
    batch.set(db.collection('ministries').doc(ministryId), { name: 'MP3 v2', owner_user_id: adminId });
    batch.set(db.collection('ministries').doc(otherMinistryId), { name: 'Other', owner_user_id: otherAdminId });
    batch.set(db.collection('ministry_members').doc(`${ministryId}_${memberId}`), { ministry_id: ministryId, user_id: memberId, role: 'member', status: 'active' });
    await batch.commit();
  });

  afterEach(() => { profile.serverByteValidation = false; vi.restoreAllMocks(); });
  afterAll(async () => {
    profile.serverByteValidation = false;
    if (server) {
      await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); server.closeAllConnections(); });
    }
  });

  const api = (path: string, method = 'GET', token: string | null = adminToken, tenant = ministryId, body?: unknown) => {
    const headers = new Headers();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('content-type', 'application/json');
    return fetch(`${origin}/api/v1/ministries/${tenant}/audio-library${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  };
  const object = (request: SignedRequest, method: 'GET' | 'PUT', bytes?: Buffer) =>
    fetch(request.url, { method, headers: request.headers, body: bytes && new Uint8Array(bytes), signal: AbortSignal.timeout(5_000) });
  const stemPath = (id: string, stem: StemId) => `/uploads/${id}/stems/${stem}`;
  const body = (stems: unknown[], key: string = randomUUID()) => ({
    schemaVersion: 2, idempotencyKey: key, confirmed: true, title: 'MP3 recording', artist: 'Fixture', version: 'Live', model, stems,
  });
  const reserve = (stems: unknown[] = six(), key: string = randomUUID(), token = adminToken, tenant = ministryId) =>
    api('/uploads', 'POST', token, tenant, body(stems, key));
  const doc = (id: string, tenant = ministryId) => db.collection('ministries').doc(tenant).collection('audio_recordings').doc(id);
  async function sealStem(id: string, stem: StemId, bytes = mp3) {
    const grant = await json<UploadGrant>(await api(`${stemPath(id, stem)}/upload-url`, 'POST'));
    expect(await status(await object(grant, 'PUT', bytes))).toBe(200);
    return { grant, complete: () => api(`${stemPath(id, stem)}/complete`, 'POST', adminToken, ministryId, { attempt: grant.attempt }) };
  }
  async function stage(open = true) {
    profile.serverByteValidation = open;
    const upload = await json<Upload>(await reserve());
    for (const stem of STEM_IDS) await json(await (await sealStem(upload.id, stem)).complete());
    return upload;
  }
  const finalize = (id: string) => api(`/uploads/${id}/finalize`, 'POST');

  it('keeps the publication gate closed on the real routes', async () => {
    const response = await reserve();
    expect(await json<{ error: { details?: { code?: string } } }>(response, 422)).toMatchObject({ error: { details: { code: 'AUDIO_CODEC_NOT_ENABLED' } } });
    const snapshot = await db.collection('ministries').doc(ministryId).collection('audio_recordings').get();
    expect(snapshot.size).toBe(0);
  });

  it('persists the canonical v2 manifest, and an identical retry is idempotent', async () => {
    profile.serverByteValidation = true;
    const key = randomUUID();
    const first = await json<Upload>(await reserve([...six()].reverse(), key));
    const again = await json<Upload>(await reserve(six().map((s) => Object.fromEntries(Object.entries(s).reverse())), key));
    expect(again.id).toBe(first.id);
    const stored = (await doc(first.id).get()).data()!;
    expect(stored.manifest.schemaVersion).toBe(2);
    expect(stored.manifest.stems.map((s: { id: string }) => s.id)).toEqual([...STEM_IDS]);
    expect(stored.requestHash).toBe(requestHashOf({ title: stored.title, artist: stored.artist, version: stored.version }, buildManifest(first.id, stored.version, stored.manifest.model, six())));
    expect(stored.transfer).toBe('direct');
    expect((await db.collection('ministries').doc(ministryId).collection('audio_recordings').get()).size).toBe(1);
  });

  it('answers 409 when the same idempotency key returns with a different codec, size, hash or alignment', async () => {
    profile.serverByteValidation = true;
    const key = randomUUID();
    await json(await reserve(six(), key));
    const variants: Array<Partial<Mp3StemManifest>> = [
      { sha256: 'e'.repeat(64) }, { sizeBytes: valid.manifest.sizeBytes + 1 },
      { alignment: { ...valid.manifest.alignment, paddingFrames: valid.manifest.alignment.paddingFrames + 1, encoderDelayFrames: valid.manifest.alignment.encoderDelayFrames - 1 } },
    ];
    for (const patch of variants) {
      const stems = STEM_IDS.map((id) => stemManifest(id, patch));
      expect(await status(await reserve(stems, key)), JSON.stringify(patch)).toBe(409);
    }
    // the same key as a v1 reservation also conflicts instead of silently reusing the v2 record
    const pcm = STEM_IDS.map((id) => ({
      id, codec: 'pcm_s16le', sampleRate: 8000, channels: 2, frames: 1, durationSeconds: 1 / 8000, sizeBytes: 48, sha256: 'a'.repeat(64),
    }));
    const v1 = { idempotencyKey: key, confirmed: true, title: 'MP3 recording', artist: 'Fixture', version: 'Live', model, stems: pcm };
    expect(await status(await api('/uploads', 'POST', adminToken, ministryId, v1))).toBe(409);
  });

  it('verifies, seals and publishes six MP3 stems, then serves audio/mpeg to members', async () => {
    const upload = await stage();
    const stored = (await doc(upload.id).get()).data()!;
    for (const id of STEM_IDS) {
      expect(stored.directAttempts[id].receipt.mp3).toMatchObject({
        id, sha256: valid.manifest.sha256, decoderDelayFrames: 529, tagDelayFrames: 576, mpegAudioFrames: valid.manifest.alignment.mpegAudioFrames,
      });
    }
    const published = await json<{ id: string; status: string }>(await finalize(upload.id));
    expect(published).toMatchObject({ id: upload.id, status: 'published' });
    const playback = await json<Playback>(await api(`/${upload.id}/playback`, 'GET', memberToken));
    expect(playback.manifest.schemaVersion).toBe(2);
    expect(playback.manifest.stems.every((s) => s.codec === 'mp3_cbr256')).toBe(true);
    for (const track of playback.tracks) {
      const response = await object(track, 'GET');
      expect(response.headers.get('content-type')).toBe('audio/mpeg');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(mp3);
    }
    expect(legacyStorage.put).not.toHaveBeenCalled();
  });

  it('repeats /complete idempotently without re-reading the bytes, and finalize is idempotent and race-safe', async () => {
    profile.serverByteValidation = true;
    const upload = await json<Upload>(await reserve());
    const seal = vi.spyOn(storage, 'seal');
    const vocals = await sealStem(upload.id, 'vocals');
    await json(await vocals.complete());
    await json(await vocals.complete());
    expect(seal).toHaveBeenCalledTimes(1);
    for (const stem of STEM_IDS.filter((id) => id !== 'vocals')) await json(await (await sealStem(upload.id, stem)).complete());
    const results = await Promise.all([finalize(upload.id), finalize(upload.id), finalize(upload.id)]);
    const bodies = await Promise.all(results.map((r) => json<{ id: string; status: string }>(r)));
    expect(new Set(bodies.map((b) => b.id))).toEqual(new Set([upload.id]));
    const stored = (await doc(upload.id).get()).data()!;
    expect(stored.status).toBe('published');
    expect(bodies.every((b) => b.status === 'published')).toBe(true);
  });

  it('never publishes on declared metadata: a receipt without the server-derived facts blocks finalization', async () => {
    const upload = await stage();
    await doc(upload.id).update({ 'directAttempts.drums.receipt.mp3': (await import('firebase-admin/firestore')).FieldValue.delete() });
    expect(await status(await finalize(upload.id))).toBe(409);
    expect((await doc(upload.id).get()).data()!.status).toBe('uploading');
  });

  it('refuses an inconsistent six-stem set (one stem with another decoder delay) and publishes nothing', async () => {
    const upload = await stage();
    const ref = doc(upload.id);
    const facts = (await ref.get()).data()!.directAttempts.guitar.receipt.mp3;
    await ref.update({ 'directAttempts.guitar.receipt.mp3': { ...facts, decoderDelayFrames: 530, tagPaddingFrames: facts.tagPaddingFrames + 1 } });
    expect(await status(await finalize(upload.id))).toBe(409);
    await ref.update({ 'directAttempts.guitar.receipt.mp3': { ...facts, encoder: 'Lavc99.9.' } });
    expect(await status(await finalize(upload.id))).toBe(409);
    expect((await ref.get()).data()!.status).toBe('uploading');
    await ref.update({ 'directAttempts.guitar.receipt.mp3': facts });
    expect(await status(await finalize(upload.id))).toBe(200);
  });

  it('does not reuse results across attempts: a re-issued URL starts from a clean attempt', async () => {
    profile.serverByteValidation = true;
    const upload = await json<Upload>(await reserve());
    const damaged = Buffer.from(mp3); damaged[5000] ^= 1;
    const first = await sealStem(upload.id, 'vocals', damaged);
    expect(await status(await first.complete())).toBe(422);
    let stored = (await doc(upload.id).get()).data()!;
    expect(stored.directAttempts.vocals).toEqual({ number: 1, invalid: true });
    const second = await sealStem(upload.id, 'vocals');
    expect(second.grant.attempt).toBe(2);
    stored = (await doc(upload.id).get()).data()!;
    expect(stored.directAttempts.vocals).toEqual({ number: 2 });
    await json(await second.complete());
    stored = (await doc(upload.id).get()).data()!;
    expect(stored.directAttempts.vocals.receipt.mp3.sha256).toBe(valid.manifest.sha256);
  });

  it('rejects malformed MP3 with a valid SHA-256 and publishes nothing partial', async () => {
    profile.serverByteValidation = true;
    const bad = Buffer.from(mp3); bad[300] ^= 1;
    const badManifest = stemManifest('vocals', { sha256: createHash('sha256').update(bad).digest('hex') });
    // homogeneity only covers codec/rate/frames/alignment, so one stem may legitimately carry another hash
    const stems = [badManifest, ...STEM_IDS.slice(1).map((id) => stemManifest(id))];
    const upload = await json<Upload>(await reserve(stems));
    expect(await status(await (await sealStem(upload.id, 'vocals', bad)).complete())).toBe(422);
    for (const stem of STEM_IDS.slice(1)) await json(await (await sealStem(upload.id, stem)).complete());
    expect(await status(await finalize(upload.id))).toBe(409);
    expect((await doc(upload.id).get()).data()).toMatchObject({ status: 'uploading', uploadedStemIds: expect.not.arrayContaining(['vocals']) });
    expect(await status(await api(`/${upload.id}/playback`, 'GET', memberToken))).toBe(404);
  });

  it('isolates ministries and requires admin rights', async () => {
    const upload = await stage();
    expect(await status(await api(`${stemPath(upload.id, 'vocals')}/upload-url`, 'POST', otherAdminToken, otherMinistryId))).toBe(404);
    expect(await status(await api(`/uploads/${upload.id}/finalize`, 'POST', otherAdminToken, otherMinistryId))).toBe(404);
    expect(await status(await finalize(upload.id).then(() => api(`/uploads/${upload.id}/finalize`, 'POST', memberToken)))).toBe(403);
    expect(await status(await api(`/${upload.id}/playback`, 'GET', otherAdminToken, otherMinistryId))).toBe(404);
    expect(await status(await reserve(six(), randomUUID(), adminToken, otherMinistryId))).toBe(403);
  });

  it('cleans MP3 staging and final objects after expiry', async () => {
    const upload = await stage();
    const removed = vi.spyOn(storage, 'remove');
    clock = upload.expiresAt;
    await json(await api('/uploads/cleanup', 'POST'));
    clock += 15 * minute;
    for (let i = 0; i < 8; i++) await json(await api('/uploads/cleanup', 'POST'));
    const keys = removed.mock.calls.map(([key]) => key);
    expect(keys).toContain(`staging/ministry-audio/${ministryId}/${upload.id}/vocals/1.mp3`);
    expect(keys).toContain(`objects/ministry-audio/${ministryId}/${upload.id}/vocals.mp3`);
    expect(keys.every((key) => key.endsWith('.mp3'))).toBe(true);
  });

  it('keeps an MP3 recording invisible and unpublishable as soon as the codec is not enabled', async () => {
    const upload = await stage();
    profile.serverByteValidation = false;
    const finalized = await json<{ error: { details?: { code?: string } } }>(await finalize(upload.id), 422);
    expect(finalized.error.details?.code).toBe('AUDIO_CODEC_NOT_ENABLED');
    expect((await doc(upload.id).get()).data()!.status).toBe('uploading');
    // a recording published while the codec was open disappears from members' view when it closes again
    profile.serverByteValidation = true;
    await json(await finalize(upload.id));
    profile.serverByteValidation = false;
    expect(await status(await api(`/${upload.id}/playback`, 'GET', memberToken))).toBe(404);
    const list = await json<{ items: Array<{ id: string }> }>(await api('/', 'GET', memberToken));
    expect(list.items.some((item) => item.id === upload.id)).toBe(false);
  });
  // Long audio (close to 300 s): six real ~9 MB MP3 stems. The files are big and not committed: produce them with
  // scripts/m22s3/encode-long-fixtures.ts and point M22S3_LONG_DIR at the output. Without it this case is NOT executed.
  const longDir = process.env.M22S3_LONG_DIR;
  it.skipIf(!longDir)('publishes six ~300 s MP3 stems end to end, validating in streaming with bounded memory', { timeout: 240_000 }, async () => {
    const { readFileSync: read } = await import('node:fs');
    const manifests = JSON.parse(read(join(longDir!, 'manifests.json'), 'utf8')) as Mp3StemManifest[];
    expect(manifests).toHaveLength(6);
    profile.serverByteValidation = true;
    const upload = await json<Upload>(await reserve(manifests));
    let peakRss = 0;
    let peakHeap = 0;
    const sample = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); }, 50);
    const baseline = process.memoryUsage();
    const timings: Record<string, number> = {};
    try {
      for (const stem of STEM_IDS) {
        const bytes = read(join(longDir!, `${stem}.mp3`));
        const started = Date.now();
        await json(await (await sealStem(upload.id, stem, bytes)).complete());
        timings[stem] = Date.now() - started;
      }
    } finally {
      clearInterval(sample);
    }
    expect(await json<{ status: string }>(await finalize(upload.id))).toMatchObject({ status: 'published' });
    const playback = await json<Playback>(await api(`/${upload.id}/playback`, 'GET', memberToken));
    for (const track of playback.tracks) {
      const response = await object(track, 'GET');
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifests[STEM_IDS.indexOf(track.id)]!.sha256);
    }
    const mb = (n: number) => Math.round(n / 1_048_576);
    console.log(`M22S3 long-audio: seal ms per stem ${JSON.stringify(timings)}; baseline rss ${mb(baseline.rss)} MB heap ${mb(baseline.heapUsed)} MB; peak rss ${mb(peakRss)} MB heap ${mb(peakHeap)} MB`);
    // One 9 MB body is held by this test process at a time; the server side validates in O(1) memory (Info frame only).
    expect(peakHeap - baseline.heapUsed).toBeLessThan(200 * 1_048_576);
  });
  describe('Web encoder profile (LAME 3.100 WebAssembly, six distinct stems)', () => {
    const lame = webCases.sixStems44100;
    const lameBytes = (stem: StemId) => Buffer.from(lame[STEM_IDS.indexOf(stem)]!.base64, 'base64');
    const lameStems = () => lame.map((s) => s.manifest);
    async function stageLame() {
      profile.serverByteValidation = true;
      const upload = await json<Upload>(await reserve(lameStems()));
      for (const stem of STEM_IDS) await json(await (await sealStem(upload.id, stem, lameBytes(stem))).complete());
      return upload;
    }

    it('reserves, uploads, validates, seals, publishes and serves the six real Web-encoder stems byte-for-byte to another member, with renewable URLs', async () => {
      const upload = await stageLame();
      const stored = (await doc(upload.id).get()).data()!;
      for (const id of STEM_IDS) {
        expect(stored.directAttempts[id].receipt.mp3).toMatchObject({ id, encoder: 'LAME3.100', tagDelayFrames: 576, decoderDelayFrames: 529 });
      }
      expect(await json<{ status: string }>(await finalize(upload.id))).toMatchObject({ status: 'published' });
      for (const round of [1, 2]) { // second round = renewed signed URLs
        const playback = await json<Playback>(await api(`/${upload.id}/playback`, 'GET', memberToken));
        expect(playback.manifest.stems.map((s) => s.id)).toEqual([...STEM_IDS]);
        for (const track of playback.tracks) {
          const response = await object(track, 'GET');
          expect(response.headers.get('content-type'), `round ${round}`).toBe('audio/mpeg');
          const bytes = Buffer.from(await response.arrayBuffer());
          expect(bytes).toEqual(lameBytes(track.id));
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(lame[STEM_IDS.indexOf(track.id)]!.manifest.sha256);
        }
      }
      expect(legacyStorage.put).not.toHaveBeenCalled();
    });

    it('resumes an interrupted upload: a truncated body fails validation, a fresh attempt succeeds, and nothing partial is published', async () => {
      profile.serverByteValidation = true;
      const upload = await json<Upload>(await reserve(lameStems()));
      const cut = lameBytes('vocals').subarray(0, 4000);
      const first = await json<UploadGrant>(await api(`${stemPath(upload.id, 'vocals')}/upload-url`, 'POST'));
      expect(await status(await object(first, 'PUT', cut))).not.toBe(200); // the signed size does not match: nothing is stored
      expect(await status(await api(`${stemPath(upload.id, 'vocals')}/complete`, 'POST', adminToken, ministryId, { attempt: first.attempt }))).not.toBe(200);
      expect(await status(await finalize(upload.id))).toBe(409);
      const resumed = await sealStem(upload.id, 'vocals', lameBytes('vocals'));
      expect(resumed.grant.attempt).toBeGreaterThanOrEqual(first.attempt); // the same attempt may be resumed
      await json(await resumed.complete());
      for (const stem of STEM_IDS.filter((id) => id !== 'vocals')) await json(await (await sealStem(upload.id, stem, lameBytes(stem))).complete());
      expect(await json<{ status: string }>(await finalize(upload.id))).toMatchObject({ status: 'published' });
    });

    it('refuses to publish when one stem is reported by another profile/encoder, and when a stem leaves the pinned delays', async () => {
      const upload = await stageLame();
      const ref = doc(upload.id);
      const facts = (await ref.get()).data()!.directAttempts.bass.receipt.mp3;
      await ref.update({ 'directAttempts.bass.receipt.mp3': { ...facts, encoder: 'Lavc99.9.' } });
      expect(await status(await finalize(upload.id))).toBe(409);
      await ref.update({ 'directAttempts.bass.receipt.mp3': { ...facts, decoderDelayFrames: 530, tagPaddingFrames: facts.tagPaddingFrames + 1 } });
      expect(await status(await finalize(upload.id))).toBe(409);
      expect((await ref.get()).data()!.status).toBe('uploading');
      await ref.update({ 'directAttempts.bass.receipt.mp3': facts });
      expect(await status(await finalize(upload.id))).toBe(200);
    });

    it('rejects malformed LAME bytes with a valid SHA-256, concurrent finalization publishes once, and other ministries see nothing', async () => {
      profile.serverByteValidation = true;
      const bad = Buffer.from(lameBytes('drums')); bad[300] ^= 1;
      const stems = lameStems().map((s) => (s.id === 'drums' ? { ...s, sha256: createHash('sha256').update(bad).digest('hex') } : s));
      const broken = await json<Upload>(await reserve(stems));
      expect(await status(await (await sealStem(broken.id, 'drums', bad)).complete())).toBe(422);

      const upload = await stageLame();
      const results = await Promise.all([finalize(upload.id), finalize(upload.id), finalize(upload.id)]);
      expect((await Promise.all(results.map((r) => json<{ id: string }>(r)))).every((b) => b.id === upload.id)).toBe(true);
      expect(await status(await api(`/${upload.id}/playback`, 'GET', otherAdminToken, otherMinistryId))).toBe(404);
      const list = await json<{ items: Array<{ id: string }> }>(await api('/', 'GET', otherAdminToken, otherMinistryId));
      expect(list.items.some((item) => item.id === upload.id)).toBe(false);
    });

    it('is rejected on the real routes while the codec is not enabled', async () => {
      profile.serverByteValidation = false;
      expect(await json<{ error: { details?: { code?: string } } }>(await reserve(lameStems()), 422)).toMatchObject({ error: { details: { code: 'AUDIO_CODEC_NOT_ENABLED' } } });
    });
  });
});
