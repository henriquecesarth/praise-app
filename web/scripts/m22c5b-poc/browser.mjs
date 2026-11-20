// New independent PoC (M22-C.5B). Run from web/scripts/m22c5b-poc after: node gen.mjs; node long.mjs; esbuild bundle (see docs).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('../../node_modules/playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ content: readFileSync('bundle.js', 'utf8') });
console.log('browser', browser.version());

const BR=256000;
function descFor(file, sr, n) {
  const b = readFileSync(file);
  const flen = Math.floor(144*BR/sr); let p=0, fr=0, td=0;
  while (p<b.length){ const pad=(b[p+2]>>1)&1; if(fr===0){const lt=p+4+32+120; td=(b[lt+21]<<4)|(b[lt+22]>>4);} p+=flen+pad; fr++; }
  const M = fr-1, d = td+529, pp = M*1152-d-n;
  return { b, desc: { sampleRate: sr, frames: n, sizeBytes: b.length, sha256: createHash('sha256').update(b).digest('hex'), alignment: { encoderDelayFrames: d, paddingFrames: pp, mpegAudioFrames: M, infoFrame: true } } };
}
const cases = [
  ['sig44100.mp3', 44100, 220500, 99, 12345], ['sig48000.mp3', 48000, 240000, 0, 12345],
  ['long44100.mp3', 44100, 44100*300, 0, 99], ['long48000.mp3', 48000, 48000*300, 0, 99],
];
const out = [];
for (const [file, sr, n, , seed] of cases) {
  const { b, desc } = descFor(file, sr, n);
  const r = await page.evaluate(async ({ b64, desc, seed, n }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dec = new Mp3Mod.Mp3StemDecoder();
    const heap0 = performance.memory?.usedJSHeapSize ?? 0;
    const t0 = performance.now();
    const pcm = await dec.decodeStem(bytes, desc);
    const ms = performance.now() - t0;
    const heap1 = performance.memory?.usedJSHeapSize ?? 0;
    // regenerate the signal (same LCG as gen.mjs) and measure sample-exact agreement
    let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; };
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = 0.2 * rnd(); R[i] = 0.2 * rnd(); }
    const clicksL = [0, 1000, n - 1], clicksR = [7, Math.floor(n / 2), n - 2];
    for (const p of clicksL) L[p] = 0.95; for (const p of clicksR) R[p] = -0.95;
    const lagOf = (o, d, start, len) => { let best = -Infinity, bl = 0; for (let l = -4; l <= 4; l++) { let sum = 0; for (let i = start; i < start + len; i++) { const j = i + l; if (j >= 0 && j < d.length) sum += o[i] * d[j]; } if (sum > best) { best = sum; bl = l; } } return bl; };
    const peak = (x, c, sign) => { let bi = -1, bv = 0; for (let i = Math.max(0, c - 30); i < Math.min(x.length, c + 31); i++) { const v = x[i] * sign; if (v > bv) { bv = v; bi = i; } } return bi - c; };
    const res = {
      shape: pcm.shape, trimmed: pcm.trimmedStartFrames, decodedLength: pcm.decodedLength, outLen: pcm.left.length, canonical: n, ms: +ms.toFixed(1),
      heapDeltaMB: +((heap1 - heap0) / 1048576).toFixed(1),
      lag: [lagOf(L, pcm.left, 3000, 8000), lagOf(L, pcm.left, n - 12000, 8000), lagOf(R, pcm.right, 3000, 8000), lagOf(R, pcm.right, n - 12000, 8000)],
      clickOffsets: { L: clicksL.map((c) => peak(pcm.left, c, 1)), R: clicksR.map((c) => peak(pcm.right, c, -1)) },
    };
    // seek: render a source started at an offset, find a click in the output
    const seek = [];
    for (const [ch, c, sign] of [[0, 1000, 1], [1, clicksR[1], -1], [0, n - 1, 1]]) {
      const off = Math.max(0, c - 300);
      const buf = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: desc.sampleRate });
      buf.copyToChannel(pcm.left, 0); buf.copyToChannel(pcm.right, 1);
      const oc = new OfflineAudioContext(2, 2048, desc.sampleRate);
      const src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start(0, off / desc.sampleRate);
      const rendered = await oc.startRendering();
      const x = rendered.getChannelData(ch); let bi = -1, bv = 0; for (let i = 0; i < x.length; i++) { const v = x[i] * sign; if (v > bv) { bv = v; bi = i; } }
      seek.push({ click: c, seekFrame: off, expectedAt: c - off, foundAt: bi });
    }
    res.seek = seek;
    return res;
  }, { b64: b.toString('base64'), desc, seed, n });
  const row = { file, desc: desc.alignment, ...r }; out.push(row); console.log(JSON.stringify(row));
}
// negative cases
const neg = [];
const { b: b1, desc: d1 } = descFor('sig44100.mp3', 44100, 220500);
const variants = {
  'wrong frames (+1)': (d) => ({ ...d, frames: d.frames + 1, alignment: { ...d.alignment, paddingFrames: d.alignment.paddingFrames - 1 } }),
  'tag mismatch (delay shifted)': (d) => ({ ...d, alignment: { ...d.alignment, encoderDelayFrames: d.alignment.encoderDelayFrames + 10, paddingFrames: d.alignment.paddingFrames - 10 + 1 } }),
  'wrong sha': (d) => ({ ...d, sha256: 'a'.repeat(64) }),
  'wrong sampleRate': (d) => ({ ...d, sampleRate: 48000 }),
};
for (const [name, f] of Object.entries(variants)) {
  const r = await page.evaluate(async ({ b64, desc }) => { try { await new Mp3Mod.Mp3StemDecoder().decodeStem(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), desc); return 'ACCEPTED'; } catch (e) { return e.code + ': ' + e.message; } }, { b64: b1.toString('base64'), desc: f(d1) });
  neg.push([name, r]); console.log(name, '=>', r);
}
// garbage bytes -> decode must fail closed
const garbage = Buffer.alloc(d1.sizeBytes, 7);
const rg = await page.evaluate(async ({ b64, desc }) => { try { await new Mp3Mod.Mp3StemDecoder().decodeStem(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), desc); return 'ACCEPTED'; } catch (e) { return e.code; } }, { b64: garbage.toString('base64'), desc: { ...d1, sha256: createHash('sha256').update(garbage).digest('hex') } });
console.log('garbage bytes (valid sha) =>', rg);
writeFileSync('browser-results.json', JSON.stringify({ browser: browser.version(), out, neg, garbage: rg }, null, 1));
await browser.close();
