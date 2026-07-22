import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().min(2, 'O nome do grupo deve ter pelo menos 2 caracteres'),
  slug: z.string().optional(),
});

export const createInviteSchema = z.object({
  maxUses: z.number().int().positive().optional(),
  expiresInDays: z.number().int().positive().optional().default(7),
});

export const joinGroupSchema = z.object({
  code: z.string().min(4, 'O código do convite é obrigatório'),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
