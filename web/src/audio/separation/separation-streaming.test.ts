import { describe, expect, it, vi } from 'vitest';
import {
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  allocatePcm16WavBuffer,
  computeSha256Hex,
  decodeWavIntoChannels,
  decodeWavToStereoFloat32,
  encodeStereoPcm16Wav,
  quantizePcm16,
  separateStereoAudio,
  type AudioSeparationModelDescriptor,
  type OnnxInferenceSessionHandle,
} from './demucs-onnx-separator';

// M22-M1: the streaming finalisation (retainPcmChannels=false) must be bit-identical to the historical path.

const SEGMENT = 16;

function descriptor(overlapRatio = 0.25): AudioSeparationModelDescriptor {
  return {
    ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
    id: 'test_6s_stream',
    segmentSamples: SEGMENT,
    defaultOverlapRatio: overlapRatio,
    expectedModelSha256: undefined,
    expectedModelBytes: undefined,
  };
}

function makeSession(d: AudioSeparationModelDescriptor, onRun?: (call: number) => void): OnnxInferenceSessionHandle & { disposed: () => number } {
  let calls = 0;
  const dispose = vi.fn();
  return {
    executionProvider: 'wasm',
    inputNames: ['mix'],
    outputNames: ['stems'],
    descriptor: d,
    modelId: d.id,
    modelVersion: d.version,
    ortVersion: '1.21.0-test',
    modelChecksumVerified: false,
    // Non-linear, chunk-dependent output so any overlap/window/carry mistake changes the bytes.
    runSegment: async (mix: Float32Array, seg: number, active: AudioSeparationModelDescriptor) => {
      calls += 1;
      onRun?.(calls);
      const stems = active.rawOutputStemOrder.length;
      const out = new Float32Array(stems * 2 * seg);
      for (let s = 0; s < stems; s++) {
        for (let t = 0; t < seg; t++) {
          const l = mix[t];
          const r = mix[seg + t];
          out[s * 2 * seg + t] = Math.tanh(l * (0.4 + 0.13 * s) + 0.05 * Math.sin(calls * 1.7 + s + t)) * 0.9;
          out[(s * 2 + 1) * seg + t] = Math.tanh(r * (0.35 + 0.11 * s) - 0.04 * Math.cos(calls * 0.9 + s - t)) * 0.9;
        }
      }
      return out;
    },
    dispose,
    disposed: () => dispose.mock.calls.length,
  } as OnnxInferenceSessionHandle & { disposed: () => number };
}

function audio(totalFrames: number) {
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  for (let t = 0; t < totalFrames; t++) {
    left[t] = Math.sin(t * 0.37) * 0.8;
    right[t] = Math.cos(t * 0.21) * 0.7;
  }
  return { sampleRate: 44100, totalFrames, left, right };
}

async function run(totalFrames: number, retain: boolean, d = descriptor()) {
  return separateStereoAudio(audio(totalFrames), {
    descriptor: d,
    createSession: async () => ({ session: makeSession(d), modelLoadMs: 1 }),
    yieldBetweenChunks: false,
    retainPcmChannels: retain,
  });
}

