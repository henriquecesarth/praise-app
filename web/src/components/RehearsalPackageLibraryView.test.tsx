import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../types';
import {
  buildSyntheticWav,
  buildSyntheticZip,
  sha256Hex,
  type SyntheticZipEntryInput,
} from '../audio/rehearsal-package-fixtures';
import {
  RehearsalPackageLibraryManager,
  type ExternalFileHandleLike,
  type OpfsDirectoryHandleLike,
  type OpfsFileHandleLike,
  type OpfsWritableStreamLike,
} from '../audio/rehearsal-package-library';
import {
  REHEARSAL_PACKAGE_FORMAT,
  REHEARSAL_PACKAGE_FORMAT_VERSION,
  REQUIRED_STEM_IDS_V1,
} from '../audio/rehearsal-package-validator';
import { RehearsalPackageLibraryView } from './RehearsalPackageLibraryView';

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
    private readonly onWriteHook?: (path: string) => Promise<void> | void,
  ) {}

  async write(data: Uint8Array | Blob | string): Promise<void> {
    if (this.closed || this.aborted) {
      throw new Error('Cannot write to closed or aborted stream.');
    }
    if (this.onWriteHook) {
      await this.onWriteHook(this.path);
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
    this.chunks.push(bytes);
  }

  async close(): Promise<void> {
    if (this.aborted) throw new Error('Cannot close aborted stream.');
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
    private readonly onWriteHook?: (path: string) => Promise<void> | void,
  ) {
    this.bytes = new Uint8Array(initialBytes);
  }

  async getFile(): Promise<File> {
    const copy = new Uint8Array(this.bytes.byteLength);
    copy.set(this.bytes);
    return new File([copy], this.name, { type: 'application/octet-stream' });
  }

  async createWritable(): Promise<OpfsWritableStreamLike> {
    return new FakeOpfsWritableStream(
      this.path,
      (committed) => {
        this.bytes = committed;
      },
      this.onWriteHook,
    );
  }
}

class FakeOpfsDirectoryHandle implements OpfsDirectoryHandleLike {
  readonly kind = 'directory' as const;
  private readonly children = new Map<string, FakeOpfsDirectoryHandle | FakeOpfsFileHandle>();

  constructor(
    readonly name: string,
    private readonly pathPrefix = '',
    private readonly onWriteHook?: (path: string) => Promise<void> | void,
  ) {}

