import { createReadStream } from 'node:fs';
import { mkdtemp, open, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAbortSignal, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../../middleware/error-handler';
import {
  assertDirectStorageKey,
  assertFinalKey,
  assertSealKeys,
  assertStagingKey,
  objectConflict,
  uploadInvalid,
  uploadMissing,
  type DirectStemStorage,
  type ObjectReceipt,
  type SealOptions,
  type SignedObjectRequest,
} from './direct-storage';
import { isValidStoredStem, mp3FactsMatch, mp3FactsOf, stemExtension, stemMime, verifyStemBytes, type StoredStem } from './stem-codec';
import { readRanged } from './ranged-reader';
import type { VerifyStats } from './storage';
import type { Mp3Facts } from './direct-storage';

// Timing and size facts only. Never keys, URLs, headers or content.
export interface SealDiagnosticEvent {
  phase: string;
  ms: number;
  bytes?: number;
  waitMs?: number;
  hashMs?: number;
  writeMs?: number;
  during?: string;
}

// 'upload' verifies a snapshot of the staging bytes and uploads it as the final object (default, validated live).
// 'copy' verifies the staging bytes in a single read and promotes them with a source-conditional CopyObject.
export type R2Promotion = 'upload' | 'copy';

// 'stream' reads an object with one GET (default). 'ranged' reads it with a few ordered, bounded ranged GETs that
// are each pinned to the object's ETag, so the bytes hashed are always those of one immutable version.
export type R2Reader = 'stream' | 'ranged';

interface R2StemStorageOptions {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  promotion?: R2Promotion;
  reader?: R2Reader;
  /** Ranged reads only. Defaults to 4 MiB parts and 4 connections per seal. */
  rangePartBytes?: number;
  rangeConcurrency?: number;
  diagnostics?: (event: SealDiagnosticEvent) => void;
}

interface SealProgress {
  phase: string;
}

type ObjectFacts = Pick<
  GetObjectCommandOutput,
  'ETag' | 'ContentLength' | 'ContentType' | 'CacheControl' | 'ContentEncoding' | 'ContentDisposition' | 'LastModified'
> & { mp3?: Mp3Facts };

const MIB = 1024 * 1024;
const DEFAULT_RANGE_PART_BYTES = 4 * MIB;
const DEFAULT_RANGE_CONCURRENCY = 4;
const WAV_TYPE = 'audio/wav';
const PRIVATE_CACHE = 'private, no-store';
const MAX_SEAL_OPERATIONS = 2;
const SEAL_TIMEOUT_MS = 38_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PRESIGN_SECONDS = 300;

// Carries the AppError of a failed ranged read through the verification loop unchanged.
class RangedReadFailure extends Error {
  constructor(readonly failure: AppError) {
    super('Ranged read failed.');
  }
}

function receiptFor(etag: string | undefined, mp3?: Mp3Facts): ObjectReceipt {
  if (!etag || !/^"[A-Za-z0-9._:-]{1,128}"$/.test(etag) || etag.at(-1) !== '"') throw objectConflict();
  return mp3 ? { etag, mp3 } : { etag };
}

function assertExpiry(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_PRESIGN_SECONDS) {
    throw new AppError(400, 'Prazo de acesso ao áudio inválido.');
  }
}

function unavailable(): AppError {
  return new AppError(503, 'O armazenamento de áudio está temporariamente indisponível.');
}

function asStorageError(error: unknown): AppError {
  return error instanceof AppError ? error : unavailable();
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) return false;
  // A HEAD error may have no response body, so the SDK uses the HTTP status as its name.
  return ['NoSuchKey', 'NotFound', '404', 'UnknownError'].includes(error.name);
}

function isPrecondition(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412;
}

function matchesManifest(
  object: Pick<GetObjectCommandOutput, 'ContentLength' | 'ContentType' | 'CacheControl' | 'ContentEncoding'>,
  expected: StoredStem,
): boolean {
  // The MIME follows the manifest codec. A compressed MP3 would change the hashed bytes, so it is never accepted;
  // the WAV rule is unchanged (its encoding is checked by the callers that promote an object).
  if (expected.codec === 'mp3_cbr256' && object.ContentEncoding && object.ContentEncoding.toLowerCase() !== 'identity') return false;
  return object.ContentLength === expected.sizeBytes && object.ContentType === stemMime(expected) &&
    object.CacheControl === PRIVATE_CACHE;
}

