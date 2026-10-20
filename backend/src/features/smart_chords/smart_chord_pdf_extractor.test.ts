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

  it('8. Three-Column PDF Layout (Ordering: Col 1 -> Col 2 -> Col 3)', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([842, 595]); // Landscape A4
      page.drawText('Título: Canção Três Colunas', { x: 40, y: 550, size: 14, font });

      // Column 1: x in [40, 160]
      page.drawText('Verso 1:', { x: 40, y: 500, size: 10, font });
      page.drawText('A        D', { x: 40, y: 480, size: 10, font });
      page.drawText('Texto col um', { x: 40, y: 465, size: 10, font });

      // Column 2: x in [220, 340]
      page.drawText('Refrão:', { x: 220, y: 500, size: 10, font });
      page.drawText('E        F#m', { x: 220, y: 480, size: 10, font });
      page.drawText('Texto col dois', { x: 220, y: 465, size: 10, font });

      // Column 3: x in [400, 520]
      page.drawText('Ponte:', { x: 400, y: 500, size: 10, font });
      page.drawText('Bm       E7', { x: 400, y: 480, size: 10, font });
      page.drawText('Texto col tres', { x: 400, y: 465, size: 10, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('[Verso 1]');
    expect(draft.content).toContain('[Refrão]');
    expect(draft.content).toContain('[Ponte]');

    // Assert strict ordering: Col 1 appears before Col 2, which appears before Col 3
    const v1Idx = draft.content.indexOf('[Verso 1]');
    const refIdx = draft.content.indexOf('[Refrão]');
    const ponIdx = draft.content.indexOf('[Ponte]');
    expect(v1Idx).toBeLessThan(refIdx);
    expect(refIdx).toBeLessThan(ponIdx);

    // Assert chords inside respective columns
    expect(draft.content).toContain('[A]');
    expect(draft.content).toContain('[D]');
    expect(draft.content).toContain('[E]');
    expect(draft.content).toContain('[F#m]');
    expect(draft.content).toContain('[Bm]');
  });

  it('9. Asymmetric Two-Column Split (Gutter at X ~ 190)', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Divisão Assimétrica', { x: 40, y: 800, size: 14, font });

      // Narrow Left Column (x ~ 40..150)
      page.drawText('Verso:', { x: 40, y: 750, size: 10, font });
      page.drawText('C      G', { x: 40, y: 730, size: 10, font });
      page.drawText('Linha curta', { x: 40, y: 715, size: 10, font });

      // Wide Right Column (x ~ 230..500)
      page.drawText('Refrão:', { x: 230, y: 750, size: 10, font });
      page.drawText('Am     F             G', { x: 230, y: 730, size: 10, font });
      page.drawText('Linha mais longa no refrão aqui', { x: 230, y: 715, size: 10, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    const versoPos = draft.content.indexOf('[Verso]');
    const refPos = draft.content.indexOf('[Refrão]');
    expect(versoPos).toBeLessThan(refPos);
    expect(draft.content).toContain('[C]');
    expect(draft.content).toContain('[Am]');
  });

  it('10. Complex Chords (A7M/9 and Cm7(5-)) & Exact Character Anchor Positioning', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Canção com Acordes Complexos', { x: 50, y: 800, size: 14, font });
      page.drawText('A7M/9          Cm7(5-)', { x: 50, y: 750, size: 11, font });
      page.drawText('Senhor Jesus meu Salvador', { x: 50, y: 735, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('[A7M/9]');
    expect(draft.content).toContain('[Cm7(5-)]');

    // Anchors: A7M/9 should be at start, Cm7(5-) around Salvador
    const a7mPos = draft.content.indexOf('[A7M/9]');
    const cm7Pos = draft.content.indexOf('[Cm7(5-)]');
    expect(a7mPos).toBeLessThan(cm7Pos);
    expect(draft.content).toContain('[A7M/9]Senhor');
    expect(draft.content).toContain('Salvador');
  });

  it('11. Mixed Performance Annotations, Dynamic Instructions & Repeat Blocks', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Arranjo Completo', { x: 50, y: 800, size: 14, font });
      page.drawText('||: D | A/C# | Bm7 | G :|| (2x)', { x: 50, y: 760, size: 10, font });
      page.drawText('(violão solo)', { x: 50, y: 740, size: 10, font });
      page.drawText('(cresce marcando)', { x: 50, y: 720, size: 10, font });
      page.drawText('D          A/C#', { x: 50, y: 700, size: 10, font });
      page.drawText('Entra toda a banda', { x: 50, y: 685, size: 10, font });
      page.drawText('(corte)', { x: 50, y: 665, size: 10, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    // Assert all performance annotations survive verbatim
    expect(draft.content).toContain('(violão solo)');
    expect(draft.content).toContain('(cresce marcando)');
    expect(draft.content).toContain('(corte)');
    expect(draft.content).toContain('||: [D] | [A/C#] | [Bm7] | [G] :|| (2x)');
    expect(draft.content).toContain('[D]');
    expect(draft.content).toContain('[A/C#]');
  });

  it('12. METADATA_TITLE_ARTIST_SPLIT_TEST: Splits single-line title and artist across spaced dash without losing parentheses', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Meu Louvor (Canção Eterna) – João da Silva', { x: 50, y: 800, size: 14, font });
      page.drawText('C            G', { x: 50, y: 760, size: 11, font });
      page.drawText('Glória seja dada ao Senhor', { x: 50, y: 745, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.title).toBe('Meu Louvor (Canção Eterna)');
    expect(draft.artist_name).toBe('João da Silva');
    expect(draft.content).toContain('[C]Glória');
  });

  it('13. PERFORMANCE_NOTE_NOT_ARTIST_TEST: Line 1 parenthesized note is retained in content and not used as artist', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Canção Com Coral', { x: 50, y: 800, size: 14, font });
      page.drawText('(todos cantam)', { x: 50, y: 780, size: 10, font });
      page.drawText('D            A', { x: 50, y: 750, size: 11, font });
      page.drawText('Santo é o Cordeiro', { x: 50, y: 735, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.title).toBe('Canção Com Coral');
    expect(draft.artist_name).toBeNull();
    expect(draft.content).toContain('(todos cantam)');
    expect(draft.content).toContain('[D]Santo');
  });

  it('14. MIXED_CHORD_ANNOTATION_TEST & NON_CHORD_TOKEN_PRESERVATION: Preserves inline performance directions on chord lines', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Canção Com Corte', { x: 50, y: 800, size: 14, font });
      page.drawText('F#m   E9   D9   (marca/corte)', { x: 50, y: 760, size: 11, font });
      page.drawText('E eu sei que vais me guardar', { x: 50, y: 745, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('[F#m]');
    expect(draft.content).toContain('[E9]');
    expect(draft.content).toContain('[D9]');
    expect(draft.content).toContain('(marca/corte)');
    expect(draft.content).not.toContain('[(marca/corte)]');
    expect(draft.content).toMatch(/me guardar.*\(marca\/corte\)/);
  });

  it('15. REPEAT_FOLLOWED_BY_VOCALISE_TEST & BARLINE_PRESERVATION: Keeps repeat delimiters, barlines, and simile markers intact', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Canto Com Vocalise', { x: 50, y: 800, size: 14, font });
      page.drawText('||: A9 | A7M/9 | D9 | % :||', { x: 50, y: 760, size: 11, font });
      page.drawText('Uh uh uh uh uh uh uh uh uh uh pa pa pa ra', { x: 50, y: 745, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('||: [A9] | [A7M/9] | [D9] | % :||');
    expect(draft.content).toContain('Uh uh uh uh uh uh uh uh uh uh pa pa pa ra');
    expect(draft.warnings.some(w => w.code === 'REPEAT_STRUCTURE_AMBIGUOUS')).toBe(true);
  });

  it('16. WORD_BOUNDARY_CHORD_ANCHOR_TEST: Snaps chord positioned near word start to word boundary instead of mid-word slice', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Alinhamento Palavra', { x: 50, y: 800, size: 14, font });
      page.drawText('A9   A7M/9', { x: 45, y: 760, size: 11, font });
      page.drawText('Eu sei que tudo podes', { x: 50, y: 745, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('[A9]Eu');
    expect(draft.content).toContain('[A7M/9]sei');
    expect(draft.content).not.toContain('s[A7M/9]ei');
  });

  it('17. INTENTIONAL_INTRA_WORD_CHORD_TEST & IMPORT_WARNINGS_ACCURACY_TEST: Retains intra-word chord and emits CHORD_ALIGNMENT_UNCERTAIN warning', async () => {
    const pdfBuffer = await createSyntheticPdf(async (doc, font) => {
      const page = doc.addPage([595, 842]);
      page.drawText('Título: Cifra com Sílaba Tônica', { x: 50, y: 800, size: 14, font });
      page.drawText('D', { x: 115, y: 760, size: 11, font });
      page.drawText('Deus maravilhoso e digno', { x: 50, y: 745, size: 11, font });
    });

    const draft = await extractSmartChordDraftFromPdf(pdfBuffer);
    expect(draft.content).toContain('[D]');
    expect(draft.warnings.some(w => w.code === 'CHORD_ALIGNMENT_UNCERTAIN')).toBe(true);
  });
});
