// Audio codec contract for the ministry audio library (manifest schemaVersion 1 and 2).
//
// FIELD SEMANTICS (see docs/architecture/m22c5a-audio-contract-v2.md)
//   DECLARATIVE  = client-supplied, only schema-checked here; the server MUST re-derive it from bytes
//                  before the codec may be published (sha256, sizeBytes, mpegAudioFrames, alignment.*).
//   CANONICAL    = identical for the six stems of a recording (sampleRate, frames, alignment.*).
// A codec is publishable only when `serverByteValidation` is true. mp3_cbr256 stays false until a
// streaming MPEG validator exists in storage.ts / r2-storage.ts; flipping it is a deliberate code change.

export const AUDIO_CODECS = ['pcm_s16le', 'mp3_cbr256'] as const;
export type AudioCodec = (typeof AUDIO_CODECS)[number];

export const PCM_MAX_SECONDS = 300;
export const MP3_MAX_SECONDS = 300;
export const MPEG_L3_SAMPLES_PER_FRAME = 1152;
/** Upper bound for priming/padding declared by a client; encoder-agnostic (4 MPEG frames). */
export const MAX_MP3_ALIGNMENT_FRAMES = 4 * MPEG_L3_SAMPLES_PER_FRAME;
export const MP3_CBR256_BITRATE_KBPS = 256;
export const MP3_SAMPLE_RATES = [44_100, 48_000] as const;

export interface CodecProfile {
  readonly codec: AudioCodec;
  readonly extension: 'wav' | 'mp3';
  readonly mime: 'audio/wav' | 'audio/mpeg';
  readonly minSampleRate: number;
  readonly maxSampleRate: number;
  readonly maxSeconds: number;
  readonly maxFrames: number;
  readonly maxBytes: number;
  /** True only when the backend validates the full byte stream of this codec. */
  readonly serverByteValidation: boolean;
}

/** Bytes of one CBR 256 kbps MPEG-1 Layer III frame (without / with padding byte). */
export function mp3CbrFrameBytes(sampleRate: number): { min: number; max: number } {
  const exact = (144 * MP3_CBR256_BITRATE_KBPS * 1000) / sampleRate;
  const min = Math.floor(exact);
  return { min, max: Number.isInteger(exact) ? min : min + 1 };
}

/** File size bounds for `mpegAudioFrames` audio frames plus the mandatory Info frame. */
export function mp3SizeBounds(sampleRate: number, mpegAudioFrames: number): { min: number; max: number } {
  const bytes = mp3CbrFrameBytes(sampleRate);
  return { min: (mpegAudioFrames + 1) * bytes.min, max: (mpegAudioFrames + 1) * bytes.max };
}

const MP3_MAX_FRAMES = 48_000 * MP3_MAX_SECONDS;
const MP3_MAX_MPEG_FRAMES = Math.ceil((MP3_MAX_FRAMES + 2 * MAX_MP3_ALIGNMENT_FRAMES) / MPEG_L3_SAMPLES_PER_FRAME);

export const CODEC_PROFILES: Readonly<Record<AudioCodec, CodecProfile>> = {
  pcm_s16le: {
    codec: 'pcm_s16le', extension: 'wav', mime: 'audio/wav',
    minSampleRate: 8000, maxSampleRate: 48_000, maxSeconds: PCM_MAX_SECONDS,
    maxFrames: 48_000 * PCM_MAX_SECONDS, maxBytes: 44 + 48_000 * PCM_MAX_SECONDS * 4,
    serverByteValidation: true,
  },
  mp3_cbr256: {
    codec: 'mp3_cbr256', extension: 'mp3', mime: 'audio/mpeg',
    minSampleRate: MP3_SAMPLE_RATES[0], maxSampleRate: MP3_SAMPLE_RATES[1], maxSeconds: MP3_MAX_SECONDS,
    maxFrames: MP3_MAX_FRAMES, maxBytes: mp3SizeBounds(44_100, MP3_MAX_MPEG_FRAMES).max,
    serverByteValidation: false,
  },
};

export function isPublishableCodec(codec: AudioCodec): boolean {
  return CODEC_PROFILES[codec].serverByteValidation;
}
