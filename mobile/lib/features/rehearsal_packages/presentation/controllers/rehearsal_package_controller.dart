import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../repertoire/domain/song_detail.dart';
import '../../data/rehearsal_package_manager.dart';
import '../../data/rehearsal_package_saf_channel.dart';
import '../../domain/rehearsal_package_models.dart';

/// Immutable UI state for the account-scoped local rehearsal package library.
final class RehearsalPackagesState {
  const RehearsalPackagesState({
    this.isLoading = false,
    this.isBusy = false,
    this.packages = const [],
    this.storageSummary,
    this.activeProgress,
    this.lastOutcome,
    this.pendingConflict,
    this.recoveredOrphanedCount = 0,
    this.corruptedOrIncompleteCount = 0,
    this.boundUserId,
    this.errorMessage,
  });

  final bool isLoading;
  final bool isBusy;
  final List<LocalRehearsalPackageRecord> packages;
  final RehearsalStorageSummary? storageSummary;
  final RehearsalOperationProgress? activeProgress;
  final RehearsalOperationOutcome? lastOutcome;
  final RehearsalConflictDetails? pendingConflict;
  final int recoveredOrphanedCount;
  final int corruptedOrIncompleteCount;
  final String? boundUserId;
  final String? errorMessage;

  RehearsalPackagesState copyWith({
    bool? isLoading,
    bool? isBusy,
    List<LocalRehearsalPackageRecord>? packages,
    RehearsalStorageSummary? storageSummary,
    bool clearStorageSummary = false,
    RehearsalOperationProgress? activeProgress,
    bool clearActiveProgress = false,
    RehearsalOperationOutcome? lastOutcome,
    bool clearLastOutcome = false,
    RehearsalConflictDetails? pendingConflict,
    bool clearPendingConflict = false,
    int? recoveredOrphanedCount,
    int? corruptedOrIncompleteCount,
    String? boundUserId,
    bool clearBoundUserId = false,
    String? errorMessage,
    bool clearErrorMessage = false,
  }) {
    return RehearsalPackagesState(
      isLoading: isLoading ?? this.isLoading,
      isBusy: isBusy ?? this.isBusy,
      packages: packages ?? this.packages,
      storageSummary: clearStorageSummary
          ? null
          : (storageSummary ?? this.storageSummary),
      activeProgress: clearActiveProgress
          ? null
          : (activeProgress ?? this.activeProgress),
      lastOutcome: clearLastOutcome ? null : (lastOutcome ?? this.lastOutcome),
      pendingConflict: clearPendingConflict
          ? null
          : (pendingConflict ?? this.pendingConflict),
      recoveredOrphanedCount:
          recoveredOrphanedCount ?? this.recoveredOrphanedCount,
      corruptedOrIncompleteCount:
          corruptedOrIncompleteCount ?? this.corruptedOrIncompleteCount,
      boundUserId: clearBoundUserId ? null : (boundUserId ?? this.boundUserId),
      errorMessage: clearErrorMessage
          ? null
          : (errorMessage ?? this.errorMessage),
    );
  }
}

/// Manages local-first `.louvaio-rehearsal.zip` package operations for the
/// currently authenticated user, discarding stale callbacks on session change.
class RehearsalPackagesNotifier extends StateNotifier<RehearsalPackagesState> {
  RehearsalPackagesNotifier({
    required RehearsalPackageManager manager,
    required String? Function() currentUserIdReader,
  }) : _manager = manager,
       _currentUserIdReader = currentUserIdReader,
       super(const RehearsalPackagesState());

  final RehearsalPackageManager _manager;
  final String? Function() _currentUserIdReader;
  int _opGeneration = 0;

  bool _isStale(int gen, String userId) {
    return !mounted ||
        gen != _opGeneration ||
        (_currentUserIdReader()?.trim() ?? '') != userId;
  }

