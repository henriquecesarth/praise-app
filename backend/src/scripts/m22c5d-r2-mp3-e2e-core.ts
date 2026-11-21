import { createHash } from 'node:crypto';
import { STEM_IDS } from '../features/ministry_audio/ministry-audio.schema';

// M22-C.5D-C0 — development-only core of the MP3 v2 homologation against the R2 DEVELOPMENT bucket.
// Nothing here opens a connection: every effect is injected, so the same logic is proven offline (fake bucket + Firestore
// Emulator) and then reused unchanged by scripts/m22c5d-r2-mp3-e2e.ts. Excluded from the publish build (src/scripts).
// It never enables MP3 in the publishable build: the live script alone flips the in-memory profile, inside the guard.

export interface Limits {
  maxRecordings: number;
  maxCommands: number;
  maxObjectBytes: number;
  maxObjects: number;
  maxRunMs: number;
}
export const LIMITS: Limits = {
  /** Distinct recordings reserved in one run. */
  maxRecordings: 8,
  /** Every S3 command sent by the run, including failed ones. */
  maxCommands: 700,
  /** Largest object the run may PUT, copy or read. */
  maxObjectBytes: 64 * 1024,
  /** Objects the run may ever create (staging + final). */
  maxObjects: 160,
  /** Wall clock of the whole run, cleanup excluded. */
  maxRunMs: 300_000,
};

/** Ranged parts of 4 KiB split the 10.8 KB fixture in three, exercising ordered parallel reads on a tiny object. */
export const RANGE_PART_BYTES = 4096;
export const MIN_RANGE_PARTS = 2;

export type ModeTag = 'su' | 'rc';
export const MODES: Record<ModeTag, { read: 'stream' | 'ranged'; promotion: 'upload' | 'copy' }> = {
  su: { read: 'stream', promotion: 'upload' },
  rc: { read: 'ranged', promotion: 'copy' },
};

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const MINISTRY_PATTERN = new RegExp(`^m22c5d-r2-${UUID}-(?:su|rc)x?$`);
export const RECORDING_PATTERN = /^[a-f0-9]{64}$/;
const STEMS = STEM_IDS.join('|');
const MINISTRY = `m22c5d-r2-${UUID}-(?:su|rc)x?`;
// Whole-key patterns: no traversal, no extra segments, no other extension.
const KEY_PATTERN = new RegExp(`^(?:(staging)/ministry-audio/(${MINISTRY})/[a-f0-9]{64}/(?:${STEMS})/[1-3]\\.mp3|(objects)/ministry-audio/(${MINISTRY})/[a-f0-9]{64}/(?:${STEMS})\\.mp3)$`);
const ALLOWED_COMMANDS = new Set(['HeadObjectCommand', 'GetObjectCommand', 'PutObjectCommand', 'CopyObjectCommand', 'DeleteObjectCommand']);

export function ministryIds(runUuid: string): Record<'su' | 'rc' | 'sux' | 'rcx', string> {
  const id = (suffix: string) => `m22c5d-r2-${runUuid}-${suffix}`;
  const ids = { su: id('su'), rc: id('rc'), sux: id('sux'), rcx: id('rcx') };
  for (const value of Object.values(ids)) if (!MINISTRY_PATTERN.test(value)) throw new Error('Invalid run identifier.');
  return ids;
}

/** Every key a recording of six MP3 stems can ever occupy: three staging attempts and one final object per stem. */
export function plannedKeys(ministryId: string, recordingId: string): string[] {
  if (!MINISTRY_PATTERN.test(ministryId) || !RECORDING_PATTERN.test(recordingId)) throw new Error('Invalid synthetic identifiers.');
  return STEM_IDS.flatMap((stem) => [
    ...[1, 2, 3].map((attempt) => `staging/ministry-audio/${ministryId}/${recordingId}/${stem}/${attempt}.mp3`),
    `objects/ministry-audio/${ministryId}/${recordingId}/${stem}.mp3`,
  ]);
}

export class GuardViolation extends Error {}

/** Steps each mode must report; fewer means a scenario was skipped silently. */
export const EXPECTED_STEPS: Record<ModeTag, number> = { su: 24, rc: 28 };

/**
 * A signed URL used by the browser stand-in must target the account's R2 endpoint and a synthetic key of this run in
 * the allowed bucket, because those requests do not pass through the SDK command guard.
 */
export function assertSignedTarget(rawUrl: string, accountId: string, bucket: string, ministries: readonly string[]): void {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new GuardViolation('Signed URL rejected.'); }
  const prefix = `/${bucket}/`;
  const key = url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : '';
  const match = KEY_PATTERN.exec(key);
  const ministry = match?.[2] ?? match?.[4];
  if (url.protocol !== 'https:' || url.host !== `${accountId}.r2.cloudflarestorage.com` || url.username || url.password ||
      !ministry || !ministries.includes(ministry)) {
    throw new GuardViolation('Signed URL rejected.');
  }
}

