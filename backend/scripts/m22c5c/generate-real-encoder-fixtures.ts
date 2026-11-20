// Dev-only generator (needs a system ffmpeg with libmp3lame). Writes
//   shared/fixtures/ministry-audio-mp3-v1/real-encoder-cases.json
// a few KB of real encoder output (valid and deliberately invalid) so the default backend unit suite never needs ffmpeg.
//   npx tsx scripts/m22c5c/generate-real-encoder-fixtures.ts
// Every case is checked against the validator BEFORE it is written; any disagreement aborts without writing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Mp3StemStreamValidator, Mp3ValidationError, type Mp3StemManifest } from '../../src/features/ministry_audio/mp3-stream-validator';

const DECODER_DELAY = 529; // policy value observed with the Web reader's calibration; recorded in the file, not in the validator
const SHARED = resolve(__dirname, '../../../shared/fixtures/ministry-audio-mp3-v1');
const probesPath = join(SHARED, 'probes.json');
if (!existsSync(probesPath)) throw new Error(`Missing ${probesPath}: run web/scripts/generate-mp3-calibration-probes.mjs first.`);
const probes = JSON.parse(readFileSync(probesPath, 'utf8'));
const reference = (sr: 44100 | 48000): Mp3StemManifest => {
  const p = probes.probes[String(sr)];
  return { id: 'vocals', codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256, frames: p.frames, durationSeconds: p.frames / sr,
    sizeBytes: Buffer.from(p.base64, 'base64').length, sha256: p.sha256, alignment: p.alignment } as Mp3StemManifest;
};

const dir = mkdtempSync(join(tmpdir(), 'mp3fx-'));
function encode(sr: number, n: number, seed: number, extra: string[] = [], rate = '256k', channels = 2): Buffer {
  const raw = Buffer.alloc(n * 8);
  let s = seed >>> 0;
  for (let i = 0; i < n * 2; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; raw.writeFloatLE(0.2 * (s / 2147483648 - 1), i * 4); }
  const input = join(dir, 'in.f32'); writeFileSync(input, raw);
  const out = join(dir, 'out.mp3');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(sr), '-ac', '2', '-i', input, '-ac', String(channels),
    '-c:a', 'libmp3lame', '-b:a', rate, ...extra, out], { stdio: 'pipe' });
  return readFileSync(out);
}
const GOOD = ['-id3v2_version', '0', '-write_xing', '1'];

function manifestFromTag(bytes: Buffer, sr: 44100 | 48000): Mp3StemManifest {
  const len = Math.floor((144 * 256000) / sr);
  let p = 0, n = 0;
  while (p < bytes.length) { p += len + ((bytes[p + 2] >> 1) & 1); n++; }
  const M = n - 1, delay = (bytes[156 + 21] << 4) | (bytes[156 + 22] >> 4), pad = ((bytes[156 + 22] & 15) << 8) | bytes[156 + 23];
  const frames = M * 1152 - delay - pad;
  return { id: 'vocals', codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256, frames, durationSeconds: frames / sr,
    sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    alignment: { encoderDelayFrames: delay + DECODER_DELAY, paddingFrames: pad - DECODER_DELAY, mpegAudioFrames: M, infoFrame: true } } as Mp3StemManifest;
}

interface Case { name: string; bytes: Buffer; manifest: Mp3StemManifest; expect: { ok: true } | { code: string } }
const cases: Case[] = [];
for (const [sr, n] of [[44100, 1153], [44100, 12000], [48000, 3000], [48000, 1152]] as const) {
  const bytes = encode(sr, n, 5, GOOD);
  cases.push({ name: `valid-${sr}-${n}`, bytes, manifest: manifestFromTag(bytes, sr), expect: { ok: true } });
}
const ref44 = reference(44100);
const invalid: Array<[string, Buffer, string]> = [
  ['default-id3v2-header', encode(44100, 6000, 5, ['-write_xing', '1']), 'ID3'],
  ['no-info-frame', encode(44100, 6000, 5, ['-id3v2_version', '0', '-write_xing', '0']), 'BAD_INFO_FRAME'],
  ['cbr-128kbps', encode(44100, 6000, 5, GOOD, '128k'), 'BAD_HEADER'],
  ['cbr-320kbps', encode(44100, 6000, 5, GOOD, '320k'), 'BAD_HEADER'],
  ['mono', encode(44100, 6000, 5, GOOD, '256k', 1), 'UNSUPPORTED_STREAM'],
  ['sample-rate-32000', encode(32000, 6000, 5, GOOD), 'BAD_HEADER'],
  ['sample-rate-48000-for-44100-descriptor', encode(48000, 6000, 5, GOOD), 'BAD_HEADER'],
];
for (const [name, bytes, code] of invalid) cases.push({ name, bytes, manifest: ref44, expect: { code } });

function check(c: Case): void {
  let outcome: string;
  try {
    const v = new Mp3StemStreamValidator(c.manifest, { expectedDecoderDelayFrames: DECODER_DELAY });
    for (let i = 0; i < c.bytes.length; i += 977) v.write(c.bytes.subarray(i, i + 977));
    v.finish(); outcome = 'ok';
  } catch (e) { outcome = e instanceof Mp3ValidationError ? e.code : `OTHER:${String(e)}`; }
  const expected = 'ok' in c.expect ? 'ok' : c.expect.code;
  if (outcome !== expected) throw new Error(`Fixture ${c.name}: expected ${expected}, validator says ${outcome}. Nothing written.`);
}
try {
  cases.forEach(check);
  const ffmpegVersion = execFileSync('ffmpeg', ['-version']).toString().split('\n')[0];
  const doc = {
    format: 'louvaio.ministry-audio-mp3-real-encoder-cases', version: 1, decoderDelayPolicyFrames: DECODER_DELAY,
    note: `Generated by backend/scripts/m22c5c/generate-real-encoder-fixtures.ts with ${ffmpegVersion}. Invalid cases are validated against the declared reference manifest of the 44.1 kHz probe.`,
    cases: cases.map((c) => ({ name: c.name, expect: c.expect, manifest: c.manifest, sha256: createHash('sha256').update(c.bytes).digest('hex'), base64: c.bytes.toString('base64') })),
  };
  writeFileSync(join(SHARED, 'real-encoder-cases.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log(`wrote ${cases.length} cases, ${(JSON.stringify(doc).length / 1024).toFixed(1)} KiB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
