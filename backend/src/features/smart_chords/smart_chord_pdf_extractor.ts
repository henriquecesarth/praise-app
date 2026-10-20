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
  const regex = /\([^()]*\)|\[[^[\]]*\]|\S+/g;
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

function consolidateVisualLineItems(items: ExtractedTextItem[]): ExtractedTextItem[] {
  const result: ExtractedTextItem[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const t = item.text.trim();
    if (t.startsWith('(') && !t.endsWith(')')) {
      let combinedText = item.text;
      let j = i + 1;
      let totalWidth = item.width;
      while (j < items.length) {
        combinedText += ' ' + items[j].text;
        totalWidth += items[j].width + (items[j].x - (items[j - 1].x + items[j - 1].width));
        if (items[j].text.includes(')')) {
          break;
        }
        j++;
      }
      if (j < items.length && combinedText.includes(')')) {
        result.push({
          ...item,
          text: combinedText,
          width: totalWidth,
        });
        i = j + 1;
        continue;
      }
    }
    result.push(item);
    i++;
  }
  return result;
}

export function isRepeatProgressionLine(line: string): boolean {
  if (!line || !line.trim()) return false;
  return /\|\|:|:\|\||%/.test(line) || (line.includes('|') && line.split('|').length >= 4);
}

interface ProjectedLyricResult {
  projected: string;
  hasUncertainAlignment: boolean;
  unknownTokens: string[];
}

