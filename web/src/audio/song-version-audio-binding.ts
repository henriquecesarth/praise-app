import { LOCAL_SONG_VERSION_PROVENANCE } from '../types';
import {
  LocalAudioTransportController,
  type LocalAudioTransportDependencies,
  type SetRateOptions,
  type TransportSnapshot,
} from './local-audio-transport';
import {
  RehearsalPackageLibraryManager,
  type LocalSongVersionAudioBinding,
  type RehearsalAssetId,
  type ResolveVerifiedBoundAssetResult,
} from './rehearsal-package-library';

export type {
  LocalBindingValidityState,
  LocalSongVersionAudioBinding,
  RehearsalAssetId,
  ResolveVerifiedBoundAssetResult,
} from './rehearsal-package-library';

/**
 * Canonical version ID pattern shared between Repertoire songs and Smart Chord links
 * (matches `backend/src/features/smart_chords/smart_chord_version.ts`).
 */
export const SAFE_VERSION_ID_REGEX = /^[^\x00-\x1F\x7F/\\?#&%<>]{1,150}$/;

export interface CanonicalSongVersion {
  id: string;
  name: string;
  key: string | null;
  bpm?: number | string | null;
  duration?: string | null;
  isSynthetic: boolean;
}

export interface SongVersionInputLike {
  [LOCAL_SONG_VERSION_PROVENANCE]?: 'legacy' | 'missing';
  id?: string | null;
  name?: string | null;
  key?: string | null;
  bpm?: number | string | null;
  duration?: string | null;
  isSynthetic?: boolean;
}

export interface SongForVersionResolution {
  id: string;
  title?: string | null;
  ministryId?: string | null;
  originalKey?: string | null;
  original_key?: string | null;
  versions?: SongVersionInputLike[] | null;
}

export type CanonicalVersionResolution =
  | {
      status: 'resolved';
      version: CanonicalSongVersion;
      effectiveVersions: CanonicalSongVersion[];
      matchedViaLegacyV1Alias: boolean;
    }
  | {
      status: 'version_required';
      effectiveVersions: CanonicalSongVersion[];
      message: string;
    }
  | {
      status: 'version_not_found';
      requestedVersionId: string;
      effectiveVersions: CanonicalSongVersion[];
      message: string;
    };

export interface BindSongVersionOptions {
  userId: string;
  ministryId: string;
  song: SongForVersionResolution;
  requestedVersionId?: string | null;
  packageId: string;
  songReadVerified: boolean;
  isOnline?: boolean;
  explicitlySelectedByUser?: boolean;
}

export type BindSongVersionRejectionReason =
  | 'UNAUTHENTICATED'
  | 'INVALID_MINISTRY'
  | 'INVALID_SONG'
  | 'TENANT_MISMATCH'
  | 'SONG_READ_NOT_VERIFIED'
  | 'OFFLINE_BIND_FORBIDDEN'
  | 'EXPLICIT_SELECTION_REQUIRED'
  | 'INVALID_PACKAGE'
  | 'VERSION_REQUIRED'
  | 'VERSION_NOT_FOUND'
  | 'INVALID_VERSION_ID'
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_CORRUPTED';

export type BindSongVersionResult =
  | {
      ok: true;
      status: 'bound';
      binding: LocalSongVersionAudioBinding;
      resolution: Extract<CanonicalVersionResolution, { status: 'resolved' }>;
    }
  | {
      ok: false;
      status:
        | 'rejected'
        | 'version_required'
        | 'version_not_found'
        | 'package_not_found'
        | 'package_corrupted';
      reason: BindSongVersionRejectionReason;
      message: string;
      resolution?: CanonicalVersionResolution;
    };

export interface UnbindSongVersionOptions {
  userId: string;
  ministryId: string;
  songId: string;
  canonicalVersionId: string;
}

export interface UnbindSongVersionResult {
  removed: boolean;
  removedBinding: LocalSongVersionAudioBinding | null;
}

export interface ReconcileSongVersionBindingsOptions {
  userId: string;
  ministryId: string;
  song: SongForVersionResolution;
}

export interface ReconcileSongVersionBindingsResult {
  bindings: LocalSongVersionAudioBinding[];
  changed: boolean;
  invalidatedCount: number;
}

export interface LoadedRehearsalMediaIdentity {
  userId: string;
  accountNamespaceHash: string;
  ministryId: string;
  songId: string;
  songTitle: string;
  canonicalVersionId: string;
  versionName: string;
  packageId: string;
  packageTitle: string;
  assetId: RehearsalAssetId;
  assetContainer: string;
  assetSha256: string;
}

export interface LoadingRehearsalMediaIdentity {
  userId: string;
  accountNamespaceHash: string;
  ministryId: string;
  songId: string;
  songTitle: string;
  canonicalVersionId: string;
  versionName: string;
}

export interface GlobalRehearsalAudioSessionSnapshot {
  loadedMedia: LoadedRehearsalMediaIdentity | null;
  loadingMedia: LoadingRehearsalMediaIdentity | null;
  isLoading: boolean;
  statusMessage: string | null;
  lastError: string | null;
  generation: number;
  activeContext: { userId: string | null; ministryId: string | null };
  transport: TransportSnapshot;
}

export interface LoadBoundVersionAudioOptions {
  userId: string;
  ministryId: string;
  song: SongForVersionResolution;
  version: CanonicalSongVersion;
  manager: RehearsalPackageLibraryManager;
  autoPlayAfterLoad?: boolean;
}

export type GlobalRehearsalAudioLoadResult =
  | {
      status: 'ready' | 'playing';
      loadedMedia: LoadedRehearsalMediaIdentity;
      snapshot: GlobalRehearsalAudioSessionSnapshot;
    }
  | {
      status:
        | 'not_bound'
        | 'invalid_binding'
        | 'stems_only_requires_mixer'
        | 'unsupported_codec'
        | 'corrupted'
        | 'error'
        | 'stale';
      message: string;
      snapshot: GlobalRehearsalAudioSessionSnapshot;
    };

function buildSyntheticDefaultVersionId(songId: string): string {
  return `${songId}_v1`;
}

/**
 * Extracts canonical SongVersions following the same semantics as
 * `backend/src/features/smart_chords/smart_chord_version.ts`.
 * When `song.versions` is absent or empty, synthesizes a single `<songId>_v1`
 * version with `isSynthetic: true`.
 */
export function extractCanonicalSongVersions(
  song: SongForVersionResolution,
): CanonicalSongVersion[] {
  const songId = typeof song?.id === 'string' ? song.id.trim() : '';
  if (!songId) {
    return [];
  }

  const fallbackKey = song.originalKey ?? song.original_key ?? null;
  const counts = new Map<string, number>();
  const explicit: CanonicalSongVersion[] = [];

  if (Array.isArray(song.versions)) {
    for (const raw of song.versions) {
      if (typeof raw?.id === 'string') {
        const id = raw.id.trim();
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    for (const raw of song.versions) {
      if (!raw || typeof raw.id !== 'string') continue;
      const trimmedId = raw.id.trim();
      if (!trimmedId || !SAFE_VERSION_ID_REGEX.test(trimmedId) || counts.get(trimmedId) !== 1 || raw[LOCAL_SONG_VERSION_PROVENANCE] === 'missing') {
        continue;
      }
      const trimmedName =
        typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Original';
      explicit.push({
        id: trimmedId,
        name: trimmedName,
        key: raw.key ?? fallbackKey ?? null,
        bpm: raw.bpm ?? null,
        duration: raw.duration ?? null,
        isSynthetic: raw[LOCAL_SONG_VERSION_PROVENANCE] === 'legacy',
      });
    }
  }

  if (explicit.length === 0 && (!Array.isArray(song.versions) || song.versions.length === 0)) {
    const syntheticId = buildSyntheticDefaultVersionId(songId);
    if (!SAFE_VERSION_ID_REGEX.test(syntheticId)) {
      return [];
    }
    return [
      {
        id: syntheticId,
        name: 'Original',
        key: fallbackKey ?? null,
        bpm: null,
        duration: null,
        isSynthetic: true,
      },
    ];
  }

  return explicit;
}

/**
 * Resolves a canonical SongVersion from a song and optional `requestedVersionId`.
 * Never silently falls back to index 0 when `effectiveVersions.length > 1` or when
 * an explicit `requestedVersionId` is not found.
 * Legacy `'v1'` alias is accepted ONLY when `effectiveVersions.length === 1` and
 * `effectiveVersions[0].isSynthetic === true`.
 */
export function resolveCanonicalSongVersion(
  song: SongForVersionResolution,
  requestedVersionId?: string | null,
): CanonicalVersionResolution {
  const effectiveVersions = extractCanonicalSongVersions(song);
  if (effectiveVersions.length === 0) {
    return {
      status: 'version_not_found',
      requestedVersionId: typeof requestedVersionId === 'string' ? requestedVersionId.trim() : '',
      effectiveVersions: [],
      message: 'Nenhuma versão válida encontrada para esta música.',
    };
  }

  if (typeof requestedVersionId === 'string' && requestedVersionId.trim() !== '') {
    const trimmed = requestedVersionId.trim();
    const direct = effectiveVersions.find((v) => v.id === trimmed);
    if (direct) {
      return {
        status: 'resolved',
        version: direct,
        effectiveVersions,
        matchedViaLegacyV1Alias: false,
      };
    }

    if (
      effectiveVersions.length === 1 &&
      effectiveVersions[0].isSynthetic &&
      trimmed === 'v1'
    ) {
      return {
        status: 'resolved',
        version: effectiveVersions[0],
        effectiveVersions,
        matchedViaLegacyV1Alias: true,
      };
    }

    return {
      status: 'version_not_found',
      requestedVersionId: trimmed,
      effectiveVersions,
      message: `Versão "${trimmed}" não encontrada nesta música.`,
    };
  }

  if (effectiveVersions.length === 1 && (!song.versions?.length || song.versions.length === 1)) {
    return {
      status: 'resolved',
      version: effectiveVersions[0],
      effectiveVersions,
      matchedViaLegacyV1Alias: false,
    };
  }

  return {
    status: 'version_required',
    effectiveVersions,
    message:
      'Esta música possui múltiplas versões; selecione explicitamente a versão para vincular ou reproduzir.',
  };
}

/**
 * Binds a verified local rehearsal package in the user's account library to a canonical
 * `(ministryId, songId, canonicalVersionId)` identity.
 * Fails closed when unauthenticated, tenant-mismatched, unverified song read, offline,
 * unresolved version, or missing/corrupted package.
 */
export async function bindSongVersion(
  manager: RehearsalPackageLibraryManager,
  options: BindSongVersionOptions,
): Promise<BindSongVersionResult> {
  const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
  if (!userId) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'UNAUTHENTICATED',
      message: 'Usuário autenticado obrigatório para vincular áudio local.',
    };
  }

  const ministryId = typeof options.ministryId === 'string' ? options.ministryId.trim() : '';
  if (!ministryId) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'INVALID_MINISTRY',
      message: 'Ministério ativo obrigatório para vincular áudio local.',
    };
  }

  const songId = typeof options.song?.id === 'string' ? options.song.id.trim() : '';
  if (!songId) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'INVALID_SONG',
      message: 'Música inválida para vínculo de áudio local.',
    };
  }

  if (
    typeof options.song.ministryId === 'string' &&
    options.song.ministryId.trim() !== '' &&
    options.song.ministryId.trim() !== ministryId
  ) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'TENANT_MISMATCH',
      message: 'A música informada não pertence ao ministério ativo.',
    };
  }

  if (options.songReadVerified !== true) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'SONG_READ_NOT_VERIFIED',
      message: 'Não é possível vincular áudio local sem leitura verificada da música.',
    };
  }

  const isOnline =
    options.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);
  if (!isOnline) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'OFFLINE_BIND_FORBIDDEN',
      message: 'Vínculo de novo pacote exige conexão ativa para validar o contexto da música.',
    };
  }

  if (options.explicitlySelectedByUser === false) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'EXPLICIT_SELECTION_REQUIRED',
      message: 'O vínculo local exige seleção explícita do usuário.',
    };
  }

  const packageId = typeof options.packageId === 'string' ? options.packageId.trim() : '';
  if (!packageId) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'INVALID_PACKAGE',
      message: 'Pacote local inválido para vínculo.',
    };
  }

  const resolution = resolveCanonicalSongVersion(options.song, options.requestedVersionId);
  if (resolution.status === 'version_required') {
    return {
      ok: false,
      status: 'version_required',
      reason: 'VERSION_REQUIRED',
      message: resolution.message,
      resolution,
    };
  }
  if (resolution.status === 'version_not_found') {
    return {
      ok: false,
      status: 'version_not_found',
      reason: 'VERSION_NOT_FOUND',
      message: resolution.message,
      resolution,
    };
  }

  if (!SAFE_VERSION_ID_REGEX.test(resolution.version.id)) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'INVALID_VERSION_ID',
      message: 'Identificador de versão inválido.',
      resolution,
    };
  }

  const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
  const nowIso = new Date().toISOString();

  return manager.saveBindingsMutation<BindSongVersionResult>(
    { userId },
    (currentBindings, packages) => {
      const pkg = packages.find(
        (p) => p.packageId === packageId && p.accountNamespaceHash === accountHash,
      );
      if (!pkg) {
        return {
          bindings: currentBindings,
          changed: false,
          result: {
            ok: false,
            status: 'package_not_found',
            reason: 'PACKAGE_NOT_FOUND',
            message: 'Pacote local não encontrado na biblioteca desta conta.',
          },
        };
      }

      if (pkg.integrityState !== 'verified' || !pkg.isReadyForLocalUse) {
        return {
          bindings: currentBindings,
          changed: false,
          result: {
            ok: false,
            status: 'package_corrupted',
            reason: 'PACKAGE_CORRUPTED',
            message:
              pkg.integrityMessage ??
              'O pacote local está corrompido ou incompleto e não pode ser vinculado.',
          },
        };
      }

      const assetId: RehearsalAssetId = pkg.original ? 'original' : 'stems_bundle_v1';
      const newBinding: LocalSongVersionAudioBinding = {
        accountNamespaceHash: accountHash,
        ministryId,
        songId,
        canonicalVersionId: resolution.version.id,
        packageId: pkg.packageId,
        assetId,
        songTitleSnapshot: typeof options.song.title === 'string' ? options.song.title.trim() : '',
        versionNameSnapshot: resolution.version.name,
        versionKeySnapshot: resolution.version.key ?? null,
        versionIsSynthetic: resolution.version.isSynthetic,
        packageTitleSnapshot: pkg.displayName,
        packageRevision: pkg.revision,
        packageManifestSha256: pkg.manifestSha256,
        packageCompositeSha256: pkg.compositeSha256,
        assetSha256: pkg.original ? pkg.original.sha256 : pkg.compositeSha256,
        assetContainer: pkg.original ? pkg.original.container : 'stems_bundle_v1',
        assetCodec: pkg.original ? pkg.original.codec : 'stems_bundle_v1',
        boundAt: nowIso,
        validityState: 'valid',
        validityMessage: null,
        invalidatedAt: null,
      };

      const filtered = currentBindings.filter(
        (b) =>
          !(
            b.accountNamespaceHash === accountHash &&
            b.ministryId === ministryId &&
            b.songId === songId &&
            b.canonicalVersionId === resolution.version.id
          ),
      );
      filtered.push(newBinding);

      return {
        bindings: filtered,
        changed: true,
        result: {
          ok: true,
          status: 'bound',
          binding: { ...newBinding },
          resolution,
        },
      };
    },
  );
}

