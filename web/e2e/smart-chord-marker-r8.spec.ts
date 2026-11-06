import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const directory = resolve(process.env.MARKER_R8_EVIDENCE_DIR || '../docs/exec-plans/evidence/m20-c14-r8');
const cases = [
  { id: 'reported', marker: 'Min. Infantil IBBP', title: 'Meu universo', font: 'Arial', size: 13 },
  { id: 'short', marker: 'IBBP', title: 'Meu universo', font: 'Georgia', size: 10 },
  { id: 'long', marker: 'Ministério Infantil IBBP — Celebração especial com todas as equipes e famílias participantes', title: 'Meu universo', font: 'Verdana', size: 24 },
  { id: 'empty', marker: '', title: 'Meu universo', font: 'Times New Roman', size: 16 },
  { id: 'long-both', marker: 'MinistérioInfantilIBBP'.repeat(10), title: 'MeuUniversoLouvorCelebração'.repeat(12), font: 'Courier New', size: 20 },
  { id: 'mono', marker: 'Min. Infantil IBBP', title: 'Meu universo', font: 'monospace', size: 24 },
];
for (const sample of cases) test(`R8 actual marker ${sample.id}`, async ({ page }) => {
  test.setTimeout(90000); mkdirSync(directory, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await seedAuthenticatedSession(page, 'light'); await installMockApi(page);
  const chord = { id: 'r8-synthetic', title: sample.title, artist_name: 'Equipe sintética', original_key: 'C', content: '[Intro]\n[| C | G | Am | F |]\ne|--0h2--3--0--|\n' + Array.from({ length: sample.id === 'mono' ? 64 : 4 }, () => '[C]Letra sintética [G]alinhada\n[Am]Mais uma [F]linha').join('\n'), created_at: '2026-11-04', updated_at: '2026-11-04' };
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [chord] }) }));
  await page.goto('/cifras/r8-synthetic/editar');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
  await page.getByRole('button', { name: 'Transpor um semitom acima' }).click();
  await page.waitForFunction(() => typeof (window as any).html2pdf === 'function');
  await page.evaluate(() => {
    const original = (window as any).html2pdf;
    (window as any).r8Calls = 0;
    (window as any).r8BlobHash = '';
    (window as any).html2pdf = (...args: unknown[]) => { (window as any).r8Calls++; return original(...args); };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      if (blob instanceof Blob && blob.type === 'application/pdf') {
        (window as any).r8BlobHashPromise = blob.arrayBuffer().then(buffer => crypto.subtle.digest('SHA-256', buffer)).then(hash => { (window as any).r8BlobHash = Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join(''); });
      }
      return create(blob);
    };
  });
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await page.getByTestId('modal-font-family-select').selectOption(sample.font);
  const delta = sample.size - 13;
  for (let n = 0; n < Math.abs(delta); n++) await page.getByTestId(delta > 0 ? 'modal-font-size-increase' : 'modal-font-size-decrease').click();
  await page.getByTestId('modal-pdf-marker-input').fill(sample.marker);
  expect(await page.evaluate(() => (window as any).r8Calls)).toBe(0);
  await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });
  const metrics = await page.locator('#printable-sheet-pdf').evaluate(root => {
    const header = root.querySelector<HTMLElement>('.pdf-header')!;
    const marker = root.querySelector<HTMLElement>('[data-testid="pdf-header-custom-marker"]');
    const r = root.getBoundingClientRect(), h = header.getBoundingClientRect();
    const m = marker?.getBoundingClientRect();
    return { sourceWidth: r.width, headerWidth: h.width, sourceOverflow: root.scrollWidth > root.clientWidth + 1, paddingRight: getComputedStyle(header).paddingRight, markerText: marker?.textContent?.trim() || '', markerRightClearance: m ? r.right - m.right : null, markerOverflow: marker ? marker.scrollWidth > marker.clientWidth + 1 : false, effectiveKey: header.textContent?.includes('Tom: C#'), lineSpacing: getComputedStyle(root.querySelector('[data-testid="pdf-sheet-lines"]')!).gap };
  });
  const preview = page.getByTestId('pdf-preview-pages');
  const image = preview.locator('img').first();
  const data = await image.getAttribute('src');
  writeFileSync(resolve(directory, `${sample.id}-preview-page1.jpg`), Buffer.from(data!.split(',')[1], 'base64'));
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Baixar PDF' }).click();
  const download = await downloadEvent; await download.saveAs(resolve(directory, `${sample.id}.pdf`));
  const hash = createHash('sha256').update(readFileSync(resolve(directory, `${sample.id}.pdf`))).digest('hex');
  const blobHash = await page.evaluate(async () => { await (window as any).r8BlobHashPromise; return (window as any).r8BlobHash; });
  writeFileSync(resolve(directory, `${sample.id}-metrics.json`), JSON.stringify({ ...sample, ...metrics, pages: await preview.locator('img').count(), sameBlobHash: hash === blobHash, hash, engineCalls: await page.evaluate(() => (window as any).r8Calls) }, null, 2));
  expect(hash).toBe(blobHash);
  expect(metrics.effectiveKey).toBe(true);
  expect(metrics.markerText).toBe(sample.marker);
  expect(metrics.lineSpacing).toBe('0px');
  expect(metrics.sourceOverflow).toBe(false);
  expect(metrics.markerOverflow).toBe(false);
  if (sample.marker) expect(metrics.markerRightClearance).toBeGreaterThanOrEqual(1.5);
});
