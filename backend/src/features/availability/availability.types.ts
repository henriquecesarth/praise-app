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

export const listUnavailabilityQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, 'O parâmetro limit deve ser um número inteiro entre 1 e 100.')
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('O parâmetro limit deve ser um número inteiro.')
        .min(1, 'O parâmetro limit deve ser no mínimo 1.')
        .max(100, 'O parâmetro limit não pode ser superior a 100.')
    ),
  cursor: z.string().optional(),
});

export type CreateUnavailabilityInput = z.infer<typeof createUnavailabilitySchema>;
export type UpdateUnavailabilityInput = z.infer<typeof updateUnavailabilitySchema>;
export type ListUnavailabilityQueryInput = z.infer<typeof listUnavailabilityQuerySchema>;

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

export const checkAvailabilityConflictsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (esperado: YYYY-MM-DD).'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato de hora inválido (esperado: HH:mm entre 00:00 e 23:59).'),
  durationMinutes: z
    .number()
    .int('A duração deve ser um número inteiro de minutos.')
    .min(15, 'A duração mínima da escala é de 15 minutos.')
    .max(1440, 'A duração máxima da escala é de 1440 minutos.')
    .optional(),
  participantIds: z
    .array(z.string().trim().min(1, 'ID do participante não pode ser vazio.'))
    .min(1, 'Pelo menos um participante deve ser informado.')
    .max(50, 'O limite máximo para verificação de conflitos é de 50 participantes.'),
});

export type CheckAvailabilityConflictsInput = z.infer<typeof checkAvailabilityConflictsSchema>;

export interface ParticipantConflictDetail {
  id: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

export interface ParticipantConflictResult {
  participantId: string;
  memberId: string | null;
  hasConflict: boolean;
  unavailabilities: ParticipantConflictDetail[];
}

export interface ScheduleConflictCheckResponse {
  scheduleWindow: {
    startsAt: string;
    endsAt: string;
    durationMinutes: number;
    durationSource: 'explicit' | 'legacy_fallback';
  };
  conflicts: ParticipantConflictResult[];
  unresolvedParticipantIds: string[];
}

export const listConsolidatedAvailabilityQuerySchema = z.object({
  from: z
    .string()
    .trim()
    .min(1, 'A data inicial (from) é obrigatória.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inicial inválido (esperado: YYYY-MM-DD).'),
  to: z
    .string()
    .trim()
    .min(1, 'A data final (to) é obrigatória.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data final inválido (esperado: YYYY-MM-DD).'),
  memberId: z
    .string()
    .trim()
    .min(1, 'O ID do integrante não pode ser vazio se informado.')
    .optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'O parâmetro limit deve ser um número inteiro entre 1 e 100.')
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('O parâmetro limit deve ser um número inteiro.')
        .min(1, 'O parâmetro limit deve ser no mínimo 1.')
        .max(100, 'O parâmetro limit não pode ser superior a 100.')
    ),
  cursor: z.string().trim().optional(),
});

export type ListConsolidatedAvailabilityQueryInput = z.infer<typeof listConsolidatedAvailabilityQuerySchema>;

export interface ListConsolidatedAvailabilityParams {
  from: string;
  to: string;
  limit?: number;
  memberId?: string;
  cursor?: string;
}

export interface ConsolidatedAvailabilityItemDto {
  id: string;
  ministryId: string;
  memberId: string;
  memberName: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
}

export interface ConsolidatedAvailabilityResponseDto {
  window: {
    from: string;
    to: string;
  };
  data: ConsolidatedAvailabilityItemDto[];
  nextCursor: string | null;
}

export function mapToConsolidatedItemDto(
  record: MemberUnavailabilityRecord,
  memberName: string
): ConsolidatedAvailabilityItemDto {
  return {
    id: record.id,
    ministryId: record.ministry_id,
    memberId: record.member_id,
    memberName,
    startDate: record.start_date,
    endDate: record.end_date,
    startTime: record.start_time,
    endTime: record.end_time,
    allDay: record.all_day,
    startsAt: record.starts_at,
    endsAt: record.ends_at,
    // NOTA DE PRIVACIDADE: 'reason', 'user_id' e metadados internos são estritamente omitidos
  };
}
