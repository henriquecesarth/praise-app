import { AppError } from '../../middleware/error-handler';

/**
 * Constante que define o período máximo contínuo para um único registro de indisponibilidade (90 dias).
 * 90 dias * 24 horas * 60 minutos * 60 segundos * 1000 milissegundos = 7.776.000.000 ms.
 */
export const MAX_UNAVAILABILITY_SPAN_MS = 90 * 24 * 60 * 60 * 1000;

export interface CivilDateParts {
  year: number;
  month: number;
  day: number;
}

export interface CivilTimeParts {
  hour: number;
  minute: number;
}

export interface NormalizedCivilInterval {
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  startsAt: string; // YYYY-MM-DDTHH:mm:ss (SEM Z)
  endsAt: string;   // YYYY-MM-DDTHH:mm:ss (SEM Z)
  spanDays: number;
}

export interface UnavailabilityTemporalInput {
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
}

/**
 * Retorna se um ano é bissexto no calendário gregoriano civil.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Retorna a quantidade exata de dias em um determinado mês civil.
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

/**
 * Valida rigorosamente se a string representa uma data civil válida no formato YYYY-MM-DD.
 * Rejeita datas fictícias como 2026-02-30, 2026-04-31, 2026-99-99.
 */
export function parseAndValidateCivilDate(dateStr: string, fieldName = 'data'): CivilDateParts {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new AppError(400, `O campo ${fieldName} deve estar no formato YYYY-MM-DD.`);
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (year < 1900 || year > 2100) {
    throw new AppError(400, `O ano no campo ${fieldName} (${year}) está fora do intervalo permitido (1900-2100).`);
  }

  if (month < 1 || month > 12) {
    throw new AppError(400, `O mês no campo ${fieldName} (${monthStr}) é inválido.`);
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    throw new AppError(
      400,
      `O dia no campo ${fieldName} (${dayStr}) é inválido para o mês ${monthStr}/${yearStr} (máximo: ${maxDays} dias).`
    );
  }

  return { year, month, day };
}

/**
 * Valida se a string representa um horário civil válido no formato HH:mm (00:00 a 23:59).
 */
export function parseAndValidateCivilTime(timeStr: string, fieldName = 'horário'): CivilTimeParts {
  if (typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) {
    throw new AppError(400, `O campo ${fieldName} deve estar no formato HH:mm (ex: 19:30).`);
  }

  const [hourStr, minStr] = timeStr.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);

  if (hour < 0 || hour > 23) {
    throw new AppError(400, `A hora no campo ${fieldName} (${hourStr}) deve estar entre 00 e 23.`);
  }

  if (minute < 0 || minute > 59) {
    throw new AppError(400, `Os minutos no campo ${fieldName} (${minStr}) devem estar entre 00 e 59.`);
  }

  return { hour, minute };
}

/**
 * Converte componentes civis em um escalar milissegundo neutro utilizando Date.UTC exclusivamente
 * para cálculos de diferença e soma sem aplicar qualquer fuso horário local ou do domínio.
 */
export function toCivilScalar(dateParts: CivilDateParts, timeParts: CivilTimeParts, second = 0): number {
  return Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    second
  );
}

/**
 * Adiciona uma quantidade de dias civis inteiros a uma data civil YYYY-MM-DD, retornando uma nova data YYYY-MM-DD.
 */
