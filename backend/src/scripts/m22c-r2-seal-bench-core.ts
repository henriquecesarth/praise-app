import { createHash } from 'node:crypto';
import { MAX_STEM_BYTES, type StemManifest } from '../features/ministry_audio/ministry-audio.schema';

// M22-C.3 development-only benchmark core. No network, credentials or filesystem access happens here:
// every effect is injected, so the logic is testable offline. Excluded from the publish build (src/scripts).

export const MB = 1024 * 1024;
export const SEAL_BUDGET_MS = 38_000;
export const SAMPLE_RATE = 48_000;

export type ProfileName = 'quick' | 'large';

// One run per size. The caps below are enforced in code, not only by convention.
export const PROFILES: Record<ProfileName, readonly number[]> = {
  quick: [1 * MB, 5 * MB, 15 * MB],
  large: [30 * MB, MAX_STEM_BYTES],
};
export const MAX_RUNS_PER_PROFILE = 3;
export const MAX_BYTES_PER_PROFILE = 96 * MB;

export function parseProfile(argv: readonly string[]): { profile: ProfileName } | { error: string } {
  const args = argv.slice();
  if (args.length === 0) return { error: 'An explicit profile is required: --profile quick or --profile large.' };
  let value: string | undefined;
  if (args.length === 2 && args[0] === '--profile') value = args[1];
  else if (args.length === 1 && args[0].startsWith('--profile=')) value = args[0].slice('--profile='.length);
  if (value !== 'quick' && value !== 'large') return { error: 'Unknown or malformed arguments. Use exactly --profile quick or --profile large.' };
  const sizes = PROFILES[value];
  if (sizes.length > MAX_RUNS_PER_PROFILE || sizes.reduce((sum, size) => sum + size, 0) > MAX_BYTES_PER_PROFILE ||
      sizes.some((size) => size > MAX_STEM_BYTES)) {
    return { error: 'Profile exceeds the sample or volume limits.' };
  }
  return { profile: value };
}

export function wavOfSize(targetBytes: number): { bytes: Buffer; manifest: StemManifest } {
  const frames = Math.floor((Math.min(targetBytes, MAX_STEM_BYTES) - 44) / 4);
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.round(2_000 * Math.sin((2 * Math.PI * i * 220) / SAMPLE_RATE));
    bytes.writeInt16LE(sample, 44 + i * 4);
    bytes.writeInt16LE(sample, 46 + i * 4);
  }
  return {
    bytes,
    manifest: {
      id: 'vocals', codec: 'pcm_s16le', sampleRate: SAMPLE_RATE, channels: 2,
      durationSeconds: frames / SAMPLE_RATE, frames,
      sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
    },
  };
}