  /// Loads the account-scoped local rehearsal package library.
  Future<void> loadLibrary() async {
    final userId = _currentUserIdReader()?.trim() ?? '';
    if (userId.isEmpty) {
      if (!mounted) return;
      state = const RehearsalPackagesState(
        errorMessage:
            'Faça login para visualizar e gerenciar pacotes de ensaio offline.',
      );
      return;
    }
    if (state.isBusy) return;

    final gen = ++_opGeneration;
    final isUserSwitch =
        state.boundUserId != null && state.boundUserId != userId;
    state = state.copyWith(
      isLoading: true,
      packages: isUserSwitch ? const [] : state.packages,
      clearStorageSummary: isUserSwitch,
      clearActiveProgress: isUserSwitch,
      clearLastOutcome: isUserSwitch,
      clearPendingConflict: isUserSwitch,
      recoveredOrphanedCount: isUserSwitch ? 0 : state.recoveredOrphanedCount,
      corruptedOrIncompleteCount: isUserSwitch
          ? 0
          : state.corruptedOrIncompleteCount,
      boundUserId: userId,
      clearErrorMessage: true,
    );

    try {
      final snapshot = await _manager.loadLibrary(userId: userId);
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isLoading: false,
        packages: snapshot.packages,
        storageSummary: snapshot.storageSummary,
        recoveredOrphanedCount: snapshot.recoveredOrphanedCount,
        corruptedOrIncompleteCount: snapshot.corruptedOrIncompleteCount,
        boundUserId: userId,
        clearErrorMessage: true,
      );
    } on SafChannelException catch (ex) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: ex.message,
        boundUserId: userId,
      );
    } catch (_) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Não foi possível carregar os pacotes de ensaio locais.',
        boundUserId: userId,
      );
    }
  }

  /// Launches native SAF picker and runs the transactional import pipeline.
  Future<void> importFromSaf() {
    return _runOutcomeOperation(
      unauthenticatedMessage:
          'Faça login para importar pacotes de ensaio locais.',
      clearPendingConflictOnStart: true,
      action: (userId, gen) => _manager.importFromSaf(
        userId: userId,
        onProgress: (progress) {
          if (_isStale(gen, userId)) return;
          state = state.copyWith(activeProgress: progress);
        },
      ),
    );
  }

  /// Confirms replacement of an existing package after a conflict prompt.
  Future<void> confirmConflictReplace() {
    final conflict = state.pendingConflict;
    if (conflict == null) return Future<void>.value();
    return _runOutcomeOperation(
      unauthenticatedMessage: 'Faça login para substituir o pacote local.',
      clearPendingConflictOnStart: true,
      action: (userId, gen) => _manager.confirmConflictReplace(
        userId: userId,
        pendingTransactionId: conflict.pendingTransactionId,
        onProgress: (progress) {
          if (_isStale(gen, userId)) return;
          state = state.copyWith(activeProgress: progress);
        },
      ),
    );
  }

  /// Discards the pending replacement transaction while keeping the existing package.
  Future<void> cancelConflictReplace() async {
    final conflict = state.pendingConflict;
    if (conflict == null || state.isBusy) return;
    final userId = _currentUserIdReader()?.trim() ?? '';
    if (userId.isEmpty) {
      if (!mounted) return;
      state = state.copyWith(
        clearPendingConflict: true,
        lastOutcome: const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Sessão indisponível',
          message: 'Faça login para gerenciar conflitos de pacotes locais.',
          errorCode: 'UNAUTHENTICATED',
        ),
      );
      return;
    }

    final gen = ++_opGeneration;
    state = state.copyWith(
      isBusy: true,
      clearErrorMessage: true,
      boundUserId: userId,
    );

    try {
      await _manager.discardPendingConflict(
        userId: userId,
        pendingTransactionId: conflict.pendingTransactionId,
      );
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isBusy: false,
        clearPendingConflict: true,
        lastOutcome: const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.cancelled,
          title: 'Substituição cancelada',
          message:
              'O pacote existente neste aparelho foi mantido sem alterações.',
          errorCode: 'CONFLICT_CANCELLED',
        ),
        boundUserId: userId,
      );
      await _refreshLibraryAfterMutation(gen, userId);
    } on SafChannelException catch (ex) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isBusy: false,
        clearPendingConflict: true,
        errorMessage: ex.message,
        boundUserId: userId,
      );
    } catch (_) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isBusy: false,
        clearPendingConflict: true,
        errorMessage: 'Não foi possível descartar a substituição pendente.',
        boundUserId: userId,
      );
    }
  }

  /// Revalidates all on-disk files and SHA-256 digests for [packageId].
  Future<void> revalidatePackage(String packageId) {
    return _runOutcomeOperation(
      unauthenticatedMessage:
          'Faça login para revalidar pacotes de ensaio locais.',
      clearPendingConflictOnStart: false,
      action: (userId, gen) => _manager.revalidatePackage(
        userId: userId,
        packageId: packageId,
        onProgress: (progress) {
          if (_isStale(gen, userId)) return;
          state = state.copyWith(activeProgress: progress);
        },
      ),
    );
  }

  /// Updates the local custom label for [packageId] in `index.json`.
  Future<void> renamePackageLabel(String packageId, String newLabel) {
    return _runOutcomeOperation(
      unauthenticatedMessage: 'Faça login para renomear pacotes locais.',
      clearPendingConflictOnStart: false,
      action: (userId, _) => _manager.renamePackageLabel(
        userId: userId,
        packageId: packageId,
        newLabel: newLabel,
      ),
    );
  }

  /// Validates and exports [packageId] to an external SAF destination.
  Future<void> exportPackage(String packageId) {
    return _runOutcomeOperation(
      unauthenticatedMessage: 'Faça login para exportar pacotes locais.',
      clearPendingConflictOnStart: false,
      action: (userId, gen) => _manager.exportPackage(
        userId: userId,
        packageId: packageId,
        onProgress: (progress) {
          if (_isStale(gen, userId)) return;
          state = state.copyWith(activeProgress: progress);
        },
      ),
    );
  }

  /// Deletes only the app-private local copy of [packageId] after confirmation.
  Future<void> deletePackage(String packageId, {required bool confirmedScope}) {
    return _runOutcomeOperation(
      unauthenticatedMessage: 'Faça login para remover pacotes locais.',
      clearPendingConflictOnStart: false,
      action: (userId, _) => _manager.deletePackage(
        userId: userId,
        packageId: packageId,
        confirmedScope: confirmedScope,
      ),
    );
  }

  /// Requests cooperative cancellation of the currently active import/export/revalidation.
  Future<void> cancelActiveOperation() async {
    await _manager.cancelActiveOperation();
  }

  /// Dismisses the current operation outcome banner.
  void clearLastOutcome() {
    if (!mounted) return;
    state = state.copyWith(clearLastOutcome: true);
  }

  /// Invalidates in-flight callbacks/operations and resets state on session clear.
  void reset() {
    _opGeneration++;
    _manager.invalidateSession();
    if (mounted) {
      state = const RehearsalPackagesState();
    }
  }

  Future<void> _runOutcomeOperation({
    required String unauthenticatedMessage,
    required bool clearPendingConflictOnStart,
    required Future<RehearsalOperationOutcome> Function(String userId, int gen)
    action,
  }) async {
    final userId = _currentUserIdReader()?.trim() ?? '';
    if (userId.isEmpty) {
      if (!mounted) return;
      state = state.copyWith(
        lastOutcome: RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Sessão indisponível',
          message: unauthenticatedMessage,
          errorCode: 'UNAUTHENTICATED',
        ),
      );
      return;
    }
    if (state.isBusy || state.isLoading) return;

    final gen = ++_opGeneration;
    final isUserSwitch =
        state.boundUserId != null && state.boundUserId != userId;
    state = state.copyWith(
      isBusy: true,
      packages: isUserSwitch ? const [] : state.packages,
      clearStorageSummary: isUserSwitch,
      clearActiveProgress: true,
      clearLastOutcome: true,
      clearPendingConflict: clearPendingConflictOnStart || isUserSwitch,
      clearErrorMessage: true,
      boundUserId: userId,
    );

    try {
      final outcome = await action(userId, gen);
      if (_isStale(gen, userId)) return;

      state = state.copyWith(
        isBusy: false,
        clearActiveProgress: true,
        lastOutcome: outcome,
        pendingConflict: outcome.conflict,
        clearPendingConflict: outcome.conflict == null,
        boundUserId: userId,
      );

      await _refreshLibraryAfterMutation(gen, userId);
    } on SafChannelException catch (ex) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isBusy: false,
        clearActiveProgress: true,
        lastOutcome: RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Armazenamento indisponível',
          message: ex.message,
          errorCode: ex.code,
        ),
        errorMessage: ex.message,
        boundUserId: userId,
      );
    } catch (_) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isBusy: false,
        clearActiveProgress: true,
        lastOutcome: const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Falha na operação local',
          message: 'Não foi possível concluir a operação no pacote de ensaio.',
          errorCode: 'UNEXPECTED_LOCAL_FAILURE',
        ),
        boundUserId: userId,
      );
    }
  }

  Future<void> _refreshLibraryAfterMutation(int gen, String userId) async {
    try {
      final snapshot = await _manager.loadLibrary(userId: userId);
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isLoading: false,
        packages: snapshot.packages,
        storageSummary: snapshot.storageSummary,
        recoveredOrphanedCount: snapshot.recoveredOrphanedCount,
        corruptedOrIncompleteCount: snapshot.corruptedOrIncompleteCount,
        boundUserId: userId,
        clearErrorMessage: true,
      );
    } on SafChannelException catch (ex) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: ex.message,
        boundUserId: userId,
      );
    } catch (_) {
      if (_isStale(gen, userId)) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Não foi possível atualizar a biblioteca local.',
        boundUserId: userId,
      );
    }
  }
}

