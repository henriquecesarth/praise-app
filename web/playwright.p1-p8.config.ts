import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'smart-chord-p1-p8.spec.ts', workers: 1,
  timeout: 120000, reporter: 'list', outputDir: 'test-results/p1-p8',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: 'chrome', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