/**
 * Removes the local audio binding for `(userId, ministryId, songId, canonicalVersionId)`.
 * Never deletes the underlying personal rehearsal package from the user's library.
 */
export async function unbindSongVersion(
  manager: RehearsalPackageLibraryManager,
  options: UnbindSongVersionOptions,
): Promise<UnbindSongVersionResult> {
  const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
  const ministryId = typeof options.ministryId === 'string' ? options.ministryId.trim() : '';
  const songId = typeof options.songId === 'string' ? options.songId.trim() : '';
  const canonicalVersionId =
    typeof options.canonicalVersionId === 'string' ? options.canonicalVersionId.trim() : '';
  if (!userId || !ministryId || !songId || !canonicalVersionId) {
    return { removed: false, removedBinding: null };
  }

  const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);

  return manager.saveBindingsMutation<UnbindSongVersionResult>({ userId }, (currentBindings) => {
    const match = currentBindings.find(
      (b) =>
        b.accountNamespaceHash === accountHash &&
        b.ministryId === ministryId &&
        b.songId === songId &&
        b.canonicalVersionId === canonicalVersionId,
    );
    if (!match) {
      return {
        bindings: currentBindings,
        changed: false,
        result: { removed: false, removedBinding: null },
      };
    }

    const nextBindings = currentBindings.filter((b) => b !== match);
    return {
      bindings: nextBindings,
      changed: true,
      result: { removed: true, removedBinding: { ...match } },
    };
  });
}

