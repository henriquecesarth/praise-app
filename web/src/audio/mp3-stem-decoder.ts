// Experimental offline MP3 stem reader (M22-C.5B). NOT wired to remote manifests or publication.
//
// Policy (see docs/architecture/m22c5b-mp3-reader.md):
//  * Bytes are SHA-256/size verified BEFORE decoding.
//  * Decoding uses the browser's decodeAudioData on a context at the stem's own sample rate (44.1/48 kHz);
//    a result at any other rate is rejected, never resampled.
//  * Browsers differ on whether they trim encoder delay/padding. Instead of assuming, the decoder is
//    CALIBRATED once per sample rate on a tiny embedded probe with full-scale clicks at known frames, and
//    the observed output shape is recorded. A stem is then accepted only if its decoded length matches the
//    SAME shape and the probe clicks landed on their exact canonical frames in both channels.
//  * The start delay is removed exactly once, and only when the observed shape says it is still present.
//  * Anything not understood is rejected (fail closed); there are no heuristic trims.

import { computeSha256Hex } from './separation/demucs-onnx-separator';
import { MP3_CALIBRATION_PROBES, MP3_PROBE_CLICKS_L, MP3_PROBE_CLICKS_R } from './mp3-calibration-probes';

export const MP3_SAMPLES_PER_MPEG_FRAME = 1152;
export const MP3_MAX_ALIGNMENT_FRAMES = 4 * MP3_SAMPLES_PER_MPEG_FRAME;
export const MP3_MAX_SECONDS = 300;
export const MP3_SUPPORTED_SAMPLE_RATES = [44_100, 48_000] as const;
/** Same ceiling as the contract's mp3_cbr256 profile (≈ 300 s + padding at 256 kbps, 44.1 kHz). */
export const MP3_MAX_BYTES = 11_000_000;

export type Mp3SampleRate = (typeof MP3_SUPPORTED_SAMPLE_RATES)[number];

/**
 * How a decoder delivered the stream, relative to the manifest alignment (B = delay + frames + padding):
 *  canonical     length === frames                  decoder removed delay AND padding (Info/LAME-tag aware)
 *  start-trimmed length === frames + padding        decoder removed only the start delay
 *  raw           length === delay + frames + padding nothing removed; the start delay must be dropped here
 */
export type Mp3OutputShape = 'canonical' | 'start-trimmed' | 'raw';

export type Mp3DecodeErrorCode =
  | 'INVALID_DESCRIPTOR' | 'BYTES_MISMATCH' | 'DECODE_FAILED' | 'UNSUPPORTED_OUTPUT'
  | 'NON_FINITE' | 'CALIBRATION_FAILED' | 'SHAPE_MISMATCH' | 'ABORTED' | 'UNAVAILABLE';

export class Mp3DecodeError extends Error {
  readonly code: Mp3DecodeErrorCode;
  constructor(code: Mp3DecodeErrorCode, message: string) {
    super(message);
    this.name = 'Mp3DecodeError';
    this.code = code;
  }
}

export interface Mp3Alignment {
  readonly encoderDelayFrames: number;
  readonly paddingFrames: number;
  readonly mpegAudioFrames: number;
}

export interface Mp3StemDescriptor {
  readonly sampleRate: number;
  readonly frames: number;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly alignment: Mp3Alignment & { readonly infoFrame?: boolean };
}

export interface DecodedBufferLike {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface Mp3DecodeBackend {
  /** Receives a private copy of the bytes (decodeAudioData detaches it). */
  decode(bytes: ArrayBuffer, sampleRate: number): Promise<DecodedBufferLike>;
}

export interface Mp3StemPcm {
  readonly sampleRate: number;
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly shape: Mp3OutputShape;
  readonly trimmedStartFrames: number;
  readonly decodedLength: number;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => {
  decodeAudioData(data: ArrayBuffer, ok?: (b: AudioBuffer) => void, fail?: (e: unknown) => void): Promise<AudioBuffer>;
};

/** Browser backend: OfflineAudioContext (no audio hardware, no autoplay gesture, released by GC). */
export function createBrowserMp3DecodeBackend(): Mp3DecodeBackend | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const Ctor = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctor) return null;
  return {
    decode: (bytes, sampleRate) => new Promise<DecodedBufferLike>((resolve, reject) => {
      try {
        const ctx = new Ctor(2, 1, sampleRate);
        // Promise form plus legacy callbacks (older WebKit); settling twice is harmless.
        const maybe = ctx.decodeAudioData(bytes, resolve, reject);
        if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
      } catch (reason) {
        reject(reason);
      }
    }),
  };
}

export interface Mp3DecoderLimits {
  readonly maxBytes: number;
  readonly maxSeconds: number;
}

