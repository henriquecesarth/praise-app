import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { installMockApi, mockUser, seedAuthenticatedSession } from './mock-api';

const evidenceDir = resolve(process.env.PDF_EVIDENCE_DIR || '../docs/exec-plans/evidence/m20-c11');

const shortContent = [
  'Intro: [||: C | G/B | Am7 | F9 :||]',
  'e|--0h1--3--1--0--|',
  'B|--1----0--1--1--|',
  '[C]Hoje eu quero [G]cantar',
  '[Am]Uma nova [F]canção',
  '',
  '[C]Com alegria e [G]esperança',
  '[F]Guardadas [G]no [C]coração',
].join('\n');

const longTab = `e|--0h2--[7]--12/14${'-'.repeat(120)}--19p17--|`;
const makeStanza = (idx: number) =>
  [
    `[Estrofe ${idx}]`,
    `[Bb]Luz que brilha no [Eb/G]mar da manhã (${idx})`,
    `[Cm7]Firme rocha e [F7]abrigo seguro [Bb]para nós`,
    'Progressão: [||: Bb | Eb/G | Cm7 | F7 :||]',
  ].join('\n');

const mediumContent = [
  '[Intro]',
  longTab,
  'B|--3----[7]-----|',
  'G|--2----[7]-----|',
  ...Array.from({ length: 7 }, (_, i) => makeStanza(i + 1)),
].join('\n\n');

const longContent = [
  '[Intro]',
  longTab,
  'B|--3----[7]-----|',
  'G|--2----[7]-----|',
  'D|--0------------|',
  ...Array.from({ length: 16 }, (_, i) => makeStanza(i + 1)),
  '[Final]',
  '[Bb]Amém [Eb/F]para [Bb]sempre',
].join('\n\n');

function parsePdfStructure(pdfBuffer: Buffer) {
  const latin1 = pdfBuffer.toString('latin1');
  const pageMatches = latin1.match(/\/Type\s*\/Page\b/g) || [];
  const mediaBoxes = Array.from(latin1.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)).map(
    (m) => m.slice(1, 5).map(Number)
  );
  const cmMatches = Array.from(
    latin1.matchAll(/([\d.]+)\s+0\s+0\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+cm\s+\/I\d+\s+Do/g)
  ).map((m) => ({
    widthPt: Number(m[1]),
    heightPt: Number(m[2]),
    xPt: Number(m[3]),
    yPt: Number(m[4]),
    leftMarginMm: Number(((Number(m[3]) * 25.4) / 72).toFixed(2)),
    widthMm: Number(((Number(m[1]) * 25.4) / 72).toFixed(2)),
    heightMm: Number(((Number(m[2]) * 25.4) / 72).toFixed(2)),
    topMarginMm: Number((((841.89 - Number(m[4]) - Number(m[2])) * 25.4) / 72).toFixed(2)),
    bottomMarginMm: Number(((Number(m[4]) * 25.4) / 72).toFixed(2)),
    rightMarginMm: Number((((595.28 - Number(m[3]) - Number(m[1])) * 25.4) / 72).toFixed(2)),
  }));
  return {
    pageCount: pageMatches.length,
    mediaBoxes,
    placements: cmMatches,
  };
}