export interface IsolationEnv {
  [name: string]: string | undefined;
}

const LOOPBACK = /^127\.0\.0\.1:\d{2,5}$/;
/** The live run is refused unless every condition holds. Values are never printed. */
export function assertLiveIsolation(env: IsolationEnv, configuredBucket: string): void {
  const failed =
    env.NODE_ENV !== 'test' || env.M22C5D_R2_LIVE !== '1' || !!env.VERCEL || !!env.VERCEL_ENV ||
    !/^demo-/.test(env.FIREBASE_PROJECT_ID ?? '') ||
    !LOOPBACK.test(env.FIRESTORE_EMULATOR_HOST ?? '') || !LOOPBACK.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
    // The bucket is allowed explicitly, by exact name, in addition to the dedicated development name pattern.
    !/^louvaio-ministry-audio-dev(?:-[a-z0-9]+)*$/.test(configuredBucket) || env.M22C5D_R2_ALLOWED_BUCKET !== configuredBucket ||
    env.MINISTRY_AUDIO_DIRECT_SIMULATOR === '1';
  if (failed) throw new GuardViolation('Isolation guard failed.');
}

export interface Counters {
  commands: number;
  head: number;
  get: number;
  rangedGet: number;
  put: number;
  copyAttempted: number;
  copyInjected: number;
  del: number;
  stagingGet: number;
  stagingRangedGet: number;
  objectsCreated: number;
}

interface CommandLike {
  constructor: { name: string };
  input?: { Bucket?: string; Key?: string; Range?: string; CopySource?: string; ContentLength?: number };
}

/**
 * Wraps the S3 client `send`. Everything is decided BEFORE the command leaves the process: unknown command kinds (so no
 * listing), a bucket other than the allowed one, keys outside the exact synthetic prefixes of this run, oversized
 * objects and exceeded budgets. Trace entries hold the command kind and a key class only, never keys, URLs or content.
 */
export class CommandGuard {
  readonly counters: Counters = {
    commands: 0, head: 0, get: 0, rangedGet: 0, put: 0, copyAttempted: 0, copyInjected: 0, del: 0,
    stagingGet: 0, stagingRangedGet: 0, objectsCreated: 0,
  };
  readonly trace: Array<{ n: number; command: string; place: 'staging' | 'final'; outcome: 'ok' | 'error' | 'injected'; status?: number }> = [];
  private pendingCopyFailures = 0;
  private readonly started: number;
  private readonly created = new Set<string>();

  constructor(
    private readonly bucket: string,
    private readonly ministries: readonly string[],
    private readonly now: () => number = Date.now,
    private readonly limits: Limits = LIMITS,
  ) {
    for (const ministry of ministries) if (!MINISTRY_PATTERN.test(ministry)) throw new GuardViolation('Invalid ministry.');
    this.started = now();
  }

  failNextCopies(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > 3) throw new GuardViolation('Invalid fault.');
    this.pendingCopyFailures = count;
  }

  private assertKey(key: string | undefined): 'staging' | 'final' {
    const match = key ? KEY_PATTERN.exec(key) : null;
    const ministry = match?.[2] ?? match?.[4];
    if (!key || !match || !ministry || !this.ministries.includes(ministry)) {
      throw new GuardViolation('Key outside the authorized synthetic prefixes.');
    }
    return match[1] === 'staging' ? 'staging' : 'final';
  }

  wrap<A extends unknown[], R>(inner: (this: unknown, command: CommandLike, ...rest: A) => Promise<R>) {
    const guard = this;
    return function guarded(this: unknown, command: CommandLike, ...rest: A): Promise<R> {
      try {
        return guard.dispatch(inner, this, command, rest);
      } catch (error) {
        return Promise.reject(error);
      }
    };
  }

  private dispatch<A extends unknown[], R>(inner: (this: unknown, command: CommandLike, ...rest: A) => Promise<R>, self: unknown, command: CommandLike, rest: A): Promise<R> {
    const name = command?.constructor?.name ?? '';
    if (!ALLOWED_COMMANDS.has(name)) throw new GuardViolation('Command kind not allowed.');
    const input = command.input ?? {};
    if (input.Bucket !== this.bucket) throw new GuardViolation('Bucket not allowed.');
    const place = this.assertKey(input.Key);
    if (name === 'CopyObjectCommand') {
      const source = (input.CopySource ?? '').slice(this.bucket.length + 1);
      if (!(input.CopySource ?? '').startsWith(`${this.bucket}/`)) throw new GuardViolation('Copy source not allowed.');
      this.assertKey(source);
    }
    const c = this.counters;
    if (++c.commands > this.limits.maxCommands) throw new GuardViolation('Command budget exceeded.');
    if (this.now() - this.started > this.limits.maxRunMs) throw new GuardViolation('Time budget exceeded.');
    if (typeof input.ContentLength === 'number' && input.ContentLength > this.limits.maxObjectBytes) throw new GuardViolation('Object too large.');
    if ((name === 'PutObjectCommand' || name === 'CopyObjectCommand') && !this.created.has(input.Key!)) {
      if (this.created.size >= this.limits.maxObjects) throw new GuardViolation('Object budget exceeded.');
    }
    const entry = { n: c.commands, command: name.replace(/Command$/, ''), place, outcome: 'ok' as 'ok' | 'error' | 'injected', status: undefined as number | undefined };
    this.trace.push(entry);
    if (this.trace.length > 120) this.trace.shift();
    if (name === 'HeadObjectCommand') c.head += 1;
    else if (name === 'GetObjectCommand') {
      if (input.Range) { c.rangedGet += 1; if (place === 'staging') c.stagingRangedGet += 1; }
      else { c.get += 1; if (place === 'staging') c.stagingGet += 1; }
    } else if (name === 'PutObjectCommand') c.put += 1;
    else if (name === 'DeleteObjectCommand') c.del += 1;
    else if (name === 'CopyObjectCommand') {
      c.copyAttempted += 1;
      if (this.pendingCopyFailures > 0) {
        this.pendingCopyFailures -= 1;
        c.copyInjected += 1;
        entry.outcome = 'injected';
        return Promise.reject(new Error('Injected copy failure.'));
      }
    }
    return inner.call(self, command, ...rest).then(
      (result) => {
        if (name === 'PutObjectCommand' || name === 'CopyObjectCommand') {
          if (!this.created.has(input.Key!)) { this.created.add(input.Key!); c.objectsCreated += 1; }
        }
        return result;
      },
      (error: unknown) => {
        entry.outcome = 'error';
        const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
        if (typeof status === 'number') entry.status = status;
        throw error;
      },
    );
  }
}

