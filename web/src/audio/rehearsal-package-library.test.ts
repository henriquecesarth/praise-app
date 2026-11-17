import { describe, expect, it, vi } from 'vitest';
import {
  buildSyntheticFlac,
  buildSyntheticWav,
  buildSyntheticZip,
  sha256Hex,
  type SyntheticZipEntryInput,
} from './rehearsal-package-fixtures';
import {
  EphemeralMemoryRehearsalStorageBackend,
  RehearsalPackageLibraryManager,
  getDefaultRehearsalPackageLibraryManager,
  invalidateActiveRehearsalLibrarySession,
  resolveInternalFileName,
  type ExternalFileHandleLike,
  type OpfsDirectoryHandleLike,
  type OpfsFileHandleLike,
  type OpfsWritableStreamLike,
  type SaveFileHandleLike,
} from './rehearsal-package-library';
import {
  LIMITS_V1,
  REHEARSAL_PACKAGE_FORMAT,
  REHEARSAL_PACKAGE_FORMAT_VERSION,
  validateRehearsalPackage,
  type RequiredStemId,
  type VerifiedRehearsalEntry,
} from './rehearsal-package-validator';

function makeDomException(message: string, name: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

class FakeOpfsWritableStream implements OpfsWritableStreamLike {
  private readonly chunks: Uint8Array[] = [];
  private closed = false;
  private aborted = false;

  constructor(
    private readonly path: string,
    private readonly onCommit: (bytes: Uint8Array) => void,
    private readonly faultHook?: (path: string, bytesWritten: number) => Error | null,
    initialBytes?: Uint8Array,
  ) {
    if (initialBytes && initialBytes.byteLength > 0) {
      this.chunks.push(new Uint8Array(initialBytes));
    }
  }

  async write(data: Uint8Array | Blob | string): Promise<void> {
    if (this.closed || this.aborted) {
      throw new Error('Cannot write to closed or aborted stream.');
    }
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      bytes = new Uint8Array(bytes);
    } else {
      bytes = new Uint8Array(await data.arrayBuffer());
    }
    const currentTotal = this.chunks.reduce((sum, c) => sum + c.byteLength, 0) + bytes.byteLength;
    const injected = this.faultHook?.(this.path, currentTotal);
    if (injected) {
      throw injected;
    }
    this.chunks.push(bytes);
  }

  async close(): Promise<void> {
    if (this.aborted) {
      throw new Error('Cannot close aborted stream.');
    }
    if (this.closed) return;
    this.closed = true;
    const total = this.chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.onCommit(out);
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.chunks.length = 0;
  }
}

class FakeOpfsFileHandle implements OpfsFileHandleLike {
  readonly kind = 'file' as const;
  bytes: Uint8Array;

  constructor(
    readonly name: string,
    private readonly path: string,
    initialBytes: Uint8Array = new Uint8Array(0),
    private readonly hooks: {
      failOnWrite?: (path: string, bytesWritten: number) => Error | null;
      failOnRead?: (path: string) => Error | null;
    } = {},
  ) {
    this.bytes = new Uint8Array(initialBytes);
  }

  async getFile(): Promise<File> {
    const readErr = this.hooks.failOnRead?.(this.path);
    if (readErr) {
      throw readErr;
    }
    const copy = new Uint8Array(this.bytes.byteLength);
    copy.set(this.bytes);
    return new File([copy], this.name, { type: 'application/octet-stream' });
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritableStreamLike> {
    const initial = options?.keepExistingData ? this.bytes : undefined;
    return new FakeOpfsWritableStream(
      this.path,
      (committed) => {
        this.bytes = committed;
      },
      this.hooks.failOnWrite,
      initial,
    );
  }
}

class FakeOpfsDirectoryHandle implements OpfsDirectoryHandleLike {
  readonly kind = 'directory' as const;
  private readonly children = new Map<string, FakeOpfsDirectoryHandle | FakeOpfsFileHandle>();

  constructor(
    readonly name: string,
    private readonly pathPrefix = '',
    private readonly hooks: {
      failOnWrite?: (path: string, bytesWritten: number) => Error | null;
      failOnRead?: (path: string) => Error | null;
    } = {},
  ) {}

