import { defineConfig } from '@playwright/test';

// M22-E1: real Chromium MP3 decoding and a real Demucs separation started from an MP3. Opt-in only (needs the local ONNX model).
export default defineConfig({
  testDir: './e2e',
  testMatch: ['m22e1-mp3-import.spec.ts'],
  outputDir: './test-results/m22e1-playwright-output',
  timeout: 420_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
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
