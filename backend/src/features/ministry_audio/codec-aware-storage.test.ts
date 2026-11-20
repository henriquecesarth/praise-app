// M22-C.5D-A — offline proof that the direct-storage adapters verify, promote and protect MP3 objects while the WAV v1
// behaviour stays as it was. Everything runs against the real-encoder fixtures, an in-memory simulator and a mocked S3
// transport: no network, no R2, no ffmpeg.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  CopyObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException,
} from '@aws-sdk/client-s3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFinalKey, assertSealKeys, assertStagingKey, assertDirectStorageKey,
} from './direct-storage';
import { MP3_ENCODER_PROFILE } from './mp3-encoder-profile';
import { assertConsistentMp3Stems, type Mp3StemManifest } from './mp3-stream-validator';
import { R2StemStorage } from './r2-storage';
import { SimulatedDirectStemStorage } from './simulated-direct-storage';
import { stemExtension, stemMime, verifyStemBytes } from './stem-codec';
import { STEM_IDS, type StemManifest } from './ministry-audio.schema';
import { CODEC_PROFILES } from './audio-codec';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-s3', async importOriginal => {
  const sdk = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class extends sdk.S3Client {
      constructor(config: ConstructorParameters<typeof sdk.S3Client>[0]) {
        super({ ...config, requestHandler: { handle: transport } });
      }
    },
  };
});

const fixtures = join(__dirname, '../../../../shared/fixtures/ministry-audio-mp3-v1');
const realCases = JSON.parse(readFileSync(join(fixtures, 'real-encoder-cases.json'), 'utf8')) as {
  cases: Array<{ name: string; manifest: Mp3StemManifest; base64: string; expect: { ok?: true; code?: string } }>;
};
const valid = realCases.cases.find((c) => c.name === 'valid-44100-12000')!;
const mp3 = Buffer.from(valid.base64, 'base64');
const expected: Mp3StemManifest = valid.manifest;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const recording = 'b'.repeat(64);
const staged = `staging/ministry-audio/MinistryA/${recording}/vocals/1.mp3`;
const final = `objects/ministry-audio/MinistryA/${recording}/vocals.mp3`;
const stagedWav = staged.replace(/\.mp3$/, '.wav');
const finalWav = final.replace(/\.mp3$/, '.wav');
const etag = '"the-final-etag"';
const stagingEtag = '"0123456789abcdef0123456789abcdef"';

const crc16 = (bytes: Buffer) => {
  let c = 0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  }
  return c;
};
/** Same bytes with another encoder identification (tag CRC repaired) and the manifest re-hashed. */
function withEncoder(encoder: string): { bytes: Buffer; manifest: Mp3StemManifest } {
  const bytes = Buffer.from(mp3);
  bytes.write(encoder.padEnd(9).slice(0, 9), 156, 'latin1');
  bytes.writeUInt16BE(crc16(bytes.subarray(0, 190)), 190);
  return { bytes, manifest: { ...expected, sha256: sha(bytes) } };
}
function flip(index: number): { bytes: Buffer; manifest: Mp3StemManifest } {
  const bytes = Buffer.from(mp3);
  bytes[index] ^= 0x01;
  return { bytes, manifest: { ...expected, sha256: sha(bytes) } };
}
function providerError(status: number, name: string): Error {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode: status }, message: 'private' });
}
function object(bytes: Buffer, ETag: string, extra: Record<string, unknown> = {}) {
  return {
    Body: Readable.from([bytes.subarray(0, 500), bytes.subarray(500)]),
    ContentLength: bytes.length, ContentType: 'audio/mpeg', CacheControl: 'private, no-store', ETag, ...extra,
  };
}
const missing = () => providerError(404, 'NoSuchKey');

function wavFor(frames: number): { bytes: Buffer; manifest: StemManifest } {
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(48_000 * 4, 28); bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  return { bytes, manifest: {
    id: 'vocals', codec: 'pcm_s16le', channels: 2, sampleRate: 48_000, frames, durationSeconds: frames / 48_000,
    sizeBytes: bytes.length, sha256: sha(bytes),
  } };
}

