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
    vocal_min_midi: z.number().int().min(48, 'Nota mínima suportada é Dó3 (MIDI 48).').max(88, 'Nota máxima suportada é Mi6 (MIDI 88).').optional(),
    vocal_max_midi: z.number().int().min(48, 'Nota mínima suportada é Dó3 (MIDI 48).').max(88, 'Nota máxima suportada é Mi6 (MIDI 88).').optional(),
  })
  .refine(
    value =>
      value.chord_font_family !== undefined ||
      value.chord_line_spacing_px !== undefined ||
      value.vocal_min_midi !== undefined ||
      value.vocal_max_midi !== undefined,
    {
      message: 'Informe ao menos uma preferência para atualizar.',
    }
  )
  .refine(
    value => {
      if (value.vocal_min_midi !== undefined && value.vocal_max_midi !== undefined) {
        return value.vocal_min_midi < value.vocal_max_midi;
      }
      return true;
    },
    {
      message: 'A nota mais grave deve ser inferior à nota mais aguda.',
    }
  )
  .strict();

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
