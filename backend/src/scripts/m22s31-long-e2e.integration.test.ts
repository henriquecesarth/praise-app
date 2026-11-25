// M22-S3.1 — the LONG live scenario, proven offline: the real service, the real R2 adapter (su mode), the real long command guard
// and ledger and the Firestore Emulator, against an in-memory bucket. Replaced: only the S3 transport and the browser's signed
// PUT/GET (which also honours URL expiry on a virtual clock). Needs the synthetic ~298 s fixtures: M22S31_LONG_DIR=<dir>.
// Nothing here reaches R2 or production Firebase.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CODEC_PROFILES } from '../features/ministry_audio/audio-codec';
import { db } from '../lib/firebase';
import { errorHandler } from '../middleware/error-handler';
import { createMinistryAudioRouter } from '../features/ministry_audio/ministry-audio.routes';
import { R2StemStorage } from '../features/ministry_audio/r2-storage';
import { UserRepository } from '../repositories/UserRepository';
import { createJournalFile, GuardViolation, ministryIds, updateJournalFile, type Journal } from './m22c5d-r2-mp3-e2e-core';
import { fakeR2 } from './m22c5d-fake-r2';
import {
  LONG_BUDGETS, LONG_CLEANUP_LIMITS, LONG_LIMITS, LongCommandGuard, MemorySampler, MIB, TransferLedger, ledgerSignedRequest, loadLongFixtures, stemSizes,
} from './m22s31-long-core';
import { EXPECTED_LONG_STEPS, runLongScenario, type LongEnv } from './m22s31-long-scenarios';

const BUCKET = 'louvaio-ministry-audio-dev';
const longDir = process.env.M22S31_LONG_DIR;

describe('long run guard and ledger', () => {
  const ministries = [`m22c5d-r2-${randomUUID()}-su`];
  const sizes = new Map([['vocals', 100]]);
  const dispatch = (guard: LongCommandGuard, command: unknown) => guard.dispatch(async () => ({}) as never, undefined, command as never, [] as never);
  const key = `objects/ministry-audio/${ministries[0]}/${'a'.repeat(64)}/vocals.mp3`;

  it('charges SDK bodies before they move and refuses a transfer beyond the ceiling', async () => {
    const ledger = new TransferLedger(250);
    const guard = new LongCommandGuard(BUCKET, ministries, ledger, sizes);
    await dispatch(guard, new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    await dispatch(guard, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentLength: 100 }));
    expect(ledger.total).toBe(200);
    expect(() => dispatch(guard, new GetObjectCommand({ Bucket: BUCKET, Key: key }))).toThrow(GuardViolation);
    expect(ledger.total).toBe(200);
  });

  it('never allows a ranged read, a copy or an object whose size it does not know', () => {
    const guard = new LongCommandGuard(BUCKET, ministries, new TransferLedger(), sizes);
    expect(() => dispatch(guard, new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: 'bytes=0-4095' }))).toThrow(GuardViolation);
    expect(() => dispatch(guard, { constructor: { name: 'CopyObjectCommand' }, input: { Bucket: BUCKET, Key: key, CopySource: `${BUCKET}/${key}` } })).toThrow(GuardViolation);
    expect(() => dispatch(guard, new GetObjectCommand({ Bucket: BUCKET, Key: key.replace('vocals', 'drums') }))).toThrow(GuardViolation);
    expect(() => dispatch(guard, new GetObjectCommand({ Bucket: BUCKET, Key: `objects/ministry-audio/other/${'a'.repeat(64)}/vocals.mp3` }))).toThrow(GuardViolation);
  });

  it('keeps the object, command and run ceilings of the authorization and does not touch the original harness limits', () => {
    expect(LONG_BUDGETS).toMatchObject({ recordings: 1, stems: 6, seconds: 300, objectBytes: 10 * MIB, originalBytes: 60 * MIB, transferBytes: 300 * MIB });
    expect(LONG_LIMITS.maxCommands + LONG_CLEANUP_LIMITS.maxCommands).toBeLessThanOrEqual(300);
    expect(LONG_LIMITS.maxRunMs).toBeLessThanOrEqual(15 * 60_000);
    expect(LONG_LIMITS.maxObjectBytes).toBe(10 * MIB);
  });

  it('a signed GET needs room for a whole object, a signed PUT is charged first', async () => {
    const ledger = new TransferLedger(1000);
    const target = { accountId: 'a'.repeat(32), bucket: BUCKET, ministries };
    await expect(ledgerSignedRequest({ url: 'https://example.invalid/x', headers: {} }, 'GET', undefined, target, ledger, 2000)).rejects.toThrow(GuardViolation);
    await expect(ledgerSignedRequest({ url: 'https://example.invalid/x', headers: {} }, 'PUT', Buffer.alloc(2000), target, ledger, 0)).rejects.toThrow(GuardViolation);
    expect(ledger.total).toBe(0);
  });
});