describe('codec-aware keys and metadata', () => {
  it('derives extension and MIME from the validated manifest codec, never from a key', () => {
    expect([stemExtension(expected), stemMime(expected)]).toEqual(['mp3', 'audio/mpeg']);
    const { manifest } = wavFor(1);
    expect([stemExtension(manifest), stemMime(manifest)]).toEqual(['wav', 'audio/wav']);
    expect(CODEC_PROFILES.mp3_cbr256.serverByteValidation).toBe(false); // the publication gate is untouched
  });

  it('keeps WAV keys exactly as in v1 and binds each key to one extension', () => {
    expect(() => assertSealKeys(stagedWav, finalWav, 'vocals')).not.toThrow();
    expect(() => assertSealKeys(staged, final, 'vocals', 'mp3')).not.toThrow();
    // a default (v1) caller can never address an MP3 key, and vice versa
    expect(() => assertStagingKey(staged, 'vocals')).toThrow();
    expect(() => assertFinalKey(final, 'vocals')).toThrow();
    expect(() => assertStagingKey(stagedWav, 'vocals', 'mp3')).toThrow();
    expect(() => assertSealKeys(staged, finalWav, 'vocals', 'mp3')).toThrow();
    expect(() => assertSealKeys(stagedWav, final, 'vocals')).toThrow();
    // staging and final must belong to the same ministry and recording
    expect(() => assertSealKeys(staged, final.replace('MinistryA', 'MinistryB'), 'vocals', 'mp3')).toThrow();
    expect(() => assertSealKeys(staged, final.replace(recording, 'c'.repeat(64)), 'vocals', 'mp3')).toThrow();
    expect(() => assertSealKeys(staged, final.replace('vocals', 'drums'), 'vocals', 'mp3')).toThrow();
    for (const key of [staged, final, stagedWav, finalWav]) expect(() => assertDirectStorageKey(key)).not.toThrow();
    for (const key of [`${final}.mp3`, final.replace('.mp3', '.ogg'), final.replace('.mp3', '.MP3'), `../${final}`]) {
      expect(() => assertDirectStorageKey(key), key).toThrow();
    }
  });
});

