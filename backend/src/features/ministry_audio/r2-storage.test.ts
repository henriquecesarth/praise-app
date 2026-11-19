import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  CopyObjectCommand,
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

describe('R2 stem storage copy promotion and diagnostics (offline)', () => {
  const send = vi.fn();
  const stagingEtag = '"0123456789abcdef0123456789abcdef"';
  const events: Array<Record<string, unknown>> = [];
  let storage: R2StemStorage;

  beforeEach(() => {
    events.length = 0;
    send.mockReset().mockRejectedValue(new Error('Unexpected storage command'));
    transport.mockReset().mockRejectedValue(new Error('Unexpected transport request'));
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    storage = new R2StemStorage({ ...options, promotion: 'copy', diagnostics: event => { events.push({ ...event }); } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects an unknown promotion mode', () => {
    expect(() => new R2StemStorage({ ...options, promotion: 'move' as never })).toThrow();
  });

  it('verifies staging once, then copies only that ETag with fixed metadata and no disk snapshot or upload', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockImplementationOnce(async (command: CopyObjectCommand) => {
        expect(command).toBeInstanceOf(CopyObjectCommand);
        expect(command.input).toEqual({
          Bucket: options.bucket,
          Key: final,
          CopySource: `${options.bucket}/${staged}`,
          CopySourceIfMatch: stagingEtag,
          MetadataDirective: 'REPLACE',
          ContentType: 'audio/wav',
          CacheControl: 'private, no-store',
        });
        return { CopyObjectResult: { ETag: stagingEtag } };
      })
      .mockResolvedValueOnce(object(wav, stagingEtag));
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag: stagingEtag });
    const commands = send.mock.calls.map(([command]) => command.constructor.name);
    expect(commands).toEqual(['GetObjectCommand', 'GetObjectCommand', 'CopyObjectCommand', 'HeadObjectCommand']);
    expect(send.mock.calls[3][0].input).toEqual({ Bucket: options.bucket, Key: final, IfMatch: stagingEtag });
    expect(commands).not.toContain('PutObjectCommand');
  });

  it('sends the source and create-only destination conditions on the wire', async () => {
    vi.restoreAllMocks();
    const stagingResponse = {
      statusCode: 200,
      headers: { 'cache-control': 'private, no-store', 'content-length': String(wav.length), 'content-type': 'audio/wav', etag: stagingEtag },
    };
    transport.mockResolvedValueOnce({
      response: { statusCode: 404, headers: { 'content-type': 'application/xml' }, body: Readable.from([Buffer.from('<Error><Code>NoSuchKey</Code></Error>')]) },
    }).mockResolvedValueOnce({ response: { ...stagingResponse, body: Readable.from([wav]) } })
      .mockResolvedValueOnce({
        response: { statusCode: 200, headers: { 'content-type': 'application/xml' }, body: Readable.from([Buffer.from(`<CopyObjectResult><ETag>${stagingEtag}</ETag></CopyObjectResult>`)]) },
      }).mockResolvedValueOnce({ response: { ...stagingResponse, body: Readable.from([]) } });
    const copyStorage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(copyStorage.seal(staged, final, expected)).resolves.toEqual({ etag: stagingEtag });
    const copyRequest = transport.mock.calls[2][0];
    expect(copyRequest).toMatchObject({ method: 'PUT', path: `/${options.bucket}/${final}` });
    expect(copyRequest.headers['x-amz-copy-source']).toBe(`${options.bucket}/${staged}`);
    expect(copyRequest.headers['x-amz-copy-source-if-match']).toBe(stagingEtag);
    expect(copyRequest.headers['cf-copy-destination-if-none-match']).toBe('*');
    expect(copyRequest.headers['x-amz-metadata-directive']).toBe('REPLACE');
  });

  it('never copies bytes that fail verification and answers 422', async () => {
    const altered = Buffer.from(wav);
    altered[44] = 1;
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey')).mockResolvedValueOnce(object(altered, stagingEtag));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 422, details: { code: 'AUDIO_UPLOAD_INVALID' } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects a copy whose ETag differs from the verified staging object', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: '"different"' } });
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('reconciles a 412 by fully verifying the existing final object, and fails closed when it is absent', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed'))
      .mockResolvedValueOnce(object(wav, etag));
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag });
    expect(send.mock.calls[3][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[3][0].input.Key).toBe(final);

    send.mockReset().mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed'))
      .mockRejectedValueOnce(providerError(404, 'NoSuchKey'));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });

    send.mockReset().mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockRejectedValueOnce(providerError(412, 'PreconditionFailed'))
      .mockResolvedValueOnce(object((() => { const bad = Buffer.from(wav); bad[44] = 1; return bad; })(), etag));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('still reuses an already sealed final object without touching staging', async () => {
    send.mockResolvedValueOnce(object());
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports phase timings without keys, URLs or content, and never fails a seal because of diagnostics', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: stagingEtag } })
      .mockResolvedValueOnce(object(wav, stagingEtag));
    await storage.seal(staged, final, expected);
    expect(events.map(({ phase }) => phase)).toEqual(['final-probe', 'staging-headers', 'staging-verify', 'copy', 'confirm']);
    expect(events.find(({ phase }) => phase === 'staging-verify')).toMatchObject({ bytes: expected.sizeBytes, waitMs: expect.any(Number), hashMs: expect.any(Number), writeMs: 0 });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(staged);
    expect(serialized).not.toContain(final);
    expect(serialized).not.toContain(options.secretAccessKey);

    const throwing = new R2StemStorage({ ...options, diagnostics: () => { throw new Error('boom'); } });
    send.mockReset().mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, '"staging-etag"'))
      .mockResolvedValueOnce({ ETag: etag });
    await expect(throwing.seal(staged, final, expected)).resolves.toEqual({ etag });
  });

  it('maps a copy that finds staging gone to a retryable missing upload, and rejects odd ETags or leftover headers', async () => {
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockRejectedValueOnce(providerError(404, 'NoSuchKey'));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409, details: { code: 'AUDIO_UPLOAD_MISSING' } });

    send.mockReset().mockRejectedValueOnce(providerError(404, 'NoSuchKey')).mockResolvedValueOnce(object(wav, '"abc-2"'));
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
    expect(send).toHaveBeenCalledTimes(2);

    send.mockReset().mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: stagingEtag.replaceAll('"', '') } })
      .mockResolvedValueOnce(object(wav, stagingEtag));
    await expect(storage.seal(staged, final, expected)).resolves.toEqual({ etag: stagingEtag });

    send.mockReset().mockRejectedValueOnce(providerError(404, 'NoSuchKey'))
      .mockResolvedValueOnce(object(wav, stagingEtag))
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: stagingEtag } })
      .mockResolvedValueOnce({ ...object(wav, stagingEtag), ContentEncoding: 'gzip' });
    await expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('records where a seal was when the budget aborted it', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const stalled = new PassThrough();
    send.mockRejectedValueOnce(providerError(404, 'NoSuchKey')).mockResolvedValueOnce({ ...object(), Body: stalled });
    const sealing = expect(storage.seal(staged, final, expected)).rejects.toMatchObject({ statusCode: 503 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    timeout.abort();
    await sealing;
    expect(events.find(({ phase }) => phase === 'budget-abort')).toMatchObject({ during: 'staging-verify', ms: expect.any(Number) });
  });
});