export function addCivilDays(dateStr: string, days: number): string {
  const parts = parseAndValidateCivilDate(dateStr);
  const scalar = Date.UTC(parts.year, parts.month - 1, parts.day + days);
  const d = new Date(scalar);
  const nextYear = d.getUTCFullYear();
  const nextMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(d.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * Formata os componentes civis estritamente no padrão YYYY-MM-DDTHH:mm:ss SEM Z e SEM timezone.
 */
export function formatCivilDateTime(dateStr: string, timeStr: string, secondStr = '00'): string {
  return `${dateStr}T${timeStr}:${secondStr}`;
}

/**
 * Executa a validação canônica de domínio e normalização temporal para indisponibilidade civil.
 *
 * Invariantes garantidos:
 * 1. starts_at e ends_at no formato YYYY-MM-DDTHH:mm:ss SEM Z.
 * 2. Semântica semi-aberta [starts_at, ends_at).
 * 3. ends_at > starts_at (rejeita zero-length e end < start).
 * 4. Máximo contínuo de 90 dias (<= 90 dias válido, > 90 dias rejeitado).
 * 5. AllDay: startTime/endTime devem ser nulos e ends_at projeta a meia-noite do dia seguinte ao endDate inclusivo.
 * 6. Timed: startTime/endTime obrigatórios e formato estrito.
 */
export function normalizeCivilInterval(input: UnavailabilityTemporalInput): NormalizedCivilInterval {
  const { startDate, endDate, allDay = false, startTime, endTime } = input;

  // 1. Validação calendárica real das datas
  const startParts = parseAndValidateCivilDate(startDate, 'startDate');
  const endParts = parseAndValidateCivilDate(endDate, 'endDate');

  if (allDay) {
    // Para all-day: horários devem ser nulos ou ausentes
    if (startTime || endTime) {
      throw new AppError(400, 'Indisponibilidade de dia inteiro não permite especificar horários de início e fim.');
    }

    // Na experiência do usuário, endDate é inclusivo.
    // Ex: startDate="2026-09-20", endDate="2026-09-20", allDay=true
    // starts_at = "2026-09-20T00:00:00"
    // ends_at = "2026-09-21T00:00:00" (exclusivo, cobre todo o dia 20 até 23:59:59)
    const startScalar = toCivilScalar(startParts, { hour: 0, minute: 0 });
    const endNextDay = addCivilDays(endDate, 1);
    const endNextParts = parseAndValidateCivilDate(endNextDay, 'endDatePlusOne');
    const endScalar = toCivilScalar(endNextParts, { hour: 0, minute: 0 });

    if (endScalar <= startScalar) {
      throw new AppError(400, 'A data final não pode ser anterior à data inicial.');
    }

    const spanMs = endScalar - startScalar;
    if (spanMs > MAX_UNAVAILABILITY_SPAN_MS) {
      throw new AppError(400, 'O período de indisponibilidade não pode exceder 90 dias contínuos.');
    }

    const startsAt = formatCivilDateTime(startDate, '00:00', '00');
    const endsAt = formatCivilDateTime(endNextDay, '00:00', '00');
    const spanDays = Math.round(spanMs / (24 * 60 * 60 * 1000));

    return {
      startDate,
      endDate,
      startTime: null,
      endTime: null,
      allDay: true,
      startsAt,
      endsAt,
      spanDays,
    };
  }

  // 2. Timed (intervalo com horário)
  if (!startTime || !endTime) {
    throw new AppError(400, 'Horário inicial e final são obrigatórios quando não for dia inteiro.');
  }

  const startTimeParts = parseAndValidateCivilTime(startTime, 'startTime');
  const endTimeParts = parseAndValidateCivilTime(endTime, 'endTime');

  const startScalar = toCivilScalar(startParts, startTimeParts);
  const endScalar = toCivilScalar(endParts, endTimeParts);

  if (endScalar <= startScalar) {
    throw new AppError(
      400,
      'O término da indisponibilidade deve ser estritamente posterior ao início (intervalos de duração zero ou negativa são inválidos).'
    );
  }

  const spanMs = endScalar - startScalar;
  if (spanMs > MAX_UNAVAILABILITY_SPAN_MS) {
    throw new AppError(400, 'O período de indisponibilidade não pode exceder 90 dias contínuos.');
  }

  const startsAt = formatCivilDateTime(startDate, startTime, '00');
  const endsAt = formatCivilDateTime(endDate, endTime, '00');
  const spanDays = spanMs / (24 * 60 * 60 * 1000);

  return {
    startDate,
    endDate,
    startTime,
    endTime,
    allDay: false,
    startsAt,
    endsAt,
    spanDays,
  };
}
