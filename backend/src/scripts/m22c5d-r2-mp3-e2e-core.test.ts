import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STEM_IDS } from '../features/ministry_audio/ministry-audio.schema';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  addJournalEntry, assertLiveIsolation, assertSignedTarget, cleanupJournal, CommandGuard, createJournalFile, GuardViolation, LIMITS, type Limits,
  ministryIds, nodeJournalIo, parseJournal, plannedKeys, Report, ScenarioAborted, signedRequest, updateJournalFile, type Journal, type JournalIo,
} from './m22c5d-r2-mp3-e2e-core';

const BUCKET = 'louvaio-ministry-audio-dev';
const run = randomUUID();
const ids = ministryIds(run);
const rec = 'a'.repeat(64);
const stems6 = STEM_IDS.map((id) => ({ id, sha256: 'b'.repeat(64) }));
const goodKey = `staging/ministry-audio/${ids.su}/${rec}/vocals/1.mp3`;
const env = {
  NODE_ENV: 'test', M22C5D_R2_LIVE: '1', FIREBASE_PROJECT_ID: 'demo-louvaio', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8186',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9098', M22C5D_R2_ALLOWED_BUCKET: BUCKET,
};
const ok = async () => ({});
const guard = (limits: Limits = LIMITS, now = () => 0) => new CommandGuard(BUCKET, [ids.su, ids.rc], now, limits);
const send = (g: CommandGuard, command: unknown) => (g.wrap(ok) as (c: never) => Promise<unknown>)(command as never);

describe('live isolation guard', () => {
  it('passes only with every explicit condition', () => {
    expect(() => assertLiveIsolation(env, BUCKET)).not.toThrow();
    const bad: Array<[string, Record<string, string | undefined>]> = [
      ['not test', { NODE_ENV: 'production' }], ['no live flag', { M22C5D_R2_LIVE: undefined }], ['vercel', { VERCEL: '1' }],
      ['vercel env', { VERCEL_ENV: 'production' }], ['real project', { FIREBASE_PROJECT_ID: 'louvaio-prod' }],
      ['remote firestore', { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }], ['no auth emulator', { FIREBASE_AUTH_EMULATOR_HOST: undefined }],
      ['bucket not explicitly allowed', { M22C5D_R2_ALLOWED_BUCKET: undefined }], ['other allowed bucket', { M22C5D_R2_ALLOWED_BUCKET: 'louvaio-ministry-audio-dev-x' }],
      ['simulator on', { MINISTRY_AUDIO_DIRECT_SIMULATOR: '1' }],
    ];
    for (const [label, patch] of bad) expect(() => assertLiveIsolation({ ...env, ...patch }, BUCKET), label).toThrow(GuardViolation);
    for (const name of ['louvaio-ministry-audio', 'louvaio-ministry-audio-prod', 'louvaio-ministry-audio-developer', 'other-dev']) {
      expect(() => assertLiveIsolation({ ...env, M22C5D_R2_ALLOWED_BUCKET: name }, name), name).toThrow(GuardViolation);
    }
  });
});