describe('separateStereoAudio retainPcmChannels=false (streaming finalisation)', () => {
  it.each([5, 16, 17, 30, 61, 100, 101])('is bit-identical to the retained path for %i frames', async (frames) => {
    const classic = await run(frames, true);
    const streaming = await run(frames, false);
    expect(streaming.orderedStems.map((s) => s.id)).toEqual(classic.orderedStems.map((s) => s.id));
    for (let i = 0; i < classic.orderedStems.length; i++) {
      const a = classic.orderedStems[i];
      const b = streaming.orderedStems[i];
      expect(Buffer.from(b.wavBytes).equals(Buffer.from(a.wavBytes))).toBe(true);
      expect(b.sha256).toBe(a.sha256);
      expect(b.rms).toBe(a.rms);
      expect(b.peak).toBe(a.peak);
      expect(b.byteLength).toBe(a.byteLength);
      expect(b.totalFrames).toBe(frames);
      expect(b.left.length).toBe(0);
      expect(b.right.length).toBe(0);
      expect(a.left.length).toBe(frames);
    }
    expect(streaming.telemetry.reconstructionMaxAbsError).toBe(classic.telemetry.reconstructionMaxAbsError);
    expect(streaming.telemetry.chunksProcessed).toBe(classic.telemetry.chunksProcessed);
  });

  it('is identical with zero overlap and with a 50% ratio window', async () => {
    for (const ratio of [0, 0.49]) {
      const d = descriptor(ratio);
      const classic = await run(57, true, d);
      const streaming = await run(57, false, d);
      classic.orderedStems.forEach((a, i) => {
        expect(streaming.orderedStems[i].sha256).toBe(a.sha256);
      });
    }
  });

  it('abort in the middle rejects with CANCELLED and still disposes the owned session', async () => {
    const d = descriptor();
    const abort = new AbortController();
    const session = makeSession(d, (call) => { if (call === 2) abort.abort(); });
    await expect(
      separateStereoAudio(audio(100), {
        descriptor: d,
        createSession: async () => ({ session, modelLoadMs: 1 }),
        yieldBetweenChunks: false,
        retainPcmChannels: false,
        signal: abort.signal,
      })
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(session.disposed()).toBe(1);
  });

  it('fails closed on a non-finite model output (no WAV is produced)', async () => {
    const d = descriptor();
    const session = makeSession(d);
    const original = session.runSegment;
    session.runSegment = async (...args) => {
      const out = await original(...args);
      out[3] = Number.NaN;
      return out;
    };
    await expect(
      separateStereoAudio(audio(40), { descriptor: d, createSession: async () => ({ session, modelLoadMs: 1 }), yieldBetweenChunks: false, retainPcmChannels: false })
    ).rejects.toMatchObject({ code: 'NON_FINITE_OUTPUT' });
  });
});

describe('PCM16 helpers shared with the streaming path', () => {
  it('allocatePcm16WavBuffer has the header of encodeStereoPcm16Wav and quantizePcm16 matches its samples', () => {
    const frames = 9;
    const left = Float32Array.from({ length: frames }, (_, i) => (i - 4) / 3.7);
    const right = Float32Array.from({ length: frames }, (_, i) => Math.sin(i) * 1.4);
    const encoded = encodeStereoPcm16Wav({ sampleRate: 44100, left, right });
    const blank = allocatePcm16WavBuffer(44100, frames);
    expect(Buffer.from(blank.subarray(0, 44)).equals(Buffer.from(encoded.subarray(0, 44)))).toBe(true);
    const view = new DataView(encoded.buffer);
    for (let i = 0; i < frames; i++) {
      expect(view.getInt16(44 + i * 4, true)).toBe(quantizePcm16(left[i]));
      expect(view.getInt16(46 + i * 4, true)).toBe(quantizePcm16(right[i]));
    }
  });

  it('computeSha256Hex hashes a sub-view exactly and without touching the source', async () => {
    const backing = new Uint8Array(64).map((_, i) => i);
    const view = backing.subarray(8, 40);
    const expected = await computeSha256Hex(view.slice());
    expect(await computeSha256Hex(view)).toBe(expected);
    expect(backing[8]).toBe(8);
  });
});

describe('decodeWavIntoChannels (incremental decode)', () => {
  const frames = 5000;
  const wav = () => {
    const a = audio(frames);
    return encodeStereoPcm16Wav({ sampleRate: 44100, left: a.left, right: a.right });
  };

  it('writes the same samples as decodeWavToStereoFloat32 and yields between slices', async () => {
    const bytes = wav();
    const buf = bytes.buffer as ArrayBuffer;
    const ref = decodeWavToStereoFloat32(buf, { expectedSampleRate: 44100 });
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const yieldFn = vi.fn(async () => {});
    const stats = await decodeWavIntoChannels(buf, left, right, { expectedSampleRate: 44100, sliceFrames: 1024, yieldFn });
    expect(Buffer.from(left.buffer).equals(Buffer.from(ref.left.buffer))).toBe(true);
    expect(Buffer.from(right.buffer).equals(Buffer.from(ref.right.buffer))).toBe(true);
    expect(stats?.totalFrames).toBe(frames);
    expect(yieldFn).toHaveBeenCalledTimes(Math.ceil(frames / 1024) - 1);
    let sumSq = 0; let peak = 0;
    for (let i = 0; i < frames; i++) { sumSq += ref.left[i] ** 2 + ref.right[i] ** 2; peak = Math.max(peak, Math.abs(ref.left[i]), Math.abs(ref.right[i])); }
    expect(stats?.rms).toBe(Math.sqrt(sumSq / (frames * 2)));
    expect(stats?.peak).toBe(peak);
  });

  it('enforces the same caps and stops when cancelled', async () => {
    const buf = wav().buffer as ArrayBuffer;
    const l = new Float32Array(frames); const r = new Float32Array(frames);
    await expect(decodeWavIntoChannels(buf, l, r, { expectedSampleRate: 48000 })).rejects.toMatchObject({ code: 'SAMPLE_RATE_MISMATCH' });
    await expect(decodeWavIntoChannels(buf, l, r, { maxFrames: frames - 1 })).rejects.toMatchObject({ code: 'INVALID_AUDIO' });
    await expect(decodeWavIntoChannels(buf, new Float32Array(10), new Float32Array(10))).rejects.toMatchObject({ code: 'INVALID_AUDIO' });
    let n = 0;
    expect(await decodeWavIntoChannels(buf, l, r, { sliceFrames: 1024, isCancelled: () => ++n > 2 })).toBeNull();
  });
});
