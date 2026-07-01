import { z } from 'zod';

export const createSmartChordSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório.').max(255),
  artist_id: z.string().uuid().nullable().optional(),
  song_id: z.string().uuid().nullable().optional(),
  original_key: z.string().min(1, 'Tom original é obrigatório.').max(10),
  content: z.string().min(1, 'O conteúdo da cifra é obrigatório.'),
});

export const updateSmartChordSchema = createSmartChordSchema.partial();

export const smartChordsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('50'),
});

export interface SmartChord {
  id: string;
  user_id: string;
  title: string;
  artist_id: string | null;
  song_id: string | null;
  original_key: string;
  content: string;
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

export interface ISegment {
  chord: string; // E.g. "C#m7" or ""
  text: string;  // Text syllable
}

export interface ISmartChordLine {
  line: number;
  segments: ISegment[];
}
