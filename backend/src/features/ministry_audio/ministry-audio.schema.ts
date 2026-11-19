import { z } from 'zod';

export const STEM_IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
export const MAX_UPLOAD_SECONDS = 300;
export const MAX_STEM_BYTES = 44 + 48_000 * MAX_UPLOAD_SECONDS * 4;
export const stemIdSchema = z.enum(STEM_IDS);
export const ministryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const recordingIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

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

export interface AudioManifest {
  schemaVersion: 1;
  recordingId: string;
  recordingVersion: string;
  model: UploadInput['model'];
  stems: StemManifest[];
}
