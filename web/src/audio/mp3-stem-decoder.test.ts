import { describe, expect, it } from 'vitest';
import { CANONICAL_STEM_IDS, computeSha256Hex, decodeWavToStereoFloat32 } from './separation/demucs-onnx-separator';
import { SixStemWebAudioMixerController, type MixerAudioBufferLike, type MixerAudioContextLike } from './separation/six-stem-mixer';
import { prepareMinistryMixerTracks } from './ministry-audio-files';
import type { MinistryAudioMp3Stem, MinistryAudioPlayback } from './ministry-audio-contract';
import { MP3_CALIBRATION_PROBES, MP3_PROBE_CLICKS_L, MP3_PROBE_CLICKS_R } from './mp3-calibration-probes';
import {
  Mp3DecodeError,
  Mp3StemDecoder,
  inspectMp3Stream,
  possibleOutputShapes,
  type DecodedBufferLike,
  type Mp3DecodeBackend,
  type Mp3OutputShape,
  type Mp3StemDescriptor,
} from './mp3-stem-decoder';

const FRAMES = 6000;
const DELAY = 1105; // encoder 576 + decoder 529 (declared value; the reader never hardcodes it)
const TAG_DELAY = 576;
const CLICKS_L = [...MP3_PROBE_CLICKS_L];
const CLICKS_R = [...MP3_PROBE_CLICKS_R];

/** Structurally valid CBR256 MPEG-1 L3 stream (Info frame with LAME tag + silent frames) tagged with `id`. */
function fakeMp3(sampleRate: 44100 | 48000, mpegAudioFrames: number, tagDelay: number, tagPadding: number, id: number): Uint8Array {
  const len = Math.floor((144 * 256_000) / sampleRate);
  const out = new Uint8Array(len * (mpegAudioFrames + 1));
  for (let f = 0; f <= mpegAudioFrames; f++) {
    const o = f * len;
    out[o] = 0xff; out[o + 1] = 0xfb; out[o + 2] = (13 << 4) | ((sampleRate === 44100 ? 0 : 1) << 2); out[o + 3] = 0;
    if (f === 0) {
      out.set([0x49, 0x6e, 0x66, 0x6f], o + 36); // "Info", flags 0
      const lame = o + 36 + 8;
      out[lame + 21] = tagDelay >> 4; out[lame + 22] = ((tagDelay & 15) << 4) | (tagPadding >> 8); out[lame + 23] = tagPadding & 255;
    } else {
      out[o + 100] = id; // payload marker
    }
  }
  return out;
}

async function descriptorFor(bytes: Uint8Array, sampleRate: 44100 | 48000, frames: number, delay: number, padding: number, mpeg: number): Promise<Mp3StemDescriptor> {
  return { sampleRate, frames, sizeBytes: bytes.byteLength, sha256: await computeSha256Hex(bytes), alignment: { encoderDelayFrames: delay, paddingFrames: padding, mpegAudioFrames: mpeg, infoFrame: true } };
}

/** Canonical ground truth: low noise plus a stem-specific tone, clicks L(+)/R(-). */
function truth(id: number, frames = FRAMES): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = 0.02 * Math.sin(i * 0.01 * (id + 1)); right[i] = 0.02 * Math.cos(i * 0.013 * (id + 1)); }
  for (const c of CLICKS_L) left[c] = 0.9;
  for (const c of CLICKS_R) right[c] = -0.9;
  return { left, right };
}

interface Emulation {
  shape: Mp3OutputShape;
  /** Optional faults applied to every decode. */
  shift?: number; swap?: boolean; sampleRate?: number; channels?: number; extraFrames?: number; nan?: boolean;
}

