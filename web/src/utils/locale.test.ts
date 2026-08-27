import { describe, expect, it } from 'vitest';
import { formatDatePtBR, formatScheduleDateTimePtBR, formatTimePtBR } from './locale';

describe('pt-BR date and time formatting', () => {
  it('keeps ISO values out of the display text', () => {
    expect(formatDatePtBR('2026-08-27')).toBe('27/08/2026');
    expect(formatDatePtBR('2026-08-27T12:00:00.000Z')).toBe('27/08/2026');
  });

  it('uses 24-hour time', () => {
    expect(formatTimePtBR('9:05')).toBe('09:05');
    expect(formatScheduleDateTimePtBR('2026-08-27', '19:30')).toBe('27/08/2026 às 19:30');
  });
});
