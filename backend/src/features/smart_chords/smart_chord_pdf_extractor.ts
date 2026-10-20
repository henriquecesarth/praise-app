import { extractTextItems } from 'unpdf';
import { AppError } from '../../middleware/error-handler';
import { SmartChordImportDraft, ImportWarning } from './smart_chord_import.types';
import {
  isMusicalChord,
  isChordLine,
  SECTION_HEADER_REGEX,
  BRACKETED_SECTION_REGEX,
} from './smart_chord_normalizer';

export const MAX_PDF_FILE_SIZE = 3 * 1024 * 1024; // 3 MiB
export const MAX_PDF_PAGES = 10;

interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

interface VisualPdfLine {
  y: number;
  items: ExtractedTextItem[];
  column: number;
}

function splitTextItemIntoTokens(item: ExtractedTextItem): ExtractedTextItem[] {
  const tokens: ExtractedTextItem[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  const totalChars = item.text.length;
  const charWidth = totalChars > 0 ? (item.width / totalChars) : 0;

  while ((match = regex.exec(item.text)) !== null) {
    const tokenText = match[0];
    const tokenStart = match.index;
    tokens.push({
      text: tokenText,
      x: item.x + tokenStart * charWidth,
      y: item.y,
      width: tokenText.length * charWidth,
      height: item.height,
      page: item.page,
    });
  }
  return tokens;
}

/**
 * Dynamically detects vertical whitespace gutters between columns (1, 2, 3+ columns)
 * without arbitrary fixed X coordinates.
 */
function detectColumnBuckets(pageItems: ExtractedTextItem[]): ExtractedTextItem[][] {
  if (pageItems.length < 6) return [pageItems];

  const minX = Math.min(...pageItems.map(i => i.x));
  const maxX = Math.max(...pageItems.map(i => i.x + i.width));
  if (maxX - minX < 180) return [pageItems];

  // Disregard single-line full-width headers at top 40pt of page when finding vertical gutters
  const maxY = Math.max(...pageItems.map(i => i.y));
  const bodyItems = pageItems.filter(i => (maxY - i.y) > 40);
  if (bodyItems.length < 6) return [pageItems];

  // Find candidate vertical gutters (empty X-spans of at least 15pt where no body item sits)
  const gutterPoints: number[] = [];
  let inGutter = false;
  let gutterStart = 0;

  for (let x = Math.floor(minX + 30); x <= Math.ceil(maxX - 30); x += 2) {
    const hasOverlap = bodyItems.some(i => i.x <= x && (i.x + i.width) >= x);
    if (!hasOverlap) {
      if (!inGutter) {
        inGutter = true;
        gutterStart = x;
      }
    } else {
      if (inGutter) {
        inGutter = false;
        const gutterWidth = x - gutterStart;
        if (gutterWidth >= 15) {
          const midPoint = gutterStart + gutterWidth / 2;
          gutterPoints.push(midPoint);
        }
      }
    }
  }

  // Filter gutters that have substantial body items on both sides and Y overlap
  const validGutters: number[] = [];
  for (const gp of gutterPoints) {
    const left = bodyItems.filter(i => (i.x + i.width) <= gp);
    const right = bodyItems.filter(i => i.x >= gp);
    if (left.length >= 3 && right.length >= 3) {
      const leftYMin = Math.min(...left.map(i => i.y));
      const leftYMax = Math.max(...left.map(i => i.y));
      const rightYMin = Math.min(...right.map(i => i.y));
      const rightYMax = Math.max(...right.map(i => i.y));
      const overlap = Math.min(leftYMax, rightYMax) - Math.max(leftYMin, rightYMin);
      if (overlap > 25) {
        validGutters.push(gp);
      }
    }
  }

  if (validGutters.length === 0) {
    return [pageItems];
  }

  // Consolidate gutters that are too close (< 50pt apart)
  const consolidatedGutters: number[] = [];
  for (const g of validGutters) {
    if (consolidatedGutters.length === 0 || g - consolidatedGutters[consolidatedGutters.length - 1] >= 50) {
      consolidatedGutters.push(g);
    }
  }

  // Divide all page items into columns based on consolidated gutters
  const columns: ExtractedTextItem[][] = [];
  for (let c = 0; c <= consolidatedGutters.length; c++) {
    columns.push([]);
  }

  for (const item of pageItems) {
    const itemCenter = item.x + item.width / 2;
    let colIdx = 0;
    while (colIdx < consolidatedGutters.length && itemCenter > consolidatedGutters[colIdx]) {
      colIdx++;
    }
    columns[colIdx].push(item);
  }

  return columns.filter(col => col.length > 0);
}

export function isRepeatProgressionLine(line: string): boolean {
  if (!line || !line.trim()) return false;
  return /\|\|:|:\|\||%/.test(line) || (line.includes('|') && line.split('|').length >= 3);
}

interface ProjectedLyricResult {
  projected: string;
  hasUncertainAlignment: boolean;
}

function projectChordsOntoLyrics(
  chordItems: ExtractedTextItem[],
  nonChordItems: ExtractedTextItem[],
  lyricVLine: VisualPdfLine
): ProjectedLyricResult {
  let lyricString = '';
  const charPositions: { char: string; x: number; width: number }[] = [];

  for (let itemIdx = 0; itemIdx < lyricVLine.items.length; itemIdx++) {
    const lItem = lyricVLine.items[itemIdx];
    if (itemIdx > 0) {
      const prevItem = lyricVLine.items[itemIdx - 1];
      const spaceGap = lItem.x - (prevItem.x + prevItem.width);
      if (spaceGap > 2) {
        lyricString += ' ';
        charPositions.push({ char: ' ', x: prevItem.x + prevItem.width, width: spaceGap });
      }
    }
    const itemCharWidth = lItem.text.length > 0 ? lItem.width / lItem.text.length : 0;
    for (let c = 0; c < lItem.text.length; c++) {
      charPositions.push({
        char: lItem.text[c],
        x: lItem.x + c * itemCharWidth,
        width: itemCharWidth,
      });
      lyricString += lItem.text[c];
    }
  }

  // Find word boundaries
  const words: { startIdx: number; endIdx: number; startX: number; endX: number; text: string }[] = [];
  let inWord = false;
  let wordStart = 0;
  for (let i = 0; i < charPositions.length; i++) {
    if (charPositions[i].char !== ' ') {
      if (!inWord) {
        inWord = true;
        wordStart = i;
      }
    } else {
      if (inWord) {
        inWord = false;
        words.push({
          startIdx: wordStart,
          endIdx: i,
          startX: charPositions[wordStart].x,
          endX: charPositions[i - 1].x + charPositions[i - 1].width,
          text: lyricString.slice(wordStart, i),
        });
      }
    }
  }
  if (inWord && charPositions.length > 0) {
    words.push({
      startIdx: wordStart,
      endIdx: charPositions.length,
      startX: charPositions[wordStart].x,
      endX: charPositions[charPositions.length - 1].x + charPositions[charPositions.length - 1].width,
      text: lyricString.slice(wordStart),
    });
  }

  // Sort chords descending by X so insertions do not shift indices
  const sortedChords = [...chordItems].sort((a, b) => b.x - a.x);
  let projected = lyricString;
  let hasUncertainAlignment = false;

  for (const cItem of sortedChords) {
    const chordText = cItem.text.trim();
    const chordX = cItem.x;
    const chordBracket = '[' + chordText + ']';

    const lastPos = charPositions[charPositions.length - 1];
    if (lastPos && chordX > lastPos.x + lastPos.width + 15) {
      projected += ' ' + chordBracket;
      continue;
    }

    let targetIndex = -1;

    // Check if chord is positioned before the first word
    if (words.length > 0 && chordX <= words[0].startX + 10) {
      targetIndex = words[0].startIdx;
    } else {
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const w = words[wIdx];
        const nextW = words[wIdx + 1];
        const wordWidth = w.endX - w.startX;

        // Near start of word (up to 45% of word width or within 18pt)
        if (chordX >= w.startX - 15 && chordX <= w.startX + Math.max(12, wordWidth * 0.45)) {
          targetIndex = w.startIdx;
          break;
        }

        // In gap between words
        if (nextW && chordX > w.endX && chordX < nextW.startX) {
          const distToNext = nextW.startX - chordX;
          const distToPrev = chordX - w.endX;
          if (distToNext <= distToPrev + 5) {
            targetIndex = nextW.startIdx;
          } else {
            targetIndex = w.endIdx;
          }
          break;
        }

        // Intentionally inside word (later syllable)
        if (chordX > w.startX + Math.max(12, wordWidth * 0.45) && chordX <= w.endX) {
          let bestInside = w.startIdx;
          let minDiff = 999999;
          for (let i = w.startIdx; i < w.endIdx; i++) {
            const diff = Math.abs(charPositions[i].x - chordX);
            if (diff < minDiff) {
              minDiff = diff;
              bestInside = i;
            }
          }
          targetIndex = bestInside;
          hasUncertainAlignment = true;
          break;
        }
      }
    }

    if (targetIndex === -1) {
      let minDiff = 999999;
      targetIndex = 0;
      for (let i = 0; i < charPositions.length; i++) {
        const diff = Math.abs(charPositions[i].x - chordX);
        if (diff < minDiff) {
          minDiff = diff;
          targetIndex = i;
        }
      }
      hasUncertainAlignment = true;
    }

    projected = projected.slice(0, targetIndex) + chordBracket + projected.slice(targetIndex);
  }

  // Preserve non-chord annotations from the chord line
  if (nonChordItems.length > 0) {
    const annotations = nonChordItems
      .map(i => i.text.trim())
      .filter(t => t && !['|', '||:', ':||', '%'].includes(t));
    if (annotations.length > 0) {
      projected += ' ' + annotations.join(' ');
    }
  }

  return { projected, hasUncertainAlignment };
}

