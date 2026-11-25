import { parseStrictWavDescriptor } from '../separation/demucs-onnx-separator';
import {
  LAME_ENCODER_DELAY_FRAMES,
  LAME_ENCODER_ID,
  MPEG_L3_SAMPLES_PER_FRAME,
  Mp3EncodingError,
  buildInfoFrame,
  cbr256FrameBytes,
  scanCbr256Frames,
} from './mp3-info-frame';

// M22-S1 (experimental, opt-in): one PCM16 stereo WAV stem -> MP3 CBR 256 kbps with a derived Info/LAME frame.
// Single stem per call, fixed-size slices (bounded Float32 working set), cooperative yields and cancellation, the
// encoder released in `finally`. The source WAV is only read, never modified, so the caller keeps it for comparison.

/** Minimal surface of an MP3 encoder: the real one lives in mp3-lame-backend.ts, tests inject a fake. */
export interface Mp3EncoderBackend {
  /** Starts a CBR 256 kbps stereo encode at `sampleRate`. */
  configure(sampleRate: number): void;
  /** Encodes one slice. The returned view may alias encoder memory: it is copied immediately. */
  encode(left: Float32Array, right: Float32Array): Uint8Array;
  /** Flushes the last frames. */
  finalize(): Uint8Array;
  dispose?(): void;
}

export interface EncodeMp3StemOptions {
  readonly backend: Mp3EncoderBackend;
  /**
   * Decoder-side delay (samples a decoder removes in addition to the LAME-tag delay) as CALIBRATED on the target
   * decoder (`Mp3StemDecoder.calibrate`). It only expresses the manifest alignment; it is never assumed here.
   */
  readonly decoderDelayFrames: number;
  readonly signal?: AbortSignal;
  readonly isCancelled?: () => boolean;
  /** Awaited between slice groups so the thread stays responsive and cancellation is observed. */
  readonly yieldFn?: () => Promise<void>;
  readonly sliceFrames?: number;
  readonly yieldEverySlices?: number;
  readonly maxSeconds?: number;
}

export interface EncodedMp3Stem {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly sampleRate: 44100 | 48000;
  readonly frames: number;
  readonly sizeBytes: number;
  /** Manifest alignment (contract v2): encoderDelayFrames = tag delay + decoder delay; paddingFrames = tag padding - decoder delay. */
  readonly alignment: { encoderDelayFrames: number; paddingFrames: number; mpegAudioFrames: number; infoFrame: true };
  readonly tag: { encoder: string; delayFrames: number; paddingFrames: number };
  readonly stats: { encodeMs: number; wavBytes: number; mp3Bytes: number; slices: number };
}

