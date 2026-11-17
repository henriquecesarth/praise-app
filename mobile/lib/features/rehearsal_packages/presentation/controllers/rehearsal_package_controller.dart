import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
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
  Future<void> deletePackage(
    String packageId, {
    required bool confirmedScope,
  }) {
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
    required Future<RehearsalOperationOutcome> Function(
      String userId,
      int gen,
    ) action,
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
