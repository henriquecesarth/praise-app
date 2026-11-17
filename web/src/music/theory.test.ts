import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeBass,
  analyzeDegree,
  chordTones,
  parseChord,
  parseInterval,
  parseKeyContext,
  parseNote,
  spellPitch,
  transposeChord,
  transposeNote,
} from './theory';
import type { ChordContext, KeyContextInput, Result, TransposeOptions } from './theory';

interface Vector {
  id: string;
  operation: 'parseNote' | 'parseInterval' | 'parseChord' | 'transposeNote' | 'transposeChord';
  input: { text: string; context?: 'chordSymbol' | 'lyric' } & Partial<TransposeOptions>;
  expected: unknown;
}
const corpus = JSON.parse(readFileSync(resolve('../shared/fixtures/music-theory-v1.json'), 'utf8')) as { cases: Vector[] };
const up = { policy: 'diatonic', interval: { diatonicSteps: 1, semitones: 2 } } as const;
const down = { policy: 'diatonic', interval: { diatonicSteps: -1, semitones: -2 } } as const;
function parsed<T>(result: Result<T>): T {
  expect(result.status).toBe('parsed');
  if (result.status !== 'parsed') throw new Error(result.reason);
  return result.normalized;
}

describe('T2 TypeScript music theory engine', () => {
  it.each(corpus.cases)('$id conforms to the normative result', ({ operation, input, expected }) => {
    const before = JSON.stringify(input);
    let actual: unknown;
    switch (operation) {
      case 'parseNote': actual = parseNote(input.text); break;
      case 'parseInterval': actual = parseInterval(input.text); break;
      case 'parseChord': actual = parseChord(input.text, input.context); break;
      case 'transposeNote': actual = transposeNote(input.text, input as TransposeOptions); break;
      case 'transposeChord': actual = transposeChord(input.text, input as TransposeOptions); break;
    }
    expect(actual).toEqual(expected);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('spells pitches by explicit letter or accidental preference', () => {
    expect(parsed(spellPitch(1)).note.spelling).toBe('C#');
    expect(parsed(spellPitch(1, { preference: 'flats' })).note.spelling).toBe('Db');
    expect(parsed(spellPitch(0, { letter: 'B' })).note.spelling).toBe('B#');
    expect(parsed(spellPitch(0, { letter: 'D' })).note.spelling).toBe('Dbb');
    expect(spellPitch(0).originalText).toBe('0');
    expect(spellPitch(0, { letter: 'A' })).toMatchObject({ status: 'unsupported', category: 'accidentalRange', reason: 'targetRequiresTripleAccidental' });
    for (const value of [-1, 12, 1.5, NaN, Infinity]) {
      expect(spellPitch(value)).toMatchObject({ status: 'unsupported', category: 'invalidSyntax', reason: 'invalidPitchClass' });
    }
  });

  it('spells all twelve classes with both preferences and rejects foreign runtime values', () => {
    const sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    for (let pitch = 0; pitch < 12; pitch++) {
      expect(spellPitch(pitch).diatonicSpellings).toEqual([sharps[pitch]]);
      expect(spellPitch(pitch, { preference: 'flats' }).diatonicSpellings).toEqual([flats[pitch]]);
      expect(parsed(spellPitch(pitch)).midi).toBeNull();
    }
    for (const invalid of [null, {}, '1', true, [], 1n]) expect(spellPitch(invalid as number)).toMatchObject({ status: 'unsupported', reason: 'invalidPitchClass' });
    for (const invalid of [null, [], { letter: 'H' }, { letter: {} }, { letter: 'toString' }, { preference: 'random' }]) {
      expect(spellPitch(1, invalid as Parameters<typeof spellPitch>[1])).toMatchObject({ status: 'unsupported', reason: 'invalidSpellingOptions' });
    }
    expect(parseChord('C', 'unknown' as Parameters<typeof parseChord>[1])).toMatchObject({ status: 'unsupported', reason: 'invalidContext' });
  });

  it('preserves scientific octaves through enharmonic and negative transposition', () => {
    expect(parsed(transposeNote('B#3', up))).toMatchObject({ note: { spelling: 'C##' }, octave: 4, midi: 62 });
    expect(parsed(transposeNote('C-1', down))).toMatchObject({ note: { spelling: 'Bb' }, octave: -2, midi: -2 });
    expect(parsed(transposeNote('Cb4', { policy: 'chromaticSharps', semitones: 0 }))).toMatchObject({ note: { spelling: 'B' }, octave: 3, midi: 59 });
    expect(parsed(transposeNote('B#3', { policy: 'chromaticSharps', semitones: -12 }))).toMatchObject({ note: { spelling: 'C' }, octave: 3, midi: 48 });
  });

  it('supports non-corpus roots, extensions and convenience tone operation', () => {
    expect(chordTones('Ebmin13/Gb')).toEqual(parseChord('Ebmin13/Gb'));
    expect(parseChord('Ebmin13/Gb').diatonicSpellings).toEqual(['Eb', 'Gb', 'Bb', 'Db', 'F', 'Ab', 'C']);
    expect(parseChord('Dmaj9').diatonicSpellings).toEqual(['D', 'F#', 'A', 'C#', 'E']);
    expect(parseChord('A6').diatonicSpellings).toEqual(['A', 'C#', 'E', 'F#']);
    expect(parseChord('Gsus4add9').diatonicSpellings).toEqual(['G', 'C', 'D', 'A']);
    expect(parsed(parseChord('C/B#'))).toMatchObject({ bassRole: 'nonChordTone', inversion: null });
    expect(parsed(transposeChord('C/E', { policy: 'chromaticSharps', semitones: 1 }))).toMatchObject({ canonicalSymbol: 'C#/E#', inversion: 1 });
    expect(parsed(transposeChord('C/F#', { policy: 'chromaticSharps', semitones: 1 }))).toMatchObject({ canonicalSymbol: 'C#/F##', bassRole: 'nonChordTone', inversion: null });
  });

  it('canonicalizes the minor-major seventh prefix before additional extensions', () => {
    for (const text of ['Cmmaj7add9', 'Cm(maj7)add9', 'Cmin(maj7)(add9)', 'Cmin7Madd9']) {
      expect(parsed(parseChord(text))).toMatchObject({ canonicalSymbol: 'Cm(maj7)add9', quality: 'minor', seventh: 'major', extensions: [7, 9] });
      expect(parseChord(text).diatonicSpellings).toEqual(['C', 'Eb', 'G', 'B', 'D']);
      expect(parsed(transposeChord(text, up)).canonicalSymbol).toBe('Dm(maj7)add9');
      expect(parseChord(text).originalText).toBe(text);
    }
    expect(parsed(parseChord('Fmmaj7#11')).canonicalSymbol).toBe('Fm(maj7)#11');
  });

  it('fails closed for malformed syntax and unsupported spellings', () => {
    for (const text of ['C#b', 'C♮#', 'C###', 'Dbbb', 'C↑', 'C4.2', ' C', 'C ', 'C\n', 'C99999999999999999999']) expect(parseNote(text).status).toBe('unsupported');
    for (const text of ['P3', 'M4', 'm5', 'A0', 'P-4', 'AA4', 'P99999999999999999999', 'M2\n']) expect(parseInterval(text).status).toBe('unsupported');
    for (const text of ['C((add9))', 'C(add9', 'Cadd9)', 'C7junk', 'C/E/G', 'C/E4', 'C###7', 'C7#11#11', 'C7b9#9', 'C7()', 'C7/8', 'C\n']) expect(parseChord(text).status).toBe('unsupported');
    expect(parseChord('G##aug')).toMatchObject({ status: 'unsupported', category: 'accidentalRange' });
  });

  it('validates runtime option values and never mutates caller options', () => {
    const invalid: unknown[] = [null, {}, { policy: 'other', semitones: 1 }, { policy: 'chromaticSharps', semitones: NaN }, { policy: 'chromaticSharps', semitones: Infinity }, { policy: 'chromaticSharps', semitones: 0.5 }, { policy: 'chromaticSharps', semitones: Number.MAX_SAFE_INTEGER + 1 }, { policy: 'diatonic', interval: null }, { policy: 'diatonic', interval: { diatonicSteps: '1', semitones: 2 } }, { policy: 'diatonic', interval: { diatonicSteps: 1, semitones: {} } }];
    for (const options of invalid) {
      expect(transposeNote('C4', options as TransposeOptions).status).toBe('unsupported');
      expect(transposeChord('C/E', options as TransposeOptions).status).toBe('unsupported');
    }
    const frozen = Object.freeze({ policy: 'diatonic', interval: Object.freeze({ diatonicSteps: 1, semitones: 2 }) } as const);
    transposeChord('Abmaj7/C', frozen);
    expect(frozen).toEqual(up);
    expect(transposeNote('C4', { policy: 'chromaticSharps', semitones: Number.MAX_SAFE_INTEGER }).status).toBe('unsupported');
  });

  it('keeps independent results and reverses supported diatonic shifts', () => {
    const first = parseChord('Dmaj9');
    if (first.status === 'parsed') first.normalized.intervals[0].semitones = 99;
    expect(parsed(parseChord('Dmaj9')).intervals[0].semitones).toBe(0);
    for (const text of ['Ab', 'C#', 'F', 'Bb', 'B#']) {
      const shifted = parsed(transposeNote(text, up));
      expect(parsed(transposeNote(shifted.note.spelling, down)).note).toEqual(parsed(parseNote(text)).note);
    }
    expect(transposeChord('C(add9)/E', up).originalText).toBe('C(add9)/E');
    expect(parseNote('B♭').originalText).toBe('B♭');
  });

  it('retains compound intervals and checks chord transposition as a complete operation', () => {
    expect(parsed(parseInterval('-M16'))).toEqual({ kind: 'interval', name: '-M16', diatonicSteps: -15, semitones: -26 });
    expect(parsed(transposeNote('G#-2', { policy: 'diatonic', interval: { diatonicSteps: -15, semitones: -26 } }))).toMatchObject({ note: { spelling: 'F#' }, octave: -4, midi: -30 });
    for (const text of ['Abmaj7/C', 'D7#11', 'Em7b5/G', 'F6add9/A', 'Baug/D#']) {
      const start = parsed(parseChord(text));
      const shifted = parsed(transposeChord(text, up));
      const restored = transposeChord(shifted.canonicalSymbol, down);
      expect(parsed(restored)).toEqual(start);
      const before = parseChord(text).pitchClasses;
      expect(transposeChord(text, up).pitchClasses).toEqual(before.map(value => (value + 2) % 12));
    }
    // The root alone is representable; the augmented fifth would require ###.
    expect(transposeChord('G#aug', { policy: 'diatonic', interval: { diatonicSteps: 0, semitones: 1 } })).toMatchObject({ status: 'unsupported', notes: [], category: 'accidentalRange' });
    expect(transposeChord('C/B##', up)).toMatchObject({ status: 'unsupported', notes: [], category: 'accidentalRange' });
  });
});

interface HarmonyVector {
  id: string;
  category: 'majorKey' | 'minorKey' | 'inversion' | 'indeterminate' | 'unsupported';
  input: {
    chord: string;
    key: string | KeyContextInput | null;
    context?: ChordContext;
  };
  expected: unknown;
}

const harmonyCorpus = JSON.parse(
  readFileSync(resolve('../shared/fixtures/harmony-analysis-v1.json'), 'utf8'),
) as { cases: HarmonyVector[] };

describe('T5 TypeScript contextual harmonic analysis & inversions', () => {
  it.each(harmonyCorpus.cases)('$id matches shared harmony-analysis-v1 expectation', ({ input, expected }) => {
    const actual = analyzeDegree(input.chord, input.key, input.context);
    expect(actual).toEqual(expected);
  });

  it('parses major and minor KeyContext inputs and fails closed on invalid keys', () => {
    const cMajor = parsed(parseKeyContext('C'));
    expect(cMajor.canonicalKey).toBe('C');
    expect(cMajor.mode).toBe('major');
    expect(cMajor.scaleReference).toBe('major');
    expect(cMajor.scale.map(n => n.spelling)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

    const aMinor = parsed(parseKeyContext('A naturalMinor'));
    expect(aMinor.canonicalKey).toBe('Am');
    expect(aMinor.mode).toBe('minor');
    expect(aMinor.scaleReference).toBe('naturalMinor');
    expect(aMinor.scale.map(n => n.spelling)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

    const objKey = parsed(parseKeyContext({ tonic: 'Bb', mode: 'major', spellingPolicy: 'diatonic' }));
    expect(objKey.canonicalKey).toBe('Bb');
    expect(objKey.scale.map(n => n.spelling)).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);

    for (const bad of ['', '   ', 'C ', ' C', 'C\n', 'H', 'C4', 'CM', 'G##', 'Fbb', 'Cbbm']) {
      expect(parseKeyContext(bad).status).toBe('unsupported');
    }
    expect(parseKeyContext({ tonic: 'C', mode: 'harmonicMinor' as 'minor' }).status).toBe('unsupported');
  });

  it('distinguishes inversions from external slash bass independently of key via analyzeBass', () => {
    const ceParsed = parsed(parseChord('C/E'));
    const ceBass = analyzeBass(ceParsed, parseChord('C/E').notes);
    expect(ceBass.isInversion).toBe(true);
    expect(ceBass.isExternalBass).toBe(false);
    expect(ceBass.inversion).toBe(1);
    expect(ceBass.label).toBe('1ª inversão');

    const cfParsed = parsed(parseChord('C/F#'));
    const cfBass = analyzeBass(cfParsed, parseChord('C/F#').notes);
    expect(cfBass.isInversion).toBe(false);
    expect(cfBass.isExternalBass).toBe(true);
    expect(cfBass.inversion).toBeNull();
    expect(cfBass.label).toBe('Baixo externo ao acorde');
  });

  it('never infers key automatically and keeps modal interchange / secondary dominants indeterminate', () => {
    expect(analyzeDegree('C')).toMatchObject({ status: 'indeterminate', reason: 'missingKeyContext', key: null });
    expect(analyzeDegree('D7', 'C')).toMatchObject({ status: 'indeterminate', reason: 'nonDiatonicChord' });
    expect(analyzeDegree('Bb', 'C')).toMatchObject({ status: 'indeterminate', reason: 'nonDiatonicChord' });
    expect(analyzeDegree('E7', 'Am')).toMatchObject({ status: 'indeterminate', reason: 'nonDiatonicToNaturalMinor' });
    expect(analyzeDegree('Fm', 'Am')).toMatchObject({ status: 'indeterminate', reason: 'nonDiatonicChord' });
  });
});
