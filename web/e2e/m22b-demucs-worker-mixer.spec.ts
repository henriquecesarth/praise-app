import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import {
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  decodeWavToStereoFloat32,
  encodeStereoPcm16Wav,
  type CanonicalStemId,
  type SeparationTelemetryMetrics,
} from '../src/audio/separation/demucs-onnx-separator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(WEB_DIR, '..');
const M22A_EVIDENCE_PATH = path.join(
  REPO_DIR,
  'docs',
  'exec-plans',
  'evidence',
  'm22-a',
  'browser-benchmark-report.json'
);
const M22B_EVIDENCE_PATH = path.join(
  REPO_DIR,
  'docs',
  'exec-plans',
  'evidence',
  'm22-b',
  'worker-provider-benchmarks.json'
);
const DEFAULT_MODEL_PATH = path.join(
  os.homedir(),
  '.cache',
  'louvaio-models',
  'htdemucs_6s_fp16weights.onnx'
);
const EXPECTED_M22A_INPUT_SHA256 =
  '97447c581f359d035988ee1aa765c96008b4f56114c299b35026a1dc5d2e04d3';

const ALLOWED_ORT_ASSETS = new Set([
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]);

async function buildRealMultiInstrumentTestWav(): Promise<{
  wavBytes: Uint8Array;
  totalFrames: number;
  sampleRate: number;
  durationSeconds: number;
}> {
  const sampleRate = 44100;
  const durationSeconds = 8.5;
  const totalFrames = Math.round(sampleRate * durationSeconds);
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);

  const pianoNotes = [
    'midi-060.wav',
    'midi-063.wav',
    'midi-069.wav',
    'midi-047.wav',
  ];
  const decodedNotes = await Promise.all(
    pianoNotes.map(async (fileName) => {
      const wavPath = path.join(
        WEB_DIR,
        'public',
        'audio',
        'upright-kw',
        fileName
      );
      const raw = await fs.readFile(wavPath);
      const ab = raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength
      );
      return decodeWavToStereoFloat32(ab, { expectedSampleRate: sampleRate });
    })
  );

  const pianoPlacements = [
    { noteIdx: 0, startSec: 0.1, gainL: 0.25, gainR: 0.28 },
    { noteIdx: 1, startSec: 0.45, gainL: 0.24, gainR: 0.22 },
    { noteIdx: 2, startSec: 0.8, gainL: 0.2, gainR: 0.26 },
    { noteIdx: 3, startSec: 2.0, gainL: 0.26, gainR: 0.26 },
    { noteIdx: 0, startSec: 4.1, gainL: 0.24, gainR: 0.26 },
    { noteIdx: 2, startSec: 6.2, gainL: 0.22, gainR: 0.25 },
  ];

  for (const placement of pianoPlacements) {
    const src = decodedNotes[placement.noteIdx];
    const startFrame = Math.floor(placement.startSec * sampleRate);
    const maxCopy = Math.min(
      src.totalFrames,
      totalFrames - startFrame,
      Math.floor(2.2 * sampleRate)
    );
    for (let i = 0; i < maxCopy; i++) {
      const fadeOut = i > maxCopy - 2205 ? (maxCopy - i) / 2205 : 1;
      left[startFrame + i] += src.left[i] * placement.gainL * fadeOut;
      right[startFrame + i] += src.right[i] * placement.gainR * fadeOut;
    }
  }

  for (let i = 0; i < totalFrames; i++) {
    const t = i / sampleRate;

    const bassFreq = Math.floor(t / 2) % 2 === 0 ? 55 : 73.42;
    const bassEnv = Math.exp(-((t % 1.0) * 2.4));
    const bass =
      (Math.sin(2 * Math.PI * bassFreq * t) * 0.7 +
        Math.sin(2 * Math.PI * bassFreq * 2 * t) * 0.2) *
      bassEnv *
      0.18;

    const beatPhase = t % 0.5;
    const kick =
      beatPhase < 0.14
        ? Math.sin(
            2 * Math.PI * (120 * Math.exp(-beatPhase * 22) + 42) * beatPhase
          ) *
          Math.exp(-beatPhase * 24) *
          0.22
        : 0;
    const offBeatPhase = (t + 0.5) % 1.0;
    const hatNoise = Math.sin(i * 12.9898) * Math.cos(i * 78.233);
    const snare =
      offBeatPhase < 0.08
        ? (Math.sin(2 * Math.PI * 195 * offBeatPhase) * 0.4 + hatNoise * 0.6) *
          Math.exp(-offBeatPhase * 40) *
          0.14
        : 0;

    const guitarGate = t % 0.75 < 0.55 ? Math.exp(-((t % 0.75) * 4.5)) : 0;
    const guitar =
      (Math.sin(2 * Math.PI * 196 * t) * 0.6 +
        Math.sin(2 * Math.PI * 392 * t) * 0.28 +
        Math.sin(2 * Math.PI * 588 * t) * 0.12) *
      guitarGate *
      0.13;

    const noteIdx = Math.floor(t / 1.5) % 3;
    const vocalBase = noteIdx === 0 ? 329.63 : noteIdx === 1 ? 392.0 : 440.0;
    const vibrato = 1 + 0.008 * Math.sin(2 * Math.PI * 5.2 * t);
    const vocalFreq = vocalBase * vibrato;
    const vocalEnv = Math.min(1, (t % 1.5) * 10) * Math.exp(-((t % 1.5) * 0.6));
    const vocal =
      (Math.sin(2 * Math.PI * vocalFreq * t) * 0.55 +
        Math.sin(2 * Math.PI * vocalFreq * 2 * t) * 0.25 +
        Math.sin(2 * Math.PI * vocalFreq * 3 * t) * 0.12) *
      vocalEnv *
      0.18;

    left[i] = Math.max(
      -0.98,
      Math.min(0.98, left[i] + bass + kick + snare + guitar * 1.1 + vocal)
    );
    right[i] = Math.max(
      -0.98,
      Math.min(0.98, right[i] + bass + kick + snare + guitar * 0.9 + vocal)
    );
  }

  const wavBytes = encodeStereoPcm16Wav({ sampleRate, left, right });
  return { wavBytes, totalFrames, sampleRate, durationSeconds };
}

