// Work around Flutter 3.47 Windows browser-test CanvasKit path404 without
// changing the SDK or product. Run after Flutter launches its test browser.
// Usage: node mobile/tool/m20_c7_auth_browser_driver.mjs <CDP port> <CanvasKit dir>
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('playwright');
const [port, canvasKitDirectory] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? '') || !canvasKitDirectory) throw new Error('Expected CDP port and local CanvasKit directory.');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => candidate.url().includes('/static/index.html'));
if (!page) throw new Error('Flutter test browser host is not present.');
await context.route('**/canvaskit/**', async (route) => {
  const relative = new URL(route.request().url()).pathname.split('/canvaskit/')[1];
  if (!/^(chromium\/)?canvaskit\.(js|wasm)$/.test(relative ?? '')) return route.continue();
  const body = await readFile(path.join(canvasKitDirectory, ...relative.split('/')));
  await route.fulfill({ status: 200, body, contentType: relative.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
});
page.on('pageerror', (error) => console.log('Browser error:', error.message));
const iframe = await page.waitForSelector('iframe', { timeout: 15000 });
const frame = await iframe.contentFrame();
await frame.goto(frame.url(), { waitUntil: 'domcontentloaded', timeout: 15000 });
console.log('Flutter test iframe reloaded with SDK-local CanvasKit routing.');
await new Promise((resolve) => {
  const timeout = setTimeout(resolve, 90000);
  browser.on('disconnected', () => { clearTimeout(timeout); resolve(); });
});
await browser.close().catch(() => {});
