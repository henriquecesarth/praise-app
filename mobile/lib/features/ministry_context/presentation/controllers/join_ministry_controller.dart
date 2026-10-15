import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/ministry_repository.dart';
import '../../domain/ministry.dart';
import '../../domain/ministry_onboarding.dart';
import 'ministry_context_controller.dart';

@immutable
class JoinMinistryState {
  final bool isSubmitting;
  final bool isSuccess;
  final bool isRefreshFailure;
  final Ministry? joinedMinistry;
  final String? successMessage;
  final String? errorMessage;

  const JoinMinistryState({
    this.isSubmitting = false,
    this.isSuccess = false,
    this.isRefreshFailure = false,
    this.joinedMinistry,
    this.successMessage,
    this.errorMessage,
  });

  JoinMinistryState copyWith({
    bool? isSubmitting,
    bool? isSuccess,
    bool? isRefreshFailure,
    Ministry? joinedMinistry,
    String? successMessage,
    String? errorMessage,
    bool clearError = false,
  }) {
    return JoinMinistryState(
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isSuccess: isSuccess ?? this.isSuccess,
      isRefreshFailure: isRefreshFailure ?? this.isRefreshFailure,
      joinedMinistry: joinedMinistry ?? this.joinedMinistry,
      successMessage: successMessage ?? this.successMessage,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

class JoinMinistryNotifier extends StateNotifier<JoinMinistryState> {
  final MinistryRepository _repository;
  final MinistryContextNotifier _contextNotifier;
  int _currentGeneration = 0;
  String? _boundUserId;

  JoinMinistryNotifier({
    required MinistryRepository repository,
    required MinistryContextNotifier contextNotifier,
    String? boundUserId,
  })  : _repository = repository,
        _contextNotifier = contextNotifier,
        _boundUserId = boundUserId,
        super(const JoinMinistryState());

  int get currentGeneration => _currentGeneration;
  String? get boundUserId => _boundUserId;

  void updateBoundUser(String? userId) {
    if (_boundUserId != userId) {
      _currentGeneration++;
      _boundUserId = userId;
      state = const JoinMinistryState();
    }
  }

  void reset() {
    _currentGeneration++;
    state = const JoinMinistryState();
  }

  /// Joins a ministry by code with duplicate submit protection, session fencing,
  /// and authoritative context convergence.
  Future<OnboardingMutationResult<JoinMinistryResult>> joinMinistry(
    String code,
  ) async {
    // 1. Synchronous duplicate submit protection
    if (state.isSubmitting) {
      return const OnboardingMutationResult.discarded();
    }

    final cleanCode = code.trim().toUpperCase();
    if (cleanCode.isEmpty) {
      state = state.copyWith(
        errorMessage: 'Código de convite é obrigatório.',
      );
      return const OnboardingMutationResult.failure(
        'Código de convite é obrigatório.',
      );
    }

    final requestGeneration = ++_currentGeneration;
    final expectedUserId = _boundUserId;

    state = state.copyWith(
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
      isRefreshFailure: false,
      successMessage: null,
    );

    JoinMinistryResult? joinResult;

    // Step 1: POST /api/v1/ministries/join
    try {
      joinResult = await _repository.joinMinistryByCode(code: cleanCode);
    } catch (e) {
      // Session fencing check
      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      final errorMsg = e is AppFailure
          ? e.message
          : 'Falha ao validar código de convite.';
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return OnboardingMutationResult.failure(errorMsg);
    }

    // Session fencing check after join await
    if (requestGeneration != _currentGeneration ||
        expectedUserId != _boundUserId) {
      return const OnboardingMutationResult.discarded();
    }

    // Step 2: Authoritative context convergence via refreshAndSelect
    state = state.copyWith(
      joinedMinistry: joinResult.ministry,
      successMessage: joinResult.message,
    );

    try {
      await _contextNotifier.refreshAndSelect(
        joinResult.ministry.id,
        expectedUserId: expectedUserId,
      );

      // Session fencing check after context convergence await
      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        clearError: true,
      );
      return OnboardingMutationResult.success(joinResult);
    } catch (e) {
      // Session fencing check
      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      // Crucial: Differentiate partial failure! Join succeeded, context refresh failed.
      const refreshErrorMsg =
          'Você ingressou no ministério, mas não foi possível atualizar o contexto. Toque para tentar novamente.';
      state = state.copyWith(
        isSubmitting: false,
        isRefreshFailure: true,
        errorMessage: refreshErrorMsg,
      );
      return OnboardingMutationResult.failure(
        refreshErrorMsg,
        isRefreshFailure: true,
        partialData: joinResult,
      );
    }
  }

  /// Retries authoritative context convergence WITHOUT repeating POST /ministries/join.
  /// Enforces JOIN_POST_SUCCESS_REFRESH_RETRY.
  Future<OnboardingMutationResult<Ministry>> retryConvergence() async {
    final target = state.joinedMinistry;
    if (target == null) {
      return const OnboardingMutationResult.failure(
        'Nenhum ministério pendente de sincronização.',
      );
    }

    if (state.isSubmitting) {
      return const OnboardingMutationResult.discarded();
    }

    final requestGeneration = ++_currentGeneration;
    final expectedUserId = _boundUserId;

    state = state.copyWith(
      isSubmitting: true,
      clearError: true,
    );

    try {
      await _contextNotifier.refreshAndSelect(
        target.id,
        expectedUserId: expectedUserId,
      );

      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        isRefreshFailure: false,
        clearError: true,
      );
      return OnboardingMutationResult.success(target);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      const refreshErrorMsg =
          'Não foi possível atualizar o contexto. Tente novamente.';
      state = state.copyWith(
        isSubmitting: false,
        isRefreshFailure: true,
        errorMessage: refreshErrorMsg,
      );
      return const OnboardingMutationResult.failure(
        refreshErrorMsg,
        isRefreshFailure: true,
      );
    }
  }
}