async function deleteSnapshot(path: string, directory: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await rmdir(directory);
}

// The one client configuration shared by the adapter and the development probes, so probes exercise the same transport.
export function createR2Client(
  { accountId, accessKeyId, secretAccessKey }: Pick<R2StemStorageOptions, 'accountId' | 'accessKeyId' | 'secretAccessKey'>,
): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
    followRegionRedirects: false,
  });
}

// The exact promotion request used by 'copy' mode: source bound to one ETag, fixed metadata, create-only destination.
export function buildPromotionCopyCommand(
  bucket: string,
  stagingKey: string,
  finalKey: string,
  sourceEtag: string,
  contentType: string = WAV_TYPE,
): CopyObjectCommand {
  const command = new CopyObjectCommand({
    Bucket: bucket,
    Key: finalKey,
    CopySource: `${bucket}/${stagingKey}`,
    CopySourceIfMatch: sourceEtag,
    MetadataDirective: 'REPLACE',
    ContentType: contentType,
    CacheControl: PRIVATE_CACHE,
  });
  // R2's destination condition on CopyObject (beta) uses a Cloudflare header the SDK does not model.
  command.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { headers?: Record<string, string> };
      // Fail closed: without the create-only destination condition the copy must not be sent.
      if (!request.headers) throw new Error('R2 copy request without headers.');
      request.headers['cf-copy-destination-if-none-match'] = '*';
      return next(args);
    },
    { step: 'build', name: 'r2CopyDestinationCreateOnly' },
  );
  return command;
}