  private childPath(name: string): string {
    return this.pathPrefix ? `${this.pathPrefix}/${name}` : name;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeOpfsDirectoryHandle> {
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
    const created = new FakeOpfsDirectoryHandle(name, this.childPath(name), this.onWriteHook);
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
    const created = new FakeOpfsFileHandle(name, this.childPath(name), new Uint8Array(0), this.onWriteHook);
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
}

async function createSyntheticRehearsalPackageFile(options: {
  packageId?: string;
  revision?: number;
  displayName?: string;
  includeOriginal?: boolean;
  seedOffset?: number;
  fileName?: string;
} = {}): Promise<{ file: File; bytes: Uint8Array; packageId: string }> {
  const packageId = options.packageId ?? '11111111-2222-4333-8444-555555555555';
  const revision = options.revision ?? 1;
  const displayName = options.displayName ?? 'Ensaio Domingo Noite';
  const seedOffset = options.seedOffset ?? 0;
  const totalFrames = 4410;

  const entries: SyntheticZipEntryInput[] = [];
  const stemDecls = REQUIRED_STEM_IDS_V1.map((stemId, index) => {
    const data = buildSyntheticWav({ frames: totalFrames, bitsPerSample: 16, seed: index + 1 + seedOffset });
    const path = `stems/${stemId}.wav`;
    entries.push({ path, data });
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
      decodedFrames: totalFrames,
    };
  });

  let originalDecl: Record<string, unknown> = { included: false };
  if (options.includeOriginal) {
    const origData = buildSyntheticWav({ frames: totalFrames, bitsPerSample: 16, seed: 99 + seedOffset });
    const origPath = 'audio/original.wav';
    entries.push({ path: origPath, data: origData });
    originalDecl = {
      included: true,
      path: origPath,
      container: 'wav',
      codec: 'pcm_s16le',
      bitsPerSample: 16,
      byteLength: origData.byteLength,
      sha256: sha256Hex(origData),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: totalFrames,
    };
  }

  const requiredFeatures = ['stems-4', 'timeline-v1', 'alignment-v1'];
  if (options.includeOriginal) requiredFeatures.push('original-optional');

  const manifest = {
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
      durationFrames: totalFrames,
      usageRightEvidence: 'local-church-recording',
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
      totalFrames,
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
      declaration: 'Uso interno da equipe de louvor local.',
      scope: 'rehearsal-local',
      exportAllowed: false,
      attributions: [],
      isLegalProof: false,
      isDrm: false,
    },
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  entries.unshift({ path: 'manifest.json', data: manifestBytes });
  const zipBytes = await buildSyntheticZip(entries);
  const copy = new Uint8Array(zipBytes.byteLength);
  copy.set(zipBytes);
  const fileName = options.fileName ?? 'ensaio-domingo.louvaio-rehearsal.zip';
  const file = new File([copy], fileName, { type: 'application/zip' });
  return { file, bytes: zipBytes, packageId };
}

const USER_A: AuthenticatedUser = { id: 'user-a', email: 'a@example.test', name: 'Usuário A' };
const USER_B: AuthenticatedUser = { id: 'user-b', email: 'b@example.test', name: 'Usuário B' };

function createOpfsManager(opfsRoot: FakeOpfsDirectoryHandle) {
  return new RehearsalPackageLibraryManager({
    getOpfsRoot: async () => opfsRoot,
    quotaEstimator: async () => ({ quota: 2 * 1024 * 1024 * 1024, usage: 128 * 1024 * 1024 }),
    persistenceChecker: async () => true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
});

describe('RehearsalPackageLibraryView', () => {
  it('renders empty state, OPFS badge, offline indicator, backup warning, and quota summary', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs-root');
    const manager = createOpfsManager(opfsRoot);

    render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );

    expect(await screen.findByTestId('rehearsal-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('rehearsal-storage-mode-badge')).toHaveTextContent('OPFS Privado');
    expect(screen.getByText('Funciona localmente nesta página sem rede')).toBeInTheDocument();

    const warning = screen.getByTestId('rehearsal-backup-warning');
    expect(warning).toHaveTextContent(/nunca são enviados automaticamente/i);
    expect(warning).toHaveTextContent(/Exportar \(\.zip\)/i);

    const summary = screen.getByTestId('rehearsal-storage-summary');
    expect(summary).toHaveTextContent(/256 MiB/i);
    expect(summary).toHaveTextContent(/Pacotes nesta conta/i);
  });

  it('imports a valid .louvaio-rehearsal.zip via file input, shows 4 stems + Original, zero SongVersion links, and zero auto-playback', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs-root');
    const manager = createOpfsManager(opfsRoot);
    const { file, packageId } = await createSyntheticRehearsalPackageFile({ includeOriginal: true });

    const audioCtorSpy = vi.fn();
    vi.stubGlobal('Audio', audioCtorSpy);

    render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );

    await screen.findByTestId('rehearsal-empty-state');

    const fileInput = screen.getByTestId('rehearsal-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    const card = await screen.findByTestId(`rehearsal-package-card-${packageId}`);
    expect(fileInput.value).toBe('');
    expect(card).toHaveTextContent('Ensaio Domingo Noite');
    expect(card).toHaveTextContent('Vínculo local: Não associado');
    expect(card).toHaveTextContent('louvaio-rehearsal v1');
    expect(card).toHaveTextContent('44100 Hz · 2 ch');
    expect(screen.getByTestId(`rehearsal-integrity-badge-${packageId}`)).toHaveTextContent('Verificado');

    for (const label of ['Vocais', 'Bateria', 'Baixo', 'Outros', 'Original']) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).queryByText(/SongVersion|Vincular ao repertório/i)).not.toBeInTheDocument();
    expect(audioCtorSpy).not.toHaveBeenCalled();

    // Re-importing the exact same file triggers idempotent no-op without duplicating
    fireEvent.change(fileInput, { target: { files: [file] } });
    const banner = await screen.findByTestId('rehearsal-outcome-banner');
    expect(banner).toHaveTextContent('Pacote já importado');
    expect(screen.getAllByTestId(`rehearsal-package-card-${packageId}`)).toHaveLength(1);
  });

  it('displays progress card and cancels an in-flight import cleanly', async () => {
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let holdResolve!: () => void;
    const holdGate = new Promise<void>((resolve) => {
      holdResolve = resolve;
    });

    let blockedOnce = false;
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs-root', '', async (path) => {
      if (!blockedOnce && path.includes('staging')) {
        blockedOnce = true;
        releaseWrite();
        await holdGate;
      }
    });
    const manager = createOpfsManager(opfsRoot);
    const { file, packageId } = await createSyntheticRehearsalPackageFile();

