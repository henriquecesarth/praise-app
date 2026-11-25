import { readFileSync } from 'node:fs';
import path from 'node:path';
import { STEM_IDS, type StemId } from '../features/ministry_audio/ministry-audio.schema';
import type { Mp3StemManifest } from '../features/ministry_audio/mp3-stream-validator';
import {
  CommandGuard, GuardViolation, sha256, signedRequest, type CommandLike, type Limits, type SignedGrant, type SignedTarget,
} from './m22c5d-r2-mp3-e2e-core';

// M22-S3.1 — core of the LONG-audio MP3 homologation (six stems of about 300 s) against the R2 DEVELOPMENT bucket.
// It is a separate harness: the limits of the original C.5D-C0 harness are NOT modified. Everything here is a ceiling, not a
// target; when a ceiling is not enough the run stops and reports, it never enlarges itself. Nothing here opens a connection.

export const MIB = 1024 * 1024;

/** Absolute ceilings of one long run. */
export const LONG_BUDGETS = {
  recordings: 1,
  stems: 6,
  seconds: 300,
  objectBytes: 10 * MIB,
  /** Sum of the compressed originals. */
  originalBytes: 60 * MIB,
  /** Every body that crosses the wire: client PUT, client GET, SDK GET, SDK PUT (reads, upload, promotion, retries). */
  transferBytes: 300 * MIB,
  /** SDK commands of the run (100 of the 300 are reserved for the cleanup client). */
  runCommands: 200,
  cleanupCommands: 100,
  runMs: 15 * 60_000,
} as const;

export const LONG_LIMITS: Limits = {
  maxRecordings: LONG_BUDGETS.recordings,
  maxCommands: LONG_BUDGETS.runCommands,
  maxObjectBytes: LONG_BUDGETS.objectBytes,
  /** Six staging attempts (one per stem) plus six final objects, with room for one retry per stem. */
  maxObjects: 18,
  /** The 15 minutes include the signed-URL expiry wait and the cleanup margin. */
  maxRunMs: LONG_BUDGETS.runMs - 90_000,
  maxFetchMs: 150_000,
  maxFetchErrorBytes: 8 * 1024,
  maxApiMs: 60_000,
  quiesceMs: 60_000,
  lateWriteSettleMs: 3_000,
};
export const LONG_CLEANUP_LIMITS: Limits = { ...LONG_LIMITS, maxCommands: LONG_BUDGETS.cleanupCommands, maxObjects: 0 };

/** Total of bytes sent or received by the run, charged BEFORE the transfer starts whenever its size is known. */
export class TransferLedger {
  total = 0;
  readonly byKind: Record<string, number> = {};
  constructor(readonly cap: number = LONG_BUDGETS.transferBytes) {}
  get remaining(): number { return this.cap - this.total; }
  canAfford(bytes: number): boolean { return Number.isFinite(bytes) && bytes >= 0 && this.total + bytes <= this.cap; }
  charge(kind: string, bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new GuardViolation('Invalid transfer size.');
    if (this.total + bytes > this.cap) throw new GuardViolation('Transfer budget exceeded.');
    this.total += bytes;
    this.byKind[kind] = (this.byKind[kind] ?? 0) + bytes;
  }
}

const STEM_KEY = new RegExp(`/(${STEM_IDS.join('|')})(?:/[1-3])?\\.mp3$`);

/**
 * The run guard of the original harness plus: a transfer ledger charged BEFORE each SDK body moves (the declared length, or
 * the known size of the stem behind the key), no ranged read at all (the long run never uses Range) and no CopyObject.
 */
export class LongCommandGuard extends CommandGuard {
  constructor(
    bucket: string, ministries: readonly string[], private readonly ledger: TransferLedger,
    private readonly stemSizes: ReadonlyMap<string, number>, now: () => number = Date.now, limits: Limits = LONG_LIMITS,
  ) {
    super(bucket, ministries, now, limits);
  }

