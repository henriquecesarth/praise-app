import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractSmartChordDraftFromPdf, MAX_PDF_FILE_SIZE, MAX_PDF_PAGES } from './smart_chord_pdf_extractor';
import { AppError } from '../../middleware/error-handler';

async function createSyntheticPdf(builder: (doc: PDFDocument, font: any) => Promise<void>): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  await builder(doc, font);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe('Smart Chord PDF Extractor Test Suite (Synthetic Fixtures)', () => {
  it('1. Golden One-Page Chord-over-Lyric & Annotations & Progressions PDF', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]); // A4
      page.drawText('Certeza (Canção de Jó)', { x: 50, y: 800, size: 16, font });
      page.drawText('Héber Bragança', { x: 50, y: 780, size: 12, font });
      page.drawText('Tom: A', { x: 50, y: 760, size: 10, font });
      page.drawText('||: A9 | A7M/9 | D9 | % :||', { x: 50, y: 730, size: 11, font });
      page.drawText('(violão/pad)', { x: 50, y: 705, size: 10, font });
      page.drawText('A9            A7M/9', { x: 50, y: 670, size: 11, font });
      page.drawText('Graças Te dou pelo Teu amor', { x: 50, y: 655, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);

    expect(draft.source_type).toBe('pdf');
    expect(draft.title).toBe('Certeza (Canção de Jó)');
    expect(draft.artist_name).toBe('Héber Bragança');
    expect(draft.original_key).toBe('A');

    // Musical fidelity assertions
    expect(draft.content).toContain('||: [A9] | [A7M/9] | [D9] | % :||');
    expect(draft.content).toContain('(violão/pad)');
    expect(draft.content).toContain('[A9]');
    expect(draft.content).toContain('[A7M/9]');
    expect(draft.content).toContain('Graças Te');
    expect(draft.content).toContain('dou pelo Teu amor');
  });

  it('2. Multi-Page PDF Extraction (Page headers & page boundaries)', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const p1 = doc.addPage([595, 842]);
      p1.drawText('Título: Canção Longa', { x: 50, y: 800, size: 14, font });
      p1.drawText('Tom: G', { x: 50, y: 780, size: 10, font });
      p1.drawText('G        C', { x: 50, y: 750, size: 11, font });
      p1.drawText('Página um aqui', { x: 50, y: 735, size: 11, font });

      const p2 = doc.addPage([595, 842]);
      p2.drawText('D        Em', { x: 50, y: 750, size: 11, font });
      p2.drawText('Página dois aqui', { x: 50, y: 735, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.title).toBe('Canção Longa');
    expect(draft.original_key).toBe('G');
    expect(draft.content).toContain('[G]');
    expect(draft.content).toContain('[C]');
    expect(draft.content).toContain('[D]');
    expect(draft.content).toContain('[Em]');
  });

  it('3. Multi-Column PDF Layout Handling', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Música em Colunas', { x: 50, y: 800, size: 14, font });
      // Left Column (x ~ 50)
      page.drawText('Verso 1:', { x: 50, y: 750, size: 11, font });
      page.drawText('C        F', { x: 50, y: 730, size: 11, font });
      page.drawText('Letra coluna um', { x: 50, y: 715, size: 11, font });
      // Right Column (x ~ 320)
      page.drawText('Refrão:', { x: 320, y: 750, size: 11, font });
      page.drawText('G        Am', { x: 320, y: 730, size: 11, font });
      page.drawText('Letra coluna dois', { x: 320, y: 715, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('[Verso 1]');
    expect(draft.content).toContain('[Refrão]');
    expect(draft.content).toContain('[C]');
    expect(draft.content).toContain('[G]');
  });

  it('4. Scanned-only PDF (No selectable text) returns POSSIBLE_SCANNED_PDF warning', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc) => {
      // Add empty page with no text items
      doc.addPage([595, 842]);
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.warnings.some(w => w.code === 'POSSIBLE_SCANNED_PDF')).toBe(true);
    expect(draft.content).toBe('');
  });

  it('5. Rejects oversized PDF > 3 MiB fail-closed with AppError(400)', async () => {
    const fakeOversizedBuffer = Buffer.alloc(MAX_PDF_FILE_SIZE + 100);
    // Valid PDF signature to pass initial byte check
    fakeOversizedBuffer.write('%PDF-1.4');

    await expect(extractSmartChordDraftFromPdf(fakeOversizedBuffer)).rejects.toThrow(
      'Arquivo PDF excede o limite máximo permitido de 3 MB.'
    );
  });

  it('6. Rejects PDF with more than 10 pages with AppError(400)', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      for (let i = 0; i < 11; i++) {
        const p = doc.addPage([595, 842]);
        p.drawText('Página ' + (i + 1), { x: 50, y: 800, size: 12, font });
      }
    });

    await expect(extractSmartChordDraftFromPdf(pdfBuffer)).rejects.toThrow(
      'O PDF possui 11 páginas (máximo permitido: 10).'
    );
  });

  it('7. Rejects malformed / non-PDF buffer with AppError(400)', async () => {
    const garbageBuffer = Buffer.from('NOT A PDF FILE AT ALL');
    await expect(extractSmartChordDraftFromPdf(garbageBuffer)).rejects.toThrow(
      'Arquivo inválido. O arquivo fornecido não é um PDF válido.'
    );
  });
});
