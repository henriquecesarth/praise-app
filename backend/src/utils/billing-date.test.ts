import { describe, it, expect } from 'vitest';
import { getCurrentBillingDate } from './billing-date';

describe('getCurrentBillingDate — Deterministic Timezone Billing Date Helper', () => {
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
});
