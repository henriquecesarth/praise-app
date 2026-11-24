import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

// M22-E1 — native MP3 import for local Demucs separation, in REAL Chromium.
// Real: OfflineAudioContext.decodeAudioData (resampling, mono), the real screen, the real Worker, the real ONNX model.
// Nothing is uploaded or published; the harness only mounts the production component and records what it hands over.
// Fixtures are tiny synthetic tones (e2e/fixtures/original-mp3); the 168 s file is built in memory from them.

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(WEB_DIR, 'e2e', 'fixtures', 'original-mp3');
const MODEL_PATH = process.env.LOUVAIO_M22A_MODEL_PATH || path.join(os.homedir(), '.cache', 'louvaio-models', 'htdemucs_6s_fp16weights.onnx');
const STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];

const fx = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

/** Repeats the audio frames of a 4 s fixture to ~168 s (under the 180 s limit) or ~204 s (over it). */
function repeated(copies: number): Uint8Array {
  const one = fx('cbr-stereo-44k-id3.mp3');
  const id3 = 10 + ((one[6] << 21) | (one[7] << 14) | (one[8] << 7) | one[9]);
  const audio = one.subarray(id3);
  const out = new Uint8Array(id3 + audio.length * copies);
  out.set(one.subarray(0, id3));
  for (let i = 0; i < copies; i++) out.set(audio, id3 + i * audio.length);
  return out;
}
function silentWav(seconds: number): Buffer {
  const frames = 44_100 * seconds;
  const b = Buffer.alloc(44 + frames * 4);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22); b.writeUInt32LE(44_100, 24); b.writeUInt32LE(44_100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const s = Math.round(Math.sin(i / 14) * 8000 + Math.sin(i / 40) * 6000); b.writeInt16LE(s, 44 + i * 4); b.writeInt16LE(s, 46 + i * 4); }
  return b;
}

let server: ViteDevServer;
let url = '';
const served = new Map<string, Uint8Array | Buffer>();

test.beforeAll(async () => {
  served.set('/fx/cbr-stereo-44k-id3.mp3', fx('cbr-stereo-44k-id3.mp3'));
  served.set('/fx/vbr-stereo-48k.mp3', fx('vbr-stereo-48k.mp3'));
  served.set('/fx/cbr-mono-22k.mp3', fx('cbr-mono-22k.mp3'));
  served.set('/fx/long-168s.mp3', repeated(42));
  served.set('/fx/too-long-204s.mp3', repeated(51));
  const entry = path.join(WEB_DIR, 'src', '__m22e1_entry__.tsx').replace(/\\/g, '/');
  const plugin: Plugin = {
    name: 'm22e1-harness',
    enforce: 'pre',
    resolveId(id) { return id === '/@m22e1-entry.tsx' || id.replace(/\\/g, '/') === entry ? entry : null; },
    load(id) {
      if (id.replace(/\\/g, '/') !== entry) return null;
      return `
        import ReactDOM from 'react-dom/client';
        import { MinistryAudioLocalSeparation } from './components/MinistryAudioLocalSeparation';
        import { prepareSeparationInput } from './audio/separation-input';
        import { parseStrictWavDescriptor } from './audio/separation/demucs-onnx-separator';
        window.__e1 = { prepareSeparationInput, parseStrictWavDescriptor };
        window.__draft = null;
        ReactDOM.createRoot(document.getElementById('root')).render(
          <MinistryAudioLocalSeparation onClose={() => {}} onPrepare={(draft) => { window.__draft = draft; document.body.dataset.prepared = '1'; }} />
        );`;
    },
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const p = (req.url ?? '').split('?')[0];
        if (p === '/m22e1.html') {
          const html = await s.transformIndexHtml(p, `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>M22-E1</title></head><body><div id="root"></div><script type="module" src="/@m22e1-entry.tsx"></script></body></html>`);
          res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
        }
        const bytes = served.get(p);
        if (bytes) { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(bytes.byteLength)); res.end(Buffer.from(bytes)); return; }
        next();
      });
    },
  };
  server = await createServer({
    configFile: false, root: WEB_DIR, plugins: [react(), plugin],
    optimizeDeps: { entries: ['src/components/MinistryAudioLocalSeparation.tsx'], exclude: ['onnxruntime-web'] },
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('harness port');
  url = `http://127.0.0.1:${addr.port}/m22e1.html`;
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('separation-audio')).toBeVisible();
  return errors;
}