describe.skipIf(!longDir || !existsSync(longDir))('long R2 homologation scenario, offline (su)', () => {
  let cleanup: () => Promise<void>;
  let ctx: { report: Awaited<ReturnType<typeof runLongScenario>>; ledger: TransferLedger; guard: LongCommandGuard; sampler: MemorySampler; profile: { serverByteValidation: boolean } };

  beforeAll(async () => {
    const fixtures = loadLongFixtures(longDir!);
    const users = new UserRepository();
    const profile = CODEC_PROFILES.mp3_cbr256 as { serverByteValidation: boolean };
    profile.serverByteValidation = false;
    const run = randomUUID();
    const ids = ministryIds(run);
    const ministries = { a: ids.su, b: ids.sux };
    const bucket = fakeR2();
    const ledger = new TransferLedger();
    const sampler = new MemorySampler();
    const guard = new LongCommandGuard(BUCKET, [ministries.a, ministries.b], ledger, stemSizes(fixtures));
    const journal: Journal = { format: 'louvaio.m22c5d-r2-journal', version: 1, runId: run, bucket: BUCKET, entries: [] };
    const dir = await mkdtemp(join(tmpdir(), 'm22s31-it-'));
    const journalPath = join(dir, 'run.journal.json');
    await createJournalFile(journalPath, journal);
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(guard.wrap(bucket.impl as never) as never);

    const app = express();
    const server: Server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app.use(express.json());
    const refuse = () => { throw new Error('proxy path is not used'); };
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage: { put: refuse, verify: refuse, open: refuse, remove: refuse } as never,
      directStorage: new R2StemStorage({ accountId: 'a'.repeat(32), bucket: BUCKET, accessKeyId: 'offline-key', secretAccessKey: 'offline-secret', promotion: 'upload', reader: 'stream' }),
    }));
    app.use(errorHandler);
    const adminA = `admin-${randomUUID()}`, memberA = `member-${randomUUID()}`, adminB = `admin-${randomUUID()}`;
    const tokens = { adminA: users.generateAuthToken(adminA, 'a@example.test'), memberA: users.generateAuthToken(memberA, 'm@example.test'), adminB: users.generateAuthToken(adminB, 'b@example.test') };
    const batch = db.batch();
    batch.set(db.collection('ministries').doc(ministries.a), { name: 'S31 A', owner_user_id: adminA });
    batch.set(db.collection('ministries').doc(ministries.b), { name: 'S31 B', owner_user_id: adminB });
    batch.set(db.collection('ministry_members').doc(`${ministries.a}_${memberA}`), { ministry_id: ministries.a, user_id: memberA, role: 'member', status: 'active' });
    await batch.commit();

    let offset = 0;
    const now = () => Date.now() + offset;
    const keyOf = (grant: { url: string }) => decodeURIComponent(new URL(grant.url).pathname.slice(`/${BUCKET}/`.length));
    // The virtual clock does not change the real signing second, so a URL's age is the virtual time since the API handed it out.
    const issuedAt = new Map<string, number>();
    const expired = (grant: { url: string }) => now() > (issuedAt.get(grant.url) ?? 0) + Number(new URL(grant.url).searchParams.get('X-Amz-Expires')) * 1000;
    const env: LongEnv = {
      ministries, tokens, guard, ledger, sampler, journal, fixtures, now, renewalMayRepeatUrl: true,
      idempotencyKey: () => randomUUID(),
      setCodec: (open) => { profile.serverByteValidation = open; },
      persistJournal: () => updateJournalFile(journalPath, journal),
      sleep: async (ms) => { offset += ms; },
      api: async (tenant, path, method, token, body) => {
        const response = await fetch(`${origin}/api/v1/ministries/${tenant}/audio-library${path}`, {
        method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000),
        });
        if (path.endsWith('/playback') && response.status === 200) {
          for (const track of ((await response.clone().json()) as { tracks: Array<{ url: string }> }).tracks) issuedAt.set(track.url, now());
        }
        return response;
      },
      put: async (grant, bytes) => {
        ledger.charge('clientPut', bytes.length);
        if (grant.headers['content-type'] !== 'audio/mpeg' || grant.headers['if-none-match'] !== '*') return 403;
        if (bucket.objects.has(keyOf(grant))) return 412;
        bucket.store(keyOf(grant), bytes, grant.headers['content-type']);
        return 200;
      },
      get: async (grant, expectedBytes) => {
        if (expired(grant)) return { status: 403, contentType: null, bytes: Buffer.alloc(0) };
        if (!ledger.canAfford(expectedBytes)) throw new GuardViolation('Transfer budget exceeded.');
        const object = bucket.objects.get(keyOf(grant));
        if (!object || grant.headers['if-match'] !== object.etag) return { status: object ? 412 : 404, contentType: null, bytes: Buffer.alloc(0) };
        ledger.charge('clientGet', object.bytes.length);
        return { status: 200, contentType: object.contentType, bytes: object.bytes };
      },
      doc: async (tenant, id) => (await db.collection('ministries').doc(tenant).collection('audio_recordings').doc(id).get()).data(),
    };
    ctx = { report: await runLongScenario(env), ledger, guard, sampler, profile };
    // Cleanup of exactly the journaled keys, as the live run does, with its own guard.
    const cleanupGuard = new LongCommandGuard(BUCKET, [ministries.a, ministries.b], new TransferLedger(), stemSizes(fixtures), Date.now, LONG_CLEANUP_LIMITS);
    guard.freeze();
    const keys = journal.entries.flatMap((e) => e.keys);
    for (const k of keys) {
      await cleanupGuard.dispatch(async () => bucket.impl(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }) as never) as never, undefined, new DeleteObjectCommand({ Bucket: BUCKET, Key: k }) as never, [] as never);
      await expect(cleanupGuard.dispatch(async () => bucket.impl(new HeadObjectCommand({ Bucket: BUCKET, Key: k }) as never) as never, undefined, new HeadObjectCommand({ Bucket: BUCKET, Key: k }) as never, [] as never)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    }
    expect(bucket.objects.size).toBe(0);
    cleanup = async () => {
      vi.restoreAllMocks();
      await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); server.closeAllConnections(); });
      await rm(dir, { recursive: true, force: true });
    };
  }, 600_000);
  afterAll(async () => { await cleanup?.(); });

  it('passes every step, fail-fast, with the exact step count and the gate closed afterwards', () => {
    expect(ctx.report.report.failed, JSON.stringify(ctx.report.report.failed)).toEqual([]);
    expect(ctx.report.report.steps.length).toBe(EXPECTED_LONG_STEPS);
    expect(ctx.profile.serverByteValidation).toBe(false);
  });

  it('stays within every ceiling and reports the real figures', () => {
    const c = ctx.guard.counters;
    console.log('M22S31 offline', JSON.stringify({
      commands: c, transferMb: Math.round(ctx.ledger.total / MIB * 10) / 10, byKind: ctx.ledger.byKind, memory: ctx.sampler.summary(),
      sealMs: ctx.report.measurements.sealMs, expiredStatus: ctx.report.measurements.expiredStatus, archivedStatus: ctx.report.measurements.archivedPlaybackStatus,
    }));
    expect(c.commands).toBeLessThanOrEqual(LONG_BUDGETS.runCommands);
    expect(ctx.ledger.total).toBeLessThanOrEqual(LONG_BUDGETS.transferBytes);
    expect(c.rangedGet).toBe(0);
    expect(c.copyAttempted).toBe(0);
    expect(c.objectsCreated).toBeLessThanOrEqual(12);
  });
});