export interface JournalEntry {
  ministryId: string;
  recordingId: string;
  keys: string[];
  stems: Array<{ id: string; sha256: string }>;
}
export interface Journal {
  format: 'louvaio.m22c5d-r2-journal';
  version: 1;
  runId: string;
  bucket: string;
  entries: JournalEntry[];
}

/** Write-ahead: the planned keys are recorded BEFORE the first upload URL of a recording is issued. */
export function addJournalEntry(journal: Journal, ministryId: string, recordingId: string, stems: Array<{ id: string; sha256: string }>): void {
  if (journal.entries.length >= LIMITS.maxRecordings) throw new GuardViolation('Recording budget exceeded.');
  journal.entries.push({ ministryId, recordingId, keys: plannedKeys(ministryId, recordingId), stems });
}

export function parseJournal(text: string, bucket: string): Journal {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new GuardViolation('Journal unreadable.'); }
  const j = value as Partial<Journal>;
  if (!j || j.format !== 'louvaio.m22c5d-r2-journal' || j.version !== 1 || j.bucket !== bucket || !Array.isArray(j.entries) ||
      j.entries.length > LIMITS.maxRecordings || typeof j.runId !== 'string') throw new GuardViolation('Journal rejected.');
  for (const entry of j.entries) {
    // Keys are recomputed, never trusted from the file: a tampered journal cannot widen the cleanup.
    const expected = plannedKeys(entry.ministryId, entry.recordingId);
    if (JSON.stringify(entry.keys) !== JSON.stringify(expected)) throw new GuardViolation('Journal keys rejected.');
  }
  return j as Journal;
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface StepResult {
  scenario: string;
  step: string;
  pass: boolean;
}
export class Report {
  readonly steps: StepResult[] = [];
  check(scenario: string, step: string, condition: unknown): boolean {
    const pass = !!condition;
    this.steps.push({ scenario, step, pass });
    return pass;
  }
  get failed(): StepResult[] { return this.steps.filter((s) => !s.pass); }
  get ok(): boolean { return this.steps.length > 0 && this.failed.length === 0; }
}

export interface CleanupOutcome {
  attempted: number;
  removed: number;
  stillPresent: number;
  failed: number;
}

/**
 * Removes exactly the planned keys of a journal (no listing, no wildcards) and then proves each is gone.
 * `remove` and `exists` are injected; a missing key counts as removed.
 */
export async function cleanupJournal(
  journal: Journal,
  remove: (key: string) => Promise<void>,
  exists: (key: string) => Promise<boolean>,
): Promise<CleanupOutcome> {
  const keys = journal.entries.flatMap((entry) => entry.keys);
  const outcome: CleanupOutcome = { attempted: keys.length, removed: 0, stillPresent: 0, failed: 0 };
  for (const key of keys) {
    try {
      await remove(key);
      if (await exists(key)) outcome.stillPresent += 1;
      else outcome.removed += 1;
    } catch {
      outcome.failed += 1;
    }
  }
  return outcome;
}
