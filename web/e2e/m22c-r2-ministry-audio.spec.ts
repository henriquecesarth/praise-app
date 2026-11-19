import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';

// M22-C.2 — Ministry Library against the private development R2 bucket.
// Only synthetic data and a fictitious ministry in the Auth/Firestore emulators are used.
// Signed URLs and credentials are never logged.

const AUTH = 'http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-emulator-key';
const FIRESTORE = 'http://127.0.0.1:8186/v1/projects/demo-louvaio-unit/databases/(default)/documents';
const API = 'http://127.0.0.1:4315/api/v1';
const audioRoute = '/ministerio/biblioteca-audio';
const stems = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
const R2_HOST = `${process.env.MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const GRANT_TTL_MS = 120_000;

test.describe.configure({ mode: 'serial' });

async function seed(request: APIRequestContext, path: string, values: Record<string, string>) {
  const fields = Object.fromEntries(Object.entries(values).map(([name, stringValue]) => [name, { stringValue }]));
  const response = await request.patch(`${FIRESTORE}/${path}`, { data: { fields } });
  expect(response.ok(), `emulator write to ${path.split('/')[0]}`).toBeTruthy();
}

async function createUser(request: APIRequestContext, label: string) {
  const email = `m22c-r2-${randomUUID()}@example.test`;
  const response = await request.post(AUTH, { data: { email, password: randomUUID(), returnSecureToken: true } });
  expect(response.ok(), 'Auth Emulator signup').toBeTruthy();
  const { localId, idToken } = await response.json() as { localId: string; idToken: string };
  await seed(request, `users/${localId}`, { email, name: label, created_at: new Date().toISOString() });
  return { uid: localId, token: idToken };
}

function wav(frequency: number, seconds = 3) {
  const rate = 44_100;
  const frames = rate * seconds;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.round(2_000 * Math.sin((2 * Math.PI * i * frequency) / rate));
    buffer.writeInt16LE(sample, 44 + i * 4);
    buffer.writeInt16LE(sample, 46 + i * 4);
  }
  return buffer;
}

const faults = { put: 0, get: 0 };
const metrics = { putMs: [] as number[], getMs: [] as number[], completeMs: [] as number[] };
const modelRequests: string[] = [];
type ControlRequest = { path: string; authenticated: boolean };
type ObjectRequest = { method: string; signed: boolean; authenticated: boolean; cookies: boolean; conditional: boolean; aborted: boolean };

const shared: {
  admin?: { uid: string; token: string };
  member?: { uid: string; token: string };
  ministryId?: string;
  memberDocId?: string;
  title?: string;
  recordingIds: string[];
} = { recordingIds: [] };

async function pageFor(browser: import('@playwright/test').Browser, token: string) {
  const controlRequests: ControlRequest[] = [];
  const objectRequests: ObjectRequest[] = [];
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.hostname === R2_HOST && (method === 'PUT' || method === 'GET')) {
      const headers = await request.allHeaders();
      const record: ObjectRequest = {
        method, signed: Boolean(url.search), authenticated: 'authorization' in headers, cookies: 'cookie' in headers,
        conditional: method === 'PUT' ? headers['if-none-match'] === '*' : /^".*"$/.test(headers['if-match'] ?? ''), aborted: false,
      };
      objectRequests.push(record);
      const key = method === 'PUT' ? 'put' : 'get';
      if (faults[key] > 0) {
        faults[key] -= 1;
        record.aborted = true;
        // An opaque network failure, as produced by an expired URL or a CORS rejection.
        await route.abort('failed');
        return;
      }
    } else if (/\/audio-library\/(?:.*\/)?(?:upload-url|complete|playback)$/.test(url.pathname)) {
      controlRequests.push({ path: url.pathname, authenticated: Boolean((await request.allHeaders()).authorization?.startsWith('Bearer ')) });
    }
    if (/\.(?:onnx|wasm)(?:$|\?)/.test(url.pathname) || url.pathname.includes('demucs-separation.worker')) {
      modelRequests.push(url.pathname);
      await route.abort();
    } else if (url.hostname !== '127.0.0.1' && url.hostname !== R2_HOST) {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await context.addInitScript((value) => {
    localStorage.setItem('praise_auth_token', value);
    const starts: number[] = [];
    (window as Window & { audioStarts?: number[] }).audioStarts = starts;
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      starts.push(when ?? 0);
      original.call(this, when, offset, duration);
    };
  }, token);
  const page = await context.newPage();
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    const timing = request.timing();
    const duration = timing.responseEnd - timing.startTime;
    if (!(duration > 0)) return;
    if (url.hostname === R2_HOST && request.method() === 'PUT') metrics.putMs.push(duration);
    else if (url.hostname === R2_HOST && request.method() === 'GET') metrics.getMs.push(duration);
    // Only the confirmation after the PUT seals (200); the pre-PUT probe answers 409 "missing" without sealing.
    else if (/\/stems\/[a-z]+\/complete$/.test(url.pathname)) {
      void request.response().then((response) => { if (response?.status() === 200) metrics.completeMs.push(duration); });
    }
  });
  return { context, page, controlRequests, objectRequests };
}

async function publish(page: Page, title: string, seconds = 3) {
  await page.goto(audioRoute);
  await page.getByRole('button', { name: 'Nova gravação' }).click();
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Artista', { exact: true }).fill('Banda de teste');
  await page.getByLabel('Versão', { exact: true }).fill('Ensaio');
  await page.getByLabel('Modelo', { exact: true }).fill('htdemucs_6s');
  await page.getByLabel('Versão do modelo', { exact: true }).fill('fixture');
  for (const [index, stem] of stems.entries()) {
    await page.getByTestId(`audio-stem-${stem}`).setInputFiles({
      name: `${stem}.wav`, mimeType: 'audio/wav', buffer: wav(100 + index * 30, seconds),
    });
  }
  await page.getByRole('checkbox', { name: 'Confirmo a publicação destas faixas no ministério' }).check();
}

function recordingIdFrom(controlRequests: ControlRequest[]) {
  const match = controlRequests.map(({ path }) => /\/audio-library\/(?:uploads\/)?([a-f0-9]{64})\//.exec(path)?.[1]).find(Boolean);
  expect(match, 'recording id observed in a control request').toBeTruthy();
  return match!;
}

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

// A network error from Playwright would echo the full signed URL; report only a generic failure.
async function getSigned(request: APIRequestContext, url: string, headers: Record<string, string>) {
  try {
    return await request.get(url, { headers });
  } catch {
    throw new Error('signed GET failed at the network level');
  }
}

function report(label: string, values: number[]) {
  if (values.length === 0) return `${label}: n/a`;
  const sorted = [...values].sort((a, b) => a - b);
  return `${label}: n=${values.length} min ${Math.round(sorted[0])} / med ${Math.round(sorted[Math.floor((sorted.length - 1) / 2)])} / max ${Math.round(sorted.at(-1)!)} ms`;
}

test.beforeAll(async ({ request }) => {
  shared.admin = await createUser(request, 'Publicador M22-C.2');
  shared.member = await createUser(request, 'Membro M22-C.2');
  shared.ministryId = `m22c-r2-${randomUUID()}`;
  shared.memberDocId = randomUUID();
  const timestamp = new Date().toISOString();
  await seed(request, `ministries/${shared.ministryId}`, {
    name: 'Ministério Fictício R2', owner_user_id: shared.admin.uid, subscription_status: 'active',
    created_at: timestamp, updated_at: timestamp,
  });
  await seed(request, `ministry_members/${shared.memberDocId}`, {
    ministry_id: shared.ministryId, user_id: shared.member.uid, role: 'member', status: 'active', joined_at: timestamp,
  });
  shared.title = `Gravação R2 ${randomUUID().slice(0, 8)}`;
});

test.afterAll(() => {
  // Not secrets. Used by backend/scripts/m22c-r2-e2e-cleanup.ts to remove only these synthetic objects.
  console.log(`CLEANUP_HINT ministry=${shared.ministryId} recordings=${shared.recordingIds.join(',')}`);
  console.log(report('R2 PUT (browser)', metrics.putMs));
  console.log(report('API /complete incl. seal (browser view)', metrics.completeMs));
  console.log(report('R2 GET (browser)', metrics.getMs));
});

test('1. administrador publica seis WAVs no R2 real', async ({ browser }) => {
  const { context, page, controlRequests, objectRequests } = await pageFor(browser, shared.admin!.token);
  try {
    await publish(page, shared.title!);
    const button = page.getByRole('button', { name: 'Publicar gravação' });
    const started = Date.now();
    await button.click();
    // Register the reservation for cleanup as soon as the first grant is requested.
    await expect.poll(() => controlRequests.some(({ path }) => path.endsWith('/upload-url')), { timeout: 30_000 }).toBe(true);
    shared.recordingIds.push(recordingIdFrom(controlRequests));
    await expect(page.getByText(shared.title!, { exact: true })).toBeVisible({ timeout: 120_000 });
    console.log(`publish end-to-end (6 stems, UI): ${Date.now() - started} ms`);

    expect(objectRequests.map(({ method }) => method)).toEqual(Array(6).fill('PUT'));
    expect(objectRequests.every(({ signed, authenticated, cookies, conditional }) => signed && !authenticated && !cookies && conditional)).toBe(true);
    expect(controlRequests.every(({ authenticated }) => authenticated)).toBe(true);
    expect(controlRequests.filter(({ path }) => path.endsWith('/upload-url'))).toHaveLength(6);
  } finally {
    await context.close();
  }
});

test('2. manifesto, tamanhos e SHA-256 no R2 real', async ({ request }) => {
  const id = shared.recordingIds[0];
  const response = await request.get(`${API}/ministries/${shared.ministryId}/audio-library/${id}/playback`, { headers: authHeader(shared.member!.token) });
  expect(response.status()).toBe(200);
  const playback = await response.json() as { transfer: string; manifest: { stems: Array<{ id: string; sha256: string; sizeBytes: number }> }; tracks: Array<{ id: string; url: string; headers: Record<string, string> }> };
  expect(playback.transfer).toBe('direct');
  expect(playback.manifest.stems).toHaveLength(6);
  for (const stem of playback.manifest.stems) {
    const track = playback.tracks.find(({ id }) => id === stem.id)!;
    expect(new URL(track.url).hostname).toBe(R2_HOST);
    const object = await getSigned(request, track.url, track.headers);
    expect(object.ok(), `R2 GET ${stem.id}`).toBeTruthy();
    const body = await object.body();
    expect(body.byteLength, `size ${stem.id}`).toBe(stem.sizeBytes);
    expect(createHash('sha256').update(body).digest('hex'), `sha256 ${stem.id}`).toBe(stem.sha256);
  }
});

test('3. outro membro reproduz: sincronismo, mute, solo, seek e zero Demucs', async ({ browser }) => {
  const { context, page, controlRequests, objectRequests } = await pageFor(browser, shared.member!.token);
  try {
    await page.goto(audioRoute);
    await expect(page.getByText(shared.title!, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova gravação' })).toHaveCount(0);
    const started = Date.now();
    await page.getByRole('button', { name: 'Abrir mixer' }).click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    console.log(`open mixer until ready (6 downloads + verify + decode): ${Date.now() - started} ms`);
    expect(objectRequests.filter(({ method }) => method === 'GET')).toHaveLength(6);
    expect(controlRequests.filter(({ path }) => path.endsWith('/playback'))).toHaveLength(1);

    await page.getByTestId('m22b-mixer-play').click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'playing');
    const starts = await page.evaluate(() => (window as Window & { audioStarts?: number[] }).audioStarts ?? []);
    expect(starts).toHaveLength(6);
    expect(new Set(starts).size).toBe(1);

    await page.getByTestId('m22b-stem-mute-vocals').click();
    await expect(page.getByTestId('m22b-stem-audible-vocals')).toHaveAttribute('data-audible', 'false');
    await page.getByTestId('m22b-stem-mute-vocals').click();
    await expect(page.getByTestId('m22b-stem-audible-vocals')).toHaveAttribute('data-audible', 'true');
    await page.getByTestId('m22b-stem-solo-drums').click();
    await expect(page.getByTestId('m22b-stem-audible-drums')).toHaveAttribute('data-audible', 'true');
    await expect(page.getByTestId('m22b-stem-audible-bass')).toHaveAttribute('data-audible', 'false');
    await page.getByTestId('m22b-stem-solo-drums').click();
    await expect(page.getByTestId('m22b-stem-audible-bass')).toHaveAttribute('data-audible', 'true');

    await page.getByTestId('m22b-mixer-pause').click();
    await page.getByTestId('m22b-mixer-seek').fill('50000');
    await expect(page.getByTestId('m22b-mixer-position')).toContainText('frame 50000/');
    expect(modelRequests).toEqual([]);
  } finally {
    await context.close();
  }
});

test('4. renovação após falha opaca de rede/CORS no GET', async ({ browser }) => {
  const { context, page, controlRequests, objectRequests } = await pageFor(browser, shared.member!.token);
  try {
    faults.get = 1;
    await page.goto(audioRoute);
    await expect(page.getByText(shared.title!, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir mixer' }).click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    expect(objectRequests.filter(({ aborted }) => aborted)).toHaveLength(1);
    expect(controlRequests.filter(({ path }) => path.endsWith('/playback'))).toHaveLength(2);
    expect(faults.get).toBe(0);
  } finally {
    faults.get = 0;
    await context.close();
  }
});

test('5. upload interrompido, retomada e finalização idempotente', async ({ browser }) => {
  const { context, page, controlRequests, objectRequests } = await pageFor(browser, shared.admin!.token);
  const title = `Retomada R2 ${randomUUID().slice(0, 8)}`;
  try {
    await publish(page, title);
    // Two aborted PUTs exhaust the original grant and its single renewal, so the first publish attempt fails.
    faults.put = 2;
    const button = page.getByRole('button', { name: 'Publicar gravação' });
    await button.click();
    await expect.poll(() => faults.put, { timeout: 60_000 }).toBe(0);
    // After a failed attempt the form keeps the reservation and renames the button.
    const resume = page.getByRole('button', { name: 'Retomar publicação' });
    await expect(resume).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    expect(objectRequests.filter(({ aborted }) => aborted)).toHaveLength(2);
    // Register the reservation for cleanup before the retry, in case a later assertion fails.
    shared.recordingIds.push(recordingIdFrom(controlRequests));

    await resume.click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(1, { timeout: 120_000 });
    expect(new Set(controlRequests.map(({ path }) => /([a-f0-9]{64})/.exec(path)?.[1]).filter(Boolean)).size).toBe(1);
  } finally {
    faults.put = 0;
    await context.close();
  }
});

test('6. revogação do membro, novas URLs negadas e janela do GET já emitido', async ({ request }) => {
  const id = shared.recordingIds[0];
  const url = `${API}/ministries/${shared.ministryId}/audio-library/${id}/playback`;
  const before = await request.get(url, { headers: authHeader(shared.member!.token) });
  expect(before.status()).toBe(200);
  const issuedAt = Date.now();
  const issued = (await before.json() as { tracks: Array<{ url: string; headers: Record<string, string> }> }).tracks[0];

  await seed(request, `ministry_members/${shared.memberDocId}`, {
    ministry_id: shared.ministryId!, user_id: shared.member!.uid, role: 'member', status: 'removed', joined_at: new Date().toISOString(),
  });
  const after = await request.get(url, { headers: authHeader(shared.member!.token) });
  expect([401, 403, 404]).toContain(after.status());
  expect(await after.text()).not.toContain('tracks');
  const list = await request.get(`${API}/ministries/${shared.ministryId}/audio-library`, { headers: authHeader(shared.member!.token) });
  expect(list.ok()).toBe(false);

  // Documented window: a GET already issued stays valid until it expires (bearer capability, up to 120 s).
  const stillValid = await getSigned(request, issued.url, issued.headers);
  console.log(`issued GET still valid right after revocation: ${stillValid.ok()}`);
  const wait = GRANT_TTL_MS - (Date.now() - issuedAt) + 5_000;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const expired = await getSigned(request, issued.url, issued.headers);
  expect(expired.ok(), 'issued GET expired after its TTL').toBe(false);
});
