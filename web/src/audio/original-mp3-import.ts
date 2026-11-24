// M22-E1 — native import of an ORIGINAL song (MP3) for local Demucs separation.
//
// MP3 -> PCM stereo 44.1 kHz (browser decodeAudioData) -> PCM16 WAV in memory -> the existing Demucs worker.
// Everything runs in this browser: no upload, no external API, no FFmpeg, no new dependency, the picked file is only read.
//
// This is NOT the reader of published MP3 stems (mp3-stem-decoder.ts): original songs are arbitrary CBR/VBR files with
// ID3 tags, mono or stereo, at any common sample rate. Only createBrowserMp3DecodeBackend is shared, because the browser
// decoder is the same. MP3_RELEASE_GATE (publication/storage of MP3 stems) is unaffected by this module.

import { createBrowserMp3DecodeBackend, type DecodedBufferLike, type Mp3DecodeBackend } from './mp3-stem-decoder';
import {
  AudioSeparationError,
  DEFAULT_MAX_AUDIO_SECONDS,
  MAX_AUDIO_WAV_BYTES,
  MAX_SEPARATION_TOTAL_FRAMES,
  encodeStereoPcm16Wav,
} from './separation/demucs-onnx-separator';

export const ORIGINAL_MP3_TARGET_SAMPLE_RATE = 44_100;
/** Compressed input ceiling. 180 s at 320 kbps is ~7 MB; the rest is headroom for ID3 cover art. */
export const MAX_ORIGINAL_MP3_BYTES = 24 * 1024 * 1024;
/** Bounded reads: a hostile ID3v2 size can never make the scanner skip more than this. */
const MAX_ID3_BYTES = 16 * 1024 * 1024;
const MAX_LEADING_JUNK_BYTES = 8 * 1024;
const MAX_RESYNC_EVENTS = 16;
const MAX_SKIPPED_BYTES = 256 * 1024;
const MIN_AUDIO_FRAMES = 3;
/** The decoded length may differ from the frame estimate by encoder delay/padding and resampling only. */
const DECODE_LENGTH_TOLERANCE_FRAMES = ORIGINAL_MP3_TARGET_SAMPLE_RATE; // 1 s

export type Mp3ImportErrorCode =
  | 'EMPTY' | 'TOO_LARGE' | 'NOT_MP3' | 'CORRUPT' | 'TOO_LONG' | 'UNAVAILABLE'
  | 'DECODE_FAILED' | 'UNSUPPORTED_OUTPUT' | 'NON_FINITE' | 'OUTPUT_TOO_LARGE' | 'CANCELLED';

export class Mp3ImportError extends Error {
  readonly code: Mp3ImportErrorCode;
  constructor(code: Mp3ImportErrorCode, message: string) {
    super(message);
    this.name = 'Mp3ImportError';
    this.code = code;
  }
}

