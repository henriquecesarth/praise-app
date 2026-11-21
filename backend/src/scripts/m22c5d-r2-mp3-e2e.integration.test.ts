// M22-C.5D-C0 — the live R2 scenarios, proven offline: the real service, the real R2 adapter (both configurations), the
// real command guard and the Firestore Emulator, against an in-memory bucket. The only things replaced are the S3
// transport and the browser's signed PUT/GET. Nothing here reaches R2 or production Firebase.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODEC_PROFILES } from '../features/ministry_audio/audio-codec';
import { db } from '../lib/firebase';
import { errorHandler } from '../middleware/error-handler';
import { createMinistryAudioRouter } from '../features/ministry_audio/ministry-audio.routes';
import type { Mp3StemManifest } from '../features/ministry_audio/mp3-stream-validator';
import { R2StemStorage } from '../features/ministry_audio/r2-storage';
import { UserRepository } from '../repositories/UserRepository';
import {
  cleanupJournal, CommandGuard, EXPECTED_STEPS, MODES, ministryIds, parseJournal, RANGE_PART_BYTES, type Journal, type ModeTag,
} from './m22c5d-r2-mp3-e2e-core';
import { runMp3Scenarios, type ScenarioEnv, type Signed } from './m22c5d-r2-mp3-e2e-scenarios';
import { fakeR2, providerError } from './m22c5d-fake-r2';

const BUCKET = 'louvaio-ministry-audio-dev';
const fixtures = join(__dirname, '../../../shared/fixtures/ministry-audio-mp3-v1');
const cases = JSON.parse(readFileSync(join(fixtures, 'real-encoder-cases.json'), 'utf8')) as { cases: Array<{ name: string; manifest: Mp3StemManifest; base64: string }> };
const valid = cases.cases.find((c) => c.name === 'valid-44100-12000')!;
const fixture = { bytes: Buffer.from(valid.base64, 'base64'), manifest: valid.manifest };

