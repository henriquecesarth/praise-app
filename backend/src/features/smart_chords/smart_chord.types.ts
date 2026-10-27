import { z } from 'zod';

const smartChordSourceUrlSchema = z.string().url().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username && !url.password && !url.port &&
      ['cifraclub.com.br', 'www.cifraclub.com.br'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}, 'URL de origem não suportada.');

export const singleDocumentIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/, 'ID deve conter apenas caracteres alfanuméricos, hífen ou sublinhado (máx 100 caracteres).');

export const createSmartChordSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório.').max(255),
  artist_name: z.string().trim().max(255).nullable().optional(),
  artist_id: singleDocumentIdSchema.nullable().optional(), // @deprecated: compatibilidade com clientes legados
  song_id: singleDocumentIdSchema.nullable().optional(), // @deprecated: compatibilidade com clientes legados
  original_key: z.string().trim().min(1, 'Tom original é obrigatório.').max(10),
  content: z.string().min(1, 'O conteúdo da cifra é obrigatório.'),
  source_url: smartChordSourceUrlSchema.nullable().optional(),
  displayed_key: z.string().trim().min(1).max(10).nullable().optional(),
  capo: z.number().int().min(0).max(24).nullable().optional(),
});

export const updateSmartChordSchema = z.object({
  title: z.string().trim().min(1, 'Título não pode ser vazio.').max(255).optional(),
  artist_name: z.string().trim().max(255).nullable().optional(),
  artist_id: singleDocumentIdSchema.nullable().optional(), // @deprecated: compatibilidade com clientes legados
  song_id: singleDocumentIdSchema.nullable().optional(), // @deprecated: compatibilidade com clientes legados
  original_key: z.string().trim().min(1, 'Tom original não pode ser vazio.').max(10).optional(),
  content: z.string().min(1, 'Conteúdo não pode ser vazio.').optional(),
  source_url: smartChordSourceUrlSchema.nullable().optional(),
  displayed_key: z.string().trim().min(1).max(10).nullable().optional(),
  capo: z.number().int().min(0).max(24).nullable().optional(),
});

export const setSmartChordRepertoireLinkSchema = z.object({
  song_id: singleDocumentIdSchema,
});

export const smartChordsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  page: z.string().regex(/^[1-9]\d*$/, 'Página deve ser maior que zero.').optional().default('1'),
  limit: z.string().regex(/^[1-9]\d*$/, 'Limite deve ser maior que zero.').optional().default('50'),
});

export interface SmartChord {
  id: string;
  user_id: string;
  title: string;
  artist_name?: string | null;
  artist_id: string | null;
  song_id: string | null;
  original_key: string;
  content: string;
  source_url?: string | null;
  displayed_key?: string | null;
  capo?: number | null;
  created_at: string;
  updated_at: string;
  artist?: {
    id: string;
    name: string;
  } | null;
  song?: {
    id: string;
    title: string;
  } | null;
}

export interface SmartChordSongLink {
  id: string; // sha256(JSON.stringify([user_id, smart_chord_id, ministry_id]))
  user_id: string;
  smart_chord_id: string;
  ministry_id: string;
  song_id: string;
  created_at: string;
  updated_at: string;
}

export interface SmartChordSongSummary {
  id: string;
  ministry_id: string;
  title: string;
  artist_id?: string | null;
  artist_name?: string | null;
  original_key?: string | null;
}

export interface SmartChordRepertoireLinkResponse {
  link: SmartChordSongLink | null;
  song: SmartChordSongSummary | null;
}

export interface ISegment {
  chord: string; // E.g. "C#m7" or ""
  text: string;  // Text syllable
}

export interface ISmartChordLine {
  line: number;
  segments: ISegment[];
}
