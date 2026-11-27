/**
 * Deterministic guitar shapes in standard tuning: compact encoding, expansion to
 * the v1 voicing format and generation. Mirrored by guitar_generator.dart; both
 * must stay identical (shared/fixtures/guitar-generator-v1.json).
 */
import { omittableFifth, validateGuitarVoicing } from './guitarVoicings';
import type { GuitarBarre, GuitarStringState, GuitarTuning, GuitarVoicing, GuitarVoicingProvenance } from './guitarVoicings';
import { parseChord } from './theory';
import type { ChordNormalized, Parsed, SpelledNote } from './theory';

export const STANDARD_TUNING: GuitarTuning = {
  id: 'standard-eadgbe',
  name: 'Padrão (E2 A2 D3 G3 B3 E4)',
  strings: ([[6, 'E', 2, 40], [5, 'A', 2, 45], [4, 'D', 3, 50], [3, 'G', 3, 55], [2, 'B', 3, 59], [1, 'E', 4, 64]] as const)
    .map(([stringNumber, spelling, octave, midi]) => ({ stringNumber, note: spelling + octave, spelling, octave, midi, pitchClass: midi % 12 })),
};
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type GuitarShapeOrigin = 'v1' | 'pop' | 'db' | 'gen';
export const SHAPE_PROVENANCE: Record<GuitarShapeOrigin, GuitarVoicingProvenance> = {
  v1: { origin: 'Curadoria própria LouvAIO V3', verifiedBy: 'Motor T2 + revisão ergonômica v1', license: 'First-Party Curated' },
  pop: { origin: 'Forma comum LouvAIO', verifiedBy: 'Validador de formas LouvAIO', license: 'First-Party Curated' },
  db: { origin: 'chords-db@df06fa7', verifiedBy: 'Validador de formas LouvAIO', license: 'MIT (c) 2016 David Rubert' },
  gen: { origin: 'Gerador LouvAIO v1', verifiedBy: 'Validador de formas LouvAIO', license: 'First-Party Generated' },
};

/** Frets are listed from the 6th to the 1st string; -1 is muted. */
export interface GuitarShape {
  frets: number[];
  fingers: number[];
  barres: GuitarBarre[];
  omitsFifth: boolean;
  origin: GuitarShapeOrigin;
}

/** "x32010 032010 [b<fret>:<from>-<to>:<finger>] [o5] <origin>"; frets are base 36. */
export function encodeShape(shape: GuitarShape): string {
  return [
    shape.frets.map(fret => (fret < 0 ? 'x' : fret.toString(36))).join(''),
    shape.fingers.join(''),
    ...shape.barres.map(barre => `b${barre.fret}:${barre.fromString}-${barre.toString}:${barre.finger}`),
    ...(shape.omitsFifth ? ['o5'] : []),
    shape.origin,
  ].join(' ');
}

export function decodeShape(text: string): GuitarShape {
  const parts = text.split(' ');
  const barres: GuitarBarre[] = [];
  let omitsFifth = false;
  for (const part of parts.slice(2, -1)) {
    const barre = /^b(\d+):(\d)-(\d):(\d)$/.exec(part);
    if (barre) barres.push({ fret: Number(barre[1]), fromString: Number(barre[2]), toString: Number(barre[3]), finger: Number(barre[4]) });
    else if (part === 'o5') omitsFifth = true;
  }
  return {
    frets: [...parts[0]].map(char => (char === 'x' ? -1 : parseInt(char, 36))),
    fingers: [...parts[1]].map(Number),
    barres,
    omitsFifth,
    origin: parts[parts.length - 1] as GuitarShapeOrigin,
  };
}