export interface Mp3StructureInfo {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly audioFrames: number;
  readonly durationSeconds: number;
  readonly estimatedSamples: number;
  readonly variableBitrate: boolean;
  readonly id3v2Bytes: number;
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES_V1 = [44_100, 48_000, 32_000];
const RATES_V2 = [22_050, 24_000, 16_000];
const RATES_V25 = [11_025, 12_000, 8_000];

interface FrameHeader { sampleRate: number; samples: number; length: number; bitrate: number; mono: boolean; version: number }

/** Parses one MPEG Layer III header. Returns null for anything that is not a valid, supported header. */
function parseFrameHeader(b: Uint8Array, p: number): FrameHeader | null {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (b[p + 1] >> 3) & 3; // 0 = 2.5, 1 = reserved, 2 = MPEG-2, 3 = MPEG-1
  const layerBits = (b[p + 1] >> 1) & 3; // 1 = Layer III
  if (versionBits === 1 || layerBits !== 1) return null;
  const bitrateIndex = b[p + 2] >> 4;
  const rateIndex = (b[p + 2] >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const v1 = versionBits === 3;
  const sampleRate = (v1 ? RATES_V1 : versionBits === 2 ? RATES_V2 : RATES_V25)[rateIndex];
  const bitrate = (v1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex] * 1000;
  const padding = (b[p + 2] >> 1) & 1;
  const samples = v1 ? 1152 : 576;
  const length = Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { sampleRate, samples, length, bitrate, mono: (b[p + 3] >> 6) === 3, version: versionBits };
}

function id3v2Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const sizeBytes = [b[6], b[7], b[8], b[9]];
  if (sizeBytes.some((v) => v > 0x7f) || b[3] === 0xff) throw new Mp3ImportError('CORRUPT', 'As informações (ID3) do arquivo estão corrompidas.');
  const size = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
  const footer = (b[5] & 0x10) !== 0 ? 10 : 0;
  const total = 10 + size + footer;
  if (total > MAX_ID3_BYTES || total >= b.length) throw new Mp3ImportError('CORRUPT', 'As informações (ID3) do arquivo estão corrompidas.');
  return total;
}

/**
 * Walks the frame headers (bounded: one pass, no allocation per frame) and validates the stream BEFORE any decoding.
 * Extension and MIME type are never consulted. Throws Mp3ImportError for empty, non-MP3, corrupt or too-long input.
 */
export function inspectOriginalMp3(bytes: Uint8Array, maxSeconds = DEFAULT_MAX_AUDIO_SECONDS): Mp3StructureInfo {
  if (bytes.byteLength === 0) throw new Mp3ImportError('EMPTY', 'O arquivo está vazio.');
  if (bytes.byteLength > MAX_ORIGINAL_MP3_BYTES) {
    throw new Mp3ImportError('TOO_LARGE', `O MP3 precisa ter até ${MAX_ORIGINAL_MP3_BYTES / (1024 * 1024)} MiB.`);
  }
  const notMp3 = () => new Mp3ImportError('NOT_MP3', 'O arquivo não é um MP3 válido. Verifique se o formato corresponde à extensão.');
  const id3 = id3v2Length(bytes);
  // Zero padding after the tag is tolerated up to a small bound; anything else must be a frame header.
  let p = id3;
  const limit = Math.min(bytes.length, id3 + MAX_LEADING_JUNK_BYTES);
  while (p < limit && bytes[p] === 0) p++;
  const first = parseFrameHeader(bytes, p);
  if (!first) throw notMp3();

  const maxFrames = Math.ceil((maxSeconds * first.sampleRate) / first.samples) + 4;
  let frames = 0;
  let skipped = 0;
  let resyncs = 0;
  const bitrates = new Set<number>();
  let header: FrameHeader | null = first;
  let mono = first.mono;
  while (p < bytes.length) {
    if (!header) {
      // Trailer (ID3v1 / APE / Lyrics) or damaged data. Only a bounded number of small recoveries is accepted.
      const rest = bytes.length - p;
      if (rest <= 128 && bytes[p] === 0x54 && bytes[p + 1] === 0x41 && bytes[p + 2] === 0x47) break;
      let q = p + 1;
      const end = Math.min(bytes.length, p + 4096);
      let found: FrameHeader | null = null;
      for (; q < end; q++) {
        const h = parseFrameHeader(bytes, q);
        if (h && h.sampleRate === first.sampleRate && h.version === first.version && q + h.length <= bytes.length) {
          const next = parseFrameHeader(bytes, q + h.length);
          if (next || q + h.length === bytes.length) { found = h; break; }
        }
      }
      if (!found) {
        // Unrecognised tail: a short one is a tag trailer, a long one means the file is damaged.
        if (rest <= 4096 + 128 && frames >= MIN_AUDIO_FRAMES) break;
        throw new Mp3ImportError('CORRUPT', 'O MP3 está corrompido ou incompleto.');
      }
      skipped += q - p;
      resyncs += 1;
      if (resyncs > MAX_RESYNC_EVENTS || skipped > MAX_SKIPPED_BYTES) throw new Mp3ImportError('CORRUPT', 'O MP3 está corrompido ou incompleto.');
      p = q;
      header = found;
      continue;
    }
    if (header.sampleRate !== first.sampleRate || header.version !== first.version) {
      throw new Mp3ImportError('CORRUPT', 'O MP3 muda de formato no meio do arquivo e não é suportado.');
    }
    if (p + header.length > bytes.length) {
      // A truncated last frame is tolerated only when it is the single trailing partial frame.
      if (frames >= MIN_AUDIO_FRAMES) break;
      throw new Mp3ImportError('CORRUPT', 'O MP3 está corrompido ou incompleto.');
    }
    frames += 1;
    if (frames > maxFrames) {
      throw new Mp3ImportError('TOO_LONG', `A música precisa ter até ${maxSeconds} segundos (${Math.floor(maxSeconds / 60)} min ${maxSeconds % 60} s).`);
    }
    bitrates.add(header.bitrate);
    mono = mono && header.mono;
    p += header.length;
    header = parseFrameHeader(bytes, p);
    if (!header && p >= bytes.length) break;
  }
  if (frames < MIN_AUDIO_FRAMES) throw new Mp3ImportError('CORRUPT', 'O MP3 é curto demais ou está corrompido.');
  const estimatedSamples = frames * first.samples;
  const durationSeconds = estimatedSamples / first.sampleRate;
  if (durationSeconds > maxSeconds) {
    throw new Mp3ImportError('TOO_LONG', `A música precisa ter até ${maxSeconds} segundos (${Math.floor(maxSeconds / 60)} min ${maxSeconds % 60} s).`);
  }
  return {
    sampleRate: first.sampleRate,
    channels: mono ? 1 : 2,
    audioFrames: frames,
    durationSeconds,
    estimatedSamples,
    variableBitrate: bitrates.size > 1,
    id3v2Bytes: id3,
  };
}

/** True when the leading bytes look like an MP3 (ID3v2 tag or an MPEG audio sync word); used only to ROUTE, never to trust. */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

/** True when the leading bytes are a RIFF/WAVE container header. */
export function looksLikeWav(bytes: Uint8Array): boolean {
  const tag = (o: number, s: string) => s.split('').every((c, i) => bytes[o + i] === c.charCodeAt(0));
  return bytes.length >= 12 && tag(0, 'RIFF') && tag(8, 'WAVE');
}

export interface OriginalMp3ImportOptions {
  /** Test seam; defaults to the browser OfflineAudioContext backend. */
  readonly backend?: Mp3DecodeBackend | null;
  readonly signal?: AbortSignal;
  readonly maxSeconds?: number;
}

export interface OriginalMp3ImportResult {
  /** PCM16 stereo 44.1 kHz WAV. Owns its ArrayBuffer exclusively so it can be transferred to the worker. */
  readonly wavBytes: ArrayBuffer;
  readonly info: Mp3StructureInfo;
  readonly frames: number;
  readonly sourceChannels: number;
  readonly sampleRate: number;
}

function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  const cancelled = () => new Mp3ImportError('CANCELLED', 'Importação cancelada.');
  if (signal.aborted) { void work.catch(() => undefined); return Promise.reject(cancelled()); }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (reason) => { signal.removeEventListener('abort', onAbort); reject(reason); },
    );
  });
}

