import { parseNotationLine } from './smart_chord_notation';

export interface ISegment {
  chord: string;
  text: string;
}

export interface ISmartChordLine {
  line: number;
  segments: ISegment[];
}

const scale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const flatMap: Record<string, string> = {
  'Db': 'C#',
  'Eb': 'D#',
  'Gb': 'F#',
  'Ab': 'G#',
  'Bb': 'A#',
};

/**
 * Parses raw text with brackets (e.g. "Amanhã [G]será outro [Am]dia") into segments.
 */
export function parseSmartChord(smartChordText: string): ISmartChordLine[] {
  if (!smartChordText) return [];
  const lines = smartChordText.split('\n');
  const result: ISmartChordLine[] = [];
  const chordRegex = /(\[.*?\])/;

  lines.forEach((lineText, index) => {
    if (lineText.trim() === '') {
      result.push({ line: index + 1, segments: [] });
      return;
    }
    if (isTablatureLine(lineText)) {
      result.push({ line: index + 1, segments: [{ chord: '', text: lineText }] });
      return;
    }
    const segments: ISegment[] = [];
    const parts = lineText.split(chordRegex);

    if (parts[0] !== '') {
      segments.push({ chord: '', text: parts[0] });
    }

    for (let i = 1; i < parts.length; i += 2) {
      const rawChord = parts[i];
      const nextText = parts[i + 1] || '';
      const chordClean = rawChord ? rawChord.slice(1, -1) : '';
      if (isMusicalChord(chordClean) || isBarProgression(chordClean)) {
        segments.push({ chord: chordClean, text: nextText });
      } else {
        if (segments.length > 0) {
          segments[segments.length - 1].text += rawChord + nextText;
        } else {
          segments.push({ chord: '', text: rawChord + nextText });
        }
      }
    }
    result.push({ line: index + 1, segments });
  });
  return result;
}

/**
 * Transposes a single musical note (e.g. C#) by n semitones.
 */
export function transposeNote(note: string, semitones: number): string {
  let normalized = note;
  if (note in flatMap) {
    normalized = flatMap[note];
  }
  const index = scale.indexOf(normalized);
  if (index === -1) return note;
  let newIndex = (index + semitones) % 12;
  if (newIndex < 0) newIndex += 12;
  return scale[newIndex];
}

