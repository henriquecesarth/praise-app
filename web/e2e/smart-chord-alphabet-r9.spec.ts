import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const evidenceDir = resolve('../docs/exec-plans/evidence/m20-c14-r9/before');

test('Test ABCDEFGHIJKLMNOP before fix', async ({ page }) => {
  test.setTimeout(90000);
  mkdirSync(evidenceDir, { recursive: true });

  await page.setViewportSize({ width: 1366, height: 768 });
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);

  const chord = {
    id: 'r9-alphabet',
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

  await page.goto('/cifras/r9-alphabet/editar');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).html2pdf === 'function');

  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await page.getByTestId('modal-font-family-select').selectOption('Arial');
  await page.getByTestId('modal-pdf-marker-input').fill('ABCDEFGHIJKLMNOP');

  await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar PDF' }).click();
  const download = await downloadPromise;
  await download.saveAs(resolve(evidenceDir, 'alphabet-before.pdf'));

  const previewImg = page.getByTestId('pdf-preview-pages').locator('img').first();
  const dataUrl = await previewImg.getAttribute('src');
  if (dataUrl) {
    writeFileSync(resolve(evidenceDir, 'alphabet-page-1.jpg'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
});
