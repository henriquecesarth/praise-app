import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Título é obrigatório.')
    .max(150, 'Título deve ter no máximo 150 caracteres.'),
  content: z
    .string()
    .trim()
    .min(1, 'Conteúdo é obrigatório.')
    .max(5000, 'Conteúdo deve ter no máximo 5000 caracteres.'),
  author: z
    .string()
    .trim()
    .max(100, 'Nome do autor deve ter no máximo 100 caracteres.')
    .optional()
    .nullable(),
  important: z.boolean().optional().default(false),
});

export const updateAnnouncementSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Título é obrigatório.')
      .max(150, 'Título deve ter no máximo 150 caracteres.')
      .optional(),
    content: z
      .string()
      .trim()
      .min(1, 'Conteúdo é obrigatório.')
      .max(5000, 'Conteúdo deve ter no máximo 5000 caracteres.')
      .optional(),
    author: z
      .string()
      .trim()
      .max(100, 'Nome do autor deve ter no máximo 100 caracteres.')
      .optional()
      .nullable(),
    important: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.content !== undefined ||
      data.author !== undefined ||
      data.important !== undefined,
    { message: 'Pelo menos um campo deve ser informado para atualização.' }
  );

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
