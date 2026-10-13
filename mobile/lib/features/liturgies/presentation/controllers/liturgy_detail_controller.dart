import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/liturgy_repository.dart';
import '../../domain/liturgy.dart';

@immutable
class LiturgyDetailState {
  final String? ministryId;
  final String? liturgyId;
  final bool isLoading;
  final Liturgy? liturgy;
  final String? errorMessage;
  final bool isNotFound;
  final bool isUnauthorized;
  final int generation;

  const LiturgyDetailState({
    this.ministryId,
    this.liturgyId,
    this.isLoading = false,
    this.liturgy,
    this.errorMessage,
    this.isNotFound = false,
    this.isUnauthorized = false,
    this.generation = 0,
  });

  LiturgyDetailState copyWith({
    String? ministryId,
    String? liturgyId,
    bool? isLoading,
    Liturgy? liturgy,
    String? errorMessage,
    bool clearError = false,
    bool? isNotFound,
    bool? isUnauthorized,
    int? generation,
  }) {
    return LiturgyDetailState(
      ministryId: ministryId ?? this.ministryId,
      liturgyId: liturgyId ?? this.liturgyId,
      isLoading: isLoading ?? this.isLoading,
      liturgy: liturgy ?? this.liturgy,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isNotFound: isNotFound ?? this.isNotFound,
      isUnauthorized: isUnauthorized ?? this.isUnauthorized,
      generation: generation ?? this.generation,
    );
  }
}

class LiturgyDetailNotifier extends StateNotifier<LiturgyDetailState> {
  final LiturgyRepository _repository;
  int _currentGeneration = 0;

  LiturgyDetailNotifier({required LiturgyRepository repository})
      : _repository = repository,
        super(const LiturgyDetailState());

  Future<void> load(String ministryId, String liturgyId, {bool force = false}) async {
    if (!force &&
        state.ministryId == ministryId &&
        state.liturgyId == liturgyId &&
        state.liturgy != null &&
        !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      ministryId: ministryId,
      liturgyId: liturgyId,
      isLoading: true,
      clearError: true,
      isNotFound: false,
      isUnauthorized: false,
      generation: generation,
    );

    try {
      final liturgy = await _repository.getLiturgyById(ministryId, liturgyId);
      if (generation != _currentGeneration) return; // Stale response fence

      state = state.copyWith(
        isLoading: false,
        liturgy: liturgy,
        clearError: true,
      );
    } catch (e) {
      if (generation != _currentGeneration) return; // Stale response fence
      final isNotFound = e is AppFailure && e.statusCode == 404;
      final isUnauthorized = e is AppFailure && e.statusCode == 403;
      state = state.copyWith(
        isLoading: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
        isNotFound: isNotFound,
        isUnauthorized: isUnauthorized,
      );
    }
  }

  Future<void> loadLiturgy(String ministryId, String liturgyId, {bool refresh = false}) async {
    await load(ministryId, liturgyId, force: refresh);
  }

  void invalidateTenant() {
    _currentGeneration++;
    state = const LiturgyDetailState();
  }

  void reset() {
    _currentGeneration++;
    state = const LiturgyDetailState();
  }
}
