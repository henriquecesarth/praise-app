import { AppError } from '../../middleware/error-handler';
import { SmartChordImportDraft, ImportWarning } from './smart_chord_import.types';
import {
  isMusicalChord,
  isChordLine,
  SECTION_HEADER_REGEX,
  BRACKETED_SECTION_REGEX,
} from './smart_chord_normalizer';

// Polyfills to silence node-canvas warnings in Node.js headless environment
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {};
}
if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D {};
}

// Lazy require pdfjs-dist CommonJS legacy build
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

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

  let pdf: any;
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });
    pdf = await loadingTask.promise;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('Password') || msg.includes('encrypted')) {
      throw new AppError(400, 'PDF protegido por senha não é suportado.');
    }
    throw new AppError(400, 'Não foi possível ler o arquivo PDF. Arquivo corrompido ou malformado.');
  }

  // 3. Enforce page count limit
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new AppError(400, `O PDF possui ${pdf.numPages} páginas (máximo permitido: ${MAX_PDF_PAGES}).`);
  }

  // 4. Extract text items with layout coordinates and split into tokens
  const allItems: ExtractedTextItem[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const baseItem: ExtractedTextItem = {
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || Math.abs(item.transform[0]) || 12,
        page: pageNum,
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

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pageItems = allItems.filter(item => item.page === pageNum);
    if (pageItems.length === 0) continue;

    // Detect if page has two columns (split around X ~ 280)
    const leftItems = pageItems.filter(i => (i.x + i.width / 2) < 280);
    const rightItems = pageItems.filter(i => (i.x + i.width / 2) >= 280);

    const isTwoColumn = (
      leftItems.length >= 2 &&
      rightItems.length >= 2 &&
      Math.min(Math.max(...leftItems.map(i => i.y)), Math.max(...rightItems.map(i => i.y))) >
      Math.max(Math.min(...leftItems.map(i => i.y)), Math.min(...rightItems.map(i => i.y)))
    );

    const columnBuckets: ExtractedTextItem[][] = isTwoColumn ? [leftItems, rightItems] : [pageItems];

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

          // In standard single-line header (e.g. Certeza (Canção de Jó) as top line)
          if (!title && lineIdx === 0 && !isChordLine(lineText) && !SECTION_HEADER_REGEX.test(lineText)) {
            title = lineText;
            lineIdx++;
            continue;
          }
          if (title && !artistName && lineIdx === 1 && !isChordLine(lineText) && !SECTION_HEADER_REGEX.test(lineText)) {
            artistName = lineText;
            lineIdx++;
            continue;
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

        // Check for parenthetical annotation e.g. (violão/pad)
        if (/^\s*\(.*?\)\s*$/.test(lineText)) {
          reconstructedLines.push(lineText);
          lineIdx++;
          continue;
        }

        // Check if current line is a chord line
        if (isChordLine(lineText)) {
          const nextVLine = (lineIdx + 1 < visualLines.length) ? visualLines[lineIdx + 1] : null;
          const nextLineText = nextVLine ? nextVLine.items.map(i => i.text).join(' ').trim() : '';
          const yDiff = nextVLine ? Math.abs(vLine.y - nextVLine.y) : 999;

          // If next line is physically close (< 35pt) and is a lyric line
          if (
            nextVLine &&
            yDiff < 35 &&
            nextLineText &&
            !isChordLine(nextLineText) &&
            !SECTION_HEADER_REGEX.test(nextLineText) &&
            !BRACKETED_SECTION_REGEX.test(nextLineText) &&
            !/^\s*\(.*?\)\s*$/.test(nextLineText)
          ) {
            // Coordinate-aware projection: project each chord item's X coordinate onto the lyric items
            const chordItems = vLine.items.filter(i => isMusicalChord(i.text.trim()));
            // Sort chord items descending by X so insertion doesn't invalidate character indices
            chordItems.sort((a, b) => b.x - a.x);

            // Reconstruct full lyric string with character coordinates
            let lyricString = '';
            const charPositions: { char: string; x: number }[] = [];

            for (let itemIdx = 0; itemIdx < nextVLine.items.length; itemIdx++) {
              const lItem = nextVLine.items[itemIdx];
              if (itemIdx > 0) {
                const prevItem = nextVLine.items[itemIdx - 1];
                const spaceGap = lItem.x - (prevItem.x + prevItem.width);
                if (spaceGap > 2) {
                  lyricString += ' ';
                  charPositions.push({ char: ' ', x: prevItem.x + prevItem.width });
                }
              }
              const itemCharWidth = lItem.text.length > 0 ? (lItem.width / lItem.text.length) : 0;
              for (let c = 0; c < lItem.text.length; c++) {
                charPositions.push({
                  char: lItem.text[c],
                  x: lItem.x + c * itemCharWidth,
                });
                lyricString += lItem.text[c];
              }
            }

            let projectedLyric = lyricString;

            for (const cItem of chordItems) {
              const chordText = cItem.text.trim();
              const chordX = cItem.x;
              const chordBracket = '[' + chordText + ']';

              // Find closest character index matching chordX
              let bestIndex = 0;
              let minDiff = 999999;
              for (let idx = 0; idx < charPositions.length; idx++) {
                const diff = Math.abs(charPositions[idx].x - chordX);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestIndex = idx;
                }
              }

              if (chordX > (charPositions[charPositions.length - 1]?.x || 0) + 15) {
                // Chord is past the end of the lyric text
                projectedLyric = projectedLyric + ' ' + chordBracket;
              } else {
                projectedLyric =
                  projectedLyric.slice(0, bestIndex) +
                  chordBracket +
                  projectedLyric.slice(bestIndex);
              }
            }

            reconstructedLines.push(projectedLyric);
            lineIdx += 2; // Consumed both lines
            continue;
          } else {
            // Progression or instrumental line
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
