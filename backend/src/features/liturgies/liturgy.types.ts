import { z } from 'zod';

export const liturgyItemSchema = z.object({
  id: z.string().optional(),
  songId: z.string().trim().min(1).max(100).optional().nullable(),
  song_id: z.string().trim().min(1).max(100).optional().nullable(),
  type: z.enum(['song', 'reading', 'prayer', 'custom']).default('song'),
  title: z.string().trim().min(1, 'Título do item é obrigatório').max(200, 'Título do item excede o limite'),
  notes: z.string().trim().max(2000, 'Observações excedem o limite').optional().nullable(),
  position: z.number().int().default(0),
});

export const createLiturgySchema = z.object({
  title: z.string().trim().min(2, 'Título da liturgia é obrigatório').max(200, 'Título da liturgia excede o limite'),
  date: z.string().trim().min(10, 'Data da liturgia é obrigatória').max(50),
  description: z.string().trim().max(2000, 'Descrição excede o limite').optional().nullable(),
  items: z.array(liturgyItemSchema).max(100, 'Limite de itens excedido').optional(),
});

export const updateLiturgySchema = z.object({
  title: z.string().trim().min(2, 'Título da liturgia é obrigatório').max(200, 'Título da liturgia excede o limite').optional(),
  date: z.string().trim().min(10, 'Data da liturgia é obrigatória').max(50).optional(),
  description: z.string().trim().max(2000, 'Descrição excede o limite').optional().nullable(),
  items: z.array(liturgyItemSchema).max(100, 'Limite de itens excedido').optional(),
});

export type CreateLiturgyInput = z.infer<typeof createLiturgySchema>;
export type UpdateLiturgyInput = z.infer<typeof updateLiturgySchema>;
