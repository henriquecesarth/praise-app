import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const directory = resolve(process.env.SMART_CHORD_GATE2_EVIDENCE_DIR || '../docs/exec-plans/evidence/m20-c14-gate2');
const sizes = [[1920, 1080], [1366, 768], [768, 1024], [390, 844]];
for (const theme of ['light', 'dark'] as const) for (const [width, height] of sizes) {
  test(`Gate 2 ${width} ${theme}`, async ({ page }) => {
    page.on('pageerror', error => console.log('PAGE_ERROR', error.message));
    await page.setViewportSize({ width, height });
    await seedAuthenticatedSession(page, theme);
    await installMockApi(page);
    const chord = { id: 'gate2', title: 'Caminho de luz', artist_name: 'Equipe LouvAIO', original_key: 'C', content: '[Intro]\n[| C | G | Am | F |]\n\n[C]Hoje eu quero [G]cantar\n[Am]Uma nova [F]melodia\n\n[C]Com alegria e [G]esperanca\ne|--0h2--3--0--|', created_at: '2026-11-04', updated_at: '2026-11-04' };
    await page.route(/\/smart-chords(?:\?|\/|$)/, route => new URL(route.request().url()).pathname.startsWith('/src/') ? route.fallback() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [chord] }) }));
    mkdirSync(directory, { recursive: true });
    await page.goto('/cifras');
    if (!process.env.SMART_CHORD_SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(directory, `${width}-${theme}-initial.png`) });
    await expect(page.getByText(chord.title, { exact: true })).toBeVisible();
    if (!process.env.SMART_CHORD_SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(directory, `${width}-${theme}-library.png`) });
    await page.getByText(chord.title, { exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Conteúdo bracket da cifra' });
    await expect(editor).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar cifra', exact: true })).toBeInViewport();
    await expect(page.getByTestId('pdf-settings-panel')).not.toBeVisible();
    expect(await editor.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(width > 1000 ? 700 : 250);
    if (!process.env.SMART_CHORD_SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(directory, `${width}-${theme}-editor.png`) });
    await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.getByTestId('reading-lines')).toBeVisible();
    await page.getByRole('button', { name: 'Transpor um semitom acima' }).click();
    if (!process.env.SMART_CHORD_SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(directory, `${width}-${theme}-reader.png`) });
    await page.getByText('Apar\u00eancia da leitura', { exact: true }).click();
    await expect(page.getByTestId('font-family-select')).toBeVisible();
    await page.getByTestId('font-family-select').selectOption('Arial');
    await page.getByTestId('reading-line-spacing').fill('8');
    await expect(page.getByTestId('reading-lines')).toHaveCSS('gap', '8px');
    await page.getByText('Apar\u00eancia da leitura', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByLabel('Mais ações').click();
    await page.getByTestId('toggle-pdf-settings').click();
    await expect(page.getByTestId('pdf-settings-panel')).toBeVisible();
    await page.getByTestId('modal-pdf-marker-input').fill('Ensaio');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByTestId('pdf-settings-panel')).not.toBeVisible();
    await page.getByLabel('Mais ações').click();
    await page.getByRole('button', { name: 'Editar', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(chord.content);
    await editor.evaluate(element => element.scrollIntoView({ block: 'end' }));
    await expect(page.getByRole('button', { name: 'Salvar cifra', exact: true })).toBeInViewport();
    if (width === 1366 && theme === 'light') {
      await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
      await page.getByRole('button', { name: 'Editar acorde C#', exact: true }).focus();
      await page.keyboard.press('Enter');
      const inlineEditor = page.locator('.smart-chords-reading-sheet input');
      await expect(inlineEditor).toBeVisible();
      await inlineEditor.fill('D');
      await inlineEditor.press('Enter');
      await expect(inlineEditor).toHaveCount(0);
      await page.getByRole('button', { name: 'Editar', exact: true }).click();
      await expect(editor).toContainText('');
      expect(await editor.inputValue()).toContain('D');
    }
  });
}