/**
 * Reconciles persisted local bindings for a song against its current canonical versions
 * and current local packages.
 *
 * **Sticky Tombstone Limitation (`version_removed`):**
 * `backend` `SongVersion` records do not carry an immutable creation UID or timestamp.
 * Therefore, once a binding transitions to `validityState: 'version_removed'`, it remains
 * `'version_removed'` permanently—even if another version with the same `id` is later
 * recreated on the song—until the user explicitly creates a new binding via `bindSongVersion`.
 */
export async function reconcileSongVersionBindings(
  manager: RehearsalPackageLibraryManager,
  options: ReconcileSongVersionBindingsOptions,
): Promise<ReconcileSongVersionBindingsResult> {
  const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
  const ministryId = typeof options.ministryId === 'string' ? options.ministryId.trim() : '';
  const songId = typeof options.song?.id === 'string' ? options.song.id.trim() : '';
  if (!userId || !ministryId || !songId) {
    return { bindings: [], changed: false, invalidatedCount: 0 };
  }

  const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
  const effectiveVersions = extractCanonicalSongVersions(options.song);
  const versionMap = new Map(effectiveVersions.map((v) => [v.id, v] as const));
  const nowIso = new Date().toISOString();

  return manager.saveBindingsMutation<ReconcileSongVersionBindingsResult>(
    { userId },
    (currentBindings, packages) => {
      const pkgMap = new Map(packages.map((p) => [p.packageId, p] as const));
      let changed = false;
      let invalidatedCount = 0;

      const updatedBindings = currentBindings.map((b) => {
        if (
          b.accountNamespaceHash !== accountHash ||
          b.ministryId !== ministryId ||
          b.songId !== songId
        ) {
          return { ...b };
        }

        // Sticky tombstone: never auto-revive a removed version even if its ID is recreated.
        if (b.validityState === 'version_removed') {
          return { ...b };
        }

        const currentVer = versionMap.get(b.canonicalVersionId);
        if (!currentVer || b.versionIsSynthetic !== currentVer.isSynthetic) {
          changed = true;
          invalidatedCount += 1;
          return {
            ...b,
            validityState: 'version_removed' as const,
            validityMessage: 'A versão vinculada foi removida ou substituída na música.',
            invalidatedAt: nowIso,
          };
        }

        const pkg = pkgMap.get(b.packageId);
        if (!pkg) {
          if (b.validityState !== 'package_missing') {
            changed = true;
            invalidatedCount += 1;
            return {
              ...b,
              validityState: 'package_missing' as const,
              validityMessage: 'Pacote local ausente ou excluído da biblioteca desta conta.',
              invalidatedAt: nowIso,
            };
          }
          return { ...b };
        }

        const assetMatches =
          b.assetId === 'stems_bundle_v1' ||
          (pkg.original !== null && pkg.original.sha256 === b.assetSha256);
        if (
          pkg.compositeSha256 !== b.packageCompositeSha256 ||
          pkg.manifestSha256 !== b.packageManifestSha256 ||
          !assetMatches
        ) {
          if (b.validityState !== 'package_replaced_incompatible') {
            changed = true;
            invalidatedCount += 1;
            return {
              ...b,
              validityState: 'package_replaced_incompatible' as const,
              validityMessage:
                'O pacote local foi substituído por uma revisão ou conteúdo incompatível com este vínculo.',
              invalidatedAt: nowIso,
            };
          }
          return { ...b };
        }

        if (pkg.integrityState !== 'verified' || !pkg.isReadyForLocalUse) {
          if (b.validityState !== 'package_corrupted') {
            changed = true;
            invalidatedCount += 1;
            return {
              ...b,
              validityState: 'package_corrupted' as const,
              validityMessage:
                pkg.integrityMessage ?? 'Pacote local corrompido ou incompleto.',
              invalidatedAt: nowIso,
            };
          }
          return { ...b };
        }

        if (b.validityState === 'package_corrupted') {
          changed = true;
          return {
            ...b,
            validityState: 'valid' as const,
            validityMessage: null,
            invalidatedAt: null,
          };
        }

        return { ...b };
      });

      const songBindings = updatedBindings
        .filter(
          (b) =>
            b.accountNamespaceHash === accountHash &&
            b.ministryId === ministryId &&
            b.songId === songId,
        )
        .map((b) => ({ ...b }));

      return {
        bindings: updatedBindings,
        changed,
        result: {
          bindings: songBindings,
          changed,
          invalidatedCount,
        },
      };
    },
  );
}