/**
 * Extracts and reconstructs musical SmartChordDraft from a text-based digital PDF.
 */
export async function extractSmartChordDraftFromPdf(buffer: Buffer): Promise<SmartChordImportDraft> {
  const warnings: ImportWarning[] = [];

  // 1. Enforce size limit
  if (buffer.length > MAX_PDF_FILE_SIZE) {
    throw new AppError(400, 'Arquivo PDF excede o limite máximo permitido de 3 MB.');
  }

  // 2. Validate PDF signature (%PDF-)
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new AppError(400, 'Arquivo inválido. O arquivo fornecido não é um PDF válido.');
  }

  let pdfResult: { totalPages: number; items: any[][] };
  try {
    pdfResult = await extractTextItems(new Uint8Array(buffer));
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('Password') || msg.includes('encrypted')) {
      throw new AppError(400, 'PDF protegido por senha não é suportado.');
    }
    throw new AppError(400, 'Não foi possível ler o arquivo PDF. Arquivo corrompido ou malformado.');
  }

  // 3. Enforce page count limit
  if (pdfResult.totalPages > MAX_PDF_PAGES) {
    throw new AppError(400, `O PDF possui ${pdfResult.totalPages} páginas (máximo permitido: ${MAX_PDF_PAGES}).`);
  }

  // 4. Extract text items with layout coordinates and split into tokens
  const allItems: ExtractedTextItem[] = [];

  for (let pageIdx = 0; pageIdx < pdfResult.totalPages; pageIdx++) {
    const pageItems = pdfResult.items[pageIdx] || [];
    for (const item of pageItems) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const baseItem: ExtractedTextItem = {
        text: item.str,
        x: item.x,
        y: item.y,
        width: item.width || 0,
        height: item.height || 12,
        page: pageIdx + 1,
      };
      const subTokens = splitTextItemIntoTokens(baseItem);
      for (const st of subTokens) {
        allItems.push(st);
      }
    }
  }

  // 5. Scanned PDF Detection (No selectable text)
  if (allItems.length < 3) {
    return {
      title: 'PDF Escaneado / Sem Texto',
      artist_name: null,
      original_key: null,
      content: '',
      warnings: [
        {
          code: 'POSSIBLE_SCANNED_PDF',
          message: 'Nenhum texto selecionável foi encontrado no PDF. O arquivo pode ser uma imagem escaneada, que não é suportada nesta fase.',
        },
      ],
      source_type: 'pdf',
    };
  }

  // 6. Multi-page layout reconstruction
  let title = '';
  let artistName: string | null = null;
  let originalKey: string | null = null;
  const reconstructedLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdfResult.totalPages; pageNum++) {
    const pageItems = allItems.filter(item => item.page === pageNum);
    if (pageItems.length === 0) continue;

    // Dynamically detect column buckets (1, 2, 3+ columns)
    const columnBuckets = detectColumnBuckets(pageItems);

    for (let colIdx = 0; colIdx < columnBuckets.length; colIdx++) {
      const itemsInCol = columnBuckets[colIdx];
      // Group items into lines where |y1 - y2| < 4pt
      const visualLines: VisualPdfLine[] = [];

      for (const item of itemsInCol) {
        let line = visualLines.find(l => Math.abs(l.y - item.y) < 4);
        if (!line) {
          line = { y: item.y, items: [], column: colIdx };
          visualLines.push(line);
        }
        line.items.push(item);
      }

      // Sort lines top-to-bottom (Y descending in PDF coordinate space)
      visualLines.sort((a, b) => b.y - a.y);
      for (const l of visualLines) {
        l.items.sort((a, b) => a.x - b.x);
      }

      let lineIdx = 0;
      while (lineIdx < visualLines.length) {
        const vLine = visualLines[lineIdx];
        const lineText = vLine.items.map(i => i.text).join(' ').trim();

        if (!lineText) {
          lineIdx++;
          continue;
        }

        // Header metadata check on first page top lines
        if (pageNum === 1 && lineIdx < 6) {
          const titleMatch = lineText.match(/^(?:Título|Titulo|Title):\s*(.+)$/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
            lineIdx++;
            continue;
          }

          const artistMatch = lineText.match(/^(?:Artista|Artist|Banda):\s*(.+)$/i);
          if (artistMatch) {
            artistName = artistMatch[1].trim();
            lineIdx++;
            continue;
          }

          const keyMatch = lineText.match(/^(?:Tom|Key|Tom\s+Original):\s*([A-G][#b]?(?:m|maj|min)?)\s*$/i);
          if (keyMatch) {
            originalKey = keyMatch[1].trim();
            lineIdx++;
            continue;
          }

          // In standard single-line header (e.g. Certeza (Canção de Jó) – Héber Bragança)
          if (!title && lineIdx === 0 && !isChordLine(lineText) && !SECTION_HEADER_REGEX.test(lineText)) {
            // Check for title - artist separator like "Title – Artist", "Title — Artist", "Title - Artist"
            // Requires spaces around the dash to avoid splitting hyphenated words
            const splitMatch = lineText.match(/^(.+?)\s+([–—-]|by|por)\s+(.+)$/i);
            if (splitMatch) {
              title = splitMatch[1].trim();
              artistName = splitMatch[3].trim();
            } else {
              title = lineText.trim();
            }
            lineIdx++;
            continue;
          }

          if (title && !artistName && lineIdx === 1 && !isChordLine(lineText) && !SECTION_HEADER_REGEX.test(lineText)) {
            // Only treat line 1 as artist if it's NOT a parenthesized annotation and NOT a repeat/progression structure
            if (!/^\s*\(.*?\)\s*$/.test(lineText) && !isRepeatProgressionLine(lineText)) {
              artistName = lineText.trim();
              lineIdx++;
              continue;
            }
          }
        }

        // Check for section header
        if (SECTION_HEADER_REGEX.test(lineText)) {
          reconstructedLines.push('[' + lineText.replace(/[:\s]+$/, '') + ']');
          lineIdx++;
          continue;
        }
        if (BRACKETED_SECTION_REGEX.test(lineText)) {
          reconstructedLines.push(lineText);
          lineIdx++;
          continue;
        }

        // Check for parenthetical annotation e.g. (violão/pad) or (todos)
        if (/^\s*\(.*?\)\s*$/.test(lineText)) {
          reconstructedLines.push(lineText);
          lineIdx++;
          continue;
        }

        // Check if current line is a chord line
        if (isChordLine(lineText)) {
          const isProgression = isRepeatProgressionLine(lineText);
          const nextVLine = (lineIdx + 1 < visualLines.length) ? visualLines[lineIdx + 1] : null;
          const nextLineText = nextVLine ? nextVLine.items.map(i => i.text).join(' ').trim() : '';
          const yDiff = nextVLine ? Math.abs(vLine.y - nextVLine.y) : 999;

          // If it's NOT a repeat progression, and next line is physically close (< 35pt) and is a lyric line
          if (
            !isProgression &&
            nextVLine &&
            yDiff < 35 &&
            nextLineText &&
            !isChordLine(nextLineText) &&
            !SECTION_HEADER_REGEX.test(nextLineText) &&
            !BRACKETED_SECTION_REGEX.test(nextLineText) &&
            !/^\s*\(.*?\)\s*$/.test(nextLineText)
          ) {
            const chordItems = vLine.items.filter(i => isMusicalChord(i.text.trim()));
            const nonChordItems = vLine.items.filter(i => !isMusicalChord(i.text.trim()));

            const { projected, hasUncertainAlignment } = projectChordsOntoLyrics(chordItems, nonChordItems, nextVLine);
            if (hasUncertainAlignment && !warnings.some(w => w.code === 'CHORD_ALIGNMENT_UNCERTAIN')) {
              warnings.push({
                code: 'CHORD_ALIGNMENT_UNCERTAIN',
                message: 'Alinhamento de acordes em linha com divisão intra-palavra pode requerer ajuste manual.',
              });
            }
            reconstructedLines.push(projected);
            lineIdx += 2; // Consumed both chord and lyric lines
            continue;
          } else {
            // Progression or instrumental line (including repeat blocks like ||: A9 | A7M/9 | D9 | % :||)
            if (isProgression && nextVLine && yDiff < 35 && !isChordLine(nextLineText) && !warnings.some(w => w.code === 'REPEAT_STRUCTURE_AMBIGUOUS')) {
              warnings.push({
                code: 'REPEAT_STRUCTURE_AMBIGUOUS',
                message: 'Progressão com repetição mantida em linha separada para preservar compassos e símbolos de repetição.',
              });
            }
            const formattedParts = vLine.items.map(item => {
              const t = item.text.trim();
              if (isMusicalChord(t)) return '[' + t + ']';
              return t;
            });
            reconstructedLines.push(formattedParts.join(' '));
            lineIdx++;
            continue;
          }
        }

        // Plain lyric line
        reconstructedLines.push(lineText);
        lineIdx++;
      }
    }
  }

  const finalContent = reconstructedLines.join('\n').trim();

  if (!title) {
    title = 'Cifra Importada (PDF)';
  }

  if (!originalKey) {
    const firstChordMatch = finalContent.match(/\[([A-G][#b]?(?:m|maj|min)?)[^\]]*\]/);
    if (firstChordMatch) {
      originalKey = firstChordMatch[1];
    } else {
      warnings.push({
        code: 'MISSING_ORIGINAL_KEY',
        message: 'Tom original não identificado automaticamente no PDF.',
      });
    }
  }

  return {
    title,
    artist_name: artistName,
    original_key: originalKey,
    content: finalContent,
    warnings,
    source_type: 'pdf',
  };
}
