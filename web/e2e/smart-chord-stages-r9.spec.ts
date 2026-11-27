import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

const evidenceDir = resolve('../docs/exec-plans/evidence/m20-c14-r9');

test('Stage-by-stage diagnostic of PDF export pipeline', async ({ page }) => {
  test.setTimeout(90000);
  mkdirSync(evidenceDir, { recursive: true });

  await page.setViewportSize({ width: 1366, height: 768 });
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);

  const chord = {
    id: 'r9-diagnostic',
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

  await page.goto('/cifras/r9-diagnostic/editar');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).html2pdf === 'function');

  // Intercept html2pdf stages on Worker prototype
  await page.evaluate(() => {
    (window as any).__stageLogs = [];
    const html2pdf = (window as any).html2pdf;
    const WorkerProto = html2pdf.Worker.prototype;
    const origToContainer = WorkerProto.toContainer;
    const origToCanvas = WorkerProto.toCanvas;
    const origToPdf = WorkerProto.toPdf;

    WorkerProto.toContainer = async function () {
      const res = await origToContainer.apply(this);
      const container = this.prop?.container;
      const rect = container?.getBoundingClientRect();
      (window as any).__stageLogs.push({
        stage: 'toContainer',
        containerWidth: rect?.width,
        containerScrollWidth: container?.scrollWidth,
        containerClientWidth: container?.clientWidth,
        pageSize: this.prop?.pageSize
      });
      return res;
    };

    WorkerProto.toCanvas = async function () {
      const res = await origToCanvas.apply(this);
      const canvas: HTMLCanvasElement = this.prop?.canvas;
      (window as any).__stageLogs.push({
        stage: 'toCanvas',
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height
      });
      return res;
    };

    WorkerProto.toPdf = async function () {
      const res = await origToPdf.apply(this);
      (window as any).__stageLogs.push({
        stage: 'toPdf',
        pdfPages: this.prop?.pdf?.internal?.getNumberOfPages ? this.prop.pdf.internal.getNumberOfPages() : null
      });
      return res;
    };
  });

  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await page.getByTestId('modal-font-family-select').selectOption('Arial');
  await page.getByTestId('modal-pdf-marker-input').fill('Min. Infantil IBBP');

  await page.getByRole('button', { name: 'Gerar e visualizar PDF' }).click();
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled({ timeout: 60000 });

  const stageResults = await page.evaluate(() => {
    return {
      stageLogs: (window as any).__stageLogs,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen.width,
        height: window.screen.height
      }
    };
  });

  writeFileSync(
    resolve(evidenceDir, 'before/stage-results.json'),
    JSON.stringify(stageResults, null, 2)
  );

  expect(stageResults.stageLogs.length).toBeGreaterThan(0);
});