interface Calibration {
  readonly shape: Mp3OutputShape;
  readonly sampleRate: Mp3SampleRate;
  /** Declared encoderDelayFrames minus the LAME-tag delay on the probe: the decoder-side delay the contract folds in. */
  readonly decoderDelayFrames: number;
}

/** Every shape consistent with a decoded length (several only when delay or padding is 0). */
export function possibleOutputShapes(length: number, frames: number, a: Mp3Alignment): Mp3OutputShape[] {
  const shapes: Mp3OutputShape[] = [];
  if (length === frames) shapes.push('canonical');
  if (length === frames + a.paddingFrames) shapes.push('start-trimmed');
  if (length === a.encoderDelayFrames + frames + a.paddingFrames) shapes.push('raw');
  return shapes;
}

function validateDescriptor(d: Mp3StemDescriptor, limits: Mp3DecoderLimits): asserts d is Mp3StemDescriptor & { sampleRate: Mp3SampleRate } {
  const a = d.alignment;
  const bad = (why: string): never => { throw new Mp3DecodeError('INVALID_DESCRIPTOR', `Descritor MP3 inválido: ${why}.`); };
  if (!(MP3_SUPPORTED_SAMPLE_RATES as readonly number[]).includes(d.sampleRate)) bad('taxa de amostragem');
  if (!Number.isInteger(d.frames) || d.frames <= 0 || d.frames > d.sampleRate * limits.maxSeconds) bad('frames');
  if (!Number.isInteger(d.sizeBytes) || d.sizeBytes <= 0 || d.sizeBytes > limits.maxBytes) bad('tamanho');
  if (!/^[a-f0-9]{64}$/.test(d.sha256)) bad('sha256');
  if (!a || a.infoFrame === false) bad('alinhamento');
  for (const v of [a.encoderDelayFrames, a.paddingFrames, a.mpegAudioFrames]) if (!Number.isInteger(v) || v < 0) bad('alinhamento');
  if (a.encoderDelayFrames > MP3_MAX_ALIGNMENT_FRAMES || a.paddingFrames > MP3_MAX_ALIGNMENT_FRAMES) bad('alinhamento');
  if (a.encoderDelayFrames + d.frames + a.paddingFrames !== a.mpegAudioFrames * MP3_SAMPLES_PER_MPEG_FRAME) bad('invariante de alinhamento');
}

export interface Mp3StreamInfo {
  /** MPEG audio frames, excluding the Info/Xing frame. */
  readonly mpegAudioFrames: number;
  /** LAME-tag encoder delay / end padding (tag semantics: the decoder's own delay is not included). */
  readonly tagDelayFrames: number;
  readonly tagPaddingFrames: number;
}

const MPEG1_L3_SAMPLE_RATES = [44_100, 48_000, 32_000];

/**
 * Walks every frame header: MPEG-1 Layer III, 256 kbps CBR, the declared sample rate, stereo, no trailing
 * bytes, first frame is a Xing/Info frame carrying a LAME tag. Returns the tag's delay/padding so callers can
 * cross-check the manifest without hardcoding any decoder delay.
 */
export function inspectMp3Stream(bytes: Uint8Array, sampleRate: number): Mp3StreamInfo {
  const bad = (why: string): never => { throw new Mp3DecodeError('BYTES_MISMATCH', `MP3 inválido: ${why}.`); };
  const frameLen = Math.floor((144 * 256_000) / sampleRate);
  let p = 0;
  let frames = 0;
  let delay = -1;
  let padding = -1;
  while (p < bytes.length) {
    if (p + 4 > bytes.length || bytes[p] !== 0xff || (bytes[p + 1] & 0xfe) !== 0xfa /* sync, MPEG-1, Layer III */) bad(`cabeçalho de frame em ${p}`);
    const bitrateIndex = bytes[p + 2] >> 4;
    const rate = MPEG1_L3_SAMPLE_RATES[(bytes[p + 2] >> 2) & 3];
    const padBytes = (bytes[p + 2] >> 1) & 1;
    const mono = (bytes[p + 3] >> 6) === 3;
    if (bitrateIndex !== 13 || rate !== sampleRate || mono) bad(`frame ${frames} não é 256 kbps estéreo a ${sampleRate} Hz`);
    const length = frameLen + padBytes;
    if (p + length > bytes.length) bad('frame truncado');
    if (frames === 0) {
      const tag = p + 4 + ((bytes[p + 1] & 1) === 0 ? 2 : 0) + 32;
      const name = String.fromCharCode(...bytes.subarray(tag, tag + 4));
      if (name !== 'Info' && name !== 'Xing') bad('primeiro frame não é Info/Xing');
      const flags = bytes[tag + 7];
      const lame = tag + 8 + ((flags & 1) ? 4 : 0) + ((flags & 2) ? 4 : 0) + ((flags & 4) ? 100 : 0) + ((flags & 8) ? 4 : 0);
      if (lame + 24 > p + length) bad('tag LAME ausente');
      delay = (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4);
      padding = ((bytes[lame + 22] & 15) << 8) | bytes[lame + 23];
    }
    frames++;
    p += length;
  }
  if (frames < 2) bad('sem frames de áudio');
  return { mpegAudioFrames: frames - 1, tagDelayFrames: delay, tagPaddingFrames: padding };
}

