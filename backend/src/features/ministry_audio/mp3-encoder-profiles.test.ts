import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  MP3_ENCODER_PROFILE_LAME_WASM, MP3_ENCODER_PROFILE_LAVC, MP3_ENCODER_PROFILES, MP3_PUBLICATION_VALIDATION, selectMp3EncoderProfile,
} from './mp3-encoder-profile';
import { assertConsistentMp3Stems, Mp3StemStreamValidator, type Mp3StemManifest } from './mp3-stream-validator';
import { mp3FactsMatch, mp3FactsOf, verifyStemBytes } from './stem-codec';

// M22-S3: the supported MP3 encoder profiles. Fixtures come from the REAL Web encoder (LAME 3.100 WebAssembly) and from
// the original ffmpeg fixtures; neither profile may relax the other.

const root = path.resolve(__dirname, '../../../../shared/fixtures');
const web = JSON.parse(readFileSync(path.join(root, 'ministry-audio-mp3-v2-lame/web-encoder-cases.json'), 'utf8')) as {
  sixStems44100: { manifest: Mp3StemManifest; base64: string }[];
  singleStem48000: { manifest: Mp3StemManifest; base64: string }[];
};
const lavcCases = JSON.parse(readFileSync(path.join(root, 'ministry-audio-mp3-v1/real-encoder-cases.json'), 'utf8')) as {
  cases: { name: string; expect: { ok: boolean }; manifest: Mp3StemManifest; base64?: string }[];
};
const bytesOf = (s: { base64: string }) => Buffer.from(s.base64, 'base64');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function crc16(bytes: Uint8Array): number {
  let c = 0;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
  return c;
}
/** The Web encoder's Info frame has no TOC: the LAME block starts at 52 (ffmpeg's, with TOC, at 156). The tag CRC sits 34 bytes later. */
const WEB_TAG = 52;
function retag(bytes: Buffer, change: (b: Buffer) => void, o = WEB_TAG): Buffer {
  const out = Buffer.from(bytes);
  change(out);
  out.writeUInt16BE(crc16(out.subarray(0, o + 34)), o + 34);
  return out;
}
const reDeclare = (manifest: Mp3StemManifest, bytes: Buffer): Mp3StemManifest => ({ ...manifest, sha256: sha(bytes) });

async function validate(bytes: Buffer, manifest: Mp3StemManifest, chunk = 65_536) {
  const chunks: Buffer[] = [];
  for (let o = 0; o < bytes.length; o += chunk) chunks.push(bytes.subarray(o, o + chunk));
  const r = await verifyStemBytes(Readable.from(chunks), manifest, 422);
  return mp3FactsOf(r)!;
}

describe('MP3 encoder profile selection', () => {
  it('has two explicit profiles with disjoint identification prefixes', () => {
    expect(MP3_ENCODER_PROFILES.map((p) => p.id)).toEqual(['lavc-libmp3lame-576-529', 'lame-3.100-wasm-576-529']);
    for (const a of MP3_ENCODER_PROFILES) for (const b of MP3_ENCODER_PROFILES) {
      if (a === b) continue;
      for (const x of a.encoderPrefixes) for (const y of b.encoderPrefixes) expect(x.startsWith(y) || y.startsWith(x)).toBe(false);
    }
  });

  it('selects exactly one profile from the identification, or none', () => {
    expect(selectMp3EncoderProfile('Lavc61.19')).toBe(MP3_ENCODER_PROFILE_LAVC);
    expect(selectMp3EncoderProfile('LAME3.100')).toBe(MP3_ENCODER_PROFILE_LAME_WASM);
    for (const other of ['LAME3.99r', 'LAME3.101', 'lame3.100', 'Lavd61.19', 'Xing     ', '         ']) expect(selectMp3EncoderProfile(other), other).toBeUndefined();
  });

  it('production validation lists both profiles and does not carry single-profile overrides that could contradict them', () => {
    expect(MP3_PUBLICATION_VALIDATION.profiles).toBe(MP3_ENCODER_PROFILES);
    expect(Object.keys(MP3_PUBLICATION_VALIDATION)).toEqual(['profiles']);
  });
});

