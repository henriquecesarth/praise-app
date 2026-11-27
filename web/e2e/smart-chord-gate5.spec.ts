import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const directory = resolve('../docs/exec-plans/evidence/m20-c14-gate5');
const remote = 'https://praise-qvjml6wfi-henriquecesarths-projects.vercel.app';
test('SIMULATED API delayed save cannot navigate back into an abandoned editor', async ({ page }) => {
  await seedAuthenticatedSession(page, 'light'); await installMockApi(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const chord = { id: 'late-save', title: 'Cifra sintética lenta', original_key: 'C', content: '[C]Texto original', created_at: '2026-11-04', updated_at: '2026-11-04' };
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, async route => {
    if (route.request().method() === 'PUT') {
      await pending;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...chord, ...route.request().postDataJSON() }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [chord] }) });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/cifras/late-save/editar');
  await page.getByRole('textbox', { name: 'Conteúdo bracket da cifra' }).fill('[D]Conteúdo com salvamento atrasado');
  const sent = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes('/smart-chords/late-save'));
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click(); await sent;
  await page.getByRole('button', { name: /Biblioteca/ }).click(); await expect(page).toHaveURL(/\/cifras$/);
  const response = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/smart-chords/late-save'));
  release(); await response;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/\/cifras$/);
  await expect(page.locator('.smart-chords-workspace')).toHaveAttribute('data-has-selection', 'false');
});

test('real Preview browser boundary without credentials or writes', async ({ page, request }) => {
  mkdirSync(directory, { recursive: true });
  const health = await request.get(`${remote}/api/health`, { timeout: 20000 });
  const publicHealth = await health.json();
  const auth = await request.get(`${remote}/api/v1/auth/me`, { headers: { Origin: 'http://127.0.0.1:4176' }, timeout: 20000 });
  await page.goto('/cifras');
  const browser = await page.evaluate(async url => {
    try { const response = await fetch(url, { credentials: 'omit' }); return { readable: true, status: response.status }; }
    catch (error) { return { readable: false, error: error instanceof Error ? error.message : 'fetch failed' }; }
  }, `${remote}/api/v1/auth/me`);
  writeFileSync(resolve(directory, 'real-preview-preflight.json'), JSON.stringify({
    health: { status: health.status(), service: publicHealth.service, preview: publicHealth.preview },
    unauthenticatedApi: { status: auth.status(), allowOrigin: auth.headers()['access-control-allow-origin'] || null },
    localBrowser: browser, authenticatedStaging: 'NOT_EXECUTED',
    stagingProjectRuntimeIdentity: 'Unknown / Not yet verified',
    credentialsUsed: false, remoteWrites: 0,
  }, null, 2));
  expect(health.status()).toBe(200);
  expect(auth.status()).toBe(401);
  // This is boundary evidence, not a successful authenticated integration test.
  test.info().annotations.push({ type: 'staging-boundary', description: browser.readable ? 'API reachable; no authorized synthetic session supplied' : 'BLOCKED: local browser cannot read Preview response' });
});

