import type { FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { CODEC_PROFILES } from './audio-codec';
import { MP3_PUBLICATION_VALIDATION } from './mp3-encoder-profile';
import type { Mp3Facts } from './direct-storage';
import { verifyMp3Stem, type Mp3StemManifest, type Mp3ValidationResult } from './mp3-stream-validator';
import { stemV2Schema, type StemManifest } from './ministry-audio.schema';
import { verifyWav, type VerifyStats } from './storage';

/** A stem whose bytes a storage adapter can verify. The codec comes from the validated manifest, never from a key. */
export type StoredStem = StemManifest | Mp3StemManifest;
export type StemExtension = 'wav' | 'mp3';

export const stemExtension = (stem: Pick<StoredStem, 'codec'>): StemExtension => CODEC_PROFILES[stem.codec].extension;
export const stemMime = (stem: Pick<StoredStem, 'codec'>): 'audio/wav' | 'audio/mpeg' => CODEC_PROFILES[stem.codec].mime;
export const isValidStoredStem = (stem: unknown): stem is StoredStem => stemV2Schema.safeParse(stem).success;

/**
 * Explicit verifier contract: the verifier is chosen by `expected.codec` (schema-validated), so a client-controlled
 * extension or Content-Type can never select it. MP3 additionally returns the validation result. `destination` receives chunks while verification runs (before the final CRC/SHA/profile checks), so a caller must only use it after this function resolves and discard it on failure.
 */
export async function verifyStemBytes(
  source: Readable,
  expected: StoredStem,
  status: 409 | 422,
  destination?: FileHandle,
  stats?: VerifyStats,
): Promise<Mp3ValidationResult | undefined> {
  if (expected.codec === 'pcm_s16le') {
    await verifyWav(source, expected, status, destination, stats);
    return undefined;
  }
  // The result carries the facts a caller needs for assertConsistentMp3Stems across the six stems.
  return verifyMp3Stem(source, expected, status, {
    ...MP3_PUBLICATION_VALIDATION,
    sink: destination ? async (chunk) => { await destination.writeFile(chunk); } : undefined,
  });
}

/** Drops the memory-bound diagnostic; what remains is the persisted, comparable result of a byte verification. */
export function mp3FactsOf(result: Mp3ValidationResult | undefined): Mp3Facts | undefined {
  if (!result) return undefined;
  const { peakBufferedBytes: _peak, ...facts } = result;
  return facts;
}

/** True only when the facts describe exactly this stem: identity, hash, size and every declared alignment value. */
export function mp3FactsMatch(expected: StoredStem, facts: Mp3Facts | undefined): boolean {
  if (expected.codec !== 'mp3_cbr256') return facts === undefined;
  return !!facts && facts.id === expected.id && facts.sha256 === expected.sha256 && facts.sizeBytes === expected.sizeBytes &&
    facts.sampleRate === expected.sampleRate && facts.frames === expected.frames &&
    facts.mpegAudioFrames === expected.alignment.mpegAudioFrames &&
    facts.decoderDelayFrames === MP3_PUBLICATION_VALIDATION.expectedDecoderDelayFrames &&
    facts.tagDelayFrames === MP3_PUBLICATION_VALIDATION.expectedTagDelayFrames &&
    facts.tagDelayFrames + facts.tagPaddingFrames === expected.alignment.encoderDelayFrames + expected.alignment.paddingFrames &&
    facts.encoder.length === 9 && MP3_PUBLICATION_VALIDATION.allowedEncoderPrefixes.some((prefix) => facts.encoder.startsWith(prefix));
}
