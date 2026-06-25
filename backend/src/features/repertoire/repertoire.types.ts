import { z } from 'zod';

// ============================================================
// Validation Schemas
// ============================================================

export const createSongSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório.').max(255),
  artist_id: z.string().uuid().nullable().optional(),
  classification_id: z.string().uuid().nullable().optional(),
  original_key: z
    .string()
    .max(5)
    .nullable()
    .optional(),
  bpm: z.number().positive().max(999).nullable().optional(),
  duration: z.string().nullable().optional(),
  lyrics: z.string().nullable().optional(),
  chord_sheet_url: z.string().url().nullable().optional().or(z.literal('')),
  youtube_url: z.string().url().nullable().optional().or(z.literal('')),
  audio_url: z.string().url().nullable().optional().or(z.literal('')),
});

export const updateSongSchema = createSongSchema.partial();

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
  song_id: z.string().uuid('ID da música inválido.'),
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
  classification_id: z.string().uuid().optional(),
  original_key: z.string().max(5).optional(),
  artist_id: z.string().uuid().optional(),
  has_youtube: z.enum(['true', 'false']).optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('50'),
});

// ============================================================
// Types
// ============================================================

export interface Song {
  id: string;
  ministry_id: string;
  title: string;
  artist_id: string | null;
  classification_id: string | null;
  original_key: string | null;
  bpm: number | null;
  duration: string | null;
  lyrics: string | null;
  chord_sheet_url: string | null;
  youtube_url: string | null;
  audio_url: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  artist?: { id: string; name: string } | null;
  classification?: { id: string; name: string; color: string | null } | null;
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
  page: number;
  limit: number;
  totalPages: number;
}

export interface RepertoireCounts {
  songs: number;
  folders: number;
  artists: number;
}
