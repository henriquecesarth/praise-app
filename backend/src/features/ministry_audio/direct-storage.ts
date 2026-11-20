import { AppError } from '../../middleware/error-handler';
import { stemIdSchema } from './ministry-audio.schema';
import type { StemExtension, StoredStem } from './stem-codec';

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
  signUpload(key: string, expected: StoredStem, expiresInSeconds: number): Promise<SignedObjectRequest>;
  seal(stagingKey: string, finalKey: string, expected: StoredStem, options?: SealOptions): Promise<ObjectReceipt>;
  assertObject(key: string, expected: StoredStem, receipt: ObjectReceipt): Promise<void>;
  signDownload(key: string, receipt: ObjectReceipt, expiresInSeconds: number): Promise<SignedObjectRequest>;
  remove(key: string): Promise<void>;
}

// Keys are bound to the codec of the validated manifest through their extension; `.wav` keys are the v1 keys.
const STAGING_KEYS: Record<StemExtension, RegExp> = {
  wav: /^staging\/ministry-audio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\/([a-z]+)\/[1-3]\.wav$/,
  mp3: /^staging\/ministry-audio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\/([a-z]+)\/[1-3]\.mp3$/,
};
const FINAL_KEYS: Record<StemExtension, RegExp> = {
  wav: /^objects\/ministry-audio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\/([a-z]+)\.wav$/,
  mp3: /^objects\/ministry-audio\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\/([a-z]+)\.mp3$/,
};

function validKey(key: string, format: RegExp, expectedId?: StoredStem['id']): boolean {
  const match = format.exec(key);
  return !!match && match[0] === key && stemIdSchema.safeParse(match[1]).success &&
    (expectedId === undefined || match[1] === expectedId);
}

function invalidKey(): AppError {
  return new AppError(400, 'Identificador do stem de áudio inválido.');
}

export function assertStagingKey(key: string, expectedId?: StoredStem['id'], extension: StemExtension = 'wav'): void {
  if (!validKey(key, STAGING_KEYS[extension], expectedId)) throw invalidKey();
}

export function assertFinalKey(key: string, expectedId?: StoredStem['id'], extension: StemExtension = 'wav'): void {
  if (!validKey(key, FINAL_KEYS[extension], expectedId)) throw invalidKey();
}

/** Both keys must carry the extension of the stem's codec and name the same recording. */
export function assertSealKeys(stagingKey: string, finalKey: string, expectedId: StoredStem['id'], extension: StemExtension = 'wav'): void {
  assertStagingKey(stagingKey, expectedId, extension);
  assertFinalKey(finalKey, expectedId, extension);
  if (stagingKey.slice('staging/'.length, stagingKey.lastIndexOf('/')) !==
      finalKey.slice('objects/'.length, -(extension.length + 1))) {
    throw invalidKey();
  }
}

export function assertDirectStorageKey(key: string): void {
  const any = (formats: Record<StemExtension, RegExp>) => validKey(key, formats.wav) || validKey(key, formats.mp3);
  if (!any(STAGING_KEYS) && !any(FINAL_KEYS)) throw invalidKey();
}

export function objectConflict(): AppError {
  return new AppError(409, 'O stem de áudio não está disponível.');
}

export function uploadMissing(): AppError {
  return new AppError(409, 'O stem de áudio não foi enviado.', { code: 'AUDIO_UPLOAD_MISSING' });
}

export function uploadInvalid(codec: StoredStem['codec'] = 'pcm_s16le'): AppError {
  const format = codec === 'pcm_s16le' ? 'WAV' : 'MP3';
  return new AppError(422, `O stem ${format} não corresponde ao manifesto de áudio.`, { code: 'AUDIO_UPLOAD_INVALID' });
}
