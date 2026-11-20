// Streaming validator for mp3_cbr256 stems (M22-C.5C). ISOLATED: not called by any upload, publish or storage path,
// and `serverByteValidation` stays false for mp3_cbr256 (audio-codec.ts), so MP3 publication is still blocked.
//
// It validates the real bytes without decoding audio and without holding the object in memory: chunks of ANY size are
// fed to `Mp3StemStreamValidator.write`, memory is O(1) (one Info frame of <= 836 bytes plus a few counters).
//
// STRUCTURE ACCEPTED (strictly, everything else is rejected):
//   frame 0   Info/Xing frame: MPEG-1 Layer III, 256 kbps, 44.1/48 kHz, stereo or joint stereo, no CRC protection,
//             side info all zero, then "Info"|"Xing", flags with frames+bytes set (TOC/quality optional),
//             a 36-byte LAME tag block with a valid tag CRC-16 and music CRC-16, zero padding to the frame end.
//   frames 1..N exactly `alignment.mpegAudioFrames` MPEG-1 L3 CBR 256 kbps frames with the same sample rate.
//   nothing else: no ID3v2/ID3v1, no leading or trailing bytes, no truncated frame.
//
// SEMANTICS VERIFIED EMPIRICALLY (ffmpeg 9.0.1 / libmp3lame, 44.1 and 48 kHz, 1..300 s; see the architecture doc):
//   * Info "frames" counts the MPEG AUDIO frames and EXCLUDES the Info frame itself; the manifest's mpegAudioFrames
//     has the same meaning. The Info frame is a valid-looking but silent frame and contributes NO audio samples:
//     the decoded stream length is mpegAudioFrames * 1152 samples, not (mpegAudioFrames + 1) * 1152.
//   * Info "bytes" and the LAME "music length" are both the complete file size (including the Info frame).
//   * The LAME tag delay/padding (12 bits each) describe the ENCODER only. A decoder adds its own delay (for the
//     usual LAME/mpg123 family 528 + 1 samples) and the manifest folds it into encoderDelayFrames. This module never
//     hardcodes that value: it derives decoderDelayFrames = declaredDelay - tagDelay (= tagPadding - declaredPadding),
//     bounds it to [0, one MPEG frame], optionally pins it to a policy value, and exposes it so the caller can require
//     the SAME value on the six stems (`assertConsistentMp3Stems`).

import { createHash } from 'node:crypto';
import { AppError } from '../../middleware/error-handler';
import { MP3_CBR256_BITRATE_KBPS, MPEG_L3_SAMPLES_PER_FRAME, CODEC_PROFILES } from './audio-codec';
import { mp3StemSchema } from './ministry-audio.schema';
import type { z } from 'zod';

export type Mp3StemManifest = z.infer<typeof mp3StemSchema>;

export type Mp3ValidationCode =
  | 'INVALID_DESCRIPTOR' | 'CONTENT_ENCODING' | 'ID3' | 'LEADING_GARBAGE' | 'BAD_HEADER' | 'UNSUPPORTED_STREAM'
  | 'TOO_LARGE' | 'TOO_MANY_FRAMES' | 'TRUNCATED' | 'TRAILING_BYTES' | 'FRAME_COUNT' | 'SIZE' | 'BAD_INFO_FRAME'
  | 'TAG_MISMATCH' | 'ALIGNMENT' | 'CRC' | 'SHA256' | 'INCONSISTENT_SET' | 'INVALID_INPUT';

export class Mp3ValidationError extends Error {
  readonly code: Mp3ValidationCode;
  constructor(code: Mp3ValidationCode, message: string) {
    super(message);
    this.name = 'Mp3ValidationError';
    this.code = code;
  }
}

export interface Mp3ValidationOptions {
  /**
   * Policy pin for the decoder-side delay folded into encoderDelayFrames (e.g. the value calibrated by the Web reader).
   * When omitted only the structural bound [0, 1152] applies and consistency across stems is the caller's gate.
   */
  readonly expectedDecoderDelayFrames?: number;
  /** Encoder identification (LAME tag, 9 chars) must start with one of these; anything else is an unknown encoder. */
  readonly allowedEncoderPrefixes?: readonly string[];
  /** Encoder-side delay recorded in the LAME tag that the supported encoder profile is evidenced to produce. */
  readonly expectedTagDelayFrames?: number;
}

