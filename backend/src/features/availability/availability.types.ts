import { z } from 'zod';
import { MemberUnavailabilityRecord } from '../../repositories/AvailabilityRepository';

export const createUnavailabilitySchema = z.object({
  startDate: z
    .string()
    .trim()
    .min(1, 'A data inicial é obrigatória.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (esperado: YYYY-MM-DD).'),
  endDate: z
    .string()
    .trim()
    .min(1, 'A data final é obrigatória.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (esperado: YYYY-MM-DD).'),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (esperado: HH:mm).')
    .nullable()
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (esperado: HH:mm).')
    .nullable()
    .optional(),
  allDay: z.boolean().default(false),
  reason: z
    .string()
    .max(255, 'O motivo não pode exceder 255 caracteres.')
    .nullable()
    .optional(),
});

export const updateUnavailabilitySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (esperado: YYYY-MM-DD).')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (esperado: YYYY-MM-DD).')
    .optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (esperado: HH:mm).')
    .nullable()
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (esperado: HH:mm).')
    .nullable()
    .optional(),
  allDay: z.boolean().optional(),
  reason: z
    .string()
    .max(255, 'O motivo não pode exceder 255 caracteres.')
    .nullable()
    .optional(),
});

export type CreateUnavailabilityInput = z.infer<typeof createUnavailabilitySchema>;
export type UpdateUnavailabilityInput = z.infer<typeof updateUnavailabilitySchema>;

export interface MemberUnavailabilityDto {
  id: string;
  ministryId: string;
  memberId: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapToUnavailabilityDto(record: MemberUnavailabilityRecord): MemberUnavailabilityDto {
  return {
    id: record.id,
    ministryId: record.ministry_id,
    memberId: record.member_id,
    startDate: record.start_date,
    endDate: record.end_date,
    startTime: record.start_time,
    endTime: record.end_time,
    allDay: record.all_day,
    startsAt: record.starts_at,
    endsAt: record.ends_at,
    reason: record.reason,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}
