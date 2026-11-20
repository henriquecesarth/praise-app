// Structural parity between the backend validator and the Web experimental reader (web/src/audio/mp3-stem-decoder.ts
// inspectMp3Stream) over the committed shared fixtures plus byte mutations. Exits non-zero when a fixture is missing or
// divergent, or when the server ever ACCEPTS something the Web reader rejects (the server must be at least as strict).
// Run from backend/:  npx tsx scripts/m22c5c/web-parity.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Mp3StemStreamValidator, type Mp3StemManifest } from '../../src/features/ministry_audio/mp3-stream-validator';
import { inspectMp3Stream } from '../../../web/src/audio/mp3-stem-decoder';

const SHARED = resolve(__dirname, '../../../shared/fixtures/ministry-audio-mp3-v1');
for (const f of ['probes.json', 'real-encoder-cases.json']) if (!existsSync(join(SHARED, f))) { console.error(`MISSING FIXTURE ${f}`); process.exit(1); }
const real = JSON.parse(readFileSync(join(SHARED, 'real-encoder-cases.json'), 'utf8'));
const probes = JSON.parse(readFileSync(join(SHARED, 'probes.json'), 'utf8'));
if (probes.format !== 'louvaio.ministry-audio-mp3-probes' || probes.version !== 1 || !probes.probes?.['44100'] || !probes.probes?.['48000']) { console.error('probes.json diverges from the expected envelope'); process.exit(1); }
// the probes are valid streams too: both sides must agree on them
for (const [sr, p] of Object.entries<any>(probes.probes)) {
  const b = Buffer.from(p.base64, 'base64');
  if (createHash('sha256').update(b).digest('hex') !== p.sha256) { console.error(`probe ${sr}: sha256 diverges`); process.exit(1); }
  try { inspectMp3Stream(new Uint8Array(b), Number(sr)); } catch { console.error(`probe ${sr}: Web reader rejects it`); process.exit(1); }
  try { const v = new Mp3StemStreamValidator({ id: 'vocals', codec: 'mp3_cbr256', sampleRate: Number(sr), channels: 2, bitrateKbps: 256, frames: p.frames, durationSeconds: p.frames / Number(sr), sizeBytes: b.length, sha256: p.sha256, alignment: p.alignment } as Mp3StemManifest); v.write(b); v.finish(); } catch (e: any) { console.error(`probe ${sr}: server rejects it (${e.code ?? e})`); process.exit(1); }
}
const valid = real.cases.filter((c: any) => 'ok' in c.expect);
if (valid.length < 4) { console.error('fixture set diverges: fewer than 4 valid real-encoder cases'); process.exit(1); }

const stats = { cases: 0, bothAccept: 0, bothReject: 0, webAcceptsServerRejects: 0, serverAcceptsWebRejects: 0, reasons: {} as Record<string, number>, offenders: [] as string[] };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
for (const c of valid) {
  const orig = Buffer.from(c.base64, 'base64');
  const m = c.manifest as Mp3StemManifest;
  const tests: Array<[string, Buffer, Mp3StemManifest]> = [['original', orig, m]];
  const step = Math.max(1, Math.floor(orig.length / 300));
  for (let i = 0; i < orig.length; i += step) for (const bit of [0x01, 0x80]) { const f = Buffer.from(orig); f[i] ^= bit; tests.push([`flip@${i}/${bit}`, f, { ...m, sha256: sha(f) } as Mp3StemManifest]); }
  for (const cut of [1, 2, 3, 4, 10, 835]) { const f = orig.subarray(0, orig.length - cut); tests.push([`truncate-${cut}`, Buffer.from(f), { ...m, sha256: sha(f) } as Mp3StemManifest]); }
  for (const extra of [1, 4, 100]) { const f = Buffer.concat([orig, Buffer.alloc(extra, 0xff)]); tests.push([`append-${extra}`, f, { ...m, sha256: sha(f) } as Mp3StemManifest]); }
  for (const [name, bytes, man] of tests) {
    stats.cases++;
    let server = true, web = true, why = '';
    try { const v = new Mp3StemStreamValidator(man); for (let i = 0; i < bytes.length; i += 4096) v.write(bytes.subarray(i, i + 4096)); v.finish(); } catch (e: any) { server = false; why = e.code ?? String(e); }
    try { inspectMp3Stream(new Uint8Array(bytes), m.sampleRate); } catch { web = false; }
    if (server && web) stats.bothAccept++;
    else if (!server && !web) stats.bothReject++;
    else if (web && !server) { stats.webAcceptsServerRejects++; stats.reasons[why] = (stats.reasons[why] ?? 0) + 1; }
    else { stats.serverAcceptsWebRejects++; stats.offenders.push(`${c.name}:${name}`); }
  }
}
console.log(JSON.stringify(stats, null, 1));
if (stats.serverAcceptsWebRejects > 0 || stats.bothAccept !== valid.length) { console.error('PARITY FAILED'); process.exit(1); }
console.log('PARITY OK: server never accepts what the Web reader rejects');
