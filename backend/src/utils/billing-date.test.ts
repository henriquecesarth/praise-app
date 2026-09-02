import { describe, it, expect } from 'vitest';
import { getCurrentBillingDate, getBillingDate, addCommercialInterval } from './billing-date';

describe('getBillingDate & getCurrentBillingDate — Deterministic Timezone Billing Date Helper', () => {
  const timeZone = 'America/Sao_Paulo';

  it('deve retornar a data local correta quando o instante UTC já avançou para o dia seguinte (bug de fronteira UTC)', () => {
    // 2026-08-31T02:17:00.000Z corresponde a 2026-08-30 23:17:00 em America/Sao_Paulo (UTC-3)
    const utcDate = new Date('2026-08-31T02:17:00.000Z');
    const result = getCurrentBillingDate(utcDate, timeZone);

    expect(result).toBe('2026-08-30');
    expect(result).not.toBe('2026-08-31');
  });

  it('deve formatar corretamente no início do dia local (00:15 UTC-3 -> 03:15 UTC)', () => {
    const earlyMorning = new Date('2026-08-30T03:15:00.000Z'); // 00:15 no Brasil
    const result = getCurrentBillingDate(earlyMorning, timeZone);

    expect(result).toBe('2026-08-30');
  });

  it('deve formatar corretamente ao meio-dia local (12:00 UTC-3 -> 15:00 UTC)', () => {
    const noon = new Date('2026-08-30T15:00:00.000Z');
    const result = getCurrentBillingDate(noon, timeZone);

    expect(result).toBe('2026-08-30');
  });

  it('deve formatar corretamente no final da noite local (23:59 UTC-3 -> 02:59 UTC do dia seguinte)', () => {
    const lateNight = new Date('2026-08-31T02:59:59.000Z'); // 23:59:59 no Brasil
    const result = getCurrentBillingDate(lateNight, timeZone);

    expect(result).toBe('2026-08-30');
  });

  it('deve tratar a virada de mês corretamente (01/09 01:00 UTC -> 31/08 22:00 UTC-3)', () => {
    const monthTransition = new Date('2026-09-01T01:00:00.000Z');
    const result = getCurrentBillingDate(monthTransition, timeZone);

    expect(result).toBe('2026-08-31');
  });

  it('deve tratar a virada de ano corretamente (01/01/2027 01:30 UTC -> 31/12/2026 22:30 UTC-3)', () => {
    const yearTransition = new Date('2027-01-01T01:30:00.000Z');
    const result = getCurrentBillingDate(yearTransition, timeZone);

    expect(result).toBe('2026-12-31');
  });

  it('getBillingDate: deve formatar corretamente string ISO-8601 de current_period_end em timezone comercial', () => {
    const periodEndIso = '2026-09-30T23:59:59.000Z'; // 20:59:59 no Brasil em 30/09
    const formatted = getBillingDate(periodEndIso, timeZone);

    expect(formatted).toBe('2026-09-30');
  });

  it('getBillingDate: deve tratar string de data já no dia seguinte UTC preservando o dia comercial', () => {
    const earlyMorningUtc = '2026-10-01T02:00:00.000Z'; // 23:00 no Brasil em 30/09
    const formatted = getBillingDate(earlyMorningUtc, timeZone);

    expect(formatted).toBe('2026-09-30');
  });

  it('getBillingDate: cutoff de current_period_end 2026-09-30T02:59:38.609Z em America/Sao_Paulo resulta em 2026-09-29', () => {
    const cutoffDateIso = '2026-09-30T02:59:38.609Z'; // 23:59:38 no Brasil em 29/09
    const formatted = getBillingDate(cutoffDateIso, timeZone);

    expect(formatted).toBe('2026-09-29');
  });

  describe('addCommercialInterval — Calendar-Exact Addition', () => {
    it('deve adicionar 1 mês civil respeitando fim de mês em meses de tamanhos diferentes', () => {
      // 31 de janeiro em ano não bissexto -> 28 de fevereiro
      expect(addCommercialInterval('2026-01-31', 'monthly', timeZone)).toBe('2026-02-28');
      // 31 de janeiro em ano bissexto -> 29 de fevereiro
      expect(addCommercialInterval('2024-01-31', 'monthly', timeZone)).toBe('2024-02-29');
      // 31 de março -> 30 de abril
      expect(addCommercialInterval('2026-03-31', 'monthly', timeZone)).toBe('2026-04-30');
      // 15 de setembro -> 15 de outubro
      expect(addCommercialInterval('2026-09-15', 'monthly', timeZone)).toBe('2026-10-15');
      // 31 de dezembro -> 31 de janeiro do próximo ano
      expect(addCommercialInterval('2026-12-31', 'monthly', timeZone)).toBe('2027-01-31');
    });

    it('deve adicionar 1 ano civil respeitando ano bissexto', () => {
      // 29 de fevereiro de ano bissexto -> 28 de fevereiro do ano seguinte
      expect(addCommercialInterval('2024-02-29', 'annual', timeZone)).toBe('2025-02-28');
      // 15 de setembro de 2026 -> 15 de setembro de 2027
      expect(addCommercialInterval('2026-09-15', 'annual', timeZone)).toBe('2027-09-15');
    });
  });
});
