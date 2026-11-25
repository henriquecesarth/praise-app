import { beforeAll, describe, expect, it } from 'vitest';
import { createSeparationDraft } from '../local-separation-draft';
import { polyfillBlobArrayBuffer } from '../local-separation-fixtures';
import { parseStrictWavDescriptor } from '../separation/demucs-onnx-separator';
import { Mp3CompressionError, compressSeparationDraft, measureLag, type CompressedStemEntry, type CompressionProgress } from './mp3-draft-compression';
import { createInProcessEncoder, createLookupDecoder, mp3StemShape, tonesResult } from './mp3-test-support';

// M22-S2: compression of a separation draft with the REAL LAME build and a perfect decoder (the real browser decoder is
// exercised by the browser benchmark, not by jsdom).

beforeAll(polyfillBlobArrayBuffer);

async function setup(frames = 20_000) {
  const draft = await createSeparationDraft(await tonesResult(frames));
  const encoder = createInProcessEncoder();
  return { draft, encoder, decoder: createLookupDecoder(encoder) };
}

describe('compressSeparationDraft', () => {
  it('compresses the six stems, verifies them and builds a valid MP3 v2 manifest without touching the WAV draft', async () => {
    const { draft, encoder, decoder } = await setup();
    const wavBefore = await Promise.all(Object.values(draft.files()).map((f) => f.arrayBuffer().then((b) => b.byteLength)));
    const events: CompressionProgress[] = [];
    const result = await compressSeparationDraft({ draft, encoder, decoder, onProgress: (e) => events.push(e) });

    expect(encoder.calls).toBe(6);
    expect(decoder.decoded).toBe(6);
    const stems = result.manifestStems();
    expect(stems.map((s) => s.id)).toEqual(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']);
    for (const stem of stems) {
      expect(mp3StemShape(stem)).toEqual([]); // contract v2 invariants
      expect(stem.frames).toBe(20_000);
      expect(stem.alignment.encoderDelayFrames - 576).toBe(result.decoderDelayFrames);
    }
    expect(new Set(stems.map((s) => s.alignment.mpegAudioFrames)).size).toBe(1);
    expect(new Set(stems.map((s) => s.sizeBytes)).size).toBeLessThanOrEqual(2);
    const files = result.files();
    for (const stem of stems) {
      const file = files[stem.id];
      expect(file.type).toBe('audio/mpeg');
      expect(file.size).toBe(stem.sizeBytes);
    }
    expect(result.mp3BytesTotal).toBe(stems.reduce((s, x) => s + x.sizeBytes, 0));
    expect(result.savingsRatio).toBeCloseTo(1 - result.mp3BytesTotal / result.wavBytesTotal, 10);
    expect(result.savingsRatio).toBeGreaterThan(0.5); // tiny files: the fixed Info frame weighs more than at 300 s

    // Progress: stem order, never going backwards, ends at 100%.
    expect(new Set(events.map((e) => e.stemId)).size).toBe(6);
    for (let i = 1; i < events.length; i++) expect(events[i].overall).toBeGreaterThanOrEqual(events[i - 1].overall - 1e-9);
    expect(events.at(-1)?.overall).toBe(1);

    // The WAV draft is untouched and still usable.
    expect(draft.disposed).toBe(false);
    const wavAfter = await Promise.all(Object.values(draft.files()).map((f) => f.arrayBuffer().then((b) => b.byteLength)));
    expect(wavAfter).toEqual(wavBefore);
    result.dispose();
    expect(result.disposed).toBe(true);
    expect(() => result.files()).toThrow(Mp3CompressionError);
    expect(draft.disposed).toBe(false);
  });

  it('gives the mixer on-demand WAV loaders with the exact WAV size and no retained decode', async () => {
    const { draft, encoder, decoder } = await setup();
    const result = await compressSeparationDraft({ draft, encoder, decoder });
    const decodedBefore = decoder.decoded;
    const inputs = result.mixerInputs();
    expect(inputs).toHaveLength(6);
    expect(decoder.decoded).toBe(decodedBefore); // nothing decoded until the mixer asks
    const first = inputs[0];
    const wav = await (first.wavBytes as () => Promise<Uint8Array>)();
    expect(decoder.decoded).toBe(decodedBefore + 1);
    expect(wav.byteLength).toBe(first.byteLength);
    expect(parseStrictWavDescriptor(wav)).toMatchObject({ sampleRate: 44_100, totalFrames: 20_000, channels: 2, bitsPerSample: 16 });
    result.dispose();
    await expect((first.wavBytes as () => Promise<Uint8Array>)()).rejects.toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5])('cancelling during stem %i stops at once, keeps the WAV draft and the finished stems', async (index) => {
    const draft = await createSeparationDraft(await tonesResult());
    const abort = new AbortController();
    const encoder = createInProcessEncoder({ beforeEncode: (call) => { if (call === index + 1) abort.abort(); } });
    const completed = new Map<string, CompressedStemEntry>();
    await expect(compressSeparationDraft({
      draft, encoder, decoder: createLookupDecoder(encoder), signal: abort.signal, completed: completed as never,
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(encoder.calls).toBe(index + 1);
    expect(completed.size).toBe(index);
    expect(draft.disposed).toBe(false);
    expect(Object.keys(draft.files())).toHaveLength(6);
  });

  it('a failure on one stem keeps the finished ones; a retry only encodes what is missing', async () => {
    const draft = await createSeparationDraft(await tonesResult());
    const completed = new Map<string, CompressedStemEntry>();
    const first = createInProcessEncoder({ failOnCall: 3 });
    const failure = await compressSeparationDraft({ draft, encoder: first, decoder: createLookupDecoder(first), completed: completed as never }).catch((e) => e);
    expect(failure).toBeInstanceOf(Mp3CompressionError);
    expect(failure).toMatchObject({ code: 'FAILED', stemId: 'bass' });
    expect(failure.message).toContain('Baixo');
    expect(completed.size).toBe(2);

    const retry = createInProcessEncoder();
    const decoder = createLookupDecoder(retry);
    // The retry's decoder must know the first two stems' samples too (they were encoded by the first encoder).
    for (const [sha, samples] of first.samplesBySha) retry.samplesBySha.set(sha, samples);
    const result = await compressSeparationDraft({ draft, encoder: retry, decoder, completed: completed as never });
    expect(retry.calls).toBe(4);
    expect(result.manifestStems()).toHaveLength(6);
  });

  it('rejects a stem whose MP3 is shifted against the WAV, or has the wrong length', async () => {
    for (const options of [{ shiftSamples: 2 }, { dropFrames: 1 }]) {
      const draft = await createSeparationDraft(await tonesResult());
      const encoder = createInProcessEncoder();
      const error = await compressSeparationDraft({ draft, encoder, decoder: createLookupDecoder(encoder, options) }).catch((e) => e);
      expect(error).toMatchObject({ code: 'INCONSISTENT', stemId: 'vocals' });
      expect(encoder.calls).toBe(1); // stops at the first bad stem
    }
  });

  it('rejects when the encoder reports another duration or rate than the draft', async () => {
    const draft = await createSeparationDraft(await tonesResult());
    const real = createInProcessEncoder();
    const lying = { encodeStem: async (job: Parameters<typeof real.encodeStem>[0]) => ({ ...(await real.encodeStem(job)), frames: 19_999 }) };
    await expect(compressSeparationDraft({ draft, encoder: lying, decoder: createLookupDecoder(real) })).rejects.toMatchObject({ code: 'INCONSISTENT' });
  });

  it('refuses a disposed draft, a draft disposed in the middle, and an unsupported rate', async () => {
    const gone = await createSeparationDraft(await tonesResult());
    gone.dispose();
    const e1 = createInProcessEncoder();
    await expect(compressSeparationDraft({ draft: gone, encoder: e1, decoder: createLookupDecoder(e1) })).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
    expect(e1.calls).toBe(0);

    const draft = await createSeparationDraft(await tonesResult());
    const e2 = createInProcessEncoder({ beforeEncode: (call) => { if (call === 2) draft.dispose(); } });
    await expect(compressSeparationDraft({ draft, encoder: e2, decoder: createLookupDecoder(e2) })).rejects.toMatchObject({ code: 'INVALID_DRAFT' });

    const odd = await createSeparationDraft(await tonesResult(20_000, 32_000));
    const e3 = createInProcessEncoder();
    await expect(compressSeparationDraft({ draft: odd, encoder: e3, decoder: createLookupDecoder(e3) })).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
    expect(e3.calls).toBe(0);
  });

  it('fails clearly when the browser cannot calibrate the MP3 decoder, before encoding anything', async () => {
    const { draft, encoder } = await setup();
    const decoder = { calibrate: async () => { throw new Error('sem decodificador'); }, decodeStem: async () => { throw new Error('x'); } };
    await expect(compressSeparationDraft({ draft, encoder, decoder })).rejects.toMatchObject({ code: 'FAILED' });
    expect(encoder.calls).toBe(0);
  });
});

describe('measureLag', () => {
  const wavOf = (samples: Float32Array) => {
    const out = new Uint8Array(44 + samples.length * 4);
    const view = new DataView(out.buffer);
    for (let i = 0; i < samples.length; i++) { view.setInt16(44 + i * 4, Math.round(samples[i] * 32767), true); }
    return out;
  };
  const tone = Float32Array.from({ length: 4000 }, (_, i) => 0.4 * Math.sin(i * 0.05) + 0.2 * Math.sin(i * 0.9));

  it('is 0 for an aligned copy and finds a shift in either direction', () => {
    const wav = wavOf(tone);
    expect(measureLag(wav, 44, 4000, tone, 0)).toBe(0);
    const late = Float32Array.from(tone, (_, i) => tone[Math.max(0, i - 2)]);
    const early = Float32Array.from(tone, (_, i) => tone[Math.min(3999, i + 3)]);
    expect(Math.abs(measureLag(wav, 44, 4000, late, 0)!)).toBe(2);
    expect(Math.abs(measureLag(wav, 44, 4000, early, 0)!)).toBe(3);
  });

  it('returns null for a silent window or one that is too short', () => {
    expect(measureLag(wavOf(new Float32Array(4000)), 44, 4000, new Float32Array(4000), 0)).toBeNull();
    expect(measureLag(wavOf(tone), 44, 4000, tone, 3995)).toBeNull();
  });
});
