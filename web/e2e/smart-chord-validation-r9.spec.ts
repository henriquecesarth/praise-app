import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const require = createRequire(resolve(process.cwd(), '../backend/package.json'));
const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
const sharp = createRequire(resolve(process.cwd(), 'package.json'))('sharp');

const directory = resolve('../docs/exec-plans/evidence/m20-c14-r9');

// The 6 required scenarios from Section 6
const scenarios = [
  {
    id: 'reported-min-infantil',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'Min. Infantil IBBP',
    font: 'Arial',
    size: 13,
    description: '1. Min. Infantil IBBP (Reported bug)'
  },
  {
    id: 'alphabet-p',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'ABCDEFGHIJKLMNOP',
    font: 'Arial',
    size: 13,
    description: '2. ABCDEFGHIJKLMNOP (Ends in P)'
  },
  {
    id: 'long-marker',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'Ministério Infantil IBBP — Celebração especial com todas as equipes e famílias participantes',
    font: 'Verdana',
    size: 16,
    description: '3. Um marcador longo, que exija quebra'
  },
  {
    id: 'empty-marker',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: '',
    font: 'Times New Roman',
    size: 13,
    description: '4. Marcador vazio'
  },
  {
    id: 'long-both',
    title: 'Meu Universo — Celebração Especial de Louvor e Adoração em Comunhão com Todas as Congregações',
    artist: 'PG & Equipe de Louvor Ministerial IBBP',
    key: 'G',
    marker: 'Ministério Infantil IBBP — Coordenação Geral de Música e Adoração Infantil',
    font: 'Georgia',
    size: 13,
    description: '5. Título longo e marcador longo simultaneamente'
  },
  {
    id: 'font-mono-large',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'Min. Infantil IBBP',
    font: 'monospace',
    size: 24,
    description: '6a. Monospace tamanho 24px'
  },
  {
    id: 'font-courier-small',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'Min. Infantil IBBP',
    font: 'Courier New',
    size: 10,
    description: '6b. Courier New tamanho 10px'
  },
  {
    id: 'font-times-medium',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'Min. Infantil IBBP',
    font: 'Times New Roman',
    size: 16,
    description: '6c. Times New Roman tamanho 16px'
  },
  {
    id: 'font-verdana-large',
    title: 'Meu universo',
    artist: 'PG',
    key: 'G',
    marker: 'Min. Infantil IBBP',
    font: 'Verdana',
    size: 20,
    description: '6d. Verdana tamanho 20px'
  }
];

