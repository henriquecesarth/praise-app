import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StemManifest } from './ministry-audio.schema';
import { SimulatedStemStorage } from './storage';

const key = 'MinistryA/RecordingB/vocals.wav';
const sampleRate = 44100;
const frames = 92160;

function createWav(): Buffer {
  const pcmBytes = frames * 4;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

function manifest(wav: Buffer): StemManifest {
  return {
    id: 'vocals',
    codec: 'pcm_s16le',
    channels: 2,
    sampleRate,
    frames,
    durationSeconds: frames / sampleRate,
    sizeBytes: wav.length,
    sha256: createHash('sha256').update(wav).digest('hex'),
  };
}

function stream(wav: Buffer): Readable {
  function* chunks() {
    yield wav.subarray(0, 19);
    for (let offset = 19; offset < wav.length; offset += 32 * 1024) {
      yield wav.subarray(offset, offset + 32 * 1024);
    }
  }
  return Readable.from(chunks());
}

describe('simulated stem storage', () => {
  let root: string;
  let storage: SimulatedStemStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'louvaio-stems-test-'));
    storage = new SimulatedStemStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('streams a WAV with a split header and supports identical concurrent retries', async () => {
    const wav = createWav();
    const expected = manifest(wav);
    await Promise.all([
      storage.put(key, stream(wav), expected),
      storage.put(key, stream(wav), expected),
    ]);

    await storage.verify(key, expected);
    expect(await buffer(await storage.open(key, expected))).toEqual(wav);
    await storage.remove(key);
    await storage.remove(key);
    await expect(storage.open(key, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects an invalid WAV header even when the digest matches', async () => {
    const wav = createWav();
    wav.writeUInt32LE(1, 28);
    const expected = manifest(wav);
    await expect(storage.put(key, stream(wav), expected)).rejects.toMatchObject({ statusCode: 422 });
    await expect(storage.verify(key, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects bytes over the expected limit without destroying the HTTP source', async () => {
    const wav = createWav();
    const source = new PassThrough();
    try {
      source.write(Buffer.concat([wav, Buffer.from([1])]));
      await expect(storage.put(key, source, manifest(wav))).rejects.toMatchObject({ statusCode: 422 });
      expect(source.destroyed).toBe(false);
    } finally {
      source.destroy();
    }
  });

  it('rejects truncated content and a false digest', async () => {
    const wav = createWav();
    const expected = manifest(wav);
    await expect(storage.put(key, stream(wav.subarray(0, -1)), expected)).rejects.toMatchObject({
      statusCode: 422,
    });
    wav[wav.length - 1] = 1;
    await expect(storage.put(key, stream(wav), expected)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('clears the partial staging file when the upload source fails', async () => {
    const wav = createWav();
    async function* interrupted() {
      yield wav.subarray(0, 4096);
      throw new Error('upload interrupted');
    }
    await expect(storage.put(key, Readable.from(interrupted()), manifest(wav))).rejects.toThrow(
      'upload interrupted',
    );
    expect(await readdir(join(root, '.staging'))).toEqual([]);
    await expect(storage.verify(key, manifest(wav))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('keeps uploaded keys immutable and distinguishes case-sensitive tenant IDs', async () => {
    const original = createWav();
    const different = Buffer.from(original);
    different[different.length - 1] = 1;
    await storage.put(key, stream(original), manifest(original));
    await expect(storage.put(key, stream(different), manifest(different))).rejects.toMatchObject({
      statusCode: 409,
    });
    const otherKey = key.replace('MinistryA', 'ministryA');
    await storage.put(otherKey, stream(different), manifest(different));
    await storage.verify(key, manifest(original));
    await storage.verify(otherKey, manifest(different));
  });

  it('fails closed for altered objects and streams the verified playback snapshot', async () => {
    const original = createWav();
    const expected = manifest(original);
    await storage.put(key, stream(original), expected);
    const playback = await storage.open(key, expected);

    const files = await readdir(root, { recursive: true });
    const object = files.find(file => file.endsWith('vocals.wav'));
    expect(object).toBeDefined();
    const altered = Buffer.from(original);
    altered[altered.length - 1] = 1;
    await writeFile(join(root, object!), altered);

    expect(await buffer(playback)).toEqual(original);
    await expect(storage.verify(key, expected)).rejects.toMatchObject({ statusCode: 409 });
    await expect(storage.open(key, expected)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(['../RecordingB/vocals.wav', 'MinistryA/../vocals.wav', 'MinistryA/RecordingB/vocals.wav:other'])(
    'rejects a key outside the logical namespace (%s)',
    async invalidKey => {
      const wav = createWav();
      await expect(storage.put(invalidKey, stream(wav), manifest(wav))).rejects.toMatchObject({
        statusCode: 400,
      });
    },
  );

  it('rejects a linked tenant folder before any write through it', async () => {
    const wav = createWav();
    const otherPath = join(root, 'other');
    await mkdir(otherPath);
    const tenantPath = join(root, createHash('sha256').update('MinistryA').digest('hex'));
    await symlink(otherPath, tenantPath, 'junction');
    await expect(storage.put(key, stream(wav), manifest(wav))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await readdir(otherPath)).toEqual([]);
  });
});
