import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const evidenceDir = resolve('../docs/exec-plans/evidence/m20-c14-r9/after');

test('Investigate R9 marker after fix', async ({ page }) => {
  test.setTimeout(90000);
  mkdirSync(evidenceDir, { recursive: true });

  await page.setViewportSize({ width: 1366, height: 768 });
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);

  // Exact song requested by user:
  // Title: Meu universo
  // Artist: PG
  // Key: G
  // Marker: Min. Infantil IBBP
  const chord = {
    id: 'r9-repro-after',
    title: 'Meu universo',
    artist_name: 'PG',
    original_key: 'G',
    content: '[Intro]\n[| G | D/F# | Em | C |]\n[G]Que meus olhos se [D/F#]abram\n[Em]Para ver o Teu amor[C]',
    created_at: '2026-11-04',
    updated_at: '2026-11-04'
  };

  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [chord] }) })
  );

  await page.goto('/cifras/r9-repro-after/editar');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).html2pdf === 'function');

  // Open PDF modal
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();

  // Set font Arial, size 13 (default), marker "Min. Infantil IBBP"
  await page.getByTestId('modal-font-family-select').selectOption('Arial');
  await page.getByTestId('modal-pdf-marker-input').fill('Min. Infantil IBBP');

  // Trigger PDF Generation
  await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });

  // 4. Investigação técnica: Detailed DOM and raster metrics
  const inspection = await page.evaluate(() => {
    const root = document.getElementById('printable-sheet-pdf')!;
    const wrapper = root.parentElement!;
    const header = root.querySelector<HTMLElement>('.pdf-header')!;
    const marker = root.querySelector<HTMLElement>('[data-testid="pdf-header-custom-marker"]')!;
    const title = root.querySelector<HTMLElement>('[data-testid="pdf-header-title"]')!;
    const titleGroup = title.parentElement!;

    const rootRect = root.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const titleGroupRect = titleGroup.getBoundingClientRect();

    const rootStyles = getComputedStyle(root);
    const wrapperStyles = getComputedStyle(wrapper);
    const headerStyles = getComputedStyle(header);
    const markerStyles = getComputedStyle(marker);

    // Canvas measure of the text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${markerStyles.fontWeight} ${markerStyles.fontSize} ${markerStyles.fontFamily}`;
    const markerText = marker.textContent?.trim() || '';
    const textMetrics = ctx.measureText(markerText);

    return {
      wrapper: {
        width: wrapperRect.width,
        height: wrapperRect.height,
        position: wrapperStyles.position,
        left: wrapperStyles.left,
        top: wrapperStyles.top,
        overflow: wrapperStyles.overflow,
        maxHeight: wrapperStyles.maxHeight
      },
      root: {
        width: rootRect.width,
        height: rootRect.height,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        offsetWidth: root.offsetWidth,
        paddingLeft: rootStyles.paddingLeft,
        paddingRight: rootStyles.paddingRight,
        boxSizing: rootStyles.boxSizing
      },
      header: {
        width: headerRect.width,
        height: headerRect.height,
        left: headerRect.left,
        right: headerRect.right,
        paddingRight: headerStyles.paddingRight,
        gap: headerStyles.gap,
        display: headerStyles.display,
        justifyContent: headerStyles.justifyContent
      },
      titleGroup: {
        width: titleGroupRect.width,
        right: titleGroupRect.right,
        gap: getComputedStyle(titleGroup).gap
      },
      marker: {
        text: markerText,
        width: markerRect.width,
        height: markerRect.height,
        left: markerRect.left,
        right: markerRect.right,
        scrollWidth: marker.scrollWidth,
        clientWidth: marker.clientWidth,
        offsetWidth: marker.offsetWidth,
        flex: markerStyles.flex,
        whiteSpace: markerStyles.whiteSpace,
        overflowWrap: markerStyles.overflowWrap,
        boxSizing: markerStyles.boxSizing,
        textAlign: markerStyles.textAlign,
        fontFamily: markerStyles.fontFamily,
        fontSize: markerStyles.fontSize,
        fontWeight: markerStyles.fontWeight
      },
      gapBetweenTitleGroupAndMarker: markerRect.left - titleGroupRect.right,
      clearanceFromRootRight: rootRect.right - markerRect.right,
      canvasTextMeasurement: {
        text: markerText,
        width: textMetrics.width,
        actualBoundingBoxLeft: textMetrics.actualBoundingBoxLeft,
        actualBoundingBoxRight: textMetrics.actualBoundingBoxRight,
        font: ctx.font
      }
    };
  });

  writeFileSync(
    resolve(evidenceDir, 'technical-investigation.json'),
    JSON.stringify(inspection, null, 2)
  );

  // Download PDF
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar PDF' }).click();
  const download = await downloadPromise;
  const pdfPath = resolve(evidenceDir, 'meu-universo-after.pdf');
  await download.saveAs(pdfPath);

  // Extract preview page image from DOM
  const previewImg = page.getByTestId('pdf-preview-pages').locator('img').first();
  const dataUrl = await previewImg.getAttribute('src');
  if (dataUrl) {
    const base64 = dataUrl.split(',')[1];
    writeFileSync(resolve(evidenceDir, 'preview-page1.jpg'), Buffer.from(base64, 'base64'));
  }

  expect(inspection.root.width).toBeGreaterThan(0);
});
