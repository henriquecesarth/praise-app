import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['m22a-demucs-onnx-browser.spec.ts'],
  outputDir: './test-results/m22a-playwright-output',
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/m22a-html-report', open: 'never' }],
  ],
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
  },
});
