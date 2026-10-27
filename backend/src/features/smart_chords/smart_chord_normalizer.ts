import { SmartChordImportDraft, ImportWarning } from './smart_chord_import.types';

export const ROOT_REGEX = /^([A-G][#b]?)(.*)$/i;
export const EXT_REGEX = /^(m|min|maj|M|dim|aug|sus[24]?|add[249]?|[0-9]+|\+|\-|\((b5|#5|b9|#9|9|11|#11|13|b13|5-|5\+)\)|b5|#5|b9|#9|b13|#11|alt|7M|M7)*$/;

export const SECTION_HEADER_REGEX = /^(Intro|Introdução|Introducao|Verso|Pré-refrão|Pre-refrao|Refrão|Refrao|Coro|Ponte|Solo|Interlúdio|Interludio|Instrumental|Final|Coda|Tag)(\s+\d+)?[:\s]*$/i;
export const BRACKETED_SECTION_REGEX = /^\[(Intro|Introdução|Introducao|Verso|Pré-refrão|Pre-refrao|Refrão|Refrao|Coro|Ponte|Solo|Interlúdio|Interludio|Instrumental|Final|Coda|Tag)(\s+\d+)?\]$/i;

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
  const rawTrimmed = token.trim();
  const wrapped = rawTrimmed.match(/^\(([^()]*)\)$/);
  const trimmed = wrapped ? wrapped[1].trim() : rawTrimmed;
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

  const wrappedChord = chord.match(/^\(([^()]*)\)$/);
  if (wrappedChord && isMusicalChord(wrappedChord[1])) {
    return '(' + transposeChordSafe(wrappedChord[1], semitones) + ')';
  }

  if (chord.includes('|') || chord.includes('%')) {
    return chord.replace(/\([^()]*\)|([A-G][#b]?(?:[^\s|%:]*))/g, (match) => {
      if (isMusicalChord(match)) {
        return transposeChordSafe(match, semitones);
      }
      return match;
    });
  }

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
  // Zero-width spaces are emitted by some PDF/text exporters as visual chord
  // separators. Treat them as whitespace without changing their column width.
  const tokenizableLine = line.replace(/\u200B/g, ' ');
  const regex = /\([^()]*\)|\[[^[\]]*\]|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tokenizableLine)) !== null) {
    const parenthetical = match[0].match(/^\(([^()]*)\)$/);
    const text = parenthetical && isMusicalChord(parenthetical[1]) ? parenthetical[1] : match[0];
    tokens.push({
      text,
      index: match.index + (parenthetical && text !== match[0] ? 1 : 0),
      isChord: isMusicalChord(text),
    });
  }
  return tokens;
}

/**
 * Maps chord columns to lyric word boundaries. A chord inside a word
 * is conservatively moved to that word's beginning. Multiple chords mapping
 * to the same boundary are ambiguous and should remain on their own row.
 */
function projectChordLine(chordLine: string, lyricLine: string): string | null {
  const chordTokens = tokenizeLine(chordLine.replace(/\u200B/g, ' ')).filter(t => t.isChord);
  if (chordTokens.length === 0) return null;

  const boundaries: Array<{ start: number; end: number }> = [];
  const wordPattern = /[^\s]+/g;
  let word: RegExpExecArray | null;
  while ((word = wordPattern.exec(lyricLine)) !== null) {
    // Invisible website formatting is not evidence of a musical syllable boundary.
    boundaries.push({ start: word.index, end: word.index + word[0].length });
  }

  const mapped = chordTokens.map(token => {
    if (token.index > lyricLine.length) return null;
    if (token.index === lyricLine.length) return lyricLine.length;
    const containingWord = boundaries.find(boundary => token.index >= boundary.start && token.index < boundary.end);
    if (containingWord) return containingWord.start;
    return boundaries.find(boundary => token.index < boundary.start)?.start ?? null;
  });

  if (mapped.some(index => index === null)) return null;
  if (new Set(mapped).size !== mapped.length) return null;

  let projected = lyricLine;
  for (let index = chordTokens.length - 1; index >= 0; index--) {
    const position = mapped[index]!;
    projected = projected.slice(0, position) + `[${chordTokens[index].text}]` + projected.slice(position);
  }
  return projected;
}

export function isChordLine(line: string): boolean {
  if (!line || !line.trim()) return false;
  // If line contains section header, it's not a pure chord line
  if (SECTION_HEADER_REGEX.test(line.trim()) || BRACKETED_SECTION_REGEX.test(line.trim())) {
    return false;
  }
  // If line is a single parenthesized annotation, it's an annotation line, not a chord line
  if (/^\s*\([^()]*\)\s*$/.test(line.trim()) &&
      !isMusicalChord(line.trim().slice(1, -1))) {
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
    if (t.isChord || ['|', '||', '||:', ':||', '|:', '%', '/'].includes(t.text)) {
      chordCount++;
    }
  }

  if (nonAnnotationCount === 0) return false;
  return (chordCount / nonAnnotationCount) >= 0.6;
}

/** Recognize a whole musical line, never chord-bearing lyrics. No tokens are discarded. */
export function normalizeInstrumentalProgression(line: string): string | null {
  // Keep the separate chord row emitted by an uncertain projection stable.
  const chordTags = [...line.matchAll(/\[([^\]]+)\]/g)];
  if (chordTags.length >= 2 && chordTags.every(tag => isMusicalChord(tag[1])) &&
      !line.replace(/\[[^\]]+\]/g, '').trim()) return line;
  const label = line.match(/^(\s*(?:Intro|Introdução|Introducao|Verso|Pré-refrão|Pre-refrao|Refrão|Refrao|Coro|Ponte|Solo|Interlúdio|Interludio|Instrumental|Final|Coda|Tag)(?:\s+\d+)?\s*:\s*)/i) ||
    line.match(/^(\s*\[(?:Intro|Introdução|Introducao|Verso|Pré-refrão|Pre-refrao|Refrão|Refrao|Coro|Ponte|Solo|Interlúdio|Interludio|Instrumental|Final|Coda|Tag)(?:\s+\d+)?\]\s*)/i);
  let prefix = label?.[1] || '';
  let body = line.slice(prefix.length).trim();
  // Leading performance instructions belong with the label, outside the block.
  while (/^\([^()]*\)\s*/.test(body)) {
    const annotation = body.match(/^\([^()]*\)\s*/)!;
    prefix += annotation[0];
    body = body.slice(annotation[0].length);
  }
  let chordCount = 0;
  let structural = false;
  let bracketed = false;
  const validate = (value: string): boolean => {
    const tokens = value.match(/\([^()]*\)|\|\|:|:\|\||\|:|:\||\|\||[|%]|[^\s|%]+/g) || [];
    return tokens.length > 0 && tokens.every(token => {
      if (/^\([^()]*\)$/.test(token)) return true;
      if (/^(?:\|\|:|:\|\||\|:|:\||\|\||[|%])$/.test(token)) { structural = true; return true; }
      // A slash by itself separates chords; an embedded slash remains part of
      // a validated slash chord such as F/A or D/F#.
      if (token === '/') { structural = true; return true; }
      if (isMusicalChord(token)) { chordCount++; return true; }
      return false;
    });
  };
  // Validate each bracketed group and each outside segment before flattening.
  for (const group of body.matchAll(/\[[^[\]]*\]/g)) {
    const before = body[group.index! - 1];
    const after = body[group.index! + group[0].length];
    // Attached text is syllabic notation, even when a lyric is also a note name.
    if ((before && !/[\s|%:\]]/.test(before)) || (after && !/[\s|%:\[]/.test(after))) return null;
  }
  const pieces = body.match(/\[[^[\]]*\]|[^\[\]]+/g) || [];
  if (pieces.join('') !== body) return null; // unmatched/nested brackets
  let flattened = '';
  for (const piece of pieces) {
    if (!piece.trim()) { flattened += piece; continue; }
    const group = piece.startsWith('[');
    const inner = group ? piece.slice(1, -1).trim() : piece;
    if (!validate(inner)) return null;
    bracketed ||= group;
    if (/\S$/.test(flattened) && /^\S/.test(inner)) flattened += ' ';
    flattened += inner;
  }
  if (!structural && !(chordCount >= 1 && label) && !(chordCount >= 2 && bracketed)) return null;
  if (!chordCount && !structural) return null;
  return prefix + '[ ' + flattened.trim() + ' ]';
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
      original_text: rawText,
    };
  }

  const normalizedEol = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalizedEol.split('\n');

  let title = '';
  let artistName: string | null = null;
  let originalKey: string | null = null;
  const explicitTomOriginal: string[] = [];
  const explicitTom: string[] = [];
  const explicitKey: string[] = [];
  const explicitDisplayedKey: string[] = [];
  let capo: number | null = null;

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

    const displayedKeyMatch = trimmed.match(/^(?:Tom\s+(?:atual|cifrado|transposto)|Displayed\s+Key|Current\s+Key):\s*([A-G][#b]?(?:m|maj|min)?)\s*$/i);
    if (displayedKeyMatch) {
      explicitDisplayedKey.push(displayedKeyMatch[1].trim());
      i++;
      continue;
    }

    const originalTomMatch = trimmed.match(/^(?:Tom\s+Original|Original\s+Key):\s*([A-G][#b]?(?:m|maj|min)?)\s*$/i);
    if (originalTomMatch) {
      explicitTomOriginal.push(originalTomMatch[1].trim());
      i++;
      continue;
    }

    const tomMatch = trimmed.match(/^Tom:\s*([A-G][#b]?(?:m|maj|min)?)\s*$/i);
    if (tomMatch) {
      explicitTom.push(tomMatch[1].trim());
      i++;
      continue;
    }

    const keyMatch = trimmed.match(/^Key:\s*([A-G][#b]?(?:m|maj|min)?)\s*$/i);
    if (keyMatch) {
      explicitKey.push(keyMatch[1].trim());
      i++;
      continue;
    }

    const capoMatch = trimmed.match(/^(?:Capo|Capotraste):\s*(\d{1,2})\s*$/i);
    if (capoMatch && Number(capoMatch[1]) <= 24) {
      capo = Number(capoMatch[1]);
      i++;
      continue;
    }

    break;
  }

  const selectedKeyValues = explicitTomOriginal.length ? explicitTomOriginal :
    explicitTom.length ? explicitTom : explicitKey;
  const normalizedSelectedKeys = new Set(selectedKeyValues.map((key) => key.toLocaleLowerCase('en-US')));
  const originalKeyAmbiguous = normalizedSelectedKeys.size > 1;
  originalKey = originalKeyAmbiguous ? null : selectedKeyValues[0] ?? null;
  const displayedKeyValues = explicitDisplayedKey.length ? explicitDisplayedKey :
    explicitTomOriginal.length ? explicitTom : [];
  const normalizedDisplayedKeys = new Set(displayedKeyValues.map((key) => key.toLocaleLowerCase('en-US')));
  const displayedKeyAmbiguous = normalizedDisplayedKeys.size > 1;
  const displayedKey = displayedKeyAmbiguous ? null : displayedKeyValues[0] ?? null;
  if (originalKeyAmbiguous || displayedKeyAmbiguous) {
    warnings.push({
      code: 'METADATA_AMBIGUOUS',
      message: 'Metadados de tom conflitantes; revise a cifra antes de salvar.',
    });
  }

  // Canonicalize each independently authored musical line before the inline-chord fast path.
  for (let lineIdx = i; lineIdx < rawLines.length; lineIdx++) {
    // Share/import sources may prefix every visual line with an invisible
    // marker; it must not hide section labels from progression recognition.
    const progression = normalizeInstrumentalProgression(rawLines[lineIdx].replace(/^\u200B+/, ''));
    if (progression !== null) {
      rawLines[lineIdx] = progression;
      if (/\|\|:|:\|\||%/.test(progression) && rawLines[lineIdx + 1]?.trim()) {
        warnings.push({ code: 'REPEAT_STRUCTURE_AMBIGUOUS', line: lineIdx + 1,
          message: 'Progressão preservada separadamente da letra. Revise as repetições.' });
      }
    }
  }

  // Process two-line chord-over-lyric and progression layout
  while (i < rawLines.length) {
    const currentLine = rawLines[i];
    const trimmed = currentLine.trim();

    if (!trimmed) {
      contentLines.push('');
      i++;
      continue;
    }

    // An attached syllable belongs to existing chord-over-lyrics syntax.
    if ([...currentLine.matchAll(/\[([^\]]+)\]/g)].some(tag => isMusicalChord(tag[1])) ||
        /\[[^\]]+\][^\s|%:\[\]]/.test(currentLine)) {
      contentLines.push(currentLine);
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
    if (/^\s*\(.*?\)\s*$/.test(trimmed) &&
        !isMusicalChord(trimmed.slice(1, -1))) {
      contentLines.push(trimmed);
      i++;
      continue;
    }

    // Ambiguous annotated/structural lines stay separate from the following lyrics.
    // Only wrap known chords; preserve every other token and its original spacing.
    const lineTokens = tokenizeLine(currentLine);
    const hasKnownChord = lineTokens.some(t => t.isChord);
    const hasStructure = lineTokens.some(t => ['|', '||', '||:', ':||', '|:', '%', '/'].includes(t.text));
    const hasAnnotation = lineTokens.some(t => /^\([^()]*\)$/.test(t.text));
    const hasMalformedAnnotation = /[()]/.test(currentLine) &&
      lineTokens.some(t => !t.isChord && !/^\([^()]*\)$/.test(t.text) && /[()]/.test(t.text));
    if ((hasKnownChord || hasStructure) && (isChordLine(currentLine) || hasMalformedAnnotation) &&
        (hasStructure || hasAnnotation || hasMalformedAnnotation || lineTokens.some(t => !t.isChord))) {
      const unknown = lineTokens.filter(t => !t.isChord &&
        !['|', '||', '||:', ':||', '|:', '%', '/'].includes(t.text) &&
        !/^\([^()]*\)$/.test(t.text) && !/^\[[^[\]]*\]$/.test(t.text));
      const code = hasMalformedAnnotation ? 'UNSUPPORTED_LAYOUT' :
        unknown.length ? 'UNKNOWN_CHORD_TOKEN' :
        hasStructure ? 'REPEAT_STRUCTURE_AMBIGUOUS' : 'CHORD_ALIGNMENT_UNCERTAIN';
      warnings.push({ code, line: i + 1,
        message: 'Linha musical preservada separadamente da letra. Revise o alinhamento e as marcações.' });
      let preserved = currentLine;
      for (const token of [...lineTokens].reverse()) {
        if (token.isChord) {
          preserved = preserved.slice(0, token.index) + '[' + token.text + ']' +
            preserved.slice(token.index + token.text.length);
        }
      }
      // A complete bar run uses the existing bracketed progression format.
      if (hasStructure && !hasAnnotation && !unknown.length) preserved = '[' + currentLine + ']';
      contentLines.push(preserved);
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
        // Keep chords at word/syllable boundaries; never inject one in the
        // middle of a lyric word just because the source columns drifted.
        const projected = projectChordLine(currentLine, nextLine);
        if (projected === null) {
          warnings.push({ code: 'CHORD_ALIGNMENT_UNCERTAIN', line: i + 1,
            message: 'Acordes mantidos em linha separada porque o alinhamento com as palavras ficou ambíguo. Revise a cifra.' });
          let preserved = currentLine.replace(/\u200B/g, ' ');
          for (const token of tokenizeLine(preserved).filter(t => t.isChord).reverse()) {
            preserved = preserved.slice(0, token.index) + `[${token.text}]` + preserved.slice(token.index + token.text.length);
          }
          contentLines.push(preserved);
          i++;
        } else {
          contentLines.push(projected);
          i += 2; // Consumed both chord and lyric lines
        }
        continue;
      } else {
        // Instrumental progression line without lyrics (e.g. Intro progression or solo)
        const tokens = tokenizeLine(currentLine);
        const hasBarlines = tokens.some(t => ['|', '||', '||:', ':||', '%'].includes(t.text));

        if (!hasBarlines) {
          const formattedParts = tokens.map(t => {
            if (t.isChord) return '[' + t.text + ']';
            return t.text;
          });
          contentLines.push(formattedParts.join(' '));
        } else {
          // Group bar structure into bracketed bar markup [| ... |]
          const resultParts: string[] = [];
          let currentBarRun: string[] = [];

          const flushBarRun = () => {
            if (currentBarRun.length > 0) {
              resultParts.push('[' + currentBarRun.join(' ') + ']');
              currentBarRun = [];
            }
          };

          for (const t of tokens) {
            const isBar = ['|', '||', '||:', ':||', '%'].includes(t.text);
            const isAnnot = /^\(.*?\)$/.test(t.text) || /^\[.*?\]$/.test(t.text);
            const isSec = SECTION_HEADER_REGEX.test(t.text) || /^(Intro|Solo|Verso|Refrão|Refrao|Coro|Ponte|Pausa|Interlúdio|Interludio|Final)[:\s]*$/i.test(t.text);

            if (isAnnot || isSec) {
              flushBarRun();
              resultParts.push(t.text);
            } else if (isBar || t.isChord) {
              currentBarRun.push(t.text);
            } else {
              currentBarRun.push(t.text);
            }
          }

          flushBarRun();
          contentLines.push(resultParts.join(' '));
        }
        i++;
        continue;
      }
    }

    // Ordinary lyric line without chords
    contentLines.push(currentLine);
    i++;
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

  // Chord presence does not establish the original key. Only explicit source
  // metadata is authoritative; otherwise leave the key unknown.
  if (!originalKey) {
    warnings.push({
      code: 'MISSING_ORIGINAL_KEY',
      message: 'Tom original não identificado automaticamente no texto.',
    });
  }

  return {
    title,
    artist_name: artistName,
    original_key: originalKey,
    content: finalContent,
    warnings,
    source_type: 'text',
    original_text: rawText,
    ...(displayedKey ? { displayed_key: displayedKey } : {}),
    ...(capo !== null ? { capo } : {}),
  };
}