describe('command guard', () => {
  it('allows only the five object commands on exact synthetic prefixes of this run', async () => {
    const g = guard();
    for (const Command of [HeadObjectCommand, GetObjectCommand, DeleteObjectCommand] as Array<new (input: { Bucket: string; Key: string }) => unknown>) {
      await expect(send(g, new Command({ Bucket: BUCKET, Key: goodKey }))).resolves.toEqual({});
    }
    await expect(send(g, new PutObjectCommand({ Bucket: BUCKET, Key: goodKey, ContentLength: 10 }))).resolves.toEqual({});
    await expect(send(g, new CopyObjectCommand({ Bucket: BUCKET, Key: goodKey.replace('staging', 'objects').replace('/vocals/1', '/vocals'), CopySource: `${BUCKET}/${goodKey}` }))).resolves.toEqual({});
  });

  it('refuses listing, other buckets, other ministries, other extensions, traversal and foreign copy sources before sending', async () => {
    const g = guard();
    const refused: unknown[] = [
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'staging/' }),
      new HeadObjectCommand({ Bucket: 'louvaio-ministry-audio', Key: goodKey }),
      new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey.replace(ids.su, ids.sux) }),
      new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey.replace(ids.su, `m22c5d-r2-${randomUUID()}-su`) }),
      new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey.replace('.mp3', '.wav') }),
      new HeadObjectCommand({ Bucket: BUCKET, Key: `${goodKey}/../../x.mp3` }),
      new HeadObjectCommand({ Bucket: BUCKET, Key: 'staging/ministry-audio/m22c-r2-old/x/vocals/1.mp3' }),
      new DeleteObjectCommand({ Bucket: BUCKET, Key: `staging/ministry-audio/${ids.su}/${rec}/` }),
      new CopyObjectCommand({ Bucket: BUCKET, Key: goodKey.replace('staging', 'objects').replace('/vocals/1', '/vocals'), CopySource: `${BUCKET}/staging/ministry-audio/other/${rec}/vocals/1.mp3` }),
      new CopyObjectCommand({ Bucket: BUCKET, Key: goodKey.replace('staging', 'objects').replace('/vocals/1', '/vocals'), CopySource: `louvaio-ministry-audio/${goodKey}` }),
      undefined, {},
    ];
    for (const command of refused) await expect(send(g, command), String((command as { constructor?: { name?: string } })?.constructor?.name)).rejects.toThrow(GuardViolation);
    expect(g.counters.commands).toBe(0);
  });

  it('enforces the command, object-size, object-count and time budgets', async () => {
    const small = { ...LIMITS, maxCommands: 2, maxObjectBytes: 100, maxObjects: 1 };
    const g = guard(small);
    await send(g, new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey }));
    await expect(send(g, new PutObjectCommand({ Bucket: BUCKET, Key: goodKey, ContentLength: 101 }))).rejects.toThrow('Object too large');
    await expect(send(g, new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey }))).rejects.toThrow('Command budget');
    const g2 = guard({ ...small, maxCommands: 99 });
    await send(g2, new PutObjectCommand({ Bucket: BUCKET, Key: goodKey, ContentLength: 5 }));
    await expect(send(g2, new PutObjectCommand({ Bucket: BUCKET, Key: goodKey.replace('/1.', '/2.'), ContentLength: 5 }))).rejects.toThrow('Object budget');
    let t = 0;
    const g3 = guard(LIMITS, () => t);
    t = LIMITS.maxRunMs + 1;
    await expect(send(g3, new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey }))).rejects.toThrow('Time budget');
  });

  it('injects copy failures before they reach the bucket, bounded to three', async () => {
    const g = guard();
    expect(() => g.failNextCopies(4)).toThrow(GuardViolation);
    g.failNextCopies(1);
    const copy = new CopyObjectCommand({ Bucket: BUCKET, Key: goodKey.replace('staging', 'objects').replace('/vocals/1', '/vocals'), CopySource: `${BUCKET}/${goodKey}` });
    await expect(send(g, copy)).rejects.toThrow('Injected');
    await expect(send(g, copy)).resolves.toEqual({});
    expect(g.counters).toMatchObject({ copyAttempted: 2, copyInjected: 1 });
  });

  it('keeps URLs, keys and content out of the trace', async () => {
    const g = guard();
    await send(g, new HeadObjectCommand({ Bucket: BUCKET, Key: goodKey }));
    expect(JSON.stringify(g.trace)).not.toMatch(/ministry|staging\/|\.mp3|http/i);
  });
});

