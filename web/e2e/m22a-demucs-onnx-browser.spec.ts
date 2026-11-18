import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { expect, test } from '@playwright/test';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import {
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  decodeWavToStereoFloat32,
  encodeStereoPcm16Wav,
  type CanonicalStemId,
} from '../src/audio/separation/demucs-onnx-separator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(WEB_DIR, '..');
const EVIDENCE_PATH = path.join(
  REPO_DIR,
  'docs',
  'exec-plans',
  'evidence',
  'm22-a',
  'browser-benchmark-report.json'
);
const SAMPLE_OUTPUT_DIR = path.join(
  WEB_DIR,
  'test-results',
  'm22a-audio-samples'
);

const DEFAULT_MODEL_PATH = path.join(
  os.homedir(),
  '.cache',
  'louvaio-models',
  'htdemucs_6s_fp16weights.onnx'
);

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
  const durationSeconds = 8.5; // > 7.8s segment so real multi-chunk overlap-add is exercised
  const totalFrames = Math.round(sampleRate * durationSeconds);
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);

  // Layer 1: Real CC0 upright piano recordings from web/public/audio/upright-kw/
  const pianoNotes = ['midi-060.wav', 'midi-063.wav', 'midi-069.wav', 'midi-047.wav'];
  const decodedNotes = await Promise.all(
    pianoNotes.map(async (fileName) => {
      const wavPath = path.join(WEB_DIR, 'public', 'audio', 'upright-kw', fileName);
      const raw = await fs.readFile(wavPath);
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
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
    const maxCopy = Math.min(src.totalFrames, totalFrames - startFrame, Math.floor(2.2 * sampleRate));
    for (let i = 0; i < maxCopy; i++) {
      const fadeOut = i > maxCopy - 2205 ? (maxCopy - i) / 2205 : 1;
      left[startFrame + i] += src.left[i] * placement.gainL * fadeOut;
      right[startFrame + i] += src.right[i] * placement.gainR * fadeOut;
    }
  }

  // Layer 2: Bass line, drum kick/snare transients, guitar strums, and vocal melody
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
        ? Math.sin(2 * Math.PI * (120 * Math.exp(-beatPhase * 22) + 42) * beatPhase) *
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

    const guitarGate = (t % 0.75) < 0.55 ? Math.exp(-((t % 0.75) * 4.5)) : 0;
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

    left[i] = Math.max(-0.98, Math.min(0.98, left[i] + bass + kick + snare + guitar * 1.1 + vocal));
    right[i] = Math.max(-0.98, Math.min(0.98, right[i] + bass + kick + snare + guitar * 0.9 + vocal));
  }

  const wavBytes = encodeStereoPcm16Wav({ sampleRate, left, right });
  return { wavBytes, totalFrames, sampleRate, durationSeconds };
}

