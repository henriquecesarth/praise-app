import { z } from 'zod';

// ============================================================
// Validation Schemas
// ============================================================

export const songLinkSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, 'Rótulo do link é obrigatório.').max(100),
  url: z
    .string()
    .max(2048)
    .nullable()
    .optional()
    .default('')
    .refine(
      (val) => {
        if (!val || val.trim() === '') return true;
        const trimmed = val.trim().toLowerCase();
        if (
          trimmed.startsWith('javascript:') ||
          trimmed.startsWith('data:') ||
          trimmed.startsWith('vbscript:') ||
          trimmed.startsWith('file:')
        ) {
          return false;
        }
        try {
          const parsed = new URL(val);
          return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
          return false;
        }
      },
      { message: 'URL inválida ou esquema inseguro não permitido (apenas http e https).' }
    ),
  isCustom: z.boolean().optional(),
});

export const bpmSchema = z
  .union([
    z.number().positive().max(999),
    z.string().max(10).refine((val) => val === '' || val.trim().length > 0, {
      message: 'BPM não pode conter apenas espaços em branco.',
    }),
  ])
  .nullable()
  .optional();

export const songVersionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Nome da versão é obrigatório.').max(255),
  classificationIds: z.array(z.string().min(1)).max(10, 'Uma versão pode ter no máximo 10 classificações.').optional(),
  classification_ids: z.array(z.string().min(1)).max(10, 'Uma versão pode ter no máximo 10 classificações.').optional(),
  notes: z.string().max(5000).nullable().optional(),
  key: z.string().max(10).nullable().optional(),
  original_key: z.string().max(10).nullable().optional(),
  bpm: bpmSchema,
  duration: z.string().max(20).nullable().optional(),
  links: z.array(songLinkSchema).max(20, 'Uma versão pode ter no máximo 20 links.').optional(),
}).transform((v) => {
  const classificationIds = v.classificationIds !== undefined
    ? v.classificationIds
    : (v.classification_ids !== undefined ? v.classification_ids : undefined);
  const key = v.key !== undefined ? v.key : (v.original_key !== undefined ? v.original_key : undefined);
  return {
    ...v,
    ...(classificationIds !== undefined ? { classificationIds } : {}),
    ...(key !== undefined ? { key } : {}),
  };
});

const versionsValidator = z
  .array(songVersionSchema)
  .min(1, 'A música deve ter pelo menos 1 versão.')
  .max(20, 'Uma música pode ter no máximo 20 versões.')
  .refine(
    (versions) => {
      if (!versions || versions.length <= 1) return true;
      const ids = versions.map((v) => v.id).filter(Boolean) as string[];
      const uniqueIds = new Set(ids);
      return uniqueIds.size === ids.length;
    },
    { message: 'IDs de versões duplicados não são permitidos.' }
  );

export function normalizeBpmValue(raw: any): number | string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return null;
}

export function validateFlatVsVersionConflicts(data: any): boolean {
  if (!data.versions || !Array.isArray(data.versions) || data.versions.length === 0) {
    return true;
  }
  const primary = data.versions[0];
  if (!primary) return true;

  // Key conflict: if both are provided, normalized values must be strictly identical
  if (data.original_key !== undefined && primary.key !== undefined) {
    const flatKey = data.original_key === null || data.original_key === '' ? null : data.original_key.trim().toLowerCase();
    const verKey = primary.key === null || primary.key === '' ? null : primary.key.trim().toLowerCase();
    if (flatKey !== verKey) {
      return false;
    }
  }

  // BPM conflict: if both are provided, normalized values (numeric, textual, or null) must be identical
  if (data.bpm !== undefined && primary.bpm !== undefined) {
    const flatBpm = normalizeBpmValue(data.bpm);
    const verBpm = normalizeBpmValue(primary.bpm);
    if (flatBpm !== verBpm) {
      return false;
    }
  }

  // Duration conflict: if both are provided, trimmed or null values must be identical
  if (data.duration !== undefined && primary.duration !== undefined) {
    const flatDur = data.duration === null || data.duration === '' ? null : data.duration.trim();
    const verDur = primary.duration === null || primary.duration === '' ? null : primary.duration.trim();
    if (flatDur !== verDur) {
      return false;
    }
  }

  // Classification conflict: if both are provided, primary classification ID or null must be identical
  const verClassList = primary.classificationIds !== undefined ? primary.classificationIds : primary.classification_ids;
  if (data.classification_id !== undefined && verClassList !== undefined) {
    const flatClass = data.classification_id === null || data.classification_id === '' ? null : data.classification_id;
    const verClass = Array.isArray(verClassList) && verClassList.length > 0 ? verClassList[0] : null;
    if (flatClass !== verClass) {
      return false;
    }
  }

  return true;
}

