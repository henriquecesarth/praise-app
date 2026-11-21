import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apiOrigin = 'http://127.0.0.1:4315';
const webOrigin = 'http://127.0.0.1:4176';
const browserChannel = process.env.M22C_E2E_BROWSER_CHANNEL === 'chrome' ? 'chrome' : undefined;
const directSimulator = process.env.MINISTRY_AUDIO_DIRECT_SIMULATOR === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['m22c-ministry-audio.spec.ts', 'm22c-local-separation.spec.ts'],
  outputDir: './test-results/m22c-playwright-output',
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: webOrigin,
    // Opt-in system browser: M22C_E2E_BROWSER_CHANNEL=chrome. Unset keeps Playwright's bundled Chromium.
    ...(browserChannel ? { channel: browserChannel } : {}),
    serviceWorkers: 'block',
  },
  webServer: [
    {
      cwd: '../backend',
      command: 'npx --no-install tsx -e "import app from \'./src/app\'; app.listen(4315, \'127.0.0.1\')"',
      url: `${apiOrigin}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        VERCEL: '',
        VERCEL_ENV: '',
        PREVIEW_MODE: 'false',
        LOUVAIO_LOCAL_EMULATORS: '1',
        FIREBASE_PROJECT_ID: 'demo-louvaio-unit',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9098',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8186',
        METADATA_SERVER_DETECTION: 'none',
        MINISTRY_AUDIO_EMULATOR: '1',
        MINISTRY_AUDIO_DIRECT_SIMULATOR: directSimulator ? '1' : '0',
        MINISTRY_AUDIO_DIRECT_SIMULATOR_ORIGIN: apiOrigin,
        MINISTRY_AUDIO_SIMULATOR_DIR: join(tmpdir(), 'louvaio-m22c-e2e', directSimulator ? 'direct' : 'proxy'),
        CORS_ORIGIN: webOrigin,
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4176 --strictPort',
      url: webOrigin,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VERCEL: '',
        VERCEL_ENV: '',
        VITE_API_URL: `${apiOrigin}/api/v1`,
        VITE_MINISTRY_AUDIO_EMULATOR: '1',
        VITE_MINISTRY_AUDIO_DIRECT_SIMULATOR: directSimulator ? '1' : '0',
      },
    },
  ],
});