function sha256HexNode(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface StemAcousticMetrics {
  id: string;
  rms: number;
  peak: number;
  crestFactor: number;
  zeroCrossingRateHz: number;
  lowEnergyRatio: number;
  midEnergyRatio: number;
  highEnergyRatio: number;
}

interface PairwiseStemDiff {
  stemA: string;
  stemB: string;
  rmsDiff: number;
  maxAbsDiff: number;
  cosineSimilarity: number;
  absCosineSimilarity: number;
}

function computeStemAcousticMetrics(
  id: string,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): StemAcousticMetrics {
  const n = left.length;
  let sumSq = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let prevMono = (left[0] + right[0]) * 0.5;

  const dt = 1 / sampleRate;
  const rcLow = 1 / (2 * Math.PI * 250);
  const rcMid = 1 / (2 * Math.PI * 2500);
  const alphaLow = dt / (rcLow + dt);
  const alphaMid = dt / (rcMid + dt);
  let lpLow = 0;
  let lpMid = 0;
  let lowSq = 0;
  let midSq = 0;
  let highSq = 0;

  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    sumSq += l * l + r * r;
    const absMax = Math.max(Math.abs(l), Math.abs(r));
    if (absMax > peak) peak = absMax;

    const mono = (l + r) * 0.5;
    if (i > 0 && ((prevMono >= 0 && mono < 0) || (prevMono < 0 && mono >= 0))) {
      zeroCrossings += 1;
    }
    prevMono = mono;

    lpLow += alphaLow * (mono - lpLow);
    lpMid += alphaMid * (mono - lpMid);
    const low = lpLow;
    const mid = lpMid - lpLow;
    const high = mono - lpMid;
    lowSq += low * low;
    midSq += mid * mid;
    highSq += high * high;
  }

  const rms = Math.sqrt(sumSq / (n * 2));
  const crestFactor = rms > 0 ? peak / rms : 0;
  const durationSeconds = n / sampleRate;
  const zeroCrossingRateHz = durationSeconds > 0 ? zeroCrossings / durationSeconds : 0;
  const bandTotal = lowSq + midSq + highSq;

  return {
    id,
    rms,
    peak,
    crestFactor,
    zeroCrossingRateHz,
    lowEnergyRatio: bandTotal > 0 ? lowSq / bandTotal : 0,
    midEnergyRatio: bandTotal > 0 ? midSq / bandTotal : 0,
    highEnergyRatio: bandTotal > 0 ? highSq / bandTotal : 0,
  };
}

function computePairwiseStemDiff(
  a: { id: string; left: Float32Array; right: Float32Array },
  b: { id: string; left: Float32Array; right: Float32Array }
): PairwiseStemDiff {
  const n = a.left.length;
  let diffSqSum = 0;
  let maxAbsDiff = 0;
  let dot = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < n; i++) {
    const al = a.left[i];
    const ar = a.right[i];
    const bl = b.left[i];
    const br = b.right[i];
    const dl = al - bl;
    const dr = ar - br;
    diffSqSum += dl * dl + dr * dr;
    const frameAbsMax = Math.max(Math.abs(dl), Math.abs(dr));
    if (frameAbsMax > maxAbsDiff) maxAbsDiff = frameAbsMax;
    dot += al * bl + ar * br;
    normASq += al * al + ar * ar;
    normBSq += bl * bl + br * br;
  }

  const rmsDiff = Math.sqrt(diffSqSum / (n * 2));
  const denom = Math.sqrt(normASq) * Math.sqrt(normBSq);
  const cosineSimilarity = denom > 0 ? dot / denom : 0;

  return {
    stemA: a.id,
    stemB: b.id,
    rmsDiff,
    maxAbsDiff,
    cosineSimilarity,
    absCosineSimilarity: Math.abs(cosineSimilarity),
  };
}