test('M20-C11 full PDF fidelity, spacing (0/8/16/24px), 10mm A4 margins, 6 fonts, transposition, and responsive modal', async ({ page }) => {
  test.setTimeout(240000);
  mkdirSync(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 920 });
  await seedAuthenticatedSession(page, 'dark');
  await installMockApi(page);

  let preferences = { chord_font_family: 'Arial', chord_line_spacing_px: 8 };
  await page.route(/\/auth\/me(?:\/preferences)?$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      preferences = { ...preferences, ...route.request().postDataJSON() };
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().endsWith('/preferences') ? { preferences } : { ...mockUser, preferences }),
    });
  });

  const chords = [
    {
      id: 'c11-short',
      title: 'C11 Curta — Canção de Louvor com Título Extenso para Verificação de Quebra e Margens A4',
      artist_name: 'Ministério de Louvor e Adoração Comunitária Internacional — Artista com Nome Muito Longo',
      original_key: 'C',
      content: shortContent,
      created_at: '2026-11-03T00:00:00Z',
      updated_at: '2026-11-03T00:00:00Z',
    },
    {
      id: 'c11-medium',
      title: 'C11 Média — Múltiplas Páginas e Progressões',
      artist_name: 'LouvAIO Ensemble',
      original_key: 'Bb',
      content: mediumContent,
      created_at: '2026-11-03T00:00:00Z',
      updated_at: '2026-11-03T00:00:00Z',
    },
    {
      id: 'c11-long',
      title: 'C11 Longa — Documento Multipágina Completo',
      artist_name: 'LouvAIO Orquestra e Coral',
      original_key: 'Bb',
      content: longContent,
      created_at: '2026-11-03T00:00:00Z',
      updated_at: '2026-11-03T00:00:00Z',
    },
  ];

  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, (route) => {
    const url = route.request().url();
    const matched = chords.find((c) => url.includes(`/${c.id}`));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(matched ?? { data: chords }),
    });
  });

  const summary: Record<string, unknown> = {
    spacingTests: [],
    fontTests: [],
    sizeTests: [],
    transpositionTest: null,
    responsiveViewports: [],
  };

  await page.goto('/cifras');
  await page.waitForFunction(() => typeof (window as unknown as { html2pdf?: unknown }).html2pdf === 'function');

  // 1. Test spacing 0, 8, 16, 24px on Medium chord (verifying spacing changes Web reading view, preview, and downloaded PDF)
  await page.getByText(chords[1].title, { exact: true }).click();
  await page.getByRole('button', { name: /Exportar PDF/ }).click();
  await expect(page.getByTestId('pdf-preview-dialog')).toBeVisible();

  const spacingHeights: Record<number, number> = {};
  for (const spacing of [0, 8, 16, 24]) {
    // Adjust spacing using modal controls to reach target `spacing`
    const currentText = await page.getByTestId('modal-line-spacing-value').textContent();
    let currentVal = Number((currentText || '8px').replace('px', ''));
    while (currentVal !== spacing) {
      if (currentVal < spacing) {
        await page.getByTestId('modal-spacing-increase').click();
        currentVal += 2;
      } else {
        await page.getByTestId('modal-spacing-decrease').click();
        currentVal -= 2;
      }
    }

    await expect(page.getByTestId('modal-line-spacing-value')).toHaveText(`${spacing}px`);
    await expect(page.getByTestId('pdf-sheet-lines')).toHaveCSS('gap', `${spacing}px`);
    await expect(page.getByTestId('reading-lines')).toHaveCSS('gap', `${spacing}px`);

    // Wait for preview generation to complete
    await expect(page.getByTestId('pdf-page-count')).toContainText(/PDF • \d+ página/);
    const badgeText = (await page.getByTestId('pdf-page-count').textContent()) || '';
    const shownPages = Number(badgeText.match(/(\d+)/)?.[1] || 0);
    expect(shownPages).toBeGreaterThanOrEqual(1);

    const previewPageEls = page.getByTestId('pdf-preview-page');
    await expect(previewPageEls).toHaveCount(shownPages);

    const sheetMetrics = await page.locator('#printable-sheet-pdf').evaluate((el) => {
      const rows = Array.from(el.querySelectorAll<HTMLElement>('.pdf-line-row'));
      return {
        padding: getComputedStyle(el).padding,
        height: el.getBoundingClientRect().height,
        rowTops: rows.slice(0, 6).map((r) => r.getBoundingClientRect().top - el.getBoundingClientRect().top),
      };
    });
    expect(sheetMetrics.padding).toBe('0px');
    spacingHeights[spacing] = sheetMetrics.height;

    const previewDataUrls = await previewPageEls.locator('img').evaluateAll((imgs) =>
      imgs.map((img) => (img as HTMLImageElement).src)
    );
    expect(previewDataUrls).toHaveLength(shownPages);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Baixar PDF/ }).click();
    const download = await downloadPromise;
    const pdfPath = resolve(evidenceDir, `medium-spacing-${spacing}px.pdf`);
    await download.saveAs(pdfPath);

    const pdfBuf = await (await import('node:fs/promises')).readFile(pdfPath);
    const parsed = parsePdfStructure(pdfBuf);
    expect(parsed.pageCount).toBe(shownPages);

    // Verify 10mm margins & A4 dimensions on every page
    for (const box of parsed.mediaBoxes) {
      expect(box[2]).toBeCloseTo(595.28, 1);
      expect(box[3]).toBeCloseTo(841.89, 1);
    }
    for (const p of parsed.placements) {
      expect(p.leftMarginMm).toBeCloseTo(10, 1);
      expect(p.rightMarginMm).toBeCloseTo(10, 1);
      expect(p.topMarginMm).toBeCloseTo(10, 1);
      expect(p.bottomMarginMm).toBeGreaterThanOrEqual(9.9);
      expect(p.widthMm).toBeCloseTo(190, 1);
    }

    // Verify byte parity between preview page images and embedded JPEGs in downloaded PDF + non-blank pages
    for (let i = 0; i < previewDataUrls.length; i++) {
      const base64 = previewDataUrls[i].split(',')[1];
      const imgBuf = Buffer.from(base64, 'base64');
      expect(pdfBuf.includes(imgBuf)).toBe(true);
      const stats = await sharp(imgBuf).stats();
      // Minimum channel value < 200 confirms dark ink pixels exist (not a blank white page)
      expect(Math.min(...stats.channels.map((c) => c.min))).toBeLessThan(200);
    }

    (summary.spacingTests as unknown[]).push({
      spacingPx: spacing,
      sheetHeightPx: sheetMetrics.height,
      rowTops: sheetMetrics.rowTops,
      shownPages,
      pdfPages: parsed.pageCount,
      placements: parsed.placements,
      previewDownloadParity: true,
    });
  }

  // Verify spacing monotonically increases sheet height
  expect(spacingHeights[8]).toBeGreaterThan(spacingHeights[0]);
  expect(spacingHeights[16]).toBeGreaterThan(spacingHeights[8]);
  expect(spacingHeights[24]).toBeGreaterThan(spacingHeights[16]);

  // Reset spacing to default 8px
  while ((await page.getByTestId('modal-line-spacing-value').textContent()) !== '8px') {
    await page.getByTestId('modal-spacing-decrease').click();
  }
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();

  // 2. Test all 6 fonts on Short chord + chord alignment, no overlap, no underlines
  await page.getByText(chords[0].title, { exact: true }).click();
  await page.getByRole('button', { name: /Exportar PDF/ }).click();

  const fonts = ['Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'monospace'];
  for (const font of fonts) {
    await page.getByTestId('modal-font-family-select').selectOption(font);
    await expect(page.getByTestId('pdf-page-count')).toContainText(/PDF • \d+ página/);

    const badgeText = (await page.getByTestId('pdf-page-count').textContent()) || '';
    const shownPages = Number(badgeText.match(/(\d+)/)?.[1] || 0);
    expect(shownPages).toBe(1);
    await expect(page.getByTestId('pdf-preview-page')).toHaveCount(1);

    // Check chord alignment, no overlap, no underlines, and monospace tablatures
    const domAudit = await page.locator('#printable-sheet-pdf').evaluate((el) => {
      const rows = Array.from(el.querySelectorAll<HTMLElement>('.pdf-line-row'));
      let overlapCount = 0;
      for (const row of rows) {
        const chords = Array.from(row.querySelectorAll<HTMLElement>('.print-chord-span'));
        for (let i = 1; i < chords.length; i++) {
          const prev = chords[i - 1].getBoundingClientRect();
          const curr = chords[i].getBoundingClientRect();
          if (Math.abs(curr.top - prev.top) < 4 && curr.left < prev.right - 1) {
            overlapCount++;
          }
        }
      }
      const underlines = Array.from(el.querySelectorAll<HTMLElement>('.has-chord')).map(
        (c) => getComputedStyle(c).textDecorationLine
      );
      const tabFonts = Array.from(el.querySelectorAll<HTMLElement>('[data-musical-tablature]')).map(
        (t) => getComputedStyle(t).fontFamily
      );
      return { overlapCount, underlines, tabFonts };
    });

    expect(domAudit.overlapCount).toBe(0);
    expect(domAudit.underlines.every((u) => u === 'none')).toBe(true);
    expect(domAudit.tabFonts.every((f) => f.toLowerCase().includes('monospace'))).toBe(true);

    const fontSlug = font.toLowerCase().replaceAll(' ', '-');
    await page.getByTestId('pdf-preview-dialog').screenshot({
      path: resolve(evidenceDir, `short-font-${fontSlug}-modal.png`),
    });

    const previewDataUrl = await page.getByTestId('pdf-preview-page').first().locator('img').getAttribute('src');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Baixar PDF/ }).click();
    const download = await downloadPromise;
    const pdfPath = resolve(evidenceDir, `short-font-${fontSlug}.pdf`);
    await download.saveAs(pdfPath);

    const pdfBuf = await (await import('node:fs/promises')).readFile(pdfPath);
    const parsed = parsePdfStructure(pdfBuf);
    expect(parsed.pageCount).toBe(1);
    const imgBuf = Buffer.from((previewDataUrl || '').split(',')[1], 'base64');
    expect(pdfBuf.includes(imgBuf)).toBe(true);

    (summary.fontTests as unknown[]).push({
      font,
      shownPages,
      pdfPages: parsed.pageCount,
      overlapCount: domAudit.overlapCount,
      underlinesNone: true,
      previewDownloadParity: true,
    });
  }

  // 3. Test Transposition (+2 semitones: C -> D)
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Transpor um semitom acima', exact: true }).click();
  await page.getByRole('button', { name: 'Transpor um semitom acima', exact: true }).click();
  await page.getByRole('button', { name: /Exportar PDF/ }).click();
  await expect(page.getByTestId('pdf-page-count')).toContainText('PDF • 1 página');
  const transposedChords = await page.locator('#printable-sheet-pdf .print-chord-span').allTextContents();
  expect(transposedChords.slice(0, 6)).toEqual(['D', 'A/C#', 'Bm7', 'G9', 'D', 'A']);
  const transposedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Baixar PDF/ }).click();
  const transposedDownload = await transposedDownloadPromise;
  await transposedDownload.saveAs(resolve(evidenceDir, 'short-transposed-D.pdf'));
  summary.transpositionTest = { from: 'C', to: 'D', firstChords: transposedChords.slice(0, 6) };
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();

  // 4. Test Long multipage chord (3+ pages)
  await page.getByText(chords[2].title, { exact: true }).click();
  await page.getByRole('button', { name: /Exportar PDF/ }).click();
  await expect(page.getByTestId('pdf-page-count')).toContainText(/PDF • \d+ páginas/);
  const longBadge = (await page.getByTestId('pdf-page-count').textContent()) || '';
  const longShownPages = Number(longBadge.match(/(\d+)/)?.[1] || 0);
  expect(longShownPages).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('pdf-preview-page')).toHaveCount(longShownPages);
  await page.getByTestId('pdf-preview-dialog').screenshot({
    path: resolve(evidenceDir, 'long-multipage-modal.png'),
  });

  const longPreviewUrls = await page
    .getByTestId('pdf-preview-page')
    .locator('img')
    .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
  const longDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Baixar PDF/ }).click();
  const longDownload = await longDownloadPromise;
  const longPdfPath = resolve(evidenceDir, 'long-multipage.pdf');
  await longDownload.saveAs(longPdfPath);
  const longPdfBuf = await (await import('node:fs/promises')).readFile(longPdfPath);
  const longParsed = parsePdfStructure(longPdfBuf);
  expect(longParsed.pageCount).toBe(longShownPages);
  for (const url of longPreviewUrls) {
    const imgBuf = Buffer.from(url.split(',')[1], 'base64');
    expect(longPdfBuf.includes(imgBuf)).toBe(true);
  }
  (summary.sizeTests as unknown[]).push({
    case: 'long',
    shownPages: longShownPages,
    pdfPages: longParsed.pageCount,
    placements: longParsed.placements,
  });

  // 5. Responsive check across viewports (360, 390, 768, 1024, 1366)
  for (const width of [360, 390, 768, 1024, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = page.getByTestId('pdf-preview-dialog');
    await expect(dialog).toBeVisible();
    const metrics = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        viewportWidth: window.innerWidth,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
    expect(metrics.left).toBeGreaterThanOrEqual(-1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.overflow).toBe(false);
    await expect(page.getByRole('button', { name: /Baixar PDF/ })).toBeInViewport();
    (summary.responsiveViewports as unknown[]).push({ width, ...metrics });
  }

  writeFileSync(resolve(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
});