/** Byte-level facts must agree with the manifest: frame count and (tag delay + padding) == delay + padding. */
function verifyStreamAgainstManifest(bytes: Uint8Array, d: Pick<Mp3StemDescriptor, 'sampleRate' | 'frames'> & { alignment: Mp3Alignment }): Mp3StreamInfo {
  const info = inspectMp3Stream(bytes, d.sampleRate);
  const a = d.alignment;
  if (info.mpegAudioFrames !== a.mpegAudioFrames) {
    throw new Mp3DecodeError('BYTES_MISMATCH', `Frames MPEG do arquivo (${info.mpegAudioFrames}) divergem do manifesto (${a.mpegAudioFrames}).`);
  }
  // The decoder's own delay moves frames between "delay" and "padding" but never changes their sum.
  if (info.tagDelayFrames + info.tagPaddingFrames !== a.encoderDelayFrames + a.paddingFrames) {
    throw new Mp3DecodeError('BYTES_MISMATCH', 'Tag LAME do arquivo diverge do alinhamento declarado.');
  }
  return info;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function peakIndex(x: Float32Array, center: number, sign: 1 | -1, radius: number): { index: number; value: number } {
  let index = -1;
  let value = 0;
  for (let i = Math.max(0, center - radius); i < Math.min(x.length, center + radius + 1); i++) {
    const v = x[i] * sign;
    if (v > value) { value = v; index = i; }
  }
  return { index, value };
}

export class Mp3StemDecoder {
  private readonly backend: Mp3DecodeBackend;
  private readonly limits: Mp3DecoderLimits;
  private readonly calibrations = new Map<number, Promise<Calibration>>();

  constructor(options: { backend?: Mp3DecodeBackend | null; limits?: Partial<Mp3DecoderLimits> } = {}) {
    const backend = options.backend ?? createBrowserMp3DecodeBackend();
    if (!backend) throw new Mp3DecodeError('UNAVAILABLE', 'Decodificação MP3 indisponível neste navegador.');
    this.backend = backend;
    this.limits = { maxBytes: MP3_MAX_BYTES, maxSeconds: MP3_MAX_SECONDS, ...options.limits };
  }

  /** Observed decoder shape for a sample rate, proven on the embedded click probe. Cached per rate. */
  calibrate(sampleRate: Mp3SampleRate): Promise<Calibration> {
    let pending = this.calibrations.get(sampleRate);
    if (!pending) {
      pending = this.runCalibration(sampleRate);
      // A failed calibration is not cached, so a transient failure can be retried.
      pending.catch(() => { if (this.calibrations.get(sampleRate) === pending) this.calibrations.delete(sampleRate); });
      this.calibrations.set(sampleRate, pending);
    }
    return pending;
  }

  private async runCalibration(sampleRate: Mp3SampleRate): Promise<Calibration> {
    const probe = MP3_CALIBRATION_PROBES[sampleRate];
    const bytes = base64ToBytes(probe.base64);
    if (await computeSha256Hex(bytes) !== probe.sha256) {
      throw new Mp3DecodeError('CALIBRATION_FAILED', 'Sonda de calibração MP3 corrompida.');
    }
    const probeInfo = verifyStreamAgainstManifest(bytes, { sampleRate, frames: probe.frames, alignment: probe.alignment });
    const pcm = await this.decodeCore(bytes, { sampleRate, frames: probe.frames, alignment: probe.alignment }, null);
    const { left, right } = pcm;
    const check = (x: Float32Array, clicks: readonly number[], sign: 1 | -1) => {
      for (const c of clicks) {
        const peak = peakIndex(x, c, sign, 48);
        if (peak.index !== c || peak.value < 0.5) {
          throw new Mp3DecodeError('CALIBRATION_FAILED',
            `Clique de calibração fora do quadro canônico (esperado ${c}, obtido ${peak.index}).`);
        }
      }
    };
    check(left, MP3_PROBE_CLICKS_L, 1);
    check(right, MP3_PROBE_CLICKS_R, -1);
    return { shape: pcm.shape, sampleRate, decoderDelayFrames: probe.alignment.encoderDelayFrames - probeInfo.tagDelayFrames };
  }

  /** Verifies bytes, decodes, normalizes to exactly `frames` canonical frames per channel. */
  async decodeStem(bytes: Uint8Array, descriptor: Mp3StemDescriptor, signal?: AbortSignal): Promise<Mp3StemPcm> {
    validateDescriptor(descriptor, this.limits);
    const throwIfAborted = () => { if (signal?.aborted) throw new Mp3DecodeError('ABORTED', 'Decodificação cancelada.'); };
    throwIfAborted();
    if (bytes.byteLength !== descriptor.sizeBytes) throw new Mp3DecodeError('BYTES_MISMATCH', 'Tamanho do MP3 diverge do manifesto.');
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) throw new Mp3DecodeError('BYTES_MISMATCH', 'MP3 com ID3 não é aceito.');
    if (await computeSha256Hex(bytes) !== descriptor.sha256) throw new Mp3DecodeError('BYTES_MISMATCH', 'SHA-256 do MP3 diverge do manifesto.');
    const info = verifyStreamAgainstManifest(bytes, descriptor);
    throwIfAborted();

    const calibration = await this.calibrate(descriptor.sampleRate as Mp3SampleRate);
    throwIfAborted();
    // The declared start delay is what a raw decoder trims, so it must be the tag delay plus the same
    // decoder-side delay observed on the probe (nothing hardcoded); otherwise a delay/padding split
    // shifted by k frames would keep both sums intact and play k frames off.
    if (descriptor.alignment.encoderDelayFrames - info.tagDelayFrames !== calibration.decoderDelayFrames) {
      throw new Mp3DecodeError('BYTES_MISMATCH', 'Atraso declarado diverge da tag LAME somada ao atraso do decodificador calibrado.');
    }
    const pcm = await this.decodeCore(bytes, descriptor, calibration.shape);
    throwIfAborted();
    return pcm;
  }

  private async decodeCore(bytes: Uint8Array, d: Pick<Mp3StemDescriptor, 'sampleRate' | 'frames'> & { alignment: Mp3Alignment }, expectedShape: Mp3OutputShape | null): Promise<Mp3StemPcm> {
    const a = d.alignment;
    let decoded: DecodedBufferLike;
    try {
      decoded = await this.backend.decode(bytes.slice().buffer as ArrayBuffer, d.sampleRate);
    } catch (reason) {
      throw new Mp3DecodeError('DECODE_FAILED', `Falha ao decodificar MP3: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    if (decoded.sampleRate !== d.sampleRate) {
      throw new Mp3DecodeError('UNSUPPORTED_OUTPUT', `Taxa decodificada ${decoded.sampleRate} Hz difere de ${d.sampleRate} Hz.`);
    }
    if (decoded.numberOfChannels !== 2) {
      throw new Mp3DecodeError('UNSUPPORTED_OUTPUT', `Canais decodificados: ${decoded.numberOfChannels} (esperado 2).`);
    }
    const maxLength = a.mpegAudioFrames * MP3_SAMPLES_PER_MPEG_FRAME;
    if (!Number.isInteger(decoded.length) || decoded.length <= 0 || decoded.length > maxLength) {
      throw new Mp3DecodeError('UNSUPPORTED_OUTPUT', `Comprimento decodificado ${decoded.length} fora do esperado.`);
    }
    const candidates = possibleOutputShapes(decoded.length, d.frames, a);
    if (candidates.length === 0) {
      throw new Mp3DecodeError('UNSUPPORTED_OUTPUT',
        `Comprimento decodificado ${decoded.length} não corresponde a nenhuma forma conhecida (frames ${d.frames}, atraso ${a.encoderDelayFrames}, corte ${a.paddingFrames}).`);
    }
    if (expectedShape && !candidates.includes(expectedShape)) {
      throw new Mp3DecodeError('SHAPE_MISMATCH', `Forma de saída "${candidates.join('/')}" difere da calibrada "${expectedShape}".`);
    }
    const shape = expectedShape ?? candidates[0];
    // The start delay is dropped only when the decoder left it in place; exactly once.
    const start = shape === 'raw' ? a.encoderDelayFrames : 0;
    const l = decoded.getChannelData(0);
    const r = decoded.getChannelData(1);
    if (l.length !== decoded.length || r.length !== decoded.length || start + d.frames > l.length) {
      throw new Mp3DecodeError('UNSUPPORTED_OUTPUT', 'Canais decodificados com comprimentos inconsistentes.');
    }
    const left = l.slice(start, start + d.frames);
    const right = r.slice(start, start + d.frames);
    for (let i = 0; i < d.frames; i++) {
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Mp3DecodeError('NON_FINITE', `Amostra não finita no quadro ${i}.`);
    }
    return { sampleRate: d.sampleRate, left, right, shape, trimmedStartFrames: start, decodedLength: decoded.length };
  }
}
