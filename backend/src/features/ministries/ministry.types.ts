import { z } from 'zod';

export const createMinistrySchema = z.object({
  name: z.string().min(1, 'Nome do ministério é obrigatório.').max(100),
  slug: z.string().optional(),
});

export const updateMinistrySchema = z.object({
  name: z.string().min(1, 'Nome do ministério é obrigatório.').max(100).optional(),
});

export const createInviteCodeSchema = z.object({
  expiresInDays: z.number().int().positive().optional().default(7),
  maxUses: z.number().int().positive().nullable().optional(),
});

export const joinMinistrySchema = z.object({
  code: z.string().min(1, 'Código de convite é obrigatório.'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export const addMemberManuallySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório.').max(100),
  email: z.string().email('E-mail inválido.'),
  role: z.enum(['admin', 'member']).optional().default('member'),
  birthDate: z.string().optional(), // ISO date string YYYY-MM-DD
});
