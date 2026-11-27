// Browser PoC: runs in the installed Chrome via playwright-core against a local static server.
// Encodes synthetic stems with mediabunny + LAME WASM, decodes with decodeAudioData, and
// measures alignment. No network, no R2, no Demucs.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('./', import.meta.url));
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/browser/index.html?s=${process.env.POC_SECONDS ?? 30}`);
const result = await page.evaluate(() => window.runPoc());
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'vocals.mediabunny.mp3'), Buffer.from(await page.evaluate(() => window.__artifactB64), 'base64'));
result.userAgent = await page.evaluate(() => navigator.userAgent);
await browser.close();
server.close();
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'browser-report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary, null, 2));
