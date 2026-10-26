import { defineConfig } from '@playwright/test';

const viewports = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
];

// Separate worktrees must not silently reuse a preview started from a different HEAD.
// Allocate a distinct port per concurrent E2E run. Reuse must be explicitly opted in.
const requestedPort = Number(process.env.LOUVAIO_E2E_PORT || '4173');
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
  throw new Error('LOUVAIO_E2E_PORT must be an integer between 1024 and 65535');
}
const previewUrl = `http://127.0.0.1:${requestedPort}`;
const canReuseServer = process.env.LOUVAIO_E2E_REUSE_SERVER === '1' && !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: previewUrl,
    browserName: 'chromium',
    channel: 'chrome',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: viewports.flatMap((viewport) => ['light', 'dark'].map((theme) => ({
    name: `${viewport.name}-${theme}`,
    use: {
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme as 'light' | 'dark',
    },
  }))),
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${requestedPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: canReuseServer,
    timeout: 120_000,
  },
});
