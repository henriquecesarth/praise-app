// Manual benchmark (not part of the suite). Usage from backend/:
//   npx tsx --expose-gc scripts/m22c5c/bench.ts <44100|48000> <file.mp3> [<44100|48000> <file.mp3> ...]
// Exits non-zero when an argument or file is missing, or when the validator rejects the file.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { Mp3StemStreamValidator, type Mp3StemManifest } from '../../src/features/ministry_audio/mp3-stream-validator';

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) { console.error('usage: bench.ts <44100|48000> <file.mp3> [...]'); process.exit(1); }
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) { console.error('run with --expose-gc (npx tsx --expose-gc ...)'); process.exit(1); }

function manifestFor(bytes: Buffer, sr: 44100 | 48000): Mp3StemManifest {
  const len = Math.floor((144 * 256000) / sr);
  let p = 0, n = 0;
  while (p < bytes.length) { p += len + ((bytes[p + 2] >> 1) & 1); n++; }
  const M = n - 1, d = (bytes[177] << 4) | (bytes[178] >> 4), pad = ((bytes[178] & 15) << 8) | bytes[179], frames = M * 1152 - d - pad;
  return { id: 'vocals', codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256, frames, durationSeconds: frames / sr, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    alignment: { encoderDelayFrames: d + 529, paddingFrames: pad - 529, mpegAudioFrames: M, infoFrame: true } } as Mp3StemManifest;
}

for (let a = 0; a < args.length; a += 2) {
  const sr = Number(args[a]), file = args[a + 1];
  if ((sr !== 44100 && sr !== 48000) || !existsSync(file)) { console.error(`bad argument or missing file: ${args[a]} ${file}`); process.exit(1); }
  const manifest = manifestFor(readFileSync(file), sr);
  for (const chunk of [65536, 1024, 16]) {
    gc(); const base = process.memoryUsage();
    const fd = openSync(file, 'r'); const buf = Buffer.alloc(chunk);
    let peakHeap = 0, peakRss = 0, k = 0, n: number;
    const t = performance.now();
    const v = new Mp3StemStreamValidator(manifest);
    while ((n = readSync(fd, buf, 0, chunk, null)) > 0) {
      v.write(buf.subarray(0, n));
      if ((k++ & 255) === 0) { const u = process.memoryUsage(); peakHeap = Math.max(peakHeap, u.heapUsed); peakRss = Math.max(peakRss, u.rss); }
    }
    const r = v.finish(); closeSync(fd);
    const ms = performance.now() - t;
    console.log(JSON.stringify({ file, sizeMB: +(manifest.sizeBytes / 1048576).toFixed(2), chunk, frames: r.mpegAudioFrames, ms: +ms.toFixed(0),
      MBps: +(manifest.sizeBytes / 1048576 / (ms / 1000)).toFixed(0), heapGrowthMB: +((peakHeap - base.heapUsed) / 1048576).toFixed(2),
      rssGrowthMB: +((peakRss - base.rss) / 1048576).toFixed(2), peakBufferedBytes: r.peakBufferedBytes }));
  }
}
