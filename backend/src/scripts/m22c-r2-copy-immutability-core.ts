import { createHash } from 'node:crypto';
import type { StemManifest } from '../features/ministry_audio/ministry-audio.schema';
import { wavOfSize } from './m22c-r2-seal-bench-core';

// M22-C.3B development-only core: proves that the CopyObject promotion cannot overwrite an existing final object.
// No network, credentials or filesystem access happens here: every effect is injected, so the logic is testable
// offline. Excluded from the publish build (src/scripts).

export const PROBE_STAGING_PREFIX = 'staging/ministry-audio/r2-development-probe/';
export const PROBE_FINAL_PREFIX = 'objects/ministry-audio/r2-development-probe/';
const PAYLOAD_BYTES = 64 * 1024;
const SAME_KEY_PAUSE_MS = 1_100;
// Well formed, but it cannot be the ETag (an MD5 hex digest) of any object written by this run.
const WRONG_ETAG = `"${'0'.repeat(32)}"`;

export interface ProbeObject {
  etag: string;
  length: number;
  contentType?: string;
  cacheControl?: string;
  contentEncoding?: string;
  contentDisposition?: string;
}
export type PutOutcome = { kind: 'created'; etag: string } | { kind: 'exists' } | { kind: 'error'; code: string };
export type CopyOutcome = { kind: 'created'; etag?: string } | { kind: 'precondition' } | { kind: 'missing' } | { kind: 'error'; code: string };
export type SealOutcome = { kind: 'sealed'; etag: string } | { kind: 'rejected'; code: string };

export interface CopyProbeDeps {
  /** Create-only upload (If-None-Match: *). */
  put(key: string, bytes: Uint8Array): Promise<PutOutcome>;
  head(key: string): Promise<ProbeObject | undefined>;
  read(key: string): Promise<Uint8Array | undefined>;
  /** The exact promotion request of 'copy' mode: source If-Match plus create-only destination. */
  copy(stagingKey: string, finalKey: string, sourceEtag: string): Promise<CopyOutcome>;
  /** The real adapter, in copy mode. */
  seal(stagingKey: string, finalKey: string, manifest: StemManifest): Promise<SealOutcome>;
  remove(key: string): Promise<void>;
  newId(): string;
  /** Spacing between writes to one key, so a rate limit on a hot key is not read as a protection failure. */
  pause?(ms: number): Promise<void>;
}

export type CheckArea = 'destination' | 'source' | 'integrity' | 'idempotency' | 'concurrency';
export interface Check {
  area: CheckArea;
  name: string;
  status: 'PASS' | 'FAIL';
  detail?: string;
}
export interface ProbeReport {
  checks: Check[];
  /** A copy replaced an object that already existed. */
  overwriteDetected: boolean;
  stoppedEarly: boolean;
  cleanup: 'OK' | 'FAILED';
  keysCovered: number;
}

