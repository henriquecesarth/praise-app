import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/ministry_repository.dart';
import '../../domain/ministry.dart';
import '../../domain/ministry_onboarding.dart';
import 'ministry_context_controller.dart';

@immutable
class CreateMinistryState {
  final bool isSubmitting;
  final bool isSuccess;
  final bool isRefreshFailure;
  final Ministry? createdMinistry;
  final String? errorMessage;

  const CreateMinistryState({
    this.isSubmitting = false,
    this.isSuccess = false,
    this.isRefreshFailure = false,
    this.createdMinistry,
    this.errorMessage,
  });

  CreateMinistryState copyWith({
    bool? isSubmitting,
    bool? isSuccess,
    bool? isRefreshFailure,
    Ministry? createdMinistry,
    String? errorMessage,
    bool clearError = false,
  }) {
    return CreateMinistryState(
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isSuccess: isSuccess ?? this.isSuccess,
      isRefreshFailure: isRefreshFailure ?? this.isRefreshFailure,
      createdMinistry: createdMinistry ?? this.createdMinistry,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

class CreateMinistryNotifier extends StateNotifier<CreateMinistryState> {
  final MinistryRepository _repository;
  final MinistryContextNotifier _contextNotifier;
  int _currentGeneration = 0;
  String? _boundUserId;

  CreateMinistryNotifier({
    required MinistryRepository repository,
    required MinistryContextNotifier contextNotifier,
    String? boundUserId,
  })  : _repository = repository,
        _contextNotifier = contextNotifier,
        _boundUserId = boundUserId,
        super(const CreateMinistryState());

  int get currentGeneration => _currentGeneration;
  String? get boundUserId => _boundUserId;

  void updateBoundUser(String? userId) {
    if (_boundUserId != userId) {
      _currentGeneration++;
      _boundUserId = userId;
      state = const CreateMinistryState();
    }
  }

  void reset() {
    _currentGeneration++;
    state = const CreateMinistryState();
  }

  /// Creates a new ministry with duplicate submit protection, session fencing,
  /// and authoritative context convergence.
  Future<OnboardingMutationResult<Ministry>> createMinistry(String name) async {
    // 1. Synchronous duplicate submit protection
    if (state.isSubmitting) {
      return const OnboardingMutationResult.discarded();
    }

    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      state = state.copyWith(
        errorMessage: 'Nome do ministério é obrigatório.',
      );
      return const OnboardingMutationResult.failure(
        'Nome do ministério é obrigatório.',
      );
    }
    if (trimmed.length > 100) {
      state = state.copyWith(
        errorMessage: 'Nome do ministério deve ter no máximo 100 caracteres.',
      );
      return const OnboardingMutationResult.failure(
        'Nome do ministério deve ter no máximo 100 caracteres.',
      );
    }

    final requestGeneration = ++_currentGeneration;
    final expectedUserId = _boundUserId;

    state = state.copyWith(
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
      isRefreshFailure: false,
    );

    Ministry? created;

    // Step 1: POST /api/v1/ministries
    try {
      created = await _repository.createMinistry(name: trimmed);
    } catch (e) {
      // Session fencing check
      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      final errorMsg = e is AppFailure
          ? e.message
          : 'Erro ao criar o ministério de louvor.';
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return OnboardingMutationResult.failure(errorMsg);
    }

    // Session fencing check after creation await
    if (requestGeneration != _currentGeneration ||
        expectedUserId != _boundUserId) {
      return const OnboardingMutationResult.discarded();
    }

    // Step 2: Authoritative context convergence via refreshAndSelect
    state = state.copyWith(createdMinistry: created);

    try {
      await _contextNotifier.refreshAndSelect(
        created.id,
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
      return OnboardingMutationResult.success(created);
    } catch (e) {
      // Session fencing check
      if (requestGeneration != _currentGeneration ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      // Crucial: Differentiate partial failure! Mutation succeeded, context refresh failed.
      const refreshErrorMsg =
          'Ministério criado com sucesso, mas não foi possível atualizar o contexto. Toque para tentar novamente.';
      state = state.copyWith(
        isSubmitting: false,
        isRefreshFailure: true,
        errorMessage: refreshErrorMsg,
      );
      return OnboardingMutationResult.failure(
        refreshErrorMsg,
        isRefreshFailure: true,
        partialData: created,
      );
    }
  }

  /// Retries authoritative context convergence WITHOUT repeating POST /ministries.
  /// Enforces CREATE_POST_SUCCESS_REFRESH_RETRY_DOES_NOT_REPEAT_CREATE.
  Future<OnboardingMutationResult<Ministry>> retryConvergence() async {
    final target = state.createdMinistry;
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
      return OnboardingMutationResult.failure(
        refreshErrorMsg,
        isRefreshFailure: true,
        partialData: target,
      );
    }
  }
}
