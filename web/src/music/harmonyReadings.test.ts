import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeHarmony } from './theory';

interface Vector { id: string; input: { chord: string; key: string | null; previous?: string; next?: string }; expected: unknown }
const corpus = JSON.parse(readFileSync(resolve('../shared/fixtures/harmony-analysis-v2.json'), 'utf8')) as { cases: Vector[] };

describe('harmony v2 readings', () => {
  it.each(corpus.cases)('$id matches the shared corpus', ({ input, expected }) => {
    const { chord, key, previous, next } = input;
    expect(analyzeHarmony(chord, key, { previous, next })).toEqual(expected);
  });

  it('lists every plausible reading instead of choosing one', () => {
    expect(analyzeHarmony('G7', 'Am').readings.map(r => r.label)).toEqual(['VII7', 'V7/III']);
    expect(analyzeHarmony('F/G', 'C').readings.map(r => r.label)).toEqual(['V9sus4', 'IV sobre pedal de dominante']);
    expect(analyzeHarmony('Db', 'C')).toMatchObject({ status: 'indeterminate', reason: 'outsideCoverage', readings: [] });
  });
});
