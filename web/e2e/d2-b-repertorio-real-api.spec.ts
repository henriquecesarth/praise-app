import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiUrl = process.env.D2B_API_URL;
const authToken = process.env.D2B_AUTH_TOKEN;
const ministryId = process.env.D2B_MINISTRY_ID || 'd2b-ministry-a';
const evidenceDir = fileURLToPath(new URL('../test-results/d2-b-repertorio', import.meta.url));

test.skip(!apiUrl || !authToken, 'Set D2B_API_URL and D2B_AUTH_TOKEN from the loopback emulator fixture.');

test('D2-B real API: responsive repertoire search, save/reopen, versions, links and legacy song', async ({ page }) => {
  const fixtureApiUrl = new URL(apiUrl!);
  expect(['127.0.0.1', 'localhost']).toContain(fixtureApiUrl.hostname);
  expect(fixtureApiUrl.protocol).toBe('http:');
  expect(fixtureApiUrl.port).toBe('4317');
  expect(fixtureApiUrl.pathname.replace(/\/$/, '')).toBe('/api/v1');
  expect(ministryId).toBe('d2b-ministry-a');

  await page.addInitScript(({ token }) => {
    localStorage.setItem('praise_auth_token', token);
    if (!localStorage.getItem('praise_theme')) {
      localStorage.setItem('praise_theme', 'light');
    }
  }, { token: authToken! });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/repertorio');
  await expect(page.getByRole('button', { name: /Nova Música/i })).toBeVisible();

  await page.getByRole('button', { name: /Nova Música/i }).click();
  await expect(page.getByRole('dialog', { name: 'Nova Música' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Nova Música' })).toHaveCount(0);
  await page.getByRole('button', { name: /Nova Música/i }).click();
  await expect(page.getByRole('dialog', { name: 'Nova Música' })).toBeVisible();
  await page.getByLabel(/Título da Música/i).fill('Browser Acceptance Song');
  await page.getByLabel(/Artista/i).fill('Fixture Artist');
  await page.getByRole('button', { name: /Salvar Música/i }).click();
  await expect(page.getByRole('dialog', { name: 'Nova Música' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Abrir música Browser Acceptance Song/i })).toBeVisible();

  await page.getByRole('button', { name: /Abrir música Browser Acceptance Song/i }).click();
  await expect(page).toHaveURL(/\/repertorio\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Browser Acceptance Song' })).toBeVisible();

  const root = `${fixtureApiUrl.origin}${fixtureApiUrl.pathname.replace(/\/$/, '')}/ministries/${ministryId}`;
  const createdResponse = await page.request.get(`${root}/songs?search=Browser%20Acceptance%20Song`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(createdResponse.ok()).toBeTruthy();
  const createdBody = await createdResponse.json();
  const created = (createdBody.data as Array<{ id: string; versions?: Array<{ id: string; name: string; links?: Array<{ label: string }> }> }>)[0];
  expect(created).toBeTruthy();
  const songId = created.id;

  const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }];
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => localStorage.setItem('praise_theme', selectedTheme), theme);
    await page.goto('/repertorio');
    await expect(page.getByRole('button', { name: /Abrir música Browser Acceptance Song/i })).toBeVisible();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(evidenceDir, `real-api-library-${viewport.width}x${viewport.height}-${theme}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: /Abrir música Browser Acceptance Song/i }).click();
    await expect(page.getByRole('heading', { name: 'Browser Acceptance Song' })).toBeVisible();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(evidenceDir, `real-api-detail-${viewport.width}x${viewport.height}-${theme}.png`), fullPage: true });
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => localStorage.setItem('praise_theme', selectedTheme), theme);
    await page.reload();
    await page.getByRole('button', { name: /Editar música Browser Acceptance Song/i }).click();
    await expect(page.getByRole('dialog', { name: 'Editar Música' })).toBeVisible();
    await page.getByLabel(/Observações Gerais/i).fill('Updated in the browser and persisted by the local API.');
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(evidenceDir, `real-api-song-modal-${viewport.width}x${viewport.height}-${theme}.png`) });
    }
    if (theme === 'light') {
      await page.getByRole('button', { name: /Adicionar Versão/i }).click();
      await expect(page.getByRole('dialog', { name: /Editar Versão da Música/i })).toBeVisible();
      await page.getByLabel(/Nome da Versão/i).fill('Browser Acoustic Version');
      await page.getByLabel(/^Tom/i).selectOption('E');
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.screenshot({ path: path.join(evidenceDir, `real-api-version-modal-${viewport.width}x${viewport.height}-${theme}.png`) });
      }
      await page.getByRole('button', { name: 'Salvar Versão' }).click();
      await expect(page.getByRole('dialog', { name: /Editar Versão da Música/i })).toHaveCount(0);
      await page.getByRole('button', { name: /Salvar Música/i }).click();
      await expect(page.getByRole('dialog', { name: 'Editar Música' })).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: /Adicionar Versão/i }).click();
      await expect(page.getByRole('dialog', { name: /Editar Versão da Música/i })).toBeVisible();
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.screenshot({ path: path.join(evidenceDir, `real-api-version-modal-${viewport.width}x${viewport.height}-${theme}.png`) });
      }
      await page.getByRole('button', { name: 'Fechar edição de versão' }).click();
      await expect(page.getByRole('dialog', { name: /Editar Versão da Música/i })).toHaveCount(0);
      await page.getByRole('button', { name: /Salvar Música/i }).click();
      await expect(page.getByRole('dialog', { name: 'Editar Música' })).toHaveCount(0);
    }
  }

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Browser Acceptance Song' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Browser Acoustic Version/i })).toBeVisible();
  const persistedResponse = await page.request.get(`${root}/songs/${songId}`, { headers: { Authorization: `Bearer ${authToken}` } });
  expect(persistedResponse.ok()).toBeTruthy();
  await expect((await persistedResponse.json()).data.notes).toContain('persisted by the local API');

  const legacyResponse = await page.request.post(`${root}/songs`, {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    data: { title: 'Browser Legacy Song', artist: 'Fixture Artist', original_key: 'C', youtube_url: 'https://youtube.com/watch?v=legacy', chord_sheet_url: 'https://example.test/chords' },
  });
  expect(legacyResponse.ok()).toBeTruthy();
  const legacyBody = await legacyResponse.json();
  const legacyId = legacyBody.data.id as string;
  await page.goto(`/repertorio/${legacyId}`);
  await expect(page.getByRole('heading', { name: 'Browser Legacy Song' })).toBeVisible();

  const deleteResponse = await page.request.delete(`${root}/songs/${legacyId}`, { headers: { Authorization: `Bearer ${authToken}` } });
  expect(deleteResponse.status()).toBe(204);
  const removeResponse = await page.request.delete(`${root}/songs/${songId}`, { headers: { Authorization: `Bearer ${authToken}` } });
  expect(removeResponse.status()).toBe(204);
});