    render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );
    await screen.findByTestId('rehearsal-empty-state');

    const fileInput = screen.getByTestId('rehearsal-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await writeStarted;
    const progressCard = await screen.findByTestId('rehearsal-progress-card');
    expect(progressCard).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('rehearsal-cancel-btn'));
    holdResolve();

    const banner = await screen.findByTestId('rehearsal-outcome-banner');
    expect(banner).toHaveTextContent(/cancelada/i);
    expect(screen.queryByTestId(`rehearsal-package-card-${packageId}`)).not.toBeInTheDocument();
  });

  it('handles conflict resolution (discard vs replace), details modal, rename validation, revalidation, export download, and scoped delete', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs-root');
    const manager = createOpfsManager(opfsRoot);
    const rev1 = await createSyntheticRehearsalPackageFile({
      revision: 1,
      displayName: 'Hino Revisão 1',
      seedOffset: 0,
    });
    const rev2 = await createSyntheticRehearsalPackageFile({
      revision: 2,
      displayName: 'Hino Revisão 2',
      seedOffset: 40,
    });

    const createUrlSpy = vi.fn(() => 'blob:rehearsal-backup');
    const revokeUrlSpy = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createUrlSpy,
      revokeObjectURL: revokeUrlSpy,
    });

    render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );
    await screen.findByTestId('rehearsal-empty-state');

    const fileInput = screen.getByTestId('rehearsal-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [rev1.file] } });
    await screen.findByTestId(`rehearsal-package-card-${rev1.packageId}`);

    // Conflict: import rev 2 -> discard keeps rev 1
    fireEvent.change(fileInput, { target: { files: [rev2.file] } });
    const conflictCard = await screen.findByTestId('rehearsal-conflict-card');
    expect(conflictCard).toHaveTextContent('Revisão 1');
    expect(conflictCard).toHaveTextContent('Revisão 2');

    fireEvent.click(screen.getByTestId('rehearsal-conflict-cancel-btn'));
    await waitFor(() => expect(screen.queryByTestId('rehearsal-conflict-card')).not.toBeInTheDocument());
    expect(screen.getByTestId(`rehearsal-package-card-${rev1.packageId}`)).toHaveTextContent('Hino Revisão 1');

    // Conflict: import rev 2 -> replace updates to rev 2
    fireEvent.change(fileInput, { target: { files: [rev2.file] } });
    await screen.findByTestId('rehearsal-conflict-card');
    fireEvent.click(screen.getByTestId('rehearsal-conflict-replace-btn'));
    await waitFor(() =>
      expect(screen.getByTestId(`rehearsal-package-card-${rev1.packageId}`)).toHaveTextContent('Hino Revisão 2'),
    );

    // Details modal
    fireEvent.click(screen.getByTestId(`rehearsal-details-${rev1.packageId}`));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(rev1.packageId);
    expect(dialog).toHaveTextContent('Uso interno da equipe de louvor local.');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Rename dialog (rejects blank, accepts valid custom label)
    fireEvent.click(screen.getByTestId(`rehearsal-rename-${rev1.packageId}`));
    const renameInput = await screen.findByRole('textbox', { name: /Rótulo local/i });
    fireEvent.change(renameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('rehearsal-rename-submit-btn'));
    expect(await screen.findByText(/1 e 120 caracteres/i)).toBeInTheDocument();

    fireEvent.change(renameInput, { target: { value: 'Ensaio Especial Domingo' } });
    fireEvent.click(screen.getByTestId('rehearsal-rename-submit-btn'));
    await waitFor(() => {
      const card = screen.getByTestId(`rehearsal-package-card-${rev1.packageId}`);
      expect(card).toHaveTextContent('Ensaio Especial Domingo');
      expect(card).toHaveTextContent('Original no manifesto: Hino Revisão 2');
    });

    // Revalidate
    fireEvent.click(screen.getByTestId(`rehearsal-revalidate-${rev1.packageId}`));
    expect(await screen.findByTestId('rehearsal-outcome-banner')).toHaveTextContent('Pacote revalidado');

    // Export download fallback (<a download>)
    fireEvent.click(screen.getByTestId(`rehearsal-export-${rev1.packageId}`));
    await waitFor(() => expect(createUrlSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('rehearsal-outcome-banner')).toHaveTextContent('Backup pronto para download');

    // Scoped Delete ConfirmDialog
    fireEvent.click(screen.getByTestId(`rehearsal-delete-${rev1.packageId}`));
    const confirmDialog = await screen.findByRole('dialog');
    expect(confirmDialog).toHaveTextContent(
      /Esta ação removerá apenas a cópia gerenciada pelo navegador neste aparelho/i,
    );
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Excluir cópia local' }));
    await screen.findByTestId('rehearsal-empty-state');
  });

  it('supports ephemeral fallback mode, File System Access cancellation, and revoked handle permission notices', async () => {
    const manager = new RehearsalPackageLibraryManager({
      getOpfsRoot: async () => null,
      quotaEstimator: async () => ({ quota: null, usage: null }),
      persistenceChecker: async () => false,
    });
    const { file, packageId } = await createSyntheticRehearsalPackageFile();

    let permissionState: 'granted' | 'denied' = 'granted';
    const externalHandle: ExternalFileHandleLike = {
      name: 'externo.louvaio-rehearsal.zip',
      queryPermission: async () => permissionState,
      getFile: async () => file,
    };

    const pickerMock = vi
      .fn()
      .mockRejectedValueOnce(makeDomException('Cancelled', 'AbortError'))
      .mockResolvedValueOnce([externalHandle]);
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = pickerMock;

    render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );

    expect(await screen.findByTestId('rehearsal-storage-mode-badge')).toHaveTextContent(
      'Modo Efêmero (Sem OPFS Persistente)',
    );
    expect(screen.getByTestId('rehearsal-storage-summary')).toHaveTextContent('Indisponível neste navegador');

    // User cancels File System Access picker cleanly
    const fsBtn = screen.getByTestId('rehearsal-fs-access-btn');
    fireEvent.click(fsBtn);
    expect(await screen.findByTestId('rehearsal-outcome-banner')).toHaveTextContent('Importação cancelada');

    // User picks external handle cleanly
    fireEvent.click(fsBtn);
    await screen.findByTestId(`rehearsal-package-card-${packageId}`);

    // Revoke permission -> Revalidate updates badge to 'Permissão revogada'
    permissionState = 'denied';
    fireEvent.click(screen.getByTestId(`rehearsal-revalidate-${packageId}`));
    await waitFor(() =>
      expect(screen.getByTestId(`rehearsal-integrity-badge-${packageId}`)).toHaveTextContent('Permissão revogada'),
    );
  });

  it('shows recoverable retry error instead of empty state when loadLibrary fails', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs-root');
    const manager = createOpfsManager(opfsRoot);
    const loadSpy = vi
      .spyOn(manager, 'loadLibrary')
      .mockRejectedValueOnce(new Error('Falha simulada ao ler OPFS'));

    render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );

    const banner = await screen.findByTestId('rehearsal-outcome-banner');
    expect(banner).toHaveTextContent('Falha simulada ao ler OPFS');
    expect(screen.queryByTestId('rehearsal-empty-state')).not.toBeInTheDocument();

    loadSpy.mockRestore();
    fireEvent.click(screen.getByTestId('rehearsal-retry-btn'));
    await screen.findByTestId('rehearsal-empty-state');
  });

  it('isolates accounts on currentUser switch and invalidates previous session without deleting OPFS data', async () => {
    const opfsRoot = new FakeOpfsDirectoryHandle('opfs-root');
    const manager = createOpfsManager(opfsRoot);
    const invalidateSpy = vi.spyOn(manager, 'invalidateSession');
    const { file, packageId } = await createSyntheticRehearsalPackageFile();

    const { rerender } = render(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );
    await screen.findByTestId('rehearsal-empty-state');

    fireEvent.change(screen.getByTestId('rehearsal-file-input'), { target: { files: [file] } });
    await screen.findByTestId(`rehearsal-package-card-${packageId}`);

    // Switch to User B -> User A's packages hidden, invalidateSession called
    rerender(
      <RehearsalPackageLibraryView
        currentUser={USER_B}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );
    expect(invalidateSpy).toHaveBeenCalled();
    await screen.findByTestId('rehearsal-empty-state');
    expect(screen.queryByTestId(`rehearsal-package-card-${packageId}`)).not.toBeInTheDocument();

    // Switch back to User A -> User A's OPFS package is still preserved
    rerender(
      <RehearsalPackageLibraryView
        currentUser={USER_A}
        onNavigateBack={vi.fn()}
        manager={manager}
      />,
    );
    await screen.findByTestId(`rehearsal-package-card-${packageId}`);
  });
});
