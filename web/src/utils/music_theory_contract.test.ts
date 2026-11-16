import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMusicalChord, transposeChord, transposeNote } from './smart_chord';

interface Note { letter: string; accidental: number; spelling: string; pitchClass: number }
interface Interval { diatonicSteps: number; semitones: number }
interface Normalized {
  kind: string; note?: Note; root?: Note; bass?: Note | null;
  intervals?: Interval[]; inversion?: number | null; bassRole?: string;
  diatonicSteps?: number; semitones?: number; quality?: string;
  octave?: number | null; midi?: number | null; seventh?: string | null; name?: string;
}
interface Result {
  status: string; originalText: string; normalized: Normalized | null;
  notes: Note[]; diatonicSpellings: string[]; pitchClasses: number[];
  reason?: string; category?: string; preservedText?: string;
}
interface Case {
  id: string; operation: string;
  input: { text: string; context?: string; interval?: Interval; semitones?: number; policy?: string };
  expected: Result;
}
interface Corpus {
  format: string; version: number; cases: Case[];
  legacyNotation: { id: string; source: string; expectedPlusTwo: string; unicode?: boolean }[];
  legacyProbes: { id: string; operation: string; text: string; semitones: number; expected: string | boolean }[];
}

// T1 checks the fixture contract, not an implementation of the future theory engine.
const candidates = ['../shared/fixtures/music-theory-v1.json', 'shared/fixtures/music-theory-v1.json'].map(path => resolve(path));
const corpus = JSON.parse(readFileSync(candidates.find(path => existsSync(path)) ?? candidates[0], 'utf8')) as Corpus;
const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const letters = 'CDEFGAB';
const mod = (value: number, base: number) => ((value % base) + base) % base;

function checkNote(note: Note) {
  expect(Object.keys(natural)).toContain(note.letter);
  expect(Number.isInteger(note.accidental)).toBe(true);
  expect(note.accidental).toBeGreaterThanOrEqual(-2);
  expect(note.accidental).toBeLessThanOrEqual(2);
  expect(note.pitchClass).toBe(mod(natural[note.letter] + note.accidental, 12));
  const suffix = note.accidental < 0 ? 'b'.repeat(-note.accidental) : '#'.repeat(note.accidental);
  expect(note.spelling).toBe(note.letter + suffix);
}

