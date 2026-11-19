import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['m22b-demucs-worker-mixer.spec.ts'],
  outputDir: './test-results/m22b-playwright-output',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/m22b-html-report' }],
  ],
  use: {
    channel: 'chrome',
    headless: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