/// Provider for the native SAF channel adapter.
final rehearsalPackageSafPortProvider = Provider<RehearsalPackageSafPort>((
  ref,
) {
  final adapter = MethodChannelRehearsalPackageSafAdapter();
  ref.onDispose(() {
    unawaited(adapter.dispose());
  });
  return adapter;
});

/// Provider for the transactional local rehearsal package manager.
final rehearsalPackageManagerProvider = Provider<RehearsalPackageManager>((
  ref,
) {
  final safPort = ref.watch(rehearsalPackageSafPortProvider);
  return RehearsalPackageManager(safPort: safPort);
});

/// StateNotifierProvider for the local rehearsal package library screen.
final rehearsalPackagesNotifierProvider =
    StateNotifierProvider<RehearsalPackagesNotifier, RehearsalPackagesState>((
      ref,
    ) {
      final manager = ref.watch(rehearsalPackageManagerProvider);
      return RehearsalPackagesNotifier(
        manager: manager,
        currentUserIdReader: () => ref.read(authNotifierProvider).user?.id,
      );
    });

/// Overridable connectivity flag used when validating online-only bind creation.
final rehearsalOnlineCheckProvider = Provider<bool>((ref) => true);

/// Immutable state for account- and ministry-scoped local audio bindings
/// displayed on `SongDetailView`.
final class SongVersionAudioBindingsState {
  const SongVersionAudioBindingsState({
    this.isLoading = false,
    this.isMutating = false,
    this.boundUserId,
    this.ministryId,
    this.songId,
    this.bindings = const [],
    this.availablePackages = const [],
    this.errorMessage,
    this.lastOutcome,
  });

