import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, 'Nome da equipe é obrigatório.').max(100),
  description: z.string().trim().max(300).nullable().optional(),
  memberIds: z.array(z.string().trim().min(1)).optional().default([]),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1, 'Nome da equipe é obrigatório.').max(100).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  memberIds: z.array(z.string().trim().min(1)).optional(),
});
