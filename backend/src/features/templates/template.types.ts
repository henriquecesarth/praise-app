import { z } from 'zod';

export const templateItemSchema = z.object({
  id: z.string(),
  type: z.enum(['song', 'event']),
  title: z.string().min(1, 'Título do item é obrigatório.'),
  description: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  icon: z.string().nullable().optional(),
  order: z.number(),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Nome do modelo é obrigatório.').max(100),
  items: z.array(templateItemSchema).optional().default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  items: z.array(templateItemSchema).optional(),
});