describe('journal and cleanup', () => {
  const journal = (): Journal => ({ format: 'louvaio.m22c5d-r2-journal', version: 1, runId: run, bucket: BUCKET, entries: [] });

  it('plans exactly three staging attempts and one final key per stem, and refuses foreign identifiers', () => {
    const keys = plannedKeys(ids.su, rec);
    expect(keys).toHaveLength(24);
    expect(new Set(keys).size).toBe(24);
    expect(keys.every((k) => k.endsWith('.mp3') && k.includes(`/${ids.su}/${rec}/`))).toBe(true);
    expect(() => plannedKeys('m22c-r2-old', rec)).toThrow();
    expect(() => plannedKeys(ids.su, 'abc')).toThrow();
    expect(() => ministryIds('not-a-uuid')).toThrow();
  });

  it('bounds the number of recordings and rejects a tampered journal', () => {
    const j = journal();
    for (let i = 0; i < LIMITS.maxRecordings; i++) addJournalEntry(j, ids.su, i.toString(16).padStart(64, '0'), stems6);
    expect(() => addJournalEntry(j, ids.su, 'f'.repeat(64), stems6)).toThrow(GuardViolation);
    const text = JSON.stringify(j);
    expect(parseJournal(text, BUCKET).entries).toHaveLength(LIMITS.maxRecordings);
    expect(() => parseJournal(text, 'other-bucket')).toThrow(GuardViolation);
    const widened = JSON.parse(text) as Journal;
    widened.entries[0].keys.push('staging/ministry-audio/someone-else/x/vocals/1.mp3');
    expect(() => parseJournal(JSON.stringify(widened), BUCKET)).toThrow(GuardViolation);
    const foreign = JSON.parse(text) as Journal;
    foreign.entries[0].ministryId = 'prod-ministry';
    expect(() => parseJournal(JSON.stringify(foreign), BUCKET)).toThrow(GuardViolation);
    expect(() => parseJournal('{', BUCKET)).toThrow(GuardViolation);
  });

  it('removes only journaled keys and proves each one is gone, counting failures and leftovers', async () => {
    const j = journal();
    addJournalEntry(j, ids.su, rec, stems6);
    const present = new Set(plannedKeys(ids.su, rec).slice(0, 5));
    const removedKeys: string[] = [];
    const outcome = await cleanupJournal(j, async (k) => { removedKeys.push(k); present.delete(k); }, async (k) => present.has(k));
    expect(outcome).toEqual({ attempted: 24, removed: 24, stillPresent: 0, failed: 0 });
    expect(new Set(removedKeys)).toEqual(new Set(plannedKeys(ids.su, rec)));
    const stubborn = await cleanupJournal(j, async () => undefined, async (k) => k.endsWith('/vocals.mp3'));
    expect(stubborn).toMatchObject({ stillPresent: 1, failed: 0 });
    const broken = await cleanupJournal(j, async (k) => { if (k.includes('/drums/')) throw new Error('x'); }, async () => false);
    expect(broken.failed).toBe(3);
  });
});

describe('signed URL target (requests that bypass the SDK guard)', () => {
  const account = 'a'.repeat(32);
  const host = `https://${account}.r2.cloudflarestorage.com`;
  const good = `${host}/${BUCKET}/${goodKey}?X-Amz-Signature=x`;
  it('accepts only the account endpoint, the allowed bucket and a synthetic key of this run', () => {
    expect(() => assertSignedTarget(good, account, BUCKET, [ids.su])).not.toThrow();
    const bad = [
      good.replace('https:', 'http:'), good.replace(account, 'b'.repeat(32)), good.replace(`/${BUCKET}/`, '/louvaio-ministry-audio/'),
      good.replace(ids.su, ids.rc), good.replace('.mp3', '.wav'), `https://user:pw@${account}.r2.cloudflarestorage.com/${BUCKET}/${goodKey}`,
      `https://evil.example/${BUCKET}/${goodKey}`, 'not a url', `${host}/${BUCKET}/${goodKey}/../x.mp3`,
    ];
    for (const url of bad) expect(() => assertSignedTarget(url, account, BUCKET, [ids.su]), url).toThrow(GuardViolation);
  });
});

