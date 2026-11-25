import {
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  computeSha256Hex,
  decodeWavToStereoFloat32,
  encodeStereoPcm16Wav,
  type CanonicalStemId,
} from '../separation/demucs-onnx-separator';
import { inspectMp3Stream, type Mp3StemPcm } from '../mp3-stem-decoder';
import { createLameWasmBackend } from './mp3-lame-backend';
import type { Mp3StemDecoderLike, Mp3StemEncoderLike } from './mp3-draft-compression';
import { encodeWavStemToMp3, type EncodedMp3Stem } from './mp3-stem-encoder';

// Test fixtures only (not imported by production code): tonal stems, an in-process encoder that really runs LAME, and a
// "perfect" decoder that returns the original samples after checking the MP3 bytes the same way the Web reader does.

export async function toneStem(id: CanonicalStemId, index: number, frames = 20_000, sampleRate = 44_100) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = 0.3 * Math.sin(i * (0.02 + index * 0.004)) + 0.1 * Math.sin(i * 0.31);
    right[i] = 0.25 * Math.sin(i * (0.017 + index * 0.003)) + 0.1 * Math.sin(i * 0.27);
  }
  const wavBytes = encodeStereoPcm16Wav({ sampleRate, left, right });
  return {
    id, labelPtBr: id, sampleRate, channels: 2 as const, totalFrames: frames, left, right,
    wavBytes, byteLength: wavBytes.byteLength, sha256: await computeSha256Hex(wavBytes), rms: 0.2, peak: 0.4,
  };
}

export async function tonesResult(frames = 20_000, sampleRate = 44_100) {
  return {
    descriptor: HTDEMUCS_6S_ONNX_DESCRIPTOR,
    orderedStems: await Promise.all(CANONICAL_STEM_IDS.map((id, index) => toneStem(id, index, frames, sampleRate))),
  };
}

export interface InProcessEncoder extends Mp3StemEncoderLike {
  calls: number;
  disposed: number;
  readonly samplesBySha: Map<string, { left: Float32Array; right: Float32Array }>;
  dispose(): void;
}

export function createInProcessEncoder(hooks: { beforeEncode?: (call: number) => void | Promise<void>; failOnCall?: number } = {}): InProcessEncoder {
  const enc: InProcessEncoder = {
    calls: 0,
    disposed: 0,
    samplesBySha: new Map(),
    dispose() { enc.disposed++; },
    async encodeStem(job) {
      enc.calls++;
      await hooks.beforeEncode?.(enc.calls);
      if (job.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      if (hooks.failOnCall === enc.calls) throw new Error('falha injetada');
      const wav = new Uint8Array(job.wav.slice(0));
      const pcm = decodeWavToStereoFloat32(wav.buffer as ArrayBuffer, {});
      const out: EncodedMp3Stem = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: job.decoderDelayFrames, signal: job.signal });
      enc.samplesBySha.set(out.sha256, { left: pcm.left, right: pcm.right });
      job.onProgress?.(1);
      return out;
    },
  };
  return enc;
}

export function createLookupDecoder(
  encoder: Pick<InProcessEncoder, 'samplesBySha'>,
  options: { shiftSamples?: number; dropFrames?: number } = {},
): Mp3StemDecoderLike & { decoded: number } {
  const decoder = {
    decoded: 0,
    calibrate: async (sampleRate: number) => ({ shape: 'canonical' as const, sampleRate: sampleRate as 44100, decoderDelayFrames: 529 }),
    decodeStem: async (bytes: Uint8Array, descriptor: { sampleRate: number; frames: number; sha256: string }): Promise<Mp3StemPcm> => {
      decoder.decoded++;
      if ((await computeSha256Hex(bytes)) !== descriptor.sha256) throw new Error('SHA-256 do MP3 diverge do manifesto.');
      inspectMp3Stream(bytes, descriptor.sampleRate);
      const source = encoder.samplesBySha.get(descriptor.sha256);
      if (!source) throw new Error('MP3 desconhecido');
      const n = descriptor.frames - (options.dropFrames ?? 0);
      const shift = options.shiftSamples ?? 0;
      const left = new Float32Array(n);
      for (let i = 0; i < n; i++) left[i] = source.left[Math.min(source.left.length - 1, Math.max(0, i - shift))];
      return { sampleRate: descriptor.sampleRate, left, right: source.right.slice(0, n), shape: 'canonical', trimmedStartFrames: 0, decodedLength: n };
    },
  };
  return decoder;
}

/** Mirrors the backend contract-v2 checks (`mp3StemSchema`) for a manifest stem; returns the violations (empty = valid). */
export function mp3StemShape(stem: {
  codec: string; sampleRate: number; channels: number; bitrateKbps: number; frames: number; durationSeconds: number; sizeBytes: number; sha256: string;
  alignment: { encoderDelayFrames: number; paddingFrames: number; mpegAudioFrames: number; infoFrame: boolean };
}): string[] {
  const problems: string[] = [];
  const a = stem.alignment;
  if (stem.codec !== 'mp3_cbr256') problems.push('codec');
  if (![44_100, 48_000].includes(stem.sampleRate)) problems.push('sampleRate');
  if (stem.channels !== 2 || stem.bitrateKbps !== 256 || a.infoFrame !== true) problems.push('format');
  if (!(stem.frames > 0) || stem.frames > stem.sampleRate * 300) problems.push('frames');
  if (Math.abs(stem.durationSeconds - stem.frames / stem.sampleRate) > 1e-8) problems.push('duration');
  if (!/^[a-f0-9]{64}$/.test(stem.sha256)) problems.push('sha256');
  if (a.encoderDelayFrames > 4608 || a.paddingFrames > 4608) problems.push('alignment bounds');
  if (a.encoderDelayFrames + stem.frames + a.paddingFrames !== a.mpegAudioFrames * 1152) problems.push('invariant');
  const exact = (144 * 256_000) / stem.sampleRate;
  const min = Math.floor(exact);
  const max = Number.isInteger(exact) ? min : min + 1;
  if (stem.sizeBytes < (a.mpegAudioFrames + 1) * min || stem.sizeBytes > (a.mpegAudioFrames + 1) * max) problems.push('size bounds');
  return problems;
}