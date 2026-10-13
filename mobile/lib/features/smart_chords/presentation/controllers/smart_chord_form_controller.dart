import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../domain/smart_chord.dart';

enum MutationOutcome {
  success,
  failure,
  discarded,
}

@immutable
class MutationResult<T> {
  final MutationOutcome outcome;
  final T? data;
  final String? errorMessage;

  const MutationResult._({
    required this.outcome,
    this.data,
    this.errorMessage,
  });

  const MutationResult.success([T? data])
      : this._(outcome: MutationOutcome.success, data: data);

  const MutationResult.failure([String? errorMessage])
      : this._(outcome: MutationOutcome.failure, errorMessage: errorMessage);

  const MutationResult.discarded()
      : this._(outcome: MutationOutcome.discarded);

  bool get isSuccess => outcome == MutationOutcome.success;
  bool get isFailure => outcome == MutationOutcome.failure;
  bool get isDiscarded => outcome == MutationOutcome.discarded;
}

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
  String? _boundUserId;

  SmartChordFormNotifier({
    required SmartChordRepository repository,
    String? boundUserId,
  })  : _repository = repository,
        _boundUserId = boundUserId,
        super(const SmartChordFormState());

  int get currentGeneration => _currentGeneration;

  void bindUser(String? userId) {
    _boundUserId = userId;
  }

  Future<MutationResult<SmartChord>> createSmartChord(
    SmartChord chord, {
    String? userId,
  }) async {
    if (state.isSubmitting) return const MutationResult.discarded(); // Double-submit guard
    final requestGeneration = _currentGeneration;
    final expectedUserId = userId ?? _boundUserId;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      final payload = chord.toRequestPayload();
      final created = await _repository.createSmartChord(payload);
      if (requestGeneration != _currentGeneration ||
          (expectedUserId != null && _boundUserId != null && expectedUserId != _boundUserId)) {
        return const MutationResult.discarded();
      }

      state = state.copyWith(isSubmitting: false, isSuccess: true, clearError: true);
      return MutationResult.success(created);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          (expectedUserId != null && _boundUserId != null && expectedUserId != _boundUserId)) {
        return const MutationResult.discarded();
      }
      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  Future<MutationResult<SmartChord>> updateSmartChord(
    String id,
    SmartChord chord, {
    String? userId,
  }) async {
    if (state.isSubmitting) return const MutationResult.discarded(); // Double-submit guard
    final requestGeneration = _currentGeneration;
    final expectedUserId = userId ?? _boundUserId;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      final payload = chord.toRequestPayload();
      final updated = await _repository.updateSmartChord(id, payload);
      if (requestGeneration != _currentGeneration ||
          (expectedUserId != null && _boundUserId != null && expectedUserId != _boundUserId)) {
        return const MutationResult.discarded();
      }

      state = state.copyWith(isSubmitting: false, isSuccess: true, clearError: true);
      return MutationResult.success(updated);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          (expectedUserId != null && _boundUserId != null && expectedUserId != _boundUserId)) {
        return const MutationResult.discarded();
      }
      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  Future<MutationResult<void>> deleteSmartChord(
    String id, {
    String? userId,
  }) async {
    if (state.isSubmitting) return const MutationResult.discarded();
    final requestGeneration = _currentGeneration;
    final expectedUserId = userId ?? _boundUserId;
    state = state.copyWith(isSubmitting: true, clearError: true, isSuccess: false);

    try {
      await _repository.deleteSmartChord(id);
      if (requestGeneration != _currentGeneration ||
          (expectedUserId != null && _boundUserId != null && expectedUserId != _boundUserId)) {
        return const MutationResult.discarded();
      }

      state = state.copyWith(isSubmitting: false, isSuccess: true, clearError: true);
      return const MutationResult.success();
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          (expectedUserId != null && _boundUserId != null && expectedUserId != _boundUserId)) {
        return const MutationResult.discarded();
      }
      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  void reset({String? newUserId}) {
    _currentGeneration++;
    _boundUserId = newUserId;
    state = const SmartChordFormState();
  }
}