/** Spells the shape with the tones of the requested chord and derives every other field. */
export function expandShape(shape: GuitarShape, chord: Parsed<ChordNormalized>, index: number): GuitarVoicing {
  const normalized = chord.normalized;
  const expectedBass = normalized.bass ?? normalized.root;
  const midis = shape.frets.map((fret, i) => (fret < 0 ? null : OPEN_MIDI[i] + fret));
  const lowestMidi = Math.min(...midis.filter((midi): midi is number => midi !== null));
  const lowestIndex = midis.indexOf(lowestMidi);
  const spell = (midi: number, isLowest: boolean): SpelledNote | undefined => {
    const pitchClass = midi % 12;
    if (isLowest && expectedBass.pitchClass === pitchClass) return expectedBass;
    return chord.notes.find(note => note.pitchClass === pitchClass)
      ?? (expectedBass.pitchClass === pitchClass ? expectedBass : undefined);
  };
  const strings: GuitarStringState[] = shape.frets.map((fret, i) => {
    const stringNumber = 6 - i;
    const midi = midis[i];
    if (midi === null) return { stringNumber, status: 'muted', fret: null, finger: null, note: null, spelling: null, midi: null };
    const note = spell(midi, i === lowestIndex);
    // A pitch outside the chord keeps a null note so the validator rejects it.
    const text = note ? note.spelling + ((midi - NATURAL[note.letter] - note.accidental) / 12 - 1) : null;
    return {
      stringNumber, status: fret === 0 ? 'open' : 'fretted', fret, finger: fret === 0 ? null : shape.fingers[i],
      note: text, spelling: note?.spelling ?? null, midi,
    };
  });
  const sounding = strings.filter(item => item.midi !== null);
  const lowest = strings[lowestIndex];
  const fretted = shape.frets.filter(fret => fret > 0);
  const position = fretted.length ? Math.min(...fretted) : 1;
  const baseFret = !fretted.length || Math.max(...fretted) <= 5 ? 1 : position;
  const open = shape.frets.includes(0) && baseFret === 1;
  return {
    id: `guitar-${shape.origin}-${normalized.canonicalSymbol}-${index + 1}`,
    chordSymbol: chord.originalText,
    canonicalSymbol: normalized.canonicalSymbol,
    aliases: [],
    positionName: open ? 'Aberta (1ª posição)' : `${position}ª posição`,
    tuningId: STANDARD_TUNING.id,
    baseFret,
    barres: shape.barres.map(barre => ({ ...barre })),
    strings,
    lowestNote: { stringNumber: lowest.stringNumber, note: lowest.note ?? '', spelling: lowest.spelling ?? '', midi: lowestMidi },
    soundingNotes: sounding.map(item => item.note ?? ''),
    provenance: { ...SHAPE_PROVENANCE[shape.origin] },
    ...(shape.omitsFifth ? { omits: ['5'] } : {}),
  };
}

/** Up to four fingers; a first-finger barre is used only when they do not suffice. */
export function assignFingers(frets: readonly number[]): { fingers: number[]; barres: GuitarBarre[] } | null {
  const fingers = [0, 0, 0, 0, 0, 0];
  const fretted = [0, 1, 2, 3, 4, 5].filter(i => frets[i] > 0).sort((a, b) => frets[a] - frets[b] || a - b);
  if (fretted.length <= 4) {
    fretted.forEach((i, order) => { fingers[i] = order + 1; });
    return { fingers, barres: [] };
  }
  const fret = frets[fretted[0]];
  const pressed = fretted.filter(i => frets[i] === fret);
  const others = fretted.filter(i => frets[i] !== fret);
  if (pressed.length < 2 || others.length > 3) return null;
  const first = pressed[0];
  const last = pressed[pressed.length - 1];
  for (let i = first; i <= last; i++) if (frets[i] < fret) return null;
  pressed.forEach(i => { fingers[i] = 1; });
  others.forEach((i, order) => { fingers[i] = order + 2; });
  return { fingers, barres: [{ fret, fromString: 6 - first, toString: 6 - last, finger: 1 }] };
}

/**
 * Playability rank, lower is better. Up the neck, a lone open string between two
 * fretted ones (or any open string from the 5th fret on) is penalised.
 */
