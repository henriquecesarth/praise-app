import type { Mp3ValidationOptions } from './mp3-stream-validator';

// Supported MP3 encoder profile for publication (decision record: docs/architecture/m22c5d-codec-aware-storage.md).
//
// The decoder-side delay folded into `encoderDelayFrames` is NOT observable from the bytes, so it is pinned per
// evidenced encoder instead of being accepted from the client. The evidence for this profile:
//   - encoder: ffmpeg/libmp3lame, LAME tag identification "Lavc…" (fixtures: shared/fixtures/ministry-audio-mp3-v1).
//   - tag delay: 576 in every measured file (44.1 and 48 kHz, 1–300 s).
//   - decoder delay: 529 = the MPEG-1 Layer III decoder delay (528 + 1) that Chrome 150 removes in addition to the
//     tag delay (1105 samples at the start, measured sample-exact on 44.1 and 48 kHz in the M22-C.5B PoC).
// Any other combination (other encoder, other tag delay, other decoder delay) is rejected, not guessed.
// The value 529 is a property of this profile, not a universal constant.
export interface Mp3EncoderProfile {
  readonly id: string;
  /** LAME tag identification (9 chars) must start with one of these. Prefixes of different profiles never overlap. */
  readonly encoderPrefixes: readonly string[];
  readonly tagDelayFrames: number;
  readonly decoderDelayFrames: number;
}

export const MP3_ENCODER_PROFILE_LAVC = {
  id: 'lavc-libmp3lame-576-529',
  encoderPrefixes: ['Lavc'],
  tagDelayFrames: 576,
  decoderDelayFrames: 529,
} as const satisfies Mp3EncoderProfile;

// M22-S3: the encoder shipped with the Web client (LAME 3.100 compiled to WebAssembly through wasm-media-encoders).
// Evidence: tag identification "LAME3.100", tag delay 576 (LAME's encoder delay), decoder delay 529 calibrated in Chrome
// 158 and checked sample-exact against ffmpeg 9.0 (docs/architecture/m22s1-local-mp3-stem-encoding.md). The identification
// string and the CRCs are NOT proof of who produced the file (anyone can write them); they only select the pinned delays
// that the bytes must then satisfy together with the size, frame count, SHA-256 and both CRCs.
export const MP3_ENCODER_PROFILE_LAME_WASM = {
  id: 'lame-3.100-wasm-576-529',
  encoderPrefixes: ['LAME3.100'],
  tagDelayFrames: 576,
  decoderDelayFrames: 529,
} as const satisfies Mp3EncoderProfile;

/** Kept for existing imports: the original (ffmpeg) profile. */
export const MP3_ENCODER_PROFILE = MP3_ENCODER_PROFILE_LAVC;

export const MP3_ENCODER_PROFILES: readonly Mp3EncoderProfile[] = [MP3_ENCODER_PROFILE_LAVC, MP3_ENCODER_PROFILE_LAME_WASM];

/**
 * Deterministic selection from the encoder identification found in the Info frame: exactly one profile or none. It is
 * made once, while streaming, from bytes the validator already holds; no object is re-read per profile.
 */
export function selectMp3EncoderProfile(encoder: string, profiles: readonly Mp3EncoderProfile[] = MP3_ENCODER_PROFILES): Mp3EncoderProfile | undefined {
  const matches = profiles.filter((profile) => profile.encoderPrefixes.some((prefix) => encoder.startsWith(prefix)));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Validation options every storage-side MP3 verification must use. */
export const MP3_PUBLICATION_VALIDATION: Required<Pick<Mp3ValidationOptions, 'profiles'>> = {
  profiles: MP3_ENCODER_PROFILES,
};