export const createSongSchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório.').max(255),
    artist: z.union([z.string().max(255), z.object({ id: z.string().optional(), name: z.string() })]).nullable().optional(),
    artist_id: z.string().nullable().optional(),
    artist_name: z.string().max(255).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    versions: versionsValidator.optional(),
    classification_id: z.string().nullable().optional(),
    original_key: z
      .string()
      .max(10)
      .nullable()
      .optional(),
    bpm: bpmSchema,
    duration: z.string().nullable().optional(),
    lyrics: z.string().nullable().optional(),
    chord_sheet_url: z.string().url().nullable().optional().or(z.literal('')),
    youtube_url: z.string().url().nullable().optional().or(z.literal('')),
    audio_url: z.string().url().nullable().optional().or(z.literal('')),
    external_links: z.record(z.string(), z.string()).optional().default({}),
  })
  .refine(validateFlatVsVersionConflicts, {
    message: 'Conflito de dados entre os campos planos legados e a versão principal (versions[0]).',
  });

export const updateSongSchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório.').max(255).optional(),
    artist: z.union([z.string().max(255), z.object({ id: z.string().optional(), name: z.string() })]).nullable().optional(),
    artist_id: z.string().nullable().optional(),
    artist_name: z.string().max(255).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    versions: versionsValidator.optional(),
    classification_id: z.string().nullable().optional(),
    original_key: z.string().max(10).nullable().optional(),
    bpm: bpmSchema,
    duration: z.string().nullable().optional(),
    lyrics: z.string().nullable().optional(),
    chord_sheet_url: z.string().url().nullable().optional().or(z.literal('')),
    youtube_url: z.string().url().nullable().optional().or(z.literal('')),
    audio_url: z.string().url().nullable().optional().or(z.literal('')),
    external_links: z.record(z.string(), z.string()).optional(),
  })
  .refine(validateFlatVsVersionConflicts, {
    message: 'Conflito de dados entre os campos planos legados e a versão principal (versions[0]).',
  });

export const createArtistSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório.').max(255),
});

export const updateArtistSchema = createArtistSchema.partial();

export const createFolderSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório.').max(255),
  description: z.string().nullable().optional(),
});

export const updateFolderSchema = createFolderSchema.partial();

export const addSongToFolderSchema = z.object({
  song_id: z.string().min(1, 'ID da música é obrigatório.'),
  position: z.number().int().min(0).optional(),
});

export const createClassificationSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório.').max(100),
  description: z.string().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve ser um código hex válido (ex: #7C3AED).')
    .nullable()
    .optional(),
});

export const updateClassificationSchema = createClassificationSchema.partial();

export const songsQuerySchema = z.object({
  search: z.string().optional(),
  classification_id: z.string().optional(),
  original_key: z.string().max(5).optional(),
  artist_id: z.string().optional(),
  has_youtube: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .default('20')
    .transform((val) => Math.min(100, Math.max(1, parseInt(val, 10))))
    .pipe(z.number().int().min(1).max(100)),
});

// ============================================================
// Types
// ============================================================

export interface SongLink {
  id?: string;
  label: string;
  url: string;
  isCustom?: boolean;
}

export interface SongVersion {
  id: string;
  name: string;
  classificationIds: string[];
  classification_ids?: string[];
  notes?: string | null;
  key: string;
  original_key?: string;
  bpm?: number | string | null;
  duration?: string | null;
  links: SongLink[];
}

export interface SongSummary {
  id: string;
  ministry_id: string;
  user_id: string | null;
  title: string;
  artist_id: string | null;
  classification_id: string | null;
  original_key: string | null;
  bpm: number | string | null;
  duration: string | null;
  youtube_url: string | null;
  audio_url: string | null;
  has_youtube?: boolean;
  created_at: string;
  updated_at: string;
  artist?: { id: string; name: string } | null;
  classification?: { id: string; name: string; color: string | null } | null;
  versions?: SongVersion[];
  notes?: string | null;
}

export interface Song extends SongSummary {
  lyrics: string | null;
  chord_sheet_url: string | null;
  external_links?: Record<string, string>;
  versions?: SongVersion[];
  notes?: string | null;
}

export interface Artist {
  id: string;
  ministry_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  ministry_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  song_count?: number;
  songs?: SongSummary[];
}

export interface Classification {
  id: string;
  ministry_id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  page?: number;
  totalPages?: number;
}

export interface RepertoireCounts {
  songs: number;
  folders: number;
  artists: number;
  classifications?: number;
}