/**
 * Global rehearsal audio session controller wrapping a single `LocalAudioTransportController`.
 * Enforces strict generation fencing across rapid loads, ministry/account context switches,
 * logouts, package invalidation, and binding removal, while preserving active playback
 * across view switches within the same `(userId, ministryId)` scope.
 */
export class GlobalRehearsalAudioSessionController {
  private readonly _transport: LocalAudioTransportController;
  private readonly _listeners = new Set<
    (snapshot: GlobalRehearsalAudioSessionSnapshot) => void
  >();
  private readonly _transportUnsubscribe: () => void;

  private _generation = 1;
  private _disposed = false;
  private _activeContext: { userId: string | null; ministryId: string | null } = {
    userId: null,
    ministryId: null,
  };
  private _loadedMedia: LoadedRehearsalMediaIdentity | null = null;
  private _loadingMedia: LoadingRehearsalMediaIdentity | null = null;
  private _loadingPackageId: string | null = null;
  private _isLoading = false;
  private _statusMessage: string | null = null;
  private _lastError: string | null = null;
  private _pendingAbortController: AbortController | null = null;
  private _lastTransportSnapshot: TransportSnapshot;

  constructor(deps?: LocalAudioTransportDependencies) {
    this._transport = new LocalAudioTransportController(
      { accountNamespace: '', ministryId: null },
      deps,
    );
    this._lastTransportSnapshot = this._transport.getSnapshot();
    this._transportUnsubscribe = this._transport.subscribe((snap) => {
      this._lastTransportSnapshot = snap;
      this._emit();
    });
  }

