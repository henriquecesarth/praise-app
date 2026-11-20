// EXPLICIT, SEPARATE flow (not part of `npm run test:unit`): exercises the validator on FRESH ffmpeg/libmp3lame output
// across lengths and rates, and re-verifies the committed shared fixtures. Fails hard (non-zero exit) when ffmpeg or any
// fixture file is missing or divergent. Run from backend/:  npx tsx scripts/m22c5c/ffmpeg-real-encoder-check.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Mp3StemStreamValidator, Mp3ValidationError, type Mp3StemManifest } from '../../src/features/ministry_audio/mp3-stream-validator';

const POLICY_DECODER_DELAY = 529;
const SHARED = resolve(__dirname, '../../../shared/fixtures/ministry-audio-mp3-v1');

function outcome(bytes: Uint8Array, manifest: Mp3StemManifest, chunk: number): string {
  try {
    const v = new Mp3StemStreamValidator(manifest, { expectedDecoderDelayFrames: POLICY_DECODER_DELAY });
    for (let i = 0; i < bytes.length; i += chunk) v.write(bytes.subarray(i, i + chunk));
    v.finish();
    return 'ok';
  } catch (e) { return e instanceof Mp3ValidationError ? e.code : `OTHER:${String(e)}`; }
}

// 1) committed fixtures must still behave exactly as recorded
const real = JSON.parse(readFileSync(join(SHARED, 'real-encoder-cases.json'), 'utf8'));
const probes = JSON.parse(readFileSync(join(SHARED, 'probes.json'), 'utf8'));
assert.equal(real.format, 'louvaio.ministry-audio-mp3-real-encoder-cases');
assert.equal(probes.format, 'louvaio.ministry-audio-mp3-probes');
for (const c of real.cases) {
  const bytes = Buffer.from(c.base64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256, `fixture ${c.name}: sha256 diverges`);
  assert.equal(outcome(bytes, c.manifest, 4096), 'ok' in c.expect ? 'ok' : c.expect.code, `fixture ${c.name}`);
}
console.log(`fixtures: ${real.cases.length} real-encoder cases + ${Object.keys(probes.probes).length} probes OK`);

// 2) fresh ffmpeg output
const dir = mkdtempSync(join(tmpdir(), 'mp3chk-'));
try {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); } catch { throw new Error('ffmpeg with libmp3lame is required for this check and was not found on PATH.'); }
  const encode = (sr: number, n: number, extra: string[], rate = '256k', channels = 2): Buffer => {
    const raw = Buffer.alloc(n * 8);
    let s = 9;
    for (let i = 0; i < n * 2; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; raw.writeFloatLE(0.2 * (s / 2147483648 - 1), i * 4); }
    writeFileSync(join(dir, 'in.f32'), raw);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(sr), '-ac', '2', '-i', join(dir, 'in.f32'), '-ac', String(channels), '-c:a', 'libmp3lame', '-b:a', rate, ...extra, join(dir, 'o.mp3')]);
    return readFileSync(join(dir, 'o.mp3'));
  };
  const good = ['-id3v2_version', '0', '-write_xing', '1'];
  const manifestFor = (bytes: Buffer, sr: 44100 | 48000): Mp3StemManifest => {
    const len = Math.floor((144 * 256000) / sr);
    let p = 0, n = 0;
    while (p < bytes.length) { p += len + ((bytes[p + 2] >> 1) & 1); n++; }
    const M = n - 1, d = (bytes[177] << 4) | (bytes[178] >> 4), pad = ((bytes[178] & 15) << 8) | bytes[179], frames = M * 1152 - d - pad;
    return { id: 'vocals', codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256, frames, durationSeconds: frames / sr, sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      alignment: { encoderDelayFrames: d + POLICY_DECODER_DELAY, paddingFrames: pad - POLICY_DECODER_DELAY, mpegAudioFrames: M, infoFrame: true } } as Mp3StemManifest;
  };
  for (const [sr, n] of [[44100, 1], [44100, 1152], [44100, 1153], [44100, 44100], [44100, 220500], [44100, 44100 * 60], [48000, 5000], [48000, 240000], [48000, 48000 * 60]] as const) {
    const bytes = encode(sr, n, good);
    const m = manifestFor(bytes, sr);
    for (const chunk of n <= 5000 ? [1, 4096, 65536] : [4096, 65536]) assert.equal(outcome(bytes, m, chunk), 'ok', `${sr}Hz/${n}/chunk ${chunk}`);
    console.log(`valid ${sr} Hz ${n} frames: ok (${bytes.length} bytes, ${m.alignment.mpegAudioFrames} MPEG frames)`);
  }
  const ref = manifestFor(encode(44100, 44100, good), 44100);
  for (const [name, bytes, code] of [
    ['default ID3v2', encode(44100, 44100, ['-write_xing', '1']), 'ID3'],
    ['no Info frame', encode(44100, 44100, ['-id3v2_version', '0', '-write_xing', '0']), 'BAD_INFO_FRAME'],
    ['128 kbps', encode(44100, 44100, good, '128k'), 'BAD_HEADER'],
    ['mono', encode(44100, 44100, good, '256k', 1), 'UNSUPPORTED_STREAM'],
  ] as const) assert.equal(outcome(bytes, ref, 4096), code, name);
  console.log('invalid encodes rejected with the expected reasons');
  console.log('ALL OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
