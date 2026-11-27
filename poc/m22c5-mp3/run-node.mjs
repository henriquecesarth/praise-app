// Node PoC: encode six synthetic stems to MP3 256 kbps, decode with ffmpeg (reference decoder),
// measure size, lead delay, padding and drift. Writes only inside the PoC out/ directory.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Mp3Encoder } from '@breezystack/lamejs';
import { STEM_IDS, SAMPLE_RATE, makeStem, toInt16, pcm16WavBytes, alignmentReport } from './src/synth.mjs';

const SECONDS = Number(process.env.POC_SECONDS ?? 30);
const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const outPath = (n) => new URL(n, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function lameEncode(stem, kbps) {
  const enc = new Mp3Encoder(2, stem.sampleRate, kbps);
  const l = toInt16(stem.left), r = toInt16(stem.right);
  const chunks = [];
  for (let i = 0; i < l.length; i += 1152 * 8) {
    const c = enc.encodeBuffer(l.subarray(i, i + 1152 * 8), r.subarray(i, i + 1152 * 8));
    if (c.length) chunks.push(Uint8Array.from(c));
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(Uint8Array.from(tail));
  return Buffer.concat(chunks);
}

function ffmpegEncode(stem, kbps, name) {
  const wav = outPath(`${name}.wav`);
  writeFileSync(wav, pcm16WavBytes(stem));
  const mp3 = outPath(`${name}.ffmpeg.mp3`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', '-id3v2_version', '0', mp3], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return mp3;
}

function ffmpegDecode(mp3Path, extra = []) {
  const r = spawnSync('ffmpeg', ['-v', 'error', ...extra, '-i', mp3Path, '-f', 'f32le', '-ac', '2', '-ar', String(SAMPLE_RATE), '-'],
    { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const frames = f.length / 2;
  const left = new Float32Array(frames);
  for (let i = 0; i < frames; i++) left[i] = f[i * 2];
  return left;
}

const report = { seconds: SECONDS, sampleRate: SAMPLE_RATE, kbps: 256, runs: [] };
for (const [idx, id] of STEM_IDS.entries()) {
  const stem = makeStem(idx, SECONDS);
  const wavBytes = pcm16WavBytes(stem).byteLength;

  const t0 = performance.now();
  const mp3 = lameEncode(stem, 256);
  const encodeMs = performance.now() - t0;
  const lamePath = outPath(`${id}.lamejs.mp3`);
  writeFileSync(lamePath, mp3);
  const lameAlign = alignmentReport(stem, ffmpegDecode(lamePath));

  const ffPath = ffmpegEncode(stem, 256, id);
  const ffAlign = alignmentReport(stem, ffmpegDecode(ffPath));

  report.runs.push({
    id, wavBytes,
    lamejs: { bytes: mp3.length, ratioVsWav: +(mp3.length / wavBytes).toFixed(4), encodeMs: Math.round(encodeMs), align: lameAlign },
    ffmpegLame: { bytes: (await import('node:fs')).statSync(ffPath).size, align: ffAlign },
  });
  console.log(id, 'lamejs lag', lameAlign.initialLagFrames, 'drift', lameAlign.driftFrames, 'frameDelta', lameAlign.frameDelta,
    '| ffmpeg-lame lag', ffAlign.initialLagFrames, 'drift', ffAlign.driftFrames, 'frameDelta', ffAlign.frameDelta);
}
writeFileSync(outPath('node-report.json'), JSON.stringify(report, null, 2));
console.log('report written to out/node-report.json');
