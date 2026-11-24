import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ORIGINAL_MP3_BYTES,
  Mp3ImportError,
  importOriginalMp3,
  inspectOriginalMp3,
  looksLikeMp3,
  looksLikeWav,
} from './original-mp3-import';
import type { DecodedBufferLike, Mp3DecodeBackend } from './mp3-stem-decoder';
import { decodeWavToStereoFloat32, MAX_SEPARATION_TOTAL_FRAMES } from './separation/demucs-onnx-separator';

// Small synthetic fixtures (sine tones generated for this repository; no commercial material). Real browser decoding of
// these same files is exercised in e2e/m22e1-mp3-import.spec.ts.
const FIXTURES = join(__dirname, '..', '..', 'e2e', 'fixtures', 'original-mp3');
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const CBR_ID3 = () => fixture('cbr-stereo-44k-id3.mp3');
const VBR_48K = () => fixture('vbr-stereo-48k.mp3');
const MONO_22K = () => fixture('cbr-mono-22k.mp3');

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); } catch (reason) { return reason instanceof Mp3ImportError ? reason.code : `other:${String(reason)}`; }
  return undefined;
}
async function asyncCodeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try { await fn(); } catch (reason) { return reason instanceof Mp3ImportError ? reason.code : `other:${String(reason)}`; }
  return undefined;
}
const own = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

function buffer(length: number, channels: number, sampleRate = 44_100, fill = (i: number) => Math.sin(i / 20) * 0.5): DecodedBufferLike {
  const data = Array.from({ length: channels }, () => Float32Array.from({ length }, (_, i) => fill(i)));
  return { sampleRate, numberOfChannels: channels, length, getChannelData: (c) => data[c] };
}
const backendOf = (decoded: DecodedBufferLike | (() => Promise<DecodedBufferLike>)): Mp3DecodeBackend & { decode: ReturnType<typeof vi.fn> } => ({
  decode: vi.fn(async () => (typeof decoded === 'function' ? decoded() : decoded)),
});

