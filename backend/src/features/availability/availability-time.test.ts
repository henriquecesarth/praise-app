import { describe, it, expect } from 'vitest';
import {
  isLeapYear,
  getDaysInMonth,
  parseAndValidateCivilDate,
  parseAndValidateCivilTime,
  addCivilDays,
  normalizeCivilInterval,
  formatCivilDateTime,
  parseAndValidatePlanningWindow,
  MAX_UNAVAILABILITY_SPAN_MS,
} from './availability-time';
import { AppError } from '../../middleware/error-handler';

describe('availability-time (Civil Wall-Clock Semantics)', () => {
  describe('Leap Year and Calendar Validation', () => {
    it('corretamente identifica anos bissextos e não bissextos', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2026)).toBe(false);
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(1900)).toBe(false);
      expect(isLeapYear(2100)).toBe(false);
    });

    it('valida contagem de dias em fevereiro para anos normais e bissextos', () => {
      expect(getDaysInMonth(2024, 2)).toBe(29);
      expect(getDaysInMonth(2025, 2)).toBe(28);
      expect(getDaysInMonth(2026, 2)).toBe(28);
    });

    it('aceita 29 de fevereiro em ano bissexto (2024-02-29)', () => {
      const parts = parseAndValidateCivilDate('2024-02-29');
      expect(parts).toEqual({ year: 2024, month: 2, day: 29 });
    });

    it('rejeita 29 de fevereiro em ano não bissexto (2026-02-29)', () => {
      expect(() => parseAndValidateCivilDate('2026-02-29')).toThrow(AppError);
    });

    it('rejeita datas inexistentes como 2026-02-30 e 2026-04-31', () => {
      expect(() => parseAndValidateCivilDate('2026-02-30')).toThrow(AppError);
      expect(() => parseAndValidateCivilDate('2026-04-31')).toThrow(AppError);
      expect(() => parseAndValidateCivilDate('2026-99-99')).toThrow(AppError);
      expect(() => parseAndValidateCivilDate('invalid-date')).toThrow(AppError);
    });

    it('valida horários e rejeita horas ou minutos fora de 00:00 a 23:59', () => {
      expect(parseAndValidateCivilTime('00:00')).toEqual({ hour: 0, minute: 0 });
      expect(parseAndValidateCivilTime('23:59')).toEqual({ hour: 23, minute: 59 });
      expect(() => parseAndValidateCivilTime('24:00')).toThrow(AppError);
      expect(() => parseAndValidateCivilTime('12:60')).toThrow(AppError);
      expect(() => parseAndValidateCivilTime('bad')).toThrow(AppError);
    });
  });

  describe('Civil Days Arithmetic', () => {
    it('adiciona dias civis mantendo coerência calendárica sem fuso horário', () => {
      expect(addCivilDays('2026-09-20', 1)).toBe('2026-09-21');
      expect(addCivilDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addCivilDays('2024-02-28', 1)).toBe('2024-02-29');
      expect(addCivilDays('2024-02-28', 2)).toBe('2024-03-01');
      expect(addCivilDays('2026-12-31', 1)).toBe('2027-01-01');
    });
  });

  describe('All-Day Normalization', () => {
    it('normaliza dia inteiro de um único dia (ends_at exclusivo no dia seguinte)', () => {
      const result = normalizeCivilInterval({
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        allDay: true,
      });

      expect(result.startsAt).toBe('2026-09-20T00:00:00');
      expect(result.endsAt).toBe('2026-09-21T00:00:00');
      expect(result.allDay).toBe(true);
      expect(result.startTime).toBeNull();
      expect(result.endTime).toBeNull();
      expect(result.spanDays).toBe(1);

      // NUNCA conter Z
      expect(result.startsAt.endsWith('Z')).toBe(false);
      expect(result.endsAt.endsWith('Z')).toBe(false);
    });

    it('normaliza dia inteiro para múltiplos dias (endDate inclusivo)', () => {
      const result = normalizeCivilInterval({
        startDate: '2026-09-20',
        endDate: '2026-09-22',
        allDay: true,
      });

      expect(result.startsAt).toBe('2026-09-20T00:00:00');
      expect(result.endsAt).toBe('2026-09-23T00:00:00');
      expect(result.spanDays).toBe(3);
    });

    it('rejeita allDay quando horários forem informados', () => {
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-09-20',
          endDate: '2026-09-20',
          allDay: true,
          startTime: '10:00',
        })
      ).toThrow('Indisponibilidade de dia inteiro não permite especificar horários');
    });

    it('rejeita allDay quando endDate for anterior a startDate', () => {
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-09-25',
          endDate: '2026-09-20',
          allDay: true,
        })
      ).toThrow('A data final não pode ser anterior à data inicial');
    });
  });

  describe('Timed Interval Normalization', () => {
    it('normaliza intervalo timed no mesmo dia', () => {
      const result = normalizeCivilInterval({
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        startTime: '18:00',
        endTime: '21:00',
        allDay: false,
      });

      expect(result.startsAt).toBe('2026-09-20T18:00:00');
      expect(result.endsAt).toBe('2026-09-20T21:00:00');
      expect(result.allDay).toBe(false);
      expect(result.startsAt.endsWith('Z')).toBe(false);
      expect(result.endsAt.endsWith('Z')).toBe(false);
    });

    it('normaliza intervalo timed que cruza meia-noite (cross-midnight multi-day)', () => {
      const result = normalizeCivilInterval({
        startDate: '2026-09-20',
        endDate: '2026-09-21',
        startTime: '22:00',
        endTime: '02:00',
        allDay: false,
      });

      expect(result.startsAt).toBe('2026-09-20T22:00:00');
      expect(result.endsAt).toBe('2026-09-21T02:00:00');
      expect(result.spanDays).toBe(4 / 24);
    });

    it('rejeita intervalo timed com duração zero (starts_at === ends_at)', () => {
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-09-20',
          endDate: '2026-09-20',
          startTime: '19:00',
          endTime: '19:00',
          allDay: false,
        })
      ).toThrow('O término da indisponibilidade deve ser estritamente posterior ao início');
    });

    it('rejeita intervalo timed com término anterior ao início no mesmo dia', () => {
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-09-20',
          endDate: '2026-09-20',
          startTime: '21:00',
          endTime: '19:00',
          allDay: false,
        })
      ).toThrow('O término da indisponibilidade deve ser estritamente posterior ao início');
    });

    it('rejeita timed quando startTime ou endTime estiverem ausentes', () => {
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-09-20',
          endDate: '2026-09-20',
          allDay: false,
        })
      ).toThrow('Horário inicial e final são obrigatórios');
    });
  });

  describe('90-day Continuous Limit Enforced', () => {
    it('aceita período de exatamente 90 dias contínuos', () => {
      // De 2026-01-01 até 2026-03-31:
      // Janeiro (31) + Fevereiro (28) + Março (31) = exatamente 90 dias inclusivos!
      // starts_at: 2026-01-01T00:00:00
      // ends_at: 2026-04-01T00:00:00 (90 dias inteiros)
      const result = normalizeCivilInterval({
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        allDay: true,
      });

      expect(result.spanDays).toBe(90);
      expect(result.startsAt).toBe('2026-01-01T00:00:00');
      expect(result.endsAt).toBe('2026-04-01T00:00:00');
    });

    it('rejeita período superior a 90 dias contínuos (91 dias)', () => {
      // De 2026-01-01 até 2026-04-01: 91 dias
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-01-01',
          endDate: '2026-04-01',
          allDay: true,
        })
      ).toThrow('O período de indisponibilidade não pode exceder 90 dias contínuos');
    });

    it('rejeita timed superior a 90 dias', () => {
      expect(() =>
        normalizeCivilInterval({
          startDate: '2026-01-01',
          endDate: '2026-04-01',
          startTime: '08:00',
          endTime: '12:00',
          allDay: false,
        })
      ).toThrow('O período de indisponibilidade não pode exceder 90 dias contínuos');
    });
  });

  describe('Civil Planning Window Validation (Phase 6D-1)', () => {
    it('aceita consulta para um único dia civil (inclusiveDays = 1)', () => {
      const window = parseAndValidatePlanningWindow('2026-09-10', '2026-09-10');
      expect(window.from).toBe('2026-09-10');
      expect(window.to).toBe('2026-09-10');
      expect(window.inclusiveDays).toBe(1);
      expect(window.windowStart).toBe('2026-09-10T00:00:00');
      expect(window.windowEndExclusive).toBe('2026-09-11T00:00:00');
      expect(window.lookbackStart).toBe('2026-06-12T00:00:00');
      expect(window.windowStart.endsWith('Z')).toBe(false);
      expect(window.windowEndExclusive.endsWith('Z')).toBe(false);
      expect(window.lookbackStart.endsWith('Z')).toBe(false);
    });

    it('aceita período de 7 dias civis', () => {
      const window = parseAndValidatePlanningWindow('2026-09-10', '2026-09-16');
      expect(window.inclusiveDays).toBe(7);
      expect(window.windowStart).toBe('2026-09-10T00:00:00');
      expect(window.windowEndExclusive).toBe('2026-09-17T00:00:00');
    });

    it('aceita período de 30 dias civis', () => {
      const window = parseAndValidatePlanningWindow('2026-09-01', '2026-09-30');
      expect(window.inclusiveDays).toBe(30);
      expect(window.windowStart).toBe('2026-09-01T00:00:00');
      expect(window.windowEndExclusive).toBe('2026-10-01T00:00:00');
    });

    it('aceita exatamente 90 dias civis inclusivos (limite máximo permitido)', () => {
      // 2026-01-01 até 2026-03-31: 31 (jan) + 28 (fev) + 31 (mar) = 90 dias
      const window = parseAndValidatePlanningWindow('2026-01-01', '2026-03-31');
      expect(window.inclusiveDays).toBe(90);
      expect(window.windowStart).toBe('2026-01-01T00:00:00');
      expect(window.windowEndExclusive).toBe('2026-04-01T00:00:00');
      expect(window.lookbackStart).toBe('2025-10-03T00:00:00');
    });

    it('rejeita período superior a 90 dias civis (91 dias) com MAX_PLANNING_WINDOW_EXCEEDED', () => {
      // 2026-01-01 até 2026-04-01: 91 dias
      expect(() => parseAndValidatePlanningWindow('2026-01-01', '2026-04-01')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'MAX_PLANNING_WINDOW_EXCEEDED' }),
        })
      );
    });

    it('rejeita to anterior a from com INVALID_DATE_RANGE', () => {
      expect(() => parseAndValidatePlanningWindow('2026-09-15', '2026-09-10')).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
        })
      );
    });

    it('rejeita datas não-gregorianas inexistentes (2026-02-30)', () => {
      expect(() => parseAndValidatePlanningWindow('2026-02-30', '2026-03-15')).toThrow(AppError);
      expect(() => parseAndValidatePlanningWindow('2026-01-01', '2026-04-31')).toThrow(AppError);
    });

    it('rejeita strings em formato inválido', () => {
      expect(() => parseAndValidatePlanningWindow('invalid', '2026-09-15')).toThrow(AppError);
      expect(() => parseAndValidatePlanningWindow('2026-09-10', '15/09/2026')).toThrow(AppError);
    });
  });
});
