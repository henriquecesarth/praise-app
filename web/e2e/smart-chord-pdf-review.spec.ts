import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

// Rendering/export proof only: seeded API responses are mocks, not persistence.
test('C4B exports an actual PDF through the product download button', async ({ page }) => {
  test.setTimeout(90000);
  await seedAuthenticatedSession(page, 'dark');
  await installMockApi(page);
  const longTab = `e|--0h2--[7]--12/14${'-'.repeat(140)}--19p17--|`;
  const content = ['[Intro]', '[Bb]Luz no [Eb/G]mar', longTab,
    'B|--3----[7]-----|', 'G|--2----[7]-----|', 'D|--0------------|', 'A|---------------|', 'E|---------------|',
    ...Array.from({ length: 40 }, (_, i) => `[Bb]Linha ${i + 1} com [Ab/Bb]espaços preservados`), '[Final]', '[Bb]Fim'].join('\n');
  const chord = { id: 'c4b-pdf', title: 'C4B - prova sintética', artist_name: 'LouvAIO teste', original_key: 'Bb', content,
    created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z' };
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/c4b-pdf') ? chord : { data: [chord] }),
  }));
  await page.goto('/cifras');
  await page.getByText(chord.title, { exact: true }).click();
  await page.getByRole('button', { name: /Exportar PDF/ }).click();
  await page.getByTestId('modal-font-family-select').selectOption('Arial');
  await expect(page.locator('#printable-sheet-pdf')).toBeVisible();
  await page.waitForFunction(() => typeof (window as unknown as {html2pdf?: unknown}).html2pdf === 'function');
  const baseline = await page.locator('#printable-sheet-pdf [data-musical-tablature]').first().evaluate(el => ({
    font: getComputedStyle(el).fontFamily, text: el.textContent,
    scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
  }));
  const directory = resolve('../docs/exec-plans/evidence/m20-c4b-pdf');
  mkdirSync(directory, { recursive: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Baixar PDF/ }).click();
  await (await download).saveAs(resolve(directory, 'c4b-arial.pdf'));
  writeFileSync(resolve(directory, 'capture.json'), JSON.stringify({ persistence: 'mock', baseline, expectedLongTab: longTab }, null, 2));
  expect(baseline.font.toLowerCase()).toContain('monospace');
  for (const font of ['Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'monospace']) {
    await page.getByTestId('modal-font-family-select').selectOption(font);
    const tab = page.locator('#printable-sheet-pdf [data-musical-tablature]').first();
    expect(await tab.evaluate(el => getComputedStyle(el).fontFamily)).toContain('monospace');
    await expect(tab).toHaveText(longTab);
    const nextDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: /Baixar PDF/ }).click();
    await (await nextDownload).saveAs(resolve(directory, `c4b-${font.toLowerCase().replaceAll(' ', '-')}.pdf`));
  }
});