/**
 * Validates and decodes an original MP3 into a canonical stereo 44.1 kHz PCM16 WAV.
 * `mp3` is consumed: decodeAudioData detaches it, so the caller must not reuse the buffer.
 * decodeAudioData cannot be interrupted, so on cancellation the late result is simply dropped (never reaches Demucs).
 */
export async function importOriginalMp3(mp3: ArrayBuffer, options: OriginalMp3ImportOptions = {}): Promise<OriginalMp3ImportResult> {
  const { signal } = options;
  const maxSeconds = options.maxSeconds ?? DEFAULT_MAX_AUDIO_SECONDS;
  const throwIfCancelled = () => { if (signal?.aborted) throw new Mp3ImportError('CANCELLED', 'Importação cancelada.'); };
  throwIfCancelled();
  const info = inspectOriginalMp3(new Uint8Array(mp3), maxSeconds);
  const backend = options.backend === undefined ? createBrowserMp3DecodeBackend() : options.backend;
  if (!backend) throw new Mp3ImportError('UNAVAILABLE', 'Este navegador não consegue decodificar MP3. Use um navegador atualizado ou envie um WAV.');

  let decoded: DecodedBufferLike;
  try {
    decoded = await raceAbort(backend.decode(mp3, ORIGINAL_MP3_TARGET_SAMPLE_RATE), signal);
  } catch (reason) {
    if (reason instanceof Mp3ImportError) throw reason;
    throw new Mp3ImportError('DECODE_FAILED', 'Não foi possível decodificar este MP3. O arquivo pode estar corrompido ou usar um formato não suportado.');
  }
  throwIfCancelled();

  if (decoded.sampleRate !== ORIGINAL_MP3_TARGET_SAMPLE_RATE) {
    throw new Mp3ImportError('UNSUPPORTED_OUTPUT', `O navegador devolveu áudio a ${decoded.sampleRate} Hz em vez de 44,1 kHz.`);
  }
  if (decoded.numberOfChannels !== 1 && decoded.numberOfChannels !== 2) {
    throw new Mp3ImportError('UNSUPPORTED_OUTPUT', `Número de canais não suportado: ${decoded.numberOfChannels}. Use um MP3 mono ou estéreo.`);
  }
  const frames = decoded.length;
  if (!Number.isInteger(frames) || frames <= 0) throw new Mp3ImportError('UNSUPPORTED_OUTPUT', 'O MP3 não gerou áudio.');
  if (frames > MAX_SEPARATION_TOTAL_FRAMES || frames > ORIGINAL_MP3_TARGET_SAMPLE_RATE * maxSeconds) {
    throw new Mp3ImportError('TOO_LONG', `A música precisa ter até ${maxSeconds} segundos.`);
  }
  const expected = Math.round((info.estimatedSamples * ORIGINAL_MP3_TARGET_SAMPLE_RATE) / info.sampleRate);
  if (Math.abs(frames - expected) > DECODE_LENGTH_TOLERANCE_FRAMES) {
    throw new Mp3ImportError('UNSUPPORTED_OUTPUT', 'A duração decodificada não corresponde ao arquivo. O MP3 pode estar corrompido.');
  }
  // 44-byte header + 4 bytes per stereo frame; checked BEFORE allocating the WAV.
  if (44 + frames * 4 > MAX_AUDIO_WAV_BYTES) throw new Mp3ImportError('OUTPUT_TOO_LARGE', 'O áudio decodificado excede o limite de memória da separação local.');

  const left = decoded.getChannelData(0);
  const right = decoded.numberOfChannels === 2 ? decoded.getChannelData(1) : left; // mono: same samples on both channels, no copy
  if (left.length !== frames || right.length !== frames) throw new Mp3ImportError('UNSUPPORTED_OUTPUT', 'Canais decodificados com comprimentos inconsistentes.');
  for (let i = 0; i < frames; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Mp3ImportError('NON_FINITE', 'O MP3 decodificado contém amostras inválidas.');
  }

  let wav: Uint8Array;
  try {
    wav = encodeStereoPcm16Wav({ sampleRate: ORIGINAL_MP3_TARGET_SAMPLE_RATE, left, right });
  } catch (reason) {
    if (reason instanceof AudioSeparationError && reason.code === 'NON_FINITE_OUTPUT') throw new Mp3ImportError('NON_FINITE', 'O MP3 decodificado contém amostras inválidas.');
    throw reason;
  }
  throwIfCancelled();
  if (wav.byteLength > MAX_AUDIO_WAV_BYTES) throw new Mp3ImportError('OUTPUT_TOO_LARGE', 'O áudio decodificado excede o limite de memória da separação local.');
  return {
    wavBytes: wav.buffer as ArrayBuffer,
    info,
    frames,
    sourceChannels: decoded.numberOfChannels,
    sampleRate: ORIGINAL_MP3_TARGET_SAMPLE_RATE,
  };
}
