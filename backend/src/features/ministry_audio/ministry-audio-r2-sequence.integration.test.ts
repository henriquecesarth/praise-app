import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException,
} from '@aws-sdk/client-s3';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebase';
import { errorHandler } from '../../middleware/error-handler';
import { UserRepository } from '../../repositories/UserRepository';
import { createMinistryAudioRouter } from './ministry-audio.routes';
import { STEM_IDS, type StemId, type StemManifest } from './ministry-audio.schema';
import { R2StemStorage } from './r2-storage';
import type { StemStorage } from './storage';

// The exact sequence of the M22-C.4 live scenario 7, run offline: real service, real Firestore Emulator, real R2 adapter in
// ranged + copy mode, and an in-memory bucket that behaves like R2 (conditional GET/COPY, ranged GET, 404/412).
const PART = 1_000;
const FRAMES = 600; // 2 444 bytes: three ranged parts
const T0 = Date.UTC(2026, 10, 19, 12);

function wav(seed: number): Buffer {
  const bytes = Buffer.alloc(44 + FRAMES * 4);
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
  bytes.writeUInt32LE(FRAMES * 4, 40);
  for (let i = 0; i < FRAMES; i += 1) bytes.writeInt16LE((seed * 31 + i) % 2_000, 44 + i * 4);
  return bytes;
}

