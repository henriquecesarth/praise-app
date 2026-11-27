// Synthetic six-stem fixtures and alignment metrics for the M22-C.5 MP3 proof of concept.
// No real music, no Demucs, no network: deterministic signals only.

export const STEM_IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
export const SAMPLE_RATE = 44100;

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

/** Burst positions (frames) shared by all stems so alignment can be measured anywhere. */
export function burstFrames(totalFrames) {
  const marks = [Math.round(0.5 * SAMPLE_RATE)];
  for (let t = 5; t < totalFrames / SAMPLE_RATE - 1; t += 5) marks.push(Math.round(t * SAMPLE_RATE));
  marks.push(totalFrames - Math.round(0.5 * SAMPLE_RATE));
  return marks;
}

export const BURST_LEN = 2048;

/** Planar Float32 stereo stem: quiet stem-specific tone + seeded noise bursts at burstFrames(). */
export function makeStem(index, seconds) {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const freq = 110 * Math.pow(2, index / 2);
  for (let i = 0; i < frames; i++) {
    const v = 0.08 * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    left[i] = v;
    right[i] = v * 0.9;
  }
  const rnd = prng(1234 + index);
  for (const start of burstFrames(frames)) {
    for (let k = 0; k < BURST_LEN; k++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (BURST_LEN - 1));
      left[start + k] += 0.7 * w * rnd();
      right[start + k] += 0.7 * w * rnd();
    }
  }
  return { left, right, frames, sampleRate: SAMPLE_RATE };
}

export function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

export function pcm16WavBytes(stem) {
  const frames = stem.frames;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, stem.sampleRate, true); v.setUint32(28, stem.sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, frames * 4, true);
  const l = toInt16(stem.left), r = toInt16(stem.right);
  for (let i = 0; i < frames; i++) { v.setInt16(44 + i * 4, l[i], true); v.setInt16(46 + i * 4, r[i], true); }
  return new Uint8Array(buf);
}

/** Lag (frames) at which `decoded` best matches `reference` around `start`, via brute-force xcorr. */
export function burstLag(reference, decoded, start, maxLag = 4000) {
  let best = -Infinity, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let k = 0; k < BURST_LEN; k += 2) {
      const d = decoded[start + k + lag];
      if (d !== undefined) acc += reference[start + k] * d;
    }
    if (acc > best) { best = acc; bestLag = lag; }
  }
  return bestLag;
}

/** Alignment report for one decoded channel pair against the reference stem. */
export function alignmentReport(stem, decodedLeft) {
  const marks = burstFrames(stem.frames);
  const lags = marks.map((m) => burstLag(stem.left, decodedLeft, m));
  const initial = lags[0];
  const final = lags[lags.length - 1];
  return {
    lagsFrames: lags,
    initialLagFrames: initial,
    driftFrames: final - initial,
    lagSpreadFrames: Math.max(...lags) - Math.min(...lags),
    decodedFrames: decodedLeft.length,
    frameDelta: decodedLeft.length - stem.frames,
    trailingPaddingFrames: decodedLeft.length - (stem.frames + initial),
  };
}