interface Stored {
  bytes: Buffer;
  etag: string;
  modified: Date;
  contentType: string;
  cacheControl: string;
}
interface BucketHooks {
  corruptAt?: number;
  partEtag?: string;
  contentRange?: string;
  failPartOnce?: number;
  failPartAlways?: number;
  replaceOnPart?: (objects: Map<string, Stored>) => void;
  failCopyOnce?: boolean;
}

const md5 = (bytes: Buffer) => `"${createHash('md5').update(bytes).digest('hex')}"`;
const modifiedAt = new Date('2026-11-19T10:00:00Z');
function stored(bytes: Buffer): Stored {
  return { bytes, etag: md5(bytes), modified: modifiedAt, contentType: 'audio/wav', cacheControl: 'private, no-store' };
}

// In-memory R2 with the semantics the adapter relies on: conditional GET/PUT/COPY, ranged GET, 404 and 412.
function fakeBucket(hooks: BucketHooks = {}) {
  const objects = new Map<string, Stored>();
  const log: string[] = [];
  const partIfMatch: Array<string | undefined> = [];
  const seenFailures = new Set<number>();
  let inflight = 0;
  let maxInflight = 0;
  const facts = (o: Stored) => ({
    ETag: o.etag, ContentLength: o.bytes.length, ContentType: o.contentType, CacheControl: o.cacheControl, LastModified: o.modified,
  });
  const where = (key: string) => (key.startsWith('staging/') ? 'staging' : 'final');
  const impl = async (command: HeadObjectCommand | GetObjectCommand | PutObjectCommand | CopyObjectCommand | DeleteObjectCommand) => {
    const key = command.input.Key as string;
    const range = command instanceof GetObjectCommand ? command.input.Range : undefined;
    log.push(`${command.constructor.name}${range ? ' ranged' : ''} ${where(key)}`);
    const object = objects.get(key);
    if (command instanceof HeadObjectCommand) {
      if (!object) throw providerError(404, 'NotFound');
      return facts(object);
    }
    if (command instanceof GetObjectCommand) {
      if (!object) throw providerError(404, 'NoSuchKey');
      if (!range) return { ...facts(object), Body: Readable.from([object.bytes.subarray(0, 19), object.bytes.subarray(19)]) };
      partIfMatch.push(command.input.IfMatch);
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const start = Number(from);
      const end = Number(to);
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2 + (start % 3)));
        hooks.replaceOnPart?.(objects);
        const live = objects.get(key);
        if (!live || (command.input.IfMatch && command.input.IfMatch !== live.etag)) throw providerError(412, 'PreconditionFailed');
        if (hooks.failPartAlways === start) throw providerError(503, 'ServiceUnavailable');
        if (hooks.failPartOnce === start && !seenFailures.has(start)) {
          seenFailures.add(start);
          throw providerError(503, 'ServiceUnavailable');
        }
        const part = Buffer.from(live.bytes.subarray(start, end + 1));
        if (hooks.corruptAt !== undefined && hooks.corruptAt >= start && hooks.corruptAt <= end) part[hooks.corruptAt - start] ^= 0xff;
        return {
          ETag: hooks.partEtag ?? live.etag,
          ContentLength: part.length,
          ContentRange: hooks.contentRange ?? `bytes ${start}-${end}/${live.bytes.length}`,
          Body: Readable.from([part]),
        };
      } finally {
        inflight--;
      }
    }
    if (command instanceof PutObjectCommand) {
      if (command.input.IfNoneMatch === '*' && object) throw providerError(412, 'PreconditionFailed');
      const bytes = await buffer(command.input.Body as Readable);
      const next = { ...stored(bytes), contentType: command.input.ContentType!, cacheControl: command.input.CacheControl! };
      objects.set(key, next);
      return { ETag: next.etag };
    }
    if (command instanceof CopyObjectCommand) {
      const source = objects.get(command.input.CopySource!.slice(options.bucket.length + 1));
      if (!source) throw providerError(404, 'NoSuchKey');
      if (command.input.CopySourceIfMatch !== source.etag) throw providerError(412, 'PreconditionFailed');
      if (object) throw providerError(412, 'PreconditionFailed');
      if (hooks.failCopyOnce) {
        hooks.failCopyOnce = false;
        throw providerError(503, 'ServiceUnavailable');
      }
      objects.set(key, { ...source, contentType: command.input.ContentType!, cacheControl: command.input.CacheControl! });
      return { CopyObjectResult: { ETag: source.etag } };
    }
    objects.delete(key);
    return {};
  };
  return { objects, log, partIfMatch, impl, maxInflight: () => maxInflight };
}

