/**
 * P2 advanced Smart Chords notation, intentionally independent of the visual editor.
 * All tokens refer to UTF-16 offsets in their original line; source is never normalized.
 */
import { isMusicalChord, isTablatureLine, transposeChord } from './smart_chord';

export type NotationTokenKind =
  | 'text' | 'whitespace' | 'barline' | 'chord' | 'optional_chord'
  | 'repeat_previous' | 'repeat_count' | 'no_chord' | 'annotation';
export type AnnotationPlacement = 'line' | 'inline' | 'above-next-chord';
export type NotationLineKind = 'blank' | 'annotation' | 'progression' | 'lyrics';

export interface NotationToken {
  kind: NotationTokenKind;
  raw: string;
  start: number;
  end: number;
  chord?: string;
  text?: string;
  placement?: AnnotationPlacement;
}
export interface NotationLine {
  kind: NotationLineKind;
  raw: string;
  tokens: NotationToken[];
}
export interface NotationDocument {
  source: string;
  lines: NotationLine[];
}
export interface AnnotationAnchor {
  line: number;
  token: number;
  text: string;
  placement: AnnotationPlacement;
  target: { line: number; token: number } | null;
}

/** Presentation hint only; not wired to the D2-A renderer yet. */
export const ANNOTATION_FONT_SCALE = 0.8;

const BARLINES = ['||:', ':||', '|:', ':|', '||', '|'] as const;

function push(tokens: NotationToken[], kind: NotationTokenKind, raw: string, start: number, extras: Partial<NotationToken> = {}): void {
  tokens.push({ kind, raw, start, end: start + raw.length, ...extras });
}

