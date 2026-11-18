import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SongDetail, type ScheduleSequenceContext } from './SongDetail';
import { GlobalRehearsalAudioMiniPlayer } from './GlobalRehearsalAudioMiniPlayer';
import { api } from '../api';
import type { Song } from '../types';
import {
  RehearsalPackageLibraryManager,
  type OpfsDirectoryHandleLike,
  type OpfsFileHandleLike,
  type OpfsWritableStreamLike,
} from '../audio/rehearsal-package-library';
import {
  GlobalRehearsalAudioSessionController,
  bindSongVersion,
} from '../audio/song-version-audio-binding';
import type {
  LocalAudioTransportDependencies,
  MediaElementLike,
} from '../audio/local-audio-transport';
import {
  buildSyntheticWav,
  buildSyntheticZip,
  sha256Hex,
  type SyntheticZipEntryInput,
} from '../audio/rehearsal-package-fixtures';
import {
  REHEARSAL_PACKAGE_FORMAT,
  REHEARSAL_PACKAGE_FORMAT_VERSION,
  type RequiredStemId,
} from '../audio/rehearsal-package-validator';

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
    getMySmartChordsForSong: vi.fn(),
    getSmartChords: vi.fn(),
    setSmartChordRepertoireLink: vi.fn(),
    removeSmartChordRepertoireLink: vi.fn(),
    getMyPendingSmartChordsForSong: vi.fn(),
  },
}));

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
    if (this.closed || this.aborted) throw new Error('Stream closed');
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
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
      if (existing.kind !== 'directory') throw makeDomException('Type mismatch', 'TypeMismatchError');
      return existing;
    }
    if (!options?.create) throw makeDomException(`Missing dir: ${name}`, 'NotFoundError');
    const created = new FakeOpfsDirectoryHandle(name);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeOpfsFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw makeDomException('Type mismatch', 'TypeMismatchError');
      return existing;
    }
    if (!options?.create) throw makeDomException(`Missing file: ${name}`, 'NotFoundError');
    const created = new FakeOpfsFileHandle(name);
    this.children.set(name, created);
    return created;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw makeDomException(`Missing: ${name}`, 'NotFoundError');
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, OpfsDirectoryHandleLike | OpfsFileHandleLike]> {
    for (const entry of Array.from(this.children.entries())) {
      yield entry;
    }
  }

  async resolveDir(segments: string[]): Promise<FakeOpfsDirectoryHandle> {
    let curr: FakeOpfsDirectoryHandle = this;
    for (const seg of segments) {
      curr = await curr.getDirectoryHandle(seg, { create: false });
    }
    return curr;
  }

  async corruptFile(path: string, bytes: Uint8Array): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop()!;
    const dir = await this.resolveDir(parts);
    const fh = await dir.getFileHandle(fileName, { create: false });
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
    const evt = new Event(type);
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(evt);
    }
  }

  removeAttribute(qualifiedName: string): void {
    if (qualifiedName === 'src') this.src = '';
  }

  load(): void {
    if (!this.src) return;
    queueMicrotask(() => {
      this.duration = 0.5;
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
  const elements: FakeMediaElement[] = [];
  const deps: LocalAudioTransportDependencies = {
    createAudioElement: () => {
      const el = new FakeMediaElement();
      elements.push(el);
      return el;
    },
    createAudioContext: () => null,
    createObjectURL: () => `blob:test-${++urlCounter}`,
    revokeObjectURL: () => {},
    enableWebAudioGain: false,
  };
  return { deps, elements };
}

async function createTestZipFile(options: {
  packageId: string;
  displayName: string;
  includeOriginal: boolean;
  seedOffset?: number;
}) {
  const frames = 4410;
  const seedOffset = options.seedOffset ?? 0;
  const stemIds: RequiredStemId[] = ['vocals', 'drums', 'bass', 'other'];
  const zipEntries: SyntheticZipEntryInput[] = [];
  const stems = stemIds.map((stemId, idx) => {
    const data = buildSyntheticWav({ frames, bitsPerSample: 16, seed: idx + 1 + seedOffset });
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

  let original: Record<string, unknown> = { included: false };
  if (options.includeOriginal) {
    const origData = buildSyntheticWav({ frames, bitsPerSample: 16, seed: 50 + seedOffset });
    const origPath = 'audio/original.wav';
    zipEntries.push({ path: origPath, data: origData, compressionMethod: 0 });
    original = {
      included: true,
      path: origPath,
      container: 'wav',
      codec: 'pcm_s16le',
      bitsPerSample: 16,
      byteLength: origData.byteLength,
      sha256: sha256Hex(origData),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: frames,
    };
  }

  const manifest = {
    format: REHEARSAL_PACKAGE_FORMAT,
    formatVersion: REHEARSAL_PACKAGE_FORMAT_VERSION,
    requiredFeatures: options.includeOriginal
      ? ['stems-4', 'timeline-v1', 'alignment-v1', 'original-optional']
      : ['stems-4', 'timeline-v1', 'alignment-v1'],
    packageId: options.packageId,
    revision: 1,
    createdAt: '2026-11-17T12:00:00Z',
    displayName: options.displayName,
    source: {
      sha256: 'a'.repeat(64),
      sanitizedFileName: 'ensaio.wav',
      durationFrames: frames,
      usageRightEvidence: 'local-church',
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
    timeline: { sampleRate: 44100, totalFrames: frames, channels: 2, timeOriginFrame: 0 },
    original,
    stems,
    alignment: { timeOriginFrame: 0, method: 'explicit-trim', initialTrimFrames: 0, trailingTrimFrames: 0 },
    rights: {
      declaration: 'Uso interno da equipe local.',
      scope: 'rehearsal-local',
      exportAllowed: true,
      attributions: [],
      isLegalProof: false,
      isDrm: false,
    },
  };

  const bytes = await buildSyntheticZip([
    { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)), compressionMethod: 0 },
    ...zipEntries,
  ]);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], `${options.packageId}.louvaio-rehearsal.zip`, { type: 'application/zip' });
}

function createOpfsManager(opfsRoot: FakeOpfsDirectoryHandle) {
  let tx = 0;
  return new RehearsalPackageLibraryManager({
    getOpfsRoot: async () => opfsRoot,
    quotaEstimator: async () => ({ quota: 1024 * 1024 * 1024, usage: 0 }),
    persistenceChecker: async () => true,
    txIdGenerator: () => `tx-${++tx}`,
    now: () => new Date('2026-11-17T18:00:00.000Z'),
  });
}

const multiVersionSong: Song = {
  id: 'song-multi',
  ministryId: 'min-1',
  title: 'Sublime Graça',
  artist: 'John Newton',
  originalKey: 'G',
  versions: [
    { id: 'ver-orig', name: 'Original', key: 'G', classificationIds: [], links: [] },
    { id: 'ver-acustico', name: 'Acústico', key: 'E', classificationIds: [], links: [] },
  ],
};

const duplicateNameSong: Song = {
  id: 'song-dup',
  ministryId: 'min-1',
  title: 'Hosana',
  artist: 'Equipe',
  originalKey: 'C',
  versions: [
    { id: 'v_live_1', name: 'Live', key: 'C', classificationIds: [], links: [] },
    { id: 'v_live_2', name: 'Live', key: 'D', classificationIds: [], links: [] },
  ],
};

const PKG_ORIG = '11111111-1111-4111-8111-111111111111';
const PKG_STEMS = '22222222-2222-4222-8222-222222222222';
const PKG_ORIG_2 = '33333333-3333-4333-8333-333333333333';

describe('SongDetail — Rehearsal Local Audio Binding & Global Mini-Player (T10)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('praise_auth_token', 'token-user-1');
    vi.clearAllMocks();
    vi.mocked(api.getMe).mockResolvedValue({ id: 'user-1', preferences: {} } as any);
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([]);
    vi.mocked(api.getMyPendingSmartChordsForSong).mockResolvedValue([]);
    vi.mocked(api.getSmartChords).mockResolvedValue([]);
  });

  it('binds via modal, loads without autoplay, plays explicitly, and unlinks without deleting the local package', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps, elements } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.attachToLibraryManager(manager);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    const origFile = await createTestZipFile({
      packageId: PKG_ORIG,
      displayName: 'Sublime Original WAV',
      includeOriginal: true,
    });
    await manager.importPackage({ userId: 'user-1', file: origFile });

    render(
      <>
        <GlobalRehearsalAudioMiniPlayer sessionController={session} />
        <SongDetail
          song={multiVersionSong}
          ministryId="min-1"
          userRole="member"
          currentUserId="user-1"
          initialVersionId="ver-orig"
          onBack={vi.fn()}
          rehearsalManager={manager}
          rehearsalSession={session}
          isOnline={true}
          songReadVerified={true}
        />
      </>,
    );

    const card = await screen.findByTestId('song-version-rehearsal-audio-card');
    expect(await within(card).findByText('Sem áudio local vinculado')).toBeInTheDocument();
    expect(screen.queryByTestId('global-rehearsal-mini-player')).not.toBeInTheDocument();

    // Open picker modal and bind
    fireEvent.click(screen.getByTestId('bind-rehearsal-package-btn'));
    const modal = await screen.findByTestId('rehearsal-package-picker-modal');
    const item = await within(modal).findByTestId(`rehearsal-picker-item-${PKG_ORIG}`);
    expect(item).toHaveTextContent('Com áudio Original (WAV)');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.queryByTestId('rehearsal-package-picker-modal')).not.toBeInTheDocument();
    });
    expect(within(card).getByTestId('bound-package-title')).toHaveTextContent('Sublime Original WAV');
    expect(within(card).getByTestId('bound-asset-type-badge')).toHaveTextContent('Áudio original');

    // Loading and playback are separate explicit actions.
    fireEvent.click(screen.getByTestId('load-version-audio-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('global-rehearsal-mini-player')).toBeInTheDocument();
      expect(screen.getByTestId('version-audio-loaded-badge')).toBeInTheDocument();
    });
    expect(elements[0].playCalls).toBe(0);
    expect(screen.getByTestId('mini-player-state-badge')).toHaveTextContent('Pronto');
    fireEvent.click(screen.getByRole('button', { name: 'Reproduzir áudio local' }));
    await waitFor(() => expect(elements[0].playCalls).toBe(1));
    expect(screen.getByTestId('mini-player-song-title')).toHaveTextContent('Sublime Graça');
    expect(screen.getByTestId('mini-player-state-badge')).toHaveTextContent('Reproduzindo');

    // Unlink stops session & keeps package intact in library
    fireEvent.click(screen.getByTestId('unbind-rehearsal-package-btn'));
    await waitFor(() => {
      expect(within(card).getByText('Sem áudio local vinculado')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('global-rehearsal-mini-player')).not.toBeInTheDocument();

    const snap = await manager.loadLibrary({ userId: 'user-1' });
    expect(snap.packages).toHaveLength(1);
    expect(snap.packages[0].bindingStatus).toBe('unlinked');
  });

  it('binds 4-stems-only package without exposing single-track playback and enforces offline fail-closed', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    const stemsFile = await createTestZipFile({
      packageId: PKG_STEMS,
      displayName: 'Pacote Somente Stems',
      includeOriginal: false,
      seedOffset: 5,
    });
    await manager.importPackage({ userId: 'user-1', file: stemsFile });

    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-orig"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={false}
        songReadVerified={true}
      />,
    );

    await screen.findByTestId('song-version-rehearsal-audio-card');
    fireEvent.click(await screen.findByTestId('bind-rehearsal-package-btn'));
    const modal = await screen.findByTestId('rehearsal-package-picker-modal');
    const stemsItem = await within(modal).findByTestId(`rehearsal-picker-item-${PKG_STEMS}`);
    expect(stemsItem).toHaveTextContent('Somente 4 stems (uso futuro no Mixer T12)');
    fireEvent.click(stemsItem);

    const offlineErr = await within(modal).findByTestId('rehearsal-bind-error');
    expect(offlineErr).toHaveTextContent(/exige conexão ativa/i);

    fireEvent.keyDown(modal, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('rehearsal-package-picker-modal')).not.toBeInTheDocument();
    });

    // Now online: binds stems package & shows Mixer T12 notice without play button
    rerender(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-orig"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    fireEvent.click(screen.getByTestId('bind-rehearsal-package-btn'));
    const modal2 = await screen.findByTestId('rehearsal-package-picker-modal');
    fireEvent.click(await within(modal2).findByTestId(`rehearsal-picker-item-${PKG_STEMS}`));

    await waitFor(() => {
      expect(screen.getByTestId('rehearsal-stems-only-notice')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('load-version-audio-btn')).not.toBeInTheDocument();
  });

  it('blocks binding on ambiguous multi-version song until explicit tab click and isolates duplicate version names by canonical ID', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG,
        displayName: 'Live Track 1',
        includeOriginal: true,
        seedOffset: 1,
      }),
    });
    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG_2,
        displayName: 'Live Track 2',
        includeOriginal: true,
        seedOffset: 9,
      }),
    });

    render(
      <SongDetail
        song={duplicateNameSong}
        ministryId="min-1"
        currentUserId="user-1"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    expect(await screen.findByTestId('rehearsal-version-required-notice')).toBeInTheDocument();
    expect(screen.getByTestId('bind-rehearsal-package-btn')).toBeDisabled();

    // Explicitly click second "Live" tab (v_live_2)
    const tabs = within(screen.getByRole('tablist', { name: 'Versões da música' })).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[1]);

    await waitFor(() => {
      expect(screen.getByTestId('rehearsal-selected-version-label')).toHaveTextContent('v_live_2');
      expect(screen.getByTestId('bind-rehearsal-package-btn')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('bind-rehearsal-package-btn'));
    const modal = await screen.findByTestId('rehearsal-package-picker-modal');
    fireEvent.click(await within(modal).findByTestId(`rehearsal-picker-item-${PKG_ORIG_2}`));

    await waitFor(() => {
      expect(screen.getByTestId('bound-package-title')).toHaveTextContent('Live Track 2');
    });

    // Switch to first "Live" tab (v_live_1): must be unbound (no leak across duplicate names!)
    fireEvent.click(tabs[0]);
    await waitFor(() => {
      expect(screen.getByTestId('rehearsal-selected-version-label')).toHaveTextContent('v_live_1');
    });
    expect(screen.getByTestId('song-version-rehearsal-audio-card')).toHaveTextContent('Sem áudio local vinculado');
  });

  it('keeps active mini-player across version/song switches without autoplay, shows mismatch notice, and supports schedule sequence between same-song versions', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps, elements } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG,
        displayName: 'Original WAV',
        includeOriginal: true,
      }),
    });
    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG_2,
        displayName: 'Acústico WAV',
        includeOriginal: true,
        seedOffset: 7,
      }),
    });

    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: multiVersionSong,
      requestedVersionId: 'ver-orig',
      packageId: PKG_ORIG,
      songReadVerified: true,
      isOnline: true,
    });
    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: multiVersionSong,
      requestedVersionId: 'ver-acustico',
      packageId: PKG_ORIG_2,
      songReadVerified: true,
      isOnline: true,
    });

    const onSelectSlot = vi.fn();
    const sequence0: ScheduleSequenceContext = {
      scheduleId: 'sch-1',
      scheduleTitle: 'Culto Domingo',
      currentIndex: 0,
      items: [
        { slotIndex: 0, songId: 'song-multi', title: 'Sublime Graça', versionId: 'ver-orig', versionName: 'Original' },
        { slotIndex: 1, songId: 'song-multi', title: 'Sublime Graça', versionId: 'ver-acustico', versionName: 'Acústico' },
        { slotIndex: 2, songId: 'song-dup', title: 'Hosana', versionId: 'v_live_1', versionName: 'Live' },
      ],
      onSelectSlot,
    };

    const { rerender } = render(
      <>
        <GlobalRehearsalAudioMiniPlayer sessionController={session} />
        <SongDetail
          song={multiVersionSong}
          ministryId="min-1"
          currentUserId="user-1"
          initialVersionId="ver-orig"
          scheduleSequence={sequence0}
          onBack={vi.fn()}
          rehearsalManager={manager}
          rehearsalSession={session}
          isOnline={true}
          songReadVerified={true}
        />
      </>,
    );

    expect(screen.getByTestId('schedule-sequence-counter')).toHaveTextContent('1 / 3');
    await screen.findByTestId('load-version-audio-btn');
    fireEvent.click(screen.getByTestId('load-version-audio-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('mini-player-state-badge')).toHaveTextContent('Pronto');
    });
    expect(elements[0].playCalls).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reproduzir áudio local' }));
    await waitFor(() => {
      expect(screen.getByTestId('mini-player-state-badge')).toHaveTextContent('Reproduzindo');
    });
    expect(elements).toHaveLength(1);

    // Click next slot -> triggers onSelectSlot(1)
    fireEvent.click(screen.getByTestId('schedule-sequence-next-btn'));
    expect(onSelectSlot).toHaveBeenCalledWith(1);

    // Rerender as slot 1 (same song, different version!) -> no autoplay, mismatch notice shown, mini-player keeps slot 0 identity
    rerender(
      <>
        <GlobalRehearsalAudioMiniPlayer sessionController={session} />
        <SongDetail
          song={multiVersionSong}
          ministryId="min-1"
          currentUserId="user-1"
          initialVersionId="ver-acustico"
          scheduleSequence={{ ...sequence0, currentIndex: 1 }}
          onBack={vi.fn()}
          rehearsalManager={manager}
          rehearsalSession={session}
          isOnline={true}
          songReadVerified={true}
        />
      </>,
    );

    expect(screen.getByTestId('schedule-sequence-counter')).toHaveTextContent('2 / 3');
    expect(await screen.findByTestId('active-session-mismatch-notice')).toHaveTextContent(
      'No player agora: Sublime Graça — Original (não pertence a esta versão)',
    );
    expect(screen.getByTestId('mini-player-version-info')).toHaveTextContent('Original');
    expect(elements).toHaveLength(1); // zero autoplay on switch

    // Explicit click loads second version
    fireEvent.click(await screen.findByTestId('load-version-audio-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('mini-player-version-info')).toHaveTextContent('Acústico');
    });
    expect(screen.queryByTestId('active-session-mismatch-notice')).not.toBeInTheDocument();

    // Ministry switch & logout stop session and clear mini-player
    act(() => {
      session.syncSessionContext({ userId: 'user-1', ministryId: 'min-2' });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('global-rehearsal-mini-player')).not.toBeInTheDocument();
    });
  });

  it('invalidates binding with version_removed when bound version disappears and with package_corrupted/package_missing on package change', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.attachToLibraryManager(manager);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG,
        displayName: 'Original WAV',
        includeOriginal: true,
      }),
    });

    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: multiVersionSong,
      requestedVersionId: 'ver-acustico',
      packageId: PKG_ORIG,
      songReadVerified: true,
      isOnline: true,
    });

    // Corrupt original.wav in OPFS and revalidate
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash('user-1');
    await opfsRoot.corruptFile(
      `louvaio-rehearsal-v1/${accountHash}/packages/${PKG_ORIG}/original.wav`,
      new Uint8Array([1, 2, 3]),
    );
    await manager.revalidatePackage({ userId: 'user-1', packageId: PKG_ORIG });

    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-acustico"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    const invalidAlert = await screen.findByTestId('rehearsal-binding-invalid-alert');
    expect(invalidAlert).toHaveTextContent('package_corrupted');
    expect(screen.queryByTestId('load-version-audio-btn')).not.toBeInTheDocument();

    // Now delete package -> package_missing
    await manager.deletePackage({ userId: 'user-1', packageId: PKG_ORIG, confirmedScope: true });
    rerender(
      <SongDetail
        song={{ ...multiVersionSong }}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-acustico"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('rehearsal-binding-invalid-alert')).toHaveTextContent('package_missing');
    });

    // Now remove ver-acustico from song.versions -> version_removed
    const songWithoutAcustico: Song = {
      ...multiVersionSong,
      versions: [multiVersionSong.versions[0]],
    };
    rerender(
      <SongDetail
        song={songWithoutAcustico}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-orig"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    const removedAlert = await screen.findByTestId('rehearsal-removed-version-alert-ver-acustico');
    expect(removedAlert).toHaveTextContent(/removida/i);
  });

  it('suppresses late loadBoundVersionAudio failure error after user switches version tab', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    const origFile = await createTestZipFile({
      packageId: PKG_ORIG,
      displayName: 'Sublime Original',
      includeOriginal: true,
      seedOffset: 1,
    });
    await manager.importPackage({ userId: 'user-1', file: origFile });
    await bindSongVersion(manager, {
      userId: 'user-1',
      ministryId: 'min-1',
      song: multiVersionSong,
      requestedVersionId: 'ver-orig',
      packageId: PKG_ORIG,
      songReadVerified: true,
      isOnline: true,
    });

    let resolveLateFailure!: (value: any) => void;
    const loadSpy = vi.spyOn(session, 'loadBoundVersionAudio').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLateFailure = resolve;
        }),
    );

    render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-orig"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    const loadBtn = await screen.findByTestId('load-version-audio-btn');
    fireEvent.click(loadBtn);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // Switch version tab before slow failure resolves
    const tabTwo = screen.getByRole('tab', { name: /Acústico/i });
    fireEvent.click(tabTwo);
    await waitFor(() => {
      expect(tabTwo).toHaveAttribute('aria-selected', 'true');
    });

    resolveLateFailure({
      status: 'corrupted',
      message: 'Erro tardio da versão anterior',
      snapshot: session.getSnapshot(),
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByTestId('rehearsal-card-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/Erro tardio da versão anterior/)).not.toBeInTheDocument();
  });

  it('keeps version-required notice visible and bind button disabled when clicking a version tab without canonical id, then enables on valid version tab', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG,
        displayName: 'Faixa Válida',
        includeOriginal: true,
        seedOffset: 7,
      }),
    });

    const malformedVersionSong: Song = {
      id: 'song-missing-ver-id',
      ministryId: 'min-1',
      title: 'Cântico Novo',
      artist: 'Equipe',
      originalKey: 'C',
      versions: [
        { id: '', name: 'Sem ID', key: 'C', classificationIds: [], links: [] },
        { id: 'ver-valid', name: 'Válida', key: 'D', classificationIds: [], links: [] },
      ],
    };

    render(
      <SongDetail
        song={malformedVersionSong}
        ministryId="min-1"
        currentUserId="user-1"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
        songReadVerified={true}
      />,
    );

    expect(await screen.findByTestId('rehearsal-version-required-notice')).toBeInTheDocument();
    expect(screen.getByTestId('bind-rehearsal-package-btn')).toBeDisabled();

    // Clicking the malformed version tab (id: '') must NOT clear the notice or enable binding.
    fireEvent.click(screen.getByRole('tab', { name: /Sem ID/i }));
    expect(screen.getByTestId('rehearsal-version-required-notice')).toBeInTheDocument();
    expect(screen.getByTestId('bind-rehearsal-package-btn')).toBeDisabled();

    // Clicking the valid version tab resolves ver-valid and enables binding.
    fireEvent.click(screen.getByRole('tab', { name: /Válida/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('rehearsal-version-required-notice')).not.toBeInTheDocument();
    });
    const bindBtn = await screen.findByTestId('bind-rehearsal-package-btn');
    expect(bindBtn).not.toBeDisabled();

    fireEvent.click(bindBtn);
    const modal = await screen.findByTestId('rehearsal-package-picker-modal');
    fireEvent.click(await within(modal).findByTestId(`rehearsal-picker-item-${PKG_ORIG}`));

    await waitFor(() => {
      expect(screen.queryByTestId('rehearsal-package-picker-modal')).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId('bound-package-title')).toHaveTextContent('Faixa Válida');
  });

  it('fails closed with SONG_READ_NOT_VERIFIED when songReadVerified prop is omitted and does not persist binding', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs');
    const manager = createOpfsManager(opfsRoot);
    const { deps } = createFakeTransportDeps();
    const session = new GlobalRehearsalAudioSessionController(deps);
    session.syncSessionContext({ userId: 'user-1', ministryId: 'min-1' });

    await manager.importPackage({
      userId: 'user-1',
      file: await createTestZipFile({
        packageId: PKG_ORIG,
        displayName: 'Sublime Original WAV',
        includeOriginal: true,
        seedOffset: 9,
      }),
    });

    render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        currentUserId="user-1"
        initialVersionId="ver-orig"
        onBack={vi.fn()}
        rehearsalManager={manager}
        rehearsalSession={session}
        isOnline={true}
      />,
    );

    const bindBtn = await screen.findByTestId('bind-rehearsal-package-btn');
    fireEvent.click(bindBtn);

    const modal = await screen.findByTestId('rehearsal-package-picker-modal');
    fireEvent.click(await within(modal).findByTestId(`rehearsal-picker-item-${PKG_ORIG}`));

    const errorAlert = await within(modal).findByTestId('rehearsal-bind-error');
    expect(errorAlert).toHaveTextContent('Não é possível vincular áudio local sem leitura verificada da música.');
    expect(screen.getByTestId('rehearsal-package-picker-modal')).toBeInTheDocument();

    const persistedBindings = await manager.listBindings({ userId: 'user-1' });
    expect(persistedBindings).toHaveLength(0);
    const snap = await manager.loadLibrary({ userId: 'user-1' });
    expect(snap.packages[0].bindingStatus).toBe('unlinked');
  });
});