const DEFAULT_SLICE_FRAMES = MPEG_L3_SAMPLES_PER_FRAME * 64;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Mp3EncodingError('UNSUPPORTED', 'SHA-256 indisponível neste ambiente.');
  const shared = typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer;
  const digest = await subtle.digest('SHA-256', (shared ? bytes.slice() : bytes) as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const isOutOfMemory = (reason: unknown) =>
  reason instanceof RangeError || (reason instanceof Error && /memory|allocation/i.test(reason.message));

export async function encodeWavStemToMp3(wavInput: Uint8Array | ArrayBuffer, options: EncodeMp3StemOptions): Promise<EncodedMp3Stem> {
  const started = performance.now();
  const wav = wavInput instanceof Uint8Array ? wavInput : new Uint8Array(wavInput);
  const { backend, decoderDelayFrames } = options;
  const sliceFrames = options.sliceFrames ?? DEFAULT_SLICE_FRAMES;
  const yieldEvery = options.yieldEverySlices ?? 4;
  const cancelled = () => Boolean(options.signal?.aborted || options.isCancelled?.());
  const checkCancel = () => { if (cancelled()) throw new Mp3EncodingError('CANCELLED', 'Compressão cancelada.'); };
  if (!Number.isInteger(decoderDelayFrames) || decoderDelayFrames < 0 || decoderDelayFrames > MPEG_L3_SAMPLES_PER_FRAME) {
    throw new Mp3EncodingError('ALIGNMENT', 'Atraso do decodificador inválido.');
  }
  if (!Number.isInteger(sliceFrames) || sliceFrames <= 0) throw new Mp3EncodingError('UNSUPPORTED', 'Tamanho de fatia inválido.');

  let format;
  try {
    format = parseStrictWavDescriptor(wav);
  } catch (reason) {
    throw new Mp3EncodingError('INVALID_STREAM', `WAV inválido: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  const rate = format.sampleRate;
  if (format.effectiveFormat !== 1 || format.bitsPerSample !== 16 || format.channels !== 2) {
    throw new Mp3EncodingError('UNSUPPORTED', 'Somente WAV PCM16 estéreo pode ser comprimido.');
  }
  if (rate !== 44_100 && rate !== 48_000) throw new Mp3EncodingError('UNSUPPORTED', `Taxa ${rate} Hz não suportada para MP3.`);
  const totalFrames = format.totalFrames;
  if (totalFrames <= 0 || totalFrames > rate * (options.maxSeconds ?? 300)) {
    throw new Mp3EncodingError('UNSUPPORTED', 'Duração fora do limite de 300 segundos.');
  }

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const left = new Float32Array(sliceFrames);
  const right = new Float32Array(sliceFrames);
  const chunks: Uint8Array[] = [];
  let slices = 0;
  try {
    backend.configure(rate);
    for (let start = 0; start < totalFrames; start += sliceFrames) {
      checkCancel();
      const n = Math.min(sliceFrames, totalFrames - start);
      let p = format.dataOffset + start * 4;
      for (let i = 0; i < n; i++, p += 4) {
        left[i] = view.getInt16(p, true) / 32768;
        right[i] = view.getInt16(p + 2, true) / 32768;
      }
      const out = backend.encode(n === sliceFrames ? left : left.subarray(0, n), n === sliceFrames ? right : right.subarray(0, n));
      if (out.length > 0) chunks.push(out.slice());
      slices++;
      if (options.yieldFn && slices % yieldEvery === 0) await options.yieldFn();
    }
    checkCancel();
    const tail = backend.finalize();
    if (tail.length > 0) chunks.push(tail.slice());
  } catch (reason) {
    if (reason instanceof Mp3EncodingError) throw reason;
    throw isOutOfMemory(reason)
      ? new Mp3EncodingError('OUT_OF_MEMORY', 'Memória insuficiente para comprimir a faixa.')
      : new Mp3EncodingError('ENCODER_FAILED', `Falha do codificador MP3: ${reason instanceof Error ? reason.message : String(reason)}`);
  } finally {
    try { backend.dispose?.(); } catch { /* releasing is best effort */ }
  }

  const scan = scanCbr256Frames(chunks, rate);
  const tagDelay = LAME_ENCODER_DELAY_FRAMES;
  const tagPadding = scan.frames * MPEG_L3_SAMPLES_PER_FRAME - tagDelay - totalFrames;
  // A decoder trims its own delay from the end too: with less padding than that the last samples would be missing.
  if (tagPadding < decoderDelayFrames || tagPadding > 0xfff) {
    throw new Mp3EncodingError('ALIGNMENT', 'Corte final do MP3 incompatível com o atraso do decodificador.');
  }
  const frameBytes = chunks.reduce((sum, c) => sum + c.length, 0);
  const total = cbr256FrameBytes(rate) + frameBytes;
  const finalInfo = buildInfoFrame({
    sampleRate: rate, mpegAudioFrames: scan.frames, totalFileBytes: total, delayFrames: tagDelay, paddingFrames: tagPadding,
    musicCrc: scan.musicCrc, firstAudioHeader: scan.firstHeader,
  });
  const bytes = new Uint8Array(total);
  bytes.set(finalInfo, 0);
  let at = finalInfo.length;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  chunks.length = 0;
  checkCancel();

  return {
    bytes,
    sha256: await sha256Hex(bytes),
    sampleRate: rate,
    frames: totalFrames,
    sizeBytes: total,
    alignment: { encoderDelayFrames: tagDelay + decoderDelayFrames, paddingFrames: tagPadding - decoderDelayFrames, mpegAudioFrames: scan.frames, infoFrame: true },
    tag: { encoder: LAME_ENCODER_ID, delayFrames: tagDelay, paddingFrames: tagPadding },
    stats: { encodeMs: Math.round(performance.now() - started), wavBytes: wav.byteLength, mp3Bytes: total, slices },
  };
}