  getSnapshot(): GlobalRehearsalAudioSessionSnapshot {
    return {
      loadedMedia: this._loadedMedia ? { ...this._loadedMedia } : null,
      loadingMedia: this._loadingMedia ? { ...this._loadingMedia } : null,
      isLoading: this._isLoading,
      statusMessage: this._statusMessage,
      lastError: this._lastError,
      generation: this._generation,
      activeContext: { ...this._activeContext },
      transport: this._lastTransportSnapshot,
    };
  }

  getTransportDiagnostics() {
    return this._transport.getDiagnostics();
  }

  subscribe(
    listener: (snapshot: GlobalRehearsalAudioSessionSnapshot) => void,
  ): () => void {
    this._listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _emit(): void {
    const snap = this.getSnapshot();
    for (const listener of Array.from(this._listeners)) {
      listener(snap);
    }
  }

  private _abortPendingLoad(): void {
    if (this._pendingAbortController) {
      this._pendingAbortController.abort();
      this._pendingAbortController = null;
    }
  }

  private _isGenerationAndContextCurrent(
    myGen: number,
    userId: string,
    ministryId: string,
  ): boolean {
    return (
      !this._disposed &&
      myGen === this._generation &&
      this._activeContext.userId === userId &&
      this._activeContext.ministryId === ministryId
    );
  }

  /**
   * Attaches this controller to a `RehearsalPackageLibraryManager` so package deletion,
   * incompatible replacement, or corruption automatically stops active matching playback.
   */
  attachToLibraryManager(manager: RehearsalPackageLibraryManager): () => void {
    return manager.subscribePackageInvalidation((event) => {
      const activeUserId = this._activeContext.userId;
      if (!activeUserId) return;
      const activeAccountHash =
        RehearsalPackageLibraryManager.computeAccountNamespaceHash(activeUserId);
      if (event.accountNamespaceHash === activeAccountHash) {
        this.notifyPackageInvalidated(event.packageId);
      }
    });
  }

  /**
   * Synchronizes active `(userId, ministryId)` session context.
   * Preserves loaded media and playback when context is unchanged.
   * Immediately aborts pending ops, increments generation, stops transport (revoking object URLs),
   * and clears loaded media whenever `userId` or `ministryId` changes or logs out (`null`/empty).
   */
  syncSessionContext(context: {
    userId: string | null | undefined;
    ministryId: string | null | undefined;
  }): GlobalRehearsalAudioSessionSnapshot {
    if (this._disposed) {
      return this.getSnapshot();
    }

    const nextUserId =
      typeof context.userId === 'string' && context.userId.trim()
        ? context.userId.trim()
        : null;
    const nextMinistryId =
      nextUserId && typeof context.ministryId === 'string' && context.ministryId.trim()
        ? context.ministryId.trim()
        : null;

    if (
      nextUserId !== null &&
      nextMinistryId !== null &&
      this._activeContext.userId === nextUserId &&
      this._activeContext.ministryId === nextMinistryId
    ) {
      return this.getSnapshot();
    }

    this._generation += 1;
    this._abortPendingLoad();
    this._activeContext = { userId: nextUserId, ministryId: nextMinistryId };
    this._loadedMedia = null;
    this._loadingMedia = null;
    this._loadingPackageId = null;
    this._isLoading = false;
    this._statusMessage = null;
    this._lastError = null;

    const nextAccountNamespace = nextUserId
      ? RehearsalPackageLibraryManager.computeAccountNamespaceHash(nextUserId)
      : '';
    this._transport.setSessionContext({
      accountNamespace: nextAccountNamespace,
      ministryId: nextMinistryId,
    });
    this._transport.stop();
    this._emit();
    return this.getSnapshot();
  }

  /**
   * Resolves, verifies, and loads the bound local WAV asset for `(userId, ministryId, song, version)`.
   * Always stops previous active audio before starting async resolution and never autoplays unless
   * `autoPlayAfterLoad === true` from an explicit user action.
   */
  async loadBoundVersionAudio(
    options: LoadBoundVersionAudioOptions,
  ): Promise<GlobalRehearsalAudioLoadResult> {
    if (this._disposed) {
      return {
        status: 'stale',
        message: 'Controlador de sessão descartado.',
        snapshot: this.getSnapshot(),
      };
    }

    const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
    const ministryId = typeof options.ministryId === 'string' ? options.ministryId.trim() : '';
    if (!userId || !ministryId) {
      this._generation += 1;
      this._abortPendingLoad();
      this._loadedMedia = null;
      this._loadingMedia = null;
      this._loadingPackageId = null;
      this._isLoading = false;
      this._lastError = 'Sessão de usuário ou ministério inválida para reprodução local.';
      this._statusMessage = null;
      this._transport.stop();
      this._emit();
      return {
        status: 'error',
        message: this._lastError,
        snapshot: this.getSnapshot(),
      };
    }

    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);

    this._generation += 1;
    const myGen = this._generation;
    this._abortPendingLoad();

    const abortController = new AbortController();
    this._pendingAbortController = abortController;
    this._activeContext = { userId, ministryId };
    this._loadedMedia = null;
    this._loadingPackageId = null;
    this._loadingMedia = {
      userId,
      accountNamespaceHash: accountHash,
      ministryId,
      songId: options.song.id,
      songTitle: typeof options.song.title === 'string' ? options.song.title : '',
      canonicalVersionId: options.version.id,
      versionName: options.version.name,
    };
    this._isLoading = true;
    this._lastError = null;
    this._statusMessage = 'Verificando áudio local...';

    // Stop previous audio before async resolution so old audio can never play or masquerade.
    this._transport.stop();
    const expectedTransportGeneration = this._transport.getSnapshot().generation;
    this._emit();

    let resolved: ResolveVerifiedBoundAssetResult;
    try {
      resolved = await options.manager.resolveVerifiedBoundAsset({
        userId,
        ministryId,
        songId: options.song.id,
        canonicalVersionId: options.version.id,
        signal: abortController.signal,
      });
    } catch (err) {
      if (!this._isGenerationAndContextCurrent(myGen, userId, ministryId)) {
        return {
          status: 'stale',
          message: 'Carregamento descartado por troca de contexto ou nova seleção.',
          snapshot: this.getSnapshot(),
        };
      }
      this._pendingAbortController = null;
      this._loadingMedia = null;
      this._loadingPackageId = null;
      this._isLoading = false;
      this._statusMessage = null;
      this._lastError =
        err instanceof Error ? err.message : 'Falha ao resolver pacote de áudio local.';
      this._emit();
      return {
        status: 'error',
        message: this._lastError,
        snapshot: this.getSnapshot(),
      };
    }

    if (!this._isGenerationAndContextCurrent(myGen, userId, ministryId)) {
      return {
        status: 'stale',
        message: 'Carregamento descartado por troca de contexto ou nova seleção.',
        snapshot: this.getSnapshot(),
      };
    }

    if (resolved.status !== 'ready') {
      this._pendingAbortController = null;
      this._loadingMedia = null;
      this._loadingPackageId = null;
      this._isLoading = false;
      const message =
        resolved.status === 'not_bound'
          ? 'Nenhum pacote local vinculado a esta versão.'
          : resolved.message;
      this._statusMessage = null;
      this._lastError = resolved.status === 'not_bound' ? null : message;
      this._emit();
      return {
        status: resolved.status,
        message,
        snapshot: this.getSnapshot(),
      };
    }

    this._loadingPackageId = resolved.packageRecord.packageId;
    this._statusMessage = 'Carregando áudio WAV verificado...';
    this._emit();

    const transportSnap = await this._transport.load(resolved.file, {
      fileName: resolved.fileName,
      sessionContext: {
        accountNamespace: accountHash,
        ministryId,
        songId: options.song.id,
        versionId: options.version.id,
      },
      expectedGeneration: expectedTransportGeneration,
    });

    if (!this._isGenerationAndContextCurrent(myGen, userId, ministryId)) {
      // Transport load already fences and cleans up its own generation. A stale
      // session completion must not stop media loaded by a newer selection.
      return {
        status: 'stale',
        message: 'Carregamento descartado por troca de contexto ou logout.',
        snapshot: this.getSnapshot(),
      };
    }

    this._pendingAbortController = null;
    this._loadingMedia = null;
    this._loadingPackageId = null;
    this._isLoading = false;

    if (transportSnap.state === 'error' || transportSnap.state !== 'ready') {
      const errorMsg =
        transportSnap.error?.message ?? 'Falha ao carregar o arquivo de áudio WAV local.';
      this._loadedMedia = null;
      this._statusMessage = null;
      this._lastError = errorMsg;
      this._emit();
      return {
        status: 'error',
        message: errorMsg,
        snapshot: this.getSnapshot(),
      };
    }

    const loadedIdentity: LoadedRehearsalMediaIdentity = {
      userId,
      accountNamespaceHash: accountHash,
      ministryId,
      songId: options.song.id,
      songTitle: typeof options.song.title === 'string' ? options.song.title : '',
      canonicalVersionId: options.version.id,
      versionName: options.version.name,
      packageId: resolved.packageRecord.packageId,
      packageTitle: resolved.packageRecord.displayName,
      assetId: resolved.binding.assetId,
      assetContainer: resolved.binding.assetContainer,
      assetSha256: resolved.verifiedSha256,
    };

    this._loadedMedia = loadedIdentity;
    this._lastError = null;
    this._statusMessage = 'Áudio pronto para reprodução.';
    this._emit();

    if (
      options.autoPlayAfterLoad === true &&
      this._isGenerationAndContextCurrent(myGen, userId, ministryId)
    ) {
      const afterPlay = await this._transport.play();
      if (!this._isGenerationAndContextCurrent(myGen, userId, ministryId)) {
        return {
          status: 'stale',
          message: 'Reprodução interrompida por troca de contexto.',
          snapshot: this.getSnapshot(),
        };
      }
      if (afterPlay.state === 'error') {
        this._lastError =
          afterPlay.error?.message ?? 'Reprodução bloqueada pelo navegador.';
        this._emit();
      } else if (afterPlay.state === 'playing') {
        this._statusMessage = 'Reproduzindo áudio local.';
        this._emit();
        return {
          status: 'playing',
          loadedMedia: { ...loadedIdentity },
          snapshot: this.getSnapshot(),
        };
      }
    }

    return {
      status: 'ready',
      loadedMedia: { ...loadedIdentity },
      snapshot: this.getSnapshot(),
    };
  }

