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
    const segments: ISegment[] = [];
    const parts = lineText.split(chordRegex);

    if (parts[0] !== '') {
      segments.push({ chord: '', text: parts[0] });
    }

    for (let i = 1; i < parts.length; i += 2) {
      const rawChord = parts[i];
      const nextText = parts[i + 1] || '';
      const chordClean = rawChord ? rawChord.slice(1, -1) : '';
      segments.push({ chord: chordClean, text: nextText });
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

export const ROOT_REGEX = /^([A-G][#b]?)(.*)$/i;
export const EXT_REGEX = /^(m|min|maj|M|dim|aug|sus[24]?|add[249]?|[0-9]+|\+|\-|\((b5|#5|b9|#9|9|11|#11|13|b13|5-|5\+)\)|b5|#5|b9|#9|b13|#11|alt|7M|M7)*$/;

export function isMusicalChord(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed) return false;

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

  let cleanText = '';
  let cleanIndex = 0;
  const chordRegex = /\[(.*?)\]/g;
  let match;
  let lastIndex = 0;
  const chordChars: string[] = [];

  while ((match = chordRegex.exec(lineText)) !== null) {
    const textBetween = lineText.substring(lastIndex, match.index);
    cleanText += textBetween;
    cleanIndex += textBetween.length;

    const originalChord = match[1];
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
    chordLine: chordChars.join(''),
    lyricsLine: cleanText,
  };
}

export interface IVisualLine {
  cleanText: string;
  chords: Record<number, string>;
}

export function rawToVisual(rawLine: string): IVisualLine {
  let cleanText = '';
  const chords: Record<number, string> = {};
  const chordRegex = /\[(.*?)\]/g;
  let match;
  let lastPos = 0;
  let currentPos = 0;

  while ((match = chordRegex.exec(rawLine)) !== null) {
    if (match.index > lastPos) {
      const textSegment = rawLine.substring(lastPos, match.index);
      cleanText += textSegment;
      currentPos += textSegment.length;
    }
    const chord = match[1];
    chords[currentPos] = chord;
    lastPos = chordRegex.lastIndex;
  }

  if (lastPos < rawLine.length) {
    const textSegment = rawLine.substring(lastPos);
    cleanText += textSegment;
  }

  return { cleanText, chords };
}

export function visualToRaw(visual: IVisualLine): string {
  let raw = '';
  const text = visual.cleanText;
  for (let i = 0; i <= text.length; i++) {
    if (visual.chords[i] !== undefined) {
      raw += `[${visual.chords[i]}]`;
    }
    if (i < text.length) {
      raw += text[i];
    }
  }
  return raw;
}
