import { z } from 'zod';

export const customVocalExerciseSchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório').max(100, 'Título muito longo'),
    description: z.string().trim().max(500, 'Descrição muito longa').optional().default(''),
    notes: z
      .array(z.number().int().min(48, 'Nota mínima suportada é Dó3 (MIDI 48)').max(88, 'Nota máxima suportada é Mi6 (MIDI 88)'))
      .min(1, 'O exercício deve conter pelo menos uma nota')
      .max(64, 'Máximo de 64 notas por exercício'),
    noteDurations: z
      .array(z.number().positive('Duração deve ser positiva').max(16, 'Duração máxima por nota é 16 tempos'))
      .min(1, 'Durações devem acompanhar as notas')
      .max(64, 'Máximo de 64 durações'),
    minTranspose: z.number().int().min(-24).max(0).optional().default(-12),
    maxTranspose: z.number().int().min(0).max(24).optional().default(12),
    category: z.enum(['ascendente', 'descendente', 'misto']).optional(),
  })
  .refine((data) => data.notes.length === data.noteDurations.length, {
    message: 'A quantidade de notas deve ser exatamente igual à quantidade de durações.',
    path: ['noteDurations'],
  })
  .refine((data) => data.minTranspose <= data.maxTranspose, {
    message: 'minTranspose deve ser menor ou igual a maxTranspose.',
    path: ['minTranspose'],
  });

export const updateCustomVocalExerciseSchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório').max(100, 'Título muito longo').optional(),
    description: z.string().trim().max(500, 'Descrição muito longa').optional(),
    notes: z
      .array(z.number().int().min(48, 'Nota mínima suportada é Dó3 (MIDI 48)').max(88, 'Nota máxima suportada é Mi6 (MIDI 88)'))
      .min(1, 'O exercício deve conter pelo menos uma nota')
      .max(64, 'Máximo de 64 notas por exercício')
      .optional(),
    noteDurations: z
      .array(z.number().positive('Duração deve ser positiva').max(16, 'Duração máxima por nota é 16 tempos'))
      .min(1, 'Durações devem acompanhar as notas')
      .max(64, 'Máximo de 64 durações')
      .optional(),
    minTranspose: z.number().int().min(-24).max(0).optional(),
    maxTranspose: z.number().int().min(0).max(24).optional(),
    category: z.enum(['ascendente', 'descendente', 'misto']).optional(),
  })
  .refine((data) => {
    if (data.notes && data.noteDurations) {
      return data.notes.length === data.noteDurations.length;
    }
    return true;
  }, {
    message: 'A quantidade de notas deve ser exatamente igual à quantidade de durações quando ambas forem fornecidas.',
    path: ['noteDurations'],
  })
  .refine((data) => {
    if (data.minTranspose !== undefined && data.maxTranspose !== undefined) {
      return data.minTranspose <= data.maxTranspose;
    }
    return true;
  }, {
    message: 'minTranspose deve ser menor ou igual a maxTranspose.',
    path: ['minTranspose'],
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualização.',
  });

export type CustomVocalExerciseInput = z.infer<typeof customVocalExerciseSchema>;
export type UpdateCustomVocalExerciseInput = z.infer<typeof updateCustomVocalExerciseSchema>;

export interface CustomVocalExercise {
  id: string;
  userId: string;
  title: string;
  description: string;
  notes: number[];
  noteDurations: number[];
  minTranspose: number;
  maxTranspose: number;
  category: 'ascendente' | 'descendente' | 'misto';
  isCustom: true;
  createdAt: string;
  updatedAt: string;
}
