import { z } from 'zod';

export const createScheduleSchema = z.object({
  title: z.string().min(1, 'O título da escala é obrigatório.'),
  date: z.string(),
  time: z.string(),
  durationMinutes: z
    .number()
    .int('A duração deve ser um número inteiro de minutos.')
    .min(15, 'A duração mínima da escala é de 15 minutos.')
    .max(1440, 'A duração máxima da escala é de 1440 minutos (24 horas).')
    .optional()
    .default(120),
  notes: z.string().optional(),
  isVisible: z.boolean().default(true),
  colorPalette: z.string().optional(),
  clothingPieces: z.array(z.any()).optional(),
  requireConfirmation: z.boolean().optional(),
  participants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      confirmed: z.boolean().optional(),
    })
  ).optional(),
  songs: z.array(z.any()).optional(),
  timeline: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      time: z.string().optional(),
      type: z.string(),
    })
  ).optional(),
});

export const updateScheduleSchema = createScheduleSchema.partial();

export const createScheduleCommentSchema = z.object({
  content: z.string().min(1, 'O comentário não pode ser vazio.').max(1000),
});

export const confirmPresenceSchema = z.object({
  confirmed: z.boolean(),
});