export function scoreShape(shape: Omit<GuitarShape, 'origin'>, rootPitchClass: number): number {
  const { frets, fingers, barres, omitsFifth } = shape;
  const sounding = [0, 1, 2, 3, 4, 5].filter(i => frets[i] >= 0);
  const first = sounding[0];
  const last = sounding[sounding.length - 1];
  const fretted = [0, 1, 2, 3, 4, 5].filter(i => frets[i] > 0);
  const position = fretted.length ? Math.min(...fretted.map(i => frets[i])) : 0;
  const span = fretted.length ? Math.max(...fretted.map(i => frets[i])) - position : 0;
  const open = sounding.filter(i => frets[i] === 0);
  const lone = open.filter(i => i > 0 && i < 5 && frets[i - 1] > 0 && frets[i + 1] > 0).length;
  const awkward = position >= 5 ? open.length : position >= 2 ? lone : 0;
  const roots = sounding.filter(i => (OPEN_MIDI[i] + frets[i]) % 12 === rootPitchClass).length;
  return position * 3 + (last - first + 1 - sounding.length) * 8 + (5 - last) * 5 + (6 - sounding.length) * 2
    - open.length + awkward * 6 + new Set(fingers.filter(finger => finger > 0)).size * 2
    + barres.length * 2 + span + (omitsFifth ? 3 : 0) + (roots > 1 ? 0 : 1);
}

interface Candidate { key: string; score: number; position: number; shape: GuitarShape }

function candidates(chord: Parsed<ChordNormalized>): Candidate[] {
  const normalized = chord.normalized;
  const root = normalized.root.pitchClass;
  const bass = (normalized.bass ?? normalized.root).pitchClass;
  const tones = new Set(chord.pitchClasses);
  const fifth = omittableFifth(normalized);
  const required = chord.pitchClasses.filter((_, index) => index !== fifth);
  const found = new Map<string, Candidate>();
  const frets = [0, 0, 0, 0, 0, 0];

  const evaluate = () => {
    const sounding = [0, 1, 2, 3, 4, 5].filter(i => frets[i] >= 0);
    if (sounding.length < 4) return;
    const first = sounding[0];
    const last = sounding[sounding.length - 1];
    const lowest = OPEN_MIDI[first] + frets[first];
    if (lowest % 12 !== bass) return;
    const heard = new Set<number>();
    for (const i of sounding) {
      const midi = OPEN_MIDI[i] + frets[i];
      if (midi < lowest || (i !== first && !tones.has(midi % 12))) return;
      heard.add(midi % 12);
    }
    const internalMuted = last - first + 1 - sounding.length;
    if (internalMuted > 1 || required.some(pitch => !heard.has(pitch))) return;
    const assigned = assignFingers(frets);
    if (!assigned) return;
    const key = frets.map(fret => (fret < 0 ? 'x' : fret.toString(36))).join('');
    if (found.has(key)) return;
    const fretted = frets.filter(fret => fret > 0);
    const position = fretted.length ? Math.min(...fretted) : 0;
    const omitsFifth = fifth >= 0 && !heard.has(chord.pitchClasses[fifth]);
    const shape: GuitarShape = { frets: [...frets], ...assigned, omitsFifth, origin: 'gen' };
    found.set(key, { key, score: scoreShape(shape, root), position, shape });
  };

  for (let window = 1; window <= 12; window++) {
    const options = OPEN_MIDI.map(open => {
      const list = [-1];
      for (const fret of [0, window, window + 1, window + 2, window + 3]) {
        const pitch = (open + fret) % 12;
        if (tones.has(pitch) || pitch === bass) list.push(fret);
      }
      return list;
    });
    const walk = (string: number) => {
      if (string === 6) { evaluate(); return; }
      for (const fret of options[string]) { frets[string] = fret; walk(string + 1); }
    };
    walk(0);
  }
  return [...found.values()].sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Best shapes first, at most one per neck position, every one of them validated. */
export function generateGuitarVoicings(chordSymbol: string, limit = 3): GuitarVoicing[] {
  const chord = parseChord(chordSymbol.trim());
  if (chord.status !== 'parsed') return [];
  const voicings: GuitarVoicing[] = [];
  const positions = new Set<number>();
  for (const candidate of candidates(chord)) {
    if (voicings.length >= limit) break;
    if (positions.has(candidate.position)) continue;
    const voicing = expandShape(candidate.shape, chord, voicings.length);
    if (!validateGuitarVoicing(voicing, STANDARD_TUNING).valid) continue;
    positions.add(candidate.position);
    voicings.push(voicing);
  }
  return voicings;
}
