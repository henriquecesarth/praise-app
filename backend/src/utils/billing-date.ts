import { config } from '../config/unifiedConfig';

/**
 * Retorna a data corrente de faturamento formatada em YYYY-MM-DD
 * respeitando estritamente o timezone configurado (padrão: America/Sao_Paulo),
 * evitando discrepâncias entre o horário UTC do servidor e o dia comercial local.
 */
export function getCurrentBillingDate(
  now: Date = new Date(),
  timeZone: string = config.billingTimezone || 'America/Sao_Paulo'
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}