describe('R2 stem storage ranged reads (offline)', () => {
  const send = vi.fn();
  const big = createWav(2_000);
  const bigManifest = manifestFor(big);
  const ranged = { ...options, reader: 'ranged' as const, rangePartBytes: 1_000, rangeConcurrency: 3 };
  let bucket: ReturnType<typeof fakeBucket>;

  function arrange(hooks: BucketHooks = {}) {
    bucket = fakeBucket(hooks);
    send.mockReset().mockImplementation(bucket.impl);
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    bucket.objects.set(staged, stored(big));
  }

  afterEach(() => vi.restoreAllMocks());

  it('verifies and promotes an object read as parallel ranged parts pinned to one ETag', async () => {
    arrange();
    const etagOfBytes = md5(big);
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).resolves.toEqual({ etag: etagOfBytes });
    expect(bucket.objects.get(final)?.bytes.equals(big)).toBe(true);
    const stagingReads = bucket.log.filter((entry) => entry.startsWith('GetObjectCommand') && entry.endsWith('staging'));
    expect(stagingReads).toHaveLength(Math.ceil(big.length / 1_000));
    expect(stagingReads.every((entry) => entry.includes('ranged'))).toBe(true);
    expect(bucket.partIfMatch.every((value) => value === etagOfBytes)).toBe(true);
    expect(bucket.maxInflight()).toBeGreaterThan(1);
    expect(bucket.maxInflight()).toBeLessThanOrEqual(3);
  });

  it('rejects altered bytes in any part and never uploads them', async () => {
    arrange({ corruptAt: 4_500 });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({
      statusCode: 422, details: { code: 'AUDIO_UPLOAD_INVALID' },
    });
    expect(bucket.log.some((entry) => entry.startsWith('PutObjectCommand'))).toBe(false);
    expect(bucket.objects.has(final)).toBe(false);
  });

  it('treats a part from another version, range or ETag as a conflict, and a swapped object as a conflict too', async () => {
    arrange({ partEtag: '"someone-else"' });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 409 });
    arrange({ contentRange: 'bytes 0-1/5' });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 409 });
    arrange({ replaceOnPart: (objects) => objects.set(staged, stored(createWav(2_000).fill(1, 44))) });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 409 });
    expect(bucket.objects.has(final)).toBe(false);
  });

  it('retries a transient part failure once, but fails the seal when it persists', async () => {
    arrange({ failPartOnce: 3_000 });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).resolves.toEqual({ etag: md5(big) });
    expect(bucket.log.filter((entry) => entry.includes('ranged staging')).length).toBe(Math.ceil(big.length / 1_000) + 1);

    arrange({ failPartAlways: 3_000 });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 503 });
    expect(bucket.objects.has(final)).toBe(false);
  });

  it('verifies an existing final object by ranges without touching staging, and rejects an altered one', async () => {
    arrange();
    bucket.objects.set(final, stored(big));
    bucket.objects.delete(staged);
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).resolves.toEqual({ etag: md5(big) });
    expect(bucket.log.some((entry) => entry.endsWith('staging'))).toBe(false);

    arrange();
    bucket.objects.set(final, stored(createWav(2_000).fill(2, 44)));
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('keeps read problems out of the invalid-upload path and uses the plain GET for single-part objects', async () => {
    // A part from a vanished or foreign version is a conflict (409), not an upload that spends the attempt.
    arrange({ partEtag: '"someone-else"' });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 409 });
    arrange({ contentRange: 'bytes 0-1/5' });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 409 });
    // A genuine content mismatch is still an invalid upload.
    arrange({ corruptAt: 4_500 });
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({ statusCode: 422 });

    arrange();
    const small = createWav(10);
    bucket.objects.set(staged, stored(small));
    await expect(new R2StemStorage(ranged).seal(staged, final, manifestFor(small))).resolves.toEqual({ etag: md5(small) });
    expect(bucket.log.some((entry) => entry.includes('ranged'))).toBe(false);
    expect(bucket.log).toContain('GetObjectCommand staging');
  });

  it('answers a missing staging object and rejects unsafe range settings', async () => {
    arrange();
    bucket.objects.delete(staged);
    await expect(new R2StemStorage(ranged).seal(staged, final, bigManifest)).rejects.toMatchObject({
      statusCode: 409, details: { code: 'AUDIO_UPLOAD_MISSING' },
    });
    expect(() => new R2StemStorage({ ...options, reader: 'sideways' as never })).toThrow();
    expect(() => new R2StemStorage({ ...options, rangeConcurrency: 9 })).toThrow();
    expect(() => new R2StemStorage({ ...options, rangePartBytes: 0 })).toThrow();
  });
});

