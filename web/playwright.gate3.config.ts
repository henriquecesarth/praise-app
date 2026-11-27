import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['smart-chord-gate3.spec.ts', 'smart-chord-gate2.spec.ts'], workers: 1,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:4176', channel: 'chrome', serviceWorkers: 'block', trace: 'off' },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4176', url: 'http://127.0.0.1:4176', reuseExistingServer: false },
});