  override dispatch<A extends unknown[], R>(inner: (this: unknown, command: CommandLike, ...rest: A) => Promise<R>, self: unknown, command: CommandLike, rest: A): Promise<R> {
    const name = command?.constructor?.name ?? '';
    const input = command.input ?? {};
    if (input.Range) throw new GuardViolation('Ranged reads are not part of the long run.');
    if (name === 'CopyObjectCommand') throw new GuardViolation('Copy is not part of the long run.');
    if (name === 'PutObjectCommand' || name === 'GetObjectCommand') {
      const stem = input.Key ? STEM_KEY.exec(input.Key)?.[1] : undefined;
      const size = stem ? this.stemSizes.get(stem) : undefined;
      if (size === undefined) throw new GuardViolation('Unknown object size.');
      this.ledger.charge(name === 'PutObjectCommand' ? 'sdkPut' : 'sdkGet', typeof input.ContentLength === 'number' ? Math.max(size, input.ContentLength) : size);
    }
    return super.dispatch(inner, self, command, rest);
  }
}

/** The client's signed PUT/GET with the transfer ledger: a PUT is charged first; a GET needs room for one whole object and is charged by what actually arrived. */
export async function ledgerSignedRequest(
  grant: SignedGrant, method: 'PUT' | 'GET', body: Buffer | undefined, target: SignedTarget, ledger: TransferLedger,
  expectedBytes: number, deps: { fetchImpl?: typeof fetch } = {},
) {
  if (method === 'PUT') ledger.charge('clientPut', body?.length ?? 0);
  else if (!ledger.canAfford(expectedBytes)) throw new GuardViolation('Transfer budget exceeded.');
  const result = await signedRequest(grant, method, body, target, { limits: LONG_LIMITS, fetchImpl: deps.fetchImpl });
  if (method === 'GET') ledger.charge('clientGet', result.bytes.length);
  return result;
}

export interface LongFixture { id: StemId; manifest: Mp3StemManifest; bytes: Buffer }

/** Reads `manifests.json` and the six `<stem>.mp3` of a directory and enforces every static ceiling BEFORE any connection. */
export function loadLongFixtures(dir: string): LongFixture[] {
  const manifests = JSON.parse(readFileSync(path.join(dir, 'manifests.json'), 'utf8')) as Mp3StemManifest[];
  if (!Array.isArray(manifests) || manifests.length !== LONG_BUDGETS.stems) throw new GuardViolation('Six stems are required.');
  let total = 0;
  const fixtures = STEM_IDS.map((id): LongFixture => {
    const manifest = manifests.find((m) => m.id === id);
    if (!manifest) throw new GuardViolation('Missing stem manifest.');
    const bytes = readFileSync(path.join(dir, `${id}.mp3`));
    total += bytes.length;
    if (bytes.length > LONG_BUDGETS.objectBytes || bytes.length !== manifest.sizeBytes || sha256(bytes) !== manifest.sha256) throw new GuardViolation('Fixture rejected.');
    if (!(manifest.durationSeconds > 0 && manifest.durationSeconds <= LONG_BUDGETS.seconds)) throw new GuardViolation('Fixture duration rejected.');
    return { id, manifest, bytes };
  });
  if (total > LONG_BUDGETS.originalBytes) throw new GuardViolation('Fixture set exceeds the compressed-original ceiling.');
  return fixtures;
}

export const stemSizes = (fixtures: readonly LongFixture[]): Map<string, number> => new Map(fixtures.map((f) => [f.id, f.bytes.length]));

/** Peak resident/heap memory of this process (service and client share it in the harness) sampled while a seal runs. */
export class MemorySampler {
  baseline = process.memoryUsage();
  peakRss = this.baseline.rss;
  peakHeap = this.baseline.heapUsed;
  private timer: NodeJS.Timeout | undefined;
  start(): void {
    this.baseline = process.memoryUsage();
    this.peakRss = this.baseline.rss;
    this.peakHeap = this.baseline.heapUsed;
    this.timer = setInterval(() => this.sample(), 50);
    this.timer.unref();
  }
  sample(): void {
    const m = process.memoryUsage();
    this.peakRss = Math.max(this.peakRss, m.rss);
    this.peakHeap = Math.max(this.peakHeap, m.heapUsed);
  }
  stop(): void { this.sample(); if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  summary() {
    const mb = (n: number) => Math.round(n / MIB);
    return { baselineRssMb: mb(this.baseline.rss), baselineHeapMb: mb(this.baseline.heapUsed), peakRssMb: mb(this.peakRss), peakHeapMb: mb(this.peakHeap) };
  }
}