describe('T1 shared musical corpus integrity (not engine conformance)', () => {
  it('loads one versioned source, unique IDs and the unchanged 34-case legacy corpus', () => {
    expect(corpus.format).toBe('louvaio.music-theory');
    expect(corpus.version).toBe(1);
    expect(corpus.cases.length).toBeGreaterThanOrEqual(60);
    const ids = [...corpus.cases, ...corpus.legacyNotation, ...corpus.legacyProbes].map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(corpus.legacyNotation).toHaveLength(34);
    expect(new Set(corpus.cases.map(row => row.operation))).toEqual(new Set([
      'parseNote', 'parseInterval', 'parseChord', 'transposeNote', 'transposeChord',
    ]));
  });

  it.each(corpus.cases)('$id: structural and musical invariants', ({ input, expected, operation }) => {
    expect(expected.originalText).toBe(input.text);
    expect(['parsed', 'unsupported']).toContain(expected.status);
    if (expected.status === 'unsupported') {
      expect(expected.normalized).toBeNull();
      expect(expected.preservedText).toBe(input.text);
      expect(['invalidSyntax', 'ambiguousContext', 'unsupportedFeature', 'accidentalRange']).toContain(expected.category);
      expect(expected.reason).toBeTruthy();
      expect(expected.notes).toEqual([]);
      expect(expected.diatonicSpellings).toEqual([]);
      expect(expected.pitchClasses).toEqual([]);
      return;
    }
    const normalized = expected.normalized!;
    expect(normalized).not.toBeNull();
    expect(['note', 'interval', 'chord']).toContain(normalized.kind);
    expect(normalized.kind).toBe(operation.endsWith('Note') ? 'note' : operation.endsWith('Chord') ? 'chord' : 'interval');
    expected.notes.forEach(checkNote);
    expect(expected.diatonicSpellings).toEqual(expected.notes.map(note => note.spelling));
    expect(expected.pitchClasses).toEqual(expected.notes.map(note => note.pitchClass));
    if (normalized.kind === 'interval') {
      expect(expected.notes).toEqual([]);
      expect(Number.isInteger(normalized.diatonicSteps)).toBe(true);
      expect(Number.isInteger(normalized.semitones)).toBe(true);
      expect(operation).toBe('parseInterval');
      expect(normalized.name).toBe(input.text);
      const match = input.text.match(/^(-?)([PMmAd])(\d+)$/)!;
      expect(match).not.toBeNull();
      const direction = match[1] ? -1 : 1;
      const steps = Number(match[3]) - 1;
      const perfect = [0, 3, 4].includes(steps % 7);
      const adjustment = match[2] === 'A' ? 1 : match[2] === 'd' ? (perfect ? -1 : -2) : match[2] === 'm' ? -1 : 0;
      expect(normalized.diatonicSteps).toBe(direction * steps);
      expect(normalized.semitones).toBe(direction * ([0, 2, 4, 5, 7, 9, 11][steps % 7] + 12 * Math.floor(steps / 7) + adjustment));
    } else if (normalized.kind === 'note') {
      expect(expected.notes).toEqual([normalized.note]);
      if (normalized.octave !== null) {
        expect(normalized.midi).toBe(12 * (normalized.octave! + 1) + natural[normalized.note!.letter] + normalized.note!.accidental);
      } else {
        expect(normalized.midi).toBeNull();
      }
    } else {
      const root = normalized.root!;
      checkNote(root);
      expect(normalized.intervals).toHaveLength(expected.notes.length);
      expect(expected.notes[0]).toEqual(root);
      const triads: Record<string, number[]> = {
        major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6],
        augmented: [0, 4, 8], suspended2: [0, 2, 7], suspended4: [0, 5, 7],
      };
      expect(normalized.intervals!.slice(0, 3).map(value => value.semitones)).toEqual(triads[normalized.quality!]);
      if (normalized.seventh !== null) {
        const seventh: Record<string, number> = { major: 11, minor: 10, diminished: 9 };
        expect(normalized.intervals!.find(value => value.diatonicSteps === 6)?.semitones).toBe(seventh[normalized.seventh!]);
      }
      normalized.intervals!.forEach((interval, index) => {
        const tone = expected.notes[index];
        expect(tone.pitchClass).toBe(mod(root.pitchClass + interval.semitones, 12));
        expect(tone.letter).toBe(letters[mod(letters.indexOf(root.letter) + interval.diatonicSteps, 7)]);
      });
      if (normalized.bass) {
        checkNote(normalized.bass);
        const index = expected.notes.findIndex(tone => tone.spelling === normalized.bass!.spelling);
        expect(normalized.inversion).toBe(index < 0 ? null : index);
        expect(normalized.bassRole).toBe(index < 0 ? 'nonChordTone' : 'chordTone');
      } else {
        expect(normalized.inversion).toBeNull();
        expect(normalized.bassRole).toBe('unspecified');
      }
    }
    if (operation.startsWith('transpose')) {
      const source = corpus.cases.find(row => row.operation === (normalized.kind === 'note' ? 'parseNote' : 'parseChord') && row.input.text === input.text && row.expected.status === 'parsed');
      expect(source, 'each transposition has an explicit source parse case').toBeDefined();
      const semitones = input.interval?.semitones ?? input.semitones!;
      expect(expected.pitchClasses).toEqual(source!.expected.pitchClasses.map(pc => mod(pc + semitones, 12)));
      if (input.interval) {
        expected.notes.forEach((note, index) => {
          const original = source!.expected.notes[index];
          expect(note.letter).toBe(letters[mod(letters.indexOf(original.letter) + input.interval!.diatonicSteps, 7)]);
        });
      }
    }
  });

  it('pins Brazilian notation, inversions and enharmonic spelling independently', () => {
    const result = (id: string) => corpus.cases.find(row => row.id === id)!.expected;
    expect(result('chord-c7m').diatonicSpellings).toEqual(['C', 'E', 'G', 'B']);
    expect(result('chord-fsharp-half-diminished').diatonicSpellings).toEqual(['F#', 'A', 'C', 'E']);
    expect(result('chord-g-over-b').normalized?.inversion).toBe(1);
    expect(result('chord-cadd9-over-e').diatonicSpellings).toEqual(['C', 'E', 'G', 'D']);
    expect(result('chord-c-over-fsharp').normalized?.inversion).toBeNull();
    expect(result('note-bsharp').diatonicSpellings).toEqual(['B#']);
    expect(result('note-bsharp').pitchClasses).toEqual([0]);
    expect(result('chord-csharp-augmented').diatonicSpellings).toEqual(['C#', 'E#', 'G##']);
    expect(result('transpose-c-minor-second').diatonicSpellings).toEqual(['Db']);
    expect(result('transpose-c-chromatic-one').diatonicSpellings).toEqual(['C#']);
    expect(result('transpose-c-over-e-major-second').normalized?.bass?.spelling).toBe('F#');
  });
});

describe('shared legacy observations (no normative engine claims)', () => {
  it.each(corpus.legacyProbes)('$id', row => {
    const output = row.operation === 'transposeNote' ? transposeNote(row.text, row.semitones)
      : row.operation === 'transposeChord' ? transposeChord(row.text, row.semitones)
      : isMusicalChord(row.text);
    expect(output).toBe(row.expected);
  });
});
