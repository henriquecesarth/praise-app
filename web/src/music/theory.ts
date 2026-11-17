/** Pure v1 symbolic music theory. No chart rewriting, voicing or key inference. */
export type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export interface SpelledNote { letter: Letter; accidental: number; spelling: string; pitchClass: number }
export interface Interval { diatonicSteps: number; semitones: number }
export interface NoteNormalized { kind: 'note'; note: SpelledNote; octave: number | null; midi: number | null }
export interface IntervalNormalized extends Interval { kind: 'interval'; name: string }
export type Quality = 'major' | 'minor' | 'diminished' | 'augmented' | 'suspended2' | 'suspended4';
export interface ChordNormalized {
  kind: 'chord'; canonicalSymbol: string; root: SpelledNote; quality: Quality;
  seventh: 'major' | 'minor' | 'diminished' | null;
  intervals: Interval[]; extensions: number[]; omissions: number[];
  alterations: { degree: number; accidental: number }[];
  bass: SpelledNote | null; bassRole: 'unspecified' | 'chordTone' | 'nonChordTone'; inversion: number | null;
}
export type UnsupportedCategory = 'invalidSyntax' | 'ambiguousContext' | 'unsupportedFeature' | 'accidentalRange';
interface Projection { originalText: string; notes: SpelledNote[]; diatonicSpellings: string[]; pitchClasses: number[] }
export interface Parsed<T> extends Projection { status: 'parsed'; normalized: T }
export interface Unsupported extends Projection {
  status: 'unsupported'; normalized: null; preservedText: string; category: UnsupportedCategory; reason: string;
}
export type Result<T> = Parsed<T> | Unsupported;
export type TransposeOptions = { policy: 'diatonic'; interval: Interval } | { policy: 'chromaticSharps'; semitones: number };
export interface SpellingOptions { letter?: Letter; preference?: 'sharps' | 'flats' }
export type ChordContext = 'chordSymbol' | 'lyric';

function unsupported(originalText: string, category: UnsupportedCategory, reason: string): Unsupported {
  return { status: 'unsupported', originalText, preservedText: originalText, normalized: null, notes: [], diatonicSpellings: [], pitchClasses: [], category, reason };
}
const letters: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const natural = [0, 2, 4, 5, 7, 9, 11] as const;
const sharpSpellings = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const flatSpellings = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
const mod = (value: number, base: number) => ((value % base) + base) % base;
const bigMod = (value: bigint, base: bigint) => ((value % base) + base) % base;
const floorDiv = (value: bigint, base: bigint) => (value - bigMod(value, base)) / base;
const safeBig = (value: bigint) => value >= -maxSafe && value <= maxSafe;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLetter = (value: unknown): value is Letter => typeof value === 'string' && letters.some(letter => letter === value);

function parsed<T>(originalText: string, normalized: T, notes: SpelledNote[] = []): Parsed<T> {
  return { status: 'parsed', originalText, normalized, notes, diatonicSpellings: notes.map(note => note.spelling), pitchClasses: notes.map(note => note.pitchClass) };
}
function note(letter: Letter, accidental: number): SpelledNote {
  return { letter, accidental, spelling: letter + (accidental < 0 ? 'b'.repeat(-accidental) : '#'.repeat(accidental)), pitchClass: mod(natural[letters.indexOf(letter)] + accidental, 12) };
}
function noteResult(originalText: string, value: SpelledNote, octave: number | null = null, midi: number | null = null): Parsed<NoteNormalized> {
  return parsed(originalText, { kind: 'note', note: value, octave, midi }, [value]);
}

