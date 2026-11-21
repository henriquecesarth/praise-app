// M22-C.5D-C0 — the live R2 scenarios, proven offline: the real service, the real R2 adapter (both configurations), the
// real command guard and the Firestore Emulator, against an in-memory bucket. The only things replaced are the S3
// transport and the browser's signed PUT/GET. Nothing here reaches R2 or production Firebase.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CODEC_PROFILES } from '../features/ministry_audio/audio-codec';
import { db } from '../lib/firebase';
import { errorHandler } from '../middleware/error-handler';
import { createMinistryAudioRouter } from '../features/ministry_audio/ministry-audio.routes';
import type { Mp3StemManifest } from '../features/ministry_audio/mp3-stream-validator';
import { R2StemStorage } from '../features/ministry_audio/r2-storage';
import { UserRepository } from '../repositories/UserRepository';
import {
  cleanupJournal, CommandGuard, createJournalFile, EXPECTED_STEPS, MODES, ministryIds, parseJournal, quiesceRun, RANGE_PART_BYTES, updateJournalFile, type Journal, type ModeTag,
} from './m22c5d-r2-mp3-e2e-core';
import { runMp3Scenarios, type ScenarioEnv, type Signed } from './m22c5d-r2-mp3-e2e-scenarios';
import { fakeR2, providerError } from './m22c5d-fake-r2';

const BUCKET = 'louvaio-ministry-audio-dev';
const fixtures = join(__dirname, '../../../shared/fixtures/ministry-audio-mp3-v1');
const cases = JSON.parse(readFileSync(join(fixtures, 'real-encoder-cases.json'), 'utf8')) as { cases: Array<{ name: string; manifest: Mp3StemManifest; base64: string }> };
const valid = cases.cases.find((c) => c.name === 'valid-44100-12000')!;
const fixture = { bytes: Buffer.from(valid.base64, 'base64'), manifest: valid.manifest };

type Tweak = (tenant: string, path: string, method: string, response: Response) => Response | undefined;

