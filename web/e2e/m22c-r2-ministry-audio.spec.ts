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

// M22-C.4 — 'ranged-copy' runs the backend with Range GET reads, CopyObject promotion and the persisted verification.
const MODE = process.env.M22C_R2_MODE ?? 'default';
const CONTROL = 'http://127.0.0.1:4315/__m22c';
const PERSISTED_SECONDS = 24; // 4 233 644 bytes per stem: just over one 4 MiB range part, so reads are really ranged.
const SETTLE_MS = 2_100; // R2 reports LastModified in whole seconds.

interface R2Counters {
  staging: { head: number; get: number; rangedGet: number; put: number };
  final: { head: number; get: number; rangedGet: number; put: number };
  copy: { sent: number; blocked: number };
}
interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  mapValue?: { fields?: Record<string, FirestoreValue> };
}
type Grant = { attempt: number; url: string; headers: Record<string, string> };

function manifestOf(id: (typeof stems)[number], bytes: Buffer) {
  const frames = (bytes.length - 44) / 4;
  return {
    id, codec: 'pcm_s16le', sampleRate: 44_100, channels: 2, durationSeconds: frames / 44_100,
    frames, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function stagingReads(before: R2Counters, after: R2Counters) {
  return (after.staging.get + after.staging.rangedGet) - (before.staging.get + before.staging.rangedGet);
}

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

test('0. o backend iniciado usa exatamente os modos esperados do R2', async ({ request }) => {
  const response = await request.get(`${CONTROL}/modes`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(MODE === 'ranged-copy'
    ? { read: 'ranged', promotion: 'copy' }
    : { read: 'stream', promotion: 'upload' });
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

test('7. retomada persistida: verificação concluída, falha controlada na promoção e novo /complete sem reler o staging', async ({ request }) => {
  test.skip(MODE !== 'ranged-copy', 'Needs M22C_R2_MODE=ranged-copy (Range GET, CopyObject and persisted verification).');
  test.setTimeout(290_000);
  const base = `${API}/ministries/${shared.ministryId}/audio-library`;
  const admin = authHeader(shared.admin!.token);
  const content = stems.map((id, index) => {
    const bytes = wav(100 + index * 30, PERSISTED_SECONDS);
    return { id, bytes, manifest: manifestOf(id, bytes) };
  });
  const of = (id: (typeof stems)[number]) => content.find((stem) => stem.id === id)!;
  // Same length as the drums stem but different bytes: its SHA-256 cannot match the reserved manifest.
  const swapped = wav(100 + 30 + 7, PERSISTED_SECONDS);
  expect(swapped.length).toBe(of('drums').bytes.length);

  const counters = async () => (await request.get(`${CONTROL}/counters`)).json() as Promise<R2Counters>;
  const armCopyFailure = async () => expect((await request.post(`${CONTROL}/fault`, { data: { copy: 1 } })).status()).toBe(204);
  const grantFor = async (id: string, stem: (typeof stems)[number]) => {
    const response = await request.post(`${base}/uploads/${id}/stems/${stem}/upload-url`, { headers: admin });
    expect(response.status(), `upload grant ${stem}`).toBe(200);
    const grant = await response.json() as Grant;
    expect(new URL(grant.url).hostname).toBe(R2_HOST);
    return grant;
  };
  const putStaging = async (grant: Grant, bytes: Buffer) => {
    try {
      return (await request.put(grant.url, { headers: grant.headers, data: bytes, timeout: 120_000 })).status();
    } catch {
      throw new Error('signed PUT failed at the network level');
    }
  };
  // When a status differs from the expected one, print the sanitized R2 command trace (names, statuses, durations only)
  // before the assertion fails, so the failing phase is visible in the report.
  const complete = async (id: string, stem: (typeof stems)[number], attempt: number, expected?: number) => {
    const started = Date.now();
    const response = await request.post(`${base}/uploads/${id}/stems/${stem}/complete`, { headers: admin, data: { attempt }, timeout: 90_000 });
    const result = { status: response.status(), text: await response.text(), ms: Date.now() - started };
    if (expected !== undefined && result.status !== expected) {
      const trace = await request.get(`${CONTROL}/trace`).then((r) => r.text()).catch(() => 'trace unavailable');
      console.log(`DIAG complete stem=${stem} attempt=${attempt} expected=${expected} got=${result.status} after ${result.ms} ms\nDIAG body ${result.text.slice(0, 300)}\nDIAG trace ${trace}`);
    }
    return result;
  };
  const attemptsOf = async (id: string) => {
    const response = await request.get(`${FIRESTORE}/ministries/${shared.ministryId}/audio_recordings/${id}`);
    expect(response.ok(), 'emulator read of the recording').toBeTruthy();
    const fields = (await response.json() as { fields?: Record<string, FirestoreValue> }).fields?.directAttempts?.mapValue?.fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([stem, value]) => {
      const entry = value.mapValue?.fields ?? {};
      const verified = entry.verified?.mapValue?.fields;
      return [stem, {
        number: Number(entry.number?.integerValue),
        invalid: entry.invalid?.booleanValue === true,
        receipt: entry.receipt?.mapValue?.fields?.etag?.stringValue,
        verified: verified ? { etag: verified.etag?.stringValue, lastModified: Number(verified.lastModified?.integerValue) } : undefined,
      }];
    }));
  };
  // The client view of a stem must never carry the internal receipt or the persisted verification.
  const expectNoInternals = (text: string) => expect(text).not.toMatch(/etag|verified|receipt|lastModified|cloudflarestorage|staging\//i);
  const deleteStaging = async (id: string, stem: (typeof stems)[number], attempt: number) => {
    const response = await request.post(`${CONTROL}/delete-staging`, { data: { ministryId: shared.ministryId, recordingId: id, stemId: stem, attempt } });
    expect(response.status()).toBe(204);
  };

  // A copy failure armed by a step that failed early must not leak into later work.
  await request.post(`${CONTROL}/fault`, { data: { copy: 0 } });

  const reserved = await request.post(`${base}/uploads`, {
    headers: admin,
    data: {
      idempotencyKey: randomUUID(), confirmed: true, title: `Retomada persistida ${randomUUID().slice(0, 8)}`,
      artist: 'Banda de teste', version: 'Ensaio', model: { id: 'htdemucs_6s', version: 'fixture' },
      stems: content.map(({ manifest }) => manifest),
    },
  });
  expect(reserved.ok(), 'reservation').toBeTruthy();
  const { id } = await reserved.json() as { id: string };
  // Registered for cleanup before anything else can fail.
  shared.recordingIds.push(id);

  // --- 1. vocals: full ranged verification, controlled failure before promotion, then a resume that does not re-read staging.
  const vocals = await grantFor(id, 'vocals');
  expect(await putStaging(vocals, of('vocals').bytes)).toBe(200);
  const beforeFirst = await counters();
  await armCopyFailure();
  const first = await complete(id, 'vocals', vocals.attempt, 503);
  expect(first.status).toBe(503);
  expectNoInternals(first.text);
  const afterFirst = await counters();
  expect(stagingReads(beforeFirst, afterFirst), 'staging was fully read once').toBeGreaterThanOrEqual(2);
  // Exactly 2 parts, or 3 if one part needed its single transient retry.
  expect(afterFirst.staging.rangedGet - beforeFirst.staging.rangedGet, 'Range GET parts of a 4.2 MB stem').toBeGreaterThanOrEqual(2);
  expect(afterFirst.staging.rangedGet - beforeFirst.staging.rangedGet).toBeLessThanOrEqual(3);
  expect(afterFirst.staging.get - beforeFirst.staging.get, 'no single-GET read in ranged mode').toBe(0);
  expect(afterFirst.copy.blocked - beforeFirst.copy.blocked).toBe(1);
  expect(afterFirst.copy.sent - beforeFirst.copy.sent, 'the failure happened before R2 saw the copy').toBe(0);

  const persisted = await attemptsOf(id);
  expect(Object.keys(persisted), 'only the stem being completed has a record').toEqual(['vocals']);
  expect(persisted.vocals).toMatchObject({ number: vocals.attempt, invalid: false, receipt: undefined });
  expect(persisted.vocals.verified?.etag).toMatch(/^"[0-9a-f]{32}"$/);
  expect(Number.isSafeInteger(persisted.vocals.verified?.lastModified)).toBe(true);

  const second = await complete(id, 'vocals', vocals.attempt, 200);
  expect(second.status).toBe(200);
  expectNoInternals(second.text);
  expect((JSON.parse(second.text) as { uploadedStemIds: string[] }).uploadedStemIds).toContain('vocals');
  const afterSecond = await counters();
  expect(stagingReads(afterFirst, afterSecond), 'the resume did not read the staging object again').toBe(0);
  expect(afterSecond.staging.head - afterFirst.staging.head, 'staging identity re-checked by HEAD').toBeGreaterThanOrEqual(1);
  expect(afterSecond.copy.sent - afterFirst.copy.sent).toBe(1);
  expect(afterSecond.final.get + afterSecond.final.rangedGet - afterFirst.final.get - afterFirst.final.rangedGet).toBe(0);

  const sealed = await attemptsOf(id);
  expect(sealed.vocals.receipt).toBe(persisted.vocals.verified?.etag);
  expect(sealed.vocals.verified, 'the verification is dropped once the receipt exists').toBeUndefined();

  const third = await complete(id, 'vocals', vocals.attempt, 200);
  expect(third.status).toBe(200);
  expect(await counters(), 'an already confirmed stem triggers no R2 call').toEqual(afterSecond);
  console.log(`PERF persisted resume (single observation): /complete with full ranged verification + injected copy failure ${first.ms} ms; resume ${second.ms} ms; repeat ${third.ms} ms`);

  // --- 2. drums: the staging object is replaced after verification, so the old verification must not be reused.
  const drums = await grantFor(id, 'drums');
  expect(await putStaging(drums, of('drums').bytes)).toBe(200);
  await armCopyFailure();
  expect((await complete(id, 'drums', drums.attempt, 503)).status).toBe(503);
  expect((await attemptsOf(id)).drums.verified?.etag).toMatch(/^"[0-9a-f]{32}"$/);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await deleteStaging(id, 'drums', drums.attempt);
  expect(await putStaging(drums, swapped), 'the create-only grant is usable again once the object is gone').toBe(200);
  const beforeSwap = await counters();
  const swap = await complete(id, 'drums', drums.attempt, 422);
  expect(swap.status).toBe(422);
  expect(JSON.parse(swap.text)).toMatchObject({ error: { details: { code: 'AUDIO_UPLOAD_INVALID' } } });
  const afterSwap = await counters();
  expect(stagingReads(beforeSwap, afterSwap), 'the replaced object was verified from scratch').toBeGreaterThanOrEqual(2);
  expect(afterSwap.copy.sent - beforeSwap.copy.sent, 'nothing was promoted').toBe(0);
  const invalidated = (await attemptsOf(id)).drums;
  expect(invalidated).toMatchObject({ invalid: true, receipt: undefined, verified: undefined });
  const drumsAgain = await grantFor(id, 'drums');
  expect(drumsAgain.attempt).toBe(drums.attempt + 1);
  expect(await putStaging(drumsAgain, of('drums').bytes)).toBe(200);
  expect((await complete(id, 'drums', drumsAgain.attempt, 200)).status).toBe(200);

  // --- 3. bass: same bytes (same ETag) uploaded again later, so only the last-modified time differs.
  const bass = await grantFor(id, 'bass');
  expect(await putStaging(bass, of('bass').bytes)).toBe(200);
  await armCopyFailure();
  expect((await complete(id, 'bass', bass.attempt, 503)).status).toBe(503);
  const firstVerification = (await attemptsOf(id)).bass.verified;
  expect(firstVerification?.etag).toMatch(/^"[0-9a-f]{32}"$/);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await deleteStaging(id, 'bass', bass.attempt);
  expect(await putStaging(bass, of('bass').bytes)).toBe(200);
  const beforeRepeat = await counters();
  expect((await complete(id, 'bass', bass.attempt, 200)).status).toBe(200);
  const afterRepeat = await counters();
  expect(stagingReads(beforeRepeat, afterRepeat), 'a newer object version is never covered by an older verification').toBeGreaterThanOrEqual(2);
  expect((await attemptsOf(id)).bass.receipt).toBe(firstVerification?.etag);

  // --- 4. the remaining stems, then an idempotent publication with intact content.
  for (const stem of ['guitar', 'piano', 'other'] as const) {
    const grant = await grantFor(id, stem);
    expect(await putStaging(grant, of(stem).bytes)).toBe(200);
    expect((await complete(id, stem, grant.attempt, 200)).status).toBe(200);
  }
  const published = await request.post(`${base}/uploads/${id}/finalize`, { headers: admin, timeout: 90_000 });
  expect(published.status()).toBe(200);
  const publishedBody = await published.json() as { id: string; status: string };
  expect(publishedBody).toMatchObject({ id, status: 'published' });
  const again = await request.post(`${base}/uploads/${id}/finalize`, { headers: admin, timeout: 90_000 });
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual(publishedBody);
  expectNoInternals(JSON.stringify(publishedBody));

  const final = await attemptsOf(id);
  for (const stem of stems) {
    expect(final[stem].receipt, `receipt of ${stem}`).toMatch(/^"[0-9a-f]{32}"$/);
    expect(final[stem].verified, `no leftover verification on ${stem}`).toBeUndefined();
  }

  const playback = await request.get(`${base}/${id}/playback`, { headers: admin });
  expect(playback.status()).toBe(200);
  const { manifest, tracks } = await playback.json() as { manifest: { stems: Array<{ id: string; sha256: string; sizeBytes: number }> }; tracks: Array<{ id: string; url: string; headers: Record<string, string> }> };
  for (const stem of ['vocals', 'drums', 'bass'] as const) {
    const expected = manifest.stems.find(({ id: stemId }) => stemId === stem)!;
    expect(expected.sha256).toBe(of(stem).manifest.sha256);
    const track = tracks.find(({ id: trackId }) => trackId === stem)!;
    const object = await getSigned(request, track.url, track.headers);
    expect(object.ok(), `R2 GET ${stem}`).toBeTruthy();
    const body = await object.body();
    expect(body.byteLength, `size ${stem}`).toBe(expected.sizeBytes);
    expect(createHash('sha256').update(body).digest('hex'), `sha256 ${stem}`).toBe(expected.sha256);
  }
});
