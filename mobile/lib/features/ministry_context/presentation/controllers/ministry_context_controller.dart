import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/storage/preferences_storage.dart';
import '../../data/ministry_repository.dart';
import '../../domain/ministry.dart';

/// Conceptual bootstrap states for ministry context.
enum MinistryBootstrapStatus {
  initializing,
  loading,
  ready,
  needsSelection,
  empty,
  error,
}

/// State representation of the user''s ministry membership context.
class MinistryContextState {
  final MinistryBootstrapStatus status;
  final List<Ministry> availableMinistries;
  final Ministry? selectedMinistry;
  final AppFailure? failure;

  const MinistryContextState({
    required this.status,
    this.availableMinistries = const [],
    this.selectedMinistry,
    this.failure,
  });

  const MinistryContextState.initial()
      : status = MinistryBootstrapStatus.initializing,
        availableMinistries = const [],
        selectedMinistry = null,
        failure = null;

  bool get isInitializing => status == MinistryBootstrapStatus.initializing;
  bool get isLoading => status == MinistryBootstrapStatus.loading;
  bool get isReady => status == MinistryBootstrapStatus.ready;
  bool get needsSelection => status == MinistryBootstrapStatus.needsSelection;
  bool get isEmpty => status == MinistryBootstrapStatus.empty;
  bool get hasError => status == MinistryBootstrapStatus.error;

  MinistryContextState copyWith({
    MinistryBootstrapStatus? status,
    List<Ministry>? availableMinistries,
    Ministry? selectedMinistry,
    bool clearSelectedMinistry = false,
    AppFailure? failure,
    bool clearFailure = false,
  }) {
    return MinistryContextState(
      status: status ?? this.status,
      availableMinistries: availableMinistries ?? this.availableMinistries,
      selectedMinistry: clearSelectedMinistry
          ? null
          : (selectedMinistry ?? this.selectedMinistry),
      failure: clearFailure ? null : (failure ?? this.failure),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MinistryContextState &&
          runtimeType == other.runtimeType &&
          status == other.status &&
          selectedMinistry == other.selectedMinistry &&
          failure == other.failure &&
          availableMinistries.length == other.availableMinistries.length;

  @override
  int get hashCode =>
      status.hashCode ^
      selectedMinistry.hashCode ^
      failure.hashCode ^
      availableMinistries.length.hashCode;
}

/// Controller managing the ministry context lifecycle and non-authoritative selection.
class MinistryContextNotifier extends StateNotifier<MinistryContextState> {
  final MinistryRepository _repository;
  final PreferencesStorage _preferencesStorage;
  int _contextGeneration = 0;

  MinistryContextNotifier({
    required MinistryRepository repository,
    required PreferencesStorage preferencesStorage,
  })  : _repository = repository,
        _preferencesStorage = preferencesStorage,
        super(const MinistryContextState.initial());

  /// Bootstraps ministry context for the currently authenticated user.
  ///
  /// Algorithm:
  /// 1. Fetch fresh canonical memberships from backend: GET /api/v1/ministries/my-ministries
  /// 2. If 0 ministries: transition to [MinistryBootstrapStatus.empty], clear stored preference.
  /// 3. If 1 ministry: auto-select, persist preference, transition to [MinistryBootstrapStatus.ready].
  /// 4. If >1 ministries: check if stored preference exists in fresh list.
  ///    - If found: select it, transition to [MinistryBootstrapStatus.ready].
  ///    - If not found or stale: discard preference, transition to [MinistryBootstrapStatus.needsSelection].
  Future<void> bootstrap() async {
    final requestGen = ++_contextGeneration;
    state = state.copyWith(
      status: MinistryBootstrapStatus.loading,
      clearFailure: true,
    );

    try {
      final ministries = await _repository.getMyMinistries();
      if (requestGen != _contextGeneration) return;
      _resolveMinistries(ministries);
    } on AppFailure catch (e) {
      if (requestGen != _contextGeneration) return;
      state = state.copyWith(
        status: MinistryBootstrapStatus.error,
        failure: e,
      );
    } catch (e) {
      if (requestGen != _contextGeneration) return;
      state = state.copyWith(
        status: MinistryBootstrapStatus.error,
        failure: AppFailure(
          message: 'Não foi possível carregar os ministérios. Tente novamente.',
          details: {'raw': e.toString()},
        ),
      );
    }
  }

  /// Refreshes memberships from backend, validating existing context selection.
  Future<void> refresh() async {
    final requestGen = ++_contextGeneration;
    final currentSelectedId = state.selectedMinistry?.id;

    try {
      final ministries = await _repository.getMyMinistries();
      if (requestGen != _contextGeneration) return;

      if (ministries.isEmpty) {
        await _preferencesStorage.setSelectedMinistryId(null);
        if (requestGen != _contextGeneration) return;
        state = const MinistryContextState(
          status: MinistryBootstrapStatus.empty,
          availableMinistries: [],
          selectedMinistry: null,
        );
        return;
      }

      // Check if previously selected ministry is still in the fresh list
      Ministry? stillSelected;
      if (currentSelectedId != null) {
        for (final m in ministries) {
          if (m.id == currentSelectedId) {
            stillSelected = m;
            break;
          }
        }
      }

      if (stillSelected != null) {
        // Retain selection with updated data
        await _preferencesStorage.setSelectedMinistryId(stillSelected.id);
        if (requestGen != _contextGeneration) return;
        state = MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          availableMinistries: ministries,
          selectedMinistry: stillSelected,
        );
      } else {
        // Selection was removed or invalid; re-resolve
        await _preferencesStorage.setSelectedMinistryId(null);
        if (requestGen != _contextGeneration) return;
        _resolveMinistries(ministries);
      }
    } on AppFailure catch (e) {
      if (requestGen != _contextGeneration) return;
      state = state.copyWith(
        status: MinistryBootstrapStatus.error,
        failure: e,
      );
    } catch (e) {
      if (requestGen != _contextGeneration) return;
      state = state.copyWith(
        status: MinistryBootstrapStatus.error,
        failure: AppFailure(
          message: 'Não foi possível atualizar os ministérios.',
          details: {'raw': e.toString()},
        ),
      );
    }
  }

  /// Authoritatively refreshes memberships and selects the specified [targetMinistryId].
  ///
  /// Fenced against stale responses if reset() is invoked or if session context changes.
  /// Throws typed [AppFailure] if the target ministry is not found in the fresh list.
  Future<Ministry> refreshAndSelect(
    String targetMinistryId, {
    String? expectedUserId,
  }) async {
    final requestGen = ++_contextGeneration;

    try {
      final ministries = await _repository.getMyMinistries();

      // Generation fencing: verify context generation has not been reset
      if (requestGen != _contextGeneration) {
        throw const AppFailure(
          message: 'Operação cancelada: contexto de sessão foi alterado.',
          code: 'SESSION_CHANGED',
        );
      }

      Ministry? matched;
      for (final m in ministries) {
        if (m.id == targetMinistryId) {
          matched = m;
          break;
        }
      }

      if (matched == null) {
        // Fail-safe: do not silently select another ministry or leave stale state
        throw const AppFailure(
          message:
              'O ministério alvo não foi encontrado na lista de ministérios.',
          statusCode: 404,
          code: 'TARGET_MINISTRY_MISSING',
        );
      }

      await _preferencesStorage.setSelectedMinistryId(matched.id);

      // Re-verify fencing after preferences await
      if (requestGen != _contextGeneration) {
        throw const AppFailure(
          message: 'Operação cancelada: contexto de sessão foi alterado.',
          code: 'SESSION_CHANGED',
        );
      }

      state = MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: ministries,
        selectedMinistry: matched,
        failure: null,
      );

      return matched;
    } catch (e) {
      // Only record failure in state if generation still matches
      if (requestGen == _contextGeneration) {
        final failure = e is AppFailure
            ? e
            : AppFailure(
                message: 'Falha ao atualizar o contexto do ministério.',
                details: {'raw': e.toString()},
              );
        state = state.copyWith(
          failure: failure,
        );
      }
      rethrow;
    }
  }

