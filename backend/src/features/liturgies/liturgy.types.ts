import { z } from 'zod';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidGregorianDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z?)?$/.exec(trimmed);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  if (match[4] !== undefined) {
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const second = parseInt(match[6], 10);
    if (hour > 23 || minute > 59 || second > 59) return false;
  }

  return true;
}

export const songIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{1,100}$/, 'ID de música inválido. Deve conter apenas caracteres alfanuméricos, hífen ou sublinhado.')
  .optional()
  .nullable();

export const liturgyDateSchema = z
  .string()
  .trim()
  .refine(isValidGregorianDate, {
    message: 'Data da liturgia inválida. Deve ser uma data civil válida no formato YYYY-MM-DD ou ISO 8601.',
  });

export const liturgyItemSchema = z.object({
  id: z.string().optional(),
  songId: songIdSchema,
  song_id: songIdSchema,
  type: z.enum(['song', 'reading', 'prayer', 'custom']).default('song'),
  title: z.string().trim().min(1, 'Título do item é obrigatório').max(200, 'Título do item excede o limite'),
  notes: z.string().trim().max(2000, 'Observações excedem o limite').optional().nullable(),
  position: z.number().int().default(0),
});

export const createLiturgySchema = z.object({
  title: z.string().trim().min(2, 'Título da liturgia é obrigatório').max(200, 'Título da liturgia excede o limite'),
  date: liturgyDateSchema,
  description: z.string().trim().max(2000, 'Descrição excede o limite').optional().nullable(),
  items: z.array(liturgyItemSchema).max(100, 'Limite de itens excedido').optional(),
});

export const updateLiturgySchema = z.object({
  title: z.string().trim().min(2, 'Título da liturgia é obrigatório').max(200, 'Título da liturgia excede o limite').optional(),
  date: liturgyDateSchema.optional(),
  description: z.string().trim().max(2000, 'Descrição excede o limite').optional().nullable(),
  items: z.array(liturgyItemSchema).max(100, 'Limite de itens excedido').optional(),
});

export type CreateLiturgyInput = z.infer<typeof createLiturgySchema>;
export type UpdateLiturgyInput = z.infer<typeof updateLiturgySchema>;
