import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../middleware/error-handler';
import { CODEC_PROFILES, isPublishableCodec } from './audio-codec';
import {
  Mp3StemStreamValidator, Mp3ValidationError, assertConsistentMp3Stems, assertIdentityContentEncoding, verifyMp3Stem,
  type Mp3StemManifest, type Mp3ValidationCode,
} from './mp3-stream-validator';
import { readRanged } from './ranged-reader';

const DECODER_DELAY = 529; // policy value observed on the Web reader's calibration probe; the validator never hardcodes it
const TAG_DELAY = 576;

function crc16(buf: Uint8Array, crc = 0): number {
  let c = crc;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
  return c & 0xffff;
}

interface Build {
  sampleRate?: 44100 | 48000;
  mpegFrames?: number;
  tagPadding?: number;
  flags?: number;
  seed?: number;
  decoderDelay?: number;
  /** Mutate the raw frames before CRCs/hash are computed ("structural" mutations that stay self-consistent). */
  tweak?: (frames: Buffer[]) => void;
  /** Mutate the manifest only. */
  manifest?: (m: Record<string, unknown>) => void;
  /** Mutate the Info block after its CRCs are written (to break them). */
  corruptInfo?: (info: Buffer) => void;
  /** No padding bits: frame sizes are the minimum, leaving the schema's size slack for trailing-byte tests. */
  noPad?: boolean;
}

function buildMp3(opts: Build = {}): { bytes: Buffer; manifest: Mp3StemManifest; offsets: number[] } {
  const sr = opts.sampleRate ?? 44100;
  const M = opts.mpegFrames ?? 12;
  const tagPadding = opts.tagPadding ?? 1000;
  const flags = opts.flags ?? 15;
  const srIdx = sr === 44100 ? 0 : 1;
  const base = Math.floor((144 * 256_000) / sr);
  let s = (opts.seed ?? 1) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
  const frames: Buffer[] = [];
  for (let i = 0; i <= M; i++) {
    const pad = sr === 44100 && !opts.noPad ? (i % 12 < 10 ? 1 : 0) : 0;
    const f = Buffer.alloc(base + pad);
    f[0] = 0xff; f[1] = 0xfb; f[2] = (13 << 4) | (srIdx << 2) | (pad << 1); f[3] = 0x40; // joint stereo
    if (i > 0) for (let k = 4; k < f.length; k++) f[k] = rnd();
    frames.push(f);
  }
  opts.tweak?.(frames);
  const total = frames.reduce((n, f) => n + f.length, 0);
  const info = frames[0];
  let o = 36;
  info.write('Info', o, 'latin1'); o += 4;
  info.writeUInt32BE(flags, o); o += 4;
  info.writeUInt32BE(M, o); o += 4; // frames: AUDIO frames, Info frame excluded
  info.writeUInt32BE(total, o); o += 4; // bytes: whole file
  if (flags & 4) o += 100;
  if (flags & 8) { info.writeUInt32BE(0, o); o += 4; }
  info.write('LAME3.100', o, 'latin1');
  info[o + 21] = TAG_DELAY >> 4; info[o + 22] = ((TAG_DELAY & 15) << 4) | (tagPadding >> 8); info[o + 23] = tagPadding & 255;
  info.writeUInt32BE(total, o + 28);
  info.writeUInt16BE(crc16(Buffer.concat(frames.slice(1))), o + 32);
  info.writeUInt16BE(crc16(info.subarray(0, o + 34)), o + 34);
  opts.corruptInfo?.(info);
  const bytes = Buffer.concat(frames);
  const dd = opts.decoderDelay ?? DECODER_DELAY;
  const manifestFrames = M * 1152 - TAG_DELAY - tagPadding;
  const manifest: Record<string, unknown> = {
    id: 'vocals', codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256,
    frames: manifestFrames, durationSeconds: manifestFrames / sr, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    alignment: { encoderDelayFrames: TAG_DELAY + dd, paddingFrames: tagPadding - dd, mpegAudioFrames: M, infoFrame: true },
  };
  opts.manifest?.(manifest);
  const offsets: number[] = []; let acc = 0; for (const f of frames) { offsets.push(acc); acc += f.length; }
  return { bytes, manifest: manifest as Mp3StemManifest, offsets };
}