export class R2StemStorage implements DirectStemStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private activeSeals = 0;
  private readonly promotion: R2Promotion;
  private readonly reader: R2Reader;
  private readonly rangePartBytes: number;
  private readonly rangeConcurrency: number;
  private readonly diagnostics?: (event: SealDiagnosticEvent) => void;

  constructor({
    accountId, bucket, accessKeyId, secretAccessKey, promotion = 'upload', reader = 'stream',
    rangePartBytes = DEFAULT_RANGE_PART_BYTES, rangeConcurrency = DEFAULT_RANGE_CONCURRENCY, diagnostics,
  }: R2StemStorageOptions) {
    if ((promotion !== 'upload' && promotion !== 'copy') || (reader !== 'stream' && reader !== 'ranged') ||
        !Number.isInteger(rangePartBytes) || rangePartBytes < 1 || rangePartBytes > 16 * MIB ||
        !Number.isInteger(rangeConcurrency) || rangeConcurrency < 1 || rangeConcurrency > 8) {
      throw new Error('Configuração do armazenamento de áudio inválida.');
    }
    this.promotion = promotion;
    this.reader = reader;
    this.rangePartBytes = rangePartBytes;
    this.rangeConcurrency = rangeConcurrency;
    this.diagnostics = diagnostics;
    if (!/^[a-f0-9]{32}$/.test(accountId) || accountId.length !== 32 ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || bucket !== bucket.trim() ||
        !accessKeyId || !secretAccessKey) {
      throw new Error('Configuração do armazenamento de áudio inválida.');
    }
    this.bucket = bucket;
    this.client = createR2Client({ accountId, accessKeyId, secretAccessKey });
  }

  async signUpload(key: string, expected: StoredStem, expiresInSeconds: number): Promise<SignedObjectRequest> {
    assertStagingKey(key, expected.id, isValidStoredStem(expected) ? stemExtension(expected) : 'wav');
    assertExpiry(expiresInSeconds);
    if (!isValidStoredStem(expected)) throw uploadInvalid();
    const headers = { 'cache-control': PRIVATE_CACHE, 'content-type': stemMime(expected), 'if-none-match': '*' };
    try {
      const url = await getSignedUrl(this.client, this.putCommand(key, expected), {
        expiresIn: expiresInSeconds,
        // Fetch supplies Content-Length for the Blob. Script only sets the other signed headers.
        signableHeaders: new Set([...Object.keys(headers), 'content-length']),
      });
      return { url, headers };
    } catch {
      throw unavailable();
    }
  }

  async seal(stagingKey: string, finalKey: string, expected: StoredStem, options: SealOptions = {}): Promise<ObjectReceipt> {
    assertSealKeys(stagingKey, finalKey, expected.id, isValidStoredStem(expected) ? stemExtension(expected) : 'wav');
    if (!isValidStoredStem(expected)) throw uploadInvalid();
    if (this.activeSeals >= MAX_SEAL_OPERATIONS) throw unavailable();
    this.activeSeals++;
    const started = performance.now();
    const progress: SealProgress = { phase: 'final-probe' };
    const signal = AbortSignal.timeout(SEAL_TIMEOUT_MS);
    // A persisted verification only helps the copy promotion: the upload promotion needs the verified bytes on disk.
    const copying = this.promotion === 'copy';
    // An MP3 hint is usable only with the facts of that same verification, and only when they describe this very stem.
    const offered = copying ? options.verified : undefined;
    const hint = offered && (expected.codec === 'pcm_s16le' || mp3FactsMatch(expected, offered.mp3)) ? offered : undefined;
    try {
      let existing: ObjectFacts | undefined;
      if (hint) {
        // A final object whose ETag is the verified staging ETag, with the fixed metadata, is the promoted object:
        // only this service can write the final key, and a copy keeps the MD5 ETag of the verified bytes.
        const probe = await this.probeFinalByEtag(finalKey, expected, hint.etag, signal, progress);
        this.emit({ phase: 'final-probe', ms: performance.now() - started });
        if (typeof probe !== 'string') return receiptFor(probe.etag, hint.mp3);
        existing = probe === 'absent' ? undefined : await this.verifyObject(finalKey, expected, signal, { invalid: 'conflict', progress });
      } else {
        existing = await this.verifyObject(finalKey, expected, signal, { invalid: 'conflict', progress });
        this.emit({ phase: 'final-probe', ms: performance.now() - started });
      }
      if (existing) return receiptFor(existing.ETag, existing.mp3);
      return await (copying
        ? this.sealByCopy(stagingKey, finalKey, expected, signal, progress, { ...options, verified: hint })
        : this.sealFromStaging(stagingKey, finalKey, expected, signal, progress));
    } catch (error) {
      // A seal that hits the budget is aborted by the signal; record where the time was being spent.
      if (signal.aborted) this.emit({ phase: 'budget-abort', during: progress.phase, ms: performance.now() - started });
      throw asStorageError(error);
    } finally {
      this.activeSeals--;
    }
  }

  private emit(event: SealDiagnosticEvent): void {
    try {
      this.diagnostics?.(event);
    } catch {
      // Diagnostics must never change the outcome of a seal.
    }
  }

  async assertObject(key: string, expected: StoredStem, receipt: ObjectReceipt): Promise<void> {
    assertFinalKey(key, expected.id, isValidStoredStem(expected) ? stemExtension(expected) : 'wav');
    const { etag } = receiptFor(receipt.etag);
    try {
      const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: etag }), {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (object.ETag !== etag || !matchesManifest(object, expected)) throw objectConflict();
    } catch (error) {
      if (isMissing(error) || isPrecondition(error)) throw objectConflict();
      throw asStorageError(error);
    }
  }

  async signDownload(key: string, receipt: ObjectReceipt, expiresInSeconds: number): Promise<SignedObjectRequest> {
    assertFinalKey(key, undefined, key.endsWith('.mp3') ? 'mp3' : 'wav');
    assertExpiry(expiresInSeconds);
    const { etag } = receiptFor(receipt.etag);
    const headers = { 'if-match': etag };
    try {
      const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: etag }), {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(Object.keys(headers)),
      });
      return { url, headers };
    } catch {
      throw unavailable();
    }
  }

  async remove(key: string): Promise<void> {
    assertDirectStorageKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (!isMissing(error)) throw unavailable();
    }
  }

  private putCommand(key: string, expected: StoredStem, body?: Readable): PutObjectCommand {
    return new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      CacheControl: PRIVATE_CACHE,
      ContentType: stemMime(expected),
      ContentLength: expected.sizeBytes,
      IfNoneMatch: '*',
    });
  }

  // 'upload' marks bytes the client supplied (staging, answered with 422); 'conflict' marks an object this service
  // already wrote (final, answered with 409). The snapshot, when given, receives a copy of the verified bytes.
  private async verifyObject(
    key: string,
    expected: StoredStem,
    signal: AbortSignal,
    context: { invalid: 'upload' | 'conflict'; snapshot?: FileHandle; progress?: SealProgress },
  ): Promise<ObjectFacts | undefined> {
    // An object that fits in one part gains nothing from ranges, so it keeps the plain GET.
    if (this.reader === 'ranged' && expected.sizeBytes > this.rangePartBytes) return this.verifyObjectRanged(key, expected, signal, context);
    const { invalid: kind, snapshot, progress } = context;
    signal.throwIfAborted();
    const label = kind === 'upload' ? 'staging' : 'final';
    if (progress) progress.phase = `${label}-get`;
    const requested = performance.now();
    let object: GetObjectCommandOutput;
    try {
      object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    if (kind === 'upload') this.emit({ phase: 'staging-headers', ms: performance.now() - requested });
    if (!(object.Body instanceof Readable)) throw unavailable();
    const body = addAbortSignal(signal, object.Body);
    try {
      const invalid = kind === 'upload' ? () => uploadInvalid(expected.codec) : objectConflict;
      if (!matchesManifest(object, expected)) throw invalid();
      if (progress) progress.phase = `${label}-verify`;
      const stats: VerifyStats | undefined = this.diagnostics && kind === 'upload' ? { waitMs: 0, hashMs: 0, writeMs: 0 } : undefined;
      const verifying = performance.now();
      let result: Awaited<ReturnType<typeof verifyStemBytes>>;
      try {
        result = await verifyStemBytes(body, expected, kind === 'upload' ? 422 : 409, snapshot, stats);
      } catch (error) {
        if (error instanceof AppError) throw invalid();
        throw error;
      }
      if (stats) this.emit({ phase: 'staging-verify', ms: performance.now() - verifying, bytes: expected.sizeBytes, ...stats });
      signal.throwIfAborted();
      const facts = mp3FactsOf(result);
      return facts ? { ...object, mp3: facts } : object;
    } finally {
      body.destroy();
    }
  }

  // Same verification as the single-GET path, but the bytes arrive as ordered ranged reads pinned to one ETag.
  // The HEAD gives the version and its metadata; every part must come back from that same ETag and exact range.
  private async verifyObjectRanged(
    key: string,
    expected: StoredStem,
    signal: AbortSignal,
    { invalid: kind, snapshot, progress }: { invalid: 'upload' | 'conflict'; snapshot?: FileHandle; progress?: SealProgress },
  ): Promise<ObjectFacts | undefined> {
    signal.throwIfAborted();
    const label = kind === 'upload' ? 'staging' : 'final';
    if (progress) progress.phase = `${label}-get`;
    const requested = performance.now();
    let head: HeadObjectCommandOutput;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    if (kind === 'upload') this.emit({ phase: 'staging-headers', ms: performance.now() - requested });
    const invalid = kind === 'upload' ? () => uploadInvalid(expected.codec) : objectConflict;
    if (!matchesManifest(head, expected)) throw invalid();
    const { etag } = receiptFor(head.ETag);
    if (progress) progress.phase = `${label}-verify`;
    const stats: VerifyStats | undefined = this.diagnostics && kind === 'upload' ? { waitMs: 0, hashMs: 0, writeMs: 0 } : undefined;
    const verifying = performance.now();
    const body = Readable.from(readRanged({
      size: expected.sizeBytes,
      partBytes: this.rangePartBytes,
      concurrency: this.rangeConcurrency,
      signal,
      fetchPart: (start, end, partSignal) => this.fetchPart(key, etag, start, end, expected.sizeBytes, partSignal),
    }), { objectMode: true, highWaterMark: 1 });
    try {
      let result: Awaited<ReturnType<typeof verifyStemBytes>>;
      try {
        result = await verifyStemBytes(body, expected, kind === 'upload' ? 422 : 409, snapshot, stats);
      } catch (error) {
        // A read problem keeps its own status (409 or 503). Only a verification mismatch means an invalid upload.
        if (error instanceof RangedReadFailure) throw error.failure;
        if (error instanceof AppError) throw invalid();
        throw error;
      }
      if (stats) this.emit({ phase: 'staging-verify', ms: performance.now() - verifying, bytes: expected.sizeBytes, ...stats });
      signal.throwIfAborted();
      const facts = mp3FactsOf(result);
      return facts ? { ...head, mp3: facts } : head;
    } finally {
      body.destroy();
    }
  }

  private async fetchPart(key: string, etag: string, start: number, end: number, total: number, signal: AbortSignal): Promise<Buffer> {
    try {
      return await this.fetchPartWithRetry(key, etag, start, end, total, signal);
    } catch (error) {
      // Marks read failures so they are not mistaken for a verification mismatch further up.
      throw error instanceof AppError ? new RangedReadFailure(error) : error;
    }
  }

  private async fetchPartWithRetry(key: string, etag: string, start: number, end: number, total: number, signal: AbortSignal): Promise<Buffer> {
    const length = end - start + 1;
    for (let attempt = 0; ; attempt++) {
      let body: Readable | undefined;
      try {
        const part = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}`, IfMatch: etag }),
          { abortSignal: signal },
        );
        if (part.ETag !== etag || part.ContentRange !== `bytes ${start}-${end}/${total}` || part.ContentLength !== length) {
          throw objectConflict();
        }
        if (!(part.Body instanceof Readable)) throw unavailable();
        body = addAbortSignal(signal, part.Body);
        const chunks: Buffer[] = [];
        let received = 0;
        for await (const chunk of body) {
          received += chunk.length;
          // A response longer than the range that was requested is never buffered.
          if (!Buffer.isBuffer(chunk) || received > length) throw objectConflict();
          chunks.push(chunk);
        }
        if (received !== length) throw objectConflict();
        return Buffer.concat(chunks, length);
      } catch (error) {
        // A changed or vanished object is final. Only a transient failure is retried, once and within the budget.
        if (isPrecondition(error) || isMissing(error)) throw objectConflict();
        if (error instanceof AppError || signal.aborted || attempt >= 1) throw error;
      } finally {
        body?.destroy();
      }
    }
  }

  private async probeFinalByEtag(
    finalKey: string,
    expected: StoredStem,
    etag: string,
    signal: AbortSignal,
    progress: SealProgress,
  ): Promise<'absent' | 'other' | ObjectReceipt> {
    signal.throwIfAborted();
    progress.phase = 'final-head';
    let head: HeadObjectCommandOutput;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: finalKey }), { abortSignal: signal });
    } catch (error) {
      if (isMissing(error)) return 'absent';
      throw error;
    }
    if (head.ETag === etag && matchesManifest(head, expected) && !head.ContentEncoding && !head.ContentDisposition) {
      return receiptFor(head.ETag);
    }
    return 'other';
  }

  private async sealFromStaging(
    stagingKey: string,
    finalKey: string,
    expected: StoredStem,
    signal: AbortSignal,
    progress: SealProgress,
  ): Promise<ObjectReceipt> {
    const directory = await mkdtemp(join(tmpdir(), 'louvaio-r2-'));
    const path = join(directory, `verified.${stemExtension(expected)}`);
    try {
      const snapshot = await open(path, 'wx', 0o600);
      let verifiedFacts: Mp3Facts | undefined;
      try {
        const staging = await this.verifyObject(stagingKey, expected, signal, { invalid: 'upload', snapshot, progress });
        if (!staging) throw uploadMissing();
        verifiedFacts = staging.mp3;
      } finally {
        await snapshot.close();
      }
      try {
        progress.phase = 'final-put';
        const putting = performance.now();
        const object = await this.uploadSnapshot(finalKey, expected, signal, path);
        this.emit({ phase: 'final-put', ms: performance.now() - putting, bytes: expected.sizeBytes });
        return receiptFor(object.ETag, verifiedFacts);
      } catch (error) {
        if (!isPrecondition(error)) throw error;
        const existing = await this.verifyObject(finalKey, expected, signal, { invalid: 'conflict', progress });
        if (!existing) throw objectConflict();
        return receiptFor(existing.ETag, existing.mp3);
      }
    } finally {
      await deleteSnapshot(path, directory);
    }
  }

  // The ETag of the staging object whose bytes are verified. A verification persisted by this service is reused only
  // while the live object is still the very same version (ETag and last-modified time) with the manifest's size and
  // metadata. Anything else, including a missing object, goes through a full verification. After a full verification
  // the result is handed back for persistence before promotion starts, so a failed copy never discards it.
  private async verifiedStagingEtag(
    stagingKey: string,
    expected: StoredStem,
    signal: AbortSignal,
    progress: SealProgress,
    { verified, onVerified }: SealOptions,
  ): Promise<{ etag: string; mp3?: Mp3Facts }> {
    if (verified) {
      progress.phase = 'staging-head';
      const reuse = performance.now();
      let head: HeadObjectCommandOutput | undefined;
      try {
        head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: stagingKey }), { abortSignal: signal });
      } catch (error) {
        if (!isMissing(error)) throw error;
        throw uploadMissing();
      }
      if (head.ETag === verified.etag && head.LastModified?.getTime() === verified.lastModified && matchesManifest(head, expected)) {
        this.emit({ phase: 'verified-reuse', ms: performance.now() - reuse });
        const reused = receiptFor(head.ETag).etag;
        return verified.mp3 ? { etag: reused, mp3: verified.mp3 } : { etag: reused };
      }
    }
    const staging = await this.verifyObject(stagingKey, expected, signal, { invalid: 'upload', progress });
    if (!staging) throw uploadMissing();
    const { etag } = receiptFor(staging.ETag);
    // Staging is only ever written by one presigned single-part PUT, so its ETag is the MD5 of the verified bytes.
    // A multipart-style ETag cannot be compared with the copy and is rejected.
    if (etag.includes('-')) throw objectConflict();
    if (onVerified && staging.LastModified && !signal.aborted) {
      const persisting = performance.now();
      progress.phase = 'persist-verification';
      await Promise.race([
        onVerified({ etag, lastModified: staging.LastModified.getTime(), ...(staging.mp3 ? { mp3: staging.mp3 } : {}) }),
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
      ]).catch(() => undefined);
      this.emit({ phase: 'verification-persisted', ms: performance.now() - persisting });
    }
    return staging.mp3 ? { etag, mp3: staging.mp3 } : { etag };
  }

  // Single read of the staging bytes (header, size and SHA-256 verified), then a server-side copy that is only
  // accepted for exactly that staging object (If-Match on the source ETag). The destination is create-only through
  // R2's beta destination condition. Nothing the client reports is trusted and no snapshot touches the disk.
  private async sealByCopy(
    stagingKey: string,
    finalKey: string,
    expected: StoredStem,
    signal: AbortSignal,
    progress: SealProgress,
    options: SealOptions,
  ): Promise<ObjectReceipt> {
    const { etag: stagingEtag, mp3: stagingFacts } = await this.verifiedStagingEtag(stagingKey, expected, signal, progress, options);
    try {
      progress.phase = 'copy';
      const copying = performance.now();
      const copied = await this.client.send(buildPromotionCopyCommand(this.bucket, stagingKey, finalKey, stagingEtag, stemMime(expected)), { abortSignal: signal });
      this.emit({ phase: 'copy', ms: performance.now() - copying, bytes: expected.sizeBytes });
      const returned = copied.CopyObjectResult?.ETag;
      // Tolerate a provider that returns the ETag without quotes in the XML body.
      const receipt = receiptFor(returned && !returned.startsWith('"') ? `"${returned}"` : returned);
      // A byte-identical copy keeps the MD5 ETag. A different value means the copy is not the verified object.
      if (receipt.etag !== stagingEtag) throw objectConflict();
      progress.phase = 'confirm';
      const confirming = performance.now();
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: finalKey, IfMatch: receipt.etag }), { abortSignal: signal });
      this.emit({ phase: 'confirm', ms: performance.now() - confirming });
      // The directive REPLACE must leave no source or client-influenced encoding/disposition on the final object.
      if (head.ETag !== receipt.etag || !matchesManifest(head, expected) || head.ContentEncoding || head.ContentDisposition) {
        throw objectConflict();
      }
      return receiptFor(receipt.etag, stagingFacts);
    } catch (error) {
      // The staging object vanished between verification and copy: the client may upload it again.
      if (isMissing(error)) throw uploadMissing();
      if (!isPrecondition(error)) throw error;
      // Either the final object already exists (a concurrent seal won) or the source changed. Only a fully verified
      // existing final object is accepted; otherwise the caller must retry from a clean state.
      const existing = await this.verifyObject(finalKey, expected, signal, { invalid: 'conflict', progress });
      if (!existing) throw objectConflict();
      return receiptFor(existing.ETag, existing.mp3);
    }
  }

  private async uploadSnapshot(key: string, expected: StoredStem, signal: AbortSignal, path: string) {
    signal.throwIfAborted();
    const body = createReadStream(path, { signal });
    const closed = finished(body, { cleanup: true }).catch(() => undefined);
    try {
      return await this.client.send(this.putCommand(key, expected, body), { abortSignal: signal });
    } finally {
      body.destroy();
      await closed;
    }
  }
}