  async play(): Promise<TransportSnapshot> {
    if (this._disposed || !this._loadedMedia) {
      return this._transport.getSnapshot();
    }
    const snap = await this._transport.play();
    if (snap.state === 'error' && snap.error) {
      this._lastError = snap.error.message;
      this._emit();
    } else if (snap.state === 'playing') {
      this._lastError = null;
      this._statusMessage = 'Reproduzindo áudio local.';
      this._emit();
    }
    return snap;
  }

  pause(): TransportSnapshot {
    if (this._disposed) {
      return this._transport.getSnapshot();
    }
    const snap = this._transport.pause();
    this._statusMessage = 'Reprodução pausada.';
    this._emit();
    return snap;
  }

  seekFrame(frame: number): TransportSnapshot {
    if (this._disposed) {
      return this._transport.getSnapshot();
    }
    return this._transport.seek(frame);
  }

  setRate(rate: number, options?: SetRateOptions): TransportSnapshot {
    if (this._disposed) {
      return this._transport.getSnapshot();
    }
    return this._transport.setRate(rate, options);
  }

  setMasterGain(gain: number): TransportSnapshot {
    if (this._disposed) {
      return this._transport.getSnapshot();
    }
    return this._transport.setMasterGain(gain);
  }

  stop(): TransportSnapshot {
    if (this._disposed) {
      return this._transport.getSnapshot();
    }
    this._generation += 1;
    this._abortPendingLoad();
    this._loadedMedia = null;
    this._loadingMedia = null;
    this._loadingPackageId = null;
    this._isLoading = false;
    this._statusMessage = null;
    this._lastError = null;
    const snap = this._transport.stop();
    this._emit();
    return snap;
  }

