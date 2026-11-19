import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import {
  exitCodeForReport, formatReport, PROBE_FINAL_PREFIX, PROBE_STAGING_PREFIX, runCopyImmutability,
  type CopyProbeDeps, type ProbeObject,
} from '../src/scripts/m22c-r2-copy-immutability-core';

// Development-only proof that the CopyObject promotion cannot overwrite an existing final object.
// Usage (from backend/): npx --no-install tsx scripts/m22c-r2-copy-immutability.ts
// It writes only random synthetic objects under r2-development-probe/ of the development bucket and removes
// exactly the keys of this run. It never touches ministry data and never runs the large profile.

const REQUEST_TIMEOUT_MS = 20_000;

function statusOf(error: unknown): number | undefined {
  if (error instanceof S3ServiceException) return error.$metadata.httpStatusCode;
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? (error as { statusCode: unknown }).statusCode : undefined;
  return typeof status === 'number' ? status : undefined;
}

function isProbeKey(key: string): boolean {
  return (key.startsWith(PROBE_STAGING_PREFIX) || key.startsWith(PROBE_FINAL_PREFIX)) &&
    /^[A-Za-z0-9/._-]+$/.test(key) && !key.includes('..');
}

async function run() {
  if (process.env.M22C_R2_LIVE_TESTS !== '1' || process.env.M22C_R2_COPY_IMMUTABILITY !== '1' ||
    process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    console.log('BLOCKED — the immutability probe needs M22C_R2_LIVE_TESTS=1, M22C_R2_COPY_IMMUTABILITY=1 and an authorized development bucket.');
    process.exitCode = 2;
    return;
  }
  if (typeof AbortSignal.any !== 'function') {
    console.log('REFUSED — Node 20.3 or newer is required (AbortSignal.any).');
    process.exitCode = 2;
    return;
  }

  const { R2StemStorage, createR2Client, buildPromotionCopyCommand } = await import('../src/features/ministry_audio/r2-storage');
  const config = getR2DevelopmentConfig(process.env);
  const { bucket } = config;
  const client = createR2Client(config);
  // The adapter under test is always built in copy mode here. The process default stays 'upload'.
  const storage = new R2StemStorage({ ...config, promotion: 'copy' });
  console.log('promotion mode under test: copy');

  // An interrupt cancels in-flight transfers; the cleanup that follows uses only its own timeout.
  const halt = new AbortController();
  const onInterrupt = () => {
    if (halt.signal.aborted) return;
    console.error('INTERRUPTED — cancelling, then removing this run\'s own synthetic keys.');
    halt.abort();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(signal, onInterrupt);
  const op = () => ({ abortSignal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), halt.signal]) });
  const own = () => ({ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const guard = (key: string) => {
    if (!isProbeKey(key)) throw new Error('Refusing a key outside r2-development-probe/.');
  };
  const describe = (head: { ETag?: string; ContentLength?: number; ContentType?: string; CacheControl?: string; ContentEncoding?: string; ContentDisposition?: string }): ProbeObject => ({
    etag: head.ETag ?? '',
    length: head.ContentLength ?? -1,
    contentType: head.ContentType,
    cacheControl: head.CacheControl,
    contentEncoding: head.ContentEncoding,
    contentDisposition: head.ContentDisposition,
  });

  const deps: CopyProbeDeps = {
    async put(key, bytes) {
      guard(key);
      try {
        const result = await client.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length,
          ContentType: 'audio/wav', CacheControl: 'private, no-store', IfNoneMatch: '*',
        }), op());
        return result.ETag ? { kind: 'created', etag: result.ETag } : { kind: 'error', code: 'no-etag' };
      } catch (error) {
        const status = statusOf(error);
        return status === 412 ? { kind: 'exists' } : { kind: 'error', code: String(status ?? 'network') };
      }
    },
    async head(key) {
      guard(key);
      try {
        return describe(await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), own()));
      } catch (error) {
        if (statusOf(error) === 404) return undefined;
        throw error;
      }
    },
    async read(key) {
      guard(key);
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), op());
        return await result.Body?.transformToByteArray();
      } catch (error) {
        if (statusOf(error) === 404) return undefined;
        throw error;
      }
    },
    async copy(stagingKey, finalKey, sourceEtag) {
      guard(stagingKey);
      guard(finalKey);
      try {
        const result = await client.send(buildPromotionCopyCommand(bucket, stagingKey, finalKey, sourceEtag), op());
        return { kind: 'created', etag: result.CopyObjectResult?.ETag };
      } catch (error) {
        const status = statusOf(error);
        if (status === 412) return { kind: 'precondition' };
        if (status === 404) return { kind: 'missing' };
        return { kind: 'error', code: String(status ?? 'network') };
      }
    },
    async seal(stagingKey, finalKey, manifest) {
      guard(stagingKey);
      guard(finalKey);
      try {
        const receipt = await storage.seal(stagingKey, finalKey, manifest);
        return { kind: 'sealed', etag: receipt.etag };
      } catch (error) {
        return { kind: 'rejected', code: String(statusOf(error) ?? 'error') };
      }
    },
    async remove(key) {
      guard(key);
      await storage.remove(key);
    },
    newId: () => randomUUID(),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  const report = await runCopyImmutability(deps);
  for (const line of formatReport(report)) console.log(line);
  const base = exitCodeForReport(report);
  if (report.cleanup === 'FAILED') {
    console.error('FAIL — cleanup did not complete. Run scripts/m22c-r2-probe-inspect.ts (read-only) to list leftovers under r2-development-probe/.');
  }
  if (unexpectedError) process.exitCode = 1;
  else if (base === 3) process.exitCode = 3;
  else process.exitCode = halt.signal.aborted && base !== 0 ? 130 : base;
}

// Generic messages only: Node's default output could echo a request error.
let unexpectedError = false;
process.on('uncaughtException', () => {
  unexpectedError = true;
  console.error('FAIL — unexpected error in the immutability probe.');
  process.exitCode = 1;
});
process.on('unhandledRejection', () => {
  unexpectedError = true;
  console.error('FAIL — unexpected rejection in the immutability probe.');
  process.exitCode = 1;
});

void run().catch(() => {
  console.error('FAIL — immutability probe. Check configuration without sharing credentials.');
  process.exitCode = 1;
});
