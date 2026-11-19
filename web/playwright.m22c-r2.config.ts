import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// M22-C.2: full Ministry Library flow against the PRIVATE DEVELOPMENT R2 bucket.
// Credentials are read from the local environment only. They are never written to a file or printed.
const required = [
  'MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID',
  'MINISTRY_AUDIO_R2_DEV_BUCKET',
  'MINISTRY_AUDIO_R2_DEV_ACCESS_KEY_ID',
  'MINISTRY_AUDIO_R2_DEV_SECRET_ACCESS_KEY',
];
if (process.env.M22C_R2_LIVE_TESTS !== '1' || process.env.VERCEL || process.env.VERCEL_ENV ||
    required.some((name) => !process.env[name])) {
  throw new Error('BLOCKED: set M22C_R2_LIVE_TESTS=1 and the MINISTRY_AUDIO_R2_DEV_* variables locally (see docs/architecture/m22c1-r2-development.md).');
}

const apiOrigin = 'http://127.0.0.1:4315';
// The only browser origin authorized by the bucket CORS policy.
const webOrigin = 'http://127.0.0.1:5173';
const r2Origin = `https://${process.env.MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['m22c-r2-ministry-audio.spec.ts'],
  outputDir: './test-results/m22c-r2-playwright-output',
  workers: 1,
  timeout: 300_000,
  reporter: 'list',
  use: { baseURL: webOrigin, serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' },
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
        MINISTRY_AUDIO_DIRECT_SIMULATOR: '0',
        MINISTRY_AUDIO_R2_DEV: '1',
        MINISTRY_AUDIO_SIMULATOR_DIR: join(tmpdir(), 'louvaio-m22c-r2-e2e'),
        CORS_ORIGIN: webOrigin,
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: webOrigin,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VERCEL: '',
        VERCEL_ENV: '',
        VITE_API_URL: `${apiOrigin}/api/v1`,
        VITE_MINISTRY_AUDIO_EMULATOR: '1',
        VITE_MINISTRY_AUDIO_DIRECT_SIMULATOR: '0',
        VITE_MINISTRY_AUDIO_R2_ORIGIN: r2Origin,
      },
    },
  ],
});
