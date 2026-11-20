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
export const MP3_ENCODER_PROFILE = {
  id: 'lavc-libmp3lame-576-529',
  encoderPrefixes: ['Lavc'],
  tagDelayFrames: 576,
  decoderDelayFrames: 529,
} as const;

/** Validation options every storage-side MP3 verification must use. */
export const MP3_PUBLICATION_VALIDATION: Required<Pick<Mp3ValidationOptions,
  'expectedDecoderDelayFrames' | 'allowedEncoderPrefixes' | 'expectedTagDelayFrames'>> = {
  expectedDecoderDelayFrames: MP3_ENCODER_PROFILE.decoderDelayFrames,
  allowedEncoderPrefixes: MP3_ENCODER_PROFILE.encoderPrefixes,
  expectedTagDelayFrames: MP3_ENCODER_PROFILE.tagDelayFrames,
};