describe('inspectOriginalMp3 (structure and duration from frames, before any decoding)', () => {
  it('reads an MP3 CBR stereo 44.1 kHz with an ID3v2 tag', () => {
    const info = inspectOriginalMp3(CBR_ID3());
    expect(info).toMatchObject({ sampleRate: 44_100, channels: 2, variableBitrate: false });
    expect(info.id3v2Bytes).toBeGreaterThan(10);
    expect(info.durationSeconds).toBeGreaterThan(3.9);
    expect(info.durationSeconds).toBeLessThan(4.2);
  });

  it('reads an MP3 VBR at 48 kHz', () => {
    const info = inspectOriginalMp3(VBR_48K());
    expect(info).toMatchObject({ sampleRate: 48_000, channels: 2, variableBitrate: true });
    expect(info.durationSeconds).toBeGreaterThan(3.9);
    expect(info.durationSeconds).toBeLessThan(4.2);
  });

  it('reads a mono MPEG-2 MP3 at 22.05 kHz (576 samples per frame)', () => {
    const info = inspectOriginalMp3(MONO_22K());
    expect(info).toMatchObject({ sampleRate: 22_050, channels: 1 });
    expect(info.durationSeconds).toBeGreaterThan(3.9);
    expect(info.durationSeconds).toBeLessThan(4.2);
  });

  it('tolerates an ID3v1 trailer', () => {
    const bytes = CBR_ID3();
    const withTrailer = new Uint8Array(bytes.length + 128);
    withTrailer.set(bytes);
    withTrailer.set([0x54, 0x41, 0x47], bytes.length);
    expect(inspectOriginalMp3(withTrailer).audioFrames).toBe(inspectOriginalMp3(bytes).audioFrames);
  });

  it('rejects empty, oversized, text and renamed non-MP3 files by content, not by name', () => {
    expect(codeOf(() => inspectOriginalMp3(new Uint8Array(0)))).toBe('EMPTY');
    expect(codeOf(() => inspectOriginalMp3(new Uint8Array(MAX_ORIGINAL_MP3_BYTES + 1)))).toBe('TOO_LARGE');
    expect(codeOf(() => inspectOriginalMp3(new TextEncoder().encode('isto não é um mp3, só texto renomeado.'.repeat(40))))).toBe('NOT_MP3');
    const png = new Uint8Array(4096); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(codeOf(() => inspectOriginalMp3(png))).toBe('NOT_MP3');
    const wav = new Uint8Array(4096); wav.set(new TextEncoder().encode('RIFF'), 0); wav.set(new TextEncoder().encode('WAVE'), 8);
    expect(codeOf(() => inspectOriginalMp3(wav))).toBe('NOT_MP3');
  });

  it('rejects truncated, damaged-in-the-middle and hostile-ID3 files', () => {
    const good = CBR_ID3();
    const start = inspectOriginalMp3(good).id3v2Bytes;
    expect(codeOf(() => inspectOriginalMp3(good.slice(0, start + 600)))).toBe('CORRUPT'); // a couple of frames only
    const damaged = good.slice();
    damaged.fill(0x00, start + 20_000, start + 30_000);
    expect(codeOf(() => inspectOriginalMp3(damaged))).toBe('CORRUPT');
    const hostile = good.slice(); // syncsafe size pointing far past the end of the file
    hostile.set([0x7f, 0x7f, 0x7f, 0x7f], 6);
    expect(codeOf(() => inspectOriginalMp3(hostile))).toBe('CORRUPT');
    const badSyncsafe = good.slice(); badSyncsafe[6] = 0x80;
    expect(codeOf(() => inspectOriginalMp3(badSyncsafe))).toBe('CORRUPT');
  });

  it('rejects a song longer than 300 s from the frames alone, without decoding', () => {
    const one = CBR_ID3();
    const start = inspectOriginalMp3(one).id3v2Bytes;
    const audio = one.subarray(start);
    const copies = 80; // ~320 s
    const long = new Uint8Array(start + audio.length * copies);
    long.set(one.subarray(0, start));
    for (let i = 0; i < copies; i++) long.set(audio, start + i * audio.length);
    expect(codeOf(() => inspectOriginalMp3(long))).toBe('TOO_LONG');
    const justUnder = new Uint8Array(start + audio.length * 70); // ~280 s
    justUnder.set(one.subarray(0, start));
    for (let i = 0; i < 70; i++) justUnder.set(audio, start + i * audio.length);
    expect(inspectOriginalMp3(justUnder).durationSeconds).toBeLessThanOrEqual(300);
  });

  it('routes by content sniffing only', () => {
    expect(looksLikeMp3(CBR_ID3())).toBe(true);
    expect(looksLikeMp3(VBR_48K())).toBe(true); // starts at a frame sync, no ID3
    expect(looksLikeMp3(new TextEncoder().encode('RIFFxxxxWAVE'))).toBe(false);
    expect(looksLikeWav(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBe(true);
    expect(looksLikeWav(CBR_ID3())).toBe(false);
  });
});

describe('importOriginalMp3 (decoded PCM -> canonical PCM16 WAV)', () => {
  it('produces a stereo 44.1 kHz PCM16 WAV the Demucs worker already accepts', async () => {
    const frames = 4 * 44_100;
    const result = await importOriginalMp3(own(CBR_ID3()), { backend: backendOf(buffer(frames, 2)) });
    expect(result.sampleRate).toBe(44_100);
    expect(result.frames).toBe(frames);
    expect(result.wavBytes.byteLength).toBe(44 + frames * 4);
    const parsed = decodeWavToStereoFloat32(result.wavBytes, { expectedSampleRate: 44_100 });
    expect(parsed).toMatchObject({ sampleRate: 44_100 });
    expect(parsed.left.length).toBe(frames);
    expect(Math.max(...parsed.left.subarray(0, 2000))).toBeGreaterThan(0.3);
  });

  it('duplicates a mono decode into both channels', async () => {
    const frames = 4 * 44_100;
    const result = await importOriginalMp3(own(MONO_22K()), { backend: backendOf(buffer(frames, 1)) });
    expect(result.sourceChannels).toBe(1);
    const parsed = decodeWavToStereoFloat32(result.wavBytes, { expectedSampleRate: 44_100 });
    expect(Array.from(parsed.right.subarray(100, 140))).toEqual(Array.from(parsed.left.subarray(100, 140)));
  });

  it('asks the browser for 44.1 kHz and hands over the picked bytes without copying them', async () => {
    const bytes = own(VBR_48K()); // a 48 kHz file: the resampling is the decoder's job
    const backend = backendOf(buffer(4 * 44_100, 2));
    await importOriginalMp3(bytes, { backend });
    expect(backend.decode).toHaveBeenCalledTimes(1);
    expect(backend.decode.mock.calls[0][0]).toBe(bytes);
    expect(backend.decode.mock.calls[0][1]).toBe(44_100);
  });

  it('rejects structurally invalid files before touching the decoder', async () => {
    const backend = backendOf(buffer(100, 2));
    expect(await asyncCodeOf(() => importOriginalMp3(new ArrayBuffer(0), { backend }))).toBe('EMPTY');
    expect(await asyncCodeOf(() => importOriginalMp3(new TextEncoder().encode('x'.repeat(5000)).buffer as ArrayBuffer, { backend }))).toBe('NOT_MP3');
    expect(backend.decode).not.toHaveBeenCalled();
  });

  it('fails clearly when the browser has no MP3 decoding', async () => {
    expect(await asyncCodeOf(() => importOriginalMp3(own(CBR_ID3()), { backend: null }))).toBe('UNAVAILABLE');
  });

  it('maps a decoder failure to a friendly error without leaking internals', async () => {
    const backend: Mp3DecodeBackend = { decode: async () => { throw new DOMException('EncodingError: boom', 'EncodingError'); } };
    const error = await importOriginalMp3(own(CBR_ID3()), { backend }).catch((reason) => reason as Mp3ImportError);
    expect(error).toMatchObject({ code: 'DECODE_FAILED' });
    expect((error as Mp3ImportError).message).not.toContain('boom');
  });

  it('rejects wrong decoded rate, unsupported channel counts and empty output', async () => {
    const run = (decoded: DecodedBufferLike) => asyncCodeOf(() => importOriginalMp3(own(CBR_ID3()), { backend: backendOf(decoded) }));
    expect(await run(buffer(4 * 44_100, 2, 48_000))).toBe('UNSUPPORTED_OUTPUT');
    expect(await run(buffer(4 * 44_100, 6))).toBe('UNSUPPORTED_OUTPUT');
    expect(await run(buffer(0, 2))).toBe('UNSUPPORTED_OUTPUT');
  });

  it('rejects a decode whose length disagrees with the frame estimate, and one above the frame/byte limits', async () => {
    const run = (decoded: DecodedBufferLike) => asyncCodeOf(() => importOriginalMp3(own(CBR_ID3()), { backend: backendOf(decoded) }));
    expect(await run(buffer(30 * 44_100, 2))).toBe('UNSUPPORTED_OUTPUT');
    expect(await run(buffer(MAX_SEPARATION_TOTAL_FRAMES + 1, 1, 44_100, () => 0))).toBe('TOO_LONG');
  });

  it('rejects non-finite samples (NaN and Infinity) in either channel', async () => {
    const frames = 4 * 44_100;
    const nan = buffer(frames, 2);
    nan.getChannelData(1)[1234] = Number.NaN;
    const inf = buffer(frames, 1);
    inf.getChannelData(0)[10] = Number.POSITIVE_INFINITY;
    expect(await asyncCodeOf(() => importOriginalMp3(own(CBR_ID3()), { backend: backendOf(nan) }))).toBe('NON_FINITE');
    expect(await asyncCodeOf(() => importOriginalMp3(own(CBR_ID3()), { backend: backendOf(inf) }))).toBe('NON_FINITE');
  });

  it('cancels immediately and drops a late decode result', async () => {
    let release!: (value: DecodedBufferLike) => void;
    const backend = backendOf(() => new Promise<DecodedBufferLike>((resolve) => { release = resolve; }));
    const abort = new AbortController();
    const pending = importOriginalMp3(own(CBR_ID3()), { backend, signal: abort.signal });
    const outcome = pending.catch((reason) => reason as Mp3ImportError);
    await vi.waitFor(() => expect(backend.decode).toHaveBeenCalled());
    abort.abort();
    expect(await outcome).toMatchObject({ code: 'CANCELLED' });
    release(buffer(4 * 44_100, 2)); // the browser cannot interrupt decodeAudioData: its late result goes nowhere
    await Promise.resolve();
  });

  it('does not start decoding when already cancelled', async () => {
    const backend = backendOf(buffer(100, 2));
    const abort = new AbortController();
    abort.abort();
    expect(await asyncCodeOf(() => importOriginalMp3(own(CBR_ID3()), { backend, signal: abort.signal }))).toBe('CANCELLED');
    expect(backend.decode).not.toHaveBeenCalled();
  });
});
