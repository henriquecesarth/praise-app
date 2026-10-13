import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/liturgy_repository.dart';
import '../../domain/liturgy.dart';

@immutable
class LiturgyFormState {
  final bool isSubmitting;
  final String? errorMessage;
  final bool isSuccess;

  const LiturgyFormState({
    this.isSubmitting = false,
    this.errorMessage,
    this.isSuccess = false,
  });

  LiturgyFormState copyWith({
    bool? isSubmitting,
    String? errorMessage,
    bool clearError = false,
    bool? isSuccess,
  }) {
    return LiturgyFormState(
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isSuccess: isSuccess ?? this.isSuccess,
    );
  }
}

class LiturgyFormNotifier extends StateNotifier<LiturgyFormState> {
  final LiturgyRepository _repository;
  int _currentGeneration = 0;
  String? _boundMinistryId;

  LiturgyFormNotifier({required LiturgyRepository repository})
      : _repository = repository,
        super(const LiturgyFormState());

  int get currentGeneration => _currentGeneration;

  Future<Liturgy?> createLiturgy(
    String ministryId, {
    required String title,
    required String date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    if (state.isSubmitting) return null; // Double-submit guard
    final requestGeneration = _currentGeneration;
    _boundMinistryId = ministryId;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      final created = await _repository.createLiturgy(
        ministryId,
        title: title,
        date: date,
        description: description,
        items: items,
      );
      if (requestGeneration != _currentGeneration || _boundMinistryId != ministryId) {
        return null; // Stale mutation discarded
      }
      state = state.copyWith(isSubmitting: false, isSuccess: true);
      return created;
    } catch (e) {
      if (requestGeneration != _currentGeneration || _boundMinistryId != ministryId) {
        return null; // Stale mutation discarded
      }
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return null;
    }
  }

  Future<Liturgy?> updateLiturgy(
    String ministryId,
    String liturgyId, {
    String? title,
    String? date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    if (state.isSubmitting) return null; // Double-submit guard
    final requestGeneration = _currentGeneration;
    _boundMinistryId = ministryId;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      final updated = await _repository.updateLiturgy(
        ministryId,
        liturgyId,
        title: title,
        date: date,
        description: description,
        items: items,
      );
      if (requestGeneration != _currentGeneration || _boundMinistryId != ministryId) {
        return null; // Stale mutation discarded
      }
      state = state.copyWith(isSubmitting: false, isSuccess: true);
      return updated;
    } catch (e) {
      if (requestGeneration != _currentGeneration || _boundMinistryId != ministryId) {
        return null; // Stale mutation discarded
      }
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return null;
    }
  }

  Future<bool> deleteLiturgy(String ministryId, String liturgyId) async {
    if (state.isSubmitting) return false; // Double-submit guard
    final requestGeneration = _currentGeneration;
    _boundMinistryId = ministryId;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      await _repository.deleteLiturgy(ministryId, liturgyId);
      if (requestGeneration != _currentGeneration || _boundMinistryId != ministryId) {
        return false; // Stale mutation discarded
      }
      state = state.copyWith(isSubmitting: false, isSuccess: true);
      return true;
    } catch (e) {
      if (requestGeneration != _currentGeneration || _boundMinistryId != ministryId) {
        return false; // Stale mutation discarded
      }
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return false;
    }
  }

  void invalidateTenant() {
    _currentGeneration++;
    _boundMinistryId = null;
    state = const LiturgyFormState();
  }

  void reset() {
    _currentGeneration++;
    _boundMinistryId = null;
    state = const LiturgyFormState();
  }
}
