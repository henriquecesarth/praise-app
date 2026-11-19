import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import {
  executeProfile, exitCodeFor, formatResults, parseProfile, type BenchDeps, type BenchStorage, type Sampler,
} from '../src/scripts/m22c-r2-seal-bench-core';

// Development-only, sequential, single-observation benchmark of the private R2 adapter.
// Usage (from backend/): npx --no-install tsx scripts/m22c-r2-seal-bench.ts --profile quick
// It never starts the large profile by itself. Only this run's own synthetic keys are written and removed.

const SAMPLE_INTERVAL_MS = 100;
const IO_TIMEOUT_MS = 120_000;
const SNAPSHOT_PREFIX = 'louvaio-r2-';
const MIB = 1024 * 1024;

function createSampler(): Sampler {
  let timer: NodeJS.Timeout | undefined;
  let rssPeak = 0;
  let diskPeak: number | undefined;
  let baseline = new Set<string>();
  let sampling = false;
  let generation = 0;
  const sample = async () => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    if (sampling) return;
    sampling = true;
    const mine = generation;
    try {
      // Best effort: the adapter snapshots a verified copy to <tmp>/louvaio-r2-*/verified.wav during seal.
      // Directories that existed before this size started (other processes, old leftovers) are ignored.
      let total = 0;
      let seen = false;
      for (const name of await readdir(tmpdir())) {
        if (!name.startsWith(SNAPSHOT_PREFIX) || baseline.has(name)) continue;
        try {
          total += (await stat(join(tmpdir(), name, 'verified.wav'))).size;
          seen = true;
        } catch {
          // The snapshot may already be gone.
        }
      }
      // A sample that outlived its size (generation changed) must not write into the next size's peak.
      if (seen && mine === generation) diskPeak = Math.max(diskPeak ?? 0, total);
    } catch {
      // Unreadable temp directory: leave the disk figure as not measured.
    } finally {
      sampling = false;
    }
  };
  return {
    start() {
      generation += 1;
      sampling = false;
      rssPeak = 0;
      diskPeak = undefined;
      try {
        baseline = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(SNAPSHOT_PREFIX)));
      } catch {
        baseline = new Set();
      }
      void sample();
      timer = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      generation += 1;
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
      return { rssPeakBytes: rssPeak, tempDiskPeakBytes: diskPeak };
    },
  };
}

async function run() {
  if (process.env.M22C_R2_LIVE_TESTS !== '1' || process.env.M22C_R2_BENCH !== '1' ||
    process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    console.log('BLOCKED — the seal benchmark needs M22C_R2_LIVE_TESTS=1, M22C_R2_BENCH=1 and an authorized development bucket.');
    process.exitCode = 2;
    return;
  }
  if (typeof AbortSignal.any !== 'function') {
    console.log('REFUSED — Node 20.3 or newer is required (AbortSignal.any).');
    process.exitCode = 2;
    return;
  }
  const parsed = parseProfile(process.argv.slice(2));
  if ('error' in parsed) {
    console.log(`REFUSED — ${parsed.error}`);
    process.exitCode = 2;
    return;
  }

  const { R2StemStorage } = await import('../src/features/ministry_audio/r2-storage');
  type SealDiagnosticEvent = import('../src/features/ministry_audio/r2-storage').SealDiagnosticEvent;
  const config = getR2DevelopmentConfig(process.env);
  // Phase timings from the adapter: durations and sizes only, never keys, URLs or content.
  const diagnostics = (event: SealDiagnosticEvent) => {
    const parts = [`DIAG ${event.phase}`, `${Math.round(event.ms)} ms`];
    if (event.during) parts.push(`during ${event.during}`);
    if (event.bytes !== undefined && event.ms > 0) parts.push(`${(event.bytes / MIB / (event.ms / 1000)).toFixed(2)} MiB/s over ${(event.bytes / MIB).toFixed(1)} MiB`);
    if (event.waitMs !== undefined) parts.push(`network wait ${Math.round(event.waitMs)} ms`, `sha256 ${Math.round(event.hashMs ?? 0)} ms`, `snapshot write ${Math.round(event.writeMs ?? 0)} ms`);
    console.log(parts.join(' | '));
  };
  console.log(`promotion mode: ${config.promotion}, read mode: ${config.reader}`);
  const storage: BenchStorage = new R2StemStorage({ ...config, diagnostics });

  // An interrupt never exits the process directly. It cancels network transfers, lets the in-flight step settle
  // (the adapter bounds a seal at 38 s) and lets the normal cleanup remove exactly this run's own two keys.
  const halt = new AbortController();
  const onInterrupt = () => {
    if (halt.signal.aborted) {
      console.error('Cleanup is still in progress. Please wait; it is bounded by the adapter timeouts.');
      return;
    }
    console.error('INTERRUPTED — cancelling transfers, waiting for the in-flight step, then removing own synthetic keys.');
    halt.abort();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(signal, onInterrupt);
  const ioSignal = () => AbortSignal.any([AbortSignal.timeout(IO_TIMEOUT_MS), halt.signal]);

  const deps: BenchDeps = {
    storage,
    async putObject(url, headers, bytes) {
      const response = await fetch(url, {
        method: 'PUT', headers, redirect: 'error', signal: ioSignal(),
        body: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>,
      });
      await response.body?.cancel();
      return response.status;
    },
    async getObject(url, headers) {
      const response = await fetch(url, { headers, redirect: 'error', signal: ioSignal() });
      return { status: response.status, body: response.ok ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array() };
    },
    now: () => performance.now(),
    newId: () => randomUUID(),
    sampler: createSampler(),
    shouldStop: () => halt.signal.aborted,
  };

  const results = await executeProfile(parsed.profile, deps);
  for (const line of formatResults(parsed.profile, results)) console.log(line);
  console.log('RSS and temp disk are sampled every 100 ms in this process (best effort); disk counts new louvaio-r2-* snapshots in the OS temp directory.');
  const cleanupFailed = results.some(({ cleanup }) => cleanup === 'FAILED');
  if (cleanupFailed) {
    console.error('FAIL — cleanup of synthetic keys did not complete. Keys live only under r2-development-probe/. The staging key expires with the bucket lifecycle; the final objects/ key must be removed by that prefix.');
  }
  const base = exitCodeFor(results);
  // 130 only when the interrupt is what stopped the run: every failure is an abort, and something did not complete.
  const stoppedByInterrupt = halt.signal.aborted && base !== 0 &&
    results.every(({ status, failure }) => status !== 'FAILED' || failure?.code === 'AbortError');
  if (unexpectedError) process.exitCode = 1;
  else if (cleanupFailed) process.exitCode = 3;
  else process.exitCode = stoppedByInterrupt ? 130 : base;
}

// Generic messages only: Node's default output could echo a request error. They also force exit code 1.
let unexpectedError = false;
process.on('uncaughtException', () => {
  unexpectedError = true;
  console.error('FAIL — unexpected error in the seal benchmark.');
  process.exitCode = 1;
});
process.on('unhandledRejection', () => {
  unexpectedError = true;
  console.error('FAIL — unexpected rejection in the seal benchmark.');
  process.exitCode = 1;
});

void run().catch(() => {
  console.error('FAIL — seal benchmark. Check configuration without sharing signed URLs.');
  process.exitCode = 1;
});