  /// Selects a ministry context from the current available list.
  ///
  /// Persists the non-authoritative preference and transitions state to ready.
  Future<void> selectMinistry(Ministry ministry) async {
    final exists = state.availableMinistries.any((m) => m.id == ministry.id);
    if (!exists) {
      // Must not select a ministry not present in authoritative backend list
      return;
    }

    await _preferencesStorage.setSelectedMinistryId(ministry.id);
    state = state.copyWith(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: ministry,
      clearFailure: true,
    );
  }

  /// Resets state and clears stored preference (called on logout or user switch).
  Future<void> reset() async {
    _contextGeneration++;
    await _preferencesStorage.setSelectedMinistryId(null);
    if (!mounted) return;
    state = const MinistryContextState.initial();
  }

  void _resolveMinistries(List<Ministry> ministries) {
    if (ministries.isEmpty) {
      _preferencesStorage.setSelectedMinistryId(null);
      state = const MinistryContextState(
        status: MinistryBootstrapStatus.empty,
        availableMinistries: [],
        selectedMinistry: null,
      );
      return;
    }

    if (ministries.length == 1) {
      final single = ministries.first;
      _preferencesStorage.setSelectedMinistryId(single.id);
      state = MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: ministries,
        selectedMinistry: single,
      );
      return;
    }

    // Multiple ministries: check saved preference
    final savedId = _preferencesStorage.getSelectedMinistryId();
    Ministry? matched;
    if (savedId != null) {
      for (final m in ministries) {
        if (m.id == savedId) {
          matched = m;
          break;
        }
      }
    }

    if (matched != null) {
      state = MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: ministries,
        selectedMinistry: matched,
      );
    } else {
      // Discard stale or missing preference
      _preferencesStorage.setSelectedMinistryId(null);
      state = MinistryContextState(
        status: MinistryBootstrapStatus.needsSelection,
        availableMinistries: ministries,
        selectedMinistry: null,
      );
    }
  }
}
