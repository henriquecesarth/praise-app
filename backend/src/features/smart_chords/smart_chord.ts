import { ISmartChordLine, ISegment } from './smart_chord.types';

const SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_MAP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

export function parseSmartChord(text: string): ISmartChordLine[] {
  if (!text) return [];
  const lines = text.split('\n');
  const result: ISmartChordLine[] = [];
  const chordRegex = /\[(.*?)\]/g;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (lineText.trim() === '') {
      result.push({ line: i + 1, segments: [] });
      continue;
    }

    const segments: ISegment[] = [];
    let match;
    let lastPos = 0;
    let currentChord = '';

    // Reset regex lastIndex
    chordRegex.lastIndex = 0;

    while ((match = chordRegex.exec(lineText)) !== null) {
      if (match.index > lastPos) {
        const textSegment = lineText.substring(lastPos, match.index);
        segments.push({ chord: currentChord, text: textSegment });
        currentChord = ''; // consumed
      }
      currentChord = match[1];
      lastPos = chordRegex.lastIndex;
    }

    if (lastPos < lineText.length) {
      segments.push({ chord: currentChord, text: lineText.substring(lastPos) });
    } else if (currentChord) {
      segments.push({ chord: currentChord, text: '' });
    }

    // If no chords found at all
    if (segments.length === 0 && lineText.length > 0) {
      segments.push({ chord: '', text: lineText });
    }

    result.push({ line: i + 1, segments });
  }

  return result;
}

export function transposeNote(note: string, semitones: number): string {
  const normalized = FLAT_MAP[note] || note;
  const index = SCALE.indexOf(normalized);
  if (index === -1) return note; // Return as is if not found
  let newIndex = (index + semitones) % 12;
  if (newIndex < 0) newIndex += 12;
  return SCALE[newIndex];
}

function transposeChordSingle(chord: string, semitones: number): string {
  const regex = /^([A-G][#b]?)(.*)$/;
  const match = chord.match(regex);
  if (!match) return chord;
  const [, root, suffix] = match;
  return transposeNote(root, semitones) + suffix;
}

export function transposeChord(chord: string, semitones: number): string {
  if (!chord) return '';
  if (chord.includes('/')) {
    return chord
      .split('/')
      .map((part) => transposeChordSingle(part, semitones))
      .join('/');
  }
  return transposeChordSingle(chord, semitones);
}

export function transposeSmartChord(text: string, semitones: number): string {
  const lines = parseSmartChord(text);
  return lines
    .map((line) => {
      if (line.segments.length === 0) return '';
      return line.segments
        .map((seg) => {
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