describe('storage-side MP3 verification profile', () => {
  const run = (bytes: Buffer, manifest: Mp3StemManifest, status: 409 | 422 = 422) =>
    verifyStemBytes(Readable.from([bytes]), manifest, status);

  it('accepts the evidenced profile and returns the facts used for set consistency', async () => {
    const result = await run(mp3, expected);
    expect(result).toMatchObject({ decoderDelayFrames: MP3_ENCODER_PROFILE.decoderDelayFrames, tagDelayFrames: 576 });
    expect(result!.encoder.startsWith('Lavc')).toBe(true);
  });

  it('rejects an unknown encoder even though the tag CRC, size and SHA-256 are all valid', async () => {
    const other = withEncoder('LAME3.100');
    await expect(run(other.bytes, other.manifest)).rejects.toMatchObject({ statusCode: 422 });
    const accepted = withEncoder('Lavc99.9.');
    await expect(run(accepted.bytes, accepted.manifest)).resolves.toBeDefined();
  });

  it('rejects a coordinated one-sample delay/padding shift that keeps every sum valid', async () => {
    const shifted: Mp3StemManifest = {
      ...expected, alignment: { ...expected.alignment, encoderDelayFrames: 1106, paddingFrames: 718 },
    };
    await expect(run(mp3, shifted)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects structural damage even when the declared SHA-256 matches the damaged bytes', async () => {
    for (const index of [0, 156, 300, 5000, mp3.length - 1]) {
      const damaged = flip(index);
      await expect(run(damaged.bytes, damaged.manifest), `byte ${index}`).rejects.toMatchObject({ statusCode: 422 });
    }
    await expect(run(mp3.subarray(0, mp3.length - 1), expected)).rejects.toMatchObject({ statusCode: 422 });
    await expect(run(Buffer.concat([mp3, Buffer.from([0])]), expected)).rejects.toMatchObject({ statusCode: 422 });
    await expect(run(mp3, expected, 409)).resolves.toBeDefined();
    await expect(run(flip(300).bytes, flip(300).manifest, 409)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires the six-stem set to be consistent, and one deviating stem breaks it', async () => {
    const results = await Promise.all(STEM_IDS.map((id) => run(mp3, { ...expected, id })));
    expect(() => assertConsistentMp3Stems(results)).not.toThrow();
    expect(() => assertConsistentMp3Stems(results.slice(0, 5))).not.toThrow(); // size is the schema's job (six stems)
    expect(() => assertConsistentMp3Stems([...results.slice(0, 5), { ...results[5], decoderDelayFrames: 530 }])).toThrow();
  });

  it('routes WAV through the unchanged v1 verifier', async () => {
    const wav = wavFor(1);
    await expect(verifyStemBytes(Readable.from([wav.bytes]), wav.manifest, 422)).resolves.toBeUndefined();
    const altered = Buffer.from(wav.bytes); altered[44] = 1;
    await expect(verifyStemBytes(Readable.from([altered]), wav.manifest, 422)).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('R2 adapter with MP3 (offline)', () => {
  const send = vi.fn();
  const options = { accountId: 'a'.repeat(32), bucket: 'audio-tests', accessKeyId: 'offline', secretAccessKey: 'offline' };
  const stores = (promotion: 'upload' | 'copy') => new R2StemStorage({ ...options, promotion });

  beforeEach(() => {
    send.mockReset().mockRejectedValue(new Error('Unexpected storage command'));
    transport.mockReset().mockRejectedValue(new Error('Unexpected transport request'));
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
  });
  afterEach(() => vi.restoreAllMocks());
  const commands = () => send.mock.calls.map(([command]) => command.constructor.name);

  it('signs a create-only audio/mpeg PUT only for an .mp3 staging key', async () => {
    const signed = await stores('copy').signUpload(staged, expected, 60);
    expect(signed.headers).toEqual({ 'cache-control': 'private, no-store', 'content-type': 'audio/mpeg', 'if-none-match': '*' });
    expect(new URL(signed.url).pathname).toBe(`/${options.bucket}/${staged}`);
    await expect(stores('copy').signUpload(stagedWav, expected, 60)).rejects.toMatchObject({ statusCode: 400 });
    await expect(stores('copy').signUpload(staged, wavFor(1).manifest, 60)).rejects.toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
  });

  it('promotes by upload: verified bytes, audio/mpeg, create-only', async () => {
    send.mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, '"staging"'))
      .mockImplementationOnce(async (command: PutObjectCommand) => {
        expect(command.input).toMatchObject({
          Key: final, ContentType: 'audio/mpeg', ContentLength: mp3.length, CacheControl: 'private, no-store', IfNoneMatch: '*',
        });
        expect(await buffer(command.input.Body as Readable)).toEqual(mp3);
        return { ETag: etag };
      });
    await expect(stores('upload').seal(staged, final, expected)).resolves.toEqual({ etag });
  });

  it('promotes by copy with audio/mpeg metadata and confirms the final object', async () => {
    send.mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, stagingEtag))
      .mockImplementationOnce(async (command: CopyObjectCommand) => {
        expect(command.input).toMatchObject({
          Key: final, CopySource: `${options.bucket}/${staged}`, CopySourceIfMatch: stagingEtag,
          MetadataDirective: 'REPLACE', ContentType: 'audio/mpeg', CacheControl: 'private, no-store',
        });
        return { CopyObjectResult: { ETag: stagingEtag } };
      })
      .mockResolvedValueOnce(object(mp3, stagingEtag));
    await expect(stores('copy').seal(staged, final, expected)).resolves.toEqual({ etag: stagingEtag });
    expect(commands()).toEqual(['GetObjectCommand', 'GetObjectCommand', 'CopyObjectCommand', 'HeadObjectCommand']);
  });

  it('never promotes invalid staging bytes: SHA, structure, profile, truncation or content-encoding', async () => {
    const altered = Buffer.from(mp3); altered[5000] ^= 1; // same size, declared SHA no longer matches
    const makeCases = (): Array<[string, ReturnType<typeof object>, Mp3StemManifest]> => [
      ['sha mismatch', object(altered, '"s"'), expected],
      ['structural damage with matching sha', object(flip(300).bytes, '"s"'), flip(300).manifest],
      ['unknown encoder', object(withEncoder('LAME3.100').bytes, '"s"'), withEncoder('LAME3.100').manifest],
      ['truncated object', object(mp3.subarray(0, 4000), '"s"', { ContentLength: 4000 }), expected],
      ['gzip content-encoding', object(mp3, '"s"', { ContentEncoding: 'gzip' }), expected],
      ['wrong media type', object(mp3, '"s"', { ContentType: 'audio/wav' }), expected],
    ];
    for (const promotion of ['upload', 'copy'] as const) {
      for (const [label, staging, manifest] of makeCases()) {
        send.mockReset().mockRejectedValueOnce(missing()).mockResolvedValueOnce(staging);
        await expect(stores(promotion).seal(staged, final, manifest), `${promotion}: ${label}`).rejects.toMatchObject({
          statusCode: 422, details: { code: 'AUDIO_UPLOAD_INVALID' },
        });
        expect(commands(), `${promotion}: ${label}`).toEqual(['GetObjectCommand', 'GetObjectCommand']);
      }
    }
  });

  it('verifies large MP3 staging objects through ranged parts like WAV (single read path)', async () => {
    const ranged = new R2StemStorage({ ...options, promotion: 'copy', reader: 'ranged', rangePartBytes: 4096, rangeConcurrency: 2 });
    const part = (start: number, end: number) => ({
      Body: Readable.from([mp3.subarray(start, end + 1)]), ETag: stagingEtag, ContentLength: end - start + 1,
      ContentRange: `bytes ${start}-${end}/${mp3.length}`,
    });
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === final && !command.input.IfMatch) throw missing();
        return { ETag: stagingEtag, ContentLength: mp3.length, ContentType: 'audio/mpeg', CacheControl: 'private, no-store' };
      }
      if (command instanceof GetObjectCommand) {
        const [, start, end] = /bytes=(\d+)-(\d+)/.exec(command.input.Range as string)!;
        return part(Number(start), Number(end));
      }
      if (command instanceof CopyObjectCommand) return { CopyObjectResult: { ETag: stagingEtag } };
      throw new Error('unexpected');
    });
    await expect(ranged.seal(staged, final, expected)).resolves.toEqual({ etag: stagingEtag });
    // a ranged object whose bytes differ is rejected and never copied
    send.mockReset();
    const bad = flip(7000);
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        if (!command.input.IfMatch && command.input.Key === final) throw missing();
        return { ETag: stagingEtag, ContentLength: mp3.length, ContentType: 'audio/mpeg', CacheControl: 'private, no-store' };
      }
      if (command instanceof GetObjectCommand) {
        const [, start, end] = /bytes=(\d+)-(\d+)/.exec(command.input.Range as string)!;
        return { ...part(Number(start), Number(end)), Body: Readable.from([bad.bytes.subarray(Number(start), Number(end) + 1)]) };
      }
      throw new Error('unexpected');
    });
    await expect(ranged.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 422 });
    expect(commands()).not.toContain('CopyObjectCommand');
  });

  it('rejects a copy whose confirming HEAD shows a content-encoding, and a lost upload-promotion race with a corrupted winner', async () => {
    send.mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, stagingEtag))
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: stagingEtag } })
      .mockResolvedValueOnce({ ...object(mp3, stagingEtag), ContentEncoding: 'gzip' });
    await expect(stores('copy').seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
    const altered = Buffer.from(mp3); altered[5000] ^= 1;
    send.mockReset().mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, '"s"'))
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed')).mockResolvedValueOnce(object(altered, etag));
    await expect(stores('upload').seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('resumes idempotently: an already sealed final object is verified and no staging is read', async () => {
    send.mockResolvedValueOnce(object(mp3, etag));
    await expect(stores('copy').seal(staged, final, expected)).resolves.toEqual({ etag });
    expect(commands()).toEqual(['GetObjectCommand']);
    expect(send.mock.calls[0][0].input.Key).toBe(final);
  });

  it('refuses a corrupted or re-encoded final object as a conflict, and never overwrites it', async () => {
    const altered = Buffer.from(mp3); altered[5000] ^= 1;
    send.mockResolvedValueOnce(object(altered, etag));
    await expect(stores('copy').seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
    expect(commands()).toEqual(['GetObjectCommand']);
  });

  it('resolves a lost create-only race by fully verifying the winning final object', async () => {
    send.mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, stagingEtag))
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed'))
      .mockResolvedValueOnce(object(mp3, etag));
    await expect(stores('copy').seal(staged, final, expected)).resolves.toEqual({ etag });
    // the winner is a corrupted object: the loser must not accept it
    const altered = Buffer.from(mp3); altered[5000] ^= 1;
    send.mockReset().mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, stagingEtag))
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed')).mockResolvedValueOnce(object(altered, etag));
    await expect(stores('copy').seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('asserts a sealed object by conditional HEAD with the MP3 media type and no content-encoding', async () => {
    const head = { ETag: etag, ContentLength: mp3.length, ContentType: 'audio/mpeg', CacheControl: 'private, no-store' };
    send.mockResolvedValueOnce(head);
    await expect(stores('copy').assertObject(final, expected, { etag })).resolves.toBeUndefined();
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    for (const bad of [{ ContentType: 'audio/wav' }, { ContentEncoding: 'gzip' }, { ContentLength: mp3.length + 1 }]) {
      send.mockResolvedValueOnce({ ...head, ...bad });
      await expect(stores('copy').assertObject(final, expected, { etag }), JSON.stringify(bad)).rejects.toMatchObject({ statusCode: 409 });
    }
    await expect(stores('copy').assertObject(finalWav, expected, { etag })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('keeps WAV exactly as before in the same adapter: audio/wav, .wav keys, WAV verifier', async () => {
    const wav = wavFor(1);
    const signed = await stores('copy').signUpload(stagedWav, wav.manifest, 60);
    expect(signed.headers['content-type']).toBe('audio/wav');
    await expect(stores('copy').signUpload(staged, wav.manifest, 60)).rejects.toMatchObject({ statusCode: 400 });
    send.mockRejectedValueOnce(missing())
      .mockResolvedValueOnce({ ...object(wav.bytes, stagingEtag), ContentType: 'audio/wav' })
      .mockImplementationOnce(async (command: CopyObjectCommand) => {
        expect(command.input.ContentType).toBe('audio/wav');
        return { CopyObjectResult: { ETag: stagingEtag } };
      })
      .mockResolvedValueOnce({ ...object(wav.bytes, stagingEtag), ContentType: 'audio/wav' });
    await expect(stores('copy').seal(stagedWav, finalWav, wav.manifest)).resolves.toEqual({ etag: stagingEtag });
    // an MP3 object presented for a WAV manifest is rejected by the WAV rules
    send.mockReset().mockRejectedValueOnce(missing()).mockResolvedValueOnce(object(mp3, stagingEtag));
    await expect(stores('copy').seal(stagedWav, finalWav, wav.manifest)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('removes both extensions idempotently and refuses foreign keys', async () => {
    send.mockResolvedValue({});
    await stores('copy').remove(staged);
    await stores('copy').remove(final);
    await expect(stores('copy').remove(final.replace('.mp3', '.flac'))).rejects.toMatchObject({ statusCode: 400 });
    expect(commands()).toEqual(['DeleteObjectCommand', 'DeleteObjectCommand']);
  });
});

describe('simulated direct storage with MP3 (local)', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let storage: SimulatedDirectStemStorage;
  let origin: string;

  beforeEach(async () => {
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    storage = new SimulatedDirectStemStorage(origin);
    app.use(storage.router);
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const put = async (key: string, manifest: Mp3StemManifest | StemManifest, bytes: Buffer, contentType?: string) => {
    const signed = await storage.signUpload(key, manifest, 60);
    return fetch(signed.url, { method: 'PUT', headers: { ...signed.headers, ...(contentType ? { 'content-type': contentType } : {}) }, body: bytes });
  };

  it('uploads with audio/mpeg, seals, serves audio/mpeg and keeps the final object immutable', async () => {
    expect((await put(staged, expected, mp3)).status).toBeLessThan(300);
    const receipt = await storage.seal(staged, final, expected);
    await expect(storage.assertObject(final, expected, receipt)).resolves.toBeUndefined();
    const download = await storage.signDownload(final, receipt, 60);
    const response = await fetch(download.url, { headers: download.headers });
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(mp3);
    // sealing again is idempotent, and nothing can be written over the final key
    await expect(storage.seal(staged, final, expected)).resolves.toEqual(receipt);
    const overwrite = await put(final.replace('objects/', 'staging/').replace('/vocals.mp3', '/vocals/1.mp3'), expected, mp3);
    expect(overwrite.status).toBe(412);
  });

  it('rejects an upload that declares the wrong media type for the key', async () => {
    expect((await put(staged, expected, mp3, 'audio/wav')).status).toBe(403);
  });

  it('refuses to promote invalid bytes, leaving no final object behind', async () => {
    const bad = flip(300);
    expect((await put(staged, bad.manifest, bad.bytes)).status).toBeLessThan(300);
    await expect(storage.seal(staged, final, bad.manifest)).rejects.toMatchObject({ statusCode: 422 });
    await expect(storage.assertObject(final, bad.manifest, { etag: '"x"' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('detects a final object changed in place after sealing', async () => {
    await put(staged, expected, mp3);
    const receipt = await storage.seal(staged, final, expected);
    storage.tamper(final, flip(5000).bytes);
    await expect(storage.assertObject(final, expected, receipt)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a malformed descriptor before touching keys or bytes', async () => {
    const bogus = { ...expected, codec: 'ogg' } as unknown as Mp3StemManifest;
    await expect(storage.signUpload(staged, bogus, 60)).rejects.toMatchObject({ statusCode: 422 });
    await expect(storage.seal(staged, final, bogus)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('removes staging and final objects of both formats; WAV flow is unchanged', async () => {
    await put(staged, expected, mp3);
    await storage.seal(staged, final, expected);
    await storage.remove(staged); await storage.remove(final);
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
    const wav = wavFor(1);
    expect((await put(stagedWav, wav.manifest, wav.bytes)).status).toBeLessThan(300);
    const receipt = await storage.seal(stagedWav, finalWav, wav.manifest);
    await expect(storage.assertObject(finalWav, wav.manifest, receipt)).resolves.toBeUndefined();
    const download = await storage.signDownload(finalWav, receipt, 60);
    expect((await fetch(download.url, { headers: download.headers })).headers.get('content-type')).toBe('audio/wav');
  });
});
