import { describe, expect, it, vi } from 'vitest';
import { computeSha256Hex, encodeStereoPcm16Wav } from '../separation/demucs-onnx-separator';
import { inspectMp3Stream } from '../mp3-stem-decoder';
import { createLameWasmBackend } from './mp3-lame-backend';
import { LAME_ENCODER_ID, Mp3EncodingError, cbr256FrameBytes, crc16, scanCbr256Frames } from './mp3-info-frame';
import { encodeWavStemToMp3, type Mp3EncoderBackend } from './mp3-stem-encoder';

// M22-S1: the encoder wrapper, the derived Info/LAME frame and the fail-closed paths. The real LAME WebAssembly build
// is exercised on synthetic signals only (no music).

const DECODER_DELAY = 529;

function wavOf(frames: number, rate = 44_100, fill?: (i: number) => [number, number]) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const [l, r] = fill ? fill(i) : [Math.sin(i * 0.05) * 0.5, Math.sin(i * 0.031) * 0.4];
    left[i] = l; right[i] = r;
  }
  return encodeStereoPcm16Wav({ sampleRate: rate, left, right });
}

/** Valid-looking CBR 256 stream: `count` audio frames of zeros. */
function fakeFrames(count: number, rate = 44_100): Uint8Array {
  const length = cbr256FrameBytes(rate);
  const out = new Uint8Array(count * length);
  for (let f = 0; f < count; f++) out.set([0xff, 0xfb, 0xd0, 0x44], f * length);
  return out;
}

function fakeBackend(frameCountFor: (totalSamples: number) => number, rate = 44_100): Mp3EncoderBackend & { disposed: number } {
  let samples = 0;
  const backend = {
    disposed: 0,
    configure: () => {},
    encode: (l: Float32Array) => { samples += l.length; return new Uint8Array(0); },
    finalize: () => fakeFrames(frameCountFor(samples), rate),
    dispose() { backend.disposed++; },
  };
  return backend;
}

