import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { AppError } from '../../middleware/error-handler';
import { STEM_IDS, stemSchema, type StemManifest } from './ministry-audio.schema';

export interface StemStorage {
  put(key: string, source: Readable, expected: StemManifest): Promise<void>;
  verify(key: string, expected: StemManifest): Promise<void>;
  open(key: string, expected: StemManifest): Promise<Readable>;
  remove(key: string): Promise<void>;
}

const WAV_HEADER_BYTES = 44;
const PCM_FRAME_BYTES = 4;
const STORAGE_KEY = /^([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([a-z]+)\.wav$/;

function invalidWav(status: 409 | 422): AppError {
  return new AppError(status, 'O stem WAV não corresponde ao manifesto de áudio.');
}

function storageConflict(): AppError {
  return new AppError(409, 'O stem de áudio não está disponível.');
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function checkHeader(header: Buffer, expected: StemManifest, status: 409 | 422): void {
  const bytes = header.readUInt32LE(40);
  const sampleRate = header.readUInt32LE(24);
  if (
    header.toString('latin1', 0, 4) !== 'RIFF' ||
    header.readUInt32LE(4) !== expected.sizeBytes - 8 ||
    header.toString('latin1', 8, 16) !== 'WAVEfmt ' ||
    header.readUInt32LE(16) !== 16 ||
    header.readUInt16LE(20) !== 1 ||
    header.readUInt16LE(22) !== 2 ||
    sampleRate !== expected.sampleRate ||
    header.readUInt32LE(28) !== sampleRate * PCM_FRAME_BYTES ||
    header.readUInt16LE(32) !== PCM_FRAME_BYTES ||
    header.readUInt16LE(34) !== 16 ||
    header.toString('latin1', 36, 40) !== 'data' ||
    bytes !== expected.sizeBytes - WAV_HEADER_BYTES ||
    bytes !== expected.frames * PCM_FRAME_BYTES
  ) {
    throw invalidWav(status);
  }
}

export async function verifyWav(
  source: Readable,
  expected: StemManifest,
  status: 409 | 422,
  destination?: FileHandle,
): Promise<void> {
  if (!stemSchema.safeParse(expected).success) throw invalidWav(status);

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of source.iterator({ destroyOnReturn: false })) {
    if (!Buffer.isBuffer(chunk) || sizeBytes + chunk.length > expected.sizeBytes) {
      throw invalidWav(status);
    }
    if (sizeBytes < WAV_HEADER_BYTES) {
      chunk.copy(header, sizeBytes, 0, WAV_HEADER_BYTES - sizeBytes);
      if (sizeBytes + chunk.length >= WAV_HEADER_BYTES) {
        checkHeader(header, expected, status);
      }
    }
    sizeBytes += chunk.length;
    hash.update(chunk);
    await destination?.writeFile(chunk);
  }
  if (sizeBytes !== expected.sizeBytes || hash.digest('hex') !== expected.sha256) {
    throw invalidWav(status);
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
}

async function ensureDirectory(path: string, create: boolean, recursive = false): Promise<void> {
  if (create) {
    try {
      await mkdir(path, { recursive, mode: 0o700 });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  }
  if (!(await lstat(path)).isDirectory()) throw storageConflict();
}

export class SimulatedStemStorage implements StemStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, source: Readable, expected: StemManifest): Promise<void> {
    const object = await this.objectPath(key, true, expected.id);
    const staged = await this.stage(source, expected, 422);
    try {
      // A hard link publishes the verified bytes without replacing an existing object.
      await link(staged, object);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      await this.verify(key, expected);
    } finally {
      await removeFile(staged);
    }
  }

  async verify(key: string, expected: StemManifest): Promise<void> {
    await this.withObject(key, expected, source => verifyWav(source, expected, 409));
  }

  async open(key: string, expected: StemManifest): Promise<Readable> {
    // Playback owns a verified snapshot even if the original key is removed or corrupted.
    const snapshot = await this.withObject(key, expected, source => this.stage(source, expected, 409));
    try {
      const handle = await open(snapshot, 'r');
      const stream = handle.createReadStream();
      stream.once('close', () => {
        void removeFile(snapshot).catch(() => {
          console.error('Falha ao remover arquivo temporário do simulador de áudio.');
        });
      });
      return stream;
    } catch (error) {
      await removeFile(snapshot);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await removeFile(await this.objectPath(key, false));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }

  private async objectPath(key: string, create: boolean, expectedId?: string): Promise<string> {
    const match = STORAGE_KEY.exec(key);
    if (
      !match ||
      match[0] !== key ||
      !STEM_IDS.some(id => id === match[3]) ||
      (expectedId !== undefined && expectedId !== match[3])
    ) {
      throw new AppError(400, 'Identificador do stem de áudio inválido.');
    }
    const [, ministry, recording, stem] = match;
    // Ids are case sensitive even when the simulator runs on a case-insensitive volume.
    const ministryPath = join(this.root, createHash('sha256').update(ministry).digest('hex'));
    const recordingPath = join(ministryPath, createHash('sha256').update(recording).digest('hex'));
    await ensureDirectory(this.root, create, true);
    await ensureDirectory(ministryPath, create);
    await ensureDirectory(recordingPath, create);
    return join(recordingPath, `${stem}.wav`);
  }

  private async withObject<T>(
    key: string,
    expected: StemManifest,
    consume: (stream: Readable) => Promise<T>,
  ): Promise<T> {
    let handle: FileHandle;
    try {
      const path = await this.objectPath(key, false, expected.id);
      if (!(await lstat(path)).isFile()) throw storageConflict();
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ELOOP')) throw storageConflict();
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== expected.sizeBytes) throw invalidWav(409);
      const source = handle.createReadStream();
      try {
        return await consume(source);
      } finally {
        source.destroy();
      }
    } finally {
      await handle.close();
    }
  }

  private async stage(source: Readable, expected: StemManifest, status: 409 | 422): Promise<string> {
    const directory = join(this.root, '.staging');
    await ensureDirectory(directory, true);
    const path = join(directory, `${randomUUID()}.part`);
    const handle = await open(path, 'wx', 0o600);
    try {
      try {
        await verifyWav(source, expected, status, handle);
      } finally {
        await handle.close();
      }
    } catch (error) {
      await removeFile(path);
      throw error;
    }
    return path;
  }
}
