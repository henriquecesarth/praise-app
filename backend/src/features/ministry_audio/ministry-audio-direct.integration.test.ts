import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebase';
import { AppError, errorHandler } from '../../middleware/error-handler';
import { UserRepository } from '../../repositories/UserRepository';
import { MinistryAudioRepository } from './ministry-audio.repository';
import { createMinistryAudioRouter } from './ministry-audio.routes';
import { STEM_IDS, type AudioManifest, type StemId, type StemManifest } from './ministry-audio.schema';
import { SimulatedDirectStemStorage } from './simulated-direct-storage';
import type { StemStorage } from './storage';

const objectRoute = '/api/local/ministry-audio-objects';
const minute = 60_000;

function stemFixture(id: StemId, sample: number) {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(4, 40);
  bytes.writeInt16LE(sample, 44);
  const manifest: StemManifest = {
    id, codec: 'pcm_s16le', sampleRate: 8_000, channels: 2, frames: 1,
    durationSeconds: 1 / 8_000, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { bytes, manifest };
}

const stems = STEM_IDS.map((id, index) => stemFixture(id, index + 1));
const vocals = stems[0];
const changedVocals = stemFixture('vocals', 999).bytes;

type SignedRequest = { url: string; headers: Record<string, string> };
type UploadGrant = SignedRequest & { attempt: number; expiresAt: number };
type Upload = { id: string; status: string; transfer: 'direct'; uploadedStemIds: StemId[]; expiresAt: number };
type Recording = { id: string; status: string };
type Playback = { transfer: 'direct'; manifest: AudioManifest; tracks: Array<SignedRequest & { id: StemId }>; expiresAt: number };

async function readJson<T>(response: Response, status = 200): Promise<T> {
  const body = await response.text();
  expect(response.status, body).toBe(status);
  return JSON.parse(body) as T;
}

async function statusOf(response: Response): Promise<number> {
  await response.arrayBuffer();
  return response.status;
}

describe('Ministry audio direct HTTP with Firestore Emulator and signed object simulator', { timeout: 30_000 }, () => {
  const users = new UserRepository();
  const legacyStorage: StemStorage = {
    put: vi.fn().mockRejectedValue(new Error('Unexpected proxy write')),
    verify: vi.fn().mockRejectedValue(new Error('Unexpected proxy verification')),
    open: vi.fn().mockRejectedValue(new Error('Unexpected proxy read')),
    remove: vi.fn().mockRejectedValue(new Error('Unexpected proxy deletion')),
  };
  let server: Server;
  let origin: string;
  let storage: SimulatedDirectStemStorage;
  let clock: number;
  let ministryId: string;
  let otherMinistryId: string;
  let adminToken: string;
  let memberToken: string;
  let membership: FirebaseFirestore.DocumentReference;

  beforeAll(async () => {
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    storage = new SimulatedDirectStemStorage(origin, () => clock);
    app.use(objectRoute, storage.router);
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage: legacyStorage, directStorage: storage, now: () => clock,
    }));
    app.use(errorHandler);
  });

  beforeEach(async () => {
    clock = Date.UTC(2026, 10, 19, 12);
    ministryId = `audio-direct-${randomUUID()}`;
    otherMinistryId = `audio-direct-${randomUUID()}`;
    const adminId = `admin-${randomUUID()}`;
    const memberId = `member-${randomUUID()}`;
    adminToken = users.generateAuthToken(adminId, 'admin@example.test');
    memberToken = users.generateAuthToken(memberId, 'member@example.test');
    membership = db.collection('ministry_members').doc(`${ministryId}_${memberId}`);

    const batch = db.batch();
    for (const id of [ministryId, otherMinistryId]) {
      batch.set(db.collection('ministries').doc(id), { name: 'Direct audio integration', owner_user_id: adminId });
    }
    batch.set(membership, { ministry_id: ministryId, user_id: memberId, role: 'member', status: 'active' });
    await batch.commit();
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });

  function api(path: string, method = 'GET', token: string | null = adminToken, tenant = ministryId, body?: unknown) {
    const headers = new Headers();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('content-type', 'application/json');
    return fetch(`${origin}/api/v1/ministries/${tenant}/audio-library${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  }

  function object(request: SignedRequest, method: 'GET' | 'PUT', bytes?: Buffer) {
    return fetch(request.url, {
      method, headers: request.headers, body: bytes && new Uint8Array(bytes), signal: AbortSignal.timeout(5_000),
    });
  }

  function stemPath(id: string, stem: StemId = 'vocals') {
    return `/uploads/${id}/stems/${stem}`;
  }

  function finalKey(id: string, stem: StemId = 'vocals') {
    return `objects/ministry-audio/${ministryId}/${id}/${stem}.wav`;
  }

  function grant(id: string, stem: StemId = 'vocals') {
    return api(`${stemPath(id, stem)}/upload-url`, 'POST');
  }

  function complete(id: string, attempt: number, stem: StemId = 'vocals', token = adminToken) {
    return api(`${stemPath(id, stem)}/complete`, 'POST', token, ministryId, { attempt });
  }

  async function reserve() {
    const upload = await readJson<Upload>(await api('/uploads', 'POST', adminToken, ministryId, {
      idempotencyKey: randomUUID(), confirmed: true,
      title: 'Local recording', artist: 'Fixture artist', version: 'Live',
      model: { id: 'htdemucs_6s', version: '1.0.0' }, stems: stems.map(({ manifest }) => manifest),
    }));
    expect(upload).toMatchObject({ transfer: 'direct', status: 'uploading', uploadedStemIds: [] });
    return upload;
  }

  async function writeStem(id: string, stem = vocals) {
    const signed = await readJson<UploadGrant>(await grant(id, stem.manifest.id));
    expect(await statusOf(await object(signed, 'PUT', stem.bytes))).toBe(200);
    return signed;
  }

  async function stage() {
    const upload = await reserve();
    for (const stem of stems) {
      const { attempt } = await writeStem(upload.id, stem);
      await readJson<Upload>(await complete(upload.id, attempt, stem.manifest.id));
    }
    return upload;
  }

  function finalize(id: string) {
    return api(`/uploads/${id}/finalize`, 'POST');
  }

  async function publish() {
    const { id } = await stage();
    return readJson<Recording>(await finalize(id));
  }

  function playback(id: string, token = memberToken) {
    return api(`/${id}/playback`, 'GET', token);
  }

  async function expectInvisible(id: string) {
    expect(await statusOf(await playback(id))).toBe(404);
    const { items } = await readJson<{ items: Recording[] }>(await api('/', 'GET', memberToken));
    expect(items.some((item) => item.id === id)).toBe(false);
  }

  it('publishes all six verified stems and lets an active member issue direct GETs', async () => {
    const recording = await publish();
    const result = await readJson<Playback>(await playback(recording.id));
    expect(result).toMatchObject({ transfer: 'direct', expiresAt: clock + 2 * minute, manifest: { recordingId: recording.id } });
    expect(result.tracks.map(({ id }) => id)).toEqual([...STEM_IDS]);
    expect(result.manifest.stems).toEqual(stems.map(({ manifest }) => manifest));
    for (const track of result.tracks) {
      const response = await object(track, 'GET');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('content-type')).toBe('audio/wav');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(stems.find(({ manifest }) => manifest.id === track.id)?.bytes);
    }
    expect(legacyStorage.put).not.toHaveBeenCalled();
    expect(legacyStorage.open).not.toHaveBeenCalled();
  });

  it('requires authentication and admin rights, and hides cross-tenant resource IDs', async () => {
    const { id } = await reserve();
    const path = `${stemPath(id)}/upload-url`;
    expect(await statusOf(await api(path, 'POST', null))).toBe(401);
    expect(await statusOf(await api(path, 'POST', memberToken))).toBe(403);
    expect(await statusOf(await complete(id, 1, 'vocals', memberToken))).toBe(403);
    const denied = await api(path, 'POST', adminToken, otherMinistryId);
    const absent = await api(`${stemPath('a'.repeat(64))}/upload-url`, 'POST', adminToken, otherMinistryId);
    expect(await readJson(denied, 404)).toEqual(await readJson(absent, 404));
    expect(await statusOf(await api(`${stemPath(id)}/complete`, 'POST', adminToken, otherMinistryId, { attempt: 1 }))).toBe(404);
    const recording = await publish();
    expect(await statusOf(await api(`/${recording.id}/playback`, 'GET', adminToken, otherMinistryId))).toBe(404);
  });

  it('stops issuing GETs after membership is revoked while an issued capability expires on schedule', async () => {
    const recording = await publish();
    const { tracks, expiresAt } = await readJson<Playback>(await playback(recording.id));
    await membership.update({ status: 'removed' });
    expect(await statusOf(await playback(recording.id))).toBe(403);
    expect(await statusOf(await object(tracks[0], 'GET'))).toBe(200);
    clock = expiresAt;
    expect(await statusOf(await object(tracks[0], 'GET'))).toBe(403);
  });

  it('rechecks admin rights when completing after verification runs in flight', async () => {
    const { id } = await reserve();
    const { attempt } = await writeStem(id);
    await membership.update({ role: 'admin' });
    const originalSeal = storage.seal.bind(storage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    vi.spyOn(storage, 'seal').mockImplementationOnce(async (...args) => {
      const receipt = await originalSeal(...args);
      signalEntered();
      await gate;
      return receipt;
    });
    const pending = complete(id, attempt, 'vocals', memberToken);
    try {
      await Promise.race([entered, pending.then(({ status }) => {
        throw new Error(`Complete ended before sealing (HTTP ${status})`);
      })]);
      await membership.update({ role: 'member' });
    } finally {
      release();
    }
    expect(await statusOf(await pending)).toBe(403);
    const progress = await readJson<Upload>(await api(`/uploads/${id}`));
    expect(progress.uploadedStemIds).toEqual([]);
    expect(await statusOf(await finalize(id))).toBe(409);
    await expectInvisible(id);
    expect((await readJson<Upload>(await complete(id, attempt))).uploadedStemIds).toEqual(['vocals']);
  });

  it('expires a PUT grant, renews it and caps renewed grants at the reservation deadline', async () => {
    const upload = await reserve();
    const first = await readJson<UploadGrant>(await grant(upload.id));
    expect(first.expiresAt).toBe(clock + 5 * minute);
    clock = first.expiresAt;
    expect(await statusOf(await object(first, 'PUT', vocals.bytes))).toBe(403);
    const renewed = await readJson<UploadGrant>(await grant(upload.id));
    expect(renewed).toMatchObject({ attempt: first.attempt, expiresAt: clock + 5 * minute });
    clock = upload.expiresAt - minute;
    const capped = await readJson<UploadGrant>(await grant(upload.id));
    expect(capped.expiresAt).toBe(upload.expiresAt);
    clock = upload.expiresAt;
    expect(await statusOf(await object(capped, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await grant(upload.id))).toBe(409);
    expect(await statusOf(await complete(upload.id, capped.attempt))).toBe(409);
  });

  it('distinguishes missing staging bytes and keeps partial uploads out of the catalog', async () => {
    const { id } = await reserve();
    const issued = await readJson<UploadGrant>(await grant(id));
    expect(await readJson(await complete(id, issued.attempt), 409)).toMatchObject({ error: { details: { code: 'AUDIO_UPLOAD_MISSING' } } });
    expect(await statusOf(await object(issued, 'PUT', vocals.bytes))).toBe(200);
    expect((await readJson<Upload>(await complete(id, issued.attempt))).uploadedStemIds).toEqual(['vocals']);
    expect(await statusOf(await finalize(id))).toBe(409);
    await expectInvisible(id);
  });

  it('converges under duplicate issuance, writes, completion and finalization', async () => {
    const { id } = await reserve();
    const grants = await Promise.all([grant(id), grant(id)].map(async (result) => readJson<UploadGrant>(await result)));
    expect(grants[0]).toEqual(grants[1]);
    const writes = await Promise.all(grants.map(async (issued) => statusOf(await object(issued, 'PUT', vocals.bytes))));
    expect(writes.sort()).toEqual([200, 412]);
    const completions = await Promise.all(grants.map(async ({ attempt }) => readJson<Upload>(await complete(id, attempt))));
    expect(completions[0]).toEqual(completions[1]);
    expect(completions[0].uploadedStemIds).toEqual(['vocals']);
    expect(await readJson<Upload>(await complete(id, grants[0].attempt))).toEqual(completions[0]);
    for (const stem of stems.slice(1)) {
      const { attempt } = await writeStem(id, stem);
      await readJson<Upload>(await complete(id, attempt, stem.manifest.id));
    }
    const results = await Promise.all([finalize(id), finalize(id)].map(async (result) => readJson<Recording>(await result)));
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ id, status: 'published' });
    const { items } = await readJson<{ items: Recording[] }>(await api('/', 'GET', memberToken));
    expect(items.map((item) => item.id)).toEqual([id]);
  });

  it('detects altered final objects both before publication and in previously issued GETs', async () => {
    const pending = await stage();
    storage.tamper(finalKey(pending.id), changedVocals);
    expect(await statusOf(await finalize(pending.id))).toBe(409);
    await expectInvisible(pending.id);

    const recording = await publish();
    const { tracks } = await readJson<Playback>(await playback(recording.id));
    const track = tracks.find(({ id }) => id === 'vocals')!;
    storage.tamper(finalKey(recording.id), changedVocals);
    expect(await statusOf(await playback(recording.id))).toBe(409);
    expect(await statusOf(await object(track, 'GET'))).toBe(412);
  });

  it('rejects a same-length checksum mismatch, then allows replacement through a fresh attempt', async () => {
    const { id } = await reserve();
    const first = await readJson<UploadGrant>(await grant(id));
    expect(await statusOf(await object(first, 'PUT', changedVocals))).toBe(200);
    expect(await readJson(await complete(id, first.attempt), 422)).toMatchObject({ error: { details: { code: 'AUDIO_UPLOAD_INVALID' } } });
    expect((await readJson<Upload>(await api(`/uploads/${id}`))).uploadedStemIds).toEqual([]);
    expect(await statusOf(await object(first, 'PUT', vocals.bytes))).toBe(412);
    const next = await readJson<UploadGrant>(await grant(id));
    expect(next.attempt).toBe(first.attempt + 1);
    expect(next.url).not.toBe(first.url);
    expect(await statusOf(await complete(id, first.attempt))).toBe(409);
    expect(await statusOf(await object(next, 'PUT', vocals.bytes))).toBe(200);
    expect((await readJson<Upload>(await complete(id, next.attempt))).uploadedStemIds).toEqual(['vocals']);

    const another = stems[1];
    for (const expectedAttempt of [1, 2, 3]) {
      const issued = await readJson<UploadGrant>(await grant(id, another.manifest.id));
      expect(issued.attempt).toBe(expectedAttempt);
      expect(await statusOf(await object(issued, 'PUT', vocals.bytes))).toBe(200);
      expect(await statusOf(await complete(id, issued.attempt, another.manifest.id))).toBe(422);
    }
    expect(await statusOf(await grant(id, another.manifest.id))).toBe(409);
  });

  it('resumes after a storage failure and a Firestore failure following successful sealing', async () => {
    const { id } = await reserve();
    const { attempt } = await writeStem(id);
    const seal = storage.seal.bind(storage);
    const sealing = vi.spyOn(storage, 'seal').mockRejectedValueOnce(new Error('Injected storage failure'));
    expect(await statusOf(await complete(id, attempt))).toBe(500);
    expect((await readJson<Upload>(await api(`/uploads/${id}`))).uploadedStemIds).toEqual([]);
    const update = vi.spyOn(MinistryAudioRepository.prototype, 'update');
    sealing.mockImplementationOnce(async (...args) => {
      const receipt = await seal(...args);
      update.mockRejectedValueOnce(new Error('Injected Firestore update failure'));
      return receipt;
    });
    expect(await statusOf(await complete(id, attempt))).toBe(500);
    expect((await readJson<Upload>(await api(`/uploads/${id}`))).uploadedStemIds).toEqual([]);
    expect((await readJson<Upload>(await complete(id, attempt))).uploadedStemIds).toEqual(['vocals']);
  });

  it('keeps a finished verification across a failed promotion and offers it back only for that attempt', async () => {
    const { id } = await reserve();
    const { attempt } = await writeStem(id);
    const seal = storage.seal.bind(storage);
    const verified = { etag: '"0123456789abcdef0123456789abcdef"', lastModified: Date.UTC(2026, 10, 19, 11) };
    const offered: Array<unknown> = [];
    vi.spyOn(storage, 'seal')
      .mockImplementationOnce(async (_staging, _final, _manifest, options) => {
        offered.push(options?.verified);
        await options?.onVerified?.(verified);
        throw new AppError(503, 'Injected promotion timeout');
      })
      .mockImplementationOnce(async (staging, final, manifest, options) => {
        offered.push(options?.verified);
        return seal(staging, final, manifest, options);
      });
    expect(await statusOf(await complete(id, attempt))).toBe(503);
    expect((await readJson<Upload>(await complete(id, attempt))).uploadedStemIds).toEqual(['vocals']);
    expect(offered).toEqual([undefined, verified]);
    // A confirmed stem is answered from its receipt and never sealed again.
    expect((await readJson<Upload>(await complete(id, attempt))).uploadedStemIds).toEqual(['vocals']);
    expect(offered).toHaveLength(2);
  });

  it('drops a persisted verification when the attempt turns invalid, so a fresh attempt starts clean', async () => {
    const { id } = await reserve();
    const first = await writeStem(id);
    const offered: Array<unknown> = [];
    vi.spyOn(storage, 'seal')
      .mockImplementationOnce(async (_staging, _final, _manifest, options) => {
        await options?.onVerified?.({ etag: '"0123456789abcdef0123456789abcdef"', lastModified: 1 });
        throw new AppError(422, 'Injected invalid upload');
      })
      .mockImplementation(async (_staging, _final, _manifest, options) => {
        offered.push(options?.verified);
        throw new AppError(503, 'Injected');
      });
    expect(await statusOf(await complete(id, first.attempt))).toBe(422);
    const next = await readJson<UploadGrant>(await grant(id));
    expect(next.attempt).toBe(first.attempt + 1);
    expect(await statusOf(await complete(id, next.attempt))).toBe(503);
    expect(offered).toEqual([undefined]);
  });
  it('binds URL origin, method, object path, signed headers and size, with bounded cleanup of staging and final keys', async () => {
    const { id, expiresAt } = await reserve();
    const issued = await readJson<UploadGrant>(await grant(id));
    const original = new URL(issued.url);
    const otherTenant = { ...issued, url: issued.url.replace(ministryId, otherMinistryId) };
    const otherTrack = { ...issued, url: issued.url.replace('/vocals/', '/drums/') };
    const otherHost = { ...issued, url: issued.url.replace('127.0.0.1', 'localhost') };
    const changedExpiry = new URL(issued.url);
    changedExpiry.searchParams.set('expires', String(issued.expiresAt + minute));
    expect(original.origin).toBe(origin);
    const browserOrigin = 'http://127.0.0.1:5173';
    const preflight = await fetch(issued.url, {
      method: 'OPTIONS',
      headers: {
        origin: browserOrigin, 'access-control-request-method': 'PUT',
        'access-control-request-headers': Object.keys(issued.headers).join(','),
      },
      signal: AbortSignal.timeout(5_000),
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(browserOrigin);
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('if-none-match');
    expect(await statusOf(await object(otherTenant, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object(otherTrack, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object(otherHost, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object({ ...issued, url: changedExpiry.href }, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object({ ...issued, url: `${origin}${original.pathname}` }, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object(issued, 'GET'))).toBe(403);
    expect(await statusOf(await object({ ...issued, headers: { ...issued.headers, 'content-type': 'text/plain' } }, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object({ ...issued, headers: { ...issued.headers, 'if-none-match': '' } }, 'PUT', vocals.bytes))).toBe(403);
    expect(await statusOf(await object(issued, 'PUT', vocals.bytes.subarray(0, -1)))).toBe(403);
    expect(await statusOf(await object(issued, 'PUT', vocals.bytes))).toBe(200);
    await readJson<Upload>(await complete(id, issued.attempt));

    const archived = await publish();
    expect(await statusOf(await api(`/${archived.id}/archive`, 'POST'))).toBe(200);
    const removed = vi.spyOn(storage, 'remove');
    clock = expiresAt;
    await readJson(await api('/uploads/cleanup', 'POST'));
    expect(removed).not.toHaveBeenCalledWith(finalKey(id));
    clock += 15 * minute;
    const cleanup = () => api('/uploads/cleanup', 'POST');
    expect(await readJson(await cleanup())).toEqual({ cleaned: 1 });
    expect(await readJson(await cleanup())).toEqual({ cleaned: 1 });
    expect(await readJson(await cleanup())).toEqual({ cleaned: 0 });
    expect(removed).toHaveBeenCalledWith(finalKey(id));
    expect(removed).toHaveBeenCalledWith(original.pathname.slice(objectRoute.length + 1));
    expect(removed).toHaveBeenCalledWith(`staging/ministry-audio/${ministryId}/${archived.id}/vocals/1.wav`);
    expect(removed.mock.calls.every(([key]) => !key.startsWith(`objects/ministry-audio/${ministryId}/${archived.id}/`))).toBe(true);
    await expectInvisible(id);
  });
});
