import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import {
  createSyntheticWavFile,
  readBlobAsArrayBuffer,
  type LocalAudioTransportDependencies,
  type MediaElementLike,
} from './local-audio-transport';
import {
  buildSyntheticFlac,
  buildSyntheticWav,
  buildSyntheticZip,
  sha256Hex,
  type SyntheticZipEntryInput,
} from './rehearsal-package-fixtures';
import {
  RehearsalPackageLibraryManager,
  type OpfsDirectoryHandleLike,
  type OpfsFileHandleLike,
  type OpfsWritableStreamLike,
} from './rehearsal-package-library';
import { REHEARSAL_PACKAGE_FORMAT, REHEARSAL_PACKAGE_FORMAT_VERSION, type RequiredStemId } from './rehearsal-package-validator';
import {
  GlobalRehearsalAudioSessionController,
  SAFE_VERSION_ID_REGEX,
  bindSongVersion,
  extractCanonicalSongVersions,
  reconcileSongVersionBindings,
  resolveCanonicalSongVersion,
  unbindSongVersion,
  type SongForVersionResolution,
} from './song-version-audio-binding';

function makeDomException(message: string, name: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

class FakeOpfsWritableStream implements OpfsWritableStreamLike {
  private readonly chunks: Uint8Array[] = [];
  private closed = false;
  private aborted = false;

  constructor(private readonly onCommit: (bytes: Uint8Array) => void) {}

  async write(data: Uint8Array | Blob | string): Promise<void> {
    if (this.closed || this.aborted) {
      throw new Error('Stream already closed or aborted.');
    }
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else {
      bytes = new Uint8Array(await data.arrayBuffer());
    }
    this.chunks.push(bytes);
  }

  async close(): Promise<void> {
    if (this.aborted || this.closed) return;
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

  constructor(readonly name: string, initialBytes: Uint8Array = new Uint8Array(0)) {
    this.bytes = new Uint8Array(initialBytes);
  }

  async getFile(): Promise<File> {
    const copy = new Uint8Array(this.bytes.byteLength);
    copy.set(this.bytes);
    return new File([copy], this.name, { type: 'application/octet-stream' });
  }

  async createWritable(): Promise<OpfsWritableStreamLike> {
    return new FakeOpfsWritableStream((committed) => {
      this.bytes = committed;
    });
  }
}

class FakeOpfsDirectoryHandle implements OpfsDirectoryHandleLike {
  readonly kind = 'directory' as const;
  private readonly children = new Map<string, FakeOpfsDirectoryHandle | FakeOpfsFileHandle>();

  constructor(readonly name: string) {}

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
    const created = new FakeOpfsDirectoryHandle(name);
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
    const created = new FakeOpfsFileHandle(name);
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
    for (const [k, v] of Array.from(this.children.entries())) {
      yield [k, v];
    }
  }

  async resolveDir(segments: string[], create = false): Promise<FakeOpfsDirectoryHandle> {
    let curr: FakeOpfsDirectoryHandle = this;
    for (const seg of segments) {
      curr = await curr.getDirectoryHandle(seg, { create });
    }
    return curr;
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
}

class FakeMediaElement implements MediaElementLike {
  src = '';
  autoplay = false;
  preload = 'metadata';
  currentTime = 0;
  duration = NaN;
  playbackRate = 1;
  preservesPitch = true;
  volume = 1;
  paused = true;
  error: { code?: number; message?: string } | null = null;
  playCalls = 0;
  pauseCalls = 0;

  private listeners = new Map<string, Set<EventListener>>();

  constructor(private readonly durationSeconds = 1) {}

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const evt = new Event(type);
    for (const listener of [...set]) {
      listener(evt);
    }
  }

  removeAttribute(qualifiedName: string): void {
    if (qualifiedName === 'src') {
      this.src = '';
    }
  }

  load(): void {
    if (!this.src) return;
    queueMicrotask(() => {
      this.duration = this.durationSeconds;
      this.dispatch('loadedmetadata');
    });
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.dispatch('playing');
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
    this.dispatch('pause');
  }
}

function createFakeTransportDeps() {
  let urlCounter = 0;
  const activeUrls = new Set<string>();
  const elements: FakeMediaElement[] = [];

  const deps: LocalAudioTransportDependencies = {
    createAudioElement: () => {
      const el = new FakeMediaElement(0.5);
      elements.push(el);
      return el;
    },
    createAudioContext: () => null,
    createObjectURL: () => {
      const url = `blob:t10-test-${++urlCounter}`;
      activeUrls.add(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      activeUrls.delete(url);
    },
    enableWebAudioGain: false,
  };

  return { deps, activeUrls, elements };
}

async function buildTestPackageZip(options: {
  packageId?: string;
  revision?: number;
  displayName?: string;
  includeOriginal?: boolean;
  originalContainer?: 'wav' | 'flac';
  seedOffset?: number;
  frames?: number;
} = {}) {
  const packageId = options.packageId ?? '11111111-2222-4333-8444-555555555555';
  const revision = options.revision ?? 1;
  const displayName = options.displayName ?? 'Rehearsal Package 1';
  const includeOriginal = options.includeOriginal ?? true;
  const originalContainer = options.originalContainer ?? 'wav';
  const seedOffset = options.seedOffset ?? 0;
  const frames = options.frames ?? 4410;

  const stemIds: RequiredStemId[] = ['vocals', 'drums', 'bass', 'other'];
  const zipEntries: SyntheticZipEntryInput[] = [];
  const stemDecls = stemIds.map((stemId, index) => {
    const data = buildSyntheticWav({ frames, bitsPerSample: 16, seed: index + 1 + seedOffset });
    const path = `stems/${stemId}.wav`;
    zipEntries.push({ path, data, compressionMethod: 0 });
    return {
      id: stemId,
      path,
      container: 'wav',
      codec: 'pcm_s16le',
      bitsPerSample: 16,
      byteLength: data.byteLength,
      sha256: sha256Hex(data),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: frames,
    };
  });

  let originalDecl: Record<string, unknown> = { included: false };
  let originalBytes: Uint8Array | null = null;
  if (includeOriginal) {
    originalBytes =
      originalContainer === 'flac'
        ? buildSyntheticFlac({ totalSamples: frames, bitsPerSample: 24, seed: 99 + seedOffset })
        : buildSyntheticWav({ frames, bitsPerSample: 16, seed: 99 + seedOffset });
    const origPath = `audio/original.${originalContainer}`;
    zipEntries.push({ path: origPath, data: originalBytes, compressionMethod: 0 });
    originalDecl = {
      included: true,
      path: origPath,
      container: originalContainer,
      codec: originalContainer === 'flac' ? 'flac' : 'pcm_s16le',
      bitsPerSample: originalContainer === 'flac' ? 24 : 16,
      byteLength: originalBytes.byteLength,
      sha256: sha256Hex(originalBytes),
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
    source: {
      sha256: 'a'.repeat(64),
      sanitizedFileName: 'ensaio.wav',
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
  const bytes = await buildSyntheticZip([
    { path: 'manifest.json', data: manifestBytes, compressionMethod: 8 },
    ...zipEntries,
  ]);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], 'ensaio.louvaio-rehearsal.zip', { type: 'application/zip' });
  return { file, packageId, revision, displayName, originalBytes };
}

function createOpfsManager(opfsRoot: FakeOpfsDirectoryHandle) {
  let txCounter = 0;
  return new RehearsalPackageLibraryManager({
    getOpfsRoot: async () => opfsRoot,
    quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 1024 * 1024 }),
    persistenceChecker: async () => false,
    txIdGenerator: () => `tx-${++txCounter}`,
    now: () => new Date('2026-11-17T18:00:00.000Z'),
  });
}

function createEphemeralManager() {
  let txCounter = 0;
  return new RehearsalPackageLibraryManager({
    getOpfsRoot: async () => {
      throw makeDomException('OPFS disabled', 'SecurityError');
    },
    quotaEstimator: async () => ({ quota: 512 * 1024 * 1024, usage: 0 }),
    persistenceChecker: async () => false,
    txIdGenerator: () => `eph-tx-${++txCounter}`,
    now: () => new Date('2026-11-17T18:00:00.000Z'),
  });
}

describe('Canonical SongVersion Identity & Resolution (T10 Fase A)', () => {
  it('resolves single explicit version when requestedVersionId is omitted or matches', () => {
    const song: SongForVersionResolution = {
      id: 'song-1',
      title: 'Santo',
      versions: [{ id: 'ver-orig', name: 'Original', key: 'G' }],
    };

    const implicit = resolveCanonicalSongVersion(song);
    expect(implicit.status).toBe('resolved');
    if (implicit.status === 'resolved') {
      expect(implicit.version.id).toBe('ver-orig');
      expect(implicit.version.isSynthetic).toBe(false);
      expect(implicit.matchedViaLegacyV1Alias).toBe(false);
    }

    const explicit = resolveCanonicalSongVersion(song, 'ver-orig');
    expect(explicit.status).toBe('resolved');
  });

  it('resolves multi-version song by explicit ID and never auto-selects index 0 when missing', () => {
    const song: SongForVersionResolution = {
      id: 'song-multi',
      title: 'Grande É o Senhor',
      versions: [
        { id: 'ver-1', name: 'Original', key: 'C' },
        { id: 'ver-2', name: 'Acústico', key: 'D' },
      ],
    };

    const missing = resolveCanonicalSongVersion(song);
    expect(missing.status).toBe('version_required');
    expect(missing.effectiveVersions).toHaveLength(2);

    const blank = resolveCanonicalSongVersion(song, '   ');
    expect(blank.status).toBe('version_required');

    const picked = resolveCanonicalSongVersion(song, 'ver-2');
    expect(picked.status).toBe('resolved');
    if (picked.status === 'resolved') {
      expect(picked.version.id).toBe('ver-2');
      expect(picked.version.name).toBe('Acústico');
    }

    const unknown = resolveCanonicalSongVersion(song, 'ver-nonexistent');
    expect(unknown.status).toBe('version_not_found');
  });

  it('synthesizes <songId>_v1 for legacy flat songs and allows "v1" alias ONLY on synthetic single-version songs', () => {
    const flatSong: SongForVersionResolution = {
      id: 'legacy-song-42',
      title: 'Legado',
      originalKey: 'E',
      versions: [],
    };

    const versions = extractCanonicalSongVersions(flatSong);
    expect(versions).toEqual([
      {
        id: 'legacy-song-42_v1',
        name: 'Original',
        key: 'E',
        bpm: null,
        duration: null,
        isSynthetic: true,
      },
    ]);

    const viaAlias = resolveCanonicalSongVersion(flatSong, 'v1');
    expect(viaAlias.status).toBe('resolved');
    if (viaAlias.status === 'resolved') {
      expect(viaAlias.version.id).toBe('legacy-song-42_v1');
      expect(viaAlias.matchedViaLegacyV1Alias).toBe(true);
    }

    // Explicit single-version song must NOT accept legacy "v1" alias
    const explicitSingle: SongForVersionResolution = {
      id: 'explicit-single',
      versions: [{ id: 'ver-custom', name: 'Original', key: 'A' }],
    };
    expect(resolveCanonicalSongVersion(explicitSingle, 'v1').status).toBe('version_not_found');

    // Multi-version song must NOT accept legacy "v1" alias
    const multiSong: SongForVersionResolution = {
      id: 'multi',
      versions: [
        { id: 'ver-a', name: 'Original', key: 'A' },
        { id: 'ver-b', name: 'Live', key: 'B' },
      ],
    };
    expect(resolveCanonicalSongVersion(multiSong, 'v1').status).toBe('version_not_found');
  });

  it('distinguishes duplicate version names strictly by canonical ID and blocks unsafe version IDs', () => {
    expect(SAFE_VERSION_ID_REGEX.test('ver 1 (ao vivo)')).toBe(true);
    expect(SAFE_VERSION_ID_REGEX.test('../escape')).toBe(false);
    expect(SAFE_VERSION_ID_REGEX.test('ver?x=1')).toBe(false);
    expect(SAFE_VERSION_ID_REGEX.test('<script>')).toBe(false);

    const song: SongForVersionResolution = {
      id: 'song-dup-names',
      versions: [
        { id: 'ver-1', name: 'Ao Vivo', key: 'G' },
        { id: 'ver-2', name: 'Ao Vivo', key: 'A' },
        { id: '../bad', name: 'Malicious', key: 'C' },
      ],
    };

    const extracted = extractCanonicalSongVersions(song);
    expect(extracted.map((v) => v.id)).toEqual(['ver-1', 'ver-2']);

    const resolvedSecond = resolveCanonicalSongVersion(song, 'ver-2');
    expect(resolvedSecond.status).toBe('resolved');
    if (resolvedSecond.status === 'resolved') {
      expect(resolvedSecond.version.key).toBe('A');
    }
  });

  it('isolates same-title different-ID songs and handles schedule items with/without versionId', () => {
    const songAlpha: SongForVersionResolution = { id: 'song-alpha', title: 'Hosana', originalKey: 'G' };
    const songBeta: SongForVersionResolution = { id: 'song-beta', title: 'Hosana', originalKey: 'G' };

    const resA = resolveCanonicalSongVersion(songAlpha);
    const resB = resolveCanonicalSongVersion(songBeta);
    expect(resA.status === 'resolved' && resB.status === 'resolved').toBe(true);
    if (resA.status === 'resolved' && resB.status === 'resolved') {
      expect(resA.version.id).toBe('song-alpha_v1');
      expect(resB.version.id).toBe('song-beta_v1');
      expect(resA.version.id).not.toBe(resB.version.id);
    }

    // Schedule item with explicit versionId vs missing versionId on multi-version song
    const scheduleSong: SongForVersionResolution = {
      id: 'song-sched',
      versions: [
        { id: 'v-studio', name: 'Estúdio', key: 'C' },
        { id: 'v-cong', name: 'Congregacional', key: 'Bb' },
      ],
    };
    expect(resolveCanonicalSongVersion(scheduleSong, undefined).status).toBe('version_required');
    const withScheduleVersion = resolveCanonicalSongVersion(scheduleSong, 'v-cong');
    expect(withScheduleVersion.status).toBe('resolved');
    if (withScheduleVersion.status === 'resolved') {
      expect(withScheduleVersion.version.id).toBe('v-cong');
    }
  });
});

describe('LocalSongVersionAudioBinding & Verified Asset Resolver (T10)', () => {
  it('invalidates adapter legacy-to-explicit identity even when the canonical ID is reused, with a sticky tombstone', async () => {
    const manager = createEphemeralManager();
    const pkg = await buildTestPackageZip({ packageId: 'edededed-eded-4ded-8ded-edededededed' });
    await manager.importPackage({ userId: 'user-1', file: pkg.file });
    const readSong = async (versions?: unknown[]) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        text: async () => JSON.stringify({ data: { id: 'legacy', ministry_id: 'min-1', versions } }),
      }));
      return api.getSongById('legacy', 'min-1');
    };
    try {
      const legacy = await readSong();
      const bound = await bindSongVersion(manager, {
        userId: 'user-1', ministryId: 'min-1', song: legacy, requestedVersionId: 'v1',
        packageId: pkg.packageId, songReadVerified: true,
      });
      expect(bound.ok).toBe(true);
      const explicit = await readSong([{ id: 'legacy_v1', name: 'Recreated' }]);
      const reconciled = await reconcileSongVersionBindings(manager, { userId: 'user-1', ministryId: 'min-1', song: explicit });
      expect(reconciled.bindings[0].validityState).toBe('version_removed');
      const legacyAgain = await readSong();
      const again = await reconcileSongVersionBindings(manager, { userId: 'user-1', ministryId: 'min-1', song: legacyAgain });
      expect(again.bindings[0].validityState).toBe('version_removed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('binds, switches versions, persists bindingStatus linked/unlinked, and supports offline playback without network calls', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkg1 = await buildTestPackageZip({
      packageId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Studio Track',
      seedOffset: 10,
    });
    const pkg2 = await buildTestPackageZip({
      packageId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Acoustic Track',
      seedOffset: 20,
    });
    await manager.importPackage({ userId: 'user-1', file: pkg1.file });
    await manager.importPackage({ userId: 'user-1', file: pkg2.file });

    const song: SongForVersionResolution = {
      id: 'song-100',
      title: 'A Casa É Sua',
      ministryId: 'min-1',
      versions: [
        { id: 'v-studio', name: 'Estúdio', key: 'G' },
        { id: 'v-acoustic', name: 'Acústico', key: 'F' },
      ],
    };

    const bind1 = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: 'v-studio',
      packageId: pkg1.packageId,
      songReadVerified: true,
      isOnline: true,
      explicitlySelectedByUser: true,
    });
    expect(bind1.ok).toBe(true);
    if (bind1.ok) {
      expect(bind1.binding.assetId).toBe('original');
      expect(bind1.binding.canonicalVersionId).toBe('v-studio');
      expect(bind1.binding.validityState).toBe('valid');
    }

    const bind2 = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: 'v-acoustic',
      packageId: pkg2.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(bind2.ok).toBe(true);

    // Library shows linked status for both packages
    const lib = await manager.loadLibrary({ userId: 'user-1' });
    expect(lib.packages.every((p) => p.bindingStatus === 'linked')).toBe(true);

    // Backward-compatible index.json check: metadata only, bindings present
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-1');
    const idxBytes = await opfsRoot.readFileBytes(`louvaio-rehearsal-v1/${accountHash}/index.json`);
    const idxJson = JSON.parse(new TextDecoder().decode(idxBytes));
    expect(idxJson.bindings).toHaveLength(2);

    // Same title, different songId stays unbound
    const sameTitleOtherSong = await manager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-other-id',
      canonicalVersionId: 'v-studio',
    });
    expect(sameTitleOtherSong.status).toBe('not_bound');

    // Different ministry stays isolated
    const otherMinistry = await manager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-2',
      songId: 'song-100',
      canonicalVersionId: 'v-studio',
    });
    expect(otherMinistry.status).toBe('not_bound');

    // Different user stays isolated
    const otherUser = await manager.resolveVerifiedBoundAsset({
      userId: 'user-2',
      ministryId: 'min-1',
      songId: 'song-100',
      canonicalVersionId: 'v-studio',
    });
    expect(otherUser.status).toBe('not_bound');

    // Offline playback of pre-existing verified binding succeeds with zero fetch calls
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const resolved1 = await manager.resolveVerifiedBoundAsset({
        userId: 'user-1',
        ministryId: 'min-1',
        songId: 'song-100',
        canonicalVersionId: 'v-studio',
      });
      expect(resolved1.status).toBe('ready');
      if (resolved1.status === 'ready') {
        expect(resolved1.fileName).toBe('original.wav');
        expect(resolved1.verifiedSha256).toBe(sha256Hex(pkg1.originalBytes!));
      }

      const resolved2 = await manager.resolveVerifiedBoundAsset({
        userId: 'user-1',
        ministryId: 'min-1',
        songId: 'song-100',
        canonicalVersionId: 'v-acoustic',
      });
      expect(resolved2.status).toBe('ready');
      if (resolved2.status === 'ready') {
        expect(resolved2.verifiedSha256).toBe(sha256Hex(pkg2.originalBytes!));
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Unbind v-studio keeps pkg1 in personal library and flips its bindingStatus back to unlinked
    const unbindRes = await unbindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-100',
      canonicalVersionId: 'v-studio',
    });
    expect(unbindRes.removed).toBe(true);
    const afterUnbind = await manager.loadLibrary({ userId: 'user-1' });
    expect(afterUnbind.packages).toHaveLength(2);
    expect(afterUnbind.packages.find((p) => p.packageId === pkg1.packageId)?.bindingStatus).toBe('unlinked');
    expect(afterUnbind.packages.find((p) => p.packageId === pkg2.packageId)?.bindingStatus).toBe('linked');
  });

  it('reads legacy index.json without bindings field seamlessly', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkg = await buildTestPackageZip();
    await manager.importPackage({ userId: 'user-legacy', file: pkg.file });

    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-legacy');
    const indexPath = `louvaio-rehearsal-v1/${accountHash}/index.json`;
    const parsed = JSON.parse(new TextDecoder().decode(await opfsRoot.readFileBytes(indexPath)));
    delete parsed.bindings;
    await opfsRoot.writeFileBytes(indexPath, new TextEncoder().encode(JSON.stringify(parsed)));

    const bindings = await manager.listBindings({ userId: 'user-legacy' });
    expect(bindings).toEqual([]);
    const lib = await manager.loadLibrary({ userId: 'user-legacy' });
    expect(lib.packages[0].bindingStatus).toBe('unlinked');
  });

  it('rejects bind when offline, unauthenticated, unverified read, tenant mismatched, or missing/corrupted package', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkg = await buildTestPackageZip();
    await manager.importPackage({ userId: 'user-1', file: pkg.file });

    const song: SongForVersionResolution = {
      id: 'song-sec',
      ministryId: 'min-1',
      versions: [{ id: 'v1', name: 'Original', key: 'C' }],
    };

    const offline = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: false,
    });
    expect(offline.ok).toBe(false);
    if (!offline.ok) expect(offline.reason).toBe('OFFLINE_BIND_FORBIDDEN');

    const unauth = await bindSongVersion(manager, {
      userId: '   ',
      ministryId: 'min-1',
      song,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(unauth.ok).toBe(false);
    if (!unauth.ok) expect(unauth.reason).toBe('UNAUTHENTICATED');

    const unverifiedRead = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      packageId: pkg.packageId,
      songReadVerified: false,
      isOnline: true,
    });
    expect(unverifiedRead.ok).toBe(false);
    if (!unverifiedRead.ok) expect(unverifiedRead.reason).toBe('SONG_READ_NOT_VERIFIED');

    const crossMinistry = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-other',
      song,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(crossMinistry.ok).toBe(false);
    if (!crossMinistry.ok) expect(crossMinistry.reason).toBe('TENANT_MISMATCH');

    const crossUserPkg = await bindSongVersion(manager, {
      userId: 'user-2',
      ministryId: 'min-1',
      song,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(crossUserPkg.ok).toBe(false);
    if (!crossUserPkg.ok) expect(crossUserPkg.reason).toBe('PACKAGE_NOT_FOUND');

    // Corrupt package on disk -> revalidate -> bind rejected
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-1');
    const wavPath = `louvaio-rehearsal-v1/${accountHash}/packages/${pkg.packageId}/original.wav`;
    const wavBytes = await opfsRoot.readFileBytes(wavPath);
    wavBytes[wavBytes.length - 1] ^= 0xff;
    await opfsRoot.writeFileBytes(wavPath, wavBytes);
    await manager.revalidatePackage({ userId: 'user-1', packageId: pkg.packageId });

    const corruptedBind = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(corruptedBind.ok).toBe(false);
    if (!corruptedBind.ok) expect(corruptedBind.reason).toBe('PACKAGE_CORRUPTED');
  });

  it('enforces sticky version_removed tombstone, package_missing on delete, and package_replaced_incompatible on conflict replace', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkgV1 = await buildTestPackageZip({
      packageId: '33333333-3333-4333-8333-333333333333',
      revision: 1,
      seedOffset: 1,
    });
    await manager.importPackage({ userId: 'user-1', file: pkgV1.file });

    const songV1: SongForVersionResolution = {
      id: 'song-life',
      ministryId: 'min-1',
      versions: [
        { id: 'ver-keep', name: 'Keep', key: 'C' },
        { id: 'ver-del', name: 'Delete Me', key: 'D' },
      ],
    };

    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: songV1,
      requestedVersionId: 'ver-del',
      packageId: pkgV1.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: songV1,
      requestedVersionId: 'ver-keep',
      packageId: pkgV1.packageId,
      songReadVerified: true,
      isOnline: true,
    });

    // 1. Remove 'ver-del' -> reconciled as 'version_removed'
    const songRemoved: SongForVersionResolution = {
      id: 'song-life',
      ministryId: 'min-1',
      versions: [{ id: 'ver-keep', name: 'Keep', key: 'C' }],
    };
    const rec1 = await reconcileSongVersionBindings(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: songRemoved,
    });
    expect(rec1.invalidatedCount).toBe(1);
    expect(rec1.bindings.find((b) => b.canonicalVersionId === 'ver-del')?.validityState).toBe('version_removed');

    // 2. Recreate version with same ID 'ver-del' -> sticky tombstone must stay 'version_removed'
    const recRecreated = await reconcileSongVersionBindings(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: songV1,
    });
    expect(recRecreated.bindings.find((b) => b.canonicalVersionId === 'ver-del')?.validityState).toBe(
      'version_removed',
    );
    const resolvedRemoved = await manager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-life',
      canonicalVersionId: 'ver-del',
    });
    expect(resolvedRemoved.status).toBe('invalid_binding');
    if (resolvedRemoved.status === 'invalid_binding') {
      expect(resolvedRemoved.validityState).toBe('version_removed');
    }

    // Also verify revalidatePackage NEVER clears sticky 'version_removed'
    await manager.revalidatePackage({ userId: 'user-1', packageId: pkgV1.packageId });
    const afterReval = await manager.listBindings({ userId: 'user-1', ministryId: 'min-1', songId: 'song-life' });
    expect(afterReval.find((b) => b.canonicalVersionId === 'ver-del')?.validityState).toBe('version_removed');

    // 3. Incompatible conflict replace marks 'ver-keep' as 'package_replaced_incompatible'
    const pkgV2 = await buildTestPackageZip({
      packageId: pkgV1.packageId,
      revision: 2,
      seedOffset: 50,
    });
    const conflictOutcome = await manager.importPackage({ userId: 'user-1', file: pkgV2.file });
    expect(conflictOutcome.category).toBe('conflict');
    await manager.confirmConflictReplace({
      userId: 'user-1',
      pendingTransactionId: conflictOutcome.conflict!.pendingTransactionId,
    });
    const afterReplace = await manager.listBindings({ userId: 'user-1', ministryId: 'min-1', songId: 'song-life' });
    expect(afterReplace.find((b) => b.canonicalVersionId === 'ver-keep')?.validityState).toBe(
      'package_replaced_incompatible',
    );

    // 4. Delete package marks binding 'package_missing' while preserving song/history until unbind
    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: songV1,
      requestedVersionId: 'ver-keep',
      packageId: pkgV1.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    await manager.deletePackage({
      userId: 'user-1',
      packageId: pkgV1.packageId,
      confirmedScope: true,
    });
    const afterDelete = await manager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-life',
      canonicalVersionId: 'ver-keep',
    });
    expect(afterDelete.status).toBe('invalid_binding');
    if (afterDelete.status === 'invalid_binding') {
      expect(afterDelete.validityState).toBe('package_missing');
    }
  });

  it('rejects stems_bundle_v1 from single-track playback (stems_only_requires_mixer) and non-WAV original (unsupported_codec)', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const stemsOnlyPkg = await buildTestPackageZip({
      packageId: '44444444-4444-4444-8444-444444444444',
      includeOriginal: false,
    });
    const flacOrigPkg = await buildTestPackageZip({
      packageId: '55555555-5555-4555-8555-555555555555',
      includeOriginal: true,
      originalContainer: 'flac',
    });

    await manager.importPackage({ userId: 'user-1', file: stemsOnlyPkg.file });
    await manager.importPackage({ userId: 'user-1', file: flacOrigPkg.file });

    const song: SongForVersionResolution = {
      id: 'song-codecs',
      ministryId: 'min-1',
      versions: [
        { id: 'v-stems', name: 'Stems Only', key: 'G' },
        { id: 'v-flac', name: 'FLAC Orig', key: 'A' },
      ],
    };

    const bindStems = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: 'v-stems',
      packageId: stemsOnlyPkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(bindStems.ok).toBe(true);
    if (bindStems.ok) {
      expect(bindStems.binding.assetId).toBe('stems_bundle_v1');
    }
    const lib = await manager.loadLibrary({ userId: 'user-1' });
    expect(lib.packages.find((p) => p.packageId === stemsOnlyPkg.packageId)?.bindingStatus).toBe('linked');

    const stemsResolved = await manager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-codecs',
      canonicalVersionId: 'v-stems',
    });
    expect(stemsResolved.status).toBe('stems_only_requires_mixer');

    const bindFlac = await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: 'v-flac',
      packageId: flacOrigPkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    expect(bindFlac.ok).toBe(true);

    const flacResolved = await manager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-codecs',
      canonicalVersionId: 'v-flac',
    });
    expect(flacResolved.status).toBe('unsupported_codec');
  });

  it('detects live SHA-256 corruption on OPFS and supports ephemeral-fallback extraction of original.wav', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const opfsManager = createOpfsManager(opfsRoot);
    const pkg = await buildTestPackageZip({
      packageId: '66666666-6666-4666-8666-666666666666',
      includeOriginal: true,
    });
    await opfsManager.importPackage({ userId: 'user-1', file: pkg.file });

    const song: SongForVersionResolution = {
      id: 'song-tamper',
      ministryId: 'min-1',
      versions: [{ id: 'v1', name: 'Original', key: 'C' }],
    };
    await bindSongVersion(opfsManager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: 'v1',
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });

    // Tamper original.wav bytes silently without revalidating index first
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-1');
    const origPath = `louvaio-rehearsal-v1/${accountHash}/packages/${pkg.packageId}/original.wav`;
    const bytes = await opfsRoot.readFileBytes(origPath);
    bytes[45] ^= 0xff;
    await opfsRoot.writeFileBytes(origPath, bytes);

    const tamperedRes = await opfsManager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-tamper',
      canonicalVersionId: 'v1',
    });
    expect(tamperedRes.status).toBe('corrupted');

    // Ephemeral fallback extracts original.wav cleanly and verifies SHA-256
    const ephManager = createEphemeralManager();
    await ephManager.importPackage({ userId: 'user-1', file: pkg.file });
    await bindSongVersion(ephManager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: 'v1',
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    const ephResolved = await ephManager.resolveVerifiedBoundAsset({
      userId: 'user-1',
      ministryId: 'min-1',
      songId: 'song-tamper',
      canonicalVersionId: 'v1',
    });
    expect(ephResolved.status).toBe('ready');
    if (ephResolved.status === 'ready') {
      expect(ephResolved.fileName).toBe('original.wav');
      expect(ephResolved.verifiedSha256).toBe(sha256Hex(pkg.originalBytes!));
    }
  });
});

