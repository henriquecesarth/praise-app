import { expect, test, type APIResponse, type BrowserContext } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = 'http://127.0.0.1:3108/api/v1';
const DB = 'http://127.0.0.1:18080/v1/projects/demo-m20-c4c/databases/(default)/documents';
const CONTROL = 'http://127.0.0.1:18081';
test.skip(process.env.M20_C4C_REAL !== '1', 'Opt-in real demo emulators required');
interface Account { token: string; user: { id: string }; }
interface Draft { title: string; artist_name: string; original_key: string; content: string; displayed_key?: string; capo?: number; }
interface Stored extends Draft { id: string; user_id: string; }
async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status()).toBe(status);
  return await response.json() as T;
}

test('C4C real Web, authenticated API, emulator persistence and stored-content security', async ({ browser, request }) => {
  const report: Record<string, unknown> = { environment: 'local real app + Auth/Firestore emulators',
    project: 'demo-m20-c4c', persistence_mocks: false, hosted_persistence: 'NOT_EXECUTED' };
  const contexts: BrowserContext[] = [];
  const suffix = Date.now().toString();
  const password = 'C4c-local-test-only-52!';
  const email = `c4c-a-${suffix}@example.test`;
  const a = await json<Account>(await request.post(`${API}/auth/signup`, { data: { name: 'C4C A', email, password } }), 201);
  const b = await json<Account>(await request.post(`${API}/auth/signup`, { data: { name: 'C4C B', email: `c4c-b-${suffix}@example.test`, password } }), 201);
  const call = (path: string, token: string, method = 'GET', data?: unknown) => request.fetch(`${API}${path}`, {
    method, data, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
  });
  await json(await call('/auth/me', a.token));
  expect((await request.get(`${API}/smart-chords`)).status()).toBe(401);
  const m1 = await json<{id: string}>(await call('/ministries', a.token, 'POST', { name: 'C4C shared' }), 201);
  const m2 = await json<{id: string}>(await call('/ministries', a.token, 'POST', { name: 'C4C private' }), 201);
  const invite = await json<{code: string}>(await call(`/ministries/${m1.id}/invites`, a.token, 'POST', {}), 201);
  await json(await call('/ministries/join', b.token, 'POST', { code: invite.code }));
  const deniedRequests: string[] = [];
  async function session(token: string) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    contexts.push(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' && ['4175', '3108'].includes(url.port)) return route.continue();
      deniedRequests.push(url.hostname);
      return route.abort(); // Network guard, never a mocked application response.
    });
    await context.addInitScript(value => {
      localStorage.setItem('praise_auth_token', value);
      Reflect.set(window, '__c4cXSS', 0);
    }, token);
    return context;
  }
  try {
    const context = await session(a.token);
    const page = await context.newPage();
    await page.goto('/cifras');
    await expect(page.getByRole('heading', { name: 'Minhas Cifras' })).toBeVisible();
    const title = '<img src=x onerror=window.__c4cXSS++>C4C';
    const artist = '<svg onload=window.__c4cXSS++>Artista';
    const tabs = ['e', 'B', 'G', 'D', 'A', 'E'].map(s => `  ${s}|--0h2--[7]--12/14--|`);
    const body = ['Tom: Bb', '[Intro]', '||: Bb | Eb/G | % :||', ...tabs,
      'Bb     Ab/Bb', 'Luz no mar', '[Interlúdio]', '[Bb]Fim',
      '<script>window.__c4cXSS++</script>', '<img src="https://c4c.invalid/pixel" onerror="window.__c4cXSS++">',
      '<svg/onload="window.__c4cXSS++">', '<a href="javascript:window.__c4cXSS++">link</a>',
      '<a href="data:text/html,<script>window.__c4cXSS++</script>">data</a>',
      '<iframe srcdoc="<script>window.__c4cXSS++</script>"></iframe>', '<<img onerror=window.__c4cXSS++'].join('\n');
    const html = `<h1 onclick="window.__c4cXSS++">&lt;img src=x onerror=window.__c4cXSS++&gt;C4C<img src="https://c4c.invalid/pixel" onerror="window.__c4cXSS++"></h1><h2>&lt;svg onload=window.__c4cXSS++&gt;Artista</h2><div id="cifra_tom">Tom: Bb</div><div id="cifra_tom_original">Tom original: Bb</div><div id="cifra_capo">Capo: 0</div><script>window.__c4cXSS++</script><div><svg onload="window.__c4cXSS++"><foreignObject><img src=x onerror="window.__c4cXSS++">`;
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await page.getByRole('button', { name: 'Colar Texto', exact: true }).click();
    const textarea = page.locator('textarea.form-control');
    await textarea.evaluate((node, value) => {
      const data = new DataTransfer(); data.setData('text/html', value.html); data.setData('text/plain', value.body);
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    }, { html, body });
    await textarea.fill(body);
    const imported = page.waitForResponse(r => r.url() === `${API}/smart-chords/import/text` && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Analisar e Pré-visualizar Texto' }).click();
    const draft = await (await imported).json() as Draft;
    expect(draft).toMatchObject({ title, artist_name: artist, original_key: 'Bb', capo: 0 });
    for (const tab of tabs) expect(draft.content.split('\n')).toContain(tab);
    expect(draft.content).toContain('[Intro]'); expect(draft.content).toContain('[Interlúdio]');
    expect(draft.content).toContain('Eb/G'); expect(draft.content).toContain('Ab/Bb');
    await expect(page.getByLabel('Título da Cifra', { exact: true })).toHaveValue(title);
    expect((await json<{data: Stored[]}>(await call('/smart-chords', a.token))).data).toHaveLength(0);
    console.log('C4C_STAGE=real_preview_no_write');
    await page.getByRole('button', { name: 'Visualização Alinhada' }).click();
    expect(await page.evaluate(() => Reflect.get(window, '__c4cXSS'))).toBe(0);
    // A real repository write fails at the test transport; reads remain real.
    await request.post(`${CONTROL}/fail-writes`);
    try {
      const failed = page.waitForResponse(r => r.url() === `${API}/smart-chords` && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Salvar Cifra Pessoal' }).click();
      expect((await failed).status()).toBeGreaterThanOrEqual(500);
      await expect(page.getByRole('button', { name: 'Salvar Cifra Pessoal' })).toBeEnabled();
      await expect(page.getByLabel('Título da Cifra', { exact: true })).toHaveValue(title);
      await expect(page.getByText('Cifra salva com sucesso na sua biblioteca pessoal!')).toHaveCount(0);
      expect((await json<{data: Stored[]}>(await call('/smart-chords', a.token))).data).toHaveLength(0);
    } finally { await request.post(`${CONTROL}/allow-writes`); }
    const savedResponse = page.waitForResponse(r => r.url() === `${API}/smart-chords` && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Salvar Cifra Pessoal' }).click();
    const savedHttp = await savedResponse; expect(savedHttp.status()).toBe(201);
    const saved = await savedHttp.json() as Stored;
    expect(saved).toMatchObject({ user_id: a.user.id, title, artist_name: artist, content: draft.content, original_key: 'Bb', capo: 0 });
    // Empty repertoire completes directly; linking is optional, not mandatory.
    await expect(page.getByRole('heading', { name: 'Importar Cifra', exact: true })).toHaveCount(0);
    const document = await json<{fields: Record<string, {stringValue?: string}>}>(await request.get(`${DB}/smart_chords/${saved.id}`));
    expect(document.fields.content.stringValue).toBe(draft.content);
    expect(document.fields.user_id.stringValue).toBe(a.user.id);
    expect((await json<{data: Stored[]}>(await call('/smart-chords', a.token))).data).toHaveLength(1);
    report.real_write_read = true; report.write_failure = 'Injected gRPC7 on Commit, no mock persistence, no success/partial record; recovery saved once';
    console.log('C4C_STAGE=real_write_and_firestore_read');
    await context.close();
    const freshAuth = await json<{idToken: string}>(await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator', {
      data: { email, password, returnSecureToken: true },
    }));
    const fresh = await session(freshAuth.idToken);
    const reopenedPage = await fresh.newPage();
    await reopenedPage.goto('/cifras');
    await reopenedPage.getByText(title, { exact: true }).first().click();
    const reread = await json<Stored>(await call(`/smart-chords/${saved.id}`, freshAuth.idToken));
    expect(reread.content).toBe(draft.content);
    const sheet = reopenedPage.locator('.smart-chords-workspace .print-sheet-box');
    await expect(sheet).toContainText('window.__c4cXSS++');
    expect(await sheet.locator('script,img,svg,iframe,object,embed,a[href^="javascript:"],a[href^="data:"]').count()).toBe(0);
    expect(await reopenedPage.evaluate(() => Reflect.get(window, '__c4cXSS'))).toBe(0);
    await reopenedPage.reload();
    await reopenedPage.getByText(title, { exact: true }).first().click();
    await reopenedPage.getByRole('button', { name: /Exportar PDF/ }).click();
    const print = reopenedPage.locator('#printable-sheet-pdf');
    await expect(print).toContainText('window.__c4cXSS++');
    expect(await print.locator('script,img,svg,iframe,object,embed,a[href]').count()).toBe(0);
    expect(await reopenedPage.evaluate(() => Reflect.get(window, '__c4cXSS'))).toBe(0);
    expect(deniedRequests).not.toContain('c4c.invalid');
    report.stored_xss = 'No execution/HTML nodes after fresh authenticated context, reload, workspace and PDF DOM; PDF binary not regenerated';
    report.html_payloads = ['script', 'event attributes', 'javascript/data URLs', 'SVG', 'iframe srcdoc', 'malformed HTML', 'encoded tag in title/artist', 'literal HTML in lyrics'];
    console.log('C4C_STAGE=fresh_session_stored_content_safe');
    const userIsolation = [];
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const denied = await call(`/smart-chords/${saved.id}`, b.token, method, method === 'PUT' ? { title: 'forbidden' } : undefined);
      userIsolation.push(denied.status()); expect(denied.status()).toBe(404);
    }
    expect((await json<{data: Stored[]}>(await call('/smart-chords', b.token))).data).toHaveLength(0);
    const forged = await json<Stored>(await call('/smart-chords', b.token, 'POST', {
      title: 'C4C forged authority', original_key: 'C', content: '[C]Text', user_id: a.user.id, ministry_id: m1.id,
    }), 201);
    expect(forged.user_id).toBe(b.user.id);
    expect((await call(`/smart-chords/${forged.id}`, a.token)).status()).toBe(404);
    expect((await call(`/smart-chords/${forged.id}`, b.token, 'DELETE')).status()).toBe(204);
    const sameMember = await call(`/ministries/${m1.id}/smart-chords/${saved.id}/repertoire-link`, b.token);
    expect(sameMember.status()).toBe(404);
    const foreignMember = await call(`/ministries/${m2.id}/smart-chords/${saved.id}/repertoire-link`, b.token);
    expect(foreignMember.status()).toBe(403);
    const songResponse = await json<{data: {id: string}}>(await call(`/ministries/${m1.id}/songs`, a.token, 'POST', { title: 'C4C Song', original_key: 'Bb' }), 201);
    const song = songResponse.data;
    await json(await call(`/ministries/${m1.id}/smart-chords/${saved.id}/repertoire-link`, a.token, 'PUT', { song_id: song.id }));
    const otherLink = await json<{link: unknown}>(await call(`/ministries/${m2.id}/smart-chords/${saved.id}/repertoire-link`, a.token));
    expect(otherLink.link).toBeNull();
    expect((await call(`/ministries/${m2.id}/smart-chords/${saved.id}/repertoire-link`, a.token, 'PUT', { song_id: song.id })).status()).toBe(404);
    report.isolation = { cross_user_statuses: userIsolation, shared_ministry_does_not_share_chord: sameMember.status(), foreign_ministry: foreignMember.status(), links_partitioned: true };
    console.log('C4C_STAGE=user_ministry_isolation');
    const badSources = ['javascript:alert(1)', 'data:text/html,test', 'file:///test'];
    for (const source_url of badSources) expect((await call('/smart-chords', a.token, 'POST', { title: 'unsafe URL', original_key: 'C', content: '[C]Text', source_url })).status()).toBe(400);
    const validLarge = await call('/smart-chords/import/text', a.token, 'POST', { text: 'C\nTexto seguro', html: 'a'.repeat(110000) });
    expect(validLarge.status()).toBe(200);
    const unicode = await json<Draft>(await call('/smart-chords/import/text', a.token, 'POST', { text: `Tom: C\n${'á'.repeat(80000)}` }));
    const unicodeSaved = await json<Stored>(await call('/smart-chords', a.token, 'POST', {
      title: 'C4C Unicode boundary', original_key: 'C', content: unicode.content,
    }), 201);
    expect((await json<Stored>(await call(`/smart-chords/${unicodeSaved.id}`, a.token))).content).toBe(unicode.content);
    expect((await call(`/smart-chords/${unicodeSaved.id}`, a.token, 'DELETE')).status()).toBe(204);
    expect((await call('/smart-chords/import/text', a.token, 'POST', { text: 'x'.repeat(100001) })).status()).toBe(400);
    expect((await call('/smart-chords/import/text', a.token, 'POST', { text: 'C', html: 'x'.repeat(200001) })).status()).toBe(400);
    const oversized = await call('/smart-chords/import/text', a.token, 'POST', { text: 'x'.repeat(2 * 1024 * 1024) });
    expect(oversized.status()).toBe(413);
    const invalidJson = await request.post(`${API}/smart-chords/import/text`, { headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, data: '{"text":' });
    expect(invalidJson.status()).toBe(400);
    report.limits = { valid_large_payload: 200, unicode_import_save_read_exact: true, text_schema: 400, html_schema: 400, transport_budget: 413, invalid_json: 400, dangerous_source_urls: 'rejected' };
    report.save_reopen = 'Exact content+metadata via Firestore REST and genuine newly signed-in Auth emulator ID token in fresh browser context';
    report.result = 'PASS_LOCAL_REAL_INTEGRATION';
  } finally {
    await request.post(`${CONTROL}/allow-writes`).catch(() => {});
    for (const context of contexts) await context.close().catch(() => {});
    const directory = resolve('../docs/exec-plans/evidence'); mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, '2026-10-29-m20-c4c-integration-run.json'), JSON.stringify(report, null, 2));
  }
});