/** Runs the production import in the page on a served fixture and returns only plain facts about the WAV it produced. */
async function importInPage(page: Page, file: string, name = file) {
  return page.evaluate(async ({ file, name }) => {
    const w = window as unknown as { __e1: { prepareSeparationInput: (f: File, o?: unknown) => Promise<{ kind: string; wavBytes: ArrayBuffer; mp3?: { sourceChannels: number; frames: number } }>; parseStrictWavDescriptor: (b: ArrayBuffer) => { sampleRate: number; channels: number; bitsPerSample: number; totalFrames: number } } };
    const bytes = await (await fetch(`/fx/${file}`)).arrayBuffer();
    try {
      const out = await w.__e1.prepareSeparationInput(new File([bytes], name, { type: 'audio/mpeg' }));
      const head = w.__e1.parseStrictWavDescriptor(out.wavBytes);
      const pcm = new Int16Array(out.wavBytes, 44);
      let peak = 0; let identical = true;
      for (let i = 0; i < pcm.length; i += 2) { peak = Math.max(peak, Math.abs(pcm[i])); if (pcm[i] !== pcm[i + 1]) identical = false; }
      return { ok: true as const, kind: out.kind, sourceChannels: out.mp3?.sourceChannels, ...head, bytes: out.wavBytes.byteLength, peak, identical };
    } catch (reason) {
      return { ok: false as const, code: (reason as { code?: string }).code ?? 'other', message: (reason as Error).message };
    }
  }, { file, name });
}

