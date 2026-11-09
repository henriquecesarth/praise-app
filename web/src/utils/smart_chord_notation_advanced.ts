/**
 * P5: additive musical-symbol recognition over the source-preserving P3 tokenizer.
 * Does not rewrite a chord sheet, infer timing, or trigger playback.
 */
import { parseNotation, type NotationLine, type NotationDocument } from './smart_chord_notation';
import { transposeChord } from './smart_chord';

export type AdvancedSymbolKind =
  | 'time_signature'
  | 'ending'
  | 'fermata'
  | 'rest'
  | 'no_chord'
  | 'repeat_measure'
  | 'repeat_count'
  | 'accidental_chord';

export interface AdvancedSymbol {
  kind: AdvancedSymbolKind;
  line: number;
  start: number;
  end: number;
  raw: string;
  value?: string;
}

/** Interpret structural symbols without losing their original spelling and offsets. */
export function findAdvancedSymbolsInLine(line: NotationLine, lineIndex = 0): AdvancedSymbol[] {
  const found: AdvancedSymbol[] = [];
  const emit = (kind: AdvancedSymbolKind, start: number, raw: string, value?: string) => {
    found.push({ kind, line: lineIndex, start, end: start + raw.length, raw, ...(value ? { value } : {}) });
  };
  // Tab techniques and notes may resemble chord roots and signatures.
  if (line.kind === 'lyrics' && /^\s*[A-Ga-g][#b]?\s*[|:].*[-─]/.test(line.raw)) return found;

  for (const token of line.tokens) {
    if (token.kind === 'annotation') continue;
    if (token.kind === 'repeat_previous') { emit('repeat_measure', token.start, token.raw); continue; }
    if (token.kind === 'repeat_count') { emit('repeat_count', token.start, token.raw, token.raw); continue; }
    if (token.kind === 'no_chord') { emit('no_chord', token.start, token.raw); continue; }
    if (token.kind === 'chord' && /[#b♭♯♮]/.test(token.chord?.slice(0, 2) ?? '')) {
      const bracketed = token.raw.startsWith('[') && token.raw.endsWith(']');
      emit('accidental_chord', token.start + (bracketed ? 1 : 0), bracketed ? token.raw.slice(1, -1) : token.raw, token.chord);
      continue;
    }
    if (token.kind !== 'text') continue;
    // Only scan literal source regions, never interpolated notes or recognized chords.
    const text = token.raw;
    const pattern = /\[(\d{1,2})\.(?:\])?|\[(\d{1,2})\]|(?<![\w/])(\d{1,2})\/(2|4|8|16)(?![\d/])|[𝄐𝄽𝄼]|(?<![\p{L}\p{N}])([A-Ga-g][♭♯♮](?:[a-zA-Z0-9+#()\-]*)(?:\/[A-Ga-g][♭♯♮]?)?)(?![\p{L}\p{N}])/gu;
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const at = token.start + (match.index ?? 0);
      if (match[1] || match[2]) emit('ending', at, raw, match[1] ?? match[2]);
      else if (match[3]) {
        const numerator = Number(match[3]);
        if (numerator >= 1 && numerator <= 12) emit('time_signature', at, raw, raw);
      } else if (raw === '𝄐') emit('fermata', at, raw);
      else if (raw === '𝄽' || raw === '𝄼') emit('rest', at, raw);
      else if (match[5]) emit('accidental_chord', at, raw, raw);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function findAdvancedSymbols(source: string | NotationDocument): AdvancedSymbol[] {
  const document = typeof source === 'string' ? parseNotation(source) : source;
  return document.lines.flatMap((line, index) => findAdvancedSymbolsInLine(line, index));
}

const FLAT_EQUIVALENTS: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb',
};

/**
 * P5 transposition adapter for Unicode accidental notation, preserving its glyph style.
 * Only a bar-delimited progression or an explicitly bracketed chord is eligible;
 * accidental words in ordinary lyric sentences are left unchanged.
 */
export function transposeAccidentalNotation(source: string, semitones: number): string {
  if (semitones === 0) return source;
  const parsed = parseNotation(source);
  const originalLines = source.split(/(\r\n|\n|\r)/);
  return originalLines.map((part, index) => {
    if (index % 2 === 1) return part;
    const sourceLine = parsed.lines[index / 2];
      const events = findAdvancedSymbolsInLine(sourceLine).filter(e => {
        const bracketedToken = e.raw.startsWith('[') && e.raw.endsWith(']') && /[♭♯♮]/.test(e.raw);
        return e.kind === 'accidental_chord' && /[♭♯♮]/.test(e.raw) &&
          (sourceLine.kind === 'progression' || bracketedToken || (e.start > 0 && part[e.start - 1] === '[' && part[e.end] === ']'));
      });
    let result = part;
    for (const event of events.reverse()) {
      const wrapped = event.raw.startsWith('[') && event.raw.endsWith(']');
      const accidentalRaw = wrapped ? event.raw.slice(1, -1) : event.raw;
      const match = accidentalRaw.match(/^([A-Ga-g][♭♯♮])([^/]*?)(?:\/([A-Ga-g][♭♯♮]?))?$/);
      if (!match) continue;
      const fromGlyph = (value: string) => value.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/♮/g, '');
      const normalized = fromGlyph(accidentalRaw);
      const transposed = transposeChord(normalized, semitones);
      if (transposed === normalized) continue;
      const target = transposed.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
      if (!target) continue;
      const style = (note: string, original: string) => {
        const styled = original.includes('♭') ? (FLAT_EQUIVALENTS[note] ?? note) : note;
        return styled.replace(/#/g, '♯').replace(/b/g, '♭');
      };
      const out = style(target[1], match[1]) + target[2] +
        (target[3] && match[3] ? '/' + style(target[3], match[3]) : '');
      result = result.slice(0, event.start) + (wrapped ? `[${out}]` : out) + result.slice(event.end);
    }
    return result;
  }).join('');
}