  private childPath(name: string): string {
    return this.pathPrefix ? `${this.pathPrefix}/${name}` : name;
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeOpfsDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') {
        throw makeDomException(`Entry ${name} is a file.`, 'TypeMismatchError');
      }
      return existing;
    }
    if (!options?.create) {
      throw makeDomException(`Directory not found: ${name}`, 'NotFoundError');
    }
    const created = new FakeOpfsDirectoryHandle(name, this.childPath(name), this.hooks);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeOpfsFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') {
        throw makeDomException(`Entry ${name} is a directory.`, 'TypeMismatchError');
      }
      return existing;
    }
    if (!options?.create) {
      throw makeDomException(`File not found: ${name}`, 'NotFoundError');
    }
    const created = new FakeOpfsFileHandle(name, this.childPath(name), new Uint8Array(0), this.hooks);
    this.children.set(name, created);
    return created;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) {
      throw makeDomException(`Entry not found: ${name}`, 'NotFoundError');
    }
    if (existing.kind === 'directory' && existing.children.size > 0 && !options?.recursive) {
      throw makeDomException(`Directory not empty: ${name}`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, OpfsDirectoryHandleLike | OpfsFileHandleLike]> {
    for (const [key, val] of Array.from(this.children.entries())) {
      yield [key, val];
    }
  }

  // Test helpers for inspection & fault injection
  async resolveDir(segments: string[], create = false): Promise<FakeOpfsDirectoryHandle> {
    let curr: FakeOpfsDirectoryHandle = this;
    for (const seg of segments) {
      curr = await curr.getDirectoryHandle(seg, { create });
    }
    return curr;
  }

  async hasPath(path: string): Promise<boolean> {
    const parts = path.split('/').filter(Boolean);
    let curr: FakeOpfsDirectoryHandle = this;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const child = curr.children.get(part);
      if (!child) return false;
      if (i === parts.length - 1) return true;
      if (child.kind !== 'directory') return false;
      curr = child;
    }
    return true;
  }

  async listNames(path: string): Promise<string[]> {
    const parts = path.split('/').filter(Boolean);
    const dir = await this.resolveDir(parts, false);
    return Array.from(dir.children.keys());
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop()!;
    const dir = await this.resolveDir(parts, false);
    const fh = await dir.getFileHandle(fileName, { create: false });
    return new Uint8Array(fh.bytes);
  }

  async writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop()!;
    const dir = await this.resolveDir(parts, true);
    const fh = await dir.getFileHandle(fileName, { create: true });
    fh.bytes = new Uint8Array(bytes);
  }

  async deletePath(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    const dir = await this.resolveDir(parts, false);
    await dir.removeEntry(name, { recursive: true });
  }
}

async function buildTestPackageZip(options: {
  packageId?: string;
  revision?: number;
  displayName?: string;
  includeOriginal?: boolean;
  originalContainer?: 'wav' | 'flac';
  stemContainer?: 'wav' | 'flac';
  customPaths?: Partial<Record<RequiredStemId | 'original', string>>;
  seedOffset?: number;
  frames?: number;
  forbiddenAuthorityField?: boolean;
} = {}): Promise<{
  bytes: Uint8Array;
  file: File;
  packageId: string;
  revision: number;
  displayName: string;
}> {
  const packageId = options.packageId ?? '11111111-2222-4333-8444-555555555555';
  const revision = options.revision ?? 1;
  const displayName = options.displayName ?? 'Louvor Domingo Manhã';
  const includeOriginal = options.includeOriginal ?? true;
  const stemContainer = options.stemContainer ?? 'wav';
  const originalContainer = options.originalContainer ?? 'wav';
  const seedOffset = options.seedOffset ?? 0;
  const frames = options.frames ?? 4410;

  const stemIds: RequiredStemId[] = ['vocals', 'drums', 'bass', 'other'];
  const zipEntries: SyntheticZipEntryInput[] = [];
  const stemDecls = stemIds.map((stemId, index) => {
    const data =
      stemContainer === 'flac'
        ? buildSyntheticFlac({ totalSamples: frames, bitsPerSample: 24, seed: index + 1 + seedOffset })
        : buildSyntheticWav({ frames, bitsPerSample: 16, seed: index + 1 + seedOffset });
    const path = options.customPaths?.[stemId] ?? `stems/${stemId}.${stemContainer}`;
    zipEntries.push({ path, data, compressionMethod: 0 });
    return {
      id: stemId,
      path,
      container: stemContainer,
      codec: stemContainer === 'flac' ? 'flac' : 'pcm_s16le',
      bitsPerSample: stemContainer === 'flac' ? 24 : 16,
      byteLength: data.byteLength,
      sha256: sha256Hex(data),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: frames,
    };
  });

  let originalDecl: Record<string, unknown> = { included: false };
  if (includeOriginal) {
    const origData =
      originalContainer === 'flac'
        ? buildSyntheticFlac({ totalSamples: frames, bitsPerSample: 24, seed: 99 + seedOffset })
        : buildSyntheticWav({ frames, bitsPerSample: 16, seed: 99 + seedOffset });
    const origPath = options.customPaths?.original ?? `audio/original.${originalContainer}`;
    zipEntries.push({ path: origPath, data: origData, compressionMethod: 0 });
    originalDecl = {
      included: true,
      path: origPath,
      container: originalContainer,
      codec: originalContainer === 'flac' ? 'flac' : 'pcm_s16le',
      bitsPerSample: originalContainer === 'flac' ? 24 : 16,
      byteLength: origData.byteLength,
      sha256: sha256Hex(origData),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: frames,
    };
  }

  const requiredFeatures = ['stems-4', 'timeline-v1', 'alignment-v1'];
  if (includeOriginal) {
    requiredFeatures.push('original-optional');
  }

  const manifest: Record<string, unknown> = {
    format: REHEARSAL_PACKAGE_FORMAT,
    formatVersion: REHEARSAL_PACKAGE_FORMAT_VERSION,
    requiredFeatures,
    packageId,
    revision,
    createdAt: '2026-11-17T12:00:00Z',
    displayName,
    ...(options.forbiddenAuthorityField ? { ministryId: 'ministry-spoof' } : {}),
    source: {
      sha256: 'a'.repeat(64),
      sanitizedFileName: 'ensaio-domingo.wav',
      durationFrames: frames,
      usageRightEvidence: 'gravacao-local-igreja',
    },
    provenance: {
      toolName: 'louvaio-stem-local',
      toolVersion: '1.0.0',
      modelName: 'htdemucs_ft',
      checkpointId: 'htdemucs-v4',
      checkpointSha256: 'b'.repeat(64),
      parameters: { shifts: 1 },
      seed: 42,
      licenseReferences: ['MIT'],
    },
    timeline: {
      sampleRate: 44100,
      totalFrames: frames,
      channels: 2,
      timeOriginFrame: 0,
    },
    original: originalDecl,
    stems: stemDecls,
    alignment: {
      timeOriginFrame: 0,
      method: 'explicit-trim',
      initialTrimFrames: 0,
      trailingTrimFrames: 0,
    },
    rights: {
      declaration: 'Uso interno exclusivo para ensaio local da equipe.',
      scope: 'rehearsal-local',
      exportAllowed: true,
      attributions: [],
      isLegalProof: false,
      isDrm: false,
    },
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const allEntries: SyntheticZipEntryInput[] = [
    { path: 'manifest.json', data: manifestBytes, compressionMethod: 8 },
    ...zipEntries,
  ];
  const bytes = await buildSyntheticZip(allEntries);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], 'ensaio.louvaio-rehearsal.zip', { type: 'application/zip' });
  return { bytes, file, packageId, revision, displayName };
}