async function startHarness(mode: ModeTag) {
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
  const dir = await mkdtemp(join(tmpdir(), 'm22c5d-it-'));
  const journalPath = join(dir, 'run.journal.json');
  await createJournalFile(journalPath, journal);
  const calls: string[] = [];
  const done: string[] = [];
  const state = { tweak: undefined as Tweak | undefined, apiTimeoutMs: 20_000, pending: 0 };
  profile.serverByteValidation = false;
  const app = express();
  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  const tokens = {
    adminA: users.generateAuthToken(adminA, 'a@example.test'), memberA: users.generateAuthToken(memberA, 'm@example.test'),
    adminB: users.generateAuthToken(adminB, 'b@example.test'),
  };
  const batch = db.batch();
  batch.set(db.collection('ministries').doc(ministries.a), { name: 'C0 A', owner_user_id: adminA });
  batch.set(db.collection('ministries').doc(ministries.b), { name: 'C0 B', owner_user_id: adminB });
  batch.set(db.collection('ministry_members').doc(`${ministries.a}_${memberA}`), { ministry_id: ministries.a, user_id: memberA, role: 'member', status: 'active' });
  await batch.commit();

  const keyOf = (grant: Signed) => decodeURIComponent(new URL(grant.url).pathname.slice(`/${BUCKET}/`.length));
  const env: ScenarioEnv = {
    mode, ministries, tokens, guard, journal, fixture,
    idempotencyKey: () => randomUUID(),
    setCodec: (open) => { profile.serverByteValidation = open; },
    persistJournal: async () => { calls.push('journal'); await updateJournalFile(journalPath, journal); },
    api: async (tenant, path, method, token, body) => {
      const label = `${method} ${path.replace(/[a-f0-9]{64}/, ':id')}`;
      calls.push(label);
      state.pending += 1;
      try {
        const response = await fetch(`${origin}/api/v1/ministries/${tenant}/audio-library${path}`, {
          method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(state.apiTimeoutMs),
        });
        if (path.endsWith('/finalize')) await response.clone().arrayBuffer(); // the server has fully answered
        done.push(label);
        return state.tweak?.(tenant, path, method, response) ?? response;
      } finally {
        state.pending -= 1;
      }
    },
    // The browser's signed PUT: create-only, with the media type the grant demands.
    put: async (grant, bytes) => {
      calls.push('PUT signed');
      const key = keyOf(grant);
      if (grant.headers['content-type'] !== 'audio/mpeg' || grant.headers['if-none-match'] !== '*') return 403;
      if (bucket.objects.has(key)) return 412;
      bucket.store(key, bytes, grant.headers['content-type']);
      return 200;
    },
    get: async (grant) => {
      calls.push('GET signed');
      const object = bucket.objects.get(keyOf(grant));
      if (!object || grant.headers['if-match'] !== object.etag) return { status: object ? 412 : 404, contentType: null, bytes: Buffer.alloc(0) };
      return { status: 200, contentType: object.contentType, bytes: object.bytes };
    },
    doc: async (tenant, id) => (await db.collection('ministries').doc(tenant).collection('audio_recordings').doc(id).get()).data(),
  };
  return {
    env, guard, journal, journalPath, bucket, calls, done, profile, state,
    async close() {
      profile.serverByteValidation = false;
      await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); server.closeAllConnections(); });
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe.each(Object.keys(MODES) as ModeTag[])('R2 MP3 v2 homologation scenarios, offline (%s)', (mode) => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => {
    h = await startHarness(mode);
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(h.guard.wrap(h.bucket.impl as never) as never);
  });
  afterAll(async () => { vi.restoreAllMocks(); await h.close(); });

  it('passes every scenario with the exact step count, the guard active and the gate closed afterwards', { timeout: 120_000 }, async () => {
    const report = await runMp3Scenarios(h.env);
    expect(report.failed, JSON.stringify(report.failed)).toEqual([]);
    expect(report.steps.length).toBe(EXPECTED_STEPS[mode]);
    expect(h.profile.serverByteValidation).toBe(false);
    expect(h.guard.counters.commands).toBeGreaterThan(0);
    expect(h.guard.counters.commands).toBeLessThan(700);
  });

  it('journals every recording before its first upload URL and keeps a valid journal on disk', async () => {
    const onDisk = parseJournal(await readFile(h.journalPath, 'utf8'), BUCKET);
    expect(onDisk.entries.length).toBe(h.journal.entries.length);
    expect(onDisk.entries.length).toBeGreaterThan(0);
    for (const entry of h.journal.entries) {
      const first = h.calls.findIndex((c) => c === 'journal');
      expect(first).toBeGreaterThanOrEqual(0);
      expect(entry.keys).toHaveLength(24);
    }
    // Each reservation is followed by a journal write before any signed-URL request for the next recording.
    const reservations = h.calls.flatMap((c, i) => (c === 'POST /uploads' ? [i] : [])).slice(1); // [0] is the S0 gate probe
    for (const index of reservations) expect(h.calls[index + 1]).toBe('journal');
  });

  it('cleans every journaled key and proves the bucket is empty, using only guarded exact-key commands', async () => {
    const reread = parseJournal(await readFile(h.journalPath, 'utf8'), BUCKET);
    const client = new S3Client({ region: 'auto' });
    const outcome = await cleanupJournal(reread,
      async (key) => { await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); },
      async (key) => {
        try { await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
        catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
      });
    expect(outcome).toMatchObject({ stillPresent: 0, failed: 0 });
    expect(outcome.removed).toBe(outcome.attempted);
    expect(h.bucket.objects.size).toBe(0);
  });
});

