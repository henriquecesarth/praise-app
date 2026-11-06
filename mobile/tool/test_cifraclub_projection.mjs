// Directed fixture tests for the exact shipped DOM script + unchanged TS parser.
// These are NOT Android/source E2E evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '../../web/node_modules/playwright/index.mjs';
import { parseCifraClubHtml } from '../../backend/src/features/smart_chords/cifraclub_html_parser.ts';

const source = readFileSync(new URL('../lib/features/smart_chords/services/cifraclub_dom_capture.dart', import.meta.url), 'utf8');
const script = source.match(/const cifraClubMusicalDomScript = r'''([\s\S]*?)''';/)[1];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let body = '';
  await page.route('https://www.cifraclub.com.br/band/song/', route => route.fulfill({contentType:'text/html; charset=utf-8',body}));
  const music = '  <b>D</b>    <b>A/C#</b>\nUma vida\n[Intro] D G\ne|--0h2--&lt;12&gt;--[7]--|\nB|--3--|\nG|--2--|\nD|--0--|\nA|-----|\nE|-----|\n';
  const base = metadata => `<h1>Song</h1><a href="/band/">Band</a><p><span>Tom:</span> D</p>${metadata}<article><pre>${music}</pre></article>`;
  async function project(html) {
    body = html;
    await page.goto('https://www.cifraclub.com.br/band/song/');
    return JSON.parse(await page.evaluate(script));
  }
  const first = await project(base(''));
  assert.equal(first.ready, true);
  const parsed = parseCifraClubHtml(first.html, page.url());
  assert.equal(parsed.draft.title, 'Song');
  assert.equal(parsed.draft.original_key, 'D');
  assert.ok(parsed.draft.content.includes('<12>--[7]'));
  assert.equal(parsed.lines.filter(row=>row.kind==='tablature').length,6);
  assert.ok(parsed.draft.original_text.startsWith('  D    A/C#\n'));
  const capo = parseCifraClubHtml((await project(base('<p><span>Capotraste:</span> 2</p>'))).html, page.url());
  assert.equal(capo.draft.capo,2);
  assert.equal(capo.draft.original_key,null);
  assert.equal(capo.draft.displayed_key,'D');
  assert.ok(capo.draft.warnings.some(w=>w.code==='MISSING_ORIGINAL_KEY'));
  const original = parseCifraClubHtml((await project(base('<p><span>Capotraste:</span> 2</p><p><span>Tom original:</span> E</p><span id="cifra_versao">Versão: acústica</span>'))).html,page.url());
  assert.equal(original.draft.original_key,'E');
  assert.equal(original.version,'acústica');
  assert.equal((await project(base('<p><span>Capotraste:</span> 99</p>'))).unsupported,true);
  assert.equal((await project(base('<form id="challenge-form"></form>'))).blocked,true);
  assert.equal((await project(base('').replace('<pre>', '<pre><script>void 0</script>'))).unsupported,true);
  assert.equal((await project(base('').replace('Tom:</span> D', 'Tom:</span> X'))).ready,false);
  console.log('DOM_PROJECTION_FIXTURES: PASS (7 checks; not Android E2E)');
} finally { await browser.close(); }