describe('real Web encoder (LAME 3.100 WASM) under the production profiles', () => {
  it.each([4096, 65_536, 7])('accepts the six stems at 44.1 kHz, chunked by %i bytes, and they are mutually consistent', async (chunk) => {
    const facts: Awaited<ReturnType<typeof validate>>[] = [];
    for (const stem of web.sixStems44100) facts.push(await validate(bytesOf(stem), stem.manifest, chunk));
    expect(facts.every((f) => f.encoder === 'LAME3.100' && f.tagDelayFrames === 576 && f.decoderDelayFrames === 529)).toBe(true);
    expect(() => assertConsistentMp3Stems(facts)).not.toThrow();
    web.sixStems44100.forEach((stem, i) => expect(mp3FactsMatch(stem.manifest, facts[i])).toBe(true));
  });

  it('accepts a 48 kHz stem', async () => {
    const stem = web.singleStem48000[0]!;
    const facts = await validate(bytesOf(stem), stem.manifest);
    expect(facts).toMatchObject({ sampleRate: 48_000, encoder: 'LAME3.100', decoderDelayFrames: 529 });
  });

  it('streams in one pass: the Info frame is the only buffered part', () => {
    const stem = web.sixStems44100[0]!;
    const validator = new Mp3StemStreamValidator(stem.manifest, MP3_PUBLICATION_VALIDATION);
    validator.write(bytesOf(stem));
    expect(validator.finish().peakBufferedBytes).toBeLessThanOrEqual(1_000);
  });

  it('refuses a LAME stream whose tag delay, decoder delay or declared alignment leaves the profile', async () => {
    const stem = web.sixStems44100[0]!;
    const original = bytesOf(stem);
    // tag delay 577 (tag is internally consistent: CRC recomputed, manifest redeclared)
    const delayed = retag(original, (b) => { const o = WEB_TAG; const delay = ((b[o + 21]! << 4) | (b[o + 22]! >> 4)) + 1; b[o + 21] = delay >> 4; b[o + 22] = ((delay & 15) << 4) | (b[o + 22]! & 15); });
    await expect(validate(delayed, reDeclare(stem.manifest, delayed))).rejects.toMatchObject({ statusCode: 422 });
    // coordinated one-sample shift of the declared delay/padding keeps every sum valid but moves the decoder delay to 530
    const shifted = { ...stem.manifest, alignment: { ...stem.manifest.alignment, encoderDelayFrames: stem.manifest.alignment.encoderDelayFrames + 1, paddingFrames: stem.manifest.alignment.paddingFrames - 1 } };
    await expect(validate(original, shifted)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses a malformed LAME MP3 even though its declared SHA-256 matches the malformed bytes', async () => {
    const stem = web.sixStems44100[0]!;
    const original = bytesOf(stem);
    for (const index of [0, 52, 300, 5000, original.length - 1]) {
      const damaged = Buffer.from(original);
      damaged[index]! ^= 1;
      await expect(validate(damaged, reDeclare(stem.manifest, damaged)), `byte ${index}`).rejects.toMatchObject({ statusCode: 422 });
    }
    const truncated = original.subarray(0, original.length - 1);
    await expect(validate(truncated, reDeclare(stem.manifest, truncated))).rejects.toMatchObject({ statusCode: 422 });
    const extended = Buffer.concat([original, Buffer.from([0])]);
    await expect(validate(extended, reDeclare(stem.manifest, extended))).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses an unknown identification early, from the Info frame, before the rest of the object is read', async () => {
    const stem = web.sixStems44100[0]!;
    const unknown = retag(bytesOf(stem), (b) => { b.write('LAME3.99r', WEB_TAG, 'latin1'); });
    const validator = new Mp3StemStreamValidator(reDeclare(stem.manifest, unknown), MP3_PUBLICATION_VALIDATION);
    expect(() => validator.write(unknown.subarray(0, 900))).toThrowError(/perfis suportados/);
  });
});

describe('profiles do not relax each other', () => {
  it('a set mixing an ffmpeg stem and a Web-encoder stem is refused as inconsistent, though each stem is individually valid', async () => {
    const lavc = lavcCases.cases.find((c) => c.expect.ok && c.manifest.sampleRate === 44_100 && c.base64);
    expect(lavc).toBeDefined();
    const lavcFacts = await validate(Buffer.from(lavc!.base64!, 'base64'), lavc!.manifest);
    expect(lavcFacts.encoder.startsWith('Lavc')).toBe(true);
    const lameFacts = await validate(bytesOf(web.sixStems44100[0]!), web.sixStems44100[0]!.manifest);
    expect(() => assertConsistentMp3Stems([lavcFacts, lameFacts])).toThrowError(/inconsistentes/);
  });

  it('the original Lavc profile still refuses other delays and unknown encoders', async () => {
    const lavc = lavcCases.cases.find((c) => c.expect.ok && c.manifest.sampleRate === 44_100 && c.base64)!;
    const bytes = Buffer.from(lavc.base64!, 'base64');
    const shifted = { ...lavc.manifest, alignment: { ...lavc.manifest.alignment, encoderDelayFrames: lavc.manifest.alignment.encoderDelayFrames + 1, paddingFrames: lavc.manifest.alignment.paddingFrames - 1 } };
    await expect(validate(bytes, shifted)).rejects.toMatchObject({ statusCode: 422 });
    const unknown = retag(bytes, (b) => { b.write('Xyz123456', 156, 'latin1'); }, 156);
    await expect(validate(unknown, reDeclare(lavc.manifest, unknown))).rejects.toMatchObject({ statusCode: 422 });
  });

  it('mp3FactsMatch derives the profile from the identification the server read, and refuses an unknown one', async () => {
    const stem = web.sixStems44100[0]!;
    const facts = await validate(bytesOf(stem), stem.manifest);
    expect(mp3FactsMatch(stem.manifest, facts)).toBe(true);
    expect(mp3FactsMatch(stem.manifest, { ...facts, encoder: 'LAME3.99r' })).toBe(false);
    expect(mp3FactsMatch(stem.manifest, { ...facts, decoderDelayFrames: 530 })).toBe(false);
    expect(mp3FactsMatch(stem.manifest, { ...facts, tagDelayFrames: 577 })).toBe(false);
    expect(mp3FactsMatch(stem.manifest, undefined)).toBe(false);
  });
});