for (const sc of scenarios) {
  test(`Validation R9 Scenario: ${sc.id} (${sc.description})`, async ({ page }) => {
    test.setTimeout(90000);
    mkdirSync(directory, { recursive: true });

    await page.setViewportSize({ width: 1366, height: 768 });
    await seedAuthenticatedSession(page, 'light');
    await installMockApi(page);

    const chord = {
      id: `r9-${sc.id}`,
      title: sc.title,
      artist_name: sc.artist,
      original_key: sc.key,
      content:
        '[Intro]\n[| G | D/F# | Em | C |]\ne|--0h2--3--0--|\n' +
        Array.from({ length: 6 }, () => '[G]Que meus olhos se [D/F#]abram\n[Em]Para ver o Teu a[C]mor').join('\n'),
      created_at: '2026-11-04',
      updated_at: '2026-11-04'
    };

    await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, route =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [chord] }) })
    );

    await page.goto(`/cifras/r9-${sc.id}/editar`);
    await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
    await page.waitForFunction(() => typeof (window as any).html2pdf === 'function');

    // Intercept PDF generation Blob to verify single-call parity
    await page.evaluate(() => {
      const original = (window as any).html2pdf;
      (window as any).__r9Calls = 0;
      (window as any).__r9BlobHash = '';
      (window as any).html2pdf = (...args: unknown[]) => {
        (window as any).__r9Calls++;
        return original(...args);
      };
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => {
        if (blob instanceof Blob && blob.type === 'application/pdf') {
          (window as any).__r9BlobHashPromise = blob
            .arrayBuffer()
            .then(buf => crypto.subtle.digest('SHA-256', buf))
            .then(hash => {
              (window as any).__r9BlobHash = Array.from(new Uint8Array(hash))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            });
        }
        return origCreate(blob);
      };
    });

    // Open PDF settings modal
    await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();

    // Select font
    await page.getByTestId('modal-font-family-select').selectOption(sc.font);

    // Adjust font size
    const delta = sc.size - 13;
    for (let n = 0; n < Math.abs(delta); n++) {
      await page.getByTestId(delta > 0 ? 'modal-font-size-increase' : 'modal-font-size-decrease').click();
    }

    // Enter marker
    await page.getByTestId('modal-pdf-marker-input').fill(sc.marker);

    // Zero html2pdf calls while adjusting controls
    expect(await page.evaluate(() => (window as any).__r9Calls)).toBe(0);

    // Trigger Generation
    await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
    await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });

    // Measure DOM
    const domMetrics = await page.locator('#printable-sheet-pdf').evaluate(root => {
      const header = root.querySelector<HTMLElement>('.pdf-header')!;
      const marker = root.querySelector<HTMLElement>('[data-testid="pdf-header-custom-marker"]');
      const title = root.querySelector<HTMLElement>('[data-testid="pdf-header-title"]')!;
      const r = root.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const m = marker?.getBoundingClientRect();
      const t = title.getBoundingClientRect();

      return {
        sourceWidth: r.width,
        headerWidth: h.width,
        sourceOverflow: root.scrollWidth > root.clientWidth + 1,
        paddingRight: getComputedStyle(header).paddingRight,
        markerText: marker?.textContent?.trim() || '',
        markerRightClearance: m ? r.right - m.right : null,
        markerOverflow: marker ? marker.scrollWidth > marker.clientWidth + 1 : false,
        titleOverflow: title.scrollWidth > title.clientWidth + 1,
        lineSpacing: getComputedStyle(root.querySelector('[data-testid="pdf-sheet-lines"]')!).gap
      };
    });

    // Save preview page image
    const preview = page.getByTestId('pdf-preview-pages');
    const image = preview.locator('img').first();
    const data = await image.getAttribute('src');
    const previewJpegPath = resolve(directory, `${sc.id}-preview-page1.jpg`);
    writeFileSync(previewJpegPath, Buffer.from(data!.split(',')[1], 'base64'));

    // Download PDF
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar PDF' }).click();
    const download = await downloadPromise;
    const pdfPath = resolve(directory, `${sc.id}.pdf`);
    await download.saveAs(pdfPath);

    // Verify Blob hash parity (reused Blob, no extra engine call)
    const fileHash = createHash('sha256').update(readFileSync(pdfPath)).digest('hex');
    const blobHash = await page.evaluate(async () => {
      await (window as any).__r9BlobHashPromise;
      return (window as any).__r9BlobHash;
    });
    expect(fileHash).toBe(blobHash);
    expect(await page.evaluate(() => (window as any).__r9Calls)).toBe(1);

    // Extract JPEG from PDF using pdf-lib
    const pdfDoc = await PDFDocument.load(readFileSync(pdfPath));
    const page1 = pdfDoc.getPages()[0];
    const resources = page1.node.Resources();
    const objects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    let extractedImageBuf: Buffer | null = null;
    if (objects) {
      for (const [name, ref] of objects.entries()) {
        const img = pdfDoc.context.lookup(ref);
        if (img instanceof PDFRawStream && img.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
          extractedImageBuf = Buffer.from(img.contents);
          break;
        }
      }
    }
    expect(extractedImageBuf).not.toBeNull();
    const extractedJpegPath = resolve(directory, `${sc.id}-page-1.jpg`);
    writeFileSync(extractedJpegPath, extractedImageBuf!);

    // Extract enlarged crop of top-right header region
    const fullImg = sharp(extractedJpegPath);
    const meta = await fullImg.metadata();
    const cropWidth = 400;
    const cropHeight = 120;
    const cropBuffer = await fullImg
      .extract({
        left: meta.width! - cropWidth,
        top: 0,
        width: cropWidth,
        height: cropHeight
      })
      .png()
      .toBuffer();
    const cropPath = resolve(directory, `${sc.id}-marker-crop.png`);
    writeFileSync(cropPath, cropBuffer);

    // Measure pixel-level distance from the right edge of the usable area (canvas boundary)
    // Only detect text pixels (color #000 or #333 has R < 180, excluding white background and #ddd header border)
    const { data: rawData, info: rawInfo } = await sharp(cropBuffer).raw().toBuffer({ resolveWithObject: true });

    let firstTextPixelDist = null;

    // Scan columns from right edge to left
    for (let x = rawInfo.width - 1; x >= 0; x--) {
      for (let y = 0; y < rawInfo.height; y++) {
        const idx = (y * rawInfo.width + x) * rawInfo.channels;
        const r = rawData[idx], g = rawData[idx + 1], b = rawData[idx + 2];
        if (r < 180 || g < 180 || b < 180) {
          firstTextPixelDist = rawInfo.width - 1 - x;
          break;
        }
      }
      if (firstTextPixelDist !== null) break;
    }

    const safeDistanceCanvasPx = firstTextPixelDist;
    const safeDistanceCssPx = safeDistanceCanvasPx !== null ? safeDistanceCanvasPx / 2 : null; // html2canvas scale 2

    // Save metrics JSON
    const reportMetrics = {
      ...sc,
      ...domMetrics,
      canvasDimensions: { width: meta.width, height: meta.height },
      safeDistanceCanvasPx,
      safeDistanceCssPx,
      isFullyInsideCanvas: sc.marker ? (safeDistanceCanvasPx ?? 0) >= 10 : true,
      hash: fileHash,
      sameBlobHash: fileHash === blobHash
    };

    writeFileSync(resolve(directory, `${sc.id}-metrics.json`), JSON.stringify(reportMetrics, null, 2));

    // Mandatory criteria verification:
    // 1. Source and marker overflow must be false
    expect(domMetrics.sourceOverflow).toBe(false);
    expect(domMetrics.markerOverflow).toBe(false);

    // 2. If marker is present:
    if (sc.marker) {
      expect(domMetrics.markerRightClearance).toBeGreaterThanOrEqual(10);
      expect(safeDistanceCanvasPx).not.toBeNull();
      // Safe distance from canvas boundary must be positive and substantial (>= 10 canvas px = >= 5 CSS px)
      expect(safeDistanceCanvasPx!).toBeGreaterThanOrEqual(10);
    }
  });
}