const content = STEM_IDS.map((id, index) => {
  const bytes = wav(index + 1);
  const manifest: StemManifest = {
    id, codec: 'pcm_s16le', sampleRate: 8_000, channels: 2, frames: FRAMES, durationSeconds: FRAMES / 8_000,
    sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { id, bytes, manifest };
});
const of = (id: StemId) => content.find((stem) => stem.id === id)!;
const swapped = wav(99);

interface Stored { bytes: Buffer; etag: string; modified: Date; contentType: string; cacheControl: string }
const md5 = (bytes: Buffer) => `"${createHash('md5').update(bytes).digest('hex')}"`;

function providerError(status: number, name: string): Error {
  return new S3ServiceException({ name, $fault: status >= 500 ? 'server' : 'client', $metadata: { httpStatusCode: status } });
}

function fakeBucket() {
  const objects = new Map<string, Stored>();
  const log: string[] = [];
  const state = { clock: T0, failCopies: 0 };
  const put = (key: string, bytes: Buffer) => {
    objects.set(key, { bytes, etag: md5(bytes), modified: new Date(state.clock), contentType: 'audio/wav', cacheControl: 'private, no-store' });
  };
  const facts = (o: Stored) => ({
    ETag: o.etag, ContentLength: o.bytes.length, ContentType: o.contentType, CacheControl: o.cacheControl, LastModified: o.modified,
  });
  const impl = async (command: HeadObjectCommand | GetObjectCommand | PutObjectCommand | CopyObjectCommand | DeleteObjectCommand) => {
    const input = command.input as { Key: string; Range?: string; IfMatch?: string; IfNoneMatch?: string };
    const place = input.Key.startsWith('staging/') ? 'staging' : 'final';
    log.push(`${command.constructor.name}${input.Range ? ' ranged' : ''} ${place}`);
    const object = objects.get(input.Key);
    if (command instanceof HeadObjectCommand) {
      if (!object) throw providerError(404, 'NotFound');
      if (input.IfMatch && input.IfMatch !== object.etag) throw providerError(412, 'PreconditionFailed');
      return facts(object);
    }
    if (command instanceof GetObjectCommand) {
      if (!object) throw providerError(404, 'NoSuchKey');
      if (input.IfMatch && input.IfMatch !== object.etag) throw providerError(412, 'PreconditionFailed');
      if (!input.Range) return { ...facts(object), Body: Readable.from([object.bytes]) };
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(input.Range)!;
      const part = Buffer.from(object.bytes.subarray(Number(from), Number(to) + 1));
      return { ETag: object.etag, ContentLength: part.length, ContentRange: `bytes ${from}-${to}/${object.bytes.length}`, Body: Readable.from([part]) };
    }
    if (command instanceof PutObjectCommand) {
      if (input.IfNoneMatch === '*' && object) throw providerError(412, 'PreconditionFailed');
      const bytes = await buffer(command.input.Body as Readable);
      put(input.Key, bytes);
      return { ETag: md5(bytes) };
    }
    if (command instanceof CopyObjectCommand) {
      const source = objects.get(command.input.CopySource!.slice(command.input.Bucket!.length + 1));
      if (state.failCopies > 0) {
        state.failCopies -= 1;
        log.pop(); // like the live server's injection, the copy never reaches the bucket
        throw new Error('Injected copy failure.');
      }
      if (!source) throw providerError(404, 'NoSuchKey');
      if (command.input.CopySourceIfMatch !== source.etag || object) throw providerError(412, 'PreconditionFailed');
      objects.set(input.Key, { ...source, contentType: command.input.ContentType!, cacheControl: command.input.CacheControl!, modified: new Date(state.clock) });
      return { CopyObjectResult: { ETag: source.etag } };
    }
    objects.delete(input.Key);
    return {};
  };
  return { objects, log, state, put, impl };
}

describe('M22-C.4 scenario 7 sequence: ranged + copy with persisted verification (offline)', { timeout: 60_000 }, () => {
  const users = new UserRepository();
  const legacy: StemStorage = {
    put: vi.fn().mockRejectedValue(new Error('Unexpected proxy write')),
    verify: vi.fn().mockRejectedValue(new Error('Unexpected proxy verification')),
    open: vi.fn().mockRejectedValue(new Error('Unexpected proxy read')),
    remove: vi.fn().mockRejectedValue(new Error('Unexpected proxy deletion')),
  };
  let server: Server;
  let origin: string;
  let bucket: ReturnType<typeof fakeBucket>;
  let ministryId: string;
  let token: string;

  beforeAll(async () => {
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage: legacy,
      directStorage: new R2StemStorage({
        accountId: 'a'.repeat(32), bucket: 'louvaio-ministry-audio-dev', accessKeyId: 'test-key', secretAccessKey: 'test-secret',
        promotion: 'copy', reader: 'ranged', rangePartBytes: PART, rangeConcurrency: 3,
      }),
    }));
    app.use(errorHandler);
  });

  beforeEach(async () => {
    bucket = fakeBucket();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(bucket.impl as never);
    ministryId = `audio-r2-seq-${randomUUID()}`;
    const adminId = `admin-${randomUUID()}`;
    token = users.generateAuthToken(adminId, 'admin@example.test');
    await db.collection('ministries').doc(ministryId).set({ name: 'R2 sequence', owner_user_id: adminId });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });

  const api = (path: string, method = 'GET', body?: unknown) => fetch(`${origin}/api/v1/ministries/${ministryId}/audio-library${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = async <T>(response: Response): Promise<{ status: number; body: T; text: string }> => {
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as T };
  };
  const stagingKey = (id: string, stem: StemId, attempt: number) => `staging/ministry-audio/${ministryId}/${id}/${stem}/${attempt}.wav`;
  const finalKey = (id: string, stem: StemId) => `objects/ministry-audio/${ministryId}/${id}/${stem}.wav`;
  const grant = async (id: string, stem: StemId) => {
    const result = await json<{ attempt: number }>(await api(`/uploads/${id}/stems/${stem}/upload-url`, 'POST'));
    expect(result.status, result.text).toBe(200);
    return result.body.attempt;
  };
  const complete = async (id: string, stem: StemId, attempt: number) => json<{ uploadedStemIds: StemId[] }>(
    await api(`/uploads/${id}/stems/${stem}/complete`, 'POST', { attempt }),
  );
  const recording = async (id: string) => (await db.collection('ministries').doc(ministryId).collection('audio_recordings').doc(id).get()).data()!;
  const count = (from: number, pattern: RegExp) => bucket.log.slice(from).filter((entry) => pattern.test(entry)).length;

  it('runs vocals, drums swap, bass re-upload, the remaining stems and an idempotent publication', async () => {
    const reserved = await json<{ id: string }>(await api('/uploads', 'POST', {
      idempotencyKey: randomUUID(), confirmed: true, title: 'Retomada', artist: 'Teste', version: 'Ensaio',
      model: { id: 'htdemucs_6s', version: 'fixture' }, stems: content.map(({ manifest }) => manifest),
    }));
    expect(reserved.status, reserved.text).toBe(200);
    const { id } = reserved.body;

    // 1. vocals: full ranged verification, failure before the copy, then a resume that reads nothing from staging.
    const vocals = await grant(id, 'vocals');
    bucket.put(stagingKey(id, 'vocals', vocals), of('vocals').bytes);
    bucket.state.failCopies = 1;
    let mark = bucket.log.length;
    const first = await complete(id, 'vocals', vocals);
    expect(first.status).toBe(503);
    expect(count(mark, /GetObjectCommand ranged staging/)).toBe(3);
    expect(count(mark, /CopyObjectCommand/)).toBe(0);
    expect(first.text).not.toMatch(/etag|verified|receipt|staging\//i);
    const stored = (await recording(id)).directAttempts.vocals;
    expect(stored).toMatchObject({ number: vocals });
    expect(stored.verified.etag).toBe(md5(of('vocals').bytes));
    expect(stored.receipt).toBeUndefined();

    mark = bucket.log.length;
    const second = await complete(id, 'vocals', vocals);
    expect(second.status, second.text).toBe(200);
    expect(count(mark, /GetObjectCommand/)).toBe(0);
    expect(count(mark, /CopyObjectCommand/)).toBe(1);
    const sealed = (await recording(id)).directAttempts.vocals;
    expect(sealed.receipt.etag).toBe(stored.verified.etag);
    expect(sealed.verified).toBeUndefined();
    mark = bucket.log.length;
    expect((await complete(id, 'vocals', vocals)).status).toBe(200);
    expect(bucket.log.length).toBe(mark);

    // 2. drums: staging replaced after the verification (new bytes, later time), so the old verification is not reused.
    const drums = await grant(id, 'drums');
    bucket.put(stagingKey(id, 'drums', drums), of('drums').bytes);
    bucket.state.failCopies = 1;
    expect((await complete(id, 'drums', drums)).status).toBe(503);
    expect((await recording(id)).directAttempts.drums.verified).toBeDefined();
    bucket.state.clock += 2_100;
    bucket.objects.delete(stagingKey(id, 'drums', drums));
    bucket.put(stagingKey(id, 'drums', drums), swapped);
    mark = bucket.log.length;
    const swap = await complete(id, 'drums', drums);
    expect(swap.status).toBe(422);
    expect(count(mark, /GetObjectCommand ranged staging/)).toBe(3);
    expect(count(mark, /CopyObjectCommand/)).toBe(0);
    expect((await recording(id)).directAttempts.drums).toEqual({ number: drums, invalid: true });
    const drumsAgain = await grant(id, 'drums');
    expect(drumsAgain).toBe(drums + 1);
    bucket.put(stagingKey(id, 'drums', drumsAgain), of('drums').bytes);
    const drumsDone = await complete(id, 'drums', drumsAgain);
    expect(drumsDone.status, drumsDone.text).toBe(200);

    // 3. bass: same bytes uploaded again later (same ETag, new last-modified time).
    const bass = await grant(id, 'bass');
    bucket.put(stagingKey(id, 'bass', bass), of('bass').bytes);
    bucket.state.failCopies = 1;
    expect((await complete(id, 'bass', bass)).status).toBe(503);
    const firstVerification = (await recording(id)).directAttempts.bass.verified;
    bucket.state.clock += 2_100;
    bucket.objects.delete(stagingKey(id, 'bass', bass));
    bucket.put(stagingKey(id, 'bass', bass), of('bass').bytes);
    mark = bucket.log.length;
    const bassDone = await complete(id, 'bass', bass);
    expect(bassDone.status, bassDone.text).toBe(200);
    expect(count(mark, /GetObjectCommand ranged staging/)).toBe(3);
    expect((await recording(id)).directAttempts.bass.receipt.etag).toBe(firstVerification.etag);

    // 4. the remaining stems, each verified and promoted in a single request, then an idempotent publication.
    for (const stem of ['guitar', 'piano', 'other'] as const) {
      const attempt = await grant(id, stem);
      bucket.put(stagingKey(id, stem, attempt), of(stem).bytes);
      const done = await complete(id, stem, attempt);
      expect(done.status, `${stem}: ${done.text}`).toBe(200);
    }
    const published = await json<{ id: string; status: string }>(await api(`/uploads/${id}/finalize`, 'POST'));
    expect(published.status, published.text).toBe(200);
    expect(published.body).toMatchObject({ id, status: 'published' });
    const again = await json<{ id: string; status: string }>(await api(`/uploads/${id}/finalize`, 'POST'));
    expect(again.body).toEqual(published.body);

    const final = (await recording(id)).directAttempts;
    for (const stem of STEM_IDS) {
      expect(final[stem].receipt.etag, stem).toBe(md5(of(stem).bytes));
      expect(final[stem].verified, stem).toBeUndefined();
      expect(bucket.objects.get(finalKey(id, stem))?.bytes.equals(of(stem).bytes)).toBe(true);
    }
  });
});
