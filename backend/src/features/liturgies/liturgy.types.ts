import { z } from 'zod';

export const liturgyItemSchema = z.object({
  songId: z.string().uuid().optional().nullable(),
  type: z.enum(['song', 'reading', 'prayer', 'custom']).default('song'),
  title: z.string().min(1, 'Título do item é obrigatório'),
  notes: z.string().optional(),
  position: z.number().int().default(0),
});

export const createLiturgySchema = z.object({
  title: z.string().min(2, 'Título da liturgia é obrigatório'),
  date: z.string().datetime().or(z.string().min(10)),
  description: z.string().optional(),
  items: z.array(liturgyItemSchema).optional(),
});

export const updateLiturgySchema = createLiturgySchema.partial();

export type CreateLiturgyInput = z.infer<typeof createLiturgySchema>;
export type UpdateLiturgyInput = z.infer<typeof updateLiturgySchema>;