  final bool isLoading;
  final bool isMutating;
  final String? boundUserId;
  final String? ministryId;
  final String? songId;
  final List<LocalSongVersionAudioBinding> bindings;
  final List<LocalRehearsalPackageRecord> availablePackages;
  final String? errorMessage;
  final RehearsalOperationOutcome? lastOutcome;

  List<LocalRehearsalPackageRecord> get verifiedPackages => availablePackages
      .where((p) => p.isReadyForLocalUse)
      .toList(growable: false);

  LocalSongVersionAudioBinding? bindingForVersion(String? canonicalVersionId) {
    final target = canonicalVersionId?.trim();
    if (target == null || target.isEmpty) return null;
    for (final b in bindings) {
      if (b.canonicalVersionId == target) return b;
    }
    return null;
  }

  SongVersionAudioBindingsState copyWith({
    bool? isLoading,
    bool? isMutating,
    String? boundUserId,
    bool clearBoundUserId = false,
    String? ministryId,
    bool clearMinistryId = false,
    String? songId,
    bool clearSongId = false,
    List<LocalSongVersionAudioBinding>? bindings,
    List<LocalRehearsalPackageRecord>? availablePackages,
    String? errorMessage,
    bool clearErrorMessage = false,
    RehearsalOperationOutcome? lastOutcome,
    bool clearLastOutcome = false,
  }) {
    return SongVersionAudioBindingsState(
      isLoading: isLoading ?? this.isLoading,
      isMutating: isMutating ?? this.isMutating,
      boundUserId: clearBoundUserId ? null : (boundUserId ?? this.boundUserId),
      ministryId: clearMinistryId ? null : (ministryId ?? this.ministryId),
      songId: clearSongId ? null : (songId ?? this.songId),
      bindings: bindings ?? this.bindings,
      availablePackages: availablePackages ?? this.availablePackages,
      errorMessage: clearErrorMessage
          ? null
          : (errorMessage ?? this.errorMessage),
      lastOutcome: clearLastOutcome ? null : (lastOutcome ?? this.lastOutcome),
    );
  }
}