/** Emulates a browser decoder: shapes the canonical truth into the raw/trimmed/canonical output. */
function emulatedBackend(shapeFor: (bytes: Uint8Array, isProbe: boolean) => Emulation, delayFor: (isProbe: boolean) => { delay: number; padding: number }) {
  const calls: Array<{ length: number; sampleRate: number }> = [];
  const backend: Mp3DecodeBackend = {
    async decode(buffer, sampleRate) {
      const bytes = new Uint8Array(buffer);
      calls.push({ length: bytes.length, sampleRate });
      const probe = MP3_CALIBRATION_PROBES[sampleRate as 44100 | 48000];
      const isProbe = Buffer.from(bytes).toString('base64') === probe.base64;
      const id = isProbe ? 0 : bytes[Math.floor((144 * 256_000) / sampleRate) + 100];
      const emu = shapeFor(bytes, isProbe);
      const { delay, padding } = delayFor(isProbe);
      const t = truth(id);
      const total = emu.shape === 'canonical' ? FRAMES : emu.shape === 'start-trimmed' ? FRAMES + padding : delay + FRAMES + padding;
      const lead = emu.shape === 'raw' ? delay : 0;
      const l = new Float32Array(total + (emu.extraFrames ?? 0)).fill(0.77);
      const r = new Float32Array(total + (emu.extraFrames ?? 0)).fill(-0.77);
      for (let i = 0; i < FRAMES; i++) {
        const j = lead + (emu.shift ?? 0) + i;
        if (j >= 0 && j < l.length) { l[j] = t.left[i]; r[j] = t.right[i]; }
      }
      if (emu.nan) l[lead + 10] = Number.NaN;
      const channels = [emu.swap ? r : l, emu.swap ? l : r];
      const result: DecodedBufferLike = {
        sampleRate: emu.sampleRate ?? sampleRate, numberOfChannels: emu.channels ?? 2, length: l.length,
        getChannelData: (c) => channels[c],
      };
      return result;
    },
  };
  return { backend, calls };
}

const probeDelay = (sr: 44100 | 48000) => ({ delay: MP3_CALIBRATION_PROBES[sr].alignment.encoderDelayFrames, padding: MP3_CALIBRATION_PROBES[sr].alignment.paddingFrames });
const MPEG = 7;
const PADDING = MPEG * 1152 - DELAY - FRAMES; // 959

function pairedBackend(sr: 44100 | 48000, emu: Emulation | ((isProbe: boolean) => Emulation)) {
  return emulatedBackend((_b, isProbe) => (typeof emu === 'function' ? emu(isProbe) : emu), (isProbe) => (isProbe ? probeDelay(sr) : { delay: DELAY, padding: PADDING }));
}

