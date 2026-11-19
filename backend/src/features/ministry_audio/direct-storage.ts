import { AppError } from '../../middleware/error-handler';
import { stemIdSchema, type StemManifest } from './ministry-audio.schema';

export interface SignedObjectRequest {
  url: string;
  headers: Record<string, string>;
}

export interface ObjectReceipt {
  etag: string;
}

// Server-computed fact: the staging object identified by this ETag and last-modified time was fully read and its
// header, size and SHA-256 matched the manifest. It is never supplied by a client and is only a hint: the adapter
// re-checks the live object (ETag, time, size, metadata) and falls back to a full verification on any difference.
export interface VerifiedStaging {
  etag: string;
  lastModified: number;
}

export interface SealOptions {
  /** A previously persisted verification of this attempt's staging object. */
  verified?: VerifiedStaging;
  /** Called once a full verification succeeds and before promotion, so a later failure does not lose it. */
  onVerified?: (verified: VerifiedStaging) => Promise<void>;
}

export interface DirectStemStorage {
  signUpload(key: string, expected: StemManifest, expiresInSeconds: number): Promise<SignedObjectRequest>;
  seal(stagingKey: string, finalKey: string, expected: StemManifest, options?: SealOptions): Promise<ObjectReceipt>;
  assertObject(key: string, expected: StemManifest, receipt: ObjectReceipt): Promise<void>;
  signDownload(key: string, receipt: ObjectReceipt, expiresInSeconds: number): Promise<SignedObjectRequest>;
  remove(key: string): Promise<void>;
}

const STAGING_KEY = /^staging\/ministry-audio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\/([a-z]+)\/[1-3]\.wav$/;
const FINAL_KEY = /^objects\/ministry-audio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\/([a-z]+)\.wav$/;

function validKey(key: string, format: RegExp, expectedId?: StemManifest['id']): boolean {
  const match = format.exec(key);
  return !!match && match[0] === key && stemIdSchema.safeParse(match[1]).success &&
    (expectedId === undefined || match[1] === expectedId);
}

function invalidKey(): AppError {
  return new AppError(400, 'Identificador do stem de áudio inválido.');
}

export function assertStagingKey(key: string, expectedId?: StemManifest['id']): void {
  if (!validKey(key, STAGING_KEY, expectedId)) throw invalidKey();
}

export function assertFinalKey(key: string, expectedId?: StemManifest['id']): void {
  if (!validKey(key, FINAL_KEY, expectedId)) throw invalidKey();
}

export function assertSealKeys(stagingKey: string, finalKey: string, expectedId: StemManifest['id']): void {
  assertStagingKey(stagingKey, expectedId);
  assertFinalKey(finalKey, expectedId);
  if (stagingKey.slice('staging/'.length, stagingKey.lastIndexOf('/')) !==
      finalKey.slice('objects/'.length, -'.wav'.length)) {
    throw invalidKey();
  }
}

export function assertDirectStorageKey(key: string): void {
  if (!validKey(key, STAGING_KEY) && !validKey(key, FINAL_KEY)) throw invalidKey();
}

export function objectConflict(): AppError {
  return new AppError(409, 'O stem de áudio não está disponível.');
}

export function uploadMissing(): AppError {
  return new AppError(409, 'O stem de áudio não foi enviado.', { code: 'AUDIO_UPLOAD_MISSING' });
}

export function uploadInvalid(): AppError {
  return new AppError(422, 'O stem WAV não corresponde ao manifesto de áudio.', { code: 'AUDIO_UPLOAD_INVALID' });
}
