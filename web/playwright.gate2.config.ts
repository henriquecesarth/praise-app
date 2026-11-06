import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'smart-chord-gate2.spec.ts', workers: 1,
  timeout: 45000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4175', channel: 'chrome', serviceWorkers: 'block', trace: 'off' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175', url: 'http://127.0.0.1:4175', reuseExistingServer: true },
});
