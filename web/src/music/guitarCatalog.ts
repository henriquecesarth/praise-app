/** Curated and imported shapes first; the generator only fills what is missing. */
import catalogJson from '../../../shared/fixtures/guitar-voicings-v2.json';
import { decodeShape, expandShape, generateGuitarVoicings, scoreShape, STANDARD_TUNING } from './guitarGenerator';
import type { GuitarShape } from './guitarGenerator';
import { validateGuitarVoicing } from './guitarVoicings';
import type { GuitarBassClassification, GuitarLookupResult, GuitarVoicing } from './guitarVoicings';
import { parseChord } from './theory';
import type { ChordNormalized } from './theory';

/** Enharmonic spellings share shapes; notes are respelled for the requested chord. */
function pitchKey(chord: ChordNormalized): string {
  const { root, bass, canonicalSymbol } = chord;
  const suffix = canonicalSymbol.slice(root.spelling.length).split('/')[0];
  return `${root.pitchClass}|${suffix}|${bass && bass.pitchClass !== root.pitchClass ? bass.pitchClass : ''}`;
}

let index: Map<string, string[]> | null = null;
function catalogShapes(chord: ChordNormalized): string[] {
  if (!index) {
    index = new Map();
    for (const [symbol, shapes] of Object.entries(catalogJson.chords as Record<string, string[]>)) {
      const parsed = parseChord(symbol);
      if (parsed.status === 'parsed') index.set(pitchKey(parsed.normalized), shapes);
    }
  }
  return index.get(pitchKey(chord)) ?? [];
}

export function findGuitarVoicings(chordSymbol: string): GuitarLookupResult {
  const trimmed = chordSymbol.trim();
  const parsed = parseChord(trimmed);
  if (parsed.status !== 'parsed') {
    return {
      status: 'unavailable',
      reason: 'chordUnsupported',
      preservedText: parsed.preservedText || trimmed,
      chord: null,
      message: `Diagrama indisponível para "${trimmed}" no violão.`,
    };
  }

  let voicings: GuitarVoicing[] = [];
  let classification: Exclude<GuitarBassClassification, 'invalid'> = 'rootPosition';
  const keep = (voicing: GuitarVoicing) => {
    const result = validateGuitarVoicing(voicing, STANDARD_TUNING);
    if (!result.valid || result.bassClassification === 'invalid') return false;
    classification = result.bassClassification;
    return true;
  };
  // Curated and everyday shapes keep the first places; imported ones follow by playability.
  const root = parsed.normalized.root.pitchClass;
  const rank = (shape: GuitarShape) => (shape.origin === 'v1' ? -2000 : shape.origin === 'pop' ? -1000 : scoreShape(shape, root));
  voicings = catalogShapes(parsed.normalized).map(decodeShape)
    .map((shape, i) => ({ shape, i }))
    .sort((a, b) => rank(a.shape) - rank(b.shape) || a.i - b.i)
    .map(({ shape }, i) => expandShape(shape, parsed, i))
    .filter(keep);
  if (!voicings.length) voicings = generateGuitarVoicings(trimmed).filter(keep);

  if (!voicings.length) {
    return {
      status: 'unavailable',
      reason: 'voicingNotInCatalog',
      preservedText: parsed.originalText,
      chord: parsed,
      message: `Diagrama indisponível: não há posição de violão tocável para ${parsed.originalText}.`,
    };
  }
  return { status: 'available', chord: parsed, voicings, primaryVoicing: voicings[0], bassClassification: classification };
}