// A failed mandatory check must stop every later operation, whatever the scenario it happens in.
describe.each(['su', 'rc'] as ModeTag[])('fail-fast (%s)', { timeout: 120_000 }, (mode) => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => {
    h = await startHarness(mode);
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(h.guard.wrap(h.bucket.impl as never) as never);
  });
  afterAll(async () => { vi.restoreAllMocks(); await h.close(); });
  afterEach(() => { h.state.tweak = undefined; });

  const run = async (tweak: Tweak) => {
    h.state.tweak = tweak;
    const callsBefore = h.calls.length;
    const commandsBefore = h.guard.counters.commands;
    const report = await runMp3Scenarios(h.env);
    h.state.tweak = undefined;
    return { report, calls: h.calls.slice(callsBefore), commands: h.guard.counters.commands - commandsBefore };
  };
  const wrong = () => new Response('{}', { status: 418 });

  it('stops at the very first check (the closed-gate probe): nothing else is attempted', async () => {
    const r = await run((_t, path, method) => (method === 'POST' && path === '/uploads' ? wrong() : undefined));
    expect(r.report.steps.map((s) => s.pass)).toEqual([false]);
    expect(r.calls).toHaveLength(1);
    expect(r.commands).toBe(0);
    expect(h.profile.serverByteValidation).toBe(false);
  });

  it('stops in the middle of S1: no later upload, no finalization, no S3/S4, and the codec is closed again', async () => {
    const journalBefore = h.journal.entries.length;
    // The second stem's completion fails: the loop must stop there instead of uploading the remaining four stems.
    let completes = 0;
    const r = await run((_t, path, method) => (method === 'POST' && path.endsWith('/complete') && ++completes === 2 ? wrong() : undefined));
    const last = r.report.steps.at(-1)!;
    expect(last).toMatchObject({ scenario: 'S1 flow', pass: false });
    expect(r.report.steps.slice(0, -1).every((s) => s.pass)).toBe(true);
    expect(r.report.steps.some((s) => s.scenario.startsWith('S4') || s.scenario.startsWith('S3') || s.scenario.startsWith('S2'))).toBe(false);
    expect(r.calls.some((c) => c.endsWith('/finalize') || c.includes('/playback'))).toBe(false);
    expect(r.calls.filter((c) => c === 'PUT signed')).toHaveLength(2); // the failing stem was the last upload attempted
    expect(h.journal.entries.length).toBe(journalBefore + 1); // exactly the one recording that was reserved
    expect(h.profile.serverByteValidation).toBe(false);
  });

  it('stops at the very last check: the step count is complete but nothing runs afterwards and cleanup still sees every key', async () => {
    const journalBefore = h.journal.entries.length;
    let playbacks = 0;
    // The last scenario's last check expects the member's playback to answer 404.
    const r = await run((_t, path, method) => (method === 'GET' && path.endsWith('/playback') && ++playbacks === 3 ? new Response('{}', { status: 200 }) : undefined));
    expect(r.report.steps.at(-1)).toMatchObject({ scenario: 'S3 malformed', pass: false });
    expect(r.report.steps.length).toBe(EXPECTED_STEPS[mode]);
    expect(r.report.failed).toHaveLength(1);
    const reread = parseJournal(await readFile(h.journalPath, 'utf8'), BUCKET);
    expect(reread.entries.length).toBe(h.journal.entries.length);
    expect(h.journal.entries.length).toBeGreaterThan(journalBefore);
    const client = new S3Client({ region: 'auto' });
    const outcome = await cleanupJournal(reread,
      async (key) => { await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); },
      async (key) => { try { await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; } catch { return false; } });
    expect(outcome).toMatchObject({ stillPresent: 0, failed: 0 });
    expect(h.bucket.objects.size).toBe(0);
  });

  it('one of three concurrent finalizations failing never leaves the others in flight', async () => {
    let finalizes = 0;
    h.state.tweak = (_t, path, method) => { if (method === 'POST' && path.endsWith('/finalize') && ++finalizes === 1) throw new Error('finalize failed'); return undefined; };
    const before = h.calls.length;
    const doneBefore = h.done.length;
    await expect(runMp3Scenarios(h.env)).rejects.toThrow('finalize failed');
    expect(h.calls.slice(before).filter((c) => c.endsWith('/finalize'))).toHaveLength(3);
    expect(h.done.slice(doneBefore).filter((c) => c.endsWith('/finalize'))).toHaveLength(3); // all three answered before the failure surfaced
    expect(h.state.pending).toBe(0);
    expect(h.profile.serverByteValidation).toBe(false);
    expect(h.guard.inflight).toBe(0);
  });

  it('propagates an unexpected exception and still leaves the codec closed and the journal cleanable', async () => {
    h.state.tweak = (_t, path, method) => { if (method === 'POST' && path.endsWith('/finalize')) throw new Error('boom'); return undefined; };
    await expect(runMp3Scenarios(h.env)).rejects.toThrow('boom');
    expect(h.profile.serverByteValidation).toBe(false);
    const reread = parseJournal(await readFile(h.journalPath, 'utf8'), BUCKET);
    expect(reread.entries.length).toBe(h.journal.entries.length);
  });
});

