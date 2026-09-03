import { config } from '../config/unifiedConfig';

/**
 * Retorna uma data de faturamento formatada em YYYY-MM-DD
 * respeitando estritamente o timezone configurado (padrão: America/Sao_Paulo),
 * evitando discrepâncias entre o horário UTC do servidor e o dia comercial local.
 */
export function getBillingDate(
  date: Date | string = new Date(),
  timeZone: string = config.billingTimezone || 'America/Sao_Paulo'
): string {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return getCurrentBillingDate(new Date(), timeZone);
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

/**
 * Retorna a data corrente de faturamento formatada em YYYY-MM-DD
 */
export function getCurrentBillingDate(
  now: Date = new Date(),
  timeZone: string = config.billingTimezone || 'America/Sao_Paulo'
): string {
  return getBillingDate(now, timeZone);
}

/**
 * Adiciona um intervalo comercial (monthly ou annual) respeitando o calendário civil e fim de mês.
 * Nunca utiliza aproximações fixas como +30 ou +365 dias.
 * Ex: 31/01 + 1 month -> 28/02 (ou 29/02 em ano bissexto)
 * Ex: 29/02/2024 + 1 year -> 28/02/2025
 */
export function addCommercialInterval(
  startDate: Date | string,
  interval: 'monthly' | 'annual',
  timeZone: string = config.billingTimezone || 'America/Sao_Paulo'
): string {
  const startDateStr = getBillingDate(startDate, timeZone);
  const [year, month, day] = startDateStr.split('-').map(Number);

  if (interval === 'annual') {
    const targetYear = year + 1;
    const isLeapTarget = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
    const targetDay = month === 2 && day === 29 && !isLeapTarget ? 28 : day;
    const targetMonthStr = String(month).padStart(2, '0');
    const targetDayStr = String(targetDay).padStart(2, '0');
    return `${targetYear}-${targetMonthStr}-${targetDayStr}`;
  }

  // Intervalo mensal
  let targetYear = year;
  let targetMonth = month + 1;
  if (targetMonth > 12) {
    targetYear += 1;
    targetMonth = 1;
  }

  // Descobre quantos dias existem no mês de destino
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  const targetMonthStr = String(targetMonth).padStart(2, '0');
  const targetDayStr = String(targetDay).padStart(2, '0');
  return `${targetYear}-${targetMonthStr}-${targetDayStr}`;
}

/**
 * Adiciona um número exato de dias civis comerciais (ex.: 7 dias de carência)
 * operando estritamente sobre a data civil YYYY-MM-DD em BILLING_TIMEZONE.
 * Imune a DST, desvios de 168 horas, milissegundos ou conversões UTC imperfeitas.
 * Ex: 2026-10-02 + 7 dias -> 2026-10-09
 */
export function addCommercialDays(
  startDate: Date | string,
  days: number,
  timeZone: string = config.billingTimezone || 'America/Sao_Paulo'
): string {
  const startDateStr = getBillingDate(startDate, timeZone);
  const [year, month, day] = startDateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  const targetYear = utcDate.getUTCFullYear();
  const targetMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const targetDay = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${targetYear}-${targetMonth}-${targetDay}`;
}