test.describe('M22-E1 browser MP3 decoding (real Chromium)', () => {
  for (const [file, channels, label] of [
    ['cbr-stereo-44k-id3.mp3', 2, 'CBR stereo 44.1 kHz with ID3'],
    ['vbr-stereo-48k.mp3', 2, 'VBR stereo 48 kHz (resampled to 44.1 kHz)'],
    ['cbr-mono-22k.mp3', 1, 'CBR mono 22.05 kHz (resampled, duplicated to stereo)'],
  ] as const) {
    test(`decodes ${label} into PCM16 stereo 44.1 kHz`, async ({ page }) => {
      const errors = await open(page);
      const r = await importInPage(page, file);
      expect(r).toMatchObject({ ok: true, kind: 'mp3', sampleRate: 44_100, channels: 2, bitsPerSample: 16, sourceChannels: channels });
      if (!r.ok) return;
      expect(Math.abs(r.totalFrames / 44_100 - 4)).toBeLessThan(0.3); // 4 s tone, up to codec delay/padding
      expect(r.peak).toBeGreaterThan(2000); // real audio, not silence
      expect(r.bytes).toBe(44 + r.totalFrames * 4);
      if (channels === 1) expect(r.identical).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('rejects a renamed non-MP3, a damaged MP3 and an over-180 s MP3 before decoding', async ({ page }) => {
    await open(page);
    const renamed = await page.evaluate(async () => {
      const w = window as unknown as { __e1: { prepareSeparationInput: (f: File) => Promise<unknown> } };
      const png = new Uint8Array(4096); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      try { await w.__e1.prepareSeparationInput(new File([png], 'musica.mp3', { type: 'audio/mpeg' })); return 'accepted'; } catch (r) { return (r as { code: string }).code; }
    });
    expect(renamed).toBe('NOT_MP3');
    expect(await importInPage(page, 'too-long-204s.mp3')).toMatchObject({ ok: false, code: 'TOO_LONG' });
  });

  test('imports a 168 s MP3 within the memory budget and reports the cost', async ({ page }, testInfo) => {
    await open(page);
    const before = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
    const started = Date.now();
    const r = await importInPage(page, 'long-168s.mp3');
    const elapsedMs = Date.now() - started;
    const after = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
    expect(r).toMatchObject({ ok: true, sampleRate: 44_100, channels: 2 });
    if (!r.ok) return;
    expect(r.totalFrames / 44_100).toBeGreaterThan(165);
    expect(r.totalFrames / 44_100).toBeLessThanOrEqual(180);
    expect(r.bytes).toBeLessThanOrEqual(36 * 1024 * 1024);
    const report = { frames: r.totalFrames, wavBytes: r.bytes, decodedFloatBytesStereo: r.totalFrames * 4 * 2, jsHeapBefore: before, jsHeapAfter: after, elapsedMs };
    console.log(`M22E1_MEMORY ${JSON.stringify(report)}`);
    await testInfo.attach('memory', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  });
});

test.describe('M22-E1 real Demucs separation started from the screen (real model)', () => {
  test.skip(!existsSync(MODEL_PATH), `ONNX model missing at ${MODEL_PATH}`);

  async function separate(page: Page, audio: string | { name: string; mimeType: string; buffer: Buffer }) {
    await page.getByTestId('separation-audio').setInputFiles(audio as never);
    await page.getByTestId('separation-model').setInputFiles(MODEL_PATH);
    await page.getByRole('button', { name: 'Separar faixas' }).click();
    await expect(page.getByRole('heading', { name: 'Pré-escuta das seis faixas' })).toBeVisible({ timeout: 360_000 });
    await page.getByRole('button', { name: 'Preparar publicação' }).click();
    await expect(page.locator('body[data-prepared="1"]')).toHaveCount(1);
    return page.evaluate(async () => {
      const w = window as unknown as { __draft: { files(): Record<string, File>; mixerInputs(): Array<{ id: string; sha256: string; totalFrames: number; sampleRate: number; byteLength: number }>; totalFrames: number; sampleRate: number; model: unknown }; __e1: { parseStrictWavDescriptor: (b: ArrayBuffer) => { sampleRate: number; channels: number; bitsPerSample: number; totalFrames: number } } };
      const hex = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
      const files = w.__draft.files();
      const out: Array<{ id: string; name: string; sha256: string; manifestSha: string; frames: number; rate: number; channels: number; bits: number; bytes: number; peak: number }> = [];
      for (const m of w.__draft.mixerInputs()) {
        const buf = await files[m.id].arrayBuffer();
        const head = w.__e1.parseStrictWavDescriptor(buf);
        const pcm = new Int16Array(buf, 44);
        let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
        out.push({ id: m.id, name: files[m.id].name, sha256: await hex(buf), manifestSha: m.sha256, frames: head.totalFrames, rate: head.sampleRate, channels: head.channels, bits: head.bitsPerSample, bytes: buf.byteLength, peak });
      }
      return { stems: out, totalFrames: w.__draft.totalFrames, sampleRate: w.__draft.sampleRate, model: w.__draft.model };
    });
  }

  for (const [file, label] of [['cbr-stereo-44k-id3.mp3', 'MP3 CBR with ID3'], ['cbr-mono-22k.mp3', 'mono 22.05 kHz MP3']] as const) {
    test(`separates a ${label} into six verified stems`, async ({ page }, testInfo) => {
      await open(page);
      const result = await separate(page, path.join(FIXTURES, file));
      expect(result.sampleRate).toBe(44_100);
      expect(result.stems.map((s) => s.id)).toEqual(STEMS);
      expect(Math.abs(result.totalFrames / 44_100 - 4)).toBeLessThan(0.3);
      for (const stem of result.stems) {
        expect(stem).toMatchObject({ name: `${stem.id}.wav`, rate: 44_100, channels: 2, bits: 16, frames: result.totalFrames });
        expect(stem.sha256).toBe(stem.manifestSha);
        expect(stem.bytes).toBe(44 + stem.frames * 4);
      }
      expect(result.stems.some((s) => s.peak > 100)).toBe(true);
      console.log(`M22E1_REAL_DEMUCS ${file} ${JSON.stringify(result.stems.map((s) => ({ id: s.id, sha256: s.sha256.slice(0, 12), frames: s.frames, peak: s.peak })))}`);
      await testInfo.attach(`stems-${file}`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    });
  }

  test('WAV regression: a WAV still separates through the same screen', async ({ page }) => {
    await open(page);
    const result = await separate(page, { name: 'musica.wav', mimeType: 'audio/wav', buffer: silentWav(3) });
    expect(result.stems.map((s) => s.id)).toEqual(STEMS);
    expect(result.totalFrames).toBe(3 * 44_100);
    for (const stem of result.stems) expect(stem.sha256).toBe(stem.manifestSha);
  });
});