/// Manages account- and ministry-scoped local audio bindings for `SongDetailView`,
/// discarding stale async responses across user, ministry, or song switches.
class SongVersionAudioBindingsNotifier
    extends StateNotifier<SongVersionAudioBindingsState> {
  SongVersionAudioBindingsNotifier({
    required RehearsalPackageManager manager,
    required String? Function() currentUserIdReader,
    required bool Function() onlineReader,
  }) : _manager = manager,
       _currentUserIdReader = currentUserIdReader,
       _onlineReader = onlineReader,
       super(const SongVersionAudioBindingsState());

  final RehearsalPackageManager _manager;
  final String? Function() _currentUserIdReader;
  final bool Function() _onlineReader;
  int _opGeneration = 0;
  Object? _activeMutation;

  bool _isStale(
    int gen,
    String userId, {
    required String ministryId,
    required String songId,
  }) {
    return !mounted ||
        gen != _opGeneration ||
        (_currentUserIdReader()?.trim() ?? '') != userId ||
        state.ministryId != ministryId ||
        state.songId != songId;
  }

  /// Reconciles and loads local bindings for `(ministryId, song)` inside the
  /// active user's account namespace.
  Future<void> loadAndReconcileForSong({
    required String ministryId,
    required SongDetail song,
    bool silent = false,
  }) async {
    final userId = _currentUserIdReader()?.trim() ?? '';
    final normalizedMinistry = ministryId.trim();
    final normalizedSongId = song.id.trim();

    if (userId.isEmpty ||
        normalizedMinistry.isEmpty ||
        normalizedSongId.isEmpty) {
      if (!mounted) return;
      _opGeneration++;
      _activeMutation = null;
      state = const SongVersionAudioBindingsState();
      return;
    }

    final gen = ++_opGeneration;
    final contextChanged =
        state.boundUserId != userId ||
        state.ministryId != normalizedMinistry ||
        state.songId != normalizedSongId;

    if (contextChanged) _activeMutation = null;
    state = state.copyWith(
      isMutating: contextChanged ? false : state.isMutating,
      isLoading: contextChanged || !silent,
      boundUserId: userId,
      ministryId: normalizedMinistry,
      songId: normalizedSongId,
      bindings: contextChanged ? const [] : state.bindings,
      availablePackages: state.boundUserId != userId
          ? const []
          : state.availablePackages,
      clearErrorMessage: true,
      clearLastOutcome: contextChanged,
    );

    try {
      final reconciled = await _manager.reconcileSongVersionBindings(
        userId: userId,
        ministryId: normalizedMinistry,
        song: song,
      );
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return;
      }

      final snapshot = await _manager.loadLibrary(userId: userId);
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return;
      }

      state = state.copyWith(
        isLoading: false,
        boundUserId: userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
        bindings: reconciled,
        availablePackages: snapshot.packages,
        clearErrorMessage: true,
      );
    } on MissingPluginException {
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        bindings: const [],
        availablePackages: const [],
        clearErrorMessage: true,
      );
    } on SafChannelException catch (ex) {
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return;
      }
      state = state.copyWith(isLoading: false, errorMessage: ex.message);
    } catch (_) {
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Não foi possível verificar vínculos de áudio locais.',
      );
    }
  }

  /// Refreshes the list of local packages available in the active account.
  Future<List<LocalRehearsalPackageRecord>> loadAvailablePackages() async {
    final userId = _currentUserIdReader()?.trim() ?? '';
    if (userId.isEmpty) {
      return const <LocalRehearsalPackageRecord>[];
    }
    final gen = _opGeneration;
    try {
      final snapshot = await _manager.loadLibrary(userId: userId);
      if (!mounted ||
          gen != _opGeneration ||
          (_currentUserIdReader()?.trim() ?? '') != userId) {
        return const <LocalRehearsalPackageRecord>[];
      }
      state = state.copyWith(
        boundUserId: userId,
        availablePackages: snapshot.packages,
      );
      return snapshot.packages;
    } on MissingPluginException {
      return const <LocalRehearsalPackageRecord>[];
    } catch (_) {
      if (!mounted ||
          gen != _opGeneration ||
          (_currentUserIdReader()?.trim() ?? '') != userId) {
        return const <LocalRehearsalPackageRecord>[];
      }
      return state.availablePackages;
    }
  }

  /// Binds a verified local package to a canonical version of [song].
  Future<RehearsalOperationOutcome> bindPackage({
    required String ministryId,
    required SongDetail song,
    String? requestedVersionId,
    required String packageId,
    required bool songReadVerified,
    bool? isOnline,
  }) async {
    final userId = _currentUserIdReader()?.trim() ?? '';
    if (userId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para vincular pacotes de ensaio locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }
    if (state.isMutating) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Operação em andamento',
        message: 'Aguarde a conclusão da operação atual.',
        errorCode: 'OPERATION_IN_PROGRESS',
      );
    }

    final normalizedMinistry = ministryId.trim();
    final normalizedSongId = song.id.trim();
    final gen = ++_opGeneration;
    final mutation = Object();
    _activeMutation = mutation;

    state = state.copyWith(
      isMutating: true,
      boundUserId: userId,
      ministryId: normalizedMinistry,
      songId: normalizedSongId,
      clearErrorMessage: true,
      clearLastOutcome: true,
    );

    try {
      final outcome = await _manager.bindSongVersion(
        userId: userId,
        ministryId: normalizedMinistry,
        song: song,
        requestedVersionId: requestedVersionId,
        packageId: packageId,
        songReadVerified: songReadVerified,
        isOnline: isOnline ?? _onlineReader(),
      );
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return outcome;
      }

      final reconciled = await _manager.reconcileSongVersionBindings(
        userId: userId,
        ministryId: normalizedMinistry,
        song: song,
      );
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return outcome;
      }
      final snapshot = await _manager.loadLibrary(userId: userId);
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return outcome;
      }

      state = state.copyWith(
        isMutating: false,
        bindings: reconciled,
        availablePackages: snapshot.packages,
        lastOutcome: outcome,
      );
      return outcome;
    } on SafChannelException catch (ex) {
      if (!_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        state = state.copyWith(isMutating: false, errorMessage: ex.message);
      }
      return RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Armazenamento indisponível',
        message: ex.message,
        errorCode: ex.code,
      );
    } catch (_) {
      if (!_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        state = state.copyWith(
          isMutating: false,
          errorMessage: 'Não foi possível vincular o pacote local.',
        );
      }
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Falha ao vincular',
        message: 'Não foi possível salvar o vínculo local.',
        errorCode: 'BIND_FAILED',
      );
    } finally {
      // A reload can supersede response generation while this mutation still
      // owns busy. A newer mutation/context must never be cleared by this one.
      if (mounted && identical(_activeMutation, mutation)) {
        _activeMutation = null;
        state = state.copyWith(isMutating: false);
      }
    }
  }

  /// Unbinds the local package from [canonicalVersionId] without deleting it.
  Future<RehearsalOperationOutcome> unbindVersion({
    required String ministryId,
    required SongDetail song,
    required String canonicalVersionId,
  }) async {
    final userId = _currentUserIdReader()?.trim() ?? '';
    if (userId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para desvincular áudios locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }
    if (state.isMutating) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Operação em andamento',
        message: 'Aguarde a conclusão da operação atual.',
        errorCode: 'OPERATION_IN_PROGRESS',
      );
    }

    final normalizedMinistry = ministryId.trim();
    final normalizedSongId = song.id.trim();
    final gen = ++_opGeneration;
    final mutation = Object();
    _activeMutation = mutation;

    state = state.copyWith(
      isMutating: true,
      boundUserId: userId,
      ministryId: normalizedMinistry,
      songId: normalizedSongId,
      clearErrorMessage: true,
      clearLastOutcome: true,
    );

    try {
      final outcome = await _manager.unbindSongVersion(
        userId: userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
        canonicalVersionId: canonicalVersionId,
      );
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return outcome;
      }

      final reconciled = await _manager.reconcileSongVersionBindings(
        userId: userId,
        ministryId: normalizedMinistry,
        song: song,
      );
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return outcome;
      }
      final snapshot = await _manager.loadLibrary(userId: userId);
      if (_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        return outcome;
      }

      state = state.copyWith(
        isMutating: false,
        bindings: reconciled,
        availablePackages: snapshot.packages,
        lastOutcome: outcome,
      );
      return outcome;
    } catch (_) {
      if (!_isStale(
        gen,
        userId,
        ministryId: normalizedMinistry,
        songId: normalizedSongId,
      )) {
        state = state.copyWith(
          isMutating: false,
          errorMessage: 'Não foi possível desvincular o pacote local.',
        );
      }
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Falha ao desvincular',
        message: 'Não foi possível remover o vínculo local.',
        errorCode: 'UNBIND_FAILED',
      );
    } finally {
      // A reload can supersede response generation while this mutation still
      // owns busy. A newer mutation/context must never be cleared by this one.
      if (mounted && identical(_activeMutation, mutation)) {
        _activeMutation = null;
        state = state.copyWith(isMutating: false);
      }
    }
  }

  /// Clears all in-memory binding state on logout or user switch.
  void reset() {
    _opGeneration++;
    _activeMutation = null;
    if (mounted) {
      state = const SongVersionAudioBindingsState();
    }
  }
}

/// StateNotifierProvider for account + ministry-scoped local audio bindings
/// inside `SongDetailView`.
final songVersionAudioBindingsNotifierProvider =
    StateNotifierProvider<
      SongVersionAudioBindingsNotifier,
      SongVersionAudioBindingsState
    >((ref) {
      final manager = ref.watch(rehearsalPackageManagerProvider);
      return SongVersionAudioBindingsNotifier(
        manager: manager,
        currentUserIdReader: () => ref.read(authNotifierProvider).user?.id,
        onlineReader: () => ref.read(rehearsalOnlineCheckProvider),
      );
    });
