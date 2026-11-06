import { defineConfig } from '@playwright/test';

// Explicitly opt-in: real loopback API/Auth/Firestore services, no API fixtures.
export default defineConfig({
  testDir: './e2e', testMatch: 'smart-chord-real-integration.spec.ts',
  workers: 1, retries: 0, timeout: 180000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4175', channel: 'chrome', browserName: 'chromium',
    actionTimeout: 10000, navigationTimeout: 15000,
    serviceWorkers: 'block', trace: 'off', screenshot: 'off', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175', reuseExistingServer: false, timeout: 30000,
    env: { VITE_API_URL: 'http://127.0.0.1:3108/api/v1' } },
});
