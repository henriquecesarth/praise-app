import { z } from 'zod';

export const createRoleSchema = z.object({
  name: z.string().min(1, 'Nome da função é obrigatório.').max(80),
  icon: z.string().min(1, 'Ícone é obrigatório.'),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  icon: z.string().min(1).optional(),
});