describe('MP3 stem decoder (M22-C.5B, experimental)', () => {
  it('declares consistent stem alignment numbers for the tests', () => {
    expect(DELAY + FRAMES + PADDING).toBe(MPEG * 1152);
    for (const sr of [44100, 48000] as const) {
      const a = MP3_CALIBRATION_PROBES[sr].alignment;
      expect(a.encoderDelayFrames + MP3_CALIBRATION_PROBES[sr].frames + a.paddingFrames).toBe(a.mpegAudioFrames * 1152);
      expect(possibleOutputShapes(FRAMES, FRAMES, a)).toContain('canonical');
    }
  });

  it('embedded probes match their recorded SHA-256 and are real, structurally valid streams', async () => {
    for (const sr of [44100, 48000] as const) {
      const probe = MP3_CALIBRATION_PROBES[sr];
      const bytes = Uint8Array.from(atob(probe.base64), (c) => c.charCodeAt(0));
      expect(await computeSha256Hex(bytes)).toBe(probe.sha256);
      const info = inspectMp3Stream(bytes, sr);
      expect(info.mpegAudioFrames).toBe(probe.alignment.mpegAudioFrames);
      expect(info.tagDelayFrames + info.tagPaddingFrames).toBe(probe.alignment.encoderDelayFrames + probe.alignment.paddingFrames);
    }
  });

  describe.each([44100, 48000] as const)('shapes at %i Hz', (sr) => {
    it.each(['canonical', 'start-trimmed', 'raw'] as const)('normalizes a %s decoder to exactly the canonical frames, trimming the delay at most once', async (shape) => {
      const { backend } = pairedBackend(sr, { shape });
      const decoder = new Mp3StemDecoder({ backend });
      const bytes = fakeMp3(sr, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 3);
      const pcm = await decoder.decodeStem(bytes, await descriptorFor(bytes, sr, FRAMES, DELAY, PADDING, MPEG));
      const expected = truth(3);
      expect(pcm.shape).toBe(shape);
      expect(pcm.trimmedStartFrames).toBe(shape === 'raw' ? DELAY : 0);
      expect(pcm.left.length).toBe(FRAMES);
      expect(pcm.right.length).toBe(FRAMES);
      expect(Array.from(pcm.left)).toEqual(Array.from(expected.left));
      expect(Array.from(pcm.right)).toEqual(Array.from(expected.right));
      // clicks at the first and last canonical frames, both channels, exact
      expect(pcm.left[0]).toBeCloseTo(0.9); expect(pcm.left[FRAMES - 1]).toBeCloseTo(0.9);
      expect(pcm.right[5]).toBeCloseTo(-0.9); expect(pcm.right[FRAMES - 2]).toBeCloseTo(-0.9);
      expect(pcm.left.every((v) => v !== 0.77) && pcm.right.every((v) => v !== -0.77)).toBe(true);
    });
  });

  it('rejects a stem whose output shape differs from the calibrated one', async () => {
    const { backend } = pairedBackend(44100, (isProbe) => ({ shape: isProbe ? 'canonical' : 'raw' }));
    const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 1);
    await expect(new Mp3StemDecoder({ backend }).decodeStem(bytes, await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG)))
      .rejects.toMatchObject({ code: 'SHAPE_MISMATCH' });
  });

  it.each([
    ['one frame late', { shape: 'canonical', shift: 1 }],
    ['one frame early', { shape: 'raw', shift: -1 }],
    ['channels swapped', { shape: 'canonical', swap: true }],
  ] as const)('calibration rejects a decoder that is %s (length alone is not proof of alignment)', async (_name, emu) => {
    const { backend } = pairedBackend(44100, emu as Emulation);
    const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 1);
    const decoder = new Mp3StemDecoder({ backend });
    await expect(decoder.decodeStem(bytes, await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG))).rejects.toMatchObject({ code: 'CALIBRATION_FAILED' });
  });

  it.each([
    ['unknown length', { shape: 'canonical', extraFrames: 3 }, 'UNSUPPORTED_OUTPUT'],
    ['other sample rate (resampled)', { shape: 'canonical', sampleRate: 48000 }, 'UNSUPPORTED_OUTPUT'],
    ['mono output', { shape: 'canonical', channels: 1 }, 'UNSUPPORTED_OUTPUT'],
    ['non-finite samples', { shape: 'canonical', nan: true }, 'NON_FINITE'],
  ] as const)('rejects %s without cutting heuristically', async (_name, emu, code) => {
    // The fault hits only the stem (the probe decodes cleanly), so the stem-level check is what must reject.
    const { backend } = pairedBackend(44100, (isProbe) => (isProbe ? { shape: 'canonical' } : (emu as Emulation)));
    const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 1);
    await expect(new Mp3StemDecoder({ backend }).decodeStem(bytes, await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG)))
      .rejects.toMatchObject({ code });
    // ...and the same faults on the probe are caught by calibration instead
    const probeFault = pairedBackend(44100, emu as Emulation).backend;
    await expect(new Mp3StemDecoder({ backend: probeFault }).decodeStem(bytes, await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG)))
      .rejects.toBeInstanceOf(Mp3DecodeError);
  });

  describe('bytes are verified before any decode', () => {
    const mk = async () => {
      const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 2);
      return { bytes, desc: await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG) };
    };
    it.each([
      ['sha256', (d: Mp3StemDescriptor) => ({ ...d, sha256: 'a'.repeat(64) }), 'BYTES_MISMATCH'],
      ['size', (d: Mp3StemDescriptor) => ({ ...d, sizeBytes: d.sizeBytes + 1 }), 'BYTES_MISMATCH'],
      ['frame count vs MPEG frames', (d: Mp3StemDescriptor) => ({ ...d, alignment: { ...d.alignment, mpegAudioFrames: 8, paddingFrames: d.alignment.paddingFrames + 1152 } }), 'BYTES_MISMATCH'],
      ['tag delay+padding vs declared', (d: Mp3StemDescriptor) => ({ ...d, frames: d.frames + 1, alignment: { ...d.alignment, paddingFrames: d.alignment.paddingFrames - 1 } }), 'BYTES_MISMATCH'],
      ['alignment invariant', (d: Mp3StemDescriptor) => ({ ...d, alignment: { ...d.alignment, paddingFrames: d.alignment.paddingFrames + 1 } }), 'INVALID_DESCRIPTOR'],
      ['sample rate', (d: Mp3StemDescriptor) => ({ ...d, sampleRate: 32000 }), 'INVALID_DESCRIPTOR'],
      ['over 300 s', (d: Mp3StemDescriptor) => ({ ...d, frames: 44100 * 300 + 1 }), 'INVALID_DESCRIPTOR'],
      ['info frame false', (d: Mp3StemDescriptor) => ({ ...d, alignment: { ...d.alignment, infoFrame: false } }), 'INVALID_DESCRIPTOR'],
    ])('%s mismatch never reaches decodeAudioData', async (_n, mutate, code) => {
      const { backend, calls } = pairedBackend(44100, { shape: 'canonical' });
      const { bytes, desc } = await mk();
      await expect(new Mp3StemDecoder({ backend }).decodeStem(bytes, mutate(desc))).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(0);
    });

    it('rejects ID3 tags, trailing bytes, wrong bitrate, missing Info frame', async () => {
      const { bytes, desc } = await mk();
      const variants: Array<[string, Uint8Array]> = [];
      const id3 = bytes.slice(); id3.set([0x49, 0x44, 0x33], 0); variants.push(['id3', id3]);
      const trailing = new Uint8Array(bytes.length + 5); trailing.set(bytes); variants.push(['trailing', trailing]);
      const br = bytes.slice(); br[2] = (9 << 4); variants.push(['bitrate', br]);
      const noInfo = bytes.slice(); noInfo.set([0x58, 0x58, 0x58, 0x58], 36); variants.push(['noinfo', noInfo]);
      for (const [name, v] of variants) {
        const { backend, calls } = pairedBackend(44100, { shape: 'canonical' });
        const d = { ...desc, sizeBytes: v.length, sha256: await computeSha256Hex(v) };
        await expect(new Mp3StemDecoder({ backend }).decodeStem(v, d), name).rejects.toBeInstanceOf(Mp3DecodeError);
        expect(calls, name).toHaveLength(0);
      }
    });
  });

  it('keeps caller bytes intact, surfaces decode failures, retries calibration afterwards and honors abort', async () => {
    const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 4);
    const desc = await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG);
    const before = bytes.slice();
    const good = pairedBackend(44100, { shape: 'canonical' }).backend;
    let fail = true;
    const backend: Mp3DecodeBackend = { decode: (b, sr) => (fail ? Promise.reject(new Error('EncodingError')) : good.decode(b, sr)) };
    const decoder = new Mp3StemDecoder({ backend });
    await expect(decoder.decodeStem(bytes, desc)).rejects.toMatchObject({ code: 'DECODE_FAILED' });
    expect(bytes).toEqual(before);
    fail = false;
    expect((await decoder.decodeStem(bytes, desc)).left.length).toBe(FRAMES);
    const controller = new AbortController();
    controller.abort();
    await expect(decoder.decodeStem(bytes, desc, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('calibrates once per sample rate and reuses the observation', async () => {
    const { backend, calls } = pairedBackend(44100, { shape: 'canonical' });
    const decoder = new Mp3StemDecoder({ backend });
    const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 5);
    const desc = await descriptorFor(bytes, 44100, FRAMES, DELAY, PADDING, MPEG);
    await decoder.decodeStem(bytes, desc);
    await decoder.decodeStem(bytes, desc);
    expect(calls).toHaveLength(3); // 1 probe + 2 stems
  });

  it.each(['raw', 'canonical', 'start-trimmed'] as const)('rejects a delay/padding split shifted by k frames even though both sums still hold (%s decoder)', async (shape) => {
    const { backend, calls } = pairedBackend(44100, { shape });
    const k = 7;
    const bytes = fakeMp3(44100, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 1);
    const desc = await descriptorFor(bytes, 44100, FRAMES, DELAY + k, PADDING - k, MPEG);
    await expect(new Mp3StemDecoder({ backend }).decodeStem(bytes, desc)).rejects.toMatchObject({ code: 'BYTES_MISMATCH' });
    expect(calls.every((c) => c.length !== bytes.length)).toBe(true); // the stem never reached decodeAudioData
  });

  it('is unavailable without a browser backend', () => {
    expect(() => new Mp3StemDecoder({ backend: null })).toThrowError(/indisponível|unavailable/i);
  });

  describe('experimental integration with the unchanged WAV mixer', () => {
    const sr = 44100;
    const playback = (descs: Map<string, Mp3StemDescriptor>): MinistryAudioPlayback => ({
      manifest: {
        schemaVersion: 2, recordingId: 'rec', recordingVersion: 'v', model: { id: 'm', version: '1' },
        stems: CANONICAL_STEM_IDS.map((id) => {
          const d = descs.get(id)!;
          return { id, codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256, durationSeconds: FRAMES / sr, frames: FRAMES, sizeBytes: d.sizeBytes, sha256: d.sha256,
            alignment: { encoderDelayFrames: DELAY, paddingFrames: PADDING, mpegAudioFrames: MPEG, infoFrame: true } } as MinistryAudioMp3Stem;
        }),
      },
      tracks: CANONICAL_STEM_IDS.map((id) => ({ id, url: `u/${id}` })), expiresAt: 1,
    });

    async function setup(shape: Mp3OutputShape) {
      const bytesById = new Map<string, Uint8Array>();
      const descs = new Map<string, Mp3StemDescriptor>();
      for (const [i, id] of CANONICAL_STEM_IDS.entries()) {
        const b = fakeMp3(sr, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, i);
        bytesById.set(id, b); descs.set(id, await descriptorFor(b, sr, FRAMES, DELAY, PADDING, MPEG));
      }
      // stems must hash differently: the id byte already differs per stem
      const { backend } = pairedBackend(sr, { shape });
      return { bytesById, descs, decoder: new Mp3StemDecoder({ backend }) };
    }

    it('without an injected decoder (production call sites) MP3 manifests are still rejected', async () => {
      const { descs } = await setup('canonical');
      expect(() => prepareMinistryMixerTracks('rec', playback(descs), async () => new Uint8Array())).toThrow('Dados de reprodução inválidos.');
    });

    it.each(['canonical', 'start-trimmed', 'raw'] as const)('plays six aligned MP3 tracks through the existing mixer (%s decoder), including seek', async (shape) => {
      const { bytesById, descs, decoder } = await setup(shape);
      const prepared = prepareMinistryMixerTracks('rec', playback(descs), async (stem) => bytesById.get(stem.id)!, { mp3Decoder: decoder });
      expect(prepared).toHaveLength(6);

      const buffers: MixerAudioBufferLike[] = [];
      const sources: Array<{ startCalls: Array<{ when?: number; offset?: number }> }> = [];
      const ctx: MixerAudioContextLike = {
        currentTime: 1, sampleRate: sr, state: 'running', destination: {},
        createGain: () => ({ gain: { value: 1 }, connect: (d: unknown) => d, disconnect: () => {} }),
        createBuffer: (n: number, length: number, rate: number) => {
          const data = Array.from({ length: n }, () => new Float32Array(length));
          const b = { numberOfChannels: n, length, sampleRate: rate, getChannelData: (c: number) => data[c] } as MixerAudioBufferLike;
          buffers.push(b); return b;
        },
        createBufferSource: () => {
          const s = { buffer: null, onended: null, startCalls: [] as Array<{ when?: number; offset?: number }>, connect: (d: unknown) => d, disconnect: () => {}, start(when?: number, offset?: number) { this.startCalls.push({ when, offset }); }, stop: () => {} };
          sources.push(s); return s as never;
        },
        resume: async () => {}, close: async () => {},
      } as unknown as MixerAudioContextLike;
      const mixer = new SixStemWebAudioMixerController({ createAudioContext: () => ctx, yieldToMainThread: async () => {}, enableWavDownloads: false });
      const snapshot = await mixer.loadStems(prepared);
      expect(snapshot.state).toBe('ready');
      expect(snapshot.sampleRate).toBe(sr);
      expect(buffers).toHaveLength(6);
      const q = (v: number) => Math.round(v * 32767) / 32767;
      for (const b of buffers) {
        const l = b.getChannelData(0); const r = b.getChannelData(1);
        expect(b.length).toBe(FRAMES);
        for (const c of CLICKS_L) expect(l[c]).toBeCloseTo(q(0.9), 3);
        for (const c of CLICKS_R) expect(r[c]).toBeCloseTo(-q(0.9), 3);
        // click frames carry the largest magnitude in their neighbourhood, so no frame offset was applied
        expect(Math.abs(l[0])).toBeGreaterThan(Math.abs(l[1]) * 5);
      }
      await mixer.play();
      mixer.seekFrame(FRAMES - 100);
      const last = sources.slice(-6);
      for (const s of last) expect(s.startCalls.at(-1)!.offset).toBeCloseTo((FRAMES - 100) / sr, 6);
      mixer.dispose();
    });

    it('a stem whose bytes were tampered after the manifest is rejected before decoding', async () => {
      const { bytesById, descs, decoder } = await setup('canonical');
      const prepared = prepareMinistryMixerTracks('rec', playback(descs), async (stem) => {
        const b = bytesById.get(stem.id)!.slice(); b[200] ^= 1; return b;
      }, { mp3Decoder: decoder });
      await expect(prepared[0].wavBytes()).rejects.toMatchObject({ code: 'BYTES_MISMATCH' });
    });

    it('rejects stems with divergent alignment across the six tracks', async () => {
      const { descs, decoder } = await setup('canonical');
      const pb = playback(descs);
      (pb.manifest.stems[2] as MinistryAudioMp3Stem).alignment = { encoderDelayFrames: DELAY + 1, paddingFrames: PADDING - 1, mpegAudioFrames: MPEG, infoFrame: true };
      expect(() => prepareMinistryMixerTracks('rec', pb, async () => new Uint8Array(), { mp3Decoder: decoder })).toThrow('Dados de reprodução inválidos.');
    });
  });

  it('round-trips through WAV without moving any click (16-bit quantization only)', async () => {
    const { backend } = pairedBackend(48000, { shape: 'raw' });
    const bytes = fakeMp3(48000, MPEG, TAG_DELAY, DELAY + PADDING - TAG_DELAY, 1);
    const pcm = await new Mp3StemDecoder({ backend }).decodeStem(bytes, await descriptorFor(bytes, 48000, FRAMES, DELAY, PADDING, MPEG));
    const { encodeStereoPcm16Wav } = await import('./separation/demucs-onnx-separator');
    const wav = decodeWavToStereoFloat32(encodeStereoPcm16Wav(pcm).buffer as ArrayBuffer, { expectedSampleRate: 48000, maxFrames: FRAMES });
    expect(wav.left.length).toBe(FRAMES);
    for (const c of CLICKS_L) expect(wav.left[c]).toBeGreaterThan(0.89);
  });
});