export interface Mp3ValidationResult {
  readonly id: string;
  readonly sampleRate: 44100 | 48000;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mpegAudioFrames: number;
  readonly frames: number;
  readonly tagDelayFrames: number;
  readonly tagPaddingFrames: number;
  readonly decoderDelayFrames: number;
  readonly encoder: string;
  /** Bytes buffered at most at once (the Info frame); proves the O(1) memory bound. */
  readonly peakBufferedBytes: number;
}

const SAMPLE_RATES = [44_100, 48_000, 32_000] as const;
const BITRATE_INDEX_256 = 13;
/** Info/Xing tag offset: 4 header bytes + 32 side-info bytes (MPEG-1 stereo, no CRC). */
const TAG_OFFSET = 36;
const LAME_BLOCK = 36;

const CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-16/ARC (reflected 0xA001, init 0): the algorithm LAME and ffmpeg use for the tag and music CRCs. */
function crc16(crc: number, bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = crc;
  for (let i = start; i < end; i++) c = CRC16_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

function frameLengthBytes(sampleRate: number, padding: number): number {
  return Math.floor((144 * MP3_CBR256_BITRATE_KBPS * 1000) / sampleRate) + padding;
}

export class Mp3StemStreamValidator {
  private readonly expected: Mp3StemManifest;
  private readonly options: Mp3ValidationOptions;
  private readonly hash = createHash('sha256');
  private readonly header = Buffer.alloc(4);
  private readonly firstFrame: Buffer;
  private headerFill = 0;
  private frameRemaining = 0;
  private frameLength = 0;
  private framesSeen = 0;
  private total = 0;
  private musicCrc = 0;
  private tag: { frames: number; bytes: number; delay: number; padding: number; encoder: string; storedMusicCrc: number; musicLength: number } | null = null;
  private finished = false;
  private failed = false;

  constructor(expected: Mp3StemManifest, options: Mp3ValidationOptions = {}) {
    const parsed = mp3StemSchema.safeParse(expected);
    if (!parsed.success) throw new Mp3ValidationError('INVALID_DESCRIPTOR', 'Descritor MP3 inválido.');
    this.expected = parsed.data;
    this.options = options;
    const max = frameLengthBytes(this.expected.sampleRate, 1);
    this.firstFrame = Buffer.alloc(max);
  }

  get bytesRead(): number {
    return this.total;
  }

  /** After any failure the instance is poisoned: a caller that swallows an error cannot resume on half-updated state. */
  write(chunk: Uint8Array): void {
    if (this.finished || this.failed) throw new Mp3ValidationError('INVALID_INPUT', 'Validador já finalizado ou invalidado.');
    try {
      this.consume(chunk);
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  private consume(whole: Uint8Array): void {
    if (!(whole instanceof Uint8Array)) throw new Mp3ValidationError('INVALID_INPUT', 'Chunk inválido.');
    // Never look past the declared size: the in-bounds prefix is still validated first so the reported reason does
    // not depend on how the source happened to be chunked, then the excess is refused. Work is bounded by sizeBytes.
    const room = this.expected.sizeBytes - this.total;
    const chunk = whole.length > room ? whole.subarray(0, room) : whole;
    if (whole.length > room) {
      this.consumeBounded(chunk);
      throw new Mp3ValidationError('TOO_LARGE', 'MP3 maior que o declarado.');
    }
    this.consumeBounded(chunk);
  }

  private consumeBounded(chunk: Uint8Array): void {
    this.hash.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      if (this.frameRemaining === 0) {
        offset = this.collectHeader(chunk, offset);
        continue;
      }
      const n = Math.min(this.frameRemaining, chunk.length - offset);
      if (this.framesSeen === 1) {
        this.firstFrame.set(chunk.subarray(offset, offset + n), this.frameLength - this.frameRemaining);
      } else {
        this.musicCrc = crc16(this.musicCrc, chunk, offset, offset + n);
      }
      this.frameRemaining -= n;
      offset += n;
      this.total += n;
      if (this.frameRemaining === 0 && this.framesSeen === 1) this.checkInfoFrame();
    }
  }

  private collectHeader(chunk: Uint8Array, offset: number): number {
    const need = 4 - this.headerFill;
    const n = Math.min(need, chunk.length - offset);
    for (let i = 0; i < n; i++) {
      const byte = chunk[offset + i];
      if (this.total === 0 && i === 0 && this.headerFill === 0) {
        if (byte === 0x49 /* "I" of ID3 */) throw new Mp3ValidationError('ID3', 'MP3 com ID3 não é aceito.');
        if (byte !== 0xff) throw new Mp3ValidationError('LEADING_GARBAGE', 'Bytes antes do primeiro frame MPEG.');
      }
      this.header[this.headerFill++] = byte;
    }
    this.total += n;
    if (this.headerFill < 4) return offset + n;
    this.parseHeader();
    return offset + n;
  }

  private parseHeader(): void {
    const h = this.header;
    const fail = (why: string): never => { throw new Mp3ValidationError('BAD_HEADER', `Cabeçalho de frame inválido: ${why}.`); };
    const complete = this.framesSeen >= this.expected.alignment.mpegAudioFrames + 1;
    if (h[0] !== 0xff || (h[1] & 0xe0) !== 0xe0) {
      if (complete) throw new Mp3ValidationError('TRAILING_BYTES', 'Bytes após o último frame MPEG.');
      fail('sincronismo');
    }
    if (complete) throw new Mp3ValidationError('TOO_MANY_FRAMES', 'Mais frames MPEG do que o declarado.');
    const version = (h[1] >> 3) & 3;
    const layer = (h[1] >> 1) & 3;
    if (version !== 3) fail('versão MPEG diferente de MPEG-1');
    if (layer !== 1) fail('camada diferente de Layer III');
    if ((h[1] & 1) === 0) throw new Mp3ValidationError('UNSUPPORTED_STREAM', 'Frames com proteção CRC não são aceitos.');
    if ((h[2] >> 4) !== BITRATE_INDEX_256) fail('bitrate diferente de 256 kbps CBR');
    const rate = SAMPLE_RATES[(h[2] >> 2) & 3];
    if ((h[2] >> 2 & 3) === 3 || rate !== this.expected.sampleRate) fail('taxa de amostragem');
    const channelMode = h[3] >> 6;
    if (channelMode > 1) throw new Mp3ValidationError('UNSUPPORTED_STREAM', 'Modo de canais deve ser estéreo ou joint stereo.');
    if ((h[3] & 3) !== 0) throw new Mp3ValidationError('UNSUPPORTED_STREAM', 'Ênfase não é aceita.');
    this.frameLength = frameLengthBytes(rate, (h[2] >> 1) & 1);
    if (this.framesSeen === 0) this.firstFrame.set(h, 0);
    else this.musicCrc = crc16(this.musicCrc, h); // the music CRC covers every byte after the Info frame, headers included
    this.frameRemaining = this.frameLength - 4;
    this.headerFill = 0;
    this.framesSeen++;
    if (this.total - 4 + this.frameLength > this.expected.sizeBytes) throw new Mp3ValidationError('TOO_LARGE', 'Frame excede o tamanho declarado.');
  }

  private checkInfoFrame(): void {
    const f = this.firstFrame.subarray(0, this.frameLength);
    const bad = (why: string): never => { throw new Mp3ValidationError('BAD_INFO_FRAME', `Frame Info/Xing inválido: ${why}.`); };
    for (let i = 4; i < TAG_OFFSET; i++) if (f[i] !== 0) bad('informação lateral não é zero');
    const name = f.toString('latin1', TAG_OFFSET, TAG_OFFSET + 4);
    if (name !== 'Info' && name !== 'Xing') bad('primeiro frame não é Info/Xing');
    const flags = f.readUInt32BE(TAG_OFFSET + 4);
    if ((flags & 3) !== 3) bad('contagem de frames e de bytes ausentes');
    if ((flags & ~0xf) !== 0) bad('flags desconhecidas');
    let o = TAG_OFFSET + 8;
    const frames = f.readUInt32BE(o); o += 4;
    const bytes = f.readUInt32BE(o); o += 4;
    if (flags & 4) o += 100;
    if (flags & 8) o += 4;
    if (o + LAME_BLOCK > f.length) bad('tag LAME ausente');
    const encoder = f.toString('latin1', o, o + 9);
    if (!/^[\x20-\x7e]{9}$/.test(encoder) || encoder.trim() === '') bad('identificação do codificador ausente');
    const delay = (f[o + 21] << 4) | (f[o + 22] >> 4);
    const padding = ((f[o + 22] & 0x0f) << 8) | f[o + 23];
    const musicLength = f.readUInt32BE(o + 28);
    const storedMusicCrc = f.readUInt16BE(o + 32);
    const storedTagCrc = f.readUInt16BE(o + 34);
    if (crc16(0, f, 0, o + 34) !== storedTagCrc) throw new Mp3ValidationError('CRC', 'CRC da tag LAME inválido.');
    for (let i = o + LAME_BLOCK; i < f.length; i++) if (f[i] !== 0) bad('bytes não nulos após a tag LAME');
    this.tag = { frames, bytes, delay, padding, encoder, storedMusicCrc, musicLength };
  }

  finish(): Mp3ValidationResult {
    if (this.finished || this.failed) throw new Mp3ValidationError('INVALID_INPUT', 'Validador já finalizado ou invalidado.');
    this.finished = true;
    const e = this.expected;
    if (this.frameRemaining !== 0) throw new Mp3ValidationError('TRUNCATED', 'MP3 truncado: frame incompleto.');
    if (this.headerFill !== 0) {
      const complete = this.framesSeen >= e.alignment.mpegAudioFrames + 1;
      throw new Mp3ValidationError(complete ? 'TRAILING_BYTES' : 'TRUNCATED', complete ? 'Bytes após o último frame MPEG.' : 'MP3 truncado: cabeçalho incompleto.');
    }
    const tag = this.tag;
    if (this.framesSeen === 0 || !tag) throw new Mp3ValidationError('TRUNCATED', 'MP3 sem frames.');
    if (this.framesSeen - 1 !== e.alignment.mpegAudioFrames) {
      throw new Mp3ValidationError('FRAME_COUNT', `Frames MPEG (${this.framesSeen - 1}) diferem do declarado (${e.alignment.mpegAudioFrames}).`);
    }
    if (this.total !== e.sizeBytes) throw new Mp3ValidationError('SIZE', 'Tamanho do MP3 difere do declarado.');
    if (tag.frames !== e.alignment.mpegAudioFrames || tag.bytes !== e.sizeBytes || tag.musicLength !== e.sizeBytes) {
      throw new Mp3ValidationError('TAG_MISMATCH', 'Contagens da tag Info/LAME divergem do arquivo e do manifesto.');
    }
    if (this.musicCrc !== tag.storedMusicCrc) throw new Mp3ValidationError('CRC', 'CRC de música da tag LAME inválido.');
    const { encoderDelayFrames: delay, paddingFrames: padding } = e.alignment;
    const decoderDelay = delay - tag.delay;
    if (tag.delay + tag.padding !== delay + padding || decoderDelay < 0 || padding > tag.padding ||
        decoderDelay > MPEG_L3_SAMPLES_PER_FRAME || tag.padding - padding !== decoderDelay) {
      throw new Mp3ValidationError('ALIGNMENT', 'Atraso/corte da tag LAME incompatíveis com o manifesto.');
    }
    if (this.options.expectedDecoderDelayFrames !== undefined && decoderDelay !== this.options.expectedDecoderDelayFrames) {
      throw new Mp3ValidationError('ALIGNMENT', 'Atraso do decodificador diverge da política configurada.');
    }
    const { allowedEncoderPrefixes, expectedTagDelayFrames } = this.options;
    if (allowedEncoderPrefixes !== undefined && !allowedEncoderPrefixes.some((prefix) => tag.encoder.startsWith(prefix))) {
      throw new Mp3ValidationError('UNSUPPORTED_STREAM', 'Codificador MP3 fora do perfil suportado.');
    }
    if (expectedTagDelayFrames !== undefined && tag.delay !== expectedTagDelayFrames) {
      throw new Mp3ValidationError('ALIGNMENT', 'Atraso do codificador na tag LAME fora do perfil suportado.');
    }
    if (e.frames !== e.alignment.mpegAudioFrames * MPEG_L3_SAMPLES_PER_FRAME - tag.delay - tag.padding) {
      throw new Mp3ValidationError('ALIGNMENT', 'Frames canônicos não fecham com a tag LAME.');
    }
    if (this.hash.digest('hex') !== e.sha256) throw new Mp3ValidationError('SHA256', 'SHA-256 do MP3 difere do declarado.');
    return {
      id: e.id, sampleRate: e.sampleRate, sizeBytes: this.total, sha256: e.sha256,
      mpegAudioFrames: e.alignment.mpegAudioFrames, frames: e.frames,
      tagDelayFrames: tag.delay, tagPaddingFrames: tag.padding, decoderDelayFrames: decoderDelay,
      encoder: tag.encoder, peakBufferedBytes: this.firstFrame.length,
    };
  }
}

/** The six stems of one recording must describe one timeline and one decoder-side delay. */
export function assertConsistentMp3Stems(results: readonly Omit<Mp3ValidationResult, 'peakBufferedBytes'>[]): void {
  const bad = (why: string): never => { throw new Mp3ValidationError('INCONSISTENT_SET', `Stems MP3 inconsistentes: ${why}.`); };
  if (results.length === 0) bad('conjunto vazio');
  if (new Set(results.map((r) => r.id)).size !== results.length) bad('ids repetidos');
  const first = results[0];
  for (const r of results) {
    if (r.sampleRate !== first.sampleRate || r.frames !== first.frames || r.mpegAudioFrames !== first.mpegAudioFrames ||
        r.tagDelayFrames !== first.tagDelayFrames || r.tagPaddingFrames !== first.tagPaddingFrames ||
        r.decoderDelayFrames !== first.decoderDelayFrames || r.encoder !== first.encoder) bad(`faixa ${r.id} diverge de ${first.id}`);
  }
}

/** Only an absent or "identity" Content-Encoding is acceptable: a compressed body would change the hashed bytes. */
export function assertIdentityContentEncoding(value: string | readonly string[] | null | undefined): void {
  const values = value === undefined || value === null ? [] : typeof value === 'string' ? [value] : [...value];
  for (const v of values) {
    if (v.split(',').some((token) => token.trim() !== '' && token.trim().toLowerCase() !== 'identity')) {
      throw new Mp3ValidationError('CONTENT_ENCODING', 'Content-Encoding inesperado.');
    }
  }
}

export interface VerifyMp3Options extends Mp3ValidationOptions {
  /** Response/object Content-Encoding header(s), when the source is an HTTP body. */
  readonly contentEncoding?: string | readonly string[] | null;
  readonly signal?: AbortSignal;
  /**
   * Receives each chunk in order AS IT IS READ, before the CRC/SHA checks in finish() have run: whatever it writes
   * (e.g. a staging file) is unverified until verifyMp3Stem resolves and must be discarded if it rejects.
   */
  readonly sink?: (chunk: Uint8Array) => Promise<void> | void;
}

/**
 * Storage-facing wrapper, shaped like `verifyWav`: any AsyncIterable of byte chunks works — a Node Readable, the R2
 * `readRanged` generator, or a direct-upload body. Failures surface as a generic AppError (no byte-level detail leaks);
 * the structured reason stays on `cause`.
 */
function closeUnstartedSource(source: AsyncIterable<Uint8Array>): void {
  const s = source as { destroy?: () => unknown; return?: () => unknown };
  try {
    if (typeof s.destroy === 'function') s.destroy();
    else if (typeof s.return === 'function') void Promise.resolve(s.return()).catch(() => undefined);
  } catch {
    // best effort: the original validation error is what the caller must see
  }
}

export async function verifyMp3Stem(
  source: AsyncIterable<Uint8Array>,
  expected: Mp3StemManifest,
  status: 409 | 422,
  options: VerifyMp3Options = {},
): Promise<Mp3ValidationResult> {
  let iterating = false;
  try {
    assertIdentityContentEncoding(options.contentEncoding);
    const validator = new Mp3StemStreamValidator(expected, options);
    iterating = true; // from here `for await` closes the source itself on every exit path
    for await (const chunk of source) {
      options.signal?.throwIfAborted();
      validator.write(chunk);
      await options.sink?.(chunk);
    }
    options.signal?.throwIfAborted();
    return validator.finish();
  } catch (error) {
    if (!iterating) closeUnstartedSource(source); // an early rejection must not leak a socket/file behind the source
    if (error instanceof Mp3ValidationError) {
      const failure = new AppError(status, 'O stem MP3 não corresponde ao manifesto de áudio.');
      // Non-enumerable so it can never be serialized into an HTTP response.
      Object.defineProperty(failure, 'cause', { value: error, enumerable: false });
      throw failure;
    }
    throw error;
  }
}

export const MP3_VALIDATOR_LIMITS = {
  maxBytes: CODEC_PROFILES.mp3_cbr256.maxBytes,
  maxFrames: CODEC_PROFILES.mp3_cbr256.maxFrames,
} as const;
