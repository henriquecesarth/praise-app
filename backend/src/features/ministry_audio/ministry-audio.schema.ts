import { z } from 'zod';
import { AppError } from '../../middleware/error-handler';
import {
  CODEC_PROFILES, MAX_MP3_ALIGNMENT_FRAMES, MP3_CBR256_BITRATE_KBPS, MP3_SAMPLE_RATES, MPEG_L3_SAMPLES_PER_FRAME,
  PCM_MAX_SECONDS, isPublishableCodec, mp3SizeBounds,
} from './audio-codec';

export const STEM_IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
export const MAX_UPLOAD_SECONDS = PCM_MAX_SECONDS;
export const MAX_STEM_BYTES = 44 + 48_000 * MAX_UPLOAD_SECONDS * 4;
export const stemIdSchema = z.enum(STEM_IDS);
export const ministryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const recordingIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const MAX_DIRECT_ATTEMPTS = 3;
export const completeStemSchema = z.object({
  attempt: z.number().int().min(1).max(MAX_DIRECT_ATTEMPTS),
}).strict();

const metadata = {
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160),
  version: z.string().trim().min(1).max(120),
};
export const metadataSchema = z.object(metadata).strict();
export const stemSchema = z.object({
  id: stemIdSchema,
  codec: z.literal('pcm_s16le'),
  sampleRate: z.number().int().min(8000).max(48_000),
  channels: z.literal(2),
  durationSeconds: z.number().positive().max(MAX_UPLOAD_SECONDS),
  frames: z.number().int().positive().max(48_000 * MAX_UPLOAD_SECONDS),
  sizeBytes: z.number().int().min(48).max(MAX_STEM_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(
  (stem) => stem.sizeBytes === 44 + stem.frames * 4 &&
    Math.abs(stem.durationSeconds - stem.frames / stem.sampleRate) <= 1e-8 &&
    stem.frames <= stem.sampleRate * MAX_UPLOAD_SECONDS,
  'Tamanho, duração ou número de frames incompatíveis com o WAV.'
);

export const uploadSchema = z.object({
  ...metadata,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  confirmed: z.literal(true),
  model: z.object({
    id: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(120),
  }).strict(),
  stems: z.array(stemSchema).length(STEM_IDS.length).refine(
    (stems) => new Set(stems.map(({ id }) => id)).size === STEM_IDS.length &&
      stems.every((stem) =>
        stem.sampleRate === stems[0].sampleRate && stem.frames === stems[0].frames),
    'Informe uma faixa de cada tipo, com a mesma taxa e quantidade de frames.'
  ),
}).strict();

// ---- Manifest schemaVersion 2 (additive; schemaVersion 1 above is untouched) ----

export const mp3AlignmentSchema = z.object({
  /** Priming frames at stem.sampleRate that precede the canonical timeline in the decoded stream. */
  encoderDelayFrames: z.number().int().min(0).max(MAX_MP3_ALIGNMENT_FRAMES),
  /** Frames after the canonical timeline in the decoded stream (end padding to discard). */
  paddingFrames: z.number().int().min(0).max(MAX_MP3_ALIGNMENT_FRAMES),
  /** MPEG audio frames excluding the Info frame. Server must count them from bytes. */
  mpegAudioFrames: z.number().int().positive().max(
    Math.ceil((CODEC_PROFILES.mp3_cbr256.maxFrames + 2 * MAX_MP3_ALIGNMENT_FRAMES) / MPEG_L3_SAMPLES_PER_FRAME)),
  /** An Info/Xing frame must be present so gapless-aware decoders skip priming. */
  infoFrame: z.literal(true),
}).strict();

export const mp3StemSchema = z.object({
  id: stemIdSchema,
  codec: z.literal('mp3_cbr256'),
  sampleRate: z.union(MP3_SAMPLE_RATES.map((rate) => z.literal(rate)) as [z.ZodLiteral<44_100>, z.ZodLiteral<48_000>]),
  channels: z.literal(2),
  bitrateKbps: z.literal(MP3_CBR256_BITRATE_KBPS),
  /** Canonical timeline length: the frames of the original PCM at sampleRate, after trimming. */
  frames: z.number().int().positive().max(CODEC_PROFILES.mp3_cbr256.maxFrames),
  durationSeconds: z.number().positive().max(CODEC_PROFILES.mp3_cbr256.maxSeconds),
  sizeBytes: z.number().int().positive().max(CODEC_PROFILES.mp3_cbr256.maxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  alignment: mp3AlignmentSchema,
}).strict().superRefine((stem, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const { alignment } = stem;
  if (stem.frames > stem.sampleRate * CODEC_PROFILES.mp3_cbr256.maxSeconds ||
      Math.abs(stem.durationSeconds - stem.frames / stem.sampleRate) > 1e-8) {
    issue('Duração ou frames incompatíveis com a taxa de amostragem.');
  }
  if (alignment.encoderDelayFrames + stem.frames + alignment.paddingFrames !==
      alignment.mpegAudioFrames * MPEG_L3_SAMPLES_PER_FRAME) {
    issue('Atraso, frames e corte não fecham com a contagem de frames MPEG.');
  }
  const bounds = mp3SizeBounds(stem.sampleRate, alignment.mpegAudioFrames);
  if (stem.sizeBytes < bounds.min || stem.sizeBytes > bounds.max) {
    issue('Tamanho incompatível com MP3 CBR 256 kbps e a contagem de frames MPEG.');
  }
});

export const stemV2Schema = z.union([stemSchema, mp3StemSchema]);

export type StemV2 = z.infer<typeof stemV2Schema>;

function homogeneousStems(stems: StemV2[]): boolean {
  const first = stems[0];
  if (new Set(stems.map(({ id }) => id)).size !== STEM_IDS.length) return false;
  return stems.every((stem) => {
    if (stem.codec !== first.codec || stem.sampleRate !== first.sampleRate || stem.frames !== first.frames) return false;
    if (stem.codec === 'mp3_cbr256' && first.codec === 'mp3_cbr256') {
      return stem.alignment.encoderDelayFrames === first.alignment.encoderDelayFrames &&
        stem.alignment.paddingFrames === first.alignment.paddingFrames &&
        stem.alignment.mpegAudioFrames === first.alignment.mpegAudioFrames;
    }
    return true;
  });
}

export const uploadV2Schema = z.object({
  ...metadata,
  schemaVersion: z.literal(2),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  confirmed: z.literal(true),
  model: z.object({
    id: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(120),
  }).strict(),
  stems: z.array(stemV2Schema).length(STEM_IDS.length).refine(
    homogeneousStems,
    'Informe uma faixa de cada tipo, com o mesmo codec, taxa, frames e alinhamento.'
  ),
}).strict();

/** v1 body has no schemaVersion; v2 declares it. Any other value falls to v1 and is rejected (strict). */
export function selectUploadSchema(body: unknown): z.ZodType<UploadInput | UploadInputV2> {
  const version = typeof body === 'object' && body !== null ? (body as { schemaVersion?: unknown }).schemaVersion : undefined;
  return version === undefined ? uploadSchema : uploadV2Schema;
}

/**
 * Fail-closed gate: a codec can be reserved only if the backend validates its bytes.
 * Returns the stems narrowed to the byte-validated v1 PCM shape.
 */
export function requirePublishableStems(stems: StemV2[]): StemV2[] {
  for (const stem of stems) {
    if (!isPublishableCodec(stem.codec)) {
      throw new AppError(422, 'Este codec de áudio ainda não está habilitado para publicação.', { code: 'AUDIO_CODEC_NOT_ENABLED' });
    }
  }
  return stems;
}

export const listSchema = z.object({
  q: z.string().trim().max(160).default(''),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(30)).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/).optional(),
}).strict();

export type StemManifest = z.infer<typeof stemSchema>;
export type StemId = z.infer<typeof stemIdSchema>;
export type RecordingMetadata = z.infer<typeof metadataSchema>;
export type UploadInput = z.infer<typeof uploadSchema>;
export type ListInput = z.infer<typeof listSchema>;

export type UploadInputV2 = z.infer<typeof uploadV2Schema>;

/**
 * Persisted manifests only ever hold byte-validated stems (see requirePublishableStems).
 * v1 holds PCM stems and is the only shape written today; v2 holds MP3 stems and is written only once a codec is enabled.
 */
export interface AudioManifest {
  schemaVersion: 1 | 2;
  recordingId: string;
  recordingVersion: string;
  model: UploadInput['model'];
  stems: StemV2[];
}