export const TABLATURE_LINE_REGEX = /^\s*(?:[A-Ga-g][#b]?\s*)?[|:].*[-─]/;

export function isTablatureLine(line: string): boolean {
  if (!line || typeof line !== 'string') return false;
  return TABLATURE_LINE_REGEX.test(line);
}

export const ROOT_REGEX = /^([A-G][#b]?)(.*)$/i;
export const EXT_REGEX = /^(m|min|maj|M|dim|aug|sus[24]?|add[249]?|[0-9]+|\+|\-|\((b5|#5|b9|#9|9|11|#11|13|b13|5-|5\+)\)|b5|#5|b9|#9|b13|#11|alt|7M|M7)*$/;

// Am(G) means Am with alternative G; performance text is never an alternative.
function alternativeChordParts(token: string): RegExpMatchArray | null {
  const match = token.match(/^([^()\s]+)\(([^()\s]+)\)$/);
  return match && isMusicalChord(match[1]) && isMusicalChord(match[2]) ? match : null;
}

export function isMusicalChord(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/♮/g, '').replace(/\(add([249])\)/g, 'add$1');
  if (!trimmed) return false;
  if (alternativeChordParts(trimmed)) return true;

  const slashParts = trimmed.split('/');
  if (slashParts.length > 2) return false;

  const mainPart = slashParts[0];
  const match = mainPart.match(ROOT_REGEX);
  if (!match) return false;

  const ext = match[2];
  if (ext && !EXT_REGEX.test(ext)) return false;

  if (slashParts.length === 2) {
    const bassPart = slashParts[1];
    if (!bassPart) return false;
    const isBassRoot = ROOT_REGEX.test(bassPart) && EXT_REGEX.test(bassPart.match(ROOT_REGEX)?.[2] || '');
    const isNumericExtension = /^[0-9]+$/.test(bassPart);
    if (!isBassRoot && !isNumericExtension) return false;
  }

  return true;
}

function transposeChordSingle(chord: string, semitones: number): string {
  if (!isMusicalChord(chord)) return chord;
  const match = chord.match(ROOT_REGEX);
  if (!match) return chord;
  const root = match[1];
  const suffix = match[2];
  const newRoot = transposeNote(root, semitones);
  return newRoot + suffix;
}

/**
 * Transposes a chord string (e.g. C#m7 or C/E) by n semitones safely.
 */
export function transposeChord(chord: string, semitones: number): string {
  if (!chord || semitones === 0) return chord;
  const alternative = alternativeChordParts(chord);
  if (alternative) {
    return transposeChord(alternative[1], semitones) + '(' + transposeChord(alternative[2], semitones) + ')';
  }

  if (/[♭♯♮]/.test(chord)) {
    const source = chord.match(/^([A-G][♭♯♮])(.*?)(?:\/([A-G][♭♯♮]?))?$/);
    if (!source) return chord;
    const normalized = chord.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/♮/g, '');
    const transposed = transposeChord(normalized, semitones);
    const target = transposed.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
    if (!target) return chord;
    const flats: Record<string, string> = { 'C#': 'D♭', 'D#': 'E♭', 'F#': 'G♭', 'G#': 'A♭', 'A#': 'B♭' };
    const style = (note: string, original: string) => original.includes('♭') ? (flats[note] ?? note) : note.replace(/#/g, '♯').replace(/b/g, '♭');
    return style(target[1], source[1]) + target[2] + (target[3] && source[3] ? `/${style(target[3], source[3])}` : '');
  }

  if (chord.includes('|') || chord.includes('%')) {
    return parseBarProgressionLine(`[${chord}]`)
      .filter(token => token.type !== 'bracket_open' && token.type !== 'bracket_close')
      .map(token => token.type === 'chord' ? transposeChord(token.value, semitones) : token.value).join('');
  }

  if (!isMusicalChord(chord)) return chord;
  if (chord.includes('/')) {
    const parts = chord.split('/');
    if (parts.length === 2 && /^[0-9]+$/.test(parts[1])) {
      return transposeChordSingle(parts[0], semitones) + '/' + parts[1];
    }
    return parts.map(part => transposeChordSingle(part, semitones)).join('/');
  }
  return transposeChordSingle(chord, semitones);
}

/**
 * Transposes an entire bracket-format song string by n semitones.
 */
export function transposeSmartChord(smartChordText: string, semitones: number): string {
  const lines = parseSmartChord(smartChordText);
  return lines
    .map(line => {
      if (line.segments.length === 0) return '';
      return line.segments
        .map(seg => {
          if (seg.chord) {
            const newChord = transposeChord(seg.chord, semitones);
            return `[${newChord}]${seg.text}`;
          }
          return seg.text;
        })
        .join('');
    })
    .join('\n');
}

export interface ITransposedLine {
  chordLine: string;
  lyricsLine: string;
}

export function renderSmartChordLine(lineText: string, semitones: number): ITransposedLine {
  if (!lineText) {
    return { chordLine: '', lyricsLine: '' };
  }
  if (isTablatureLine(lineText)) {
    return { chordLine: '', lyricsLine: lineText };
  }

  let cleanText = '';
  let cleanIndex = 0;
  const chordRegex = /\[(.*?)\]/g;
  let match;
  let lastIndex = 0;
  const chordChars: string[] = [];

  while ((match = chordRegex.exec(lineText)) !== null) {
    const originalChord = match[1];
    if (!isMusicalChord(originalChord) && !isBarProgression(originalChord)) {
      continue;
    }
    const textBetween = lineText.substring(lastIndex, match.index);
    cleanText += textBetween;
    cleanIndex += textBetween.length;

    const transposedChord = transposeChord(originalChord, semitones);

    // Find first available index to avoid overlapping
    let writeIndex = cleanIndex;
    while (writeIndex < chordChars.length && chordChars[writeIndex] !== ' ') {
      writeIndex++;
    }

    // Pad array with spaces if needed to fit the new chord
    while (chordChars.length < writeIndex + transposedChord.length) {
      chordChars.push(' ');
    }

    // Write chord
    for (let i = 0; i < transposedChord.length; i++) {
      chordChars[writeIndex + i] = transposedChord[i];
    }

    lastIndex = chordRegex.lastIndex;
  }

  const remainingText = lineText.substring(lastIndex);
  cleanText += remainingText;

  while (chordChars.length < cleanText.length) {
    chordChars.push(' ');
  }

  return {
    chordLine: chordChars.join('').trim() ? chordChars.join('') : '',
    lyricsLine: cleanText,
  };
}

export interface IVisualLine {
  cleanText: string;
  chords: Record<number, string>;
  /** Hidden source annotations kept at visible-character offsets during chord edits. */
  rawInsertions?: Record<number, Array<{ kind: 'chord' | 'annotation'; value: string }>>;
}

export function rawToVisual(rawLine: string): IVisualLine {
  if (!rawLine) return { cleanText: '', chords: {} };
  if (isTablatureLine(rawLine)) {
    return { cleanText: rawLine, chords: {} };
  }
  let cleanText = '';
  const chords: Record<number, string> = {};
  const rawInsertions: IVisualLine['rawInsertions'] = {};
  const insertion = (index: number, kind: 'chord' | 'annotation', value: string) => {
    (rawInsertions![index] ??= []).push({ kind, value });
  };
  const chordRegex = /\{\{.*?\}\}|\[(.*?)\]/g;
  let match;
  let lastPos = 0;

  while ((match = chordRegex.exec(rawLine)) !== null) {
    const raw = match[0];
    const isAnnotation = raw.startsWith('{{');
    const chord = isAnnotation ? '' : match[1];
    if (!isAnnotation && !isMusicalChord(chord) && !isBarProgression(chord)) {
      continue;
    }
    if (match.index > lastPos) {
      const textSegment = rawLine.substring(lastPos, match.index);
      cleanText += textSegment;
    }
    if (isAnnotation) insertion(cleanText.length, 'annotation', raw);
    else {
      chords[cleanText.length] = chord;
      insertion(cleanText.length, 'chord', chord);
    }
    lastPos = chordRegex.lastIndex;
  }

  if (lastPos < rawLine.length) {
    const textSegment = rawLine.substring(lastPos);
    cleanText += textSegment;
  }

  return { cleanText, chords, rawInsertions };
}

export function visualToRaw(visual: IVisualLine): string {
  let raw = '';
  const text = visual.cleanText;
  for (let i = 0; i <= text.length; i++) {
    const insertions = visual.rawInsertions?.[i];
    if (insertions?.length) {
      const chordInsertions = insertions.filter(item => item.kind === 'chord');
      let seenChords = 0;
      for (const item of insertions) {
        if (item.kind === 'annotation') raw += item.value;
        else {
          const value = seenChords++ === chordInsertions.length - 1 ? visual.chords[i] : item.value;
          if (value !== undefined) raw += `[${value}]`;
        }
      }
      if (visual.chords[i] !== undefined && chordInsertions.length === 0) raw += `[${visual.chords[i]}]`;
    } else if (visual.chords[i] !== undefined) {
      raw += `[${visual.chords[i]}]`;
    }
    if (i < text.length) {
      raw += text[i];
    }
  }
  return raw;
}

export type BarTokenType = 'bracket_open' | 'bracket_close' | 'delimiter' | 'chord' | 'whitespace' | 'text';

export interface IBarProgressionToken {
  type: BarTokenType;
  value: string;
  startIndex: number;
  endIndex: number;
  chordIndex?: number;
}

export function isBarProgression(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  return token.includes('|') || token.includes('%');
}

export function hasBarProgression(lineText: string): boolean {
  if (!lineText || typeof lineText !== 'string') return false;
  return /\[[^\]]*[|%][^\]]*\]/.test(lineText) || /^\s*(?:\{\{[^}]*\}\}\s*)?(?:\|\||\|:|\|)\s*(?=.*\|)(?![-─])/.test(lineText);
}

export function parseBarProgressionLine(lineText: string): IBarProgressionToken[] {
  if (!lineText) return [];
  if ((lineText.match(/\{\{/g)?.length ?? 0) !== (lineText.match(/\}\}/g)?.length ?? 0)) {
    return [{ type: 'text', value: lineText, startIndex: 0, endIndex: lineText.length }];
  }
  // Keep annotation offsets stable while preventing annotation contents (which may
  // contain chord syntax) from participating in musical tokenization.
  const annotationRanges: Array<{ start: number; end: number }> = [];
  const maskedLine = lineText.replace(/\{\{.*?\}\}/g, (annotation, start: number) => {
    annotationRanges.push({ start, end: start + annotation.length });
    return annotation.replace(/[^\r\n]/g, ' ');
  });
  const projectVisibleTokens = (tokens: IBarProgressionToken[]) => {
    if (annotationRanges.length === 0) return tokens;
    const visibleTokens: IBarProgressionToken[] = [];
    for (const token of tokens) {
      let cursor = token.startIndex;
      const overlaps = annotationRanges.filter(range => range.start < token.endIndex && range.end > token.startIndex);
      if (overlaps.length === 0) {
        visibleTokens.push({ ...token, value: lineText.slice(token.startIndex, token.endIndex) });
        continue;
      }
      if (token.type === 'chord') continue;
      for (const range of overlaps) {
        if (cursor < range.start) {
          const end = Math.min(range.start, token.endIndex);
          if (end > cursor) visibleTokens.push({ type: 'text', value: lineText.slice(cursor, end), startIndex: cursor, endIndex: end });
        }
        cursor = Math.max(cursor, range.end);
      }
      if (cursor < token.endIndex) visibleTokens.push({ type: 'text', value: lineText.slice(cursor, token.endIndex), startIndex: cursor, endIndex: token.endIndex });
    }
    return visibleTokens;
  };
  const nakedProgression = !/\[[^\]]*[|%][^\]]*\]/.test(maskedLine) && /^\s*(?:\|\||\|:|\|)/.test(maskedLine);
  if (nakedProgression) {
    // Parse naked source directly: synthetic brackets corrupt ending markers such as [1].
    let chordCounter = 0;
    const notationTokens = parseNotationLine(maskedLine).tokens;
    const result: IBarProgressionToken[] = [];
    for (let tokenIndex = 0; tokenIndex < notationTokens.length; tokenIndex++) {
      const token = notationTokens[tokenIndex];
      const suffix = token.kind === 'chord' ? notationTokens[tokenIndex + 1] : undefined;
      if (token.kind === 'chord' && token.chord && suffix?.kind === 'text' && /^\((?:b|#)?(?:5|9|11|13)\)$/.test(suffix.raw)) {
        const fullChord = token.chord + suffix.raw;
        result.push({ type: 'chord', value: fullChord, startIndex: token.start, endIndex: suffix.end, chordIndex: chordCounter++ });
        tokenIndex++;
        continue;
      }
      if (token.kind === 'barline' || token.kind === 'repeat_previous') {
        result.push({ type: 'delimiter', value: token.raw, startIndex: token.start, endIndex: token.end });
        continue;
      }
      if (token.kind === 'whitespace') {
        result.push({ type: 'whitespace', value: token.raw, startIndex: token.start, endIndex: token.end });
        continue;
      }
      if (token.kind === 'chord' && token.chord) {
        result.push({ type: 'chord', value: token.chord, startIndex: token.start, endIndex: token.end, chordIndex: chordCounter++ });
        continue;
      }
      if (token.kind === 'optional_chord' && token.chord) {
        const start = token.start;
        const end = token.end;
        result.push(
          { type: 'text' as const, value: '(', startIndex: start, endIndex: start + 1 },
          { type: 'chord' as const, value: token.chord, startIndex: start + 1, endIndex: end - 1, chordIndex: chordCounter++ },
          { type: 'text' as const, value: ')', startIndex: end - 1, endIndex: end },
        );
        continue;
      }
      result.push({ type: 'text', value: token.raw, startIndex: token.start, endIndex: token.end });
    }
    return projectVisibleTokens(result);
  }
  const tokens: IBarProgressionToken[] = [];
  const bracketRegex = /\[(.*?)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let chordCounter = 0;

  while ((match = bracketRegex.exec(maskedLine)) !== null) {
    if (match.index > lastIndex) {
      const text = maskedLine.substring(lastIndex, match.index);
      tokens.push({
        type: 'text',
        value: text,
        startIndex: lastIndex,
        endIndex: match.index,
      });
    }

    const openBracketIdx = match.index;
    tokens.push({
      type: 'bracket_open',
      value: '[',
      startIndex: openBracketIdx,
      endIndex: openBracketIdx + 1,
    });

    const innerContent = match[1];
    const innerStart = openBracketIdx + 1;
    const innerRegex = /([^\s|%:()]+(?:\([^()]*\))+(?:\/[A-Ga-g][#b]?)?|\([^()]*\)|\|\|:|:\|\||\|\||\|:|:\||\||%|:+|\s+|[^\s|%:()]+(?:\/[A-Ga-g][#b]?)?)/g;
    let innerMatch: RegExpExecArray | null;

    while ((innerMatch = innerRegex.exec(innerContent)) !== null) {
      let val = innerMatch[0];
      const nextParenthesized = innerContent.slice(innerRegex.lastIndex).match(/^\([^()]*\)/)?.[0];
      if (nextParenthesized && isMusicalChord(val) && isMusicalChord(val + nextParenthesized)) {
        val += nextParenthesized;
        innerRegex.lastIndex += nextParenthesized.length;
      }
      const start = innerStart + innerMatch.index;
      const end = start + val.length;

      if (/^\s+$/.test(val)) {
        tokens.push({ type: 'whitespace', value: val, startIndex: start, endIndex: end });
      } else if (/^(\|\|:|:\|\||\|\||\|:|:\||\||%)$/.test(val)) {
        tokens.push({ type: 'delimiter', value: val, startIndex: start, endIndex: end });
      } else if (val.startsWith('(') && val.endsWith(')') && isMusicalChord(val.slice(1, -1))) {
        tokens.push({ type: 'text', value: '(', startIndex: start, endIndex: start + 1 });
        tokens.push({ type: 'chord', value: val.slice(1, -1), startIndex: start + 1, endIndex: end - 1, chordIndex: chordCounter++ });
        tokens.push({ type: 'text', value: ')', startIndex: end - 1, endIndex: end });
      } else if (val.includes('(') && val.endsWith(')') && isMusicalChord(val.slice(0, val.indexOf('('))) && isMusicalChord(val.slice(val.indexOf('(') + 1, -1))) {
        const optionalAt = val.indexOf('(');
        tokens.push({ type: 'chord', value: val.slice(0, optionalAt), startIndex: start, endIndex: start + optionalAt, chordIndex: chordCounter++ });
        tokens.push({ type: 'text', value: '(', startIndex: start + optionalAt, endIndex: start + optionalAt + 1 });
        tokens.push({ type: 'chord', value: val.slice(optionalAt + 1, -1), startIndex: start + optionalAt + 1, endIndex: end - 1, chordIndex: chordCounter++ });
        tokens.push({ type: 'text', value: ')', startIndex: end - 1, endIndex: end });
      } else if (isMusicalChord(val)) {
        tokens.push({
          type: 'chord',
          value: val,
          startIndex: start,
          endIndex: end,
          chordIndex: chordCounter++,
        });
      } else {
        tokens.push({ type: 'text', value: val, startIndex: start, endIndex: end });
      }
    }

    const closeBracketIdx = openBracketIdx + match[0].length - 1;
    tokens.push({
      type: 'bracket_close',
      value: ']',
      startIndex: closeBracketIdx,
      endIndex: closeBracketIdx + 1,
    });

    lastIndex = bracketRegex.lastIndex;
  }

  if (lastIndex < lineText.length) {
    tokens.push({
      type: 'text',
      value: maskedLine.substring(lastIndex),
      startIndex: lastIndex,
      endIndex: lineText.length,
    });
  }

  return projectVisibleTokens(tokens);
}

export function updateBarProgressionChord(
  rawLine: string,
  targetChordIndex: number,
  newChord: string
): string {
  if (!rawLine) return rawLine;
  if (/[\r\n]/.test(rawLine) || !Number.isInteger(targetChordIndex) || targetChordIndex < 0) return rawLine;
  if ((rawLine.match(/\{\{/g)?.length ?? 0) !== (rawLine.match(/\}\}/g)?.length ?? 0)) return rawLine;
  const trimmed = newChord ? newChord.trim() : '';
  if (!isMusicalChord(trimmed)) {
    return rawLine;
  }

  const tokens = parseBarProgressionLine(rawLine);
  const targetToken = tokens.find(t => t.type === 'chord' && t.chordIndex === targetChordIndex);
  if (!targetToken) {
    return rawLine;
  }
  const start = targetToken.startIndex;
  const end = targetToken.endIndex;
  if (start < 0 || end > rawLine.length || end <= start || rawLine.slice(start, end) !== targetToken.value) return rawLine;
  return rawLine.slice(0, start) + trimmed + rawLine.slice(end);
}

export interface IFontFamilyOption {
  label: string;
  value: string;
  css: string;
}

export const CHORD_FONT_FAMILIES: IFontFamilyOption[] = [
  { label: 'Padr\u00e3o (monoespa\u00e7ada)', value: 'monospace', css: 'monospace, "Courier New", Courier' },
  { label: 'Arial', value: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia', css: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier New', value: 'Courier New', css: '"Courier New", Courier, monospace' },
];

export function getFontFamilyCss(value: string): string {
  const match = CHORD_FONT_FAMILIES.find(f => f.value === value || f.label === value);
  return match ? match.css : 'monospace, "Courier New", Courier';
}
