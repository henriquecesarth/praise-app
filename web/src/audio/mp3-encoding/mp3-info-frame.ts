// M22-S1 (experimental, opt-in, not wired to any publication flow).
//
// A raw LAME/libmp3lame stream from a WebAssembly build has CBR 256 kbps audio frames but NO leading Info/Xing frame.
// The ministry-audio MP3 contract (docs/architecture/m22c5c-mp3-stream-validator.md) requires that first frame, so this
// module builds it, deriving EVERY field from the encoded bytes and the PCM length: frame count, file size, delay,
// padding and both CRC-16s. Nothing here is taken on trust from a caller-declared manifest, and the identification
// string is the real encoder's ("LAME3.100"), never "Lavc": the server must accept it through an explicit profile.

export const MPEG_L3_SAMPLES_PER_FRAME = 1152;
export const MP3_CBR256_BITRATE_INDEX = 13;
/** LAME's fixed encoder delay (ENCDELAY); also what the shipped LAME 3.100 build writes into its own tags. */
export const LAME_ENCODER_DELAY_FRAMES = 576;
export const LAME_ENCODER_ID = 'LAME3.100';

const SAMPLE_RATE_INDEX: Readonly<Record<number, number>> = { 44_100: 0, 48_000: 1 };
const TAG_OFFSET = 36; // 4 header + 32 side info (MPEG-1 stereo, no CRC)

export class Mp3EncodingError extends Error {
  constructor(readonly code: 'INVALID_STREAM' | 'ALIGNMENT' | 'UNSUPPORTED' | 'CANCELLED' | 'OUT_OF_MEMORY' | 'ENCODER_FAILED', message: string) {
    super(message);
    this.name = 'Mp3EncodingError';
  }
}

const CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-16/ARC (reflected 0xA001, init 0), the algorithm of the LAME tag CRCs and of the server validator. */
export function crc16(crc: number, bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = crc;
  for (let i = start; i < end; i++) c = CRC16_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

export function cbr256FrameBytes(sampleRate: number): number {
  return Math.floor((144 * 256_000) / sampleRate);
}

export interface Mp3FrameScan {
  readonly frames: number;
  readonly firstHeader: Uint8Array;
  readonly musicCrc: number;
}

/**
 * Walks `chunks` as one stream of CBR 256 kbps MPEG-1 Layer III stereo frames at `sampleRate` (no CRC protection, no
 * ID3, no trailing bytes). Chunks may split a frame anywhere. Returns the frame count and the music CRC-16.
 */
export function scanCbr256Frames(chunks: readonly Uint8Array[], sampleRate: number): Mp3FrameScan {
  const bad = (why: string): never => { throw new Mp3EncodingError('INVALID_STREAM', `Fluxo MP3 do codificador inválido: ${why}.`); };
  if (!(sampleRate in SAMPLE_RATE_INDEX)) throw new Mp3EncodingError('UNSUPPORTED', `Taxa ${sampleRate} Hz não suportada.`);
  const base = cbr256FrameBytes(sampleRate);
  const header = new Uint8Array(4);
  let headerFill = 0;
  let remaining = 0;
  let frames = 0;
  let crc = 0;
  const firstHeader = new Uint8Array(4);
  for (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.length) {
      if (remaining > 0) {
        const n = Math.min(remaining, chunk.length - offset);
        crc = crc16(crc, chunk, offset, offset + n);
        remaining -= n;
        offset += n;
        continue;
      }
      const n = Math.min(4 - headerFill, chunk.length - offset);
      header.set(chunk.subarray(offset, offset + n), headerFill);
      headerFill += n;
      offset += n;
      if (headerFill < 4) continue;
      headerFill = 0;
      if (header[0] !== 0xff || header[1] !== 0xfb) bad(`sincronismo/MPEG-1 Layer III/sem CRC no frame ${frames}`);
      if ((header[2] >> 4) !== MP3_CBR256_BITRATE_INDEX) bad(`frame ${frames} não é 256 kbps`);
      if (((header[2] >> 2) & 3) !== SAMPLE_RATE_INDEX[sampleRate]) bad(`taxa do frame ${frames}`);
      if ((header[3] >> 6) > 1) bad(`frame ${frames} não é estéreo/joint stereo`);
      if ((header[3] & 3) !== 0) bad(`ênfase no frame ${frames}`);
      if (frames === 0) firstHeader.set(header);
      crc = crc16(crc, header);
      remaining = base + ((header[2] >> 1) & 1) - 4;
      frames++;
    }
  }
  if (remaining !== 0 || headerFill !== 0) bad('fluxo truncado no meio de um frame');
  if (frames === 0) bad('sem frames');
  return { frames, firstHeader, musicCrc: crc };
}

export interface InfoFrameFields {
  readonly sampleRate: number;
  readonly mpegAudioFrames: number;
  readonly totalFileBytes: number;
  readonly delayFrames: number;
  readonly paddingFrames: number;
  readonly musicCrc: number;
  readonly firstAudioHeader: Uint8Array;
}

/** Builds the Info frame (header, zero side info, "Info", flags frames+bytes, 36-byte LAME block with both CRCs). */
export function buildInfoFrame(f: InfoFrameFields): Uint8Array {
  if (f.delayFrames < 0 || f.delayFrames > 0xfff || f.paddingFrames < 0 || f.paddingFrames > 0xfff) {
    throw new Mp3EncodingError('ALIGNMENT', 'Atraso ou corte fora dos 12 bits da tag LAME.');
  }
  const length = cbr256FrameBytes(f.sampleRate);
  const frame = new Uint8Array(length);
  frame.set(f.firstAudioHeader.subarray(0, 4));
  frame[2] &= ~0x02; // the Info frame never uses the padding bit: its length is exactly floor(144*256000/rate)
  const view = new DataView(frame.buffer);
  frame.set([0x49, 0x6e, 0x66, 0x6f], TAG_OFFSET); // "Info": CBR
  view.setUint32(TAG_OFFSET + 4, 0x3); // flags: frames + bytes
  view.setUint32(TAG_OFFSET + 8, f.mpegAudioFrames);
  view.setUint32(TAG_OFFSET + 12, f.totalFileBytes);
  const o = TAG_OFFSET + 16;
  for (let i = 0; i < LAME_ENCODER_ID.length; i++) frame[o + i] = LAME_ENCODER_ID.charCodeAt(i);
  frame[o + 9] = 0x01; // tag revision 0, CBR method
  frame[o + 20] = 255; // specified bitrate byte (255 = "255 or more", as LAME writes for 256 kbps)
  frame[o + 21] = f.delayFrames >> 4;
  frame[o + 22] = ((f.delayFrames & 0xf) << 4) | (f.paddingFrames >> 8);
  frame[o + 23] = f.paddingFrames & 0xff;
  view.setUint32(o + 28, f.totalFileBytes); // music length = whole file, as the validator and LAME define it
  view.setUint16(o + 32, f.musicCrc);
  view.setUint16(o + 34, crc16(0, frame, 0, o + 34));
  return frame;
}
