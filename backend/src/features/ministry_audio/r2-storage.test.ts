import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StemManifest } from './ministry-audio.schema';
import { R2StemStorage } from './r2-storage';

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

const options = {
  accountId: 'a'.repeat(32),
  bucket: 'audio-tests',
  accessKeyId: 'offline-test-key',
  secretAccessKey: 'offline-test-secret',
};
const recording = 'b'.repeat(64);
const staged = `staging/ministry-audio/MinistryA/${recording}/vocals/1.wav`;
const final = `objects/ministry-audio/MinistryA/${recording}/vocals.wav`;
const etag = '"the-final-etag"';
function createWav(frames: number): Buffer {
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48_000, 24);
  wav.writeUInt32LE(48_000 * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(frames * 4, 40);
  return wav;
}

function manifestFor(wav: Buffer): StemManifest {
  const frames = (wav.length - 44) / 4;
  return {
    id: 'vocals',
    codec: 'pcm_s16le',
    channels: 2,
    sampleRate: 48_000,
    frames,
    durationSeconds: frames / 48_000,
    sizeBytes: wav.length,
    sha256: createHash('sha256').update(wav).digest('hex'),
  };
}

const wav = createWav(1);
const expected = manifestFor(wav);

function providerError(status: number, name: string): Error {
  return new S3ServiceException({
    name,
    $fault: status < 500 ? 'client' : 'server',
    $metadata: { httpStatusCode: status },
    message: 'private provider information',
  });
}

function object(bytes = wav, ETag = etag) {
  return {
    Body: Readable.from([bytes.subarray(0, 19), bytes.subarray(19)]),
    ContentLength: bytes.length,
    ContentType: 'audio/wav',
    CacheControl: 'private, no-store',
    ETag,
  };
}