describe('journal integrity (strict parse)', () => {
  const fresh = (runId = run): Journal => ({ format: 'louvaio.m22c5d-r2-journal', version: 1, runId, bucket: BUCKET, entries: [] });
  const withEntry = (journal: Journal, ministry = ids.su, recording = rec) => { addJournalEntry(journal, ministry, recording, stems6); return journal; };
  const clone = (journal: Journal) => JSON.parse(JSON.stringify(journal)) as any;
  const refuses = (value: unknown) => expect(() => parseJournal(JSON.stringify(value), BUCKET)).toThrow(GuardViolation);

  it('accepts a complete, consistent journal of the run', () => {
    expect(parseJournal(JSON.stringify(withEntry(fresh())), BUCKET).entries).toHaveLength(1);
    expect(parseJournal(JSON.stringify(fresh()), BUCKET).entries).toHaveLength(0);
  });

  it('refuses an internally consistent journal that belongs to another run, before any command could be built', () => {
    const other = ministryIds(randomUUID());
    const foreign = withEntry(fresh(), other.su); // keys recomputed and valid, but not this runId's ministry
    refuses(foreign);
    const swapped = withEntry(fresh(randomUUID()), ids.su); // entry of this run under another runId
    refuses(swapped);
    const alien = fresh(randomUUID());
    alien.entries.push({ ...withEntry(fresh(), ids.su).entries[0] });
    refuses(alien);
  });

  it('refuses a malformed runId, the x isolation ministries, a mix of modes and duplicated recordings', () => {
    for (const runId of ['x', run.toUpperCase(), `${run}0`, '', 'a'.repeat(36)]) refuses({ ...fresh(), runId });
    refuses(withEntry(fresh(), ids.sux));
    const mixed = withEntry(withEntry(fresh(), ids.su), ids.rc, 'c'.repeat(64));
    refuses(mixed);
    const dup = withEntry(withEntry(fresh(), ids.su), ids.su, rec);
    refuses(dup);
  });

  it('refuses extra fields, wrong stems, wrong keys and wrong types anywhere in the document', () => {
    const good = withEntry(fresh());
    const mutate = (change: (j: any) => void) => { const j = clone(good); change(j); refuses(j); };
    mutate((j) => { j.extra = 1; });
    mutate((j) => { j.entries[0].extra = 1; });
    mutate((j) => { j.version = 2 as never; });
    mutate((j) => { j.format = 'x' as never; });
    mutate((j) => { j.entries[0].stems.pop(); });
    mutate((j) => { j.entries[0].stems.reverse(); });
    mutate((j) => { j.entries[0].stems[0].id = 'bass2'; });
    mutate((j) => { j.entries[0].stems[0].sha256 = 'zz'; });
    mutate((j) => { j.entries[0].stems[0].extra = 1; });
    mutate((j) => { j.entries[0].keys = [...j.entries[0].keys].reverse(); });
    mutate((j) => { j.entries[0].keys.pop(); });
    mutate((j) => { j.entries[0].recordingId = 'short'; });
    mutate((j) => { (j.entries as unknown) = {}; });
    mutate((j) => { j.entries[0].ministryId = 7 as never; });
    for (const bad of [null, [], 'text', 3]) refuses(bad);
    expect(() => parseJournal(JSON.stringify(good), 'other-bucket')).toThrow(GuardViolation);
  });

  it('makes the cleanup refuse a foreign journal before any R2 command exists', async () => {
    const foreign = JSON.stringify(withEntry(fresh(), ministryIds(randomUUID()).su));
    let commands = 0;
    const rejected = (async () => {
      const journal = parseJournal(foreign, BUCKET); // the cleanup script parses first; nothing below may run
      return cleanupJournal(journal, async () => { commands += 1; }, async () => { commands += 1; return false; });
    })();
    await expect(rejected).rejects.toThrow(GuardViolation);
    expect(commands).toBe(0);
  });
});

