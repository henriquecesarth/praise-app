import { AppError } from '../../middleware/error-handler';
import {
  parseAndValidateCivilDate,
  parseAndValidateCivilTime,
  toCivilScalar,
  addCivilDays,
  formatCivilDateTime,
} from './availability-time';

/**
 * Duração padrão de escala para registros legados que não possuem duration_minutes persistido (120 minutos = 2 horas).
 */
export const LEGACY_SCHEDULE_DURATION_MINUTES = 120;

export type DurationSource = 'explicit' | 'legacy_fallback';

export interface ScheduleCivilWindow {
  startsAt: string; // YYYY-MM-DDTHH:mm:ss (SEM Z)
  endsAt: string;   // YYYY-MM-DDTHH:mm:ss (SEM Z)
  durationMinutes: number;
  durationSource: DurationSource;
}

/**
 * Calcula a janela temporal civil [startsAt, endsAt) para uma escala de louvor.
 *
 * Invariantes garantidos:
 * 1. startsAt e endsAt no padrão civil YYYY-MM-DDTHH:mm:ss SEM Z e sem conversão de fuso.
 * 2. Suporte estrito a travessia de meia-noite, mudança de mês, mudança de ano e anos bissextos.
 * 3. Validação estrita de duração entre 15 e 1440 minutos.
 * 4. Aplicação do fallback explícito LEGACY_SCHEDULE_DURATION_MINUTES quando durationMinutes for omitido.
 */
export function calculateScheduleCivilWindow(
  dateStr: string,
  timeStr: string,
  durationMinutes?: number
): ScheduleCivilWindow {
  const dateParts = parseAndValidateCivilDate(dateStr, 'date');
  const timeParts = parseAndValidateCivilTime(timeStr, 'time');

  let resolvedDuration: number;
  let durationSource: DurationSource;

  if (durationMinutes !== undefined && durationMinutes !== null) {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
      throw new AppError(
        400,
        `A duração da escala deve ser um número inteiro entre 15 e 1440 minutos (recebido: ${durationMinutes}).`
      );
    }
    resolvedDuration = durationMinutes;
    durationSource = 'explicit';
  } else {
    resolvedDuration = LEGACY_SCHEDULE_DURATION_MINUTES;
    durationSource = 'legacy_fallback';
  }

  const startScalar = toCivilScalar(dateParts, timeParts, 0);
  const endScalar = startScalar + resolvedDuration * 60 * 1000;

  const d = new Date(endScalar);
  const endYear = d.getUTCFullYear();
  const endMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const endDay = String(d.getUTCDate()).padStart(2, '0');
  const endHour = String(d.getUTCHours()).padStart(2, '0');
  const endMinute = String(d.getUTCMinutes()).padStart(2, '0');
  const endSecond = String(d.getUTCSeconds()).padStart(2, '0');

  const startsAt = formatCivilDateTime(dateStr, timeStr, '00');
  const endsAt = `${endYear}-${endMonth}-${endDay}T${endHour}:${endMinute}:${endSecond}`;

  return {
    startsAt,
    endsAt,
    durationMinutes: resolvedDuration,
    durationSource,
  };
}

/**
 * Avalia se dois intervalos semi-abertos [startsAtA, endsAtA) e [startsAtB, endsAtB) se sobrepõem.
 *
 * Regra canônica:
 * startsAtA < endsAtB && endsAtA > startsAtB
 *
 * Adjacências exatas de borda (ex: 18:00–19:00 e 19:00–21:00) retornam false (sem conflito).
 */
export function checkIntervalOverlap(
  startsAtA: string,
  endsAtA: string,
  startsAtB: string,
  endsAtB: string
): boolean {
  return startsAtA < endsAtB && endsAtA > startsAtB;
}

/**
 * Calcula o limite inferior seguro de busca no Firestore (lookback de 90 dias civis).
 * Como nenhuma indisponibilidade pode ter duração contínua > 90 dias, qualquer indisponibilidade
 * que conflite com scheduleStartsAt deve ter starts_at >= (scheduleDate - 90 dias).
 */
export function calculateLookbackStart(scheduleStartsAt: string): string {
  const scheduleDate = scheduleStartsAt.split('T')[0];
  const lookbackDate = addCivilDays(scheduleDate, -90);
  return `${lookbackDate}T00:00:00`;
}
