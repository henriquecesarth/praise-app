import { describe, expect, it } from 'vitest';
import { measureWindowAlignment } from './mp3-draft-compression';

// M22-S2.1: the signal comparison must detect real shifts of +-1..3 samples (either channel), must not call a quiet or
// ambiguous window "aligned", and must not accuse a correctly aligned stream.

const N = 12_000;
const rng = (seed: number) => { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 - 0.5; }; };

type Pair = { left: Float32Array; right: Float32Array };

function wavOf({ left, right }: Pair): Uint8Array {
  const out = new Uint8Array(44 + left.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < left.length; i++) {
    view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i]!)) * 32767), true);
    view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i]!)) * 32767), true);
  }
  return out;
}

const shifted = (x: Float32Array, lag: number) => Float32Array.from(x, (_, i) => x[Math.min(x.length - 1, Math.max(0, i - lag))]!);
/** Decoder output: the original (optionally shifted per channel) plus white codec-like noise at about -60 dBFS. */
function decode(orig: Pair, lagLeft: number, lagRight: number, seed = 7): Pair {
  const noise = rng(seed);
  const add = (x: Float32Array) => Float32Array.from(x, (v) => v + noise() * 0.002);
  return { left: add(shifted(orig.left, lagLeft)), right: add(shifted(orig.right, lagRight)) };
}

const signals: Record<string, () => Pair> = {
  impulses: () => {
    const l = new Float32Array(N); const r = new Float32Array(N);
    for (let i = 500; i < N - 500; i += 700) { l[i] = 0.8; r[i + 3] = -0.7; }
    return { left: l, right: r };
  },
  broadband: () => {
    const a = rng(1); const b = rng(2);
    return { left: Float32Array.from({ length: N }, () => a() * 0.6), right: Float32Array.from({ length: N }, () => b() * 0.6) };
  },
  music: () => ({
    left: Float32Array.from({ length: N }, (_, i) => 0.3 * Math.sin(i * 0.05) + 0.2 * Math.sin(i * 0.9) + 0.1 * Math.sin(i * 1.7)),
    right: Float32Array.from({ length: N }, (_, i) => 0.25 * Math.sin(i * 0.04) + 0.2 * Math.sin(i * 1.1)),
  }),
  narrowBassSustained: () => ({
    left: Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 45 * i) / 44_100)),
    right: Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 45 * i) / 44_100 + 0.3)),
  }),
  silent: () => ({ left: new Float32Array(N), right: new Float32Array(N) }),
};

const measure = (orig: Pair, dec: Pair) => measureWindowAlignment(wavOf(orig), 44, N, dec, 0);

describe('measureWindowAlignment', () => {
  it.each(['impulses', 'broadband', 'music'])('%s: an aligned stream is proven aligned (evidence, not absence of evidence)', (name) => {
    const orig = signals[name]!();
    expect(measure(orig, decode(orig, 0, 0))).toEqual({ status: 'aligned' });
  });

  it.each(['impulses', 'broadband', 'music'])('%s: shifts of +-1, +-2, +-3 samples are detected in the left, the right or both channels', (name) => {
    const orig = signals[name]!();
    for (const lag of [-3, -2, -1, 1, 2, 3]) {
      for (const [l, r] of [[lag, 0], [0, lag], [lag, lag]] as const) {
        const result = measure(orig, decode(orig, l, r));
        expect(result.status, `${name} lag ${l}/${r}`).toBe('shifted');
      }
    }
  });

  it('a sustained low bass cannot prove alignment: it is inconclusive or detected, never "aligned" when shifted, never "shifted" when aligned', () => {
    const orig = signals.narrowBassSustained!();
    expect(measure(orig, decode(orig, 0, 0)).status).not.toBe('shifted');
    for (const lag of [-3, -2, -1, 1, 2, 3]) {
      expect(measure(orig, decode(orig, lag, lag)).status, `lag ${lag}`).not.toBe('aligned');
    }
  });

  it('a silent window is inconclusive, never aligned', () => {
    const orig = signals.silent!();
    expect(measure(orig, decode(orig, 0, 0))).toEqual({ status: 'inconclusive', reason: 'silent' });
  });

  it('a window too short to judge is inconclusive', () => {
    const orig = signals.music!();
    expect(measureWindowAlignment(wavOf(orig), 44, N, decode(orig, 0, 0), N - 10)).toEqual({ status: 'inconclusive', reason: 'short' });
  });
});