describe('quiescence before cleanup (offline)', { timeout: 60_000 }, () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  const events: string[] = [];
  let writing = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  beforeAll(async () => {
    h = await startHarness('su');
    // The promotion to the final object is held: a seal that outlives the HTTP client's patience.
    const delayed = async (command: any) => {
      const isFinalWrite = command.constructor.name === 'PutObjectCommand' && String(command.input.Key).startsWith('objects/');
      if (isFinalWrite) {
        writing += 1;
        events.push('promotion-started');
        await gate;
      }
      try { return await h.bucket.impl(command); } finally {
        if (isFinalWrite) { writing -= 1; events.push('promotion-finished'); }
      }
    };
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(h.guard.wrap(delayed as never) as never);
  });
  afterAll(async () => { release(); vi.restoreAllMocks(); await h.close(); });

  it('an HTTP timeout before the seal ends leaves a pending promotion; cleanup waits for it and never overlaps it', async () => {
    const { STEM_IDS } = await import('../features/ministry_audio/ministry-audio.schema');
    h.env.setCodec(true);
    h.state.apiTimeoutMs = 400;
    const stems = STEM_IDS.map((id) => ({ ...fixture.manifest, id }));
    const reserved = await h.env.api(h.env.ministries.a, '/uploads', 'POST', h.env.tokens.adminA, {
      schemaVersion: 2, idempotencyKey: randomUUID(), confirmed: true, title: 'C0.2', artist: 'synthetic', version: 'q', model: { id: 'htdemucs_6s', version: 'm22c5d-c0' }, stems,
    });
    const id = ((await reserved.json()) as { id: string }).id;
    const { addJournalEntry } = await import('./m22c5d-r2-mp3-e2e-core');
    addJournalEntry(h.env.journal, h.env.ministries.a, id, stems.map((s) => ({ id: s.id, sha256: s.sha256 })));
    await h.env.persistJournal();
    const grantResponse = await h.env.api(h.env.ministries.a, `/uploads/${id}/stems/vocals/upload-url`, 'POST', h.env.tokens.adminA);
    const grant = (await grantResponse.json()) as Signed & { attempt: number };
    expect(await h.env.put(grant, fixture.bytes)).toBe(200);

    // The client gives up after 400 ms; the service is still promoting.
    await expect(h.env.api(h.env.ministries.a, `/uploads/${id}/stems/vocals/complete`, 'POST', h.env.tokens.adminA, { attempt: grant.attempt })).rejects.toBeDefined();
    expect(h.state.pending).toBe(0); // the client call is over...
    expect(h.guard.inflight).toBe(1); // ...but the promotion is not
    expect(writing).toBe(1);

    // Not quiescent: the proof fails, so no cleanup may start.
    const early = await quiesceRun(h.guard, [], { timeoutMs: 300 });
    expect(early).toMatchObject({ quiescent: false, pendingCommands: 1 });
    expect(h.guard.isFrozen).toBe(true);
    // Frozen: a straggler can no longer start anything new.
    await expect(new S3Client({ region: 'auto' }).send(new HeadObjectCommand({ Bucket: BUCKET, Key: h.journal.entries[0].keys[0] }))).rejects.toThrow('frozen');

    // The delayed R2 operation finally ends; only then is the run quiescent and cleanup allowed.
    release();
    const settled = await quiesceRun(h.guard, [], { timeoutMs: 5000 });
    expect(settled).toEqual({ quiescent: true, pendingCommands: 0, pendingWork: 0 });
    expect(events).toEqual(['promotion-started', 'promotion-finished']);

    const client = new S3Client({ region: 'auto' });
    h.guard.authorizeCleanup(client, new CommandGuard(BUCKET, [h.env.ministries.a, h.env.ministries.b]));
    let overlapped = 0;
    const outcome = await cleanupJournal(parseJournal(await readFile(h.journalPath, 'utf8'), BUCKET),
      async (key) => { if (writing > 0 || h.guard.inflight > 0) overlapped += 1; await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); },
      async (key) => { try { await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; } catch { return false; } });
    expect(overlapped).toBe(0);
    expect(outcome).toMatchObject({ stillPresent: 0, failed: 0 });
    expect(h.bucket.objects.size).toBe(0);
    h.env.setCodec(false);
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