function sha256HexNode(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256FileNode(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

interface HarnessReportPayload {
  telemetry: SeparationTelemetryMetrics;
  stems: Array<{
    id: CanonicalStemId;
    labelPtBr: string;
    byteLength: number;
    sha256: string;
    rms: number;
    peak: number;
    totalFrames: number;
  }>;
  uiHeartbeat: {
    ticks: number;
    maxDriftMs: number;
  };
}

interface ScenarioRunCapture {
  scenarioId: string;
  description: string;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  hasWebGpu: boolean;
  mainThreadHeapUsedBytes: number | null;
  probeWallMs: number;
  status: string;
  errorMessage: string | null;
  report: HarnessReportPayload | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedAssetUrls: string[];
}

async function withHarnessViteServer<T>(
  options: {
    crossOriginIsolated: boolean;
    modelPath: string;
    mixWavBytes: Uint8Array;
  },
  fn: (harnessUrl: string) => Promise<T>
): Promise<T> {
  const virtualEntryAbs = path
    .join(
      WEB_DIR,
      'src',
      'audio',
      'separation',
      '__m22b_virtual_entry__.tsx'
    )
    .replace(/\\/g, '/');

  const applyCoiHeaders = (res: {
    setHeader(name: string, value: string): void;
  }) => {
    if (options.crossOriginIsolated) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }
  };

  const harnessPlugin: Plugin = {
    name: 'm22b-harness-server',
    enforce: 'pre',
    resolveId(id) {
      if (
        id === '/@m22b-harness-entry.tsx' ||
        id.replace(/\\/g, '/') === virtualEntryAbs
      ) {
        return virtualEntryAbs;
      }
      return null;
    },
    load(id) {
      if (id.replace(/\\/g, '/') === virtualEntryAbs) {
        return `
          import React from 'react';
          import ReactDOM from 'react-dom/client';
          import { DemucsOnnxBenchmarkHarness } from './DemucsOnnxBenchmarkHarness';

          const rootEl = document.getElementById('root');
          if (rootEl) {
            ReactDOM.createRoot(rootEl).render(
              <React.StrictMode>
                <DemucsOnnxBenchmarkHarness
                  initialModelUrl="/models/htdemucs_6s_fp16weights.onnx"
                  initialAudioUrl="/fixtures/m22b-multi-instrument-mix.wav"
                  wasmPaths="/ort/"
                  initialExecutionMode="worker"
                  initialUseModelBytesCache={true}
                  initialReuseWarmSession={false}
                />
              </React.StrictMode>
            );
          }
        `;
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        applyCoiHeaders(res);
        const urlPath = (req.url ?? '').split('?')[0];

        if (urlPath === '/m22b-harness.html') {
          const rawHtml = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>M22-B Demucs Worker & 6-Stem Mixer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/@m22b-harness-entry.tsx"></script>
  </body>
</html>`;
          const html = await server.transformIndexHtml(
            '/m22b-harness.html',
            rawHtml
          );
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          applyCoiHeaders(res);
          res.end(html);
          return;
        }

        if (urlPath.startsWith('/ort/')) {
          const assetName = path.basename(urlPath);
          if (!ALLOWED_ORT_ASSETS.has(assetName)) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
          const assetPath = path.join(
            WEB_DIR,
            'node_modules',
            'onnxruntime-web',
            'dist',
            assetName
          );
          const contentType = assetName.endsWith('.wasm')
            ? 'application/wasm'
            : 'text/javascript; charset=utf-8';
          const stat = await fs.stat(assetPath);
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', String(stat.size));
          applyCoiHeaders(res);
          createReadStream(assetPath).pipe(res);
          return;
        }

        if (urlPath === '/models/htdemucs_6s_fp16weights.onnx') {
          const stat = await fs.stat(options.modelPath);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', String(stat.size));
          applyCoiHeaders(res);
          createReadStream(options.modelPath).pipe(res);
          return;
        }

        if (urlPath === '/fixtures/m22b-multi-instrument-mix.wav') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Content-Length', String(options.mixWavBytes.byteLength));
          applyCoiHeaders(res);
          res.end(Buffer.from(options.mixWavBytes));
          return;
        }

        next();
      });
    },
  };

  let viteServer: ViteDevServer | null = null;
  try {
    viteServer = await createServer({
      configFile: false,
      root: WEB_DIR,
      plugins: [react(), harnessPlugin],
      optimizeDeps: {
        entries: ['src/audio/separation/DemucsOnnxBenchmarkHarness.tsx'],
        exclude: ['onnxruntime-web'],
      },
      server: {
        host: '127.0.0.1',
        port: 0,
        headers: options.crossOriginIsolated
          ? {
              'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'require-corp',
              'Cross-Origin-Resource-Policy': 'same-origin',
            }
          : undefined,
      },
    });
    await viteServer.listen();
    const addr = viteServer.httpServer?.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind M22-B Vite harness server port.');
    }
    const url = `http://127.0.0.1:${addr.port}/m22b-harness.html`;
    return await fn(url);
  } finally {
    if (viteServer) {
      await viteServer.close();
      viteServer = null;
    }
  }
}

async function readPageEnvSnapshot(page: Page): Promise<{
  userAgent: string;
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  hasWebGpu: boolean;
  mainThreadHeapUsedBytes: number | null;
}> {
  return page.evaluate(() => {
    const perfWithMemory = performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    };
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      crossOriginIsolated: Boolean(window.crossOriginIsolated),
      hasWebGpu: 'gpu' in navigator && navigator.gpu !== undefined,
      mainThreadHeapUsedBytes:
        typeof perfWithMemory.memory?.usedJSHeapSize === 'number'
          ? perfWithMemory.memory.usedJSHeapSize
          : null,
    };
  });
}

async function runHarnessAndCapture(
  page: Page,
  scenarioId: string,
  description: string,
  timeoutMs = 240_000
): Promise<ScenarioRunCapture> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedAssetUrls: string[] = [];

  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };
  const onPageError = (err: Error) => {
    pageErrors.push(err.message);
  };
  const onResponse = (res: { status(): number; url(): string }) => {
    if (res.status() >= 400) {
      failedAssetUrls.push(`${res.status()} ${res.url()}`);
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  try {
    const startWallMs = Date.now();
    await page.getByTestId('m22a-run-button').click();
    const statusLoc = page.getByTestId('m22a-status');
    await expect
      .poll(
        async () => {
          const st = await statusLoc.getAttribute('data-status');
          return st === 'completed' || st === 'error' || st === 'cancelled';
        },
        { timeout: timeoutMs }
      )
      .toBe(true);
    const probeWallMs = Date.now() - startWallMs;

    const status = (await statusLoc.getAttribute('data-status')) ?? 'unknown';
    const env = await readPageEnvSnapshot(page);
    const errorLoc = page.getByTestId('m22a-error');
    const errorMessage =
      (await errorLoc.count()) > 0 ? await errorLoc.textContent() : null;

    let report: HarnessReportPayload | null = null;
    if (status === 'completed') {
      await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute(
        'data-state',
        /^(ready|error)$/,
        { timeout: 30_000 }
      );
      const reportText = await page
        .getByTestId('m22a-report-json')
        .textContent();
      if (reportText) {
        report = JSON.parse(reportText) as HarnessReportPayload;
      }
    }

    return {
      scenarioId,
      description,
      crossOriginIsolated: env.crossOriginIsolated,
      hardwareConcurrency: env.hardwareConcurrency,
      hasWebGpu: env.hasWebGpu,
      mainThreadHeapUsedBytes: env.mainThreadHeapUsedBytes,
      probeWallMs,
      status,
      errorMessage,
      report,
      consoleErrors,
      pageErrors,
      failedAssetUrls,
    };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

test.describe.serial('M22-B Web Worker, Execution Providers & 6-Stem Mixer Benchmark', () => {
  let modelPath = '';
  let measuredModelBytes = 0;
  let measuredModelSha256 = '';
  let inputAudioSha256 = '';
  let mixWavBytes: Uint8Array = new Uint8Array(0);
  let expectedFrames = 0;
  let nonCoiResults: {
    browserEnv: {
      userAgent: string;
      hardwareConcurrency: number;
      crossOriginIsolated: boolean;
      hasWebGpu: boolean;
    };
    workerWasm1ThreadCold: ScenarioRunCapture;
    workerWasm1ThreadCachedBytes: ScenarioRunCapture;
    workerWasm1ThreadWarmSession: ScenarioRunCapture;
    workerWebGpuOnlyProbe: ScenarioRunCapture;
    workerWebGpuWithWasmFallback: ScenarioRunCapture;
    workerCancellation: {
      cancelLatencyMs: number;
      cancelledDuringPhase: string;
      finalStatus: string;
      cleaningUp: string;
      postCancelResumedStatus: string;
      consoleErrors: string[];
      pageErrors: string[];
    };
    sixStemMixer: {
      initialState: string;
      maxInterStemStartDriftSeconds: number;
      scheduleDeadlineMissed: boolean;
      scheduleSpanSeconds: number;
      playingState: string;
      afterMuteAudible: Record<CanonicalStemId, boolean>;
      afterSoloVocalsAudible: Record<CanonicalStemId, boolean>;
      seekTargetFrame: number;
      seekPositionTextAfterPlay: string;
      pausedState: string;
      exportedStemWavBytes: Record<CanonicalStemId, number>;
      exportedStemWaveHeaderValid: boolean;
      libraryTargets: string[];
      disposedUnmounted: boolean;
      consoleErrors: string[];
      pageErrors: string[];
    };
  } | null = null;

  test.beforeAll(async () => {
    modelPath = process.env.LOUVAIO_M22A_MODEL_PATH || DEFAULT_MODEL_PATH;
    if (!existsSync(modelPath)) {
      throw new Error(`Real ONNX model missing at ${modelPath}`);
    }
    const stat = await fs.stat(modelPath);
    measuredModelBytes = stat.size;
    measuredModelSha256 = await sha256FileNode(modelPath);
    expect(measuredModelBytes).toBe(
      HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelBytes
    );
    expect(measuredModelSha256).toBe(
      HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelSha256
    );

    const mix = await buildRealMultiInstrumentTestWav();
    mixWavBytes = mix.wavBytes;
    expectedFrames = mix.totalFrames;
    inputAudioSha256 = sha256HexNode(mix.wavBytes);
    expect(inputAudioSha256).toBe(EXPECTED_M22A_INPUT_SHA256);
    expect(expectedFrames).toBe(374850);
  });

  test('runs non-COI Worker WASM cache tiers, mixer E2E, WebGPU fallback, and safe cancellation', async ({
    page,
  }) => {
    test.setTimeout(1_200_000);

    await withHarnessViteServer(
      {
        crossOriginIsolated: false,
        modelPath,
        mixWavBytes,
      },
      async (harnessUrl) => {
        await page.goto(harnessUrl, { waitUntil: 'networkidle' });
        await expect(page.getByTestId('m22a-benchmark-harness')).toBeVisible();
        await expect(
          page.getByTestId('m22b-execution-mode-select')
        ).toHaveValue('worker');

        const browserEnv = await readPageEnvSnapshot(page);
        expect(browserEnv.crossOriginIsolated).toBe(false);

        // Scenario 1A: Worker WASM 1T Cold Load
        await page.getByTestId('m22b-clear-cache-button').click();
        await expect(page.getByTestId('m22b-cache-bytes-toggle')).toBeChecked();
        await expect(
          page.getByTestId('m22b-warm-session-toggle')
        ).not.toBeChecked();

        const coldRun = await runHarnessAndCapture(
          page,
          'worker-wasm-1t-cold',
          'Web Worker WASM SIMD 1-thread cold model fetch, SHA-256 verification, and session init'
        );
        expect(coldRun.status).toBe('completed');
        expect(coldRun.consoleErrors).toEqual([]);
        expect(coldRun.pageErrors).toEqual([]);
        expect(coldRun.failedAssetUrls).toEqual([]);
        expect(coldRun.report).not.toBeNull();
        expect(coldRun.report!.telemetry.executionProvider).toBe('wasm');
        expect(coldRun.report!.telemetry.executionContext).toBe('web_worker');
        expect(coldRun.report!.telemetry.crossOriginIsolated).toBe(false);
        expect(coldRun.report!.telemetry.wasmNumThreads).toBe(1);
        expect(coldRun.report!.telemetry.modelCacheMode).toBe('none');
        expect(coldRun.report!.telemetry.modelCacheHit).toBe(false);
        expect(coldRun.report!.telemetry.modelChecksumVerified).toBe(true);
        expect(coldRun.report!.telemetry.chunksProcessed).toBe(2);
        expect(coldRun.report!.telemetry.totalFrames).toBe(expectedFrames);
        expect(coldRun.report!.telemetry.inputSha256).toBe(inputAudioSha256);
        expect(coldRun.report!.uiHeartbeat.ticks).toBeGreaterThanOrEqual(20);
        expect(coldRun.report!.uiHeartbeat.maxDriftMs).toBeLessThan(2000);
        expect(coldRun.report!.stems).toHaveLength(6);

        const canonicalDigests = Object.fromEntries(
          coldRun.report!.stems.map((s) => [s.id, s.sha256])
        ) as Record<CanonicalStemId, string>;

        // Scenario 1B: Worker WASM 1T Cached Bytes (populates warm session for 1C)
        await page.getByTestId('m22b-warm-session-toggle').check();
        const cachedBytesRun = await runHarnessAndCapture(
          page,
          'worker-wasm-1t-cached-bytes',
          'Web Worker WASM SIMD 1-thread reusing verified in-memory model bytes while creating fresh ORT session'
        );
        expect(cachedBytesRun.status).toBe('completed');
        expect(cachedBytesRun.consoleErrors).toEqual([]);
        expect(cachedBytesRun.pageErrors).toEqual([]);
        expect(cachedBytesRun.report!.telemetry.modelCacheMode).toBe(
          'memory_bytes'
        );
        expect(cachedBytesRun.report!.telemetry.modelCacheHit).toBe(true);
        expect(
          cachedBytesRun.report!.telemetry.modelBytesFetchMs ?? 0
        ).toBeLessThan(50);
        expect(
          cachedBytesRun.report!.telemetry.sessionInitMs ?? 0
        ).toBeGreaterThan(0);
        for (const s of cachedBytesRun.report!.stems) {
          expect(s.sha256).toBe(canonicalDigests[s.id]);
        }

        // Scenario 1C: Worker WASM 1T Warm Session Reuse
        const warmSessionRun = await runHarnessAndCapture(
          page,
          'worker-wasm-1t-warm-session',
          'Web Worker WASM SIMD 1-thread reusing warm ORT InferenceSession inside persistent Worker'
        );
        expect(warmSessionRun.status).toBe('completed');
        expect(warmSessionRun.consoleErrors).toEqual([]);
        expect(warmSessionRun.pageErrors).toEqual([]);
        expect(warmSessionRun.report!.telemetry.modelCacheMode).toBe(
          'session_reused'
        );
        expect(warmSessionRun.report!.telemetry.modelCacheHit).toBe(true);
        expect(warmSessionRun.report!.telemetry.modelLoadMs).toBe(0);
        expect(warmSessionRun.report!.telemetry.sessionInitMs ?? 0).toBe(0);
        for (const s of warmSessionRun.report!.stems) {
          expect(s.sha256).toBe(canonicalDigests[s.id]);
        }

        // Scenario 2: 6-Stem Web Audio Mixer E2E
        const mixerConsoleErrors: string[] = [];
        const mixerPageErrors: string[] = [];
        const onMixerConsole = (msg: { type(): string; text(): string }) => {
          if (msg.type() === 'error') mixerConsoleErrors.push(msg.text());
        };
        const onMixerPageError = (err: Error) => {
          mixerPageErrors.push(err.message);
        };
        page.on('console', onMixerConsole);
        page.on('pageerror', onMixerPageError);

        let mixerCapture: NonNullable<typeof nonCoiResults>['sixStemMixer'];
        try {
          await expect(page.getByTestId('m22b-six-stem-mixer')).toBeVisible();
          const mixerStatus = page.getByTestId('m22b-mixer-status');
          await expect(mixerStatus).toHaveAttribute('data-state', 'ready', {
            timeout: 30_000,
          });
          const initialState =
            (await mixerStatus.getAttribute('data-state')) ?? 'unknown';

          const syncText = await page
            .getByTestId('m22b-mixer-sync-badge')
            .textContent();
          expect(syncText).toContain('0.000 ms');

          await page.getByTestId('m22b-mixer-play').click();
          await expect(mixerStatus).toHaveAttribute('data-state', 'playing', {
            timeout: 15_000,
          });
          const playingState =
            (await mixerStatus.getAttribute('data-state')) ?? 'unknown';
          const syncBadge = page.getByTestId('m22b-mixer-sync-badge');
          await expect(syncBadge).toHaveAttribute(
            'data-schedule-deadline-missed',
            'false'
          );
          await expect(syncBadge).toHaveAttribute('data-max-drift-seconds', '0');
          const measuredPlayDriftSeconds = Number(
            (await syncBadge.getAttribute('data-max-drift-seconds')) ?? 'NaN'
          );
          const deadlineAttr = await syncBadge.getAttribute(
            'data-schedule-deadline-missed'
          );
          expect(deadlineAttr).toBe('false');
          const measuredDeadlineMissed = false;
          const measuredScheduleSpanSeconds = Number(
            (await syncBadge.getAttribute('data-schedule-span-seconds')) ?? 'NaN'
          );
          expect(Number.isFinite(measuredPlayDriftSeconds)).toBe(true);
          expect(measuredPlayDriftSeconds).toBe(0);
          expect(Number.isFinite(measuredScheduleSpanSeconds)).toBe(true);

          // Mute drums
          await page.getByTestId('m22b-stem-mute-drums').click();
          await expect(
            page.getByTestId('m22b-stem-audible-drums')
          ).toHaveAttribute('data-audible', 'false');
          const afterMuteAudible = {} as Record<CanonicalStemId, boolean>;
          for (const stemId of CANONICAL_STEM_IDS) {
            const attr = await page
              .getByTestId(`m22b-stem-audible-${stemId}`)
              .getAttribute('data-audible');
            afterMuteAudible[stemId] = attr === 'true';
          }
          expect(afterMuteAudible.drums).toBe(false);
          expect(afterMuteAudible.vocals).toBe(true);

          // Solo vocals
          await page.getByTestId('m22b-stem-solo-vocals').click();
          const afterSoloVocalsAudible = {} as Record<CanonicalStemId, boolean>;
          for (const stemId of CANONICAL_STEM_IDS) {
            const attr = await page
              .getByTestId(`m22b-stem-audible-${stemId}`)
              .getAttribute('data-audible');
            afterSoloVocalsAudible[stemId] = attr === 'true';
          }
          expect(afterSoloVocalsAudible.vocals).toBe(true);
          expect(afterSoloVocalsAudible.bass).toBe(false);
          expect(afterSoloVocalsAudible.drums).toBe(false);

          // Restore solo/mute and tweak volume + master volume
          await page.getByTestId('m22b-stem-solo-vocals').click();
          await page.getByTestId('m22b-stem-mute-drums').click();
          await page.getByTestId('m22b-stem-volume-vocals').fill('0.75');
          await page.getByTestId('m22b-mixer-master-volume').fill('0.85');

          // Seek while playing
          const seekTargetFrame = 187425; // 4.25s
          await page
            .getByTestId('m22b-mixer-seek')
            .fill(String(seekTargetFrame));
          await expect(mixerStatus).toHaveAttribute('data-state', 'playing');
          await expect(
            page.getByTestId('m22b-mixer-sync-badge')
          ).toContainText('0.000 ms');
          const seekPositionTextAfterPlay =
            (await page.getByTestId('m22b-mixer-position').textContent()) ?? '';
          expect(seekPositionTextAfterPlay).toMatch(/0:04\.\d/);
          const frameMatch = seekPositionTextAfterPlay.match(
            /frame (\d+)\/374850/
          );
          expect(Number(frameMatch?.[1] ?? 0)).toBeGreaterThanOrEqual(
            seekTargetFrame
          );

          await page.getByTestId('m22b-mixer-pause').click();
          await expect(mixerStatus).toHaveAttribute('data-state', 'paused');
          const pausedState =
            (await mixerStatus.getAttribute('data-state')) ?? 'unknown';

          // Verify all 6 WAV blob exports directly from anchor hrefs
          const exportedStemWavBytes = {} as Record<CanonicalStemId, number>;
          let exportedStemWaveHeaderValid = true;
          for (const stemId of CANONICAL_STEM_IDS) {
            const exportLink = page.getByTestId(`m22b-stem-export-${stemId}`);
            const href = await exportLink.getAttribute('href');
            const downloadAttr = await exportLink.getAttribute('download');
            expect(href).toBeTruthy();
            expect(href!.startsWith('blob:')).toBe(true);
            expect(downloadAttr).toBe(`${stemId}.wav`);

            const wavAudit = await page.evaluate(async (blobUrl) => {
              const res = await fetch(blobUrl);
              const bytes = new Uint8Array(await res.arrayBuffer());
              const riff = String.fromCharCode(
                bytes[0],
                bytes[1],
                bytes[2],
                bytes[3]
              );
              const wave = String.fromCharCode(
                bytes[8],
                bytes[9],
                bytes[10],
                bytes[11]
              );
              return { byteLength: bytes.byteLength, validHeader: riff === 'RIFF' && wave === 'WAVE' };
            }, href!);
            expect(wavAudit.byteLength).toBe(44 + expectedFrames * 4);
            expect(wavAudit.validHeader).toBe(true);
            exportedStemWavBytes[stemId] = wavAudit.byteLength;
            exportedStemWaveHeaderValid =
              exportedStemWaveHeaderValid && wavAudit.validHeader;
          }

          // Verify target library options are strictly ministry_library & louvaio_library
          const librarySelect = page.getByTestId('m22b-target-library-select');
          const libraryTargets = await librarySelect
            .locator('option')
            .evaluateAll((opts) =>
              opts.map((opt) => (opt as HTMLOptionElement).value)
            );
          expect(libraryTargets).toEqual(['ministry_library', 'louvaio_library']);
          await librarySelect.selectOption('louvaio_library');
          await expect(librarySelect).toHaveValue('louvaio_library');
          await librarySelect.selectOption('ministry_library');
          await expect(librarySelect).toHaveValue('ministry_library');

          // Dispose mixer cleanly (Harness unmounts panel via onDisposed)
          await page.getByTestId('m22b-mixer-dispose').click();
          await expect(page.getByTestId('m22b-six-stem-mixer')).toHaveCount(0);

          expect(mixerConsoleErrors).toEqual([]);
          expect(mixerPageErrors).toEqual([]);

          mixerCapture = {
            initialState,
            maxInterStemStartDriftSeconds: measuredPlayDriftSeconds,
            scheduleDeadlineMissed: measuredDeadlineMissed,
            scheduleSpanSeconds: measuredScheduleSpanSeconds,
            playingState,
            afterMuteAudible,
            afterSoloVocalsAudible,
            seekTargetFrame,
            seekPositionTextAfterPlay,
            pausedState,
            exportedStemWavBytes,
            exportedStemWaveHeaderValid,
            libraryTargets,
            disposedUnmounted: true,
            consoleErrors: mixerConsoleErrors,
            pageErrors: mixerPageErrors,
          };
        } finally {
          page.off('console', onMixerConsole);
          page.off('pageerror', onMixerPageError);
        }

        // Scenario 3A: WebGPU-only probe (records real error or success cleanly)
        await page.getByTestId('m22b-warm-session-toggle').uncheck();
        await page.getByTestId('m22a-provider-select').selectOption('webgpu');
        const webGpuOnlyRun = await runHarnessAndCapture(
          page,
          'worker-webgpu-only',
          'Web Worker WebGPU-only execution provider probe without fallback'
        );

        // Scenario 3B: WebGPU with automatic fallback to WASM
        await page
          .getByTestId('m22a-provider-select')
          .selectOption('webgpu-fallback');
        const webGpuFallbackRun = await runHarnessAndCapture(
          page,
          'worker-webgpu-fallback-wasm',
          'Web Worker preferring WebGPU with automatic fallback to WASM SIMD 1-thread'
        );
        expect(webGpuFallbackRun.status).toBe('completed');
        expect(webGpuFallbackRun.report).not.toBeNull();
        if (webGpuOnlyRun.status === 'error') {
          expect(
            webGpuFallbackRun.report!.telemetry.executionProvider
          ).toBe('wasm');
          expect(
            webGpuFallbackRun.report!.telemetry.providerFallbackReason
          ).toBeTruthy();
        } else {
          expect(['webgpu', 'wasm']).toContain(
            webGpuFallbackRun.report!.telemetry.executionProvider
          );
        }
        if (webGpuFallbackRun.report!.telemetry.executionProvider === 'wasm') {
          for (const s of webGpuFallbackRun.report!.stems) {
            expect(s.sha256).toBe(canonicalDigests[s.id]);
          }
        } else {
          expect(webGpuFallbackRun.report!.stems).toHaveLength(6);
          for (const s of webGpuFallbackRun.report!.stems) {
            expect(s.byteLength).toBe(44 + expectedFrames * 4);
            expect(s.rms).toBeGreaterThan(0.001);
          }
        }

        // Scenario 4: Worker Safe Mid-Run Cancellation + Clean Recovery
        const cancelConsoleErrors: string[] = [];
        const cancelPageErrors: string[] = [];
        const onCancelConsole = (msg: { type(): string; text(): string }) => {
          if (msg.type() === 'error') cancelConsoleErrors.push(msg.text());
        };
        const onCancelPageError = (err: Error) => {
          cancelPageErrors.push(err.message);
        };
        page.on('console', onCancelConsole);
        page.on('pageerror', onCancelPageError);

        let workerCancellation: NonNullable<
          typeof nonCoiResults
        >['workerCancellation'];
        try {
          await page.getByTestId('m22a-provider-select').selectOption('wasm');
          await page.getByTestId('m22a-run-button').click();
          const statusLoc = page.getByTestId('m22a-status');
          await expect(statusLoc).toHaveAttribute('data-status', 'running', {
            timeout: 15_000,
          });
          const progressLoc = page.getByTestId('m22a-progress');
          await expect(progressLoc).toContainText(/separating \((?:0|1)\/2/, {
            timeout: 120_000,
          });
          await page.waitForTimeout(250);
          const cancelledDuringPhase =
            (await progressLoc.textContent()) ?? 'unknown';
          expect(cancelledDuringPhase).toMatch(/^separating \((?:0|1)\/2/);

          const cancelStart = Date.now();
          await page.getByTestId('m22a-cancel-button').click();
          await expect(statusLoc).toHaveAttribute('data-status', 'cancelled', {
            timeout: 5_000,
          });
          await expect(statusLoc).toHaveAttribute('data-cleaning-up', 'false', {
            timeout: 5_000,
          });
          const cancelLatencyMs = Date.now() - cancelStart;
          const cancelledFinalStatus =
            (await statusLoc.getAttribute('data-status')) ?? 'unknown';
          const cancelledCleaningUp =
            (await statusLoc.getAttribute('data-cleaning-up')) ?? 'unknown';

          // Ensure a subsequent run can start and complete after Worker termination
          await page.getByTestId('m22b-warm-session-toggle').uncheck();
          const recoveryRun = await runHarnessAndCapture(
            page,
            'worker-post-cancel-recovery',
            'Web Worker fresh respawn and separation after mid-run cancellation'
          );
          expect(recoveryRun.status).toBe('completed');
          expect(recoveryRun.consoleErrors).toEqual([]);
          expect(recoveryRun.pageErrors).toEqual([]);
          expect(cancelConsoleErrors).toEqual([]);
          expect(cancelPageErrors).toEqual([]);

          workerCancellation = {
            cancelLatencyMs,
            cancelledDuringPhase,
            finalStatus: cancelledFinalStatus,
            cleaningUp: cancelledCleaningUp,
            postCancelResumedStatus: recoveryRun.status,
            consoleErrors: cancelConsoleErrors,
            pageErrors: cancelPageErrors,
          };
        } finally {
          page.off('console', onCancelConsole);
          page.off('pageerror', onCancelPageError);
        }

        nonCoiResults = {
          browserEnv: {
            userAgent: browserEnv.userAgent,
            hardwareConcurrency: browserEnv.hardwareConcurrency,
            crossOriginIsolated: browserEnv.crossOriginIsolated,
            hasWebGpu: browserEnv.hasWebGpu,
          },
          workerWasm1ThreadCold: coldRun,
          workerWasm1ThreadCachedBytes: cachedBytesRun,
          workerWasm1ThreadWarmSession: warmSessionRun,
          workerWebGpuOnlyProbe: webGpuOnlyRun,
          workerWebGpuWithWasmFallback: webGpuFallbackRun,
          workerCancellation,
          sixStemMixer: mixerCapture,
        };
      }
    );
  });

  test('evaluates COI WASM multithread in Worker and writes comparative benchmark report', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    expect(nonCoiResults).not.toBeNull();

    const coiRun = await withHarnessViteServer(
      {
        crossOriginIsolated: true,
        modelPath,
        mixWavBytes,
      },
      async (coiHarnessUrl) => {
        await page.goto(coiHarnessUrl, { waitUntil: 'networkidle' });
        await expect(page.getByTestId('m22a-benchmark-harness')).toBeVisible();
        const isCoi = await page.evaluate(() => window.crossOriginIsolated);
        expect(isCoi).toBe(true);

        return runHarnessAndCapture(
          page,
          'worker-wasm-multithread-coi',
          'Web Worker WASM SIMD multithread evaluation under isolated COOP/COEP Vite server'
        );
      }
    );

    // Assert COI multithread run succeeded cleanly BEFORE persisting evidence
    expect(coiRun.crossOriginIsolated).toBe(true);
    expect(coiRun.status).toBe('completed');
    expect(coiRun.consoleErrors).toEqual([]);
    expect(coiRun.pageErrors).toEqual([]);
    expect(coiRun.failedAssetUrls).toEqual([]);
    expect(coiRun.report).not.toBeNull();
    expect(coiRun.report!.telemetry.crossOriginIsolated).toBe(true);
    expect(coiRun.report!.telemetry.wasmNumThreads).toBeGreaterThanOrEqual(2);
    expect(coiRun.report!.stems).toHaveLength(6);

    if (process.env.LOUVAIO_UPDATE_M22B_EVIDENCE === '1') {
      let m22aBaseline: {
        telemetry?: { executionContext?: string };
      } | null = null;
      if (existsSync(M22A_EVIDENCE_PATH)) {
        const parsedBaseline = JSON.parse(
          await fs.readFile(M22A_EVIDENCE_PATH, 'utf8')
        ) as { telemetry?: { executionContext?: string } };
        if (parsedBaseline.telemetry?.executionContext === 'web_worker') {
          throw new Error(
            'M22-A baseline report was recorded in web_worker instead of main_thread.'
          );
        }
        m22aBaseline = parsedBaseline;
      }

      const webGpuOnlyProbe = nonCoiResults!.workerWebGpuOnlyProbe;
      const webGpuInferenceComparisonStatus =
        webGpuOnlyProbe.status === 'completed'
          ? 'verified'
          : 'Unknown / Not yet verified';

      const payload = {
        recordedAt: new Date().toISOString(),
        modelFileName: 'htdemucs_6s_fp16weights.onnx',
        measuredModelBytes,
        measuredModelSha256,
        inputAudioSha256,
        audioDurationSeconds: 8.5,
        totalFrames: expectedFrames,
        m22aMainThreadBaseline: m22aBaseline,
        nonCoiEnvironment: nonCoiResults!.browserEnv,
        workerWasmSingleThreadCold: nonCoiResults!.workerWasm1ThreadCold,
        workerWasmSingleThreadCachedBytes:
          nonCoiResults!.workerWasm1ThreadCachedBytes,
        workerWasmSingleThreadWarmSession:
          nonCoiResults!.workerWasm1ThreadWarmSession,
        workerWasmMultiThreadCoi: coiRun,
        workerWebGpuOnlyProbe: webGpuOnlyProbe,
        workerWebGpuWithWasmFallback:
          nonCoiResults!.workerWebGpuWithWasmFallback,
        webGpuInferenceComparisonStatus,
        webGpuInferenceComparisonReason:
          webGpuOnlyProbe.status === 'completed'
            ? 'WebGPU adapter initialized and executed inference.'
            : webGpuOnlyProbe.errorMessage ??
              'WebGPU adapter or kernel execution unavailable in tested browser environment.',
        workerCancellationVerification: nonCoiResults!.workerCancellation,
        sixStemMixerVerification: nonCoiResults!.sixStemMixer,
        coopCoepImpactAssessment: {
          globalCoopCoepEnabledInProduct: false,
          rationale: [
            'Enabling global Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp in Vite/Firebase Hosting breaks OAuth popups (window.opener isolation) and external third-party scripts/styles lacking CORP headers (Meta WhatsApp SDK connect.facebook.net in web/src/components/whatsapp/meta-sdk.ts, Google Fonts in web/index.html and web/src/index.css, and future R2 asset cross-origin integrations without explicit CORP).',
            'Production default keeps crossOriginIsolated = false, running ONNX Runtime Web in a dedicated module Web Worker with WASM SIMD single-thread, automatic WebGPU fallback to WASM, verified in-memory model bytes cache, and optional warm session reuse for responsive UI without blocking interaction.',
          ],
        },
        selectedProductionExecutionPath: {
          executionContext: 'web_worker',
          preferredProviders: ['wasm'],
          fallbackStrategy:
            'Automatic chunk-0 fallback from WebGPU to WASM when WebGPU is explicitly requested or enabled in Auto mode; WASM SIMD single-thread default under non-COI.',
          graphOptimizationLevel: 'disabled',
          modelCacheRecommendation:
            'Reuse verified in-memory bytes and/or persistent Worker warm session within a single session, always calling dispose/clearCache on teardown.',
        },
      };

      await fs.mkdir(path.dirname(M22B_EVIDENCE_PATH), { recursive: true });
      await fs.writeFile(
        M22B_EVIDENCE_PATH,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8'
      );
    }
  });
});
