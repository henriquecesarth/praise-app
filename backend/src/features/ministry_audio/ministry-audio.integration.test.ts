import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebase';
import { errorHandler } from '../../middleware/error-handler';
import { UserRepository } from '../../repositories/UserRepository';
import { createMinistryAudioRouter } from './ministry-audio.routes';
import { SimulatedStemStorage } from './storage';

const stemIds = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
type StemId = typeof stemIds[number];

function stereoWave(sample: number) {
  const sampleRate = 8_000;
  const frames = sampleRate;
  const channels = 2;
  const blockAlign = channels * 2;
  const sizeBytes = 44 + frames * blockAlign;
  const bytes = Buffer.alloc(sizeBytes);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(sizeBytes - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * blockAlign, 28);
  bytes.writeUInt16LE(blockAlign, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(sizeBytes - 44, 40);
  bytes.writeInt16LE(sample, 44);
  return {
    bytes,
    spec: {
      codec: 'pcm_s16le',
      sampleRate,
      frames,
      channels,
      sizeBytes,
      durationSeconds: frames / sampleRate,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

const stems = stemIds.map((id, index) => {
  const { bytes, spec } = stereoWave(index + 1);
  return { id, bytes, spec: { id, ...spec } };
});

function uploadInput(title = 'Alpha recording') {
  return {
    idempotencyKey: randomUUID(),
    confirmed: true,
    title,
    artist: 'Fixture artist',
    version: 'Live',
    model: { id: 'htdemucs_6s', version: '1.0.0' },
    stems: stems.map(({ spec }) => spec),
  };
}

type UploadInput = ReturnType<typeof uploadInput>;
type Upload = { id: string; status: string; uploadedStemIds: StemId[]; expiresAt: number };
type Recording = { id: string; title: string; artist: string; version: string; status: string };
type Catalog = { items: Recording[]; nextCursor: string | null };
type Playback = {
  manifest: { schemaVersion: number; recordingId: string; recordingVersion: string; model: UploadInput['model']; stems: UploadInput['stems'] };
  tracks: Array<{ id: StemId; url: string }>;
  expiresAt: number;
};

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function readJson<T>(response: Response, status = 200): Promise<T> {
  const body = await response.text();
  expect(response.status, body).toBe(status);
  return JSON.parse(body) as T;
}

async function expectStatus(response: Response, status: number) {
  expect(response.status, await response.text()).toBe(status);
}

describe('Ministry audio HTTP integration with Firestore Emulator and simulated storage', { timeout: 30_000 }, () => {
  const users = new UserRepository();
  let clock: number;
  let storage: SimulatedStemStorage;
  let storageRoot: string;
  let server: Server;
  let baseUrl: string;
  let ministryId: string;
  let otherMinistryId: string;
  let adminToken: string;
  let memberToken: string;
  let memberDocumentId: string;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'louvaio-ministry-audio-test-'));
    storage = new SimulatedStemStorage(storageRoot);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage,
      now: () => clock,
      ticketSecret: Buffer.alloc(32, 17),
    }));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/ministries`;
  });

  beforeEach(async () => {
    clock = Date.UTC(2026, 10, 19, 12);
    ministryId = `audio-${randomUUID()}`;
    otherMinistryId = `audio-${randomUUID()}`;
    const adminId = `admin-${randomUUID()}`;
    const memberId = `member-${randomUUID()}`;
    memberDocumentId = `${ministryId}_${memberId}`;
    adminToken = users.generateAuthToken(adminId, 'admin@example.test');
    memberToken = users.generateAuthToken(memberId, 'member@example.test');

    const batch = db.batch();
    for (const id of [ministryId, otherMinistryId]) {
      batch.set(db.collection('ministries').doc(id), { name: 'Audio integration', owner_user_id: adminId });
    }
    batch.set(db.collection('ministry_members').doc(memberDocumentId), {
      ministry_id: ministryId,
      user_id: memberId,
      role: 'member',
      status: 'active',
    });
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
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  function request(path: string, init: RequestInit = {}, token: string | null = adminToken, tenant = ministryId) {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetch(`${baseUrl}/${tenant}/audio-library${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  }

  function reserve(input: UploadInput = uploadInput()) {
    return request('/uploads', jsonRequest('POST', input));
  }

  function putStem(id: string, stemId: StemId, bytes: Buffer, token = adminToken) {
    return request(`/uploads/${id}/stems/${stemId}`, {
      method: 'PUT',
      headers: { 'content-type': 'audio/wav' },
      body: new Uint8Array(bytes),
    }, token);
  }

  function storedStemPath(recordingId: string, stemId: StemId) {
    const tenantFolder = createHash('sha256').update(ministryId).digest('hex');
    const recordingFolder = createHash('sha256').update(recordingId).digest('hex');
    return join(storageRoot, tenantFolder, recordingFolder, `${stemId}.wav`);
  }

  async function stage(input = uploadInput()) {
    const upload = await readJson<Upload>(await reserve(input));
    for (const { id, bytes } of stems) {
      await readJson<Upload>(await putStem(upload.id, id, bytes));
    }
    return upload;
  }

  function finalize(id: string) {
    return request(`/uploads/${id}/finalize`, { method: 'POST' });
  }

  async function publish(input = uploadInput()) {
    const upload = await stage(input);
    return readJson<Recording>(await finalize(upload.id));
  }

  async function playback(id: string) {
    return readJson<Playback>(await request(`/${id}/playback`, {}, memberToken));
  }

  async function recordingDocs(tenant: string) {
    return (await db.collection('ministries').doc(tenant).collection('audio_recordings').get()).docs;
  }

  function mp3V2Input(key = randomUUID()) {
    const stem = {
      codec: 'mp3_cbr256', sampleRate: 44_100, channels: 2, bitrateKbps: 256, durationSeconds: 30, frames: 1_323_000,
      sizeBytes: 962_141, sha256: 'b'.repeat(64),
      alignment: { encoderDelayFrames: 1105, paddingFrames: 695, mpegAudioFrames: 1150, infoFrame: true },
    };
    return { ...uploadInput(), idempotencyKey: key, schemaVersion: 2, stems: stemIds.map((id) => ({ id, ...stem })) };
  }

  it('persists v1 manifests as v1 and normalizes a PCM v2 request to the same v1 reservation', async () => {
    const v1 = uploadInput();
    const upload = await readJson<Upload>(await reserve(v1));
    const stored = (await recordingDocs(ministryId)).find((doc) => doc.id === upload.id)!.data();
    expect(stored.manifest.schemaVersion).toBe(1);
    expect(stored.manifest.stems.map((stem: { id: string }) => stem.id)).toEqual([...stemIds]);

    // Same idempotency key + same PCM content declared as v2: identical requestHash, so a replay, not a conflict.
    const replay = await readJson<Upload>(await reserve({ ...v1, schemaVersion: 2 } as unknown as UploadInput));
    expect(replay.id).toBe(upload.id);
    expect((await recordingDocs(ministryId)).length).toBe(1);

    // A fresh v2 PCM reservation is stored as v1 and plays back as v1 for deployed clients.
    const v2 = { ...uploadInput('Gamma'), schemaVersion: 2 } as unknown as UploadInput;
    const fresh = await readJson<Upload>(await reserve(v2));
    const freshDoc = (await recordingDocs(ministryId)).find((doc) => doc.id === fresh.id)!.data();
    expect(freshDoc.manifest.schemaVersion).toBe(1);
    for (const { id, bytes } of stems) await readJson<Upload>(await putStem(fresh.id, id, bytes));
    await readJson<Recording>(await finalize(fresh.id));
    expect((await playback(fresh.id)).manifest.schemaVersion).toBe(1);
  });

  it('rejects MP3 v2 reservations with AUDIO_CODEC_NOT_ENABLED and creates no writes in any ministry', async () => {
    const before = [(await recordingDocs(ministryId)).length, (await recordingDocs(otherMinistryId)).length];
    const key = randomUUID();
    for (const tenant of [ministryId, otherMinistryId]) {
      const response = await request('/uploads', jsonRequest('POST', mp3V2Input(key)), adminToken, tenant);
      const body = await response.text();
      expect(response.status, body).toBe(422);
      expect(body).toContain('AUDIO_CODEC_NOT_ENABLED');
    }
    expect([(await recordingDocs(ministryId)).length, (await recordingDocs(otherMinistryId)).length]).toEqual(before);
    // The rejected key leaves no residue: the same key is still usable for a valid PCM reservation.
    await readJson<Upload>(await reserve({ ...uploadInput(), idempotencyKey: key }));
    // Contract-invalid MP3 metadata is rejected as a validation error, also without writes.
    const broken = mp3V2Input();
    (broken.stems[0].alignment as { paddingFrames: number }).paddingFrames = 700;
    await expectStatus(await reserve(broken as unknown as UploadInput), 400);
    // Members cannot reserve at all, so MP3 declarations are unreachable for them.
    await expectStatus(await request('/uploads', jsonRequest('POST', mp3V2Input()), memberToken), 403);
    // None of the rejected attempts (422/400/403) wrote anything beyond the single valid PCM reservation above.
    expect([(await recordingDocs(ministryId)).length, (await recordingDocs(otherMinistryId)).length]).toEqual([before[0] + 1, before[1]]);
  });

  it('publishes all six stems and returns the original bytes to a ministry member', async () => {
    const input = uploadInput();
    const upload = await stage(input);
    const status = await readJson<Upload>(await request(`/uploads/${upload.id}`));
    expect(status.uploadedStemIds).toHaveLength(stems.length);
    expect(new Set(status.uploadedStemIds)).toEqual(new Set(stemIds));
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items).toEqual([]);
    await expectStatus(await request(`/${upload.id}/playback`, {}, memberToken), 404);

    const recording = await readJson<Recording>(await finalize(upload.id));
    expect(recording).toMatchObject({ id: upload.id, title: input.title, artist: input.artist, version: input.version });
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items).toEqual([recording]);

    const result = await playback(recording.id);
    expect(result.manifest).toMatchObject({ schemaVersion: 1, recordingId: recording.id, recordingVersion: input.version, model: input.model });
    expect(result.manifest.stems).toHaveLength(stems.length);
    expect(result.manifest.stems).toEqual(expect.arrayContaining(input.stems.map((stem) => expect.objectContaining(stem))));
    expect(result.tracks).toHaveLength(stems.length);
    expect(result.expiresAt).toBe(clock + 120_000);
    expect(new Set(result.tracks.map(({ id }) => id))).toEqual(new Set(stemIds));
    for (const track of result.tracks) {
      expect(track.url).toMatch(new RegExp(`^/${recording.id}/stems/${track.id}\\?ticket=`));
      const response = await request(track.url, {}, memberToken);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('audio/wav');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(stems.find(({ id }) => id === track.id)?.bytes);
    }
    clock = result.expiresAt;
    await expectStatus(await request(result.tracks[0].url, {}, memberToken), 403);
  });

  it('requires confirmation and admin rights and keeps incomplete uploads out of the catalog', async () => {
    const input = uploadInput();
    await expectStatus(await request('/uploads', jsonRequest('POST', input), null), 401);
    await expectStatus(await request('/uploads', jsonRequest('POST', input), memberToken), 403);
    await expectStatus(await reserve({ ...input, confirmed: false }), 400);

    const upload = await readJson<Upload>(await reserve(input));
    await expectStatus(await request(`/uploads/${upload.id}`, {}, memberToken), 403);
    await expectStatus(await finalize(upload.id), 409);
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items).toEqual([]);
  });

  it('converges on one reservation and one publication under concurrent requests', async () => {
    const input = uploadInput();
    const responses = await Promise.all([reserve(input), reserve(input)]);
    const reservations = await Promise.all(responses.map((response) => readJson<Upload>(response)));
    const [{ id }] = reservations;
    expect(reservations.map((reservation) => reservation.id)).toEqual([id, id]);

    const uploads = await Promise.all(stems.map((stem) => putStem(id, stem.id, stem.bytes)));
    await Promise.all(uploads.map((response) => readJson<Upload>(response)));
    const status = await readJson<Upload>(await request(`/uploads/${id}`));
    expect(status.uploadedStemIds).toHaveLength(stems.length);
    expect(new Set(status.uploadedStemIds)).toEqual(new Set(stemIds));

    const finalizations = await Promise.all([finalize(id), finalize(id)]);
    const published = await Promise.all(finalizations.map((response) => readJson<Recording>(response)));
    expect(published[0]).toEqual(published[1]);
    expect((await readJson<Catalog>(await request('/'))).items.map((recording) => recording.id)).toEqual([id]);
  });

  it('replays an identical reservation and stem, and rejects conflicting metadata or bytes', async () => {
    const input = uploadInput();
    const upload = await readJson<Upload>(await reserve(input));
    const [stem] = stems;
    const firstPut = await readJson<Upload>(await putStem(upload.id, stem.id, stem.bytes));
    expect(await readJson<Upload>(await reserve(input))).toEqual(firstPut);
    expect(await readJson<Upload>(await putStem(upload.id, stem.id, stem.bytes))).toEqual(firstPut);
    await expectStatus(await reserve({ ...input, title: 'Different title' }), 409);

    const conflicting = Buffer.from(stem.bytes);
    conflicting.writeInt16LE(500, 44);
    await expectStatus(await putStem(upload.id, stem.id, conflicting), 422);
    expect(await readJson<Upload>(await request(`/uploads/${upload.id}`))).toEqual(firstPut);
  });

  it('refuses to publish a stem written after the uploading admin loses write access', async () => {
    const upload = await readJson<Upload>(await reserve());
    const [lastStem, ...otherStems] = stems;
    for (const { id, bytes } of otherStems) {
      await readJson<Upload>(await putStem(upload.id, id, bytes));
    }

    const membership = db.collection('ministry_members').doc(memberDocumentId);
    await membership.update({ role: 'admin' });
    const storageGate = new EventEmitter();
    const enteredStorage = once(storageGate, 'put');
    const continuePut = once(storageGate, 'continue');
    const originalPut = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
      storageGate.emit('put');
      await continuePut;
      await originalPut(...args);
    });

    const pending = putStem(upload.id, lastStem.id, lastStem.bytes, memberToken);
    try {
      await Promise.race([enteredStorage, pending.then(({ status }) => {
        throw new Error(`Upload ended before reaching simulated storage (HTTP ${status})`);
      })]);
      await membership.update({ role: 'member' });
    } finally {
      storageGate.emit('continue');
    }
    await expectStatus(await pending, 403);
    await expect(access(storedStemPath(upload.id, lastStem.id))).resolves.toBeUndefined();

    const unacknowledged = await readJson<Upload>(await request(`/uploads/${upload.id}`));
    expect(new Set(unacknowledged.uploadedStemIds)).toEqual(new Set(otherStems.map(({ id }) => id)));
    await expectStatus(await finalize(upload.id), 409);
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items).toEqual([]);

    const acknowledged = await readJson<Upload>(await putStem(upload.id, lastStem.id, lastStem.bytes));
    expect(new Set(acknowledged.uploadedStemIds)).toEqual(new Set(stemIds));
    expect(await readJson<Recording>(await finalize(upload.id))).toMatchObject({ id: upload.id, status: 'published' });
  });

  it('rejects resource IDs through the wrong tenant even for an admin of both tenants', async () => {
    const recording = await publish();
    const missingId = createHash('sha256').update(randomUUID()).digest('hex');
    const response = await request(`/${recording.id}/playback`, {}, adminToken, otherMinistryId);
    const missing = await request(`/${missingId}/playback`, {}, adminToken, otherMinistryId);
    expect(response.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await response.json()).toEqual(await missing.json());
    await expectStatus(await request(`/uploads/${recording.id}`, {}, adminToken, otherMinistryId), 404);
    const update = { title: 'Cross-tenant edit', artist: recording.artist, version: recording.version };
    await expectStatus(await request(`/${recording.id}`, jsonRequest('PATCH', update), adminToken, otherMinistryId), 404);
    await expectStatus(await request(`/${recording.id}/archive`, { method: 'POST' }, adminToken, otherMinistryId), 404);
    const adminPlayback = await readJson<Playback>(await request(`/${recording.id}/playback`));
    await expectStatus(await request(adminPlayback.tracks[0].url, {}, adminToken, otherMinistryId), 403);
    expect((await readJson<Catalog>(await request('/', {}, adminToken, otherMinistryId))).items).toEqual([]);
    expect((await readJson<Catalog>(await request('/'))).items).toEqual([recording]);
  });

  it('revokes playback and outstanding stem URLs immediately when the member is removed', async () => {
    const recording = await publish();
    const { tracks } = await playback(recording.id);
    const [track] = tracks;
    const before = await request(track.url, {}, memberToken);
    expect(before.status).toBe(200);
    await before.arrayBuffer();
    await expectStatus(await request(track.url, {}, null), 401);
    await expectStatus(await request(track.url, {}, adminToken), 403);
    const otherStemUrl = track.url.replace(`/stems/${track.id}?`, `/stems/${tracks[1].id}?`);
    await expectStatus(await request(otherStemUrl, {}, memberToken), 403);

    await db.collection('ministry_members').doc(memberDocumentId).update({ status: 'removed' });
    await expectStatus(await request(`/${recording.id}/playback`, {}, memberToken), 403);
    await expectStatus(await request(track.url, {}, memberToken), 403);
  });

  it('keeps a failed publication invisible and can finalize it again after storage recovers', async () => {
    const upload = await stage();
    vi.spyOn(storage, 'verify').mockRejectedValueOnce(new Error('Simulated storage verification failure'));
    await expectStatus(await finalize(upload.id), 500);
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items).toEqual([]);
    await expectStatus(await request(`/${upload.id}/playback`, {}, memberToken), 404);

    const recovered = await readJson<Recording>(await finalize(upload.id));
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items).toEqual([recovered]);
    expect((await playback(recovered.id)).tracks).toHaveLength(stems.length);
  });

  it('rejects tampered stored bytes during finalize and during authorized streaming', async () => {
    const [stem] = stems;
    const changed = Buffer.from(stem.bytes);
    changed.writeInt16LE(500, 44);
    const upload = await stage();
    await writeFile(storedStemPath(upload.id, stem.id), changed);
    await expectStatus(await finalize(upload.id), 409);
    expect((await readJson<Catalog>(await request('/'))).items).toEqual([]);

    const recording = await publish();
    const { tracks } = await playback(recording.id);
    const trackUrl = tracks.find(({ id }) => id === stem.id)?.url;
    assert.ok(trackUrl);
    await writeFile(storedStemPath(recording.id, stem.id), changed);
    await expectStatus(await request(trackUrl, {}, memberToken), 409);
  });

  it('paginates and filters the catalog, edits metadata, and archives without exposing playback', async () => {
    const alpha = await publish(uploadInput('Alpha recording'));
    const beta = await publish(uploadInput('Beta recording'));
    const first = await readJson<Catalog>(await request('/?limit=1', {}, memberToken));
    expect(first.items).toHaveLength(1);
    assert.ok(first.nextCursor);
    const second = await readJson<Catalog>(await request(`/?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`, {}, memberToken));
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id))).toEqual(new Set([alpha.id, beta.id]));
    expect((await readJson<Catalog>(await request('/?q=Alpha', {}, memberToken))).items.map(({ id }) => id)).toEqual([alpha.id]);

    const updates = jsonRequest('PATCH', { title: 'Updated recording', artist: alpha.artist, version: 'Remaster' });
    await expectStatus(await request(`/${alpha.id}`, updates, memberToken), 403);
    const updated = await readJson<Recording>(await request(`/${alpha.id}`, updates));
    expect(updated).toMatchObject({ id: alpha.id, title: 'Updated recording', artist: alpha.artist, version: 'Remaster' });
    const { tracks, manifest } = await playback(alpha.id);
    expect(manifest.recordingVersion).toBe(alpha.version);
    await readJson<Recording>(await request(`/${alpha.id}/archive`, { method: 'POST' }));
    expect((await readJson<Catalog>(await request('/', {}, memberToken))).items.map(({ id }) => id)).toEqual([beta.id]);
    await expectStatus(await request(`/${alpha.id}/playback`, {}, memberToken), 404);
    await expectStatus(await request(tracks[0].url, {}, memberToken), 404);
  });

  it('cleans expired partial uploads once under concurrent requests and preserves published recordings', async () => {
    const recording = await publish();
    const upload = await readJson<Upload>(await reserve());
    const [stem] = stems;
    await readJson<Upload>(await putStem(upload.id, stem.id, stem.bytes));
    const path = storedStemPath(upload.id, stem.id);
    await expect(access(path)).resolves.toBeUndefined();

    expect(upload.expiresAt).toBe(clock + 24 * 60 * 60 * 1000);
    clock = upload.expiresAt + 1;
    await expectStatus(await request('/uploads/cleanup', { method: 'POST' }, memberToken), 403);
    const cleanup = async () => readJson<{ cleaned: number }>(await request('/uploads/cleanup', { method: 'POST' }));
    const remove = vi.spyOn(storage, 'remove');
    const results = await Promise.all([cleanup(), cleanup()]);
    expect(results.map(({ cleaned }) => cleaned).sort()).toEqual([0, 1]);
    expect(remove).toHaveBeenCalledTimes(stems.length);
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectStatus(await putStem(upload.id, stem.id, stem.bytes), 409);
    await expectStatus(await finalize(upload.id), 409);
    expect(await cleanup()).toEqual({ cleaned: 0 });
    expect((await playback(recording.id)).tracks).toHaveLength(stems.length);
  });
});
