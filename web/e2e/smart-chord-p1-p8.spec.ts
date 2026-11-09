import { expect, test } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const source = '{{Só violão}}\n{{^Entrada: baixo}}\n[C(add9)/E]Luz  [G]vem\n| C7(b9) (Am) | % N.C. 2x |\n| 4/4 [1. B♭ F♯ | 𝄐 𝄽 :||\ne|--0h2--3--0--|\n  Texto   com espaços\n' + Array.from({ length: 45 }, (_, i) => `[C]Linha ${i + 1} de paginação [G]A4`).join('\n') + '\n';

test('inline bar edits preserve annotations and every untouched source character across save and reopen', async ({ page }) => {
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);
  const original = 'Antes\r\n| C{{nota}}7 | Am |\r\nDepois  \r\n';
  let stored = { id: 'inline-preserve-local', title: 'Compassos preservados', original_key: 'C', content: original };
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, async route => {
    if (route.request().method() === 'PUT') stored = { ...stored, ...route.request().postDataJSON() };
    const detail = new URL(route.request().url()).pathname.endsWith('/inline-preserve-local');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(detail ? stored : { data: [stored] }) });
  });
  await page.goto('/cifras');
  await page.getByText(stored.title, { exact: true }).click();

  const input = page.getByTestId('inline-chord-input');
  await page.getByRole('button', { name: /^Editar acorde C$/ }).click();
  await expect(input).toHaveValue('C');
  await input.fill('D');
  await input.press('Enter');
  const editedFirst = 'Antes\r\n| D{{nota}}7 | Am |\r\nDepois  \r\n';
  await expect(page.getByRole('button', { name: /^Editar acorde D$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await expect.poll(() => stored.content).toBe(editedFirst);

  await page.getByRole('button', { name: /Editar acorde Am/ }).click();
  await expect(input).toHaveValue('Am');
  await input.fill('Bm');
  await input.press('Enter');
  const editedSecond = 'Antes\r\n| D{{nota}}7 | Bm |\r\nDepois  \r\n';
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await expect.poll(() => stored.content).toBe(editedSecond);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const editor = page.locator('textarea').first();
  await expect(editor).toHaveValue(editedSecond.replace(/\r\n/g, '\n'));
  expect(stored.content).toBe(editedSecond);
});

test('isolated save/reopen preserves source and real PDF renders advanced notation', async ({ page }, info) => {
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);
  // Stateful isolated API: writes never reach a provider or production.
  let stored = { id: 'notation-local', title: 'Notação P1–P8', original_key: 'C', content: source, created_at: '2026-11-09', updated_at: '2026-11-09' };
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, async route => {
    if (route.request().method() === 'PUT') stored = { ...stored, ...route.request().postDataJSON() };
    const detail = new URL(route.request().url()).pathname.endsWith('/notation-local');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(detail ? stored : { data: [stored] }) });
  });
  await page.goto('/cifras');
  await page.getByText(stored.title, { exact: true }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Conteúdo bracket da cifra' });
  await expect(editor).toHaveValue(source);
  const edited = source + '[D]Final\n{{^Entrada: baixo final}}\n[C]\n';
  await editor.fill(edited);
  const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/smart-chords/notation-local'));
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await saved;
  expect(stored.content).toBe(edited);
  await page.reload();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(editor).toHaveValue(stored.content);
  await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const reader = page.getByTestId('reading-sheet-scroll');
  await expect(reader).toContainText('Só violão');
  await expect(reader).not.toContainText('{{');
  await expect(reader).toContainText('C7(b9)');
  await page.getByRole('button', { name: 'Transpor um semitom acima', exact: true }).click();
  await page.getByRole('button', { name: 'Transpor um semitom acima', exact: true }).click();
  await expect(reader).toContainText('D7(b9)');
  await expect(reader).toContainText('D(add9)/F#');
  const chordBoxes = await reader.locator('.print-chord-span').evaluateAll(nodes => nodes.slice(0, 2).map(node => {
    const box = node.getBoundingClientRect(); return { left: box.left, right: box.right };
  }));
  expect(chordBoxes).toHaveLength(2);
  expect(chordBoxes[0].right).toBeLessThanOrEqual(chordBoxes[1].left + 1);
  const anchor = reader.locator('[data-notation-anchor]').first();
  await expect(anchor).toHaveText('baixo');
  await expect(reader.locator('[data-notation-anchor]').filter({ hasText: 'baixo final' })).toHaveCount(1);
  const placement = await anchor.evaluate(node => ({ anchorBottom: node.getBoundingClientRect().bottom, chordTop: node.parentElement!.getBoundingClientRect().top }));
  expect(placement.anchorBottom).toBeLessThanOrEqual(placement.chordTop + 1);
  expect(stored.content).toBe(edited);
  await reader.screenshot({ path: info.outputPath('reader.png') });
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
  const pdfBoxes = await page.locator('#printable-sheet-pdf .print-chord-span').evaluateAll(nodes => nodes.slice(0, 2).map(node => {
    const box = node.getBoundingClientRect(); return { left: box.left, right: box.right };
  }));
  expect(pdfBoxes).toHaveLength(2);
  expect(pdfBoxes[0].right).toBeLessThanOrEqual(pdfBoxes[1].left + 1);
  const preview = page.getByTestId('pdf-preview-dialog');
  await expect(preview.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });
  expect(Number((await page.getByTestId('pdf-page-count').innerText()).match(/\d+/)?.[0])).toBeGreaterThan(1);
  await preview.screenshot({ path: info.outputPath('pdf-preview.png') });
  const download = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Baixar PDF' }).click();
  await (await download).saveAs(info.outputPath('notation.pdf'));
  expect(stored.content).toBe(edited);
});

test('metadata save preserves CRLF, tabs and trailing source bytes', async ({ page }) => {
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);
  const original = source.replace(/\n/g, '\r\n') + '\t  \r\n';
  let stored = { id: 'raw-local', title: 'Fonte exata', original_key: 'C', content: original };
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, async route => {
    if (route.request().method() === 'PUT') stored = { ...stored, ...route.request().postDataJSON() };
    const detail = route.request().method() === 'PUT' || new URL(route.request().url()).pathname.endsWith('/raw-local');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(detail ? stored : { data: [stored] }) });
  });
  await page.goto('/cifras');
  await page.getByText(stored.title, { exact: true }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Título *', { exact: true }).fill('Fonte exata revisada');
  const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/smart-chords/'));
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await response;
  expect(stored.content).toBe(original);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeVisible();
  expect(stored.content).toBe(original);
});
