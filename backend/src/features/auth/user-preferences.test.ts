import { describe, expect, it } from 'vitest';
import { updatePreferencesSchema } from './auth.types';

describe('updatePreferencesSchema validation', () => {
  it('accepts valid chord preferences alone', () => {
    const result = updatePreferencesSchema.safeParse({ chord_font_family: 'Arial' });
    expect(result.success).toBe(true);
  });

  it('accepts valid vocal range preferences alone', () => {
    const result = updatePreferencesSchema.safeParse({
      vocal_min_midi: 48,
      vocal_max_midi: 72,
    });
    expect(result.success).toBe(true);
  });

  it('accepts combined chord and vocal preferences', () => {
    const result = updatePreferencesSchema.safeParse({
      chord_font_family: 'Georgia',
      chord_line_spacing_px: 4,
      vocal_min_midi: 53,
      vocal_max_midi: 81,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty payload', () => {
    const result = updatePreferencesSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects vocal_min_midi below 48', () => {
    const result = updatePreferencesSchema.safeParse({
      vocal_min_midi: 40,
      vocal_max_midi: 72,
    });
    expect(result.success).toBe(false);
  });

  it('rejects vocal_max_midi above 88', () => {
    const result = updatePreferencesSchema.safeParse({
      vocal_min_midi: 60,
      vocal_max_midi: 90,
    });
    expect(result.success).toBe(false);
  });

  it('rejects vocal_min_midi >= vocal_max_midi', () => {
    const equal = updatePreferencesSchema.safeParse({
      vocal_min_midi: 60,
      vocal_max_midi: 60,
    });
    expect(equal.success).toBe(false);

    const inverted = updatePreferencesSchema.safeParse({
      vocal_min_midi: 72,
      vocal_max_midi: 60,
    });
    expect(inverted.success).toBe(false);
  });

  it('rejects unknown fields in strict mode', () => {
    const result = updatePreferencesSchema.safeParse({
      chord_font_family: 'Arial',
      unexpected_key: true,
    });
    expect(result.success).toBe(false);
  });
});