function run(bytes: Uint8Array, manifest: Mp3StemManifest, chunk = bytes.length, options = {}) {
  const v = new Mp3StemStreamValidator(manifest, options);
  for (let i = 0; i < bytes.length; i += chunk) v.write(bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  return v.finish();
}

function code(fn: () => unknown): Mp3ValidationCode | 'NO_ERROR' {
  try { fn(); return 'NO_ERROR'; } catch (e) { return e instanceof Mp3ValidationError ? e.code : (`OTHER:${String(e)}` as never); }
}

describe('MP3 streaming validator (M22-C.5C, isolated)', () => {
  it('does NOT change the publication gate', () => {
    expect(isPublishableCodec('mp3_cbr256')).toBe(false);
    expect(CODEC_PROFILES.mp3_cbr256.serverByteValidation).toBe(false);
    expect(CODEC_PROFILES.pcm_s16le.serverByteValidation).toBe(true);
  });

  describe('accepts a valid stream with arbitrary chunking', () => {
    const { bytes, manifest } = buildMp3();
    it.each([1, 2, 3, 4, 5, 7, 35, 36, 37, 100, 835, 836, 837, 1671, 4096, 1 << 20])('chunk size %i', (n) => {
      const r = run(bytes, manifest, n, { expectedDecoderDelayFrames: DECODER_DELAY });
      expect(r).toMatchObject({ mpegAudioFrames: 12, tagDelayFrames: TAG_DELAY, tagPaddingFrames: 1000, decoderDelayFrames: DECODER_DELAY, encoder: 'LAME3.100' });
      expect(r.peakBufferedBytes).toBeLessThanOrEqual(836);
    });
    it('random chunk boundaries (seeded) give the same result', () => {
      let seed = 7;
      for (let round = 0; round < 40; round++) {
        const v = new Mp3StemStreamValidator(manifest);
        for (let i = 0; i < bytes.length;) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const n = 1 + (seed >>> 8) % 900; v.write(bytes.subarray(i, i + n)); i += n; }
        expect(v.finish().sha256).toBe(manifest.sha256);
      }
    });
    it.each([[48000, 7], [44100, 3], [44100, 1], [48000, 1]] as const)('%i Hz, %i MPEG frames, flags with/without TOC and quality', (sr, M) => {
      for (const flags of [3, 7, 11, 15]) {
        const b = buildMp3({ sampleRate: sr, mpegFrames: M, flags, tagPadding: 560 });
        expect(run(b.bytes, b.manifest, 333).mpegAudioFrames).toBe(M);
      }
    });
    it('tolerates a joint-stereo/stereo switch between frames and private/copyright/original bits', () => {
      const b = buildMp3({ tweak: (f) => { f[3][3] = 0x00; f[5][3] = 0x4c; f[6][2] |= 1; } });
      expect(run(b.bytes, b.manifest, 11).mpegAudioFrames).toBe(12);
    });
  });

  describe('rejects malformed data', () => {
    const base = buildMp3({ noPad: true });
    const O = base.offsets;
    const at = (patch: (b: Buffer) => void) => { const b = Buffer.from(base.bytes); patch(b); return b; };
    /** Keeps the declared size (a mismatch must be caught from the bytes); only refreshes the hash. */
    const withSha = (b: Buffer, size = base.manifest.sizeBytes) => ({ ...base.manifest, sizeBytes: size, sha256: createHash('sha256').update(b).digest('hex') } as Mp3StemManifest);

    it.each([
      ['ID3v2 prefix (10 bytes, same declared size)', () => Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00'), base.bytes.subarray(10)]), 'ID3'],
      ['leading garbage', () => Buffer.concat([Buffer.from([0, 0, 0, 0]), base.bytes.subarray(4)]), 'LEADING_GARBAGE'],
      ['bytes beyond the declared size (1 byte)', () => Buffer.concat([base.bytes, Buffer.from([0])]), 'TOO_LARGE'],
      ['200 bytes beyond the declared size', () => Buffer.concat([base.bytes, Buffer.alloc(200, 0x41)]), 'TOO_LARGE'],
      ['ID3v1 TAG appended', () => Buffer.concat([base.bytes, Buffer.from('TAG'), Buffer.alloc(125)]), 'TOO_LARGE'],
      ['a whole extra frame appended', () => Buffer.concat([base.bytes, base.bytes.subarray(O[3], O[4])]), 'TOO_LARGE'],
    ] as const)('%s', (_n, make, expected) => {
      const bytes = make();
      for (const chunk of [1, 97, bytes.length]) expect(code(() => run(bytes, withSha(bytes), chunk))).toBe(expected);
    });

    it('trailing bytes that DO fit the declared size are still rejected with the exact reason', () => {
      // Raise the declared size by up to the schema slack so the extra bytes reach the frame parser.
      for (const [extra, expected] of [[[0], 'TRAILING_BYTES'], [[0, 0, 0], 'TRAILING_BYTES'], [[0xff, 0xfb, 0xd0], 'TRAILING_BYTES'], [[0xff, 0xfb, 0xd0, 0x40], 'TOO_MANY_FRAMES'], [[0x41, 0x41, 0x41, 0x41, 0x41, 0x41], 'TRAILING_BYTES']] as const) {
        const b = Buffer.concat([base.bytes, Buffer.from(extra)]);
        const m = withSha(b, b.length);
        for (const chunk of [1, 5, b.length]) expect(code(() => run(b, m, chunk)), `${extra.length} bytes @${chunk}`).toBe(expected);
      }
    });

    it('a validator that has thrown stays invalid even if the caller swallows the error', () => {
      const v = new Mp3StemStreamValidator(base.manifest);
      expect(code(() => v.write(Buffer.from([0, 0, 0, 0])))).toBe('LEADING_GARBAGE');
      expect(code(() => v.write(base.bytes))).toBe('INVALID_INPUT');
      expect(code(() => v.finish())).toBe('INVALID_INPUT');
    });

    it('declared size larger than the bytes (including cuts inside a header, the Info frame and the last frame)', () => {
      const cuts = [0, 1, 2, 3, 4, 5, 36, 100, 400, 834, 835, 836, 837, 838, 839, 1500, base.bytes.length - 2, base.bytes.length - 1];
      for (const cut of cuts) {
        const b = base.bytes.subarray(0, cut);
        // A cut exactly on a frame boundary is a clean but short stream: the frame count catches it.
        const expected = cut === 0 ? 'TRUNCATED' : O.includes(cut) ? 'FRAME_COUNT' : 'TRUNCATED';
        expect(code(() => run(b, withSha(Buffer.from(b)), 61)), `cut ${cut}`).toBe(expected);
      }
    });

    it('size differs even though the whole structure is valid', () => {
      const m = { ...base.manifest, sizeBytes: base.manifest.sizeBytes + 1 } as Mp3StemManifest;
      expect(code(() => run(base.bytes, m))).toBe('SIZE');
    });

    it.each([
      ['bitrate 128 in a later frame', (b: Buffer) => { b[O[3] + 2] = (b[O[3] + 2] & 0x0f) | (9 << 4); }, 'BAD_HEADER'],
      ['bitrate 320 in the Info frame', (b: Buffer) => { b[2] = (b[2] & 0x0f) | (14 << 4); }, 'BAD_HEADER'],
      ['free-format bitrate', (b: Buffer) => { b[2] &= 0x0f; }, 'BAD_HEADER'],
      ['bad bitrate index 15', (b: Buffer) => { b[2] |= 0xf0; }, 'BAD_HEADER'],
      ['MPEG-2 (version bits 10)', (b: Buffer) => { b[1] = 0xf3; }, 'BAD_HEADER'],
      ['MPEG-2.5', (b: Buffer) => { b[1] = 0xe3; }, 'BAD_HEADER'],
      ['Layer II', (b: Buffer) => { b[1] = 0xfd; }, 'BAD_HEADER'],
      ['Layer I', (b: Buffer) => { b[1] = 0xff; }, 'BAD_HEADER'],
      ['reserved layer', (b: Buffer) => { b[1] = 0xf9; }, 'BAD_HEADER'],
      ['sample rate 48 kHz in a 44.1 kHz stream', (b: Buffer) => { b[2] = (b[2] & 0xf3) | (1 << 2); }, 'BAD_HEADER'],
      ['sample rate 32 kHz', (b: Buffer) => { b[2] = (b[2] & 0xf3) | (2 << 2); }, 'BAD_HEADER'],
      ['reserved sample rate', (b: Buffer) => { b[2] |= 0x0c; }, 'BAD_HEADER'],
      ['mono frame', (b: Buffer) => { b[O[2] + 3] = 0xc0; }, 'UNSUPPORTED_STREAM'],
      ['dual channel frame', (b: Buffer) => { b[O[2] + 3] = 0x80; }, 'UNSUPPORTED_STREAM'],
      ['CRC-protected frame', (b: Buffer) => { b[O[4] + 1] = 0xfa; }, 'UNSUPPORTED_STREAM'],
      ['emphasis set', (b: Buffer) => { b[O[4] + 3] |= 1; }, 'UNSUPPORTED_STREAM'],
      ['lost sync mid-stream', (b: Buffer) => { b[O[5]] = 0x00; }, 'BAD_HEADER'],
      ['sync bits partly wrong', (b: Buffer) => { b[O[5] + 1] &= 0x1f; }, 'BAD_HEADER'],
    ] as const)('%s', (_n, patch, expected) => {
      const b = at(patch as (b: Buffer) => void);
      for (const chunk of [1, 211]) expect(code(() => run(b, withSha(b), chunk))).toBe(expected);
    });

    it('a flipped padding bit shifts every later frame boundary and is rejected', () => {
      const b = at((x) => { x[O[2] + 2] ^= 0x02; });
      // The frame grows by one byte, so the next header is read one byte late and fails the sync check.
      expect(code(() => run(b, withSha(b), 77))).toBe('BAD_HEADER');
    });

    it('a stream with 32 kHz headers but a 44.1 kHz descriptor is rejected', () => {
      const m = buildMp3({ tweak: (f) => { for (const x of f) x[2] = (x[2] & 0xf3) | (2 << 2); } });
      expect(code(() => run(m.bytes, m.manifest))).toBe('BAD_HEADER');
    });

    describe('Info/Xing and LAME tag', () => {
      const cases: Array<[string, Build, Mp3ValidationCode]> = [
        ['no Info/Xing tag name', { corruptInfo: (i) => { i.write('XXXX', 36, 'latin1'); i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } }, 'BAD_INFO_FRAME'],
        ['Info frame carries non-zero side info', { tweak: (f) => { f[0][10] = 1; } }, 'BAD_INFO_FRAME'],
        ['frames flag missing', { flags: 2 }, 'BAD_INFO_FRAME'],
        ['bytes flag missing', { flags: 1 }, 'BAD_INFO_FRAME'],
        ['unknown flag bits', { flags: 0x13 }, 'BAD_INFO_FRAME'],
      ];
      for (const [name, build, expected] of cases) {
        it(name, () => { const b = buildMp3(build); expect(code(() => run(b.bytes, b.manifest, 50))).toBe(expected); });
      }
      it('a plain audio frame (no Info frame) first', () => {
        const b = buildMp3({ corruptInfo: (i) => { for (let k = 4; k < 190; k++) i[k] = 0x55; i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('BAD_INFO_FRAME');
      });
      it('non-zero bytes after the LAME tag', () => {
        const b = buildMp3({ corruptInfo: (i) => { i[i.length - 1] = 9; } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('BAD_INFO_FRAME');
      });
      it('blank encoder string', () => {
        const b = buildMp3({ corruptInfo: (i) => { i.fill(0x20, 156, 165); i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } });
        // Tag CRC recomputed: the structure check is what must reject it.
        expect(code(() => run(b.bytes, b.manifest))).toBe('BAD_INFO_FRAME');
      });
      it('tag CRC corrupted', () => {
        const b = buildMp3({ corruptInfo: (i) => { i[190] ^= 1; } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('CRC');
      });
      it('music CRC corrupted (payload bit flip after hashing is also a SHA error elsewhere)', () => {
        const b = buildMp3({ corruptInfo: (i) => { i[188] ^= 1; i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('CRC');
      });
      it('one flipped payload byte is caught by the music CRC even when the manifest SHA is recomputed to match', () => {
        const good = buildMp3();
        const flipped = Buffer.from(good.bytes); flipped[2000] ^= 0x10;
        const m = { ...good.manifest, sha256: createHash('sha256').update(flipped).digest('hex') } as Mp3StemManifest;
        expect(code(() => run(flipped, m))).toBe('CRC');
      });
      it('tag frame count off by one (Info frame counted as audio)', () => {
        const b = buildMp3({ corruptInfo: (i) => { i.writeUInt32BE(13, 44); i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('TAG_MISMATCH');
      });
      it('tag byte count differs from the file size', () => {
        const b = buildMp3({ corruptInfo: (i) => { i.writeUInt32BE(i.readUInt32BE(48) + 1, 48); i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('TAG_MISMATCH');
      });
      it('LAME music length differs from the file size', () => {
        const b = buildMp3({ corruptInfo: (i) => { i.writeUInt32BE(1, 184); i.writeUInt16BE(crc16(i.subarray(0, 190)), 190); } });
        expect(code(() => run(b.bytes, b.manifest))).toBe('TAG_MISMATCH');
      });
    });

    describe('declared metadata that disagrees with the bytes', () => {
      const m = (patch: (x: Record<string, any>) => void, build: Build = {}) => buildMp3({ ...build, manifest: patch });
      it.each([
        ['sha256', (x: Record<string, any>) => { x.sha256 = 'a'.repeat(64); }, 'SHA256'],
                ['mpegAudioFrames +1 (padding −1152 keeps the sum)', (x: Record<string, any>) => { x.alignment.mpegAudioFrames += 1; x.alignment.paddingFrames += 1152; x.sizeBytes += 0; }, 'INVALID_DESCRIPTOR'],
        ['canonical frames +1 with padding −1', (x: Record<string, any>) => { x.frames += 1; x.durationSeconds = x.frames / x.sampleRate; x.alignment.paddingFrames -= 1; }, 'ALIGNMENT'],
        ['canonical frames −1 with delay +1', (x: Record<string, any>) => { x.frames -= 1; x.durationSeconds = x.frames / x.sampleRate; x.alignment.encoderDelayFrames += 1; }, 'ALIGNMENT'],
        ['infoFrame false', (x: Record<string, any>) => { x.alignment.infoFrame = false; }, 'INVALID_DESCRIPTOR'],
        ['bitrate 128', (x: Record<string, any>) => { x.bitrateKbps = 128; }, 'INVALID_DESCRIPTOR'],
        ['mono', (x: Record<string, any>) => { x.channels = 1; }, 'INVALID_DESCRIPTOR'],
        ['unknown codec', (x: Record<string, any>) => { x.codec = 'pcm_s16le'; }, 'INVALID_DESCRIPTOR'],
      ] as const)('%s', (_n, patch, expected) => {
        const b = m(patch as never);
        expect(code(() => run(b.bytes, b.manifest, 200))).toBe(expected);
      });
      it.each([[1], [-1]])('delay %i / padding %i keeps both sums: only the policy pin (or cross-stem consistency) can see it', (k) => {
        const b = m((x) => { x.alignment.encoderDelayFrames += k; x.alignment.paddingFrames -= k; });
        const r = run(b.bytes, b.manifest);
        expect(r.decoderDelayFrames).toBe(DECODER_DELAY + k); // exposed, so an unpinned caller can still compare stems
        expect(code(() => run(b.bytes, b.manifest, 64, { expectedDecoderDelayFrames: DECODER_DELAY }))).toBe('ALIGNMENT');
      });
      it('declared delay below the tag delay (negative decoder delay)', () => {
        const b = m((x) => { x.alignment.encoderDelayFrames = 500; x.alignment.paddingFrames = 1576 - 500; });
        expect(code(() => run(b.bytes, b.manifest))).toBe('ALIGNMENT');
      });
      it('decoder delay above one MPEG frame', () => {
        const b = buildMp3({ decoderDelay: 1153, tagPadding: 2200 });
        expect(code(() => run(b.bytes, b.manifest))).toBe('ALIGNMENT');
      });
      it('policy pin: a different decoder delay is rejected only when a policy value is configured', () => {
        const b = buildMp3({ decoderDelay: 100 });
        expect(run(b.bytes, b.manifest).decoderDelayFrames).toBe(100);
        expect(code(() => run(b.bytes, b.manifest, 64, { expectedDecoderDelayFrames: DECODER_DELAY }))).toBe('ALIGNMENT');
      });
      it('size above the profile ceiling is rejected by the descriptor, never read', () => {
        const b = m((x) => { x.sizeBytes = CODEC_PROFILES.mp3_cbr256.maxBytes + 1; });
        expect(code(() => new Mp3StemStreamValidator(b.manifest))).toBe('INVALID_DESCRIPTOR');
      });
    });

    it('stops at the first byte beyond the declared size without hashing the whole oversized input', () => {
      const big = Buffer.concat([base.bytes, Buffer.alloc(50_000, 0xff)]);
      const v = new Mp3StemStreamValidator(base.manifest);
      expect(code(() => { v.write(big.subarray(0, base.bytes.length)); v.write(big.subarray(base.bytes.length)); })).toBe('TOO_LARGE');
    });
  });

  describe('storage-facing wrapper (verifyMp3Stem)', () => {
    const { bytes, manifest } = buildMp3({ mpegFrames: 40 });
    it('accepts a Node Readable, an async generator and the R2 ranged reader', async () => {
      expect((await verifyMp3Stem(Readable.from([bytes]), manifest, 422)).mpegAudioFrames).toBe(40);
      async function* gen() { for (let i = 0; i < bytes.length; i += 333) yield bytes.subarray(i, i + 333); }
      expect((await verifyMp3Stem(gen(), manifest, 409)).sha256).toBe(manifest.sha256);
      const reader = readRanged({
        size: bytes.length, partBytes: 1000, concurrency: 3, signal: new AbortController().signal,
        fetchPart: async (start, end) => Buffer.from(bytes.subarray(start, end + 1)),
      });
      expect((await verifyMp3Stem(reader, manifest, 409)).sizeBytes).toBe(bytes.length);
    });
    it('forwards verified chunks to a sink in order', async () => {
      const seen: Buffer[] = [];
      await verifyMp3Stem(Readable.from([bytes.subarray(0, 100), bytes.subarray(100)]), manifest, 422, { sink: (c) => { seen.push(Buffer.from(c)); } });
      expect(Buffer.concat(seen).equals(bytes)).toBe(true);
    });
    it('maps failures to a generic AppError whose cause is not serializable', async () => {
      const flipped = Buffer.from(bytes); flipped[1500] ^= 1;
      const error = await verifyMp3Stem(Readable.from([flipped]), manifest, 422).catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(422);
      expect(error.message).toBe('O stem MP3 não corresponde ao manifesto de áudio.');
      expect((error.cause as Mp3ValidationError).code).toBe('CRC');
      expect(JSON.stringify(error)).not.toMatch(/CRC|cause/);
    });
    it.each(['gzip', 'br', 'identity, gzip', ['identity', 'deflate']])('rejects Content-Encoding %j', async (enc) => {
      const error = await verifyMp3Stem(Readable.from([bytes]), manifest, 422, { contentEncoding: enc as never }).catch((e) => e);
      expect((error.cause as Mp3ValidationError).code).toBe('CONTENT_ENCODING');
    });
    it.each([undefined, null, '', 'identity', 'Identity', ['identity']])('accepts Content-Encoding %j', (enc) => {
      expect(() => assertIdentityContentEncoding(enc as never)).not.toThrow();
    });
    it('propagates abort', async () => {
      const c = new AbortController();
      async function* gen() { yield bytes.subarray(0, 10); c.abort(); yield bytes.subarray(10); }
      await expect(verifyMp3Stem(gen(), manifest, 422, { signal: c.signal })).rejects.toThrow();
    });
    it('a source that fails mid-stream is not reported as valid', async () => {
      async function* gen() { yield bytes.subarray(0, 500); throw new Error('socket closed'); }
      await expect(verifyMp3Stem(gen(), manifest, 422)).rejects.toThrow('socket closed');
    });
  });

  it('assertConsistentMp3Stems requires one timeline and one decoder delay across the six stems', () => {
    const ids = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
    const results = ids.map((id, i) => {
      const b = buildMp3({ seed: i + 1, manifest: (m) => { m.id = id; } });
      return run(b.bytes, b.manifest);
    });
    expect(() => assertConsistentMp3Stems(results)).not.toThrow();
    expect(code(() => assertConsistentMp3Stems([...results.slice(0, 5), { ...results[5], decoderDelayFrames: 1 }]))).toBe('INCONSISTENT_SET');
    expect(code(() => assertConsistentMp3Stems([...results.slice(0, 5), { ...results[5], frames: results[5].frames + 1 }]))).toBe('INCONSISTENT_SET');
    expect(code(() => assertConsistentMp3Stems([...results.slice(0, 5), results[0]]))).toBe('INCONSISTENT_SET');
    expect(code(() => assertConsistentMp3Stems([]))).toBe('INCONSISTENT_SET');
  });

  it('keeps memory O(1): a 300 s, 48 kHz stream fed in 64 KiB chunks retains only one Info frame', () => {
    const M = 12_501;
    const b = buildMp3({ sampleRate: 48000, mpegFrames: M, tagPadding: 576 });
    expect(b.bytes.length).toBeGreaterThan(9_000_000);
    const v = new Mp3StemStreamValidator(b.manifest);
    for (let i = 0; i < b.bytes.length; i += 65_536) v.write(b.bytes.subarray(i, i + 65_536));
    const result = v.finish();
    // Deterministic bound: the only retained bytes are one Info frame. Heap growth is measured by scripts/m22c5c/bench.ts.
    expect(result.peakBufferedBytes).toBeLessThanOrEqual(769);
    expect(result.mpegAudioFrames).toBe(M);
  });

  // ---- Real libmp3lame output, versioned in shared/fixtures (no ffmpeg at test time; a missing file FAILS, never skips) ----
  const FIXTURES = join(__dirname, '../../../../shared/fixtures/ministry-audio-mp3-v1');
  const probes = JSON.parse(readFileSync(join(FIXTURES, 'probes.json'), 'utf8'));
  const realCases = JSON.parse(readFileSync(join(FIXTURES, 'real-encoder-cases.json'), 'utf8')) as {
    decoderDelayPolicyFrames: number;
    cases: Array<{ name: string; expect: { ok: true } | { code: Mp3ValidationCode }; manifest: Mp3StemManifest; sha256: string; base64: string }>;
  };

  describe('shared fixtures: envelope and integrity', () => {
    it('are present, versioned and self-consistent', () => {
      expect(probes).toMatchObject({ format: 'louvaio.ministry-audio-mp3-probes', version: 1 });
      expect(Object.keys(probes.probes).sort()).toEqual(['44100', '48000']);
      expect(realCases.cases.length).toBeGreaterThanOrEqual(11);
      expect(realCases.decoderDelayPolicyFrames).toBe(DECODER_DELAY);
      for (const c of realCases.cases) expect(createHash('sha256').update(Buffer.from(c.base64, 'base64')).digest('hex'), c.name).toBe(c.sha256);
      for (const p of Object.values<any>(probes.probes)) expect(createHash('sha256').update(Buffer.from(p.base64, 'base64')).digest('hex')).toBe(p.sha256);
    });
    it('keeps the fixture size small (they are committed)', () => {
      expect(JSON.stringify(realCases).length + JSON.stringify(probes).length).toBeLessThan(160 * 1024);
    });
  });

  describe('real encoder fixtures (structure, SHA-256 and alignment are validated separately below)', () => {
    for (const c of realCases.cases) {
      it(`${c.name}: ${'ok' in c.expect ? 'accepted' : `rejected with ${c.expect.code}`} at every chunking`, () => {
        const bytes = Buffer.from(c.base64, 'base64');
        for (const chunk of [1, 7, 836, 4096, bytes.length]) {
          const outcome = code(() => run(bytes, c.manifest, chunk, { expectedDecoderDelayFrames: realCases.decoderDelayPolicyFrames }));
          expect(outcome, `chunk ${chunk}`).toBe('ok' in c.expect ? 'NO_ERROR' : c.expect.code);
        }
      });
    }
    it('every single-byte flip in the valid real files is rejected: by SHA-256 as declared, and by structure/CRC even when the SHA is recomputed', () => {
      for (const c of realCases.cases.filter((x) => 'ok' in x.expect && x.base64.length < 40_000)) {
        const bytes = Buffer.from(c.base64, 'base64');
        for (let i = 0; i < bytes.length; i += 5) {
          const f = Buffer.from(bytes); f[i] ^= 0x01;
          expect(code(() => run(f, c.manifest, 997)), `${c.name}@${i} (declared SHA kept)`).not.toBe('NO_ERROR');
          const recomputed = { ...c.manifest, sha256: createHash('sha256').update(f).digest('hex') } as Mp3StemManifest;
          const outcome = code(() => run(f, recomputed, 997));
          expect(['NO_ERROR', 'SHA256'], `${c.name}@${i} (SHA recomputed)`).not.toContain(outcome);
        }
      }
    });
    it('Info "frames" excludes the Info frame and "bytes" is the whole file (measured on real output)', () => {
      for (const c of realCases.cases.filter((x) => 'ok' in x.expect)) {
        const bytes = Buffer.from(c.base64, 'base64');
        expect(bytes.readUInt32BE(44), c.name).toBe(c.manifest.alignment.mpegAudioFrames);
        expect(bytes.readUInt32BE(48), c.name).toBe(bytes.length);
      }
    });
  });

  describe('separated concerns on the same real bytes', () => {
    const probe = probes.probes['44100'];
    const bytes = Buffer.from(probe.base64, 'base64');
    const manifest = { id: 'vocals', codec: 'mp3_cbr256', sampleRate: 44100, channels: 2, bitrateKbps: 256, frames: probe.frames, durationSeconds: probe.frames / 44100, sizeBytes: bytes.length, sha256: probe.sha256, alignment: probe.alignment } as Mp3StemManifest;

    it('1) structural validation fails on a bad frame even though SHA-256 was recomputed to match', () => {
      let second = 0; // start of the second audio frame, found by walking the real frame lengths
      for (let n = 0; n < 2; n++) second += 835 + ((bytes[second + 2] >> 1) & 1);
      const f = Buffer.from(bytes); f[second + 2] = (f[second + 2] & 0x0f) | (9 << 4);
      const m = { ...manifest, sha256: createHash('sha256').update(f).digest('hex') } as Mp3StemManifest;
      expect(code(() => run(f, m))).toBe('BAD_HEADER');
    });
    it('2) SHA-256 integrity fails on an unchanged structure with a different declared hash', () => {
      expect(code(() => run(bytes, { ...manifest, sha256: 'b'.repeat(64) } as Mp3StemManifest))).toBe('SHA256');
    });
    it('3) alignment fails on valid structure and hash when only the declared split is wrong (policy pinned)', () => {
      const a = probe.alignment;
      const m = { ...manifest, alignment: { ...a, encoderDelayFrames: a.encoderDelayFrames + 3, paddingFrames: a.paddingFrames - 3 } } as Mp3StemManifest;
      expect(code(() => run(bytes, m, 64, { expectedDecoderDelayFrames: DECODER_DELAY }))).toBe('ALIGNMENT');
      expect(code(() => run(bytes, manifest, 64, { expectedDecoderDelayFrames: DECODER_DELAY }))).toBe('NO_ERROR');
    });
    it.each([44100, 48000])('%i Hz probe: tag numbers equal the manifest the Web reader calibrates with', (sr) => {
      const p = probes.probes[String(sr)];
      const b = Buffer.from(p.base64, 'base64');
      const m = { id: 'vocals', codec: 'mp3_cbr256', sampleRate: sr, channels: 2, bitrateKbps: 256, frames: p.frames, durationSeconds: p.frames / sr, sizeBytes: b.length, sha256: p.sha256, alignment: p.alignment } as Mp3StemManifest;
      const r = run(b, m, 123, { expectedDecoderDelayFrames: DECODER_DELAY });
      expect(r).toMatchObject({ mpegAudioFrames: p.alignment.mpegAudioFrames, tagDelayFrames: 576, decoderDelayFrames: p.alignment.encoderDelayFrames - 576 });
      expect(r.tagDelayFrames + r.tagPaddingFrames).toBe(p.alignment.encoderDelayFrames + p.alignment.paddingFrames);
    });
  });

  describe('storage-facing failure modes', () => {
    const { bytes, manifest } = buildMp3({ mpegFrames: 40 });

    it('a sink that fails after a partial write rejects with the sink error and stops reading the source', async () => {
      let produced = 0, closed = false, written = 0;
      async function* gen() { try { for (let i = 0; i < bytes.length; i += 500) { produced++; yield bytes.subarray(i, i + 500); } } finally { closed = true; } }
      const sink = async (chunk: Uint8Array) => { written += chunk.length; if (written > 1500) throw new Error('disk full'); };
      await expect(verifyMp3Stem(gen(), manifest, 422, { sink })).rejects.toThrow('disk full');
      expect(closed).toBe(true);
      expect(produced).toBeLessThan(Math.ceil(bytes.length / 500)); // the source was not drained after the failure
      expect(written).toBe(2000); // the caller can tell exactly how much unverified data it must discard
    });

    it('rejection mid-stream (invalid header) closes the source and never resolves as valid', async () => {
      const bad = Buffer.from(bytes); bad[836 * 3 + 1] = 0x00;
      let closed = false;
      async function* gen() { try { for (let i = 0; i < bad.length; i += 100) yield bad.subarray(i, i + 100); } finally { closed = true; } }
      const error = await verifyMp3Stem(gen(), manifest, 409).catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(closed).toBe(true);
    });

    it('cancellation before the first chunk and between chunks both reject and close the source', async () => {
      for (const when of ['before', 'between'] as const) {
        const c = new AbortController();
        if (when === 'before') c.abort();
        let closed = false;
        async function* gen() { try { yield bytes.subarray(0, 100); if (when === 'between') c.abort(); yield bytes.subarray(100); } finally { closed = true; } }
        await expect(verifyMp3Stem(gen(), manifest, 422, { signal: c.signal })).rejects.toThrow();
        expect(closed).toBe(true);
      }
    });

    it('adversarial chunking: an oversized chunk is never read past the declared size', () => {
      // A valid file followed by 5 MB of junk in ONE chunk: the valid prefix is processed, the excess refused.
      const v = new Mp3StemStreamValidator(manifest);
      expect(code(() => v.write(Buffer.concat([bytes, Buffer.alloc(5_000_000, 0xff)])))).toBe('TOO_LARGE');
      expect(v.bytesRead).toBe(manifest.sizeBytes);
      // All-junk oversized chunk: the in-bounds prefix is judged first (bad header), still bounded by sizeBytes.
      const w = new Mp3StemStreamValidator(manifest);
      expect(code(() => w.write(Buffer.alloc(manifest.sizeBytes + 1, 0xff)))).toBe('BAD_HEADER');
      expect(w.bytesRead).toBeLessThanOrEqual(manifest.sizeBytes);
    });

    it('adversarial chunking: 200k empty chunks then 1-byte chunks never buffer more than one Info frame', () => {
      const v = new Mp3StemStreamValidator(manifest);
      const empty = new Uint8Array(0);
      for (let i = 0; i < 200_000; i++) v.write(empty);
      for (let i = 0; i < bytes.length; i++) v.write(bytes.subarray(i, i + 1));
      const r = v.finish();
      expect(r.mpegAudioFrames).toBe(40);
      expect(r.peakBufferedBytes).toBeLessThanOrEqual(836);
    });

    it('exact-room chunk is accepted; any byte after completion (zero room) is refused', () => {
      const v = new Mp3StemStreamValidator(manifest);
      v.write(bytes.subarray(0, bytes.length - 10));
      v.write(bytes.subarray(bytes.length - 10)); // exactly the remaining room
      expect(code(() => v.write(Buffer.from([0])))).toBe('TOO_LARGE'); // zero room
      expect(v.bytesRead).toBe(bytes.length);
    });

    it('early rejections (Content-Encoding, descriptor) close an unstarted source', async () => {
      const stream = Readable.from([bytes]);
      await expect(verifyMp3Stem(stream, manifest, 422, { contentEncoding: 'gzip' })).rejects.toBeInstanceOf(AppError);
      await new Promise((r) => setImmediate(r));
      expect(stream.destroyed).toBe(true);
      const stream2 = Readable.from([bytes]);
      await expect(verifyMp3Stem(stream2, { ...manifest, sha256: 'x' } as Mp3StemManifest, 422)).rejects.toBeInstanceOf(AppError);
      await new Promise((r) => setImmediate(r));
      expect(stream2.destroyed).toBe(true);
      let finalized = false;
      async function* gen() { try { yield bytes; } finally { finalized = true; } }
      const g = gen();
      await expect(verifyMp3Stem(g, manifest, 422, { contentEncoding: 'br' })).rejects.toBeInstanceOf(AppError);
      expect((await g.next()).done).toBe(true); // the unstarted generator was closed, not left pending
      expect(finalized).toBe(false); // never entered its body: nothing was read
    });

    it('a Uint8Array that is a view into a larger buffer is read from its own offset, not the whole backing store', () => {
      const backing = new Uint8Array(bytes.length + 1000).fill(0xaa);
      backing.set(bytes, 500);
      expect(run(backing.subarray(500, 500 + bytes.length), manifest, 313).mpegAudioFrames).toBe(40);
    });
  });

  it('decoderDelayFrames policy is pending: unpinned runs expose the value instead of guessing it', () => {
    const results = [0, 1, 2].map((i) => run(...(() => { const b = buildMp3({ seed: i + 1, decoderDelay: 300 + i }); return [b.bytes, b.manifest] as const; })()));
    expect(results.map((r) => r.decoderDelayFrames)).toEqual([300, 301, 302]);
    expect(code(() => assertConsistentMp3Stems(results.map((r, i) => ({ ...r, id: `s${i}` }))))).toBe('INCONSISTENT_SET');
  });
});