describe('GlobalRehearsalAudioSessionController (T10)', () => {
  async function createTransportRaceFixture(nextMinistryId = 'min-1') {
    const manager = createOpfsManager(new FakeOpfsDirectoryHandle('opfs'));
    const pkg = await buildTestPackageZip();
    await manager.importPackage({ userId: 'user-1', file: pkg.file });
    const options = await Promise.all(['A', 'B'].map(async (id) => {
      const ministryId = id === 'A' ? 'min-1' : nextMinistryId;
      const song: SongForVersionResolution = {
        id, title: `Song ${id}`, ministryId,
        versions: [{ id: `version-${id}`, name: `Version ${id}`, key: 'C' }],
      };
      const [version] = extractCanonicalSongVersions(song);
      expect((await bindSongVersion(manager, {
        userId: 'user-1', ministryId, song, requestedVersionId: version.id,
        packageId: pkg.packageId, songReadVerified: true, isOnline: true,
      })).ok).toBe(true);
      return { userId: 'user-1', ministryId, song, version, manager };
    }));
    const transport = createFakeTransportDeps();
    const controller = new GlobalRehearsalAudioSessionController(transport.deps);
    return { ...transport, controller, manager, optionsA: options[0], optionsB: options[1] };
  }

  function holdNextTransportHeader(manager: RehearsalPackageLibraryManager, failRead = false) {
    let release!: () => void;
    let markEntered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const resolveAsset = manager.resolveVerifiedBoundAsset.bind(manager);
    vi.spyOn(manager, 'resolveVerifiedBoundAsset').mockImplementationOnce(async (options) => {
      const result = await resolveAsset(options);
      if (result.status !== 'ready') throw new Error('Expected verified local WAV fixture');
      const originalSlice = result.file.slice.bind(result.file);
      vi.spyOn(result.file, 'slice').mockImplementation((start, end, contentType) => {
        const slice = originalSlice(start, end, contentType);
        const bytes = readBlobAsArrayBuffer(slice);
        Object.defineProperty(slice, 'arrayBuffer', { value: async () => {
          markEntered();
          await gate;
          if (failRead) throw new Error('Delayed header read failed');
          return bytes;
        } });
        return slice;
      });
      return result;
    });
    return { entered, release };
  }

  it.each([false, true])('preserves newer explicit playback when stale header read completes (failure=%s)', async (failRead) => {
    const { controller, manager, optionsA, optionsB, elements, activeUrls } = await createTransportRaceFixture();
    try {
      expect((await controller.loadBoundVersionAudio(optionsB)).status).toBe('ready');
      await controller.play();
      const oldElement = elements[0];
      const oldUrl = oldElement.src;
      const header = holdNextTransportHeader(manager, failRead);
      const pendingA = controller.loadBoundVersionAudio(optionsA);
      await header.entered;
      expect(oldElement.paused).toBe(true);
      expect(oldElement.src).toBe('');
      expect(activeUrls.has(oldUrl)).toBe(false);

      expect((await controller.loadBoundVersionAudio(optionsB)).status).toBe('ready');
      const currentElement = elements[1];
      expect(currentElement.playCalls).toBe(0);
      await controller.play();
      const playingSnapshot = controller.getSnapshot();
      const playingDiagnostics = controller.getTransportDiagnostics();
      expect(playingSnapshot.transport.state).toBe('playing');
      expect(activeUrls).toEqual(new Set([currentElement.src]));

      header.release();
      expect((await pendingA).status).toBe('stale');
      expect(controller.getSnapshot()).toEqual(playingSnapshot);
      expect(controller.getTransportDiagnostics()).toEqual(playingDiagnostics);
      expect(currentElement.paused).toBe(false);
      expect(activeUrls).toEqual(new Set([currentElement.src]));
      expect(elements).toHaveLength(2);
      // Detached old events cannot change the current session either.
      oldElement.dispatch('error');
      oldElement.dispatch('ended');
      expect(controller.getSnapshot()).toEqual(playingSnapshot);
    } finally {
      controller.dispose();
    }
    expect(activeUrls.size).toBe(0);
  });

  it('preserves the latest ministry playback through rapid context switches and stale transport completion', async () => {
    const { controller, manager, optionsA, optionsB, activeUrls } = await createTransportRaceFixture('min-3');
    try {
      const header = holdNextTransportHeader(manager);
      const pendingA = controller.loadBoundVersionAudio(optionsA);
      await header.entered;
      controller.syncSessionContext({ userId: 'user-1', ministryId: 'min-2' });
      controller.syncSessionContext({ userId: 'user-1', ministryId: 'min-3' });
      expect((await controller.loadBoundVersionAudio(optionsB)).status).toBe('ready');
      await controller.play();
      const current = controller.getSnapshot();
      expect(current.loadedMedia?.ministryId).toBe('min-3');
      expect(current.transport.state).toBe('playing');
      header.release();
      expect((await pendingA).status).toBe('stale');
      expect(controller.getSnapshot()).toEqual(current);
      expect(activeUrls.size).toBe(1);
    } finally {
      controller.dispose();
    }
    expect(activeUrls.size).toBe(0);
  });

  it.each(['logout', 'dispose'] as const)('releases loaded resources on %s while an old transport header is pending', async (action) => {
    const { controller, manager, optionsA, optionsB, activeUrls, elements } = await createTransportRaceFixture();
    expect((await controller.loadBoundVersionAudio(optionsB)).status).toBe('ready');
    await controller.play();
    const oldElement = elements[0];
    const header = holdNextTransportHeader(manager);
    const pendingA = controller.loadBoundVersionAudio({ ...optionsA, autoPlayAfterLoad: true });
    await header.entered;
    if (action === 'logout') controller.syncSessionContext({ userId: null, ministryId: null });
    else controller.dispose();
    const cleared = controller.getSnapshot();
    header.release();
    expect((await pendingA).status).toBe('stale');
    expect(controller.getSnapshot()).toEqual(cleared);
    expect(cleared.loadedMedia).toBeNull();
    expect(cleared.loadingMedia).toBeNull();
    expect(cleared.isLoading).toBe(false);
    if (action === 'logout') expect(cleared.transport.state).toBe('idle');
    else expect(controller.getTransportDiagnostics().disposed).toBe(true);
    expect(activeUrls.size).toBe(0);
    expect(oldElement.src).toBe('');
    expect(oldElement.paused).toBe(true);
    expect(elements).toHaveLength(1);
    expect(controller.getTransportDiagnostics().mediaElement).toBeNull();
    expect(controller.getTransportDiagnostics().activeObjectUrl).toBeNull();
    controller.dispose();
  });

  it('loads without autoplay by default, preserves loaded identity across view switches, and delegates transport controls', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkg = await buildTestPackageZip({
      packageId: '77777777-7777-4777-8777-777777777777',
      displayName: 'Worship WAV',
      frames: 44100,
    });
    await manager.importPackage({ userId: 'user-1', file: pkg.file });

    const song: SongForVersionResolution = {
      id: 'song-ctrl',
      title: 'Deus Proverá',
      ministryId: 'min-1',
      versions: [{ id: 'ver-1', name: 'Original', key: 'G' }],
    };
    const [ver] = extractCanonicalSongVersions(song);

    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: ver.id,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });

    const { deps, activeUrls, elements } = createFakeTransportDeps();
    const controller = new GlobalRehearsalAudioSessionController(deps);

    const loadRes = await controller.loadBoundVersionAudio({
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      version: ver,
      manager,
    });
    expect(loadRes.status).toBe('ready');
    expect(elements[0].playCalls).toBe(0);
    expect(controller.getSnapshot().loadedMedia?.packageId).toBe(pkg.packageId);
    expect(controller.getSnapshot().loadedMedia?.canonicalVersionId).toBe('ver-1');

    // Play, seek, rate, gain, pause
    await controller.play();
    expect(controller.getSnapshot().transport.state).toBe('playing');
    controller.seekFrame(22050);
    expect(controller.getSnapshot().transport.currentFrame).toBe(22050);
    controller.setRate(1.25);
    expect(controller.getSnapshot().transport.rate).toBe(1.25);
    controller.setMasterGain(0.75);
    expect(controller.getSnapshot().transport.masterGain).toBe(0.75);

    // Same (userId, ministryId) view switch preserves active playback & loadedMedia
    controller.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });
    expect(controller.getSnapshot().transport.state).toBe('playing');
    expect(controller.getSnapshot().loadedMedia?.songId).toBe('song-ctrl');

    controller.pause();
    expect(controller.getSnapshot().transport.state).toBe('paused');

    // Context switch stops playback, clears loadedMedia, and revokes object URLs
    controller.syncSessionContext({ userId: 'user-1', ministryId: 'min-2' });
    expect(controller.getSnapshot().loadedMedia).toBeNull();
    expect(controller.getSnapshot().transport.state).toBe('idle');
    expect(activeUrls.size).toBe(0);
    expect(controller.getTransportDiagnostics().activeObjectUrl).toBeNull();

    controller.dispose();
  });

  it('fences stale async resolution on rapid ministry switch or logout without leaking loaded state', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkg = await buildTestPackageZip({
      packageId: '88888888-8888-4888-8888-888888888888',
    });
    await manager.importPackage({ userId: 'user-1', file: pkg.file });

    const song: SongForVersionResolution = {
      id: 'song-race',
      title: 'Race Test',
      ministryId: 'min-1',
      versions: [{ id: 'ver-1', name: 'Original', key: 'C' }],
    };
    const [ver] = extractCanonicalSongVersions(song);

    let releaseResolver!: () => void;
    const resolverGate = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });

    const spyResolve = vi
      .spyOn(manager, 'resolveVerifiedBoundAsset')
      .mockImplementationOnce(async () => {
        await resolverGate;
        return {
          status: 'ready',
          file: createSyntheticWavFile({ durationSeconds: 0.5 }),
          fileName: 'original.wav',
          binding: {
            accountNamespaceHash: RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-1'),
            ministryId: 'min-1',
            songId: 'song-race',
            canonicalVersionId: 'ver-1',
            packageId: pkg.packageId,
            assetId: 'original',
            songTitleSnapshot: 'Race Test',
            versionNameSnapshot: 'Original',
            versionKeySnapshot: 'C',
            versionIsSynthetic: false,
            packageTitleSnapshot: 'Pkg',
            packageRevision: 1,
            packageManifestSha256: 'a'.repeat(64),
            packageCompositeSha256: 'b'.repeat(64),
            assetSha256: 'c'.repeat(64),
            assetContainer: 'wav',
            assetCodec: 'pcm_s16le',
            boundAt: '2026-11-17T18:00:00.000Z',
            validityState: 'valid',
          },
          packageRecord: (await manager.loadLibrary({ userId: 'user-1' })).packages[0],
          verifiedSha256: 'c'.repeat(64),
        };
      });

    const { deps, activeUrls } = createFakeTransportDeps();
    const controller = new GlobalRehearsalAudioSessionController(deps);

    const loadPromise = controller.loadBoundVersionAudio({
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      version: ver,
      manager,
      autoPlayAfterLoad: true,
    });

    // Switch ministry / logout while resolve is still in flight
    controller.syncSessionContext({ userId: null, ministryId: null });
    releaseResolver();
    const res = await loadPromise;

    expect(res.status).toBe('stale');
    expect(controller.getSnapshot().loadedMedia).toBeNull();
    expect(controller.getSnapshot().isLoading).toBe(false);
    expect(controller.getSnapshot().transport.state).toBe('idle');
    expect(activeUrls.size).toBe(0);

    spyResolve.mockRestore();
    controller.dispose();
  });

  it('stops playback immediately when bound package is deleted or binding is removed', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const pkg = await buildTestPackageZip({
      packageId: '99999999-9999-4999-8999-999999999999',
    });
    await manager.importPackage({ userId: 'user-1', file: pkg.file });

    const song: SongForVersionResolution = {
      id: 'song-inv',
      title: 'Invalidation Song',
      ministryId: 'min-1',
      versions: [{ id: 'ver-1', name: 'Original', key: 'D' }],
    };
    const [ver] = extractCanonicalSongVersions(song);

    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: ver.id,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });

    const { deps, activeUrls } = createFakeTransportDeps();
    const controller = new GlobalRehearsalAudioSessionController(deps);
    const detach = controller.attachToLibraryManager(manager);

    const res = await controller.loadBoundVersionAudio({
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      version: ver,
      manager,
      autoPlayAfterLoad: true,
    });
    expect(res.status).toBe('playing');
    expect(activeUrls.size).toBe(1);

    // Deleting package stops playback via attachToLibraryManager
    await manager.deletePackage({
      userId: 'user-1',
      packageId: pkg.packageId,
      confirmedScope: true,
    });
    expect(controller.getSnapshot().loadedMedia).toBeNull();
    expect(controller.getSnapshot().transport.state).toBe('idle');
    expect(activeUrls.size).toBe(0);

    // Re-import & bind, then test notifyBindingRemoved
    await manager.importPackage({ userId: 'user-1', file: pkg.file });
    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: ver.id,
      packageId: pkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });
    const res2 = await controller.loadBoundVersionAudio({
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      version: ver,
      manager,
      autoPlayAfterLoad: true,
    });
    expect(res2.status).toBe('playing');

    await unbindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      songId: song.id,
      canonicalVersionId: ver.id,
    });
    controller.notifyBindingRemoved({
      ministryId: 'min-1',
      songId: song.id,
      canonicalVersionId: ver.id,
    });
    expect(controller.getSnapshot().loadedMedia).toBeNull();
    expect(controller.getSnapshot().transport.state).toBe('idle');
    expect(activeUrls.size).toBe(0);

    detach();
    controller.dispose();
  });

  it('surfaces error cleanly without fake playback when stems-only or non-WAV package is loaded', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const stemsPkg = await buildTestPackageZip({
      packageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      includeOriginal: false,
    });
    await manager.importPackage({ userId: 'user-1', file: stemsPkg.file });

    const song: SongForVersionResolution = {
      id: 'song-stems',
      title: 'Stems Song',
      ministryId: 'min-1',
      versions: [{ id: 'v-1', name: 'Original', key: 'G' }],
    };
    const [ver] = extractCanonicalSongVersions(song);

    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      requestedVersionId: ver.id,
      packageId: stemsPkg.packageId,
      songReadVerified: true,
      isOnline: true,
    });

    const { deps, elements } = createFakeTransportDeps();
    const controller = new GlobalRehearsalAudioSessionController(deps);
    const loadRes = await controller.loadBoundVersionAudio({
      userId: 'user-1',
      ministryId: 'min-1',
      song,
      version: ver,
      manager,
      autoPlayAfterLoad: true,
    });

    expect(loadRes.status).toBe('stems_only_requires_mixer');
    expect(controller.getSnapshot().loadedMedia).toBeNull();
    expect(controller.getSnapshot().lastError).toBeTruthy();
    expect(elements).toHaveLength(0);

    controller.dispose();
  });
});
