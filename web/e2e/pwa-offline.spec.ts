import { expect, test } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

test.use({ serviceWorkers: 'allow' });

test('production service worker serves the privacy-safe offline fallback', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== '390x844-dark', 'PWA lifecycle is exercised once on the representative mobile project.');
  await installMockApi(page);
  await seedAuthenticatedSession(page, 'dark');
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.goto('/repertorio');
  await expect(page.getByRole('button', { name: 'Repertório', exact: true })).toHaveAttribute('aria-current', 'page');
  await context.setOffline(true);
  await page.goto('/offline-check');
  await expect(page.getByRole('heading', { name: 'Você está sem conexão' })).toBeVisible();
  await expect(page.getByText(/não armazena dados privados/i)).toBeVisible();
});