test.describe('M22-A Real Browser Demucs ONNX 6-Stem Inference & Benchmark', () => {
  let viteServer: ViteDevServer | null = null;
  let baseHarnessUrl = '';
  let expectedFrames = 0;
  let mixBytesLength = 0;
  let mixWavBytes: Uint8Array | null = null;

  test.beforeAll(async () => {
    const modelPath = process.env.LOUVAIO_M22A_MODEL_PATH || DEFAULT_MODEL_PATH;
    if (!existsSync(modelPath)) {
      throw new Error(`Real ONNX model missing at ${modelPath}`);
    }

    const mix = await buildRealMultiInstrumentTestWav();
    expectedFrames = mix.totalFrames;
    mixBytesLength = mix.wavBytes.byteLength;
    mixWavBytes = mix.wavBytes;

    const virtualEntryAbs = path
      .join(WEB_DIR, 'src', 'audio', 'separation', '__m22a_virtual_entry__.tsx')
      .replace(/\\/g, '/');

    const harnessPlugin: Plugin = {
      name: 'm22a-harness-server',
      enforce: 'pre',
      resolveId(id) {
        if (id === '/@m22a-harness-entry.tsx' || id.replace(/\\/g, '/') === virtualEntryAbs) {
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
                    initialAudioUrl="/fixtures/m22a-multi-instrument-mix.wav"
                    wasmPaths="/ort/"
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
          const urlPath = (req.url ?? '').split('?')[0];

          if (urlPath === '/m22a-harness.html') {
            const rawHtml = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>M22-A Demucs ONNX Benchmark</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/@m22a-harness-entry.tsx"></script>
  </body>
</html>`;
            const html = await server.transformIndexHtml('/m22a-harness.html', rawHtml);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
            createReadStream(assetPath).pipe(res);
            return;
          }

          if (urlPath === '/models/htdemucs_6s_fp16weights.onnx') {
            const stat = await fs.stat(modelPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', String(stat.size));
            createReadStream(modelPath).pipe(res);
            return;
          }

          if (urlPath === '/fixtures/m22a-multi-instrument-mix.wav') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('Content-Length', String(mix.wavBytes.byteLength));
            res.end(Buffer.from(mix.wavBytes));
            return;
          }

          next();
        });
      },
    };

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
      },
    });
    await viteServer.listen();
    const addr = viteServer.httpServer?.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind M22-A Vite harness server port.');
    }
    baseHarnessUrl = `http://127.0.0.1:${addr.port}/m22a-harness.html`;
  });

  test.afterAll(async () => {
    if (viteServer) {
      await viteServer.close();
      viteServer = null;
    }
  });

  test('executes real htdemucs_6s ONNX 6-stem separation in Chromium and verifies browser blob hashes', async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(baseHarnessUrl, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('m22a-benchmark-harness')).toBeVisible();

    const checksumToggle = page.getByTestId('m22a-verify-checksum');
    await expect(checksumToggle).toBeChecked();
    await expect(checksumToggle).toBeDisabled();

    await page.getByTestId('m22a-run-button').click();

    await expect(page.getByTestId('m22a-status')).toHaveAttribute(
      'data-status',
      'completed',
      { timeout: 240_000 }
    );

    const reportText = await page.getByTestId('m22a-report-json').textContent();
    expect(reportText).toBeTruthy();

    const parsed = JSON.parse(reportText!) as {
      telemetry: {
        modelId: string;
        modelVersion: string;
        executionProvider: string;
        ortVersion: string;
        modelBytes: number | null;
        modelSha256: string | null;
        modelChecksumVerified: boolean;
        sampleRate: number;
        totalFrames: number;
        audioDurationSeconds: number;
        segmentSamples: number;
        overlapSamples: number;
        chunksProcessed: number;
        modelLoadMs: number;
        inferenceMs: number;
        encodeMs: number;
        totalWallMs: number;
        rtf: number;
        jsHeapUsedBytes: number | null;
        jsHeapSnapshotKind: string;
        reconstructionMaxAbsError: number;
        inputSha256: string;
      };
      stems: Array<{
        id: string;
        labelPtBr: string;
        byteLength: number;
        sha256: string;
        rms: number;
        peak: number;
        totalFrames: number;
      }>;
    };

    expect(parsed.telemetry.modelId).toBe(HTDEMUCS_6S_ONNX_DESCRIPTOR.id);
    expect(parsed.telemetry.executionProvider).toBe('wasm');
    expect(parsed.telemetry.ortVersion).toBeTruthy();
    expect(parsed.telemetry.modelChecksumVerified).toBe(true);
    expect(parsed.telemetry.modelBytes).toBe(
      HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelBytes
    );
    expect(parsed.telemetry.modelSha256).toBe(
      HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelSha256
    );
    expect(parsed.telemetry.sampleRate).toBe(44100);
    expect(parsed.telemetry.totalFrames).toBe(expectedFrames);
    expect(parsed.telemetry.chunksProcessed).toBe(2);
    expect(parsed.telemetry.modelLoadMs).toBeGreaterThan(0);
    expect(parsed.telemetry.inferenceMs).toBeGreaterThan(0);
    expect(parsed.telemetry.totalWallMs).toBeGreaterThan(0);
    expect(parsed.telemetry.rtf).toBeGreaterThan(0);
    expect(['point_in_time_post_encode', 'unavailable']).toContain(
      parsed.telemetry.jsHeapSnapshotKind
    );
    expect(Number.isFinite(parsed.telemetry.reconstructionMaxAbsError)).toBe(true);
    expect(parsed.telemetry.reconstructionMaxAbsError).toBeLessThan(0.5);

    expect(parsed.stems.map((s) => s.id)).toEqual([...CANONICAL_STEM_IDS]);
    const stemHashes = new Set<string>();
    const blobDigests: Array<{
      id: string;
      blobBytes: number;
      blobSha256: string;
    }> = [];
    const sampleFiles: Array<{
      role: 'input_mix' | CanonicalStemId;
      fileName: string;
      relativePath: string;
      byteLength: number;
      sha256: string;
    }> = [];

    await fs.mkdir(SAMPLE_OUTPUT_DIR, { recursive: true });
    if (!mixWavBytes) {
      throw new Error('Expected mixWavBytes to be initialized.');
    }
    const inputSampleName = 'input-mix.wav';
    const inputSamplePath = path.join(SAMPLE_OUTPUT_DIR, inputSampleName);
    await fs.writeFile(inputSamplePath, mixWavBytes);
    const inputNodeSha = sha256HexNode(mixWavBytes);
    expect(inputNodeSha).toBe(parsed.telemetry.inputSha256);
    sampleFiles.push({
      role: 'input_mix',
      fileName: inputSampleName,
      relativePath: `web/test-results/m22a-audio-samples/${inputSampleName}`,
      byteLength: mixWavBytes.byteLength,
      sha256: inputNodeSha,
    });

    const decodedStems: Array<{
      id: string;
      left: Float32Array;
      right: Float32Array;
      sampleRate: number;
    }> = [];
    const stemAcousticProfiles: StemAcousticMetrics[] = [];

    for (const stem of parsed.stems) {
      expect(stem.totalFrames).toBe(expectedFrames);
      expect(stem.byteLength).toBe(mixBytesLength);
      expect(stem.rms).toBeGreaterThan(0);
      expect(stem.peak).toBeGreaterThan(0);
      expect(stem.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(stem.sha256).not.toBe(parsed.telemetry.inputSha256);
      stemHashes.add(stem.sha256);

      const card = page.getByTestId(`m22a-stem-card-${stem.id}`);
      await expect(card).toBeVisible();
      const audioSrc = await card.locator('audio').getAttribute('src');
      expect(audioSrc).toMatch(/^blob:/);

      const verifiedBlob = await page.evaluate(async (blobUrl) => {
        const res = await fetch(blobUrl);
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const hex = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return { byteLength: buf.byteLength, sha256: hex, base64: btoa(binary) };
      }, audioSrc!);

      expect(verifiedBlob.byteLength).toBe(stem.byteLength);
      expect(verifiedBlob.sha256).toBe(stem.sha256);
      blobDigests.push({
        id: stem.id,
        blobBytes: verifiedBlob.byteLength,
        blobSha256: verifiedBlob.sha256,
      });

      const wavBuf = Buffer.from(verifiedBlob.base64, 'base64');
      expect(sha256HexNode(wavBuf)).toBe(stem.sha256);
      const sampleFileName = `${stem.id}.wav`;
      await fs.writeFile(path.join(SAMPLE_OUTPUT_DIR, sampleFileName), wavBuf);
      sampleFiles.push({
        role: stem.id as CanonicalStemId,
        fileName: sampleFileName,
        relativePath: `web/test-results/m22a-audio-samples/${sampleFileName}`,
        byteLength: wavBuf.byteLength,
        sha256: stem.sha256,
      });

      const ab = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength);
      const decoded = decodeWavToStereoFloat32(ab, { expectedSampleRate: 44100 });
      expect(decoded.totalFrames).toBe(expectedFrames);
      decodedStems.push({
        id: stem.id,
        left: decoded.left,
        right: decoded.right,
        sampleRate: decoded.sampleRate,
      });
      stemAcousticProfiles.push(
        computeStemAcousticMetrics(stem.id, decoded.left, decoded.right, decoded.sampleRate)
      );
    }
    expect(stemHashes.size).toBe(6);

    const pairwiseDiffs: PairwiseStemDiff[] = [];
    for (let i = 0; i < decodedStems.length; i++) {
      for (let j = i + 1; j < decodedStems.length; j++) {
        const diff = computePairwiseStemDiff(decodedStems[i], decodedStems[j]);
        expect(diff.maxAbsDiff).toBeGreaterThan(0.05);
        expect(diff.rmsDiff).toBeGreaterThan(0.005);
        expect(diff.absCosineSimilarity).toBeLessThan(0.98);
        pairwiseDiffs.push(diff);
      }
    }
    expect(pairwiseDiffs).toHaveLength(15);

    const minPairwiseMaxAbsDiff = Math.min(...pairwiseDiffs.map((p) => p.maxAbsDiff));
    const maxPairwiseCosineSimilarity = Math.max(
      ...pairwiseDiffs.map((p) => p.cosineSimilarity)
    );
    const maxPairwiseAbsCosineSimilarity = Math.max(
      ...pairwiseDiffs.map((p) => p.absCosineSimilarity)
    );

    const browserEnv = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      hasWebGpu: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
    }));

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    const reportPayload = `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        modelFileName: 'htdemucs_6s_fp16weights.onnx',
        measuredModelBytes: parsed.telemetry.modelBytes,
        measuredModelSha256: parsed.telemetry.modelSha256,
        modelSha256Verified: parsed.telemetry.modelChecksumVerified,
        ortVersion: parsed.telemetry.ortVersion,
        browserEnv,
        ...parsed,
        verifiedBrowserBlobDigests: blobDigests,
        sampleFilesDirectory: 'web/test-results/m22a-audio-samples',
        sampleFiles,
        stemDifferenceAudit: {
          pairCount: pairwiseDiffs.length,
          bandEstimationMethod:
            'first_order_time_domain_mono_filter_estimate_250hz_2500hz',
          fixtureNature:
            'cc0_upright_piano_plus_synthesized_layers_without_isolated_reference_stems',
          minPairwiseMaxAbsDiff,
          maxPairwiseCosineSimilarity,
          maxPairwiseAbsCosineSimilarity,
          perStemProfiles: stemAcousticProfiles,
          pairs: pairwiseDiffs,
        },
        auditoryEvaluationNote:
          'Hashes distintos, estimativas de bandas por filtros mono de 1a ordem, RMS/ZCR e cosseno absoluto entre todos os 15 pares comprovam matematicamente 6 sinais nao silenciosos, nao identicos e nao invertidos que somam proximos a mixagem composta (piano CC0 + camadas sintetizadas, sem stems de referencia); a qualidade perceptual musical requer avaliacao auditiva humana nos WAVs em web/test-results/m22a-audio-samples/.',
      },
      null,
      2
    )}\n`;

    const runReportPath = testInfo.outputPath('browser-benchmark-report.json');
    await fs.writeFile(runReportPath, reportPayload, 'utf8');
    await testInfo.attach('browser-benchmark-report', {
      path: runReportPath,
      contentType: 'application/json',
    });

    if (process.env.LOUVAIO_UPDATE_M22A_EVIDENCE === '1') {
      await fs.mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
      await fs.writeFile(EVIDENCE_PATH, reportPayload, 'utf8');
    }
  });
});
