import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  addJournalEntry, assertLiveIsolation, assertSignedTarget, cleanupJournal, CommandGuard, GuardViolation, LIMITS, type Limits, ministryIds, parseJournal, plannedKeys, type Journal,
} from './m22c5d-r2-mp3-e2e-core';

const BUCKET = 'louvaio-ministry-audio-dev';
const run = randomUUID();
const ids = ministryIds(run);
const rec = 'a'.repeat(64);
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
    for (let i = 0; i < LIMITS.maxRecordings; i++) addJournalEntry(j, ids.su, i.toString(16).padStart(64, '0'), []);
    expect(() => addJournalEntry(j, ids.su, 'f'.repeat(64), [])).toThrow(GuardViolation);
    const text = JSON.stringify(j);
    expect(parseJournal(text, BUCKET).entries).toHaveLength(LIMITS.maxRecordings);
    expect(() => parseJournal(text, 'other-bucket')).toThrow(GuardViolation);
    const widened = JSON.parse(text) as Journal;
    widened.entries[0].keys.push('staging/ministry-audio/someone-else/x/vocals/1.mp3');
    expect(() => parseJournal(JSON.stringify(widened), BUCKET)).toThrow(GuardViolation);
    const foreign = JSON.parse(text) as Journal;
    foreign.entries[0].ministryId = 'prod-ministry';
    expect(() => parseJournal(JSON.stringify(foreign), BUCKET)).toThrow();
    expect(() => parseJournal('{', BUCKET)).toThrow(GuardViolation);
  });

  it('removes only journaled keys and proves each one is gone, counting failures and leftovers', async () => {
    const j = journal();
    addJournalEntry(j, ids.su, rec, []);
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