class ProbeFailure extends Error {}
class Halt extends Error {}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const short = (value: string) => value.replace(/"/g, '').slice(0, 10);

function variant(seed: number): { bytes: Buffer; manifest: StemManifest; sha256: string } {
  const { bytes, manifest } = wavOfSize(PAYLOAD_BYTES);
  // A different first sample gives a different, still valid, WAV.
  bytes.writeInt16LE(seed, 44);
  const sha256 = sha(bytes);
  return { bytes, manifest: { ...manifest, sha256 }, sha256 };
}

function sameObject(a: ProbeObject, b: ProbeObject): boolean {
  return a.etag === b.etag && a.length === b.length && a.contentType === b.contentType &&
    a.cacheControl === b.cacheControl && a.contentEncoding === b.contentEncoding &&
    a.contentDisposition === b.contentDisposition;
}

export async function runCopyImmutability(deps: CopyProbeDeps): Promise<ProbeReport> {
  const checks: Check[] = [];
  const keys = new Set<string>();
  let overwriteDetected = false;
  let stoppedEarly = false;

  const newRecording = () => {
    const id = createHash('sha256').update(deps.newId()).digest('hex');
    const staging = `${PROBE_STAGING_PREFIX}${id}/vocals/1.wav`;
    const final = `${PROBE_FINAL_PREFIX}${id}/vocals.wav`;
    // Registered before anything is written so cleanup always covers what this run could have created.
    keys.add(staging).add(final);
    return { staging, final };
  };
  const expect = (condition: boolean, message: string) => {
    if (!condition) throw new ProbeFailure(message);
  };
  const step = async (area: CheckArea, name: string, run: () => Promise<string | void>) => {
    try {
      const detail = await run();
      checks.push({ area, name, status: 'PASS', ...(detail ? { detail } : {}) });
    } catch (error) {
      // Only our own assertions carry text. Provider or transport errors are reduced to a generic label.
      checks.push({ area, name, status: 'FAIL', detail: error instanceof ProbeFailure ? error.message : 'unexpected error' });
      throw new Halt();
    }
  };
  const seed = async (key: string, content: { bytes: Buffer }): Promise<string> => {
    const put = await deps.put(key, content.bytes);
    expect(put.kind === 'created', `synthetic object was not created (${put.kind})`);
    return (put as { etag: string }).etag;
  };
  const inconclusive = (outcome: CopyOutcome) => {
    if (outcome.kind === 'error' && outcome.code === '429') {
      throw new ProbeFailure('INCONCLUSIVE: provider rate limit (429) on a contested key; not a protection result, rerun the probe');
    }
  };
  const metadataOk = (object: ProbeObject) =>
    object.contentType === 'audio/wav' && object.cacheControl === 'private, no-store' &&
    !object.contentEncoding && !object.contentDisposition;
  const unchanged = async (key: string, before: ProbeObject, expectedSha: string) => {
    const after = await deps.head(key);
    expect(after !== undefined && sameObject(before, after), 'object ETag or metadata changed');
    const body = await deps.read(key);
    expect(body !== undefined && sha(body) === expectedSha, 'object content changed');
  };

  try {
    // 1-2. Occupied destination (content A) and a different verified staging object (content B).
    const occupied = newRecording();
    const a = variant(101);
    const b = variant(202);
    expect(a.sha256 !== b.sha256, 'internal: probe contents must differ');
    let headA!: ProbeObject;
    let headB!: ProbeObject;
    await step('integrity', 'destination A and staging B created with distinct content', async () => {
      const etagA = await seed(occupied.final, a);
      const etagB = await seed(occupied.staging, b);
      const foundA = await deps.head(occupied.final);
      const foundB = await deps.head(occupied.staging);
      expect(foundA?.etag === etagA && foundB?.etag === etagB && etagA !== etagB, 'ETags of the seeded objects are not distinct');
      const bodyA = await deps.read(occupied.final);
      expect(bodyA !== undefined && sha(bodyA) === a.sha256, 'seeded destination content differs');
      headA = foundA!;
      headB = foundB!;
      return `A sha ${a.sha256.slice(0, 12)} etag ${short(headA.etag)}; B sha ${b.sha256.slice(0, 12)} etag ${short(headB.etag)}`;
    });

    // 3-5. Promote B onto the key held by A: must be rejected and leave A exactly as it was.
    await step('destination', 'copy onto an occupied destination is rejected with 412', async () => {
      const outcome = await deps.copy(occupied.staging, occupied.final, headB.etag);
      inconclusive(outcome);
      if (outcome.kind === 'created') {
        overwriteDetected = true;
        throw new ProbeFailure('OVERWRITE: the copy replaced an existing destination');
      }
      expect(outcome.kind === 'precondition', `expected 412, got ${outcome.kind}${outcome.kind === 'error' ? ` ${outcome.code}` : ''}`);
    });
    await step('destination', 'destination content, ETag and metadata are unchanged after the rejected copy', async () => {
      await unchanged(occupied.final, headA, a.sha256);
      return `sha ${a.sha256.slice(0, 12)} etag ${short(headA.etag)} still current`;
    });
    await step('source', 'staging source is untouched by the rejected copy', async () => {
      await unchanged(occupied.staging, headB, b.sha256);
    });

    // 6. Invalid source condition: rejected whether or not the destination is free.
    await step('source', 'invalid source ETag onto an occupied destination is rejected and changes nothing', async () => {
      await deps.pause?.(SAME_KEY_PAUSE_MS);
      const outcome = await deps.copy(occupied.staging, occupied.final, WRONG_ETAG);
      inconclusive(outcome);
      if (outcome.kind === 'created') {
        overwriteDetected = true;
        throw new ProbeFailure('OVERWRITE: a copy with a wrong source ETag replaced the destination');
      }
      expect(outcome.kind === 'precondition', `expected 412, got ${outcome.kind}`);
      await unchanged(occupied.final, headA, a.sha256);
    });
    await step('source', 'invalid source ETag onto a free destination is rejected and creates nothing', async () => {
      const free = newRecording();
      const outcome = await deps.copy(occupied.staging, free.final, WRONG_ETAG);
      expect(outcome.kind !== 'created', 'a copy with a wrong source ETag created the destination');
      expect(outcome.kind === 'precondition', `expected 412, got ${outcome.kind}`);
      expect((await deps.head(free.final)) === undefined, 'the free destination exists after a rejected copy');
      await unchanged(occupied.staging, headB, b.sha256);
    });

    // The adapter, in copy mode, must also refuse to replace A with a verified staging object B.
    // The adapter verifies an existing final object before promoting, so this proves that pre-check (409),
    // not the copy condition, which the raw copies above exercise.
    await step('destination', 'adapter seal onto an occupied destination answers 409 without changing it', async () => {
      const outcome = await deps.seal(occupied.staging, occupied.final, b.manifest);
      expect(outcome.kind === 'rejected' && outcome.code === '409', 'adapter did not answer 409 for a different final object');
      await unchanged(occupied.final, headA, a.sha256);
      return `adapter answered ${(outcome as { code: string }).code}`;
    });

    // 7. Idempotent promotion of already verified content.
    const promoted = newRecording();
    const c = variant(303);
    let etagC!: string;
    let headPromoted!: ProbeObject;
    await step('integrity', 'first promotion creates the destination with the verified bytes and fixed metadata', async () => {
      etagC = await seed(promoted.staging, c);
      const outcome = await deps.copy(promoted.staging, promoted.final, etagC);
      expect(outcome.kind === 'created', `promotion to a free destination answered ${outcome.kind}`);
      if (outcome.kind === 'created' && outcome.etag !== undefined) {
        expect(outcome.etag.replace(/"/g, '') === etagC.replace(/"/g, ''), 'copy ETag differs from the verified staging ETag');
      }
      const head = await deps.head(promoted.final);
      expect(head !== undefined && head.etag === etagC && head.length === c.bytes.length, 'promoted object ETag or size differs');
      expect(metadataOk(head!), 'promoted metadata is not the fixed audio/wav private no-store');
      const body = await deps.read(promoted.final);
      expect(body !== undefined && sha(body) === c.sha256, 'promoted content differs from the verified staging bytes');
      headPromoted = head!;
      return `sha ${c.sha256.slice(0, 12)} etag ${short(etagC)}`;
    });
    await step('idempotency', 'repeating the same raw promotion is rejected and leaves the object identical', async () => {
      await deps.pause?.(SAME_KEY_PAUSE_MS);
      const outcome = await deps.copy(promoted.staging, promoted.final, etagC);
      inconclusive(outcome);
      if (outcome.kind === 'created') {
        overwriteDetected = true;
        throw new ProbeFailure('OVERWRITE: a repeated promotion rewrote the existing destination');
      }
      expect(outcome.kind === 'precondition', `expected 412, got ${outcome.kind}`);
      await unchanged(promoted.final, headPromoted, c.sha256);
    });
    await step('idempotency', 'adapter seal of an already promoted object returns the same receipt, twice', async () => {
      const first = await deps.seal(promoted.staging, promoted.final, c.manifest);
      const second = await deps.seal(promoted.staging, promoted.final, c.manifest);
      expect(first.kind === 'sealed' && second.kind === 'sealed', 'adapter rejected a verified existing object');
      expect((first as { etag: string }).etag === etagC && (second as { etag: string }).etag === etagC, 'adapter receipt differs');
      await unchanged(promoted.final, headPromoted, c.sha256);
    });
    await step('idempotency', 'adapter seal of fresh staging promotes once and repeats with the same receipt', async () => {
      const fresh = newRecording();
      const d = variant(404);
      const etagD = await seed(fresh.staging, d);
      const first = await deps.seal(fresh.staging, fresh.final, d.manifest);
      expect(first.kind === 'sealed' && first.etag === etagD, 'adapter did not promote the verified staging object');
      const head = await deps.head(fresh.final);
      expect(head !== undefined && head.etag === etagD && metadataOk(head), 'sealed object ETag or metadata differs');
      const second = await deps.seal(fresh.staging, fresh.final, d.manifest);
      expect(second.kind === 'sealed' && second.etag === etagD, 'repeated adapter seal changed the receipt');
      const body = await deps.read(fresh.final);
      expect(body !== undefined && sha(body) === d.sha256, 'sealed content differs from the verified bytes');
    });

    // 8. Two concurrent promotions with different content onto one free destination.
    await step('concurrency', 'two concurrent promotions to one key: exactly one creates it', async () => {
      const target = newRecording();
      const other = newRecording();
      const x = variant(505);
      const y = variant(606);
      const etagX = await seed(target.staging, x);
      const etagY = await seed(other.staging, y);
      const [first, second] = await Promise.all([
        deps.copy(target.staging, target.final, etagX),
        deps.copy(other.staging, target.final, etagY),
      ]);
      inconclusive(first);
      inconclusive(second);
      const created = [first, second].filter(({ kind }) => kind === 'created').length;
      const rejected = [first, second].filter(({ kind }) => kind === 'precondition').length;
      if (created === 2) {
        overwriteDetected = true;
        throw new ProbeFailure('OVERWRITE: both concurrent promotions reported success');
      }
      expect(created === 1 && rejected === 1, `expected one success and one 412, got ${created} success and ${rejected} 412`);
      const head = await deps.head(target.final);
      const body = await deps.read(target.final);
      expect(head !== undefined && body !== undefined, 'the contested destination is missing');
      const winner = sha(body!);
      const winnerEtag = first.kind === 'created' ? etagX : etagY;
      const winnerSha = first.kind === 'created' ? x.sha256 : y.sha256;
      expect(winner === winnerSha && head!.etag === winnerEtag && metadataOk(head!), 'the contested destination does not match the winning promotion');
      return `one winner (sha ${winnerSha.slice(0, 12)}); single observation, not a proof for every interleaving`;
    });
  } catch (error) {
    if (!(error instanceof Halt)) {
      checks.push({ area: 'integrity', name: 'probe execution', status: 'FAIL', detail: 'unexpected error' });
    }
    stoppedEarly = true;
  }

  // Cleanup removes only the keys this run registered, then confirms each one is gone.
  const removal = await Promise.allSettled([...keys].map((key) => deps.remove(key)));
  const gone = await Promise.allSettled([...keys].map(async (key) => (await deps.head(key)) === undefined));
  const cleanup = removal.every(({ status }) => status === 'fulfilled') &&
    gone.every((result) => result.status === 'fulfilled' && result.value) ? 'OK' : 'FAILED';
  return { checks, overwriteDetected, stoppedEarly, cleanup, keysCovered: keys.size };
}

export function exitCodeForReport(report: ProbeReport): number {
  if (report.cleanup === 'FAILED') return 3;
  return report.checks.some(({ status }) => status === 'FAIL') || report.overwriteDetected ? 1 : 0;
}

export function formatReport(report: ProbeReport): string[] {
  const lines = ['M22-C.3B CopyObject immutability probe. Single observations on synthetic objects under r2-development-probe/.'];
  for (const check of report.checks) {
    lines.push(`${check.status} [${check.area}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  if (report.stoppedEarly) lines.push('STOPPED at the first failure. Remaining checks were not run.');
  if (report.overwriteDetected) lines.push('FAIL: an existing destination was overwritten. Do not run the large profile in copy mode.');
  lines.push(`cleanup: ${report.cleanup} (${report.keysCovered} synthetic keys covered)`);
  const failed = exitCodeForReport(report) !== 0;
  lines.push(failed ? 'RESULT: FAIL' : 'RESULT: PASS — destination protection held in every scenario.');
  return lines;
}
