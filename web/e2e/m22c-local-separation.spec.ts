import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, openSync, ftruncateSync, closeSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// M22-C.5D-C4-B-V — local separation -> preview -> confirmed WAV v1 publication, in a real browser.
// ONLY the ONNX inference is simulated (a fake Worker script that speaks the real Worker protocol and returns six
// synthetic WAVs). The Worker client, its result validation, the mixer, the publication form, the API, the Auth/Firestore
// emulators and the simulated WAV storage are all real. This does NOT validate the real Demucs model.

const AUTH = 'http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-emulator-key';
const FIRESTORE = 'http://127.0.0.1:8186/v1/projects/demo-louvaio-unit/databases/(default)/documents';
const audioRoute = '/ministerio/biblioteca-audio';
const stems = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
const MODEL_BYTES = 136428532;
const MODEL_SHA = '7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869';

async function seed(request: APIRequestContext, path: string, values: Record<string, string>) {
  const fields = Object.fromEntries(Object.entries(values).map(([name, stringValue]) => [name, { stringValue }]));
  const response = await request.patch(`${FIRESTORE}/${path}`, { data: { fields } });
  expect(response.ok(), `emulator write to ${path.split('/')[0]}`).toBeTruthy();
}
async function createUser(request: APIRequestContext, label: string) {
  const email = `m22c-sep-${randomUUID()}@example.test`;
  const response = await request.post(AUTH, { data: { email, password: randomUUID(), returnSecureToken: true } });
  expect(response.ok(), 'Auth Emulator signup').toBeTruthy();
  const { localId, idToken } = await response.json() as { localId: string; idToken: string };
  await seed(request, `users/${localId}`, { email, name: label, created_at: new Date().toISOString() });
  return { uid: localId, token: idToken };
}
async function setup(request: APIRequestContext) {
  const admin = await createUser(request, 'Publicador separação');
  const member = await createUser(request, 'Membro separação');
  const ministryId = `m22c-sep-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  await seed(request, `ministries/${ministryId}`, {
    name: 'Ministério de Teste', owner_user_id: admin.uid, subscription_status: 'active', created_at: timestamp, updated_at: timestamp,
  });
  await seed(request, `ministry_members/${randomUUID()}`, {
    ministry_id: ministryId, user_id: member.uid, role: 'member', status: 'active', joined_at: timestamp,
  });
  return { admin, member };
}

function inputWav() {
  const rate = 44_100;
  const frames = rate * 2;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  return buffer;
}

// Sparse files with the exact pinned size; their bytes are never read by the fake Worker.
const modelDir = mkdtempSync(join(tmpdir(), 'louvaio-c4bv-'));
function modelFile(name: string) {
  const path = join(modelDir, name);
  const fd = openSync(path, 'w');
  ftruncateSync(fd, MODEL_BYTES);
  closeSync(fd);
  return path;
}
const audioPath = join(modelDir, 'musica.wav');
writeFileSync(audioPath, inputWav());

// The model file NAME selects the simulated behaviour: model-ok / model-hang / model-fail.
const FAKE_WORKER = `
const SHA = ${JSON.stringify(MODEL_SHA)};
const IDS = ${JSON.stringify(stems)};
const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
function wav(frames, freq) {
  const out = new ArrayBuffer(44 + frames * 4); const v = new DataView(out);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, out.byteLength - 8, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, 44100, true); v.setUint32(28, 44100 * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, frames * 4, true);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { const x = Math.sin(2 * Math.PI * i * freq / 44100) * 0.1; left[i] = right[i] = x; const s = Math.round(x * 32767); v.setInt16(44 + i * 4, s, true); v.setInt16(46 + i * 4, s, true); }
  return { out, left, right };
}
let cancelled = false;
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'cancel_job') { cancelled = true; return; }
  if (msg.type !== 'run_separation') { self.postMessage({ type: msg.type === 'clear_cache' ? 'cache_cleared' : 'disposed', requestId: msg.requestId }); return; }
  const name = (msg.modelSource && msg.modelSource.name) || '';
  const frames = new DataView(msg.audioWavBytes).getUint32(40, true) / 4;
  const progress = (phase, fraction) => self.postMessage({ type: 'progress', jobId: msg.jobId, event: { phase, chunkIndex: 0, totalChunks: 1, fraction, elapsedMs: 1 } });
  progress('loading_model', 0.1);
  if (name.includes('hang')) return; // never answers; the client must cancel/terminate us
  if (name.includes('fail')) { self.postMessage({ type: 'error', jobId: msg.jobId, code: 'INFERENCE_FAILED', message: 'Falha simulada da inferência.' }); return; }
  progress('separating', 0.6);
  const ordered = [];
  for (let i = 0; i < IDS.length; i++) {
    const { out, left, right } = wav(frames, 110 + i * 40);
    ordered.push({ id: IDS[i], labelPtBr: IDS[i], sampleRate: 44100, channels: 2, totalFrames: frames, leftBuffer: left.buffer, rightBuffer: right.buffer, wavBuffer: out, byteLength: out.byteLength, sha256: await hex(out.slice(0)), rms: 0.07, peak: 0.1 });
  }
  const telemetry = { modelId: msg.descriptor.id, modelVersion: msg.descriptor.version, executionProvider: 'wasm', ortVersion: 'simulated', modelBytes: msg.descriptor.expectedModelBytes, modelSha256: SHA, modelChecksumVerified: true, sampleRate: 44100, totalFrames: frames, audioDurationSeconds: frames / 44100, segmentSamples: msg.descriptor.segmentSamples, overlapSamples: Math.floor(msg.descriptor.segmentSamples * msg.descriptor.defaultOverlapRatio), chunksProcessed: 1, modelLoadMs: 1, inferenceMs: 1, encodeMs: 1, totalWallMs: 3, rtf: 0.001, jsHeapUsedBytes: null, jsHeapSnapshotKind: 'unavailable', reconstructionMaxAbsError: 0, inputSha256: null };
  self.postMessage({ type: 'completed', jobId: msg.jobId, descriptor: msg.descriptor, telemetry, orderedStems: ordered }, ordered.flatMap((s) => [s.leftBuffer, s.rightBuffer, s.wavBuffer]));
};
`;

interface Tracker { writes: string[]; uploadDelayMs: number }

async function pageFor(browser: import('@playwright/test').Browser, token: string, tracker: Tracker, modelRequests: string[]) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.includes('demucs-separation.worker')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_WORKER });
      return;
    }
    if (/\.(?:onnx|wasm)(?:$|\?)/.test(url.pathname)) { modelRequests.push(url.pathname); await route.abort(); return; }
    if (url.hostname !== '127.0.0.1') { await route.abort(); return; }
    if (method === 'PUT' && url.pathname.startsWith('/api/local/ministry-audio-objects/') && tracker.uploadDelayMs) await new Promise((r) => setTimeout(r, tracker.uploadDelayMs));
    if (method !== 'GET' && method !== 'OPTIONS' && method !== 'HEAD' && /\/audio-library/.test(url.pathname)) {
      tracker.writes.push(`${method} ${url.pathname.replace(/[a-f0-9]{64}/g, ':id')}`);
      if (/\/stems\//.test(url.pathname) && tracker.uploadDelayMs) await new Promise((r) => setTimeout(r, tracker.uploadDelayMs));
    }
    await route.continue();
  });
  await context.addInitScript((value) => {
    localStorage.setItem('praise_auth_token', value);
    const events: string[] = [];
    (window as Window & { workerEvents?: string[] }).workerEvents = events;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...rest: never[]) {
      events.push(`post:${(message as { type?: string } | null)?.type ?? '?'}`);
      return (post as (...a: unknown[]) => void).call(this, message, ...rest);
    };
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () { events.push('terminate'); return terminate.call(this); };
    const starts: number[] = [];
    (window as Window & { audioStarts?: number[] }).audioStarts = starts;
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) { starts.push(when ?? 0); original.call(this, when, offset, duration); };
  }, token);
  return { context, page: await context.newPage() };
}
const fresh = (): Tracker => ({ writes: [], uploadDelayMs: 0 });

async function startSeparation(page: Page, model: string) {
  await page.goto(`http://127.0.0.1:4176${audioRoute}`);
  await page.getByRole('button', { name: 'Separar uma música localmente' }).click();
  await page.getByTestId('separation-audio').setInputFiles(audioPath);
  await page.getByTestId('separation-model').setInputFiles(modelFile(model));
  await page.getByRole('button', { name: 'Separar faixas' }).click();
}
async function fillAndConfirm(page: Page, title: string) {
  await page.getByRole('button', { name: 'Preparar publicação' }).click();
  await expect(page.getByRole('form', { name: 'Publicar gravação de seis faixas' })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Artista', { exact: true }).fill('Banda local');
  await page.getByLabel('Versão', { exact: true }).fill('Ensaio');
  await expect(page.getByTestId('audio-stem-vocals')).toHaveCount(0);
  await expect(page.locator('[data-testid^="generated-stem-"]')).toHaveCount(6);
  await page.getByRole('checkbox', { name: 'Confirmo a publicação destas faixas no ministério' }).check();
}

test('separação local, pré-escuta, publicação confirmada e reprodução por outro membro', async ({ browser, request }) => {
  const { admin, member } = await setup(request);
  const tracker = fresh();
  const modelRequests: string[] = [];
  const title = `Separada localmente ${randomUUID().slice(0, 8)}`;
  const publisher = await pageFor(browser, admin.token, tracker, modelRequests);
  try {
    const { page } = publisher;
    await startSeparation(page, 'model-ok.onnx');
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    for (const stem of stems) await expect(page.getByTestId(`m22b-stem-channel-${stem}`)).toBeVisible();
    expect(tracker.writes, 'nothing is written while previewing').toEqual([]);

    await fillAndConfirm(page, title);
    expect(tracker.writes, 'nothing is written before the explicit submit').toEqual([]);
    const publish = page.getByRole('button', { name: 'Publicar gravação' });
    await publish.dblclick(); // repeated click
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 60_000 });
    const reserves = tracker.writes.filter((w) => /^POST .*\/uploads$/.test(w));
    expect(reserves).toHaveLength(1);
    expect(tracker.writes.filter((w) => /finalize/.test(w))).toHaveLength(1);
    await expect(page.getByText(title, { exact: true })).toHaveCount(1);
  } finally {
    await publisher.context.close();
  }

  const listenerTracker = fresh();
  const listenerModels: string[] = [];
  const listener = await pageFor(browser, member.token, listenerTracker, listenerModels);
  try {
    const { page } = listener;
    await page.goto(`http://127.0.0.1:4176${audioRoute}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Separar uma música localmente' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nova gravação' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Abrir mixer' }).click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    for (const stem of stems) await expect(page.getByTestId(`m22b-stem-channel-${stem}`)).toBeVisible();
    await page.getByTestId('m22b-mixer-play').click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'playing');
    const starts = await page.evaluate(() => (window as Window & { audioStarts?: number[] }).audioStarts ?? []);
    expect(starts).toHaveLength(6);
    expect(new Set(starts).size).toBe(1);
    expect(listenerTracker.writes).toEqual([]);
    expect(listenerModels).toEqual([]);
  } finally {
    await listener.context.close();
  }
});

test('falha ou cancelamento da separação não escreve nada; sair da tela descarta a operação', async ({ browser, request }) => {
  const { admin } = await setup(request);
  const tracker = fresh();
  const publisher = await pageFor(browser, admin.token, tracker, []);
  try {
    const { page } = publisher;
    await startSeparation(page, 'model-fail.onnx');
    await expect(page.getByRole('alert')).toContainText('Falha simulada');
    await expect(page.getByRole('button', { name: 'Separar faixas' })).toBeEnabled(); // terminal state reached
    await expect(page.getByRole('button', { name: 'Preparar publicação' })).toHaveCount(0);

    await page.getByTestId('separation-model').setInputFiles(modelFile('model-hang.onnx'));
    await page.getByRole('button', { name: 'Separar faixas' }).click();
    await page.getByRole('button', { name: 'Cancelar separação' }).click();
    await expect(page.getByRole('alert')).toContainText('cancelada');
    await expect(page.getByRole('button', { name: 'Separar faixas' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Preparar publicação' })).toHaveCount(0);
    const events = () => page.evaluate(() => (window as Window & { workerEvents?: string[] }).workerEvents ?? []);
    expect(await events()).toContain('terminate'); // the Worker really was stopped by the cancellation
    const terminatedBefore = (await events()).filter((e) => e === 'terminate').length;

    await page.getByRole('button', { name: 'Separar faixas' }).click(); // hangs again, then the user leaves the view
    await expect(page.getByRole('button', { name: 'Cancelar separação' })).toBeVisible();
    await page.getByRole('button', { name: 'Voltar ao ministério' }).click();
    await page.waitForFunction((n) => ((window as Window & { workerEvents?: string[] }).workerEvents ?? []).filter((e) => e === 'terminate').length > n, terminatedBefore);
    await expect(page.getByRole('region', { name: 'Separar música localmente' })).toHaveCount(0);
    expect(tracker.writes).toEqual([]);
  } finally {
    await publisher.context.close();
  }
});

test('cancelar o envio não publica; retomar conclui com os mesmos arquivos', async ({ browser, request }) => {
  const { admin } = await setup(request);
  const tracker = fresh();
  const title = `Cancelada e retomada ${randomUUID().slice(0, 8)}`;
  const publisher = await pageFor(browser, admin.token, tracker, []);
  try {
    const { page } = publisher;
    await startSeparation(page, 'model-ok.onnx');
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await fillAndConfirm(page, title);
    tracker.uploadDelayMs = 4_000;
    await page.getByRole('button', { name: 'Publicar gravação' }).click();
    await page.getByRole('button', { name: 'Cancelar envio' }).click();
    await expect(page.locator('[data-testid^="generated-stem-"]')).toHaveCount(6);
    expect(tracker.writes.filter((w) => /finalize/.test(w))).toHaveLength(0);
    tracker.uploadDelayMs = 0;
    await page.waitForResponse((r) => /\/stems\//.test(r.url()) || r.url().includes('ministry-audio-objects'), { timeout: 15_000 }).catch(() => null); // the cancelled request drains
    expect(tracker.writes.filter((w) => /finalize/.test(w))).toHaveLength(0);
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Retomar publicação' }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(tracker.writes.filter((w) => /finalize/.test(w))).toHaveLength(1);
  } finally {
    await publisher.context.close();
  }
});
