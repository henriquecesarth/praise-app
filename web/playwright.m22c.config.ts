import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apiOrigin = 'http://127.0.0.1:4315';
const webOrigin = 'http://127.0.0.1:4176';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['m22c-ministry-audio.spec.ts'],
  outputDir: './test-results/m22c-playwright-output',
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: webOrigin,
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
        MINISTRY_AUDIO_SIMULATOR_DIR: join(tmpdir(), 'louvaio-m22c-e2e'),
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
      },
    },
  ],
});