describe('R2 stem storage (offline)', () => {
  const send = vi.fn();
  let storage: R2StemStorage;

  beforeEach(() => {
    send.mockReset().mockRejectedValue(new Error('Unexpected storage command'));
    transport.mockReset().mockRejectedValue(new Error('Unexpected transport request'));
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    storage = new R2StemStorage(options);
  });

  afterEach(() => vi.restoreAllMocks());

  it('signs only the scoped staging PUT with exact size, media type and create-only headers', async () => {
    const signed = await storage.signUpload(staged, expected, 75);
    const url = new URL(signed.url);
    expect(url.origin).toBe(`https://${options.accountId}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${options.bucket}/${staged}`);
    expect(url.searchParams.get('x-id')).toBe('PutObject');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('75');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('cache-control;content-length;content-type;host;if-none-match');
    expect(url.searchParams.get('X-Amz-Content-Sha256')).toBe('UNSIGNED-PAYLOAD');
    expect([...url.searchParams.keys()].some(name => /checksum/i.test(name))).toBe(false);
    expect(signed.headers).toEqual({
      'cache-control': 'private, no-store',
      'content-type': 'audio/wav',
      'if-none-match': '*',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('signs only the final GET with a required strong If-Match and validated TTL', async () => {
    const signed = await storage.signDownload(final, { etag }, 25);
    const url = new URL(signed.url);
    expect(url.pathname).toBe(`/${options.bucket}/${final}`);
    expect(url.searchParams.get('x-id')).toBe('GetObject');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('25');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host;if-match');
    expect(signed.headers).toEqual({ 'if-match': etag });
    await expect(storage.signDownload(final, { etag: '*' }, 25)).rejects.toMatchObject({ statusCode: 409 });
    await expect(storage.signDownload(final, { etag }, 0)).rejects.toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
  });

  it('changes signatures when size, scoped path or the receipt changes', async () => {
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
    try {
      const upload = await storage.signUpload(staged, expected, 75);
      const largerUpload = await storage.signUpload(staged, manifestFor(createWav(2)), 75);
      const otherAttempt = await storage.signUpload(staged.replace('1.wav', '2.wav'), expected, 75);
      const download = await storage.signDownload(final, { etag }, 25);
      const otherDownload = await storage.signDownload(final, { etag: '"another-etag"' }, 25);
      const signature = ({ url }: { url: string }) => new URL(url).searchParams.get('X-Amz-Signature');
      expect(signature(upload)).toMatch(/^[a-f0-9]{64}$/);
      expect(signature(largerUpload)).not.toBe(signature(upload));
      expect(signature(otherAttempt)).not.toBe(signature(upload));
      expect(signature(otherDownload)).not.toBe(signature(download));
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates allowed key scope, attempt and expected stem before using credentials', async () => {
    await expect(storage.signUpload(final, expected, 75)).rejects.toMatchObject({ statusCode: 400 });
    await expect(storage.signUpload(staged.replace('1.wav', '4.wav'), expected, 75)).rejects.toMatchObject({ statusCode: 400 });
    await expect(storage.signUpload(staged, { ...expected, id: 'drums' }, 75)).rejects.toMatchObject({ statusCode: 400 });
    await expect(storage.signDownload(staged, { etag }, 25)).rejects.toMatchObject({ statusCode: 400 });
    await expect(storage.seal(staged, final.replace('MinistryA', 'MinistryB'), expected)).rejects.toMatchObject({ statusCode: 400 });
    await expect(storage.remove(`${final}\n`)).rejects.toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
  });

  it('seals only a verified snapshot and conditionally creates the final object', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, '"staging-etag"'))
      .mockImplementationOnce(async (command: PutObjectCommand) => {
        expect(command).toBeInstanceOf(PutObjectCommand);
        expect(command.input).toMatchObject({
          Bucket: options.bucket,
          Key: final,
          ContentLength: expected.sizeBytes,
          ContentType: 'audio/wav',
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
        });
        expect(await buffer(command.input.Body as Readable)).toEqual(wav);
        return { ETag: etag };
      });
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag });
    const [[initial, initialOptions], [source, sourceOptions], [, putOptions]] = send.mock.calls;
    expect(initial).toBeInstanceOf(GetObjectCommand);
    expect(initial.input.Key).toBe(final);
    expect(source.input.Key).toBe(staged);
    expect(initialOptions.abortSignal).toBeInstanceOf(AbortSignal);
    expect(sourceOptions.abortSignal).toBe(initialOptions.abortSignal);
    expect(putOptions.abortSignal).toBe(initialOptions.abortSignal);
  });

  it('validates a previous successful seal without depending on staging', async () => {
    send.mockResolvedValueOnce(object());
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input.Key).toBe(final);
  });

  it('reconciles a conditional PUT race by verifying the winner', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object())
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed'))
      .mockResolvedValueOnce(object());
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag });
    expect(send.mock.calls[3][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[3][0].input.Key).toBe(final);
  });

  it('rejects same-length altered bytes despite the claimed ETag', async () => {
    const altered = Buffer.from(wav);
    altered[44] = 1;
    send.mockResolvedValueOnce(object(altered));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
    expect(send).toHaveBeenCalledTimes(1);
    send.mockClear().mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(altered));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'AUDIO_UPLOAD_INVALID' },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed WAV even when the digest and length match', async () => {
    const altered = Buffer.from(wav);
    altered.writeUInt16LE(3, 22);
    const malformed = { ...expected, sha256: createHash('sha256').update(altered).digest('hex') };
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey')).mockResolvedValueOnce(object(altered));
    await expect(storage.seal(staged, final, malformed)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'AUDIO_UPLOAD_INVALID' },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an absent upload from a transient provider failure', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey')).mockRejectedValueOnce(providerError(404, 'NoSuchKey'));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'AUDIO_UPLOAD_MISSING' },
    });
    send.mockRejectedValueOnce(providerError(503, 'ServiceUnavailable'));
    const failure = await storage.seal(staged, final, expected).catch(error => error);
    expect(failure).toMatchObject({ statusCode: 503 });
    expect(String(failure)).not.toContain('private provider information');
    send.mockRejectedValueOnce(providerError(404, 'NoSuchBucket'));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('aborts the verification stream and releases the slot by the combined deadline', async () => {
    const timeout = new AbortController();
    const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const stalled = new PassThrough();
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey')).mockResolvedValueOnce({
      ...object(),
      Body: stalled,
    });
    const sealing = expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 503 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(timer).toHaveBeenCalledWith(38_000);
    timeout.abort();
    await sealing;
    expect(stalled.destroyed).toBe(true);
  });

  it('limits concurrent seal operations to two per adapter instance', async () => {
    const stalls = [new PassThrough(), new PassThrough()];
    send.mockResolvedValueOnce({ ...object(), Body: stalls[0] })
      .mockResolvedValueOnce({ ...object(), Body: stalls[1] });
    const first = storage.seal(staged, final, expected);
    const second = storage.seal(staged, final, expected);
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 503 });
    for (const stream of stalls) stream.end(wav);
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses conditional HEAD and rejects changed metadata, length or ETag', async () => {
    send.mockResolvedValueOnce(object());
    await storage.assertObject(final, expected, { etag });
    const [[head]] = send.mock.calls;
    expect(head).toBeInstanceOf(HeadObjectCommand);
    expect(head.input).toEqual({ Bucket: options.bucket, Key: final, IfMatch: etag });

    send.mockRejectedValueOnce(providerError(412, 'PreconditionFailed'))
      .mockResolvedValueOnce({ ...object(), ETag: '"replacement"' })
      .mockResolvedValueOnce({ ...object(), ContentLength: expected.sizeBytes - 1 })
      .mockResolvedValueOnce({ ...object(), CacheControl: 'public, max-age=180' });
    for (let index = 0; index < 4; index++) {
      await expect(storage.assertObject(final, expected, { etag })).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it('uses only scoped DeleteObject and keeps successful deletes idempotent', async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(providerError(404, 'NoSuchKey'));
    await storage.remove(staged);
    await storage.remove(final);
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: options.bucket, Key: staged },
      { Bucket: options.bucket, Key: final },
    ]);
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('serializes large snapshot uploads with fixed length and no unsupported streaming extensions', async () => {
    vi.restoreAllMocks();
    const bytes = createWav(600_000);
    transport.mockResolvedValueOnce({
      response: {
        statusCode: 404,
        headers: { 'content-type': 'application/xml' },
        body: Readable.from([Buffer.from('<Error><Code>NoSuchKey</Code></Error>')]),
      },
    }).mockResolvedValueOnce({
      response: {
        statusCode: 200,
        headers: {
          'cache-control': 'private, no-store',
          'content-length': String(bytes.length),
          'content-type': 'audio/wav',
        },
        body: Readable.from([bytes.subarray(0, 32 * 1024), bytes.subarray(32 * 1024)]),
      },
    }).mockImplementationOnce(async (request: { body: Readable }) => ({
      response: {
        statusCode: 200,
        headers: { etag },
        body: (() => undefined)(),
      },
      actualBytes: await buffer(request.body),
    }));
    await expect(storage.seal(staged, final, manifestFor(bytes))).resolves.toEqual({ etag });
    const [[readFinal], [readStaging], [writeFinal]] = transport.mock.calls;
    expect(readFinal).toMatchObject({ method: 'GET', path: `/${options.bucket}/${final}` });
    expect(readStaging).toMatchObject({ method: 'GET', path: `/${options.bucket}/${staged}` });
    expect(writeFinal).toMatchObject({
      method: 'PUT',
      hostname: `${options.accountId}.r2.cloudflarestorage.com`,
      path: `/${options.bucket}/${final}`,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': 'audio/wav',
        'content-length': String(bytes.length),
        'if-none-match': '*',
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      },
    });
    expect(writeFinal.headers.expect).toBeUndefined();
    expect(writeFinal.headers['x-amz-trailer']).toBeUndefined();
    expect(writeFinal.headers['x-amz-sdk-checksum-algorithm']).toBeUndefined();
  });
});
