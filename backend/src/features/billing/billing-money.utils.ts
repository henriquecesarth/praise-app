/**
 * Utilitários determinísticos e tipados de conversão monetária para o ecossistema de billing.
 *
 * Regra:
 * - Provedor (ex: Asaas): opera em Decimal BRL (ex: 14.90, 376.92, 1119.96)
 * - Domínio LouvAIO: opera exclusivamente em Centavos Inteiros (ex: 1490, 37692, 111996)
 *
 * Não utiliza heurísticas por magnitude (ex: `if value > X`).
 */

/**
 * Converte valor decimal em Reais do provedor para centavos inteiros determinísticos.
 * Ex: 14.90 -> 1490, 376.92 -> 37692, 1119.96 -> 111996
 */
export function providerBrlDecimalToCents(val: number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  const num = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
  if (!Number.isFinite(num) || isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Converte centavos inteiros do domínio para valor decimal em Reais esperado pela API do provedor.
 * Ex: 1490 -> 14.90, 37692 -> 376.92, 111996 -> 1119.96
 */
export function centsToProviderBrlDecimal(cents: number | null | undefined): number {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents === 0) return 0;
  return Number((cents / 100).toFixed(2));
}
