import { describe, it, expect } from 'vitest';
import {
  calculateScheduleCivilWindow,
  checkIntervalOverlap,
  calculateLookbackStart,
  LEGACY_SCHEDULE_DURATION_MINUTES,
} from './conflict-engine';

describe('Availability Conflict Engine — Pure Domain Suite (Phase 6C)', () => {
  describe('1. Schedule Civil Window Calculation', () => {
    it('calcula janela no mesmo dia com duração explícita', () => {
      const window = calculateScheduleCivilWindow('2026-09-20', '19:00', 120);
      expect(window.startsAt).toBe('2026-09-20T19:00:00');
      expect(window.endsAt).toBe('2026-09-20T21:00:00');
      expect(window.durationMinutes).toBe(120);
      expect(window.durationSource).toBe('explicit');
      expect(window.startsAt.endsWith('Z')).toBe(false);
      expect(window.endsAt.endsWith('Z')).toBe(false);
    });

    it('aplica fallback de 120 minutos para escalas legadas quando durationMinutes é omitido', () => {
      const window = calculateScheduleCivilWindow('2026-09-20', '19:00');
      expect(window.startsAt).toBe('2026-09-20T19:00:00');
      expect(window.endsAt).toBe('2026-09-20T21:00:00');
      expect(window.durationMinutes).toBe(LEGACY_SCHEDULE_DURATION_MINUTES);
      expect(window.durationSource).toBe('legacy_fallback');
    });

    it('calcula corretamente travessia de meia-noite (cross-midnight)', () => {
      const window = calculateScheduleCivilWindow('2026-09-20', '23:30', 120);
      expect(window.startsAt).toBe('2026-09-20T23:30:00');
      expect(window.endsAt).toBe('2026-09-21T01:30:00');
      expect(window.durationMinutes).toBe(120);
      expect(window.startsAt.endsWith('Z')).toBe(false);
      expect(window.endsAt.endsWith('Z')).toBe(false);
    });

    it('calcula corretamente travessia de fim de mês (cross-month)', () => {
      const window = calculateScheduleCivilWindow('2026-09-30', '23:00', 90);
      expect(window.startsAt).toBe('2026-09-30T23:00:00');
      expect(window.endsAt).toBe('2026-10-01T00:30:00');
    });

    it('calcula corretamente travessia de fim de ano (cross-year)', () => {
      const window = calculateScheduleCivilWindow('2026-12-31', '23:00', 180);
      expect(window.startsAt).toBe('2026-12-31T23:00:00');
      expect(window.endsAt).toBe('2027-01-01T02:00:00');
    });

    it('calcula corretamente travessia em ano bissexto (leap year 2028-02-29)', () => {
      const window = calculateScheduleCivilWindow('2028-02-29', '23:30', 60);
      expect(window.startsAt).toBe('2028-02-29T23:30:00');
      expect(window.endsAt).toBe('2028-03-01T00:30:00');
    });

    it('aceita duração mínima de 15 minutos', () => {
      const window = calculateScheduleCivilWindow('2026-09-20', '19:00', 15);
      expect(window.startsAt).toBe('2026-09-20T19:00:00');
      expect(window.endsAt).toBe('2026-09-20T19:15:00');
      expect(window.durationMinutes).toBe(15);
    });

    it('aceita duração máxima de 1440 minutos (24 horas)', () => {
      const window = calculateScheduleCivilWindow('2026-09-20', '10:00', 1440);
      expect(window.startsAt).toBe('2026-09-20T10:00:00');
      expect(window.endsAt).toBe('2026-09-21T10:00:00');
      expect(window.durationMinutes).toBe(1440);
    });

    it('rejeita duração menor que 15 minutos com 400', () => {
      expect(() => calculateScheduleCivilWindow('2026-09-20', '19:00', 14)).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });

    it('rejeita duração maior que 1440 minutos com 400', () => {
      expect(() => calculateScheduleCivilWindow('2026-09-20', '19:00', 1441)).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });

    it('rejeita duração fracionada/decimal com 400', () => {
      expect(() => calculateScheduleCivilWindow('2026-09-20', '19:00', 90.5)).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });

    it('rejeita data inválida no calendário', () => {
      expect(() => calculateScheduleCivilWindow('2026-02-30', '19:00', 120)).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });

    it('rejeita hora inválida', () => {
      expect(() => calculateScheduleCivilWindow('2026-09-20', '25:00', 120)).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });
  });

  describe('2. Canonical Interval Overlap Rule', () => {
    const schedStart = '2026-09-20T19:00:00';
    const schedEnd = '2026-09-20T21:00:00';

    it('detecta sobreposição com contenção total da escala pela indisponibilidade', () => {
      // Indisponibilidade das 18:00 às 22:00
      expect(checkIntervalOverlap('2026-09-20T18:00:00', '2026-09-20T22:00:00', schedStart, schedEnd)).toBe(true);
    });

    it('detecta sobreposição com contenção total da indisponibilidade pela escala', () => {
      // Indisponibilidade das 19:30 às 20:30
      expect(checkIntervalOverlap('2026-09-20T19:30:00', '2026-09-20T20:30:00', schedStart, schedEnd)).toBe(true);
    });

    it('detecta sobreposição com invasão pelo início (overlap à esquerda)', () => {
      // Indisponibilidade das 18:00 às 19:01 (1 minuto de conflito)
      expect(checkIntervalOverlap('2026-09-20T18:00:00', '2026-09-20T19:01:00', schedStart, schedEnd)).toBe(true);
    });

    it('detecta sobreposição com invasão pelo final (overlap à direita)', () => {
      // Indisponibilidade das 20:59 às 22:00 (1 minuto de conflito)
      expect(checkIntervalOverlap('2026-09-20T20:59:00', '2026-09-20T22:00:00', schedStart, schedEnd)).toBe(true);
    });

    it('NÃO detecta conflito em adjacência exata à esquerda (18:00-19:00)', () => {
      expect(checkIntervalOverlap('2026-09-20T18:00:00', '2026-09-20T19:00:00', schedStart, schedEnd)).toBe(false);
    });

    it('NÃO detecta conflito em adjacência exata à direita (21:00-22:00)', () => {
      expect(checkIntervalOverlap('2026-09-20T21:00:00', '2026-09-20T22:00:00', schedStart, schedEnd)).toBe(false);
    });

    it('NÃO detecta conflito quando a indisponibilidade termina bem antes', () => {
      expect(checkIntervalOverlap('2026-09-20T10:00:00', '2026-09-20T12:00:00', schedStart, schedEnd)).toBe(false);
    });

    it('NÃO detecta conflito quando a indisponibilidade começa bem depois', () => {
      expect(checkIntervalOverlap('2026-09-20T22:00:00', '2026-09-20T23:00:00', schedStart, schedEnd)).toBe(false);
    });

    it('detecta conflito com indisponibilidade de dia inteiro cobrindo a escala', () => {
      // Dia inteiro em 2026-09-20: [2026-09-20T00:00:00, 2026-09-21T00:00:00)
      const allDayStart = '2026-09-20T00:00:00';
      const allDayEnd = '2026-09-21T00:00:00';
      expect(checkIntervalOverlap(allDayStart, allDayEnd, schedStart, schedEnd)).toBe(true);
    });

    it('detecta conflito com indisponibilidade multi-dias contendo a data da escala', () => {
      const multiDayStart = '2026-09-15T00:00:00';
      const multiDayEnd = '2026-09-25T00:00:00';
      expect(checkIntervalOverlap(multiDayStart, multiDayEnd, schedStart, schedEnd)).toBe(true);
    });
  });

  describe('3. Lookback Start Calculation', () => {
    it('calcula 90 dias civis exatos antes da data da escala', () => {
      const lookback = calculateLookbackStart('2026-09-20T19:00:00');
      // 90 dias antes de 2026-09-20 é 2026-06-22
      expect(lookback).toBe('2026-06-22T00:00:00');
      expect(lookback.endsWith('Z')).toBe(false);
    });
  });
});