  /**
   * Stops playback and clears loaded state immediately if the currently loaded or
   * loading media belongs to the invalidated `packageId`.
   */
  notifyPackageInvalidated(packageId: string): void {
    if (this._disposed) return;
    const matchesLoaded = this._loadedMedia?.packageId === packageId;
    const matchesLoading =
      this._isLoading &&
      (this._loadingPackageId === packageId || this._loadingPackageId === null);
    if (!matchesLoaded && !matchesLoading) {
      return;
    }
    this._generation += 1;
    this._abortPendingLoad();
    this._loadedMedia = null;
    this._loadingMedia = null;
    this._loadingPackageId = null;
    this._isLoading = false;
    this._lastError = null;
    this._statusMessage = 'Reprodução interrompida porque o pacote local foi removido ou invalidado.';
    this._transport.stop();
    this._emit();
  }

  /**
   * Stops playback and clears loaded state immediately if the currently loaded or
   * loading media matches `(ministryId, songId, canonicalVersionId)`.
   */
  notifyBindingRemoved(scope: {
    ministryId: string;
    songId: string;
    canonicalVersionId: string;
  }): void {
    if (this._disposed) return;
    const matchesLoaded =
      this._loadedMedia !== null &&
      this._loadedMedia.ministryId === scope.ministryId &&
      this._loadedMedia.songId === scope.songId &&
      this._loadedMedia.canonicalVersionId === scope.canonicalVersionId;
    const matchesLoading =
      this._loadingMedia !== null &&
      this._loadingMedia.ministryId === scope.ministryId &&
      this._loadingMedia.songId === scope.songId &&
      this._loadingMedia.canonicalVersionId === scope.canonicalVersionId;

    if (!matchesLoaded && !matchesLoading) {
      return;
    }

    this._generation += 1;
    this._abortPendingLoad();
    this._loadedMedia = null;
    this._loadingMedia = null;
    this._loadingPackageId = null;
    this._isLoading = false;
    this._lastError = null;
    this._statusMessage = 'Reprodução interrompida porque o vínculo desta versão foi removido.';
    this._transport.stop();
    this._emit();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._generation += 1;
    this._abortPendingLoad();
    this._loadedMedia = null;
    this._loadingMedia = null;
    this._loadingPackageId = null;
    this._isLoading = false;
    this._transportUnsubscribe();
    this._transport.dispose();
    this._listeners.clear();
  }
}

let defaultSessionController: GlobalRehearsalAudioSessionController | null = null;

export function getDefaultGlobalRehearsalAudioSessionController(): GlobalRehearsalAudioSessionController {
  if (!defaultSessionController) {
    defaultSessionController = new GlobalRehearsalAudioSessionController();
  }
  return defaultSessionController;
}