describe('encodeWavStemToMp3 with the real LAME 3.100 WebAssembly build', () => {
  it.each([[44_100, 1], [44_100, 3], [48_000, 2]])('produces a self-consistent CBR 256 MP3 with an Info/LAME frame (%i Hz, %i s)', async (rate, seconds) => {
    const wav = wavOf(rate * seconds + 17, rate, (i) => [Math.sin(i * 0.05) * 0.5, i === 10_000 ? -0.9 : Math.sin(i * 0.031) * 0.4]);
    const before = await computeSha256Hex(wav);
    const encoded = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: DECODER_DELAY });
    expect(await computeSha256Hex(wav)).toBe(before); // the source WAV is never modified
    expect(encoded.sha256).toBe(await computeSha256Hex(encoded.bytes));
    expect(encoded.sizeBytes).toBe(encoded.bytes.length);
    expect(encoded.tag).toMatchObject({ encoder: LAME_ENCODER_ID, delayFrames: 576 });

    const info = inspectMp3Stream(encoded.bytes, rate); // the existing Web inspector: every header, Info frame, LAME tag
    expect(info.mpegAudioFrames).toBe(encoded.alignment.mpegAudioFrames);
    expect(info.tagDelayFrames).toBe(576);
    expect(info.tagPaddingFrames).toBe(encoded.tag.paddingFrames);
    const a = encoded.alignment;
    expect(a.encoderDelayFrames + encoded.frames + a.paddingFrames).toBe(a.mpegAudioFrames * 1152); // contract v2 invariant
    expect(a.encoderDelayFrames - info.tagDelayFrames).toBe(DECODER_DELAY);
    expect(a.infoFrame).toBe(true);

    // Byte-level facts the server re-derives: sizes, counts and both CRC-16s.
    const b = encoded.bytes;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const frameLen = cbr256FrameBytes(rate);
    expect(String.fromCharCode(...b.subarray(36, 40))).toBe('Info');
    expect(view.getUint32(36 + 4)).toBe(3);
    expect(view.getUint32(36 + 8)).toBe(a.mpegAudioFrames);
    expect(view.getUint32(36 + 12)).toBe(b.length);
    expect(String.fromCharCode(...b.subarray(52, 61))).toBe(LAME_ENCODER_ID);
    expect(view.getUint32(52 + 28)).toBe(b.length);
    expect(view.getUint16(52 + 34)).toBe(crc16(0, b, 0, 52 + 34));
    expect(view.getUint16(52 + 32)).toBe(crc16(0, b, frameLen)); // music CRC: everything after the Info frame
    expect(scanCbr256Frames([b.subarray(frameLen)], rate).frames).toBe(a.mpegAudioFrames);
    for (let i = 4; i < 36; i++) expect(b[i]).toBe(0); // zero side info
  });

  it('compresses a stem to well under a fifth of the WAV size', async () => {
    const wav = wavOf(44_100 * 5);
    const encoded = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: DECODER_DELAY });
    expect(encoded.sizeBytes / wav.length).toBeLessThan(0.19);
    expect(encoded.sizeBytes / wav.length).toBeGreaterThan(0.17);
  });

  it('is deterministic: the same WAV gives byte-identical MP3 files', async () => {
    const wav = wavOf(44_100 * 2);
    const a = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: DECODER_DELAY });
    const b = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: DECODER_DELAY });
    expect(b.sha256).toBe(a.sha256);
  });

  it('handles a WAV that is not a multiple of the slice size and tiny inputs', async () => {
    for (const frames of [1, 575, 576, 1151, 1152, 73_729]) {
      const encoded = await encodeWavStemToMp3(wavOf(frames), { backend: await createLameWasmBackend(), decoderDelayFrames: DECODER_DELAY });
      const a = encoded.alignment;
      expect(a.encoderDelayFrames + frames + a.paddingFrames).toBe(a.mpegAudioFrames * 1152);
      expect(a.paddingFrames).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('encodeWavStemToMp3 fail-closed paths', () => {
  const opts = (backend: Mp3EncoderBackend, extra = {}) => ({ backend, decoderDelayFrames: DECODER_DELAY, ...extra });

  it('rejects mono, 8-bit, unsupported rates, empty and over-limit WAVs without touching the encoder', async () => {
    const backend = fakeBackend(() => 1);
    const configure = vi.spyOn(backend, 'configure');
    const mono = wavOf(1000).slice();
    new DataView(mono.buffer).setUint16(22, 1, true);
    await expect(encodeWavStemToMp3(mono, opts(backend))).rejects.toBeInstanceOf(Mp3EncodingError);
    await expect(encodeWavStemToMp3(wavOf(1000, 32_000), opts(backend))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(encodeWavStemToMp3(new Uint8Array(0), opts(backend))).rejects.toBeInstanceOf(Mp3EncodingError);
    await expect(encodeWavStemToMp3(new Uint8Array(64).fill(7), opts(backend))).rejects.toBeInstanceOf(Mp3EncodingError);
    await expect(encodeWavStemToMp3(wavOf(44_100 * 2), opts(backend, { maxSeconds: 1 }))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(configure).not.toHaveBeenCalled();
  });

  it('rejects an invalid decoder delay', async () => {
    await expect(encodeWavStemToMp3(wavOf(2000), { backend: fakeBackend(() => 3), decoderDelayFrames: -1 })).rejects.toMatchObject({ code: 'ALIGNMENT' });
    await expect(encodeWavStemToMp3(wavOf(2000), { backend: fakeBackend(() => 3), decoderDelayFrames: 1.5 })).rejects.toMatchObject({ code: 'ALIGNMENT' });
  });

  it('rejects an encoder stream that is not CBR 256 (wrong bitrate, mono, truncated, garbage, empty)', async () => {
    const make = () => fakeBackend(() => 3);
    const cases: Array<(s: Uint8Array) => Uint8Array> = [
      (s) => { s[2] = 0x90; return s; }, // 128 kbps
      (s) => { s[3] = 0xc4; return s; }, // mono
      (s) => s.subarray(0, s.length - 5), // truncated
      () => new Uint8Array(2000).fill(0x55), // garbage
      () => new Uint8Array(0), // nothing
      (s) => { s[1] = 0xfa; return s; }, // CRC-protected frame
    ];
    for (const mutate of cases) {
      const backend = make();
      backend.finalize = () => mutate(fakeFrames(3));
      await expect(encodeWavStemToMp3(wavOf(2000), opts(backend))).rejects.toMatchObject({ code: 'INVALID_STREAM' });
      expect(backend.disposed).toBe(1);
    }
  });

  it('rejects a stream whose padding would cut the decoder tail (alignment)', async () => {
    // 3 frames * 1152 - 576 - 2800 = 80 < 529
    await expect(encodeWavStemToMp3(wavOf(2800), opts(fakeBackend(() => 3)))).rejects.toMatchObject({ code: 'ALIGNMENT' });
    // padding above 12 bits
    await expect(encodeWavStemToMp3(wavOf(2000), opts(fakeBackend(() => 40)))).rejects.toMatchObject({ code: 'ALIGNMENT' });
  });

  it('maps encoder exceptions and allocation failures, always disposing the encoder', async () => {
    const oom = fakeBackend(() => 1);
    oom.encode = () => { throw new RangeError('Array buffer allocation failed'); };
    await expect(encodeWavStemToMp3(wavOf(2000), opts(oom))).rejects.toMatchObject({ code: 'OUT_OF_MEMORY' });
    expect(oom.disposed).toBe(1);
    const broken = fakeBackend(() => 1);
    broken.finalize = () => { throw new Error('boom'); };
    await expect(encodeWavStemToMp3(wavOf(2000), opts(broken))).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    expect(broken.disposed).toBe(1);
  });

  it('cancels between slices (AbortSignal and isCancelled), disposes the encoder and returns no bytes', async () => {
    const wav = wavOf(5000);
    const abort = new AbortController();
    const backend = fakeBackend(() => 6);
    const original = backend.encode;
    backend.encode = (l, r) => { const out = original(l, r); abort.abort(); return out; };
    await expect(encodeWavStemToMp3(wav, opts(backend, { signal: abort.signal, sliceFrames: 1000 }))).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(backend.disposed).toBe(1);

    let slices = 0;
    const second = fakeBackend(() => 6);
    const encode = second.encode;
    second.encode = (l, r) => { slices++; return encode(l, r); };
    await expect(encodeWavStemToMp3(wav, opts(second, { sliceFrames: 1000, isCancelled: () => slices >= 2 }))).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(slices).toBe(2);
  });

  it('yields to the event loop between slice groups', async () => {
    const yieldFn = vi.fn(async () => {});
    await encodeWavStemToMp3(wavOf(9000), opts(fakeBackend(() => 9), { sliceFrames: 1000, yieldEverySlices: 3, yieldFn }));
    expect(yieldFn).toHaveBeenCalledTimes(3);
  });
});
