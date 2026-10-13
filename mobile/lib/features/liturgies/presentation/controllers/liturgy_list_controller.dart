import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/liturgy_repository.dart';
import '../../domain/liturgy.dart';

@immutable
class LiturgyListState {
  final String? ministryId;
  final bool isLoading;
  final List<Liturgy> liturgies;
  final String? errorMessage;
  final int generation;

  const LiturgyListState({
    this.ministryId,
    this.isLoading = false,
    this.liturgies = const [],
    this.errorMessage,
    this.generation = 0,
  });

  bool get isEmpty => !isLoading && errorMessage == null && liturgies.isEmpty;
  bool get hasError => errorMessage != null;
  bool get isSuccess => !isLoading && errorMessage == null && liturgies.isNotEmpty;

  LiturgyListState copyWith({
    String? ministryId,
    bool? isLoading,
    List<Liturgy>? liturgies,
    String? errorMessage,
    bool clearError = false,
    int? generation,
  }) {
    return LiturgyListState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      liturgies: liturgies ?? this.liturgies,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      generation: generation ?? this.generation,
    );
  }
}

class LiturgyListNotifier extends StateNotifier<LiturgyListState> {
  final LiturgyRepository _repository;
  int _currentGeneration = 0;

  LiturgyListNotifier({required LiturgyRepository repository})
      : _repository = repository,
        super(const LiturgyListState());

  Future<void> load(String ministryId, {bool force = false}) async {
    if (!force && state.ministryId == ministryId && state.liturgies.isNotEmpty && !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      ministryId: ministryId,
      isLoading: true,
      clearError: true,
      generation: generation,
    );

    try {
      final list = await _repository.listLiturgies(ministryId);
      if (generation != _currentGeneration) return; // Stale response fence

      state = state.copyWith(
        isLoading: false,
        liturgies: list,
        clearError: true,
      );
    } catch (e) {
      if (generation != _currentGeneration) return; // Stale response fence
      state = state.copyWith(
        isLoading: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
    }
  }

  Future<void> refresh(String ministryId) async {
    await load(ministryId, force: true);
  }

  Future<void> loadLiturgies(String ministryId, {bool refresh = false}) async {
    await load(ministryId, force: refresh);
  }

  void reset() {
    _currentGeneration++;
    state = const LiturgyListState();
  }
}