export function parseNote(text: string): Result<NoteNormalized> {
  if (!text) return unsupported(text, 'invalidSyntax', 'emptyInput');
  if (!/^[A-Ga-g]/.test(text)) return unsupported(text, 'invalidSyntax', 'unknownLetter');
  if (/[↑↓𝄲𝄳]/u.test(text)) return unsupported(text, 'unsupportedFeature', 'microtonalAccidental');
  const match = /^([A-Ga-g])([#b♯♭♮𝄪𝄫]*)(-?\d+)?$/u.exec(text);
  if (!match || match[0] !== text) return unsupported(text, 'invalidSyntax', 'invalidNote');
  const accidentalText = match[2].replace(/♯/gu, '#').replace(/♭/gu, 'b').replace(/𝄪/gu, '##').replace(/𝄫/gu, 'bb');
  if ((accidentalText.includes('#') && accidentalText.includes('b')) || (accidentalText.includes('♮') && accidentalText !== '♮')) return unsupported(text, 'invalidSyntax', 'mixedAccidentals');
  if (accidentalText.length > 2) return unsupported(text, 'accidentalRange', 'moreThanDoubleAccidental');
  const accidental = accidentalText === '♮' ? 0 : accidentalText.length * (accidentalText.includes('b') ? -1 : 1);
  const value = note(match[1].toUpperCase() as Letter, accidental);
  if (match[3] === undefined) return noteResult(text, value);
  const octaveBig = BigInt(match[3]);
  const midiBig = (octaveBig + 1n) * 12n + BigInt(natural[letters.indexOf(value.letter)] + accidental);
  if (!safeBig(octaveBig) || !safeBig(midiBig)) return unsupported(text, 'invalidSyntax', 'invalidOctave');
  return noteResult(text, value, Number(octaveBig), Number(midiBig));
}

export function parseInterval(text: string): Result<IntervalNormalized> {
  if (!text) return unsupported(text, 'invalidSyntax', 'emptyInput');
  if (/^-?\d+$/.test(text)) return unsupported(text, 'ambiguousContext', 'intervalQualityRequired');
  const match = /^(-?)([PMmAd])([1-9]\d*)$/.exec(text);
  if (!match || match[0] !== text) return unsupported(text, 'invalidSyntax', 'invalidInterval');
  const steps = BigInt(match[3]) - 1n;
  const degree = Number(steps % 7n);
  const perfect = [0, 3, 4].includes(degree);
  const quality = match[2];
  if ((quality === 'P' && !perfect) || ((quality === 'M' || quality === 'm') && perfect)) return unsupported(text, 'invalidSyntax', 'invalidInterval');
  const delta = quality === 'A' ? 1 : quality === 'd' ? (perfect ? -1 : -2) : quality === 'm' ? -1 : 0;
  const semitones = (steps / 7n) * 12n + BigInt(natural[degree] + delta);
  if (!safeBig(steps) || !safeBig(semitones)) return unsupported(text, 'invalidSyntax', 'invalidInterval');
  const sign = match[1] ? -1 : 1;
  // Do not emit negative zero in the public envelope.
  return parsed(text, { kind: 'interval', name: text, diatonicSteps: Number(steps) === 0 ? 0 : sign * Number(steps), semitones: Number(semitones) === 0 ? 0 : sign * Number(semitones) });
}

/** Spell a class without guessing a key. Explicit letter takes precedence over preference. */
export function spellPitch(pitchClass: number, options: SpellingOptions = {}): Result<NoteNormalized> {
  const text = String(pitchClass);
  if (!Number.isInteger(pitchClass) || pitchClass < 0 || pitchClass > 11) return unsupported(text, 'invalidSyntax', 'invalidPitchClass');
  if (!object(options)) return unsupported(text, 'invalidSyntax', 'invalidSpellingOptions');
  const requestedLetter = options.letter;
  if ((requestedLetter !== undefined && !isLetter(requestedLetter)) || (options.preference !== undefined && options.preference !== 'sharps' && options.preference !== 'flats')) return unsupported(text, 'invalidSyntax', 'invalidSpellingOptions');
  if (requestedLetter !== undefined) {
    const accidental = mod(pitchClass - natural[letters.indexOf(requestedLetter)] + 6, 12) - 6;
    if (Math.abs(accidental) > 2) return unsupported(text, 'accidentalRange', 'targetRequiresTripleAccidental');
    return noteResult(text, note(requestedLetter, accidental));
  }
  const spelling = (options.preference === 'flats' ? flatSpellings : sharpSpellings)[pitchClass];
  const value = parseNote(spelling);
  return value.status === 'parsed' ? noteResult(text, value.normalized.note) : value;
}

function checkedOptions(value: unknown): value is TransposeOptions {
  if (!object(value)) return false;
  if (value.policy === 'chromaticSharps') return Number.isSafeInteger(value.semitones) && value.interval === undefined;
  return value.policy === 'diatonic' && value.semitones === undefined && object(value.interval) && Number.isSafeInteger(value.interval.diatonicSteps) && Number.isSafeInteger(value.interval.semitones);
}

function moveNote(source: NoteNormalized, options: TransposeOptions, text: string): Result<NoteNormalized> {
  const value = source.note;
  const shift = BigInt(options.policy === 'diatonic' ? options.interval.semitones : options.semitones);
  if (options.policy === 'chromaticSharps') {
    const pitchClass = Number(bigMod(BigInt(value.pitchClass) + shift, 12n));
    const result = spellPitch(pitchClass);
    if (result.status === 'unsupported') return unsupported(text, result.category, result.reason);
    if (source.midi === null) return noteResult(text, result.normalized.note);
    const midi = BigInt(source.midi) + shift;
    const octave = floorDiv(midi, 12n) - 1n;
    if (!safeBig(midi) || !safeBig(octave)) return unsupported(text, 'invalidSyntax', 'invalidTransposition');
    return noteResult(text, result.normalized.note, Number(octave), Number(midi));
  }
  const index = letters.indexOf(value.letter);
  const position = BigInt(index) + BigInt(options.interval.diatonicSteps);
  const targetIndex = Number(bigMod(position, 7n));
  const targetNatural = floorDiv(position, 7n) * 12n + BigInt(natural[targetIndex]);
  const accidental = BigInt(natural[index] + value.accidental) + shift - targetNatural;
  if (accidental < -2n || accidental > 2n) return unsupported(text, 'accidentalRange', 'targetRequiresTripleAccidental');
  const moved = note(letters[targetIndex], Number(accidental));
  if (source.octave === null || source.midi === null) return noteResult(text, moved);
  const octave = BigInt(source.octave) + floorDiv(position, 7n);
  const midi = BigInt(source.midi) + shift;
  if (!safeBig(octave) || !safeBig(midi)) return unsupported(text, 'invalidSyntax', 'invalidTransposition');
  return noteResult(text, moved, Number(octave), Number(midi));
}

export function transposeNote(text: string, options: TransposeOptions): Result<NoteNormalized> {
  if (!checkedOptions(options)) return unsupported(text, 'invalidSyntax', 'invalidTransposition');
  const source = parseNote(text);
  return source.status === 'unsupported' ? source : moveNote(source.normalized, options, text);
}

interface ChordShape {
  suffix: string; quality: Quality; seventh: ChordNormalized['seventh'];
  intervals: Interval[]; extensions: number[]; alterations: ChordNormalized['alterations'];
}

/**
 * V1 grammar: root [m|min|dim|aug|+|sus2|sus4] [6|7|9|11|13|maj7/9/11/13|7M]
 * [add9/11/13] [b/#9/11/13]* [/bass]. Parentheses may wrap one add/alteration
 * or maj7 token. m7(b5)/m7b5/ø7 denote half diminished. Numeric /9 extends
 * a sixth/seventh; it is never a bass. No omissions, implicit voicing or alt set.
 */
function chordShape(raw: string): ChordShape | null {
  // Parentheses are only grouping for one recognized modifier, never arbitrary deletion.
  let suffix = raw.replace(/\((maj7|add(?:9|11|13)|[b#](?:5|9|11|13))\)/g, '$1');
  if (/[()]/.test(suffix)) return null;
  suffix = suffix.replace(/^ø7$/, 'm7b5').replace(/^min/, 'm').replace(/^\+/, 'aug').replace(/7M/, 'maj7');
  if (suffix === 'm7b5') return { suffix, quality: 'diminished', seventh: 'minor', intervals: [{ diatonicSteps: 0, semitones: 0 }, { diatonicSteps: 2, semitones: 3 }, { diatonicSteps: 4, semitones: 6 }, { diatonicSteps: 6, semitones: 10 }], extensions: [7], alterations: [] };
  const match = /^(m|dim|aug|sus2|sus4)?(maj(?:7|9|11|13)|6|7|9|11|13)?(add(?:9|11|13))?((?:[b#](?:9|11|13))*)$/.exec(suffix);
  if (!match) return null;
  const quality: Quality = match[1] === 'm' ? 'minor' : match[1] === 'dim' ? 'diminished' : match[1] === 'aug' ? 'augmented' : match[1] === 'sus2' ? 'suspended2' : match[1] === 'sus4' ? 'suspended4' : 'major';
  const extension = match[2] ? Number(match[2].replace('maj', '')) : 0;
  const seventh: ChordNormalized['seventh'] = extension >= 7 ? (match[2].startsWith('maj') ? 'major' : quality === 'diminished' ? 'diminished' : 'minor') : null;
  const intervals: Interval[] = [{ diatonicSteps: 0, semitones: 0 }, { diatonicSteps: quality === 'suspended2' ? 1 : quality === 'suspended4' ? 3 : 2, semitones: quality === 'suspended2' ? 2 : quality === 'suspended4' ? 5 : quality === 'minor' || quality === 'diminished' ? 3 : 4 }, { diatonicSteps: 4, semitones: quality === 'diminished' ? 6 : quality === 'augmented' ? 8 : 7 }];
  const extensions: number[] = [];
  const alterations: ChordNormalized['alterations'] = [];
  const addDegree = (degree: number, accidental = 0) => {
    const steps = degree - 1;
    const semitones = natural[steps % 7] + Math.floor(steps / 7) * 12 + accidental;
    const existing = intervals.find(interval => interval.diatonicSteps === steps);
    if (existing) existing.semitones = semitones; else intervals.push({ diatonicSteps: steps, semitones });
    if (!extensions.includes(degree)) extensions.push(degree);
  };
  if (extension === 6) addDegree(6);
  if (seventh) { intervals.push({ diatonicSteps: 6, semitones: seventh === 'major' ? 11 : seventh === 'minor' ? 10 : 9 }); extensions.push(7); }
  for (let degree = 9; degree <= extension; degree += 2) addDegree(degree);
  if (match[3]) addDegree(Number(match[3].slice(3)));
  for (const alteration of match[4].matchAll(/([b#])(9|11|13)/g)) {
    const degree = Number(alteration[2]);
    if (alterations.some(value => value.degree === degree)) return null;
    const accidental = alteration[1] === 'b' ? -1 : 1;
    alterations.push({ degree, accidental });
    addDegree(degree, accidental);
  }
  intervals.sort((a, b) => a.diatonicSteps - b.diatonicSteps);
  extensions.sort((a, b) => a - b);
  return { suffix: suffix.replace(/^mmaj7/, 'm(maj7)'), quality, seventh, intervals, extensions, alterations };
}

function assembleChord(text: string, root: SpelledNote, shape: ChordShape, bass: SpelledNote | null): Result<ChordNormalized> {
  const notes: SpelledNote[] = [];
  for (const interval of shape.intervals) {
    const moved = moveNote({ kind: 'note', note: root, octave: null, midi: null }, { policy: 'diatonic', interval }, text);
    if (moved.status === 'unsupported') return moved;
    notes.push(moved.normalized.note);
  }
  const bassIndex = bass ? notes.findIndex(value => value.spelling === bass.spelling) : -1;
  return parsed(text, { kind: 'chord', canonicalSymbol: root.spelling + shape.suffix + (bass ? '/' + bass.spelling : ''), root, quality: shape.quality, seventh: shape.seventh, intervals: shape.intervals, extensions: shape.extensions, omissions: [], alterations: shape.alterations, bass, bassRole: !bass ? 'unspecified' : bassIndex >= 0 ? 'chordTone' : 'nonChordTone', inversion: bassIndex >= 0 ? bassIndex : null }, notes);
}

export function parseChord(text: string, context: ChordContext = 'chordSymbol'): Result<ChordNormalized> {
  if (context === 'lyric') return unsupported(text, 'ambiguousContext', 'lyricIsNotChordContext');
  if (context !== 'chordSymbol') return unsupported(text, 'invalidSyntax', 'invalidContext');
  if (!text) return unsupported(text, 'invalidSyntax', 'emptyInput');
  if (text === 'N.C.') return unsupported(text, 'unsupportedFeature', 'notationMarkerNotChord');
  const match = /^([A-Ga-g][#b♯♭♮𝄪𝄫]*)([^\r\n]*)$/u.exec(text);
  if (!match || match[0] !== text) return unsupported(text, 'invalidSyntax', 'unknownLetter');
  const root = parseNote(match[1]);
  if (root.status === 'unsupported') return unsupported(text, root.category, root.reason);
  let suffix = match[2];
  const parts = suffix.split('/');
  suffix = parts.shift() ?? '';
  if (parts[0] === '9') {
    parts.shift();
    if (/^(m|min|dim|aug|\+|sus2|sus4)?6$/.test(suffix)) suffix += 'add9';
    else if (/^(m|min|dim|aug|\+|sus2|sus4)?(?:7M|maj7|7)$/.test(suffix)) suffix = suffix.replace(/(?:7M|maj7)$/, 'maj9').replace(/7$/, '9');
    else return unsupported(text, 'invalidSyntax', 'unknownSuffix');
  }
  if (parts.length > 1) return unsupported(text, 'invalidSyntax', 'multipleBass');
  let bass: SpelledNote | null = null;
  if (parts.length) {
    if (!parts[0]) return unsupported(text, 'invalidSyntax', 'missingBass');
    const bassResult = parseNote(parts[0]);
    if (bassResult.status === 'unsupported') return unsupported(text, bassResult.category, bassResult.reason);
    if (bassResult.normalized.octave !== null) return unsupported(text, 'invalidSyntax', 'invalidBass');
    bass = bassResult.normalized.note;
  }
  if (suffix === 'alt') return unsupported(text, 'unsupportedFeature', 'unspecifiedAlteredToneSet');
  if (suffix === '5') return unsupported(text, 'unsupportedFeature', 'powerChordOutsideV1');
  const shape = chordShape(suffix);
  return shape ? assembleChord(text, root.normalized.note, shape, bass) : unsupported(text, 'invalidSyntax', 'unknownSuffix');
}

export function transposeChord(text: string, options: TransposeOptions): Result<ChordNormalized> {
  if (!checkedOptions(options)) return unsupported(text, 'invalidSyntax', 'invalidTransposition');
  const source = parseChord(text);
  if (source.status === 'unsupported') return source;
  const chord = source.normalized;
  const root = moveNote({ kind: 'note', note: chord.root, octave: null, midi: null }, options, text);
  if (root.status === 'unsupported') return root;
  let bassOptions = options;
  if (options.policy === 'chromaticSharps') {
    // Use the root's spelling movement for the bass; preserve chord-tone identity.
    const target = root.normalized.note;
    const absolutePitch = BigInt(natural[letters.indexOf(chord.root.letter)] + chord.root.accidental) + BigInt(options.semitones);
    const targetOctave = floorDiv(absolutePitch - BigInt(natural[letters.indexOf(target.letter)] + target.accidental), 12n);
    const steps = targetOctave * 7n + BigInt(letters.indexOf(target.letter) - letters.indexOf(chord.root.letter));
    if (!safeBig(steps)) return unsupported(text, 'invalidSyntax', 'invalidTransposition');
    bassOptions = { policy: 'diatonic', interval: { diatonicSteps: Number(steps), semitones: options.semitones } };
  }
  let bass: SpelledNote | null = null;
  if (chord.bass) {
    const moved = moveNote({ kind: 'note', note: chord.bass, octave: null, midi: null }, bassOptions, text);
    if (moved.status === 'unsupported') return moved;
    bass = moved.normalized.note;
  }
  const suffix = chord.canonicalSymbol.slice(chord.root.spelling.length).split('/')[0];
  return assembleChord(text, root.normalized.note, { ...chord, suffix }, bass);
}
export function chordTones(text: string, context: ChordContext = 'chordSymbol'): Result<ChordNormalized> { return parseChord(text, context); }

export type KeyMode = 'major' | 'minor';
export type ScaleReference = 'major' | 'naturalMinor';
export type SpellingPolicy = 'diatonic' | 'chromaticSharps';
export interface KeyContext {
  kind: 'key';
  canonicalKey: string;
  tonic: SpelledNote;
  mode: KeyMode;
  scaleReference: ScaleReference;
  spellingPolicy: SpellingPolicy;
  scale: SpelledNote[];
}
export type KeyContextInput =
  | string
  | KeyContext
  | {
      tonic: string | SpelledNote;
      mode: KeyMode | 'naturalMinor' | 'maior' | 'menor';
      spellingPolicy?: SpellingPolicy;
    };
export interface BassAnalysis {
  bass: SpelledNote | null;
  bassRole: ChordNormalized['bassRole'];
  inversion: number | null;
  isSlashChord: boolean;
  isInversion: boolean;
  isExternalBass: boolean;
  label: string;
  explanation: string;
}
export type IndeterminateReason =
  | 'missingKeyContext'
  | 'invalidKeyContext'
  | 'externalSlashBass'
  | 'nonDiatonicToNaturalMinor'
  | 'enharmonicMismatch'
  | 'nonDiatonicChord';
export interface DegreeAnalysis {
  degree: string;
  romanRoot: string;
  degreeNumber: number;
  alteration: string;
  quality: Quality;
  seventh: ChordNormalized['seventh'];
  qualityLabel: string;
  scaleReference: ScaleReference;
  inversion: number | null;
  bassRole: ChordNormalized['bassRole'];
  secondaryTarget: string | null;
  explanation: string;
}
export interface HarmonyAnalyzed {
  status: 'analysis';
  originalText: string;
  chord: ChordNormalized;
  notes: SpelledNote[];
  diatonicSpellings: string[];
  pitchClasses: number[];
  key: KeyContext;
  bassAnalysis: BassAnalysis;
  analysis: DegreeAnalysis;
}
export interface HarmonyIndeterminate {
  status: 'indeterminate';
  originalText: string;
  chord: ChordNormalized;
  notes: SpelledNote[];
  diatonicSpellings: string[];
  pitchClasses: number[];
  key: KeyContext | null;
  bassAnalysis: BassAnalysis;
  analysis: null;
  reason: IndeterminateReason;
  explanation: string;
}
export interface HarmonyUnsupported {
  status: 'unsupported';
  originalText: string;
  preservedText: string;
  chord: null;
  notes: [];
  diatonicSpellings: [];
  pitchClasses: [];
  key: null;
  bassAnalysis: null;
  analysis: null;
  category: UnsupportedCategory;
  reason: string;
  explanation: string;
}
export type HarmonyAnalysisResult = HarmonyAnalyzed | HarmonyIndeterminate | HarmonyUnsupported;

const majorScaleIntervals: readonly Interval[] = [
  { diatonicSteps: 0, semitones: 0 },
  { diatonicSteps: 1, semitones: 2 },
  { diatonicSteps: 2, semitones: 4 },
  { diatonicSteps: 3, semitones: 5 },
  { diatonicSteps: 4, semitones: 7 },
  { diatonicSteps: 5, semitones: 9 },
  { diatonicSteps: 6, semitones: 11 },
];
const naturalMinorScaleIntervals: readonly Interval[] = [
  { diatonicSteps: 0, semitones: 0 },
  { diatonicSteps: 1, semitones: 2 },
  { diatonicSteps: 2, semitones: 3 },
  { diatonicSteps: 3, semitones: 5 },
  { diatonicSteps: 4, semitones: 7 },
  { diatonicSteps: 5, semitones: 8 },
  { diatonicSteps: 6, semitones: 10 },
];
const romanUpper = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
const romanLower = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'] as const;

function parseSpelledTonic(value: unknown, originalText: string): Result<NoteNormalized> {
  if (typeof value === 'string') {
    const parsedTonic = parseNote(value);
    if (parsedTonic.status === 'unsupported') return unsupported(originalText, parsedTonic.category, parsedTonic.reason);
    if (parsedTonic.normalized.octave !== null) return unsupported(originalText, 'invalidSyntax', 'invalidKey');
    return parsedTonic;
  }
  if (object(value) && isLetter(value.letter) && typeof value.accidental === 'number' && Number.isInteger(value.accidental) && Math.abs(value.accidental) <= 2) {
    const computed = note(value.letter, value.accidental);
    if (typeof value.spelling === 'string' && value.spelling !== computed.spelling) {
      return unsupported(originalText, 'invalidSyntax', 'invalidKey');
    }
    return noteResult(originalText, computed);
  }
  return unsupported(originalText, 'invalidSyntax', 'invalidKey');
}

export function parseKeyContext(input: KeyContextInput | null | undefined): Result<KeyContext> {
  if (typeof input === 'string') {
    if (!input) return unsupported(input, 'invalidSyntax', 'emptyKey');
    if (/[\r\n]/.test(input)) return unsupported(input, 'invalidSyntax', 'invalidKey');
    const match = /^([A-Ga-g][#b♯♭♮𝄪𝄫]*)(?:(m|min)|\s+(major|minor|naturalMinor|maior|menor))?$/u.exec(input);
    if (!match || match[0] !== input) return unsupported(input, 'invalidSyntax', 'invalidKey');
    const tonicRes = parseSpelledTonic(match[1], input);
    if (tonicRes.status === 'unsupported') return tonicRes;
    const kw = match[2] || match[3] || 'major';
    const mode: KeyMode = (kw === 'm' || kw === 'min' || kw === 'minor' || kw === 'naturalMinor' || kw === 'menor') ? 'minor' : 'major';
    return buildKeyContext(input, tonicRes.normalized.note, mode, 'diatonic');
  }
  if (object(input)) {
    const tonicText = typeof input.tonic === 'string'
      ? input.tonic
      : object(input.tonic) && typeof input.tonic.spelling === 'string'
        ? input.tonic.spelling
        : '';
    const modeRaw = input.mode;
    const mode: KeyMode | null = (modeRaw === 'major' || modeRaw === 'maior')
      ? 'major'
      : (modeRaw === 'minor' || modeRaw === 'naturalMinor' || modeRaw === 'menor')
        ? 'minor'
        : null;
    const rawOriginal = tonicText ? `${tonicText}${mode === 'minor' ? 'm' : ''}` : '';
    if (!mode) return unsupported(rawOriginal, 'invalidSyntax', 'invalidKeyMode');
    const tonicRes = parseSpelledTonic(input.tonic, rawOriginal);
    if (tonicRes.status === 'unsupported') return tonicRes;
    let spellingPolicy: SpellingPolicy = 'diatonic';
    if (input.spellingPolicy !== undefined) {
      if (input.spellingPolicy !== 'diatonic' && input.spellingPolicy !== 'chromaticSharps') {
        return unsupported(rawOriginal, 'invalidSyntax', 'invalidSpellingPolicy');
      }
      spellingPolicy = input.spellingPolicy;
    }
    return buildKeyContext(
      `${tonicRes.normalized.note.spelling}${mode === 'minor' ? 'm' : ''}`,
      tonicRes.normalized.note,
      mode,
      spellingPolicy,
    );
  }
  return unsupported('', 'invalidSyntax', 'invalidKey');
}

function buildKeyContext(
  originalText: string,
  tonic: SpelledNote,
  mode: KeyMode,
  spellingPolicy: SpellingPolicy,
): Result<KeyContext> {
  const scaleReference: ScaleReference = mode === 'major' ? 'major' : 'naturalMinor';
  const intervals = mode === 'major' ? majorScaleIntervals : naturalMinorScaleIntervals;
  const scale: SpelledNote[] = [];
  for (const interval of intervals) {
    const moved = moveNote({ kind: 'note', note: tonic, octave: null, midi: null }, { policy: 'diatonic', interval }, originalText);
    if (moved.status === 'unsupported') return moved;
    scale.push(moved.normalized.note);
  }
  return parsed(originalText, {
    kind: 'key',
    canonicalKey: `${tonic.spelling}${mode === 'minor' ? 'm' : ''}`,
    tonic,
    mode,
    scaleReference,
    spellingPolicy,
    scale,
  }, scale);
}

/** Reuse T2 bassRole and inversion without duplicating pitch/spelling matching. */
export function analyzeBass(chord: ChordNormalized, notes: SpelledNote[]): BassAnalysis {
  const tonesList = notes.map(n => n.spelling).join(', ');
  const isSlashChord = chord.bass !== null;
  const isInversion = chord.bassRole === 'chordTone' && chord.inversion !== null && chord.inversion >= 1;
  const isExternalBass = chord.bassRole === 'nonChordTone';

  let label: string;
  let explanation: string;
  if (chord.bassRole === 'unspecified') {
    label = 'Posição fundamental';
    explanation = `Acorde em posição fundamental (baixo na fundamental ${chord.root.spelling}).`;
  } else if (chord.bassRole === 'chordTone' && chord.inversion === 0 && chord.bass) {
    label = 'Posição fundamental (baixo explícito)';
    explanation = `Baixo explícito ${chord.bass.spelling} coincide com a fundamental do acorde ${chord.canonicalSymbol}.`;
  } else if (chord.bassRole === 'chordTone' && chord.inversion !== null && chord.inversion >= 1 && chord.bass) {
    label = `${chord.inversion}ª inversão`;
    explanation = `${chord.inversion}ª inversão: o baixo ${chord.bass.spelling} pertence aos tons do acorde (${tonesList}).`;
  } else {
    const bassSpelling = chord.bass?.spelling ?? '';
    label = 'Baixo externo ao acorde';
    explanation = `Baixo externo (${bassSpelling}): a nota do baixo não pertence aos constituintes do acorde (${tonesList}), não constituindo inversão.`;
  }

  return {
    bass: chord.bass,
    bassRole: chord.bassRole,
    inversion: chord.inversion,
    isSlashChord,
    isInversion,
    isExternalBass,
    label,
    explanation,
  };
}

function describeHarmonyQuality(quality: Quality, seventh: ChordNormalized['seventh']): string {
  if (quality === 'diminished' && seventh === 'minor') return 'Meio-diminuto';
  const base = quality === 'major'
    ? 'Maior'
    : quality === 'minor'
      ? 'Menor'
      : quality === 'diminished'
        ? 'Diminuto'
        : quality === 'augmented'
          ? 'Aumentado'
          : quality === 'suspended2'
            ? 'Suspenso (sus2)'
            : 'Suspenso (sus4)';
  if (!seventh) return base;
  if (quality === 'major' && seventh === 'minor') return 'Maior com 7ª menor (Dominante)';
  if (seventh === 'major') return `${base} com 7ª maior`;
  if (seventh === 'minor') return `${base} com 7ª menor`;
  return `${base} com 7ª diminuta`;
}

export function analyzeDegree(
  chordText: string,
  keyInput?: KeyContextInput | null,
  context: ChordContext = 'chordSymbol',
): HarmonyAnalysisResult {
  const parsedChord = parseChord(chordText, context);
  if (parsedChord.status === 'unsupported') {
    return {
      status: 'unsupported',
      originalText: parsedChord.originalText,
      preservedText: parsedChord.preservedText,
      chord: null,
      notes: [],
      diatonicSpellings: [],
      pitchClasses: [],
      key: null,
      bassAnalysis: null,
      analysis: null,
      category: parsedChord.category,
      reason: parsedChord.reason,
      explanation: 'Entrada musical não suportada pelo contrato harmônico v1.',
    };
  }

  const chord = parsedChord.normalized;
  const notes = parsedChord.notes;
  const bassAnalysis = analyzeBass(chord, notes);
  const tonesList = notes.map(n => n.spelling).join(', ');

  if (keyInput === undefined || keyInput === null || keyInput === '') {
    return {
      status: 'indeterminate',
      originalText: parsedChord.originalText,
      chord,
      notes,
      diatonicSpellings: parsedChord.diatonicSpellings,
      pitchClasses: parsedChord.pitchClasses,
      key: null,
      bassAnalysis,
      analysis: null,
      reason: 'missingKeyContext',
      explanation: `${bassAnalysis.explanation} Grau harmônico indeterminado: nenhuma tonalidade explícita foi informada.`,
    };
  }

  const keyResult = parseKeyContext(keyInput);
  if (keyResult.status === 'unsupported') {
    return {
      status: 'indeterminate',
      originalText: parsedChord.originalText,
      chord,
      notes,
      diatonicSpellings: parsedChord.diatonicSpellings,
      pitchClasses: parsedChord.pitchClasses,
      key: null,
      bassAnalysis,
      analysis: null,
      reason: 'invalidKeyContext',
      explanation: `${bassAnalysis.explanation} Grau harmônico indeterminado: a tonalidade informada é inválida ou fora do escopo v1.`,
    };
  }

  const key = keyResult.normalized;
  const scaleList = key.scale.map(n => n.spelling).join(', ');

  if (chord.bassRole === 'nonChordTone') {
    return {
      status: 'indeterminate',
      originalText: parsedChord.originalText,
      chord,
      notes,
      diatonicSpellings: parsedChord.diatonicSpellings,
      pitchClasses: parsedChord.pitchClasses,
      key,
      bassAnalysis,
      analysis: null,
      reason: 'externalSlashBass',
      explanation: `${bassAnalysis.explanation} Grau harmônico único indeterminado na v1 devido ao baixo externo ao acorde.`,
    };
  }

  let matchedDegree = -1;
  for (let i = 0; i < 7; i++) {
    if (key.scale[i].spelling === chord.root.spelling) {
      const allDiatonic = chord.intervals.every((interval, idx) =>
        notes[idx].spelling === key.scale[(i + interval.diatonicSteps) % 7].spelling);
      if (allDiatonic) {
        matchedDegree = i;
        break;
      }
    }
  }

  if (matchedDegree < 0) {
    let enharmonicDegree = -1;
    for (let i = 0; i < 7; i++) {
      if (key.scale[i].pitchClass === chord.root.pitchClass) {
        const allMatchPitchClasses = chord.intervals.every((interval) => {
          const moved = moveNote(
            { kind: 'note', note: key.scale[i], octave: null, midi: null },
            { policy: 'diatonic', interval },
            parsedChord.originalText,
          );
          return moved.status === 'parsed'
            && moved.normalized.note.spelling === key.scale[(i + interval.diatonicSteps) % 7].spelling;
        });
        if (allMatchPitchClasses) {
          enharmonicDegree = i;
          break;
        }
      }
    }

    if (enharmonicDegree >= 0) {
      if (key.spellingPolicy === 'chromaticSharps') {
        matchedDegree = enharmonicDegree;
      } else {
        return {
          status: 'indeterminate',
          originalText: parsedChord.originalText,
          chord,
          notes,
          diatonicSpellings: parsedChord.diatonicSpellings,
          pitchClasses: parsedChord.pitchClasses,
          key,
          bassAnalysis,
          analysis: null,
          reason: 'enharmonicMismatch',
          explanation: `As alturas de ${chord.canonicalSymbol} coincidem enarmonicamente com ${key.canonicalKey}, mas a grafia (${tonesList}) diverge da escala diatônica (${scaleList}).`,
        };
      }
    }
  }

  if (matchedDegree < 0) {
    if (key.mode === 'minor') {
      const raised6 = moveNote({ kind: 'note', note: key.tonic, octave: null, midi: null }, { policy: 'diatonic', interval: { diatonicSteps: 5, semitones: 9 } }, chordText);
      const raised7 = moveNote({ kind: 'note', note: key.tonic, octave: null, midi: null }, { policy: 'diatonic', interval: { diatonicSteps: 6, semitones: 11 } }, chordText);
      const allowedSpellings = new Set([
        ...key.scale.map(n => n.spelling),
        ...(raised6.status === 'parsed' ? [raised6.normalized.note.spelling] : []),
        ...(raised7.status === 'parsed' ? [raised7.normalized.note.spelling] : []),
      ]);
      if (notes.every(n => allowedSpellings.has(n.spelling))) {
        return {
          status: 'indeterminate',
          originalText: parsedChord.originalText,
          chord,
          notes,
          diatonicSpellings: parsedChord.diatonicSpellings,
          pitchClasses: parsedChord.pitchClasses,
          key,
          bassAnalysis,
          analysis: null,
          reason: 'nonDiatonicToNaturalMinor',
          explanation: `O acorde ${chord.canonicalSymbol} utiliza graus elevados típicos de menor harmônica ou melódica, fora da escala menor natural de referência de ${key.canonicalKey} (${scaleList}).`,
        };
      }
    }

    return {
      status: 'indeterminate',
      originalText: parsedChord.originalText,
      chord,
      notes,
      diatonicSpellings: parsedChord.diatonicSpellings,
      pitchClasses: parsedChord.pitchClasses,
      key,
      bassAnalysis,
      analysis: null,
      reason: 'nonDiatonicChord',
      explanation: `O acorde ${chord.canonicalSymbol} possui notas cromáticas fora da escala diatônica de ${key.canonicalKey} (${scaleList}).`,
    };
  }

  const degreeNumber = matchedDegree + 1;
  const romanRoot = (chord.quality === 'minor' || chord.quality === 'diminished')
    ? romanLower[matchedDegree]
    : romanUpper[matchedDegree];
  const chordSuffix = chord.canonicalSymbol.slice(chord.root.spelling.length).split('/')[0];

  let degree: string;
  if (chordSuffix === '' || chordSuffix === 'm') degree = romanRoot;
  else if (chordSuffix === 'dim') degree = `${romanRoot}°`;
  else if (chordSuffix === 'm7b5') degree = `${romanRoot}ø7`;
  else if (chordSuffix === 'dim7') degree = `${romanRoot}°7`;
  else if (chordSuffix === 'aug') degree = `${romanRoot}+`;
  else if (chordSuffix.startsWith('m') && !chordSuffix.startsWith('maj')) degree = `${romanRoot}${chordSuffix.slice(1)}`;
  else degree = `${romanRoot}${chordSuffix}`;

  const qualityLabel = describeHarmonyQuality(chord.quality, chord.seventh);
  const modeLabel = key.mode === 'major'
    ? `${key.tonic.spelling} maior`
    : `${key.tonic.spelling} menor (escala menor natural)`;

  return {
    status: 'analysis',
    originalText: parsedChord.originalText,
    chord,
    notes,
    diatonicSpellings: parsedChord.diatonicSpellings,
    pitchClasses: parsedChord.pitchClasses,
    key,
    bassAnalysis,
    analysis: {
      degree,
      romanRoot,
      degreeNumber,
      alteration: '',
      quality: chord.quality,
      seventh: chord.seventh,
      qualityLabel,
      scaleReference: key.scaleReference,
      inversion: chord.inversion,
      bassRole: chord.bassRole,
      secondaryTarget: null,
      explanation: `Grau ${degree} (${degreeNumber}º grau de ${modeLabel}), qualidade ${qualityLabel.toLowerCase()}. ${bassAnalysis.explanation}`,
    },
  };
}