export interface BenchStorage {
  signUpload(key: string, expected: StemManifest, expiresInSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  seal(stagingKey: string, finalKey: string, expected: StemManifest): Promise<{ etag: string }>;
  signDownload(key: string, receipt: { etag: string }, expiresInSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  remove(key: string): Promise<void>;
}

export interface Sampler {
  start(): void;
  stop(): { rssPeakBytes: number; tempDiskPeakBytes?: number };
}

export interface BenchDeps {
  storage: BenchStorage;
  putObject(url: string, headers: Record<string, string>, bytes: Buffer): Promise<number>;
  getObject(url: string, headers: Record<string, string>): Promise<{ status: number; body: Uint8Array }>;
  now(): number;
  newId(): string;
  sampler: Sampler;
  // True after an interrupt: no further size is started, and the cleanup of the one in flight still runs.
  shouldStop?(): boolean;
}

export interface SizeResult {
  bytes: number;
  status: 'COMPLETED' | 'FAILED' | 'NOT_RUN';
  putMs?: number;
  sealMs?: number;
  getVerifyMs?: number;
  totalMs?: number;
  sealWithinBudget?: boolean;
  rssPeakBytes?: number;
  tempDiskPeakBytes?: number;
  cleanup?: 'OK' | 'FAILED';
  failure?: { phase: string; code: string };
}

function failureOf(phase: string, error: unknown): { phase: string; code: string } {
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? (error as { statusCode: unknown }).statusCode : undefined;
  const name = error instanceof Error ? error.name : 'Error';
  // Only a status or an error class is reported: never messages, which could carry signed URLs.
  return { phase, code: typeof status === 'number' ? String(status) : name };
}

export async function executeProfile(profile: ProfileName, deps: BenchDeps): Promise<SizeResult[]> {
  const results: SizeResult[] = [];
  let stopped = false;
  for (const target of PROFILES[profile]) {
    if (stopped || deps.shouldStop?.()) {
      results.push({ bytes: target, status: 'NOT_RUN' });
      continue;
    }
    const { bytes, manifest } = wavOfSize(target);
    const id = createHash('sha256').update(deps.newId()).digest('hex');
    const stage = `staging/ministry-audio/r2-development-probe/${id}/vocals/1.wav`;
    const final = `objects/ministry-audio/r2-development-probe/${id}/vocals.wav`;
    const result: SizeResult = { bytes: bytes.length, status: 'COMPLETED' };
    const started = deps.now();
    let phase = 'sign';
    let sealStarted: number | undefined;
    deps.sampler.start();
    try {
      const upload = await deps.storage.signUpload(stage, manifest, 300);
      phase = 'put';
      const putStarted = deps.now();
      const putStatus = await deps.putObject(upload.url, { ...upload.headers, 'Content-Length': String(bytes.length) }, bytes);
      if (putStatus < 200 || putStatus > 299) throw Object.assign(new Error('put status'), { statusCode: putStatus });
      result.putMs = deps.now() - putStarted;

      phase = 'seal';
      sealStarted = deps.now();
      const receipt = await deps.storage.seal(stage, final, manifest);
      result.sealMs = deps.now() - sealStarted;
      result.sealWithinBudget = result.sealMs < SEAL_BUDGET_MS;

      phase = 'get';
      const download = await deps.storage.signDownload(final, receipt, 120);
      const getStarted = deps.now();
      const content = await deps.getObject(download.url, download.headers);
      if (content.status < 200 || content.status > 299) throw Object.assign(new Error('get status'), { statusCode: content.status });
      phase = 'verify';
      if (createHash('sha256').update(content.body).digest('hex') !== manifest.sha256) throw new Error('digest mismatch');
      result.getVerifyMs = deps.now() - getStarted;
    } catch (error) {
      result.status = 'FAILED';
      result.failure = failureOf(phase, error);
      if (phase === 'seal' && sealStarted !== undefined) {
        // The adapter aborts a seal at the budget and raises 503, so a seal that failed after almost the
        // whole budget is reported as over budget instead of looking like a provider outage.
        result.sealMs = deps.now() - sealStarted;
        if (result.sealMs >= SEAL_BUDGET_MS * 0.98) result.sealWithinBudget = false;
      }
      // First relevant error or timeout ends the round. There is no automatic retry.
      stopped = true;
    } finally {
      // Cleanup runs on success, error and timeout. Only this run's own two keys are removed.
      const removed = await Promise.allSettled([stage, final].map((key) => deps.storage.remove(key)));
      result.cleanup = removed.every(({ status }) => status === 'fulfilled') ? 'OK' : 'FAILED';
      const sample = deps.sampler.stop();
      result.rssPeakBytes = sample.rssPeakBytes;
      result.tempDiskPeakBytes = sample.tempDiskPeakBytes;
      result.totalMs = deps.now() - started;
    }
    results.push(result);
  }
  return results;
}

const mb = (value: number) => (value / MB).toFixed(1);

export function formatResults(profile: ProfileName, results: readonly SizeResult[]): string[] {
  const lines = [`M22-C.3 seal benchmark, profile ${profile}. Single observations, no percentile is computed.`];
  for (const r of results) {
    if (r.status === 'NOT_RUN') {
      lines.push(`- ${r.bytes} B (${mb(r.bytes)} MiB): NOT_RUN (not started after an earlier error or an interrupt)`);
      continue;
    }
    const ms = (value?: number) => (value === undefined ? 'n/a' : `${Math.round(value)} ms`);
    lines.push(
      `- ${r.bytes} B (${mb(r.bytes)} MiB): ${r.status}` +
      ` | PUT ${ms(r.putMs)} | SEAL ${ms(r.sealMs)} | GET+SHA-256 ${ms(r.getVerifyMs)} | total ${ms(r.totalMs)}` +
      ` | seal within ${SEAL_BUDGET_MS / 1000} s: ${r.sealWithinBudget === undefined ? 'n/a' : r.sealWithinBudget ? 'YES' : 'NO'}` +
      ` | RSS peak ${r.rssPeakBytes === undefined ? 'n/a' : `${mb(r.rssPeakBytes)} MiB`}` +
      ` | temp disk peak ${r.tempDiskPeakBytes === undefined ? 'not measured' : `${mb(r.tempDiskPeakBytes)} MiB`}` +
      ` | cleanup ${r.cleanup ?? 'n/a'}` +
      (r.failure ? ` | FAILED at ${r.failure.phase} (${r.failure.code})` : ''),
    );
  }
  lines.push('Local-to-R2 observations do not reproduce the Vercel runtime and are not a latency guarantee.');
  return lines;
}

export function exitCodeFor(results: readonly SizeResult[]): number {
  if (results.some((r) => r.cleanup === 'FAILED')) return 3;
  return results.every((r) => r.status === 'COMPLETED') ? 0 : 1;
}
