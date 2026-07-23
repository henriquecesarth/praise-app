import { z } from 'zod';

export const createClassificationSchema = z.object({
  name: z.string().min(1, 'Título é obrigatório.').max(100),
  description: z.string().max(300).optional(),
});

export const updateClassificationSchema = z.object({
  name: z.string().min(1, 'Título é obrigatório.').max(100).optional(),
  description: z.string().max(300).nullable().optional(),
});