function accountBasePath(userId: string): string {
  const hash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
  return `louvaio-rehearsal-v1/${hash}`;
}

describe('RehearsalPackageLibraryManager (T9)', () => {
  it('imports a valid 4-stem + original package into OPFS with metadata-only index.json and zero web DB/network side effects', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const localSetSpy = vi.spyOn(Storage.prototype, 'setItem');
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      let txCounter = 0;
      const manager = new RehearsalPackageLibraryManager({
        getOpfsRoot: async () => opfsRoot,
        quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 1024 * 1024 }),
        persistenceChecker: async () => false,
        txIdGenerator: () => `tx-${++txCounter}`,
        now: () => new Date('2026-11-17T15:00:00.000Z'),
      });

      const pkg = await buildTestPackageZip({ includeOriginal: true });
      const phases: string[] = [];
      const outcome = await manager.importPackage({
        userId: 'user-a',
        file: pkg.file,
        onProgress: (p) => phases.push(p.phase),
      });

      expect(outcome.category).toBe('imported');
      expect(outcome.record).toBeDefined();
      expect(outcome.record!.bindingStatus).toBe('unlinked');
      expect(outcome.record!.storageMode).toBe('opfs');
      expect(outcome.record!.isReadyForLocalUse).toBe(true);
      expect(outcome.record!.integrityState).toBe('verified');
      expect(outcome.record!.usageRightsDeclaration).toBe(
        'Uso interno exclusivo para ensaio local da equipe.',
      );
      expect(Object.keys(outcome.record!.stems).sort()).toEqual([
        'bass',
        'drums',
        'other',
        'vocals',
      ]);
      expect(outcome.record!.original).not.toBeNull();
      expect(outcome.record!.totalOccupiedBytes).toBe(
        outcome.record!.archiveBytes + outcome.record!.extractedBytes,
      );

      expect(phases).toContain('picking');
      expect(phases).toContain('preflight');
      expect(phases).toContain('stagingCopy');
      expect(phases).toContain('validating');
      expect(phases).toContain('extracting');
      expect(phases).toContain('committing');

      const base = accountBasePath('user-a');
      const indexBytes = await opfsRoot.readFileBytes(`${base}/index.json`);
      const indexText = new TextDecoder().decode(indexBytes);
      expect(indexText).not.toContain('RIFF');
      expect(indexText).not.toContain('data:audio');
      expect(indexText).not.toContain('base64');
      const parsedIndex = JSON.parse(indexText);
      expect(parsedIndex.packages).toHaveLength(1);
      expect(parsedIndex.packages[0].packageId).toBe(pkg.packageId);

      // Staging & tmp files must be cleaned
      expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);
      expect(await opfsRoot.hasPath(`${base}/index.tmp.json`)).toBe(false);

      // Zero storage / network calls
      expect(localSetSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();

      const snapshot = await manager.loadLibrary({ userId: 'user-a' });
      expect(snapshot.packages).toHaveLength(1);
      expect(snapshot.storageSummary.storageMode).toBe('opfs');
      expect(snapshot.storageSummary.persistentGranted).toBe(false);
      expect(snapshot.storageSummary.persistentWarning).toContain('OPFS');
      expect(snapshot.storageSummary.packageCount).toBe(1);
      expect(snapshot.corruptedOrIncompleteCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      localSetSpy.mockRestore();
    }
  });

  it('rejects malicious or corrupted ZIPs with zero files written under packages/', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    // 1. Forbidden authority field in manifest
    const authorityPkg = await buildTestPackageZip({ forbiddenAuthorityField: true });
    const res1 = await manager.importPackage({ userId: 'user-a', file: authorityPkg.file });
    expect(res1.category).toBe('corrupted');
    expect(res1.errorCode).toBe('FORBIDDEN_AUTHORITY_FIELD');

    // 2. Path traversal entry
    const traversalZip = await buildSyntheticZip([
      { path: '../evil.wav', data: buildSyntheticWav() },
    ]);
    const res2 = await manager.importPackage({
      userId: 'user-a',
      file: new File([traversalZip as unknown as BlobPart], 'evil.zip'),
    });
    expect(res2.category).toBe('corrupted');
    expect(res2.errorCode).toBe('PATH_TRAVERSAL_OR_UNSAFE_PATH');

    const base = accountBasePath('user-a');
    expect(await opfsRoot.listNames(`${base}/packages`)).toEqual([]);
    expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);
  });

  it('maps internal OPFS filenames strictly via resolveInternalFileName and ignores untrusted/Unicode ZIP paths', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip({
      includeOriginal: true,
      originalContainer: 'flac',
      customPaths: {
        vocals: 'tracks/Voz Principal (Café).wav',
        drums: 'tracks/Bateria_São_João.wav',
        bass: 'sub/Baixo Elétrico.wav',
        other: 'sub/Teclado & Violão.wav',
        original: 'mix/Original Masterização (2026).flac',
      },
    });

    const outcome = await manager.importPackage({ userId: 'user-a', file: pkg.file });
    expect(outcome.category).toBe('imported');

    const base = accountBasePath('user-a');
    const pkgFiles = await opfsRoot.listNames(`${base}/packages/${pkg.packageId}`);
    expect(pkgFiles.sort()).toEqual([
      'commit.json',
      'manifest.json',
      'original.flac',
      'package.louvaio-rehearsal.zip',
      'stem_bass.wav',
      'stem_drums.wav',
      'stem_other.wav',
      'stem_vocals.wav',
    ]);

    const dummyEntry: VerifiedRehearsalEntry = {
      role: 'stem',
      stemId: 'vocals',
      path: '../../untrusted/Café.wav',
      compressionMethod: 0,
      compressedBytes: 100,
      uncompressedBytes: 100,
      crc32: 0,
      sha256: '0'.repeat(64),
      audioInfo: {
        container: 'ogg',
        codec: 'opus',
        sampleRate: 44100,
        channels: 2,
        decodedFrames: 100,
      },
    };
    expect(resolveInternalFileName(dummyEntry)).toBe('stem_vocals.ogg');
    expect(() =>
      resolveInternalFileName({ ...dummyEntry, audioInfo: { ...dummyEntry.audioInfo!, container: 'exe' } }),
    ).toThrow();
  });

  it('returns idempotentNoop on identical package re-import', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip();
    const first = await manager.importPackage({ userId: 'user-a', file: pkg.file });
    expect(first.category).toBe('imported');

    const second = await manager.importPackage({ userId: 'user-a', file: pkg.file });
    expect(second.category).toBe('idempotentNoop');
    expect(second.record?.packageId).toBe(pkg.packageId);

    const snapshot = await manager.loadLibrary({ userId: 'user-a' });
    expect(snapshot.packages).toHaveLength(1);
  });

  it('detects conflicts, supports discard, rolls back via backups/<id>.backup on mid-replace failure, and commits confirmed replace', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    let failOnCommitWrite = false;
    let commitWritesCount = 0;
    let txCounter = 0;

    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
      txIdGenerator: () => `tx-${++txCounter}`,
      testSinkWrapper: (ctx, sink) => {
        if (!failOnCommitWrite || ctx.stage !== 'committing') {
          return sink;
        }
        return {
          async write(chunk) {
            commitWritesCount += 1;
            if (commitWritesCount >= 2) {
              throw makeDomException('Simulated disk full mid-replace', 'QuotaExceededError');
            }
            return sink.write(chunk);
          },
          close: () => sink.close(),
          abort: (r) => sink.abort?.(r) ?? Promise.resolve(),
        };
      },
    });

    const v1 = await buildTestPackageZip({
      revision: 1,
      displayName: 'Versão 1',
      includeOriginal: true,
      stemContainer: 'wav',
      seedOffset: 1,
    });
    const r1 = await manager.importPackage({ userId: 'user-a', file: v1.file });
    expect(r1.category).toBe('imported');

    const v2 = await buildTestPackageZip({
      revision: 2,
      displayName: 'Versão 2 FLAC',
      includeOriginal: false,
      stemContainer: 'flac',
      seedOffset: 50,
    });

    // 1. Conflict + Discard
    const conflictRes1 = await manager.importPackage({ userId: 'user-a', file: v2.file });
    expect(conflictRes1.category).toBe('conflict');
    expect(conflictRes1.errorCode).toBe('PACKAGE_IDENTITY_CONFLICT');
    expect(conflictRes1.conflict?.incomingRevision).toBe(2);

    const discardRes = await manager.discardPendingConflict({
      userId: 'user-a',
      pendingTransactionId: conflictRes1.conflict!.pendingTransactionId,
    });
    expect(discardRes.category).toBe('cancelled');
    const base = accountBasePath('user-a');
    expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);

    // 2. Conflict + Mid-replace failure -> rollback to v1
    const conflictRes2 = await manager.importPackage({ userId: 'user-a', file: v2.file });
    expect(conflictRes2.category).toBe('conflict');

    failOnCommitWrite = true;
    commitWritesCount = 0;
    const failedReplace = await manager.confirmConflictReplace({
      userId: 'user-a',
      pendingTransactionId: conflictRes2.conflict!.pendingTransactionId,
    });
    expect(failedReplace.category).toBe('insufficientSpace');
    failOnCommitWrite = false;

    const afterRollback = await manager.loadLibrary({ userId: 'user-a' });
    expect(afterRollback.packages).toHaveLength(1);
    expect(afterRollback.packages[0].revision).toBe(1);
    expect(afterRollback.packages[0].integrityState).toBe('verified');
    expect(afterRollback.packages[0].isReadyForLocalUse).toBe(true);
    expect(afterRollback.packages[0].original).not.toBeNull();

    // 3. Conflict + Confirmed Replace -> v2 replaces v1 cleanly and removes stale v1 files
    const conflictRes3 = await manager.importPackage({ userId: 'user-a', file: v2.file });
    expect(conflictRes3.category).toBe('conflict');
    const okReplace = await manager.confirmConflictReplace({
      userId: 'user-a',
      pendingTransactionId: conflictRes3.conflict!.pendingTransactionId,
    });
    expect(okReplace.category).toBe('imported');
    expect(okReplace.record?.revision).toBe(2);
    expect(okReplace.record?.original).toBeNull();

    const pkgFilesAfterReplace = await opfsRoot.listNames(`${base}/packages/${v1.packageId}`);
    expect(pkgFilesAfterReplace.sort()).toEqual([
      'commit.json',
      'manifest.json',
      'package.louvaio-rehearsal.zip',
      'stem_bass.flac',
      'stem_drums.flac',
      'stem_other.flac',
      'stem_vocals.flac',
    ]);
    expect(await opfsRoot.listNames(`${base}/backups`)).toEqual([]);
    expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);
  });

  it('performs crash/reload recovery for staging/*, index.tmp.json, orphaned packages, interrupted .backup, missing commit.json, and evicted/truncated files', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const v1 = await buildTestPackageZip({ packageId: 'aaaaaaaa-1111-4111-8111-111111111111' });
    const imp = await manager.importPackage({ userId: 'user-a', file: v1.file });
    expect(imp.category).toBe('imported');

    const base = accountBasePath('user-a');

    // Simulate leftover staging/*, index.tmp.json, and orphaned unindexed package dir
    await opfsRoot.writeFileBytes(
      `${base}/staging/orphaned-tx/package.louvaio-rehearsal.zip`,
      new Uint8Array([1, 2, 3]),
    );
    await opfsRoot.writeFileBytes(
      `${base}/index.tmp.json`,
      new TextEncoder().encode('{"partial":true'),
    );
    await opfsRoot.writeFileBytes(
      `${base}/packages/99999999-9999-4999-8999-999999999999/junk.bin`,
      new Uint8Array([9, 8, 7]),
    );

    // Simulate interrupted replace crash: v1 files moved to backups/<id>.backup with backup.ready.json,
    // while packages/<id>/commit.json was removed and partial v2 bytes were left behind.
    const pkgFiles = await opfsRoot.listNames(`${base}/packages/${v1.packageId}`);
    for (const fName of pkgFiles) {
      const fBytes = await opfsRoot.readFileBytes(`${base}/packages/${v1.packageId}/${fName}`);
      await opfsRoot.writeFileBytes(`${base}/backups/${v1.packageId}.backup/${fName}`, fBytes);
    }
    const backupMarker = {
      schemaVersion: 1,
      packageId: v1.packageId,
      accountNamespaceHash: RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-a'),
      revision: imp.record!.revision,
      manifestSha256: imp.record!.manifestSha256,
      compositeSha256: imp.record!.compositeSha256,
      record: imp.record!,
      createdAt: '2026-11-17T15:05:00.000Z',
    };
    await opfsRoot.writeFileBytes(
      `${base}/backups/${v1.packageId}.backup/backup.ready.json`,
      new TextEncoder().encode(JSON.stringify(backupMarker)),
    );
    await opfsRoot.deletePath(`${base}/packages/${v1.packageId}/commit.json`);
    await opfsRoot.writeFileBytes(
      `${base}/packages/${v1.packageId}/stem_vocals.wav`,
      new Uint8Array([0, 1, 2]),
    );

    const recovered = await manager.loadLibrary({ userId: 'user-a' });
    expect(recovered.recoveredOrphanedCount).toBeGreaterThanOrEqual(4);
    expect(recovered.packages).toHaveLength(1);
    expect(recovered.packages[0].integrityState).toBe('verified');
    expect(recovered.packages[0].isReadyForLocalUse).toBe(true);
    expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);
    expect(await opfsRoot.listNames(`${base}/backups`)).toEqual([]);
    expect(await opfsRoot.hasPath(`${base}/index.tmp.json`)).toBe(false);
    expect(
      await opfsRoot.hasPath(`${base}/packages/99999999-9999-4999-8999-999999999999`),
    ).toBe(false);

    // Simulate missing commit.json -> incomplete
    await opfsRoot.deletePath(`${base}/packages/${v1.packageId}/commit.json`);
    const afterMissingCommit = await manager.loadLibrary({ userId: 'user-a' });
    expect(afterMissingCommit.packages[0].integrityState).toBe('incomplete');
    expect(afterMissingCommit.packages[0].isReadyForLocalUse).toBe(false);
    expect(afterMissingCommit.corruptedOrIncompleteCount).toBe(1);

    // Truncate stem_drums.wav on fresh package -> incomplete
    const freshV1 = await buildTestPackageZip({ packageId: 'bbbbbbbb-2222-4222-8222-222222222222' });
    await manager.importPackage({ userId: 'user-a', file: freshV1.file });
    await opfsRoot.writeFileBytes(
      `${base}/packages/${freshV1.packageId}/stem_drums.wav`,
      new Uint8Array([1, 2, 3, 4]),
    );
    const afterTruncate = await manager.loadLibrary({ userId: 'user-a' });
    const truncatedPkg = afterTruncate.packages.find((p) => p.packageId === freshV1.packageId)!;
    expect(truncatedPkg.integrityState).toBe('incomplete');
    expect(truncatedPkg.isReadyForLocalUse).toBe(false);

    // Evict/delete stem_other.wav on an otherwise intact package -> missingFiles
    const freshV2 = await buildTestPackageZip({ packageId: 'cccccccc-3333-4333-8333-333333333333' });
    await manager.importPackage({ userId: 'user-a', file: freshV2.file });
    await opfsRoot.deletePath(`${base}/packages/${freshV2.packageId}/stem_other.wav`);
    const afterEvict = await manager.loadLibrary({ userId: 'user-a' });
    const evictedPkg = afterEvict.packages.find((p) => p.packageId === freshV2.packageId)!;
    expect(evictedPkg.integrityState).toBe('missingFiles');
    expect(evictedPkg.isReadyForLocalUse).toBe(false);

    // Recover valid index.tmp.json when main index.json was corrupted mid-write
    const validIndexBytes = await opfsRoot.readFileBytes(`${base}/index.json`);
    await opfsRoot.writeFileBytes(`${base}/index.tmp.json`, validIndexBytes);
    await opfsRoot.writeFileBytes(`${base}/index.json`, new TextEncoder().encode('{"corrupted'));
    const recoveredIndex = await manager.loadLibrary({ userId: 'user-a' });
    expect(recoveredIndex.packages).toHaveLength(3);
    expect(await opfsRoot.hasPath(`${base}/index.tmp.json`)).toBe(false);
  });

  it('blocks import on quota preflight and rolls back mid-extraction QuotaExceededError preserving existing packages', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    let availableBytes = 2 * 1024 * 1024 * 1024;
    let failOnExtract = false;
    let extractBytesWritten = 0;

    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({
        quota: availableBytes,
        usage: 0,
      }),
      testSinkWrapper: (ctx, sink) => {
        if (!failOnExtract || ctx.stage !== 'extracting') {
          return sink;
        }
        return {
          async write(chunk) {
            extractBytesWritten += chunk.byteLength;
            if (extractBytesWritten > 512) {
              throw makeDomException('Quota exceeded during extraction', 'QuotaExceededError');
            }
            return sink.write(chunk);
          },
          close: () => sink.close(),
          abort: (r) => sink.abort?.(r) ?? Promise.resolve(),
        };
      },
    });

    const pkgA = await buildTestPackageZip({ packageId: 'aaaaaaaa-0000-4000-8000-000000000001' });
    const resA = await manager.importPackage({ userId: 'user-a', file: pkgA.file });
    expect(resA.category).toBe('imported');

    // 1. Preflight block (< file.size + 256 MiB)
    availableBytes = LIMITS_V1.minFreeSpaceReserveBytes - 1024;
    const pkgB = await buildTestPackageZip({ packageId: 'bbbbbbbb-0000-4000-8000-000000000002' });
    const preflightFail = await manager.importPackage({ userId: 'user-a', file: pkgB.file });
    expect(preflightFail.category).toBe('insufficientSpace');
    expect(preflightFail.errorCode).toBe('INSUFFICIENT_STORAGE_SPACE');

    // 2. Mid-extraction QuotaExceededError rollback preserving pkgA
    availableBytes = 2 * 1024 * 1024 * 1024;
    failOnExtract = true;
    extractBytesWritten = 0;
    const extractFail = await manager.importPackage({ userId: 'user-a', file: pkgB.file });
    expect(extractFail.category).toBe('insufficientSpace');
    expect(extractFail.errorCode).toBe('INSUFFICIENT_STORAGE_SPACE');

    const base = accountBasePath('user-a');
    expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);
    expect(await opfsRoot.hasPath(`${base}/packages/${pkgB.packageId}`)).toBe(false);

    const snapshot = await manager.loadLibrary({ userId: 'user-a' });
    expect(snapshot.packages).toHaveLength(1);
    expect(snapshot.packages[0].packageId).toBe(pkgA.packageId);
    expect(snapshot.packages[0].isReadyForLocalUse).toBe(true);
  });

  it('supports cooperative cancellation via cancelActiveOperation and cleans staging', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    let opIdToCancel: string | undefined;
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip();
    const res = await manager.importPackage({
      userId: 'user-a',
      file: pkg.file,
      onProgress: (p) => {
        if (p.phase === 'stagingCopy' && !opIdToCancel) {
          opIdToCancel = p.operationId;
          manager.cancelActiveOperation(opIdToCancel);
        }
      },
    });

    expect(res.category).toBe('cancelled');
    expect(res.errorCode).toBe('VALIDATION_CANCELLED');

    const base = accountBasePath('user-a');
    expect(await opfsRoot.listNames(`${base}/staging`)).toEqual([]);
    expect(await opfsRoot.listNames(`${base}/packages`)).toEqual([]);
  });

  it('detects disk bit-flip in revalidatePackage and blocks exportPackage', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip();
    await manager.importPackage({ userId: 'user-a', file: pkg.file });

    const base = accountBasePath('user-a');
    const stemPath = `${base}/packages/${pkg.packageId}/stem_bass.wav`;
    const bytes = await opfsRoot.readFileBytes(stemPath);
    bytes[bytes.length - 1] ^= 0x01; // 1-bit flip keeping exact byteLength
    await opfsRoot.writeFileBytes(stemPath, bytes);

    const reval = await manager.revalidatePackage({ userId: 'user-a', packageId: pkg.packageId });
    expect(reval.category).toBe('corrupted');
    expect(reval.errorCode).toBe('SHA256_MISMATCH');
    expect(reval.record?.integrityState).toBe('corrupted');
    expect(reval.record?.isReadyForLocalUse).toBe(false);

    const exportBlocked = await manager.exportPackage({
      userId: 'user-a',
      packageId: pkg.packageId,
    });
    expect(exportBlocked.category).toBe('corrupted');
    expect(exportBlocked.exportedBlob).toBeUndefined();
  });

  it('exports valid packages via saveHandle stream or fallback Blob', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip({ displayName: 'Culto Especial' });
    await manager.importPackage({ userId: 'user-a', file: pkg.file });

    // 1. Export via SaveFileHandleLike
    const savedChunks: Uint8Array[] = [];
    let closed = false;
    const saveHandle: SaveFileHandleLike = {
      async createWritable() {
        return {
          async write(data) {
            if (typeof data === 'string') {
              savedChunks.push(new TextEncoder().encode(data));
            } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
              savedChunks.push(new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
            } else {
              savedChunks.push(new Uint8Array(await data.arrayBuffer()));
            }
          },
          async close() {
            closed = true;
          },
        };
      },
    };

    const saveOut = await manager.exportPackage({
      userId: 'user-a',
      packageId: pkg.packageId,
      saveHandle,
    });
    expect(saveOut.category).toBe('exported');
    expect(saveOut.exportedFileName).toBe('Culto-Especial.louvaio-rehearsal.zip');
    expect(saveOut.exportedBlob).toBeUndefined();
    expect(closed).toBe(true);

    const totalLen = savedChunks.reduce((s, c) => s + c.byteLength, 0);
    const savedBytes = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of savedChunks) {
      savedBytes.set(c, pos);
      pos += c.byteLength;
    }
    const checkSaved = await validateRehearsalPackage(savedBytes);
    expect(checkSaved.status).toBe('valid');

    // 2. Export via fallback Blob
    const blobOut = await manager.exportPackage({
      userId: 'user-a',
      packageId: pkg.packageId,
    });
    expect(blobOut.category).toBe('exported');
    expect(blobOut.exportedBlob).toBeDefined();
    expect(blobOut.exportedFileName).toBe('Culto-Especial.louvaio-rehearsal.zip');
    const checkBlob = await validateRehearsalPackage(blobOut.exportedBlob!);
    expect(checkBlob.status).toBe('valid');
  });

  it('validates label rename (1..120 chars) and scoped delete (confirmedScope: true)', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip({ displayName: 'Título Original' });
    await manager.importPackage({ userId: 'user-a', file: pkg.file });

    const blankRename = await manager.renamePackageLabel({
      userId: 'user-a',
      packageId: pkg.packageId,
      label: '   ',
    });
    expect(blankRename.category).toBe('recoverableFailure');
    expect(blankRename.errorCode).toBe('INVALID_PACKAGE_LABEL');

    const longRename = await manager.renamePackageLabel({
      userId: 'user-a',
      packageId: pkg.packageId,
      label: 'a'.repeat(121),
    });
    expect(longRename.category).toBe('recoverableFailure');
    expect(longRename.errorCode).toBe('INVALID_PACKAGE_LABEL');

    const okRename = await manager.renamePackageLabel({
      userId: 'user-a',
      packageId: pkg.packageId,
      label: '  Ensaio Sexta  ',
    });
    expect(okRename.category).toBe('renamed');
    expect(okRename.record?.customLabel).toBe('Ensaio Sexta');
    expect(okRename.record?.displayName).toBe('Ensaio Sexta');
    expect(okRename.record?.title).toBe('Título Original');

    // Unconfirmed delete must fail closed
    const unconfirmedDel = await manager.deletePackage({
      userId: 'user-a',
      packageId: pkg.packageId,
      confirmedScope: false,
    });
    expect(unconfirmedDel.category).toBe('cancelled');
    expect(unconfirmedDel.errorCode).toBe('DELETE_CONFIRMATION_REQUIRED');
    expect((await manager.loadLibrary({ userId: 'user-a' })).packages).toHaveLength(1);

    // Confirmed delete removes package and files
    const confirmedDel = await manager.deletePackage({
      userId: 'user-a',
      packageId: pkg.packageId,
      confirmedScope: true,
    });
    expect(confirmedDel.category).toBe('deleted');

    const base = accountBasePath('user-a');
    expect(await opfsRoot.listNames(`${base}/packages`)).toEqual([]);
    expect((await manager.loadLibrary({ userId: 'user-a' })).packages).toEqual([]);
  });

  it('enforces multi-account isolation, ministry independence, and invalidateSession() without deleting OPFS files', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    // Namespace hash depends solely on userId (independent of ministry)
    const hashA1 = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-a');
    const hashA2 = RehearsalPackageLibraryManager.computeAccountNamespaceHash(' user-a ');
    const hashB = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-b');
    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);

    const pkg1 = await buildTestPackageZip({ packageId: 'aaaaaaaa-1111-4111-8111-111111111111' });
    await manager.importPackage({ userId: 'user-a', file: pkg1.file });

    // user-b cannot see or mutate user-a's package
    const snapB = await manager.loadLibrary({ userId: 'user-b' });
    expect(snapB.packages).toEqual([]);
    expect((await manager.exportPackage({ userId: 'user-b', packageId: pkg1.packageId })).category).toBe(
      'recoverableFailure',
    );
    expect(
      (await manager.deletePackage({ userId: 'user-b', packageId: pkg1.packageId, confirmedScope: true }))
        .category,
    ).toBe('recoverableFailure');

    // Pending conflict created by user-a cannot be confirmed or discarded by user-b
    const pkg1v2 = await buildTestPackageZip({
      packageId: pkg1.packageId,
      revision: 2,
      seedOffset: 77,
    });
    const conflictA = await manager.importPackage({ userId: 'user-a', file: pkg1v2.file });
    expect(conflictA.category).toBe('conflict');
    const crossConfirm = await manager.confirmConflictReplace({
      userId: 'user-b',
      pendingTransactionId: conflictA.conflict!.pendingTransactionId,
    });
    expect(crossConfirm.errorCode).toBe('PENDING_CONFLICT_NOT_FOUND');

    // invalidateSession cancels active imports and preserves persisted OPFS packages
    const pkg2 = await buildTestPackageZip({ packageId: 'cccccccc-3333-4333-8333-333333333333' });
    let invalidated = false;
    const inFlight = await manager.importPackage({
      userId: 'user-a',
      file: pkg2.file,
      onProgress: (p) => {
        if (p.phase === 'stagingCopy' && !invalidated) {
          invalidated = true;
          manager.invalidateSession();
        }
      },
    });
    expect(inFlight.category).toBe('cancelled');

    // Persisted package for user-a remains intact on OPFS
    const snapA = await manager.loadLibrary({ userId: 'user-a' });
    expect(snapA.packages).toHaveLength(1);
    expect(snapA.packages[0].packageId).toBe(pkg1.packageId);
    expect(snapA.packages[0].isReadyForLocalUse).toBe(true);
  });

  it('preserves active staging txId during concurrent loadLibrary recovery', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => opfsRoot,
      quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 0 }),
    });

    const pkg = await buildTestPackageZip();
    let concurrentLoadDone: Promise<unknown> | null = null;
    const imp = await manager.importPackage({
      userId: 'user-a',
      file: pkg.file,
      onProgress: (p) => {
        if (p.phase === 'extracting' && !concurrentLoadDone) {
          concurrentLoadDone = manager.loadLibrary({ userId: 'user-a' });
        }
      },
    });

    expect(imp.category).toBe('imported');
    expect(concurrentLoadDone).not.toBeNull();
    await concurrentLoadDone;
    const finalSnap = await manager.loadLibrary({ userId: 'user-a' });
    expect(finalSnap.packages).toHaveLength(1);
  });

  it('falls back cleanly to ephemeral-fallback when OPFS throws SecurityError and detects revoked external handle permissions', async () => {
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => {
        throw makeDomException('OPFS disabled in private mode', 'SecurityError');
      },
      quotaEstimator: async () => ({ quota: 1024 * 1024 * 1024, usage: 0 }),
    });

    const initialSnap = await manager.loadLibrary({ userId: 'user-a' });
    expect(initialSnap.storageSummary.storageMode).toBe('ephemeral-fallback');
    expect(initialSnap.storageSummary.persistentGranted).toBe(false);
    expect(initialSnap.storageSummary.persistentWarning).toContain('sessão');

    const pkg = await buildTestPackageZip();
    let permState: 'granted' | 'denied' = 'granted';
    const externalHandle: ExternalFileHandleLike = {
      name: 'ensaio.louvaio-rehearsal.zip',
      async queryPermission() {
        return permState;
      },
      async getFile() {
        if (permState === 'denied') {
          throw makeDomException('Permission revoked', 'NotAllowedError');
        }
        return pkg.file;
      },
    };

    const imp = await manager.importPackage({
      userId: 'user-a',
      externalHandle,
    });
    expect(imp.category).toBe('imported');
    expect(imp.record?.storageMode).toBe('ephemeral-fallback');

    const okExport = await manager.exportPackage({
      userId: 'user-a',
      packageId: pkg.packageId,
    });
    expect(okExport.category).toBe('exported');
    expect(okExport.exportedBlob).toBeDefined();

    // Revoke permission on external handle -> permissionDenied
    permState = 'denied';
    const revalDenied = await manager.revalidatePackage({
      userId: 'user-a',
      packageId: pkg.packageId,
    });
    expect(revalDenied.category).toBe('permissionDenied');
    expect(revalDenied.errorCode).toBe('PERMISSION_DENIED');
    expect(revalDenied.record?.integrityState).toBe('permissionDenied');
    expect(revalDenied.record?.isReadyForLocalUse).toBe(false);

    const exportDenied = await manager.exportPackage({
      userId: 'user-a',
      packageId: pkg.packageId,
    });
    expect(exportDenied.category).toBe('permissionDenied');
    expect(exportDenied.exportedBlob).toBeUndefined();

    // invalidateSession releases ephemeral handle references
    manager.invalidateSession();
    const afterLogout = await manager.loadLibrary({ userId: 'user-a' });
    expect(afterLogout.packages).toEqual([]);
  });

  it('exposes EphemeralMemoryRehearsalStorageBackend and module session helpers', () => {
    const backend = new EphemeralMemoryRehearsalStorageBackend();
    const store = backend.getOrCreateAccount('hash-1');
    expect(backend.getAccount('hash-1')).toBe(store);
    backend.clearAll();
    expect(backend.getAccount('hash-1')).toBeUndefined();

    const defaultMgr = getDefaultRehearsalPackageLibraryManager();
    expect(defaultMgr).toBeInstanceOf(RehearsalPackageLibraryManager);
    invalidateActiveRehearsalLibrarySession();
  });
});
