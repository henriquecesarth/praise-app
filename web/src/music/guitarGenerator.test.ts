import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findGuitarVoicings } from './guitarCatalog';
import { decodeShape, encodeShape, expandShape, generateGuitarVoicings, STANDARD_TUNING } from './guitarGenerator';
import { validateGuitarVoicing } from './guitarVoicings';
import type { GuitarVoicing } from './guitarVoicings';
import { parseChord } from './theory';

interface ShapeVector { frets: string; fingers: string; barres: string[]; omits: string[]; baseFret: number; notes: string[] }
interface Vector { chord: string; generated: ShapeVector[]; found: ShapeVector[]; bassClassification: string | null; reason: string | null }
const read = (name: string) => JSON.parse(readFileSync(resolve(`../shared/fixtures/${name}`), 'utf8'));
const corpus = read('guitar-generator-v1.json') as { cases: Vector[] };
const catalog = read('guitar-voicings-v2.json') as { chords: Record<string, string[]> };

const shape = (voicing: GuitarVoicing): ShapeVector => ({
  frets: voicing.strings.map(s => (s.fret === null ? 'x' : s.fret.toString(36))).join(''),
  fingers: voicing.strings.map(s => s.finger ?? 0).join(''),
  barres: voicing.barres.map(b => `${b.fret}:${b.fromString}-${b.toString}:${b.finger}`),
  omits: voicing.omits ?? [],
  baseFret: voicing.baseFret,
  notes: voicing.soundingNotes,
});

function validate(text: string, chordSymbol: string) {
  const chord = parseChord(chordSymbol);
  if (chord.status !== 'parsed') throw new Error(chord.reason);
  return validateGuitarVoicing(expandShape(decodeShape(text), chord, 0), STANDARD_TUNING);
}

describe('guitar generator and catalog v2', () => {
  it.each(corpus.cases)('$chord matches the shared corpus', ({ chord, generated, found, bassClassification, reason }) => {
    expect(generateGuitarVoicings(chord).map(shape)).toEqual(generated);
    const result = findGuitarVoicings(chord);
    expect(result.status === 'available' ? result.voicings.map(shape) : []).toEqual(found);
    expect(result.status === 'available' ? result.bassClassification : null).toBe(bassClassification);
    expect(result.status === 'available' ? null : result.reason).toBe(reason);
  });

  it('keeps every catalog shape valid and round-trips the encoding', () => {
    const failures: string[] = [];
    for (const [symbol, shapes] of Object.entries(catalog.chords)) {
      for (const text of shapes) {
        if (!validate(text, symbol).valid || encodeShape(decodeShape(text)) !== text) failures.push(`${symbol} ${text}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('generates shapes within four frets and four fingers, with the right bass', () => {
    for (const { chord } of corpus.cases) {
      for (const voicing of generateGuitarVoicings(chord)) {
        const fretted = voicing.strings.filter(s => s.status === 'fretted');
        const frets = fretted.map(s => s.fret as number);
        if (frets.length) expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(3);
        expect(new Set(fretted.map(s => s.finger)).size).toBeLessThanOrEqual(4);
        const parsed = parseChord(chord);
        if (parsed.status !== 'parsed') throw new Error(parsed.reason);
        expect(voicing.lowestNote.spelling).toBe((parsed.normalized.bass ?? parsed.normalized.root).spelling);
      }
    }
  });

  it('accepts only a declared perfect fifth omission in seventh or extended chords', () => {
    // x3x34x style C7 without G: C E Bb C.
    expect(validate('x3231x 032410 gen', 'C7').issues.map(i => i.code)).toContain('missingChordTone');
    expect(validate('x3231x 032410 o5 gen', 'C7').valid).toBe(true);
    // Declaring an omission that did not happen is rejected.
    expect(validate('x32010 032010 o5 gen', 'C7M').issues.map(i => i.code)).toContain('invalidOmission');
    // A plain triad never omits its fifth.
    expect(validate('x32x10 032010 o5 gen', 'C').issues.map(i => i.code)).toContain('missingChordTone');
  });

  it('shares shapes between enharmonic spellings and respells the notes', () => {
    const sharp = findGuitarVoicings('C#');
    const flat = findGuitarVoicings('Db');
    if (sharp.status !== 'available' || flat.status !== 'available') throw new Error('missing shape');
    expect(shape(flat.primaryVoicing).frets).toBe(shape(sharp.primaryVoicing).frets);
    expect(flat.primaryVoicing.lowestNote.spelling).toBe('Db');
    expect(sharp.primaryVoicing.lowestNote.spelling).toBe('C#');
  });

  it('keeps the curated shape first and records the origin of each shape', () => {
    const result = findGuitarVoicings('G/B');
    if (result.status !== 'available') throw new Error('missing shape');
    expect(result.primaryVoicing.provenance.origin).toBe('Curadoria própria LouvAIO V3');
    expect(result.bassClassification).toBe('inversion');
    expect(generateGuitarVoicings('C13').every(v => v.provenance.origin === 'Gerador LouvAIO v1')).toBe(true);
  });
});