describe('R2 stem storage persisted verification (offline)', () => {
  const send = vi.fn();
  const big = createWav(2_000);
  const bigManifest = manifestFor(big);
  const hint = { etag: md5(big), lastModified: modifiedAt.getTime() };
  let bucket: ReturnType<typeof fakeBucket>;

  function arrange(hooks: BucketHooks = {}) {
    bucket = fakeBucket(hooks);
    send.mockReset().mockImplementation(bucket.impl);
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    bucket.objects.set(staged, stored(big));
  }

  afterEach(() => vi.restoreAllMocks());

  it('reuses a matching verification: no staging read, a conditional copy and a confirming HEAD', async () => {
    arrange();
    const onVerified = vi.fn();
    const storage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(storage.seal(staged, final, bigManifest, { verified: hint, onVerified })).resolves.toEqual({ etag: hint.etag });
    expect(bucket.log).toEqual([
      'HeadObjectCommand final', 'HeadObjectCommand staging', 'CopyObjectCommand final', 'HeadObjectCommand final',
    ]);
    expect(onVerified).not.toHaveBeenCalled();
    expect(bucket.objects.get(final)?.bytes.equals(big)).toBe(true);
  });

  it('falls back to a full verification when the live staging object is not the verified version', async () => {
    for (const stale of [{ ...hint, etag: '"0123456789abcdef0123456789abcdef"' }, { ...hint, lastModified: hint.lastModified + 1000 }]) {
      arrange();
      const onVerified = vi.fn(async () => { bucket.log.push('persisted'); });
      const storage = new R2StemStorage({ ...options, promotion: 'copy' });
      await expect(storage.seal(staged, final, bigManifest, { verified: stale, onVerified })).resolves.toEqual({ etag: hint.etag });
      expect(bucket.log).toContain('GetObjectCommand staging');
      expect(onVerified).toHaveBeenCalledExactlyOnceWith({ etag: hint.etag, lastModified: hint.lastModified });
      expect(bucket.log.indexOf('persisted')).toBeLessThan(bucket.log.indexOf('CopyObjectCommand final'));
    }
  });

  it('never trusts a hint for different bytes: altered staging with the same ETag shape is verified anyway', async () => {
    arrange();
    const altered = Buffer.from(big);
    altered[100] = 9;
    bucket.objects.set(staged, stored(altered));
    const storage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(storage.seal(staged, final, bigManifest, { verified: hint })).rejects.toMatchObject({ statusCode: 422 });
    expect(bucket.objects.has(final)).toBe(false);
  });

  it('keeps the verification when promotion fails, and the retry skips the staging read', async () => {
    arrange({ failCopyOnce: true });
    const persisted: Array<{ etag: string; lastModified: number }> = [];
    const storage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(storage.seal(staged, final, bigManifest, { onVerified: async (value) => { persisted.push(value); } }))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(persisted).toEqual([hint]);
    expect(bucket.objects.has(final)).toBe(false);

    bucket.log.length = 0;
    await expect(storage.seal(staged, final, bigManifest, { verified: persisted[0] })).resolves.toEqual({ etag: hint.etag });
    expect(bucket.log.some((entry) => entry.startsWith('GetObjectCommand'))).toBe(false);
  });

  it('accepts a final object already promoted from the verified staging version with one HEAD', async () => {
    arrange();
    bucket.objects.set(final, stored(big));
    const storage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(storage.seal(staged, final, bigManifest, { verified: hint })).resolves.toEqual({ etag: hint.etag });
    expect(bucket.log).toEqual(['HeadObjectCommand final']);
  });

  it('fully verifies a final object whose ETag is not the verified one, and refuses a different object', async () => {
    arrange();
    bucket.objects.set(final, stored(createWav(2_000).fill(3, 44)));
    const storage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(storage.seal(staged, final, bigManifest, { verified: hint })).rejects.toMatchObject({ statusCode: 409 });
    expect(bucket.log).toEqual(['HeadObjectCommand final', 'GetObjectCommand final']);
  });

  it('answers a missing staging object even with a hint, and survives a failing persistence callback', async () => {
    arrange();
    bucket.objects.delete(staged);
    const storage = new R2StemStorage({ ...options, promotion: 'copy' });
    await expect(storage.seal(staged, final, bigManifest, { verified: hint })).rejects.toMatchObject({
      statusCode: 409, details: { code: 'AUDIO_UPLOAD_MISSING' },
    });

    arrange();
    await expect(storage.seal(staged, final, bigManifest, { onVerified: async () => { throw new Error('firestore down'); } }))
      .resolves.toEqual({ etag: hint.etag });
  });

  it('ignores the hint and the callback in upload promotion, which needs the verified bytes on disk', async () => {
    arrange();
    const onVerified = vi.fn();
    await expect(new R2StemStorage(options).seal(staged, final, bigManifest, { verified: hint, onVerified }))
      .resolves.toEqual({ etag: hint.etag });
    expect(onVerified).not.toHaveBeenCalled();
    expect(bucket.log).toContain('GetObjectCommand staging');
    expect(bucket.log).toContain('PutObjectCommand final');
    expect(bucket.log).not.toContain('CopyObjectCommand final');
  });
});