import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres'),
  name: z.string().min(2, 'O nome deve ter pelo menos 2 caracteres'),
});

export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'A senha é obrigatória'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const SUPPORTED_CHORD_FONTS = [
  'monospace',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
] as const;

export type SupportedChordFont = (typeof SUPPORTED_CHORD_FONTS)[number];

export const DEFAULT_CHORD_FONT: SupportedChordFont = 'monospace';
export const DEFAULT_CHORD_LINE_SPACING_PX = 0;

export const updatePreferencesSchema = z
  .object({
    chord_font_family: z.enum(SUPPORTED_CHORD_FONTS, {
      message: 'Fonte de acordes não suportada.',
    }).optional(),
    chord_line_spacing_px: z.number().int().min(0).max(24).refine(value => value % 2 === 0, {
      message: 'O espaçamento deve ser um número par entre 0 e 24.',
    }).optional(),
  })
  .refine(value => value.chord_font_family !== undefined || value.chord_line_spacing_px !== undefined, {
    message: 'Informe ao menos uma preferência para atualizar.',
  })
  .strict();

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
