import { SmartChordImportDraft, ImportWarning } from './smart_chord_import.types';

export const ROOT_REGEX = /^([A-G][#b]?)(.*)$/i;
export const EXT_REGEX = /^(m|min|maj|M|dim|aug|sus[24]?|add[249]?|[0-9]+|\+|\-|\((b5|#5|b9|#9|9|11|#11|13|b13|5-|5\+)\)|b5|#5|b9|#9|b13|#11|alt|7M|M7)*$/;

export const SECTION_HEADER_REGEX = /^(Intro|Verso|Pré-refrão|Pre-refrao|Refrão|Refrao|Coro|Ponte|Solo|Interlúdio|Interludio|Instrumental|Final|Coda|Tag)(\s+\d+)?[:\s]*$/i;
export const BRACKETED_SECTION_REGEX = /^\[(Intro|Verso|Pré-refrão|Pre-refrao|Refrão|Refrao|Coro|Ponte|Solo|Interlúdio|Interludio|Instrumental|Final|Coda|Tag)(\s+\d+)?\]$/i;

export const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const FLAT_MAP: Record<string, string> = {
  'Db': 'C#',
  'Eb': 'D#',
  'Gb': 'F#',
  'Ab': 'G#',
  'Bb': 'A#',
};

/**
 * Validates if a token is a musical chord (e.g. A9, A7M/9, D/F#, F#m)
 * and distinguishes it from non-chord text (e.g. Baixo, Corte, Dedilhado, Fim).
 */
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

/**
 * Transposes a single note by semitones.
 */
export function transposeNote(note: string, semitones: number): string {
  let normalized = note;
  if (note in FLAT_MAP) {
    normalized = FLAT_MAP[note];
  }
  const index = CHROMATIC_SCALE.indexOf(normalized.toUpperCase());
  if (index === -1) return note;
  let newIndex = (index + semitones) % 12;
  if (newIndex < 0) newIndex += 12;
  return CHROMATIC_SCALE[newIndex];
}

function transposeSingleChordRoot(part: string, semitones: number): string {
  const match = part.match(ROOT_REGEX);
  if (!match) return part;
  const root = match[1];
  const ext = match[2];
  if (ext && !EXT_REGEX.test(ext)) {
    // Non-chord annotation like Baixo, Corte
    return part;
  }
  const newRoot = transposeNote(root, semitones);
  return newRoot + ext;
}

/**
 * Transposes a chord token safely without corrupting non-chord words.
 */
export function transposeChordSafe(chord: string, semitones: number): string {
  if (!chord || semitones === 0) return chord;
  if (!isMusicalChord(chord)) return chord;

  if (chord.includes('/')) {
    const parts = chord.split('/');
    if (parts.length === 2 && /^[0-9]+$/.test(parts[1])) {
      // Compound extension like A7M/9
      return transposeSingleChordRoot(parts[0], semitones) + '/' + parts[1];
    }
    return parts.map(part => transposeSingleChordRoot(part, semitones)).join('/');
  }

  return transposeSingleChordRoot(chord, semitones);
}

export interface TokenWithPosition {
  text: string;
  index: number;
  isChord: boolean;
}

export function tokenizeLine(line: string): TokenWithPosition[] {
  const tokens: TokenWithPosition[] = [];
  const regex = /\([^()]*\)|\[[^[\]]*\]|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      text: match[0],
      index: match.index,
      isChord: isMusicalChord(match[0]),
    });
  }
  return tokens;
}

export function isChordLine(line: string): boolean {
  if (!line || !line.trim()) return false;
  // If line contains section header, it's not a pure chord line
  if (SECTION_HEADER_REGEX.test(line.trim()) || BRACKETED_SECTION_REGEX.test(line.trim())) {
    return false;
  }
  // If line is a single parenthesized annotation, it's an annotation line, not a chord line
  if (/^\s*\([^()]*\)\s*$/.test(line.trim())) {
    return false;
  }

  const tokens = tokenizeLine(line);
  if (tokens.length === 0) return false;

  let chordCount = 0;
  let nonAnnotationCount = 0;
  for (const t of tokens) {
    if (/^\([^()]*\)$/.test(t.text) || /^\[[^[\]]*\]$/.test(t.text)) {
      continue;
    }
    nonAnnotationCount++;
    if (t.isChord || ['|', '||:', ':||', '%', '/'].includes(t.text)) {
      chordCount++;
    }
  }

  if (nonAnnotationCount === 0) return false;
  return (chordCount / nonAnnotationCount) >= 0.6;
}

/**
 * Normalizes plain-text chord sheets (including chord-over-lyric layout) into
 * standard LouvAIO bracketed notation [Chord]lyric.
 */
export function normalizeChordText(rawText: string): SmartChordImportDraft {
  const warnings: ImportWarning[] = [];
  if (!rawText || !rawText.trim()) {
    return {
      title: 'Nova Cifra',
      artist_name: null,
      original_key: null,
      content: '',
      warnings: [{ code: 'UNSUPPORTED_LAYOUT', message: 'Conteúdo vazio fornecido para importação.' }],
      source_type: 'text',
    };
  }

  const normalizedEol = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalizedEol.split('\n');

  let title = '';
  let artistName: string | null = null;
  let originalKey: string | null = null;

  const contentLines: string[] = [];
  let i = 0;

  // Metadata extraction pass on leading lines
  while (i < rawLines.length && i < 15) {
    const trimmed = rawLines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const titleMatch = trimmed.match(/^(?:Título|Titulo|Title):\s*(.+)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      i++;
      continue;
    }

    const artistMatch = trimmed.match(/^(?:Artista|Artist|Banda|Por|By|Intérprete|Interprete|Compositor):\s*(.+)$/i);
    if (artistMatch) {
      artistName = artistMatch[1].trim();
      i++;
      continue;
    }

    const keyMatch = trimmed.match(/^(?:Tom|Key|Tom\s+Original):\s*([A-G][#b]?(?:m|maj|min)?)\s*$/i);
    if (keyMatch) {
      originalKey = keyMatch[1].trim();
      i++;
      continue;
    }

    break;
  }

  // Check if text already has widespread inline brackets [Chord]
  const remainingText = rawLines.slice(i).join('\n');
  const bracketMatches = remainingText.match(/\[([A-G][#b]?[^\]]*)\]/g);
  const isAlreadyBracketed = (bracketMatches && bracketMatches.length >= 3);

  if (isAlreadyBracketed) {
    // Already in bracket format, preserve and validate
    for (let lineIdx = i; lineIdx < rawLines.length; lineIdx++) {
      contentLines.push(rawLines[lineIdx]);
    }
  } else {
    // Process two-line chord-over-lyric and progression layout
    while (i < rawLines.length) {
      const currentLine = rawLines[i];
      const trimmed = currentLine.trim();

      if (!trimmed) {
        contentLines.push('');
        i++;
        continue;
      }

      // Check for section header
      if (SECTION_HEADER_REGEX.test(trimmed)) {
        contentLines.push('[' + trimmed.replace(/[:\s]+$/, '') + ']');
        i++;
        continue;
      }
      if (BRACKETED_SECTION_REGEX.test(trimmed)) {
        contentLines.push(trimmed);
        i++;
        continue;
      }

      // Check for parenthetical performance annotation e.g. (violão/pad)
      if (/^\s*\(.*?\)\s*$/.test(trimmed)) {
        contentLines.push(trimmed);
        i++;
        continue;
      }

      // Check if current line is a chord line
      if (isChordLine(currentLine)) {
        const nextLine = (i + 1 < rawLines.length) ? rawLines[i + 1] : null;
        const nextTrimmed = nextLine ? nextLine.trim() : '';

        // If next line exists, is non-empty, and is NOT another chord line, section header, or annotation:
        if (
          nextLine !== null &&
          nextTrimmed !== '' &&
          !isChordLine(nextLine) &&
          !SECTION_HEADER_REGEX.test(nextTrimmed) &&
          !BRACKETED_SECTION_REGEX.test(nextTrimmed) &&
          !/^\s*\(.*?\)\s*$/.test(nextTrimmed)
        ) {
          // Project chords into the lyric line below
          const tokens = tokenizeLine(currentLine).filter(t => t.isChord);
          // Insert in descending order of column index
          tokens.sort((a, b) => b.index - a.index);

          let combined = nextLine;
          for (const t of tokens) {
            const chordBracket = '[' + t.text + ']';
            if (t.index >= combined.length) {
              const padding = ' '.repeat(t.index - combined.length);
              combined = combined + padding + chordBracket;
            } else {
              combined = combined.slice(0, t.index) + chordBracket + combined.slice(t.index);
            }
          }
          contentLines.push(combined);
          i += 2; // Consumed both chord line and lyric line
          continue;
        } else {
          // Instrumental progression line without lyrics (e.g. Intro progression or solo)
          const tokens = tokenizeLine(currentLine);
          const formattedParts = tokens.map(t => {
            if (t.isChord) return '[' + t.text + ']';
            return t.text;
          });
          contentLines.push(formattedParts.join(' '));
          i++;
          continue;
        }
      }

      // Ordinary lyric line without chords
      contentLines.push(currentLine);
      i++;
    }
  }

  const finalContent = contentLines.join('\n').trim();

  // If title was not extracted from metadata, attempt derivation from first non-empty line
  if (!title) {
    for (const line of contentLines) {
      const clean = line.replace(/\[.*?\]/g, '').trim();
      if (clean && !SECTION_HEADER_REGEX.test(clean) && !/^\(.*?\)$/.test(clean)) {
        title = clean.slice(0, 80);
        break;
      }
    }
  }
  if (!title) {
    title = 'Cifra Importada';
  }

  // If original key was not extracted, try to deduce from the first valid chord
  if (!originalKey) {
    const firstChordMatch = finalContent.match(/\[([A-G][#b]?(?:m|maj|min)?)[^\]]*\]/);
    if (firstChordMatch) {
      originalKey = firstChordMatch[1];
    } else {
      warnings.push({
        code: 'MISSING_ORIGINAL_KEY',
        message: 'Tom original não identificado automaticamente no texto.',
      });
    }
  }

  return {
    title,
    artist_name: artistName,
    original_key: originalKey,
    content: finalContent,
    warnings,
    source_type: 'text',
  };
}
