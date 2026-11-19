import { createReadStream } from 'node:fs';
import { mkdtemp, open, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAbortSignal, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type GetObjectCommandOutput,
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
  type SignedObjectRequest,
} from './direct-storage';
import { stemSchema, type StemManifest } from './ministry-audio.schema';
import { verifyWav } from './storage';

interface R2StemStorageOptions {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const WAV_TYPE = 'audio/wav';
const PRIVATE_CACHE = 'private, no-store';
const MAX_SEAL_OPERATIONS = 2;
const SEAL_TIMEOUT_MS = 38_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PRESIGN_SECONDS = 300;

function receiptFor(etag: string | undefined): ObjectReceipt {
  if (!etag || !/^"[A-Za-z0-9._:-]{1,128}"$/.test(etag) || etag.at(-1) !== '"') throw objectConflict();
  return { etag };
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
  object: Pick<GetObjectCommandOutput, 'ContentLength' | 'ContentType' | 'CacheControl'>,
  expected: StemManifest,
): boolean {
  return object.ContentLength === expected.sizeBytes && object.ContentType === WAV_TYPE &&
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

export class R2StemStorage implements DirectStemStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private activeSeals = 0;

  constructor({ accountId, bucket, accessKeyId, secretAccessKey }: R2StemStorageOptions) {
    if (!/^[a-f0-9]{32}$/.test(accountId) || accountId.length !== 32 ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || bucket !== bucket.trim() ||
        !accessKeyId || !secretAccessKey) {
      throw new Error('Configuração do armazenamento de áudio inválida.');
    }
    this.bucket = bucket;
    this.client = new S3Client({
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

  async signUpload(key: string, expected: StemManifest, expiresInSeconds: number): Promise<SignedObjectRequest> {
    assertStagingKey(key, expected.id);
    assertExpiry(expiresInSeconds);
    if (!stemSchema.safeParse(expected).success) throw uploadInvalid();
    const headers = { 'cache-control': PRIVATE_CACHE, 'content-type': WAV_TYPE, 'if-none-match': '*' };
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

  async seal(stagingKey: string, finalKey: string, expected: StemManifest): Promise<ObjectReceipt> {
    assertSealKeys(stagingKey, finalKey, expected.id);
    if (!stemSchema.safeParse(expected).success) throw uploadInvalid();
    if (this.activeSeals >= MAX_SEAL_OPERATIONS) throw unavailable();
    this.activeSeals++;
    try {
      const signal = AbortSignal.timeout(SEAL_TIMEOUT_MS);
      const existing = await this.verifyObject(finalKey, expected, signal);
      if (existing) return receiptFor(existing.ETag);
      return await this.sealFromStaging(stagingKey, finalKey, expected, signal);
    } catch (error) {
      throw asStorageError(error);
    } finally {
      this.activeSeals--;
    }
  }

  async assertObject(key: string, expected: StemManifest, receipt: ObjectReceipt): Promise<void> {
    assertFinalKey(key, expected.id);
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
    assertFinalKey(key);
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

  private putCommand(key: string, expected: StemManifest, body?: Readable): PutObjectCommand {
    return new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      CacheControl: PRIVATE_CACHE,
      ContentType: WAV_TYPE,
      ContentLength: expected.sizeBytes,
      IfNoneMatch: '*',
    });
  }

  private async verifyObject(
    key: string,
    expected: StemManifest,
    signal: AbortSignal,
    snapshot?: FileHandle,
  ): Promise<GetObjectCommandOutput | undefined> {
    signal.throwIfAborted();
    let object: GetObjectCommandOutput;
    try {
      object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    if (!(object.Body instanceof Readable)) throw unavailable();
    const body = addAbortSignal(signal, object.Body);
    try {
      const invalid = snapshot ? uploadInvalid : objectConflict;
      if (!matchesManifest(object, expected)) throw invalid();
      try {
        await verifyWav(body, expected, snapshot ? 422 : 409, snapshot);
      } catch (error) {
        if (error instanceof AppError) throw invalid();
        throw error;
      }
      signal.throwIfAborted();
      return object;
    } finally {
      body.destroy();
    }
  }

  private async sealFromStaging(
    stagingKey: string,
    finalKey: string,
    expected: StemManifest,
    signal: AbortSignal,
  ): Promise<ObjectReceipt> {
    const directory = await mkdtemp(join(tmpdir(), 'louvaio-r2-'));
    const path = join(directory, 'verified.wav');
    try {
      const snapshot = await open(path, 'wx', 0o600);
      try {
        if (!(await this.verifyObject(stagingKey, expected, signal, snapshot))) throw uploadMissing();
      } finally {
        await snapshot.close();
      }
      try {
        const object = await this.uploadSnapshot(finalKey, expected, signal, path);
        return receiptFor(object.ETag);
      } catch (error) {
        if (!isPrecondition(error)) throw error;
        const existing = await this.verifyObject(finalKey, expected, signal);
        if (!existing) throw objectConflict();
        return receiptFor(existing.ETag);
      }
    } finally {
      await deleteSnapshot(path, directory);
    }
  }

  private async uploadSnapshot(key: string, expected: StemManifest, signal: AbortSignal, path: string) {
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