describe('recoverable journal writes', () => {
  const journalOf = (count: number): Journal => {
    const journal: Journal = { format: 'louvaio.m22c5d-r2-journal', version: 1, runId: run, bucket: BUCKET, entries: [] };
    for (let i = 0; i < count; i++) addJournalEntry(journal, ids.su, i.toString(16).padStart(64, '0'), stems6);
    return journal;
  };
  const sandbox = async <T>(body: (dir: string) => Promise<T>) => {
    const dir = await mkdtemp(join(tmpdir(), 'm22c5d-test-'));
    try { return await body(dir); } finally { await rm(dir, { recursive: true, force: true }); }
  };
  const failing = (point: 'open' | 'write' | 'sync' | 'rename'): JournalIo => ({
    ...nodeJournalIo,
    rename: point === 'rename' ? async () => { throw new Error('rename failed'); } : nodeJournalIo.rename,
    open: (async (path: string, flags: string, mode?: number) => {
      if (point === 'open' && String(path).endsWith('.journal.tmp')) throw new Error('open failed');
      const handle = await nodeJournalIo.open(path, flags as never, mode);
      if (!String(path).endsWith('.journal.tmp')) return handle;
      if (point === 'write') handle.writeFile = (async () => { throw new Error('write failed'); }) as never;
      if (point === 'sync') handle.sync = (async () => { throw new Error('sync failed'); }) as never;
      return handle;
    }) as JournalIo['open'],
  });

  it('creates exclusively with owner-only permissions and never overwrites an existing file', async () => {
    await sandbox(async (dir) => {
      const path = join(dir, 'a.journal.json');
      await createJournalFile(path, journalOf(0));
      expect(parseJournal(await readFile(path, 'utf8'), BUCKET).entries).toHaveLength(0);
      expect((await import('node:fs')).statSync(path).mode & 0o777).toBe(0o600);
      await expect(createJournalFile(path, journalOf(1))).rejects.toThrow('already exists');
      expect(parseJournal(await readFile(path, 'utf8'), BUCKET).entries).toHaveLength(0);
      await expect(createJournalFile(join(dir, 'b.json'), journalOf(0))).rejects.toThrow(GuardViolation);
      await writeFile(join(dir, 'precious.journal.json'), 'keep');
      await expect(createJournalFile(join(dir, 'precious.journal.json'), journalOf(0))).rejects.toThrow('already exists');
      expect(await readFile(join(dir, 'precious.journal.json'), 'utf8')).toBe('keep');
    });
  });

  it('never unlinks a path it did not create when the exclusive open fails', async () => {
    await sandbox(async (dir) => {
      const path = join(dir, 'e.journal.json');
      await writeFile(path, 'someone else');
      const denied: JournalIo = { ...nodeJournalIo, open: (async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }) as JournalIo['open'] };
      await expect(createJournalFile(path, journalOf(0), denied)).rejects.toThrow('denied');
      expect(await readFile(path, 'utf8')).toBe('someone else');
      await expect(updateJournalFile(join(dir, 'x.json'), journalOf(0))).rejects.toThrow(GuardViolation);
    });
  });

  it('updates atomically: the last valid journal survives a failure at open, write, sync or rename, with no leftovers', async () => {
    await sandbox(async (dir) => {
      const path = join(dir, 'r.journal.json');
      await createJournalFile(path, journalOf(1));
      const before = await readFile(path, 'utf8');
      for (const point of ['open', 'write', 'sync', 'rename'] as const) {
        await expect(updateJournalFile(path, journalOf(2), failing(point)), point).rejects.toThrow(`${point} failed`);
        expect(await readFile(path, 'utf8'), point).toBe(before);
        expect(parseJournal(before, BUCKET).entries).toHaveLength(1);
        expect((await readdir(dir)).filter((f) => f.endsWith('.tmp')), point).toEqual([]);
      }
      await updateJournalFile(path, journalOf(2));
      expect(parseJournal(await readFile(path, 'utf8'), BUCKET).entries).toHaveLength(2);
      expect((await import('node:fs')).statSync(path).mode & 0o777).toBe(0o600);
      expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  });

  it('survives a crash mid-update: a leftover partial temporary file is never read and the journal still cleans up', async () => {
    await sandbox(async (dir) => {
      const path = join(dir, 'c.journal.json');
      await createJournalFile(path, journalOf(1));
      await writeFile(join(dir, '.crashed.journal.tmp'), '{"format":"louvaio.m22c5d-r2-jour'); // process died while writing
      const journal = parseJournal(await readFile(path, 'utf8'), BUCKET);
      const removed: string[] = [];
      const outcome = await cleanupJournal(journal, async (k) => { removed.push(k); }, async () => false);
      expect(outcome).toMatchObject({ attempted: 24, removed: 24 });
      // The strict parser has not been relaxed to tolerate the partial file.
      expect(() => parseJournal('{"format":"louvaio.m22c5d-r2-jour', BUCKET)).toThrow(GuardViolation);
    });
  });

  it('refuses to persist a journal the parser would refuse later', async () => {
    await sandbox(async (dir) => {
      const path = join(dir, 'd.journal.json');
      await createJournalFile(path, journalOf(1));
      const bad = journalOf(1);
      bad.entries[0].keys.push('staging/x');
      await expect(updateJournalFile(path, bad)).rejects.toThrow(GuardViolation);
      expect(parseJournal(await readFile(path, 'utf8'), BUCKET).entries).toHaveLength(1);
    });
  });
});

describe('fail-fast report', () => {
  it('records the failing step and aborts immediately', () => {
    const report = new Report();
    report.check('s', 'a', true);
    expect(() => report.check('s', 'b', false)).toThrow(ScenarioAborted);
    expect(report.steps.map((s) => s.pass)).toEqual([true, false]);
    expect(report.ok).toBe(false);
  });
});

describe('signed requests (outside the SDK guard)', () => {
  const account = 'a'.repeat(32);
  const target = { accountId: account, bucket: BUCKET, ministries: [ids.su] };
  const grant = { url: `https://${account}.r2.cloudflarestorage.com/${BUCKET}/${goodKey}?X-Amz-Signature=x`, headers: { 'content-type': 'audio/mpeg' } };
  const stream = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ pull(controller) { const c = chunks.shift(); if (c) controller.enqueue(c); else controller.close(); } });
  const limits: Limits = { ...LIMITS, maxObjectBytes: 100, maxFetchErrorBytes: 10 };

  it('checks the target before fetching anything', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response('x'); }) as typeof fetch;
    for (const url of [grant.url.replace(account, 'b'.repeat(32)), grant.url.replace(BUCKET, 'louvaio-ministry-audio'), grant.url.replace('https', 'http'), 'nope']) {
      await expect(signedRequest({ ...grant, url }, 'GET', undefined, target, { fetchImpl, limits })).rejects.toThrow(GuardViolation);
    }
    expect(calls).toBe(0);
  });

  it('forbids redirects, bounds the time, and refuses an oversized upload before sending', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => { seen = init; return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    await expect(signedRequest(grant, 'PUT', Buffer.alloc(100), target, { fetchImpl, limits })).resolves.toMatchObject({ status: 200 });
    expect(seen?.redirect).toBe('error');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    let calls = 0;
    const counting = (async () => { calls += 1; return new Response(null); }) as typeof fetch;
    await expect(signedRequest(grant, 'PUT', Buffer.alloc(101), target, { fetchImpl: counting, limits })).rejects.toThrow('Upload exceeds');
    await expect(signedRequest(grant, 'PUT', undefined, target, { fetchImpl: counting, limits })).rejects.toThrow('Upload exceeds');
    expect(calls).toBe(0);
  });

  it('refuses a declared or streamed download over the limit without buffering it', async () => {
    let pulled = 0;
    const big = (async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(60)); },
    }), { status: 200 })) as typeof fetch;
    await expect(signedRequest(grant, 'GET', undefined, target, { fetchImpl: big, limits })).rejects.toThrow('exceeds the limit');
    expect(pulled).toBeLessThanOrEqual(3); // stopped at the second chunk, not read to the end
    const declared = (async () => new Response(stream([new Uint8Array(1)]), { status: 200, headers: { 'content-length': '101' } })) as typeof fetch;
    await expect(signedRequest(grant, 'GET', undefined, target, { fetchImpl: declared, limits })).rejects.toThrow('exceeds the limit');
    const ok = (async () => new Response(stream([new Uint8Array(60), new Uint8Array(40)]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch;
    const read = await signedRequest(grant, 'GET', undefined, target, { fetchImpl: ok, limits });
    expect(read).toMatchObject({ status: 200, contentType: 'audio/mpeg' });
    expect(read.bytes.length).toBe(100);
  });

  it('keeps only a tiny body from error responses', async () => {
    const error = (async () => new Response(stream([new Uint8Array(11)]), { status: 403 })) as typeof fetch;
    await expect(signedRequest(grant, 'GET', undefined, target, { fetchImpl: error, limits })).rejects.toThrow('exceeds the limit');
    const small = (async () => new Response('denied', { status: 403 })) as typeof fetch;
    await expect(signedRequest(grant, 'PUT', Buffer.alloc(5), target, { fetchImpl: small, limits })).resolves.toMatchObject({ status: 403 });
  });

  it('aborts a response that does not finish inside the time limit', async () => {
    const hang = (async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) { init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason)); },
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(signedRequest(grant, 'GET', undefined, target, { fetchImpl: hang, limits: { ...limits, maxFetchMs: 50 } })).rejects.toBeDefined();
  });
});