describe.each(Object.keys(MODES) as ModeTag[])('R2 MP3 v2 homologation scenarios, offline (%s)', (mode) => {
  const users = new UserRepository();
  const legacy = {
    put: vi.fn().mockRejectedValue(new Error('Unexpected proxy write')), verify: vi.fn().mockRejectedValue(new Error('Unexpected proxy verification')),
    open: vi.fn().mockRejectedValue(new Error('Unexpected proxy read')), remove: vi.fn().mockRejectedValue(new Error('Unexpected proxy deletion')),
  };
  const profile = CODEC_PROFILES.mp3_cbr256 as { serverByteValidation: boolean };
  const run = randomUUID();
  const ids = ministryIds(run);
  const ministries = { a: ids[mode], b: ids[`${mode}x` as 'sux' | 'rcx'] };
  const bucket = fakeR2();
  const guard = new CommandGuard(BUCKET, [ministries.a, ministries.b]);
  const journal: Journal = { format: 'louvaio.m22c5d-r2-journal', version: 1, runId: run, bucket: BUCKET, entries: [] };
  let server: Server;
  let origin: string;
  const tokens = { adminA: '', memberA: '', adminB: '' };

  beforeAll(async () => {
    profile.serverByteValidation = false;
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(guard.wrap(bucket.impl as never) as never);
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage: legacy,
      directStorage: new R2StemStorage({
        accountId: 'a'.repeat(32), bucket: BUCKET, accessKeyId: 'offline-key', secretAccessKey: 'offline-secret',
        promotion: MODES[mode].promotion, reader: MODES[mode].read, rangePartBytes: RANGE_PART_BYTES, rangeConcurrency: 3,
      }),
    }));
    app.use(errorHandler);
    const adminA = `admin-${randomUUID()}`, memberA = `member-${randomUUID()}`, adminB = `admin-${randomUUID()}`;
    tokens.adminA = users.generateAuthToken(adminA, 'a@example.test');
    tokens.memberA = users.generateAuthToken(memberA, 'm@example.test');
    tokens.adminB = users.generateAuthToken(adminB, 'b@example.test');
    const batch = db.batch();
    batch.set(db.collection('ministries').doc(ministries.a), { name: 'C0 A', owner_user_id: adminA });
    batch.set(db.collection('ministries').doc(ministries.b), { name: 'C0 B', owner_user_id: adminB });
    batch.set(db.collection('ministry_members').doc(`${ministries.a}_${memberA}`), { ministry_id: ministries.a, user_id: memberA, role: 'member', status: 'active' });
    await batch.commit();
  });
  afterAll(async () => {
    profile.serverByteValidation = false;
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); server.closeAllConnections(); });
  });

  const keyOf = (grant: Signed) => decodeURIComponent(new URL(grant.url).pathname.slice(`/${BUCKET}/`.length));

  const env = (): ScenarioEnv => ({
    mode, ministries, tokens, guard, journal, fixture,
    idempotencyKey: () => randomUUID(),
    setCodec: (open) => { profile.serverByteValidation = open; },
    api: (tenant, path, method, token, body) => fetch(`${origin}/api/v1/ministries/${tenant}/audio-library${path}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    }),
    // The browser's signed PUT: create-only, with the media type the grant demands.
    put: async (grant, bytes) => {
      const key = keyOf(grant);
      if (grant.headers['content-type'] !== 'audio/mpeg' || grant.headers['if-none-match'] !== '*') return 403;
      if (bucket.objects.has(key)) return 412;
      bucket.store(key, bytes, grant.headers['content-type']);
      return 200;
    },
    get: async (grant) => {
      const object = bucket.objects.get(keyOf(grant));
      if (!object || grant.headers['if-match'] !== object.etag) return { status: object ? 412 : 404, contentType: null, bytes: Buffer.alloc(0) };
      return { status: 200, contentType: object.contentType, bytes: object.bytes };
    },
    doc: async (tenant, id) => (await db.collection('ministries').doc(tenant).collection('audio_recordings').doc(id).get()).data(),
  });

  it('passes every scenario, with the command guard active and the gate closed afterwards', { timeout: 120_000 }, async () => {
    const report = await runMp3Scenarios(env());
    expect(report.failed, JSON.stringify(report.failed)).toEqual([]);
    expect(report.steps.length).toBe(EXPECTED_STEPS[mode]);
    expect(profile.serverByteValidation).toBe(false);
    expect(guard.counters.commands).toBeGreaterThan(0);
    expect(guard.counters.commands).toBeLessThan(700);
  });

  it('cleans every journaled key and proves the bucket is empty, using only guarded exact-key commands', async () => {
    expect(journal.entries.length).toBeGreaterThan(0);
    const reread = parseJournal(JSON.stringify(journal), BUCKET);
    const client = new S3Client({ region: 'auto' });
    const outcome = await cleanupJournal(reread,
      async (key) => { await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); },
      async (key) => {
        try { await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
        catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
      });
    expect(outcome).toMatchObject({ stillPresent: 0, failed: 0 });
    expect(outcome.removed).toBe(outcome.attempted);
    expect(bucket.objects.size).toBe(0);
  });
});

describe('guard in the live path', () => {
  it('turns a key outside the run into a refusal that the adapter reports as a storage failure, not as data', async () => {
    const guard = new CommandGuard(BUCKET, [ministryIds(randomUUID()).su]);
    const bucket = fakeR2();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(guard.wrap(bucket.impl as never) as never);
    const storage = new R2StemStorage({ accountId: 'a'.repeat(32), bucket: BUCKET, accessKeyId: 'k', secretAccessKey: 's' });
    const stray = `objects/ministry-audio/m22c-r2-${randomUUID()}/${'a'.repeat(64)}/vocals.wav`;
    await expect(storage.remove(stray)).rejects.toMatchObject({ statusCode: expect.any(Number) });
    expect(guard.counters.commands).toBe(0);
    expect(providerError(404, 'x')).toBeInstanceOf(Error);
    vi.restoreAllMocks();
  });
});
