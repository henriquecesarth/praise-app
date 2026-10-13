import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../domain/smart_chord.dart';

@immutable
class SmartChordFormState {
  final bool isSubmitting;
  final String? errorMessage;
  final bool isSuccess;

  const SmartChordFormState({
    this.isSubmitting = false,
    this.errorMessage,
    this.isSuccess = false,
  });

  SmartChordFormState copyWith({
    bool? isSubmitting,
    String? errorMessage,
    bool clearError = false,
    bool? isSuccess,
  }) {
    return SmartChordFormState(
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isSuccess: isSuccess ?? this.isSuccess,
    );
  }
}

class SmartChordFormNotifier extends StateNotifier<SmartChordFormState> {
  final SmartChordRepository _repository;
  int _currentGeneration = 0;

  SmartChordFormNotifier({required SmartChordRepository repository})
      : _repository = repository,
        super(const SmartChordFormState());

  Future<SmartChord?> createSmartChord(SmartChord chord) async {
    if (state.isSubmitting) return null; // Double-submit guard
    final requestGeneration = _currentGeneration;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      final payload = chord.toRequestPayload();
      final created = await _repository.createSmartChord(payload);
      if (requestGeneration != _currentGeneration) return null;

      state = state.copyWith(isSubmitting: false, isSuccess: true, clearError: true);
      return created;
    } catch (e) {
      if (requestGeneration != _currentGeneration) return null;
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return null;
    }
  }

  Future<SmartChord?> updateSmartChord(String id, SmartChord chord) async {
    if (state.isSubmitting) return null; // Double-submit guard
    final requestGeneration = _currentGeneration;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      final payload = chord.toRequestPayload();
      final updated = await _repository.updateSmartChord(id, payload);
      if (requestGeneration != _currentGeneration) return null;

      state = state.copyWith(isSubmitting: false, isSuccess: true, clearError: true);
      return updated;
    } catch (e) {
      if (requestGeneration != _currentGeneration) return null;
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return null;
    }
  }

  Future<bool> deleteSmartChord(String id) async {
    if (state.isSubmitting) return false;
    final requestGeneration = _currentGeneration;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      await _repository.deleteSmartChord(id);
      if (requestGeneration != _currentGeneration) return false;

      state = state.copyWith(isSubmitting: false, isSuccess: true, clearError: true);
      return true;
    } catch (e) {
      if (requestGeneration != _currentGeneration) return false;
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return false;
    }
  }

  void reset() {
    _currentGeneration++;
    state = const SmartChordFormState();
  }
}