test('SIMULATED API integrated CRUD, refresh, failed save, navigation and UI timings', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seedAuthenticatedSession(page, 'light'); await installMockApi(page);
  mkdirSync(directory, { recursive: true });
  let stored: Record<string, unknown> | null = null;
  let failSave = false;
  let releaseInitialList!: () => void;
  const initialList = new Promise<void>(resolve => { releaseInitialList = resolve; });
  let firstList = true;
  const writes: Array<{ method: string; id: string }> = [];
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, async route => {
    const method = route.request().method();
    const id = new URL(route.request().url()).pathname.split('/').pop() || '';
    if (method === 'POST' || method === 'PUT') {
      writes.push({ method, id });
      if (failSave) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Synthetic save failure' } }) });
      stored = { ...route.request().postDataJSON(), id: 'gate5-synthetic', user_id: 'user-1', created_at: '2026-11-04', updated_at: '2026-11-04' };
      return route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(stored) });
    }
    if (method === 'GET' && firstList) { firstList = false; await initialList; }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: stored ? [stored] : [] }) });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/cifras');
  await expect(page.getByText('Carregando...', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: resolve(directory, 'library-loading-1366.png') });
  releaseInitialList();
  await page.getByRole('button', { name: 'Criar Cifra', exact: true }).click();
  await expect(page).toHaveURL(/\/cifras\/nova$/);
  const editor = page.getByRole('textbox', { name: 'Conteúdo bracket da cifra' });
  await page.getByLabel('Título *', { exact: true }).fill('Gate 5 sintética');
  await page.getByLabel('Artista', { exact: true }).fill('Equipe de teste');
  await page.getByLabel('Tom Original *', { exact: true }).selectOption('D');
  await editor.fill('[D]Texto de teste [A]alinhado\ne|--0h2--3--0--|');
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await expect(page).toHaveURL(/\/cifras\/gate5-synthetic\/editar$/);
  await page.reload();
  await expect(editor).toHaveValue('[D]Texto de teste [A]alinhado\ne|--0h2--3--0--|');
  await expect(page.getByLabel('Artista', { exact: true })).toHaveValue('Equipe de teste');
  await expect(page.getByLabel('Título *', { exact: true })).toHaveValue('Gate 5 sintética');
  await expect(page.getByLabel('Tom Original *', { exact: true })).toHaveValue('D');
  await editor.fill('[D]Texto editado [A]preservado');
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Salvo');
  await page.reload(); await expect(editor).toHaveValue('[D]Texto editado [A]preservado');
  failSave = true;
  await editor.fill('[D]Texto mantido após falha');
  const errorDialog = page.waitForEvent('dialog', dialog => dialog.type() === 'alert' && dialog.message().includes('Synthetic save failure'));
  await page.getByRole('button', { name: 'Salvar cifra', exact: true }).click();
  await errorDialog;
  await expect(editor).toHaveValue('[D]Texto mantido após falha');
  await expect(page.getByRole('status')).toContainText('Alterações');
  await page.screenshot({ path: resolve(directory, 'save-error-pending-1366.png') });
  await editor.fill('[D]Texto mantido após falha\n' + Array.from({ length: 60 }, () => '[D]Linha sintética de desempenho [A]com acordes').join('\n'));
  const editorInitialCharacters = (await editor.inputValue()).length;
  const typingMs: number[] = [], modeRoundTripMs: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    await editor.pressSequentially(' texto sintético', { delay: 0 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    typingMs.push(performance.now() - started);
    const modeStart = performance.now();
    await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
    await expect(page.getByTestId('reading-lines')).toBeVisible();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(editor).toBeVisible(); modeRoundTripMs.push(performance.now() - modeStart);
  }
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Exportar PDF', exact: true })).toContainText('mesmo sem salvar');
  const markerStart = performance.now();
  await page.getByTestId('modal-pdf-marker-input').pressSequentially('Marcador sintético de homologação', { delay: 0 });
  const markerTypingMs = performance.now() - markerStart;
  await page.waitForFunction(() => typeof (window as any).html2pdf === 'function');
  await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#printable-sheet-pdf')).toContainText('Texto mantido após falha');
  expect(stored).toMatchObject({ content: '[D]Texto editado [A]preservado' });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Alterações');
  await page.getByRole('button', { name: /Biblioteca/ }).click();
  await expect(page).toHaveURL(/\/cifras$/);
  await page.goBack();
  await expect(editor).toHaveValue('[D]Texto editado [A]preservado');
  writeFileSync(resolve(directory, 'simulated-integration-and-timings.json'), JSON.stringify({
    backend: 'SIMULATED API ONLY', persistedDuringTest: stored, writes,
    timings: { unit: 'ms', environment: 'Windows, local production Vite preview, Playwright driver; includes transport/autowait and rendering, not isolated CPU latency', browserVersion: page.context().browser()?.version(), nodeVersion: process.version, editorInitialCharacters, editorTyping16Characters: typingMs, editViewRoundTrip: modeRoundTripMs, markerTypingMs },
  }, null, 2));
});