function projectChordsOntoLyrics(
  vLine: VisualPdfLine,
  lyricVLine: VisualPdfLine
): ProjectedLyricResult {
  const consolidated = consolidateVisualLineItems(vLine.items);
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

  // Sort items descending by X so insertions from right to left do not shift indices
  const sortedItems = [...consolidated].sort((a, b) => b.x - a.x);
  let projected = lyricString;
  let hasUncertainAlignment = false;
  const unknownTokens: string[] = [];

  for (const item of sortedItems) {
    const rawText = item.text.trim();
    if (!rawText) continue;

    const isChord = isMusicalChord(rawText);
    const isBarline = ['|', '||', '||:', ':||', '%'].includes(rawText);
    const isParenAnnotation = /^\(.*?\)$/.test(rawText) || /^\[.*?\]$/.test(rawText);

    let tokenText = '';
    if (isChord) {
      tokenText = '[' + rawText + ']';
    } else if (isBarline || isParenAnnotation) {
      tokenText = rawText;
    } else {
      // Unrecognized chord-like token on a chord line
      unknownTokens.push(rawText);
      tokenText = '[' + rawText + ']';
    }

    const itemX = item.x;
    const lastPos = charPositions[charPositions.length - 1];

    if (lastPos && itemX > lastPos.x + lastPos.width + 10) {
      projected += ' ' + tokenText;
      continue;
    }

    let targetIndex = -1;

    if (!isChord) {
      // Non-chord items (performance annotations, barlines):
      // ALWAYS preserve at word boundaries, NEVER slice intra-word
      if (words.length > 0 && itemX <= words[0].startX + 5) {
        projected = tokenText + ' ' + projected;
        continue;
      }

      let chosenIdx = words[words.length - 1]?.endIdx || projected.length;
      let minGapDiff = 999999;

      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const w = words[wIdx];
        const diffBefore = Math.abs(w.startX - itemX);
        if (diffBefore < minGapDiff) {
          minGapDiff = diffBefore;
          chosenIdx = w.startIdx;
        }
        const diffAfter = Math.abs(w.endX - itemX);
        if (diffAfter < minGapDiff) {
          minGapDiff = diffAfter;
          chosenIdx = w.endIdx;
        }
      }

      const beforeChar = projected[chosenIdx - 1];
      const afterChar = projected[chosenIdx];
      const prefix = (chosenIdx > 0 && beforeChar !== ' ') ? ' ' : '';
      const suffix = (chosenIdx < projected.length && afterChar !== ' ') ? ' ' : '';
      projected = projected.slice(0, chosenIdx) + prefix + tokenText + suffix + projected.slice(chosenIdx);
      continue;
    }

    // Musical Chord placement
    if (words.length > 0 && itemX <= words[0].startX + 10) {
      targetIndex = words[0].startIdx;
    } else {
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const w = words[wIdx];
        const nextW = words[wIdx + 1];
        const wordWidth = w.endX - w.startX;

        // Near start of word (up to 45% of word width or within 12pt)
        if (itemX >= w.startX - 15 && itemX <= w.startX + Math.max(12, wordWidth * 0.45)) {
          targetIndex = w.startIdx;
          break;
        }

        // In gap between words
        if (nextW && itemX > w.endX && itemX < nextW.startX) {
          const distToNext = nextW.startX - itemX;
          const distToPrev = itemX - w.endX;
          if (distToNext <= distToPrev + 5) {
            targetIndex = nextW.startIdx;
          } else {
            targetIndex = w.endIdx;
          }
          break;
        }

        // Intentionally inside word (later syllable)
        if (itemX > w.startX + Math.max(12, wordWidth * 0.45) && itemX <= w.endX) {
          let bestInside = w.startIdx;
          let minDiff = 999999;
          for (let i = w.startIdx; i < w.endIdx; i++) {
            const diff = Math.abs(charPositions[i].x - itemX);
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
        const diff = Math.abs(charPositions[i].x - itemX);
        if (diff < minDiff) {
          minDiff = diff;
          targetIndex = i;
        }
      }
      hasUncertainAlignment = true;
    }

    projected = projected.slice(0, targetIndex) + tokenText + projected.slice(targetIndex);
  }

  projected = projected.replace(/\s{2,}/g, ' ').trim();

  return { projected, hasUncertainAlignment, unknownTokens };
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

          const artistMatch = lineText.match(/^(?:Artista|Artist|Banda|Por|By|Intérprete|Interprete|Compositor):\s*(.+)$/i);
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

          // In standard single-line header on first visual line
          if (!title && lineIdx === 0 && !isChordLine(lineText) && !SECTION_HEADER_REGEX.test(lineText)) {
            // Check for explicit spaced dash: "Title – Artist", "Title — Artist", "Title - Artist"
            // Note: plain words "por" or "by" inside ordinary text are NOT artist separators.
            const dashMatches = lineText.split(/\s+[–—-]\s+/);
            if (dashMatches.length === 2) {
              const left = dashMatches[0].trim();
              const right = dashMatches[1].trim();

              // Check if right side is an arrangement or version note rather than an artist name
              const isVersionSubtitle = /^\(?(?:versão|versao|ao vivo|playback|acústico|acustico|acoustic|live|cover|instrumental|parte\s*\d+|part\s*\d+)/i.test(right);
              if (isVersionSubtitle) {
                title = lineText.trim();
                warnings.push({
                  code: 'METADATA_AMBIGUOUS',
                  message: 'Cabeçalho com subtítulo mantido no título: verifique se título e artista foram identificados corretamente.',
                });
              } else {
                title = left;
                artistName = right;
              }
            } else if (dashMatches.length > 2) {
              // Ambiguous multiple dashes: preserve first as title, remainder as artist with warning
              title = dashMatches[0].trim();
              artistName = dashMatches.slice(1).join(' - ').trim();
              warnings.push({
                code: 'METADATA_AMBIGUOUS',
                message: 'Cabeçalho com múltiplos separadores: verifique se título e artista foram identificados corretamente.',
              });
            } else {
              // No spaced dash: check explicit "by:" or "por:" with colon
              const explicitPor = lineText.match(/^(.+?)\s+(?:por|by):\s*(.+)$/i);
              if (explicitPor) {
                title = explicitPor[1].trim();
                artistName = explicitPor[2].trim();
              } else {
                title = lineText.trim();
              }
            }
            lineIdx++;
            continue;
          }

          // Unlabeled line 1 is never consumed as artist solely by position or key metadata.
          // Plain lyrics or annotations on line 1 are preserved in the musical body.
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
        if (/^\s*\([^()]*\)\s*$/.test(lineText)) {
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
            !/^\s*\([^()]*\)\s*$/.test(nextLineText)
          ) {
            const { projected, hasUncertainAlignment, unknownTokens } = projectChordsOntoLyrics(vLine, nextVLine);
            if (hasUncertainAlignment && !warnings.some(w => w.code === 'CHORD_ALIGNMENT_UNCERTAIN')) {
              warnings.push({
                code: 'CHORD_ALIGNMENT_UNCERTAIN',
                message: 'Alinhamento de acordes em linha com divisão intra-palavra pode requerer ajuste manual.',
              });
            }
            for (const ut of unknownTokens) {
              if (!warnings.some(w => w.code === 'UNKNOWN_CHORD_TOKEN' && w.message.includes(ut))) {
                warnings.push({
                  code: 'UNKNOWN_CHORD_TOKEN',
                  message: `Acorde ou símbolo não reconhecido "${ut}" mantido no texto para revisão.`,
                });
              }
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
            const consolidated = consolidateVisualLineItems(vLine.items);
            const formattedParts = consolidated.map(item => {
              const t = item.text.trim();
              if (isMusicalChord(t)) return '[' + t + ']';
              if (!['|', '||', '||:', ':||', '%'].includes(t) && !/^\(.*?\)$/.test(t) && !/^\[.*?\]$/.test(t) && !SECTION_HEADER_REGEX.test(t) && !/^(Intro|Solo|Verso|Refrão|Refrao|Coro|Ponte|Pausa|Interlúdio|Interludio|Final)[:\s]*$/i.test(t)) {
                if (!warnings.some(w => w.code === 'UNKNOWN_CHORD_TOKEN' && w.message.includes(t))) {
                  warnings.push({
                    code: 'UNKNOWN_CHORD_TOKEN',
                    message: `Acorde ou símbolo não reconhecido "${t}" mantido no texto para revisão.`,
                  });
                }
                return '[' + t + ']';
              }
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