function isProgression(raw: string): boolean {
  // An annotation may precede the barline on the same source line.
  let rest = raw.trimStart();
  while (rest.startsWith('{{')) {
    const close = rest.indexOf('}}', 2);
    if (close < 0) break;
    rest = rest.slice(close + 2).trimStart();
  }
  return /^(?:\|\|:|\|:|\||\[\s*\|)/.test(rest);
}

function parseAnnotation(raw: string, start: number, tokens: NotationToken[]): number | null {
  if (!raw.startsWith('{{', start)) return null;
  const end = raw.indexOf('}}', start + 2);
  if (end === -1) return null;
  const token = raw.slice(start, end + 2);
  const body = raw.slice(start + 2, end);
  const above = body.startsWith('^');
  push(tokens, 'annotation', token, start, {
    text: above ? body.slice(1) : body,
    placement: above ? 'above-next-chord' : 'inline',
  });
  return end + 2;
}

/** Accepts standard bracketed chords in lyrics, leaves [Verse] and unknown tags intact. */
function parseLyricsLine(raw: string): NotationToken[] {
  const tokens: NotationToken[] = [];
  let cursor = 0;
  let literalStart = 0;
  while (cursor < raw.length) {
    let tokenEnd: number | null = null;
    if (raw.startsWith('{{', cursor)) {
      const end = raw.indexOf('}}', cursor + 2);
      if (end !== -1) tokenEnd = end + 2;
    } else if (raw[cursor] === '[') {
      const end = raw.indexOf(']', cursor + 1);
      if (end !== -1 && isMusicalChord(raw.slice(cursor + 1, end))) tokenEnd = end + 1;
    }
    if (tokenEnd === null) { cursor++; continue; }
    if (literalStart < cursor) push(tokens, 'text', raw.slice(literalStart, cursor), literalStart);
    if (raw.startsWith('{{', cursor)) {
      parseAnnotation(raw, cursor, tokens);
    } else {
      push(tokens, 'chord', raw.slice(cursor, tokenEnd), cursor, { chord: raw.slice(cursor + 1, tokenEnd - 1) });
    }
    cursor = tokenEnd;
    literalStart = cursor;
  }
  if (literalStart < raw.length) push(tokens, 'text', raw.slice(literalStart), literalStart);
  return tokens;
}

/** A bar-delimited progression is parsed token-by-token, including annotations. */
function parseProgressionLine(raw: string): NotationToken[] {
  const tokens: NotationToken[] = [];
  let i = 0;
  while (i < raw.length) {
    const annotationEnd = parseAnnotation(raw, i, tokens);
    if (annotationEnd !== null) { i = annotationEnd; continue; }
    const bar = BARLINES.find(symbol => raw.startsWith(symbol, i));
    if (bar) { push(tokens, 'barline', bar, i); i += bar.length; continue; }
    if (/\s/.test(raw[i])) {
      let end = i + 1;
      while (end < raw.length && /\s/.test(raw[end])) end++;
      push(tokens, 'whitespace', raw.slice(i, end), i);
      i = end;
      continue;
    }
    if (raw[i] === '(') {
      const end = raw.indexOf(')', i + 1);
      if (end !== -1) {
        const chord = raw.slice(i + 1, end);
        if (isMusicalChord(chord)) {
          push(tokens, 'optional_chord', raw.slice(i, end + 1), i, { chord });
          i = end + 1;
          continue;
        }
      }
    }
    if (raw[i] === '%') {
      push(tokens, 'repeat_previous', '%', i);
      i++;
      continue;
    }
    if (raw.startsWith('[', i) && /^\[\s*\|/.test(raw.slice(i))) {
      push(tokens, 'text', '[', i);
      i++;
      continue;
    }
    if (raw[i] === ']' && raw.slice(0, i).includes('[|')) {
      push(tokens, 'text', ']', i);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < raw.length && !/[\s|()%\[\]]/.test(raw[end]) && !raw.startsWith('{{', end)) end++;
    const word = raw.slice(i, end);
    if (isMusicalChord(word)) push(tokens, 'chord', word, i, { chord: word });
    else if (/^(?:N\.C\.|NC)$/i.test(word)) push(tokens, 'no_chord', word, i);
    else if (/^\d+[xX]$/.test(word) && tokens.some(t => t.kind === 'barline' && /:\|/.test(t.raw))) {
      push(tokens, 'repeat_count', word, i);
    } else push(tokens, 'text', word, i);
    i = end;
  }
  return tokens;
}

export function parseNotationLine(raw: string): NotationLine {
  if (raw.length === 0 || /^\s+$/.test(raw)) {
    return { kind: 'blank', raw, tokens: raw ? [{ kind: 'whitespace', raw, start: 0, end: raw.length }] : [] };
  }
  if (isTablatureLine(raw)) return { kind: 'lyrics', raw, tokens: [{ kind: 'text', raw, start: 0, end: raw.length }] };
  const progression = isProgression(raw);
  const tokens = progression ? parseProgressionLine(raw) : parseLyricsLine(raw);
  const annotationsOnly = tokens.length > 0 && tokens.every(token =>
    token.kind === 'annotation' || (token.kind === 'text' && /^\s*$/.test(token.raw)) || token.kind === 'whitespace');
  if (annotationsOnly) {
    for (const token of tokens) {
      if (token.kind === 'annotation' && token.placement === 'inline') token.placement = 'line';
    }
  }
  return { kind: progression ? 'progression' : annotationsOnly ? 'annotation' : 'lyrics', raw, tokens };
}

export function parseNotation(source: string): NotationDocument {
  // Keep exact source including CRLFs and trailing blank lines. Only line content is tokenized.
  const lines = source.split(/\r\n|\n|\r/).map(parseNotationLine);
  return { source, lines };
}

/** Identifies the next real chord even if it is on the following line. */
export function resolveAnnotationAnchors(document: NotationDocument): AnnotationAnchor[] {
  const anchors: AnnotationAnchor[] = [];
  for (let line = 0; line < document.lines.length; line++) {
    const tokens = document.lines[line].tokens;
    for (let token = 0; token < tokens.length; token++) {
      const entry = tokens[token];
      if (entry.kind !== 'annotation') continue;
      let target: AnnotationAnchor['target'] = null;
      if (entry.placement === 'above-next-chord') {
        outer: for (let l = line; l < document.lines.length; l++) {
          for (let t = l === line ? token + 1 : 0; t < document.lines[l].tokens.length; t++) {
            if (['chord', 'optional_chord'].includes(document.lines[l].tokens[t].kind)) {
              target = { line: l, token: t };
              break outer;
            }
          }
        }
      }
      anchors.push({ line, token, text: entry.text ?? '', placement: entry.placement ?? 'inline', target });
    }
  }
  return anchors;
}

export function transposeNotationLine(raw: string, semitones: number): string {
  // Invariant: exact byte-for-byte round-trip when no transposition is requested.
  if (semitones === 0) return raw;
  const line = parseNotationLine(raw);
  return line.tokens.map(token => {
    if (token.kind === 'optional_chord' && token.chord) return '(' + transposeChord(token.chord, semitones) + ')';
    if (token.kind === 'chord' && token.chord) {
      const next = transposeChord(token.chord, semitones);
      return token.raw.startsWith('[') ? '[' + next + ']' : next;
    }
    return token.raw;
  }).join('');
}

export function transposeNotation(source: string, semitones: number): string {
  if (semitones === 0) return source;
  return source.split(/(\r\n|\n|\r)/).map((part, i) =>
    i % 2 === 0 ? transposeNotationLine(part, semitones) : part).join('');
}
