// Independent PoC (new, NOT the historical M22-C.5 PoC). Deterministic stereo test signal + ffmpeg/libmp3lame encode.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
export function makeSignal(n, seed) {
  const L = new Float32Array(n), R = new Float32Array(n);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; };
  for (let i = 0; i < n; i++) { L[i] = 0.2 * rnd(); R[i] = 0.2 * rnd(); }
  return { L, R, clicksL: [0, 1000, n - 1], clicksR: [7, Math.floor(n / 2), n - 2] };
}
export function withClicks(sig) {
  for (const p of sig.clicksL) sig.L[p] = 0.95;
  for (const p of sig.clicksR) sig.R[p] = -0.95;
  return sig;
}
if (process.argv[1].endsWith('gen.mjs')) {
  for (const [sr, n] of [[44100, 220500], [48000, 240000]]) {
    const sig = withClicks(makeSignal(n, 12345));
    const raw = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { raw[2 * i] = sig.L[i]; raw[2 * i + 1] = sig.R[i]; }
    writeFileSync(`sig${sr}.f32`, Buffer.from(raw.buffer));
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(sr), '-ac', '2', '-i', `sig${sr}.f32`,
      '-c:a', 'libmp3lame', '-b:a', '256k', '-id3v2_version', '0', '-write_xing', '1', `sig${sr}.mp3`]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(sr), '-ac', '2', '-i', `sig${sr}.f32`,
      '-c:a', 'libmp3lame', '-b:a', '256k', '-id3v2_version', '0', '-write_xing', '0', `sig${sr}.noinfo.mp3`]);
    console.log('encoded', sr, n);
  }
}
