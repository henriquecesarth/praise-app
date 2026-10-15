import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../ministry_context/data/ministry_repository.dart';
import '../../../ministry_context/domain/ministry_onboarding.dart';

@immutable
class InviteCodeState {
  final bool isLoading;
  final bool isSuccess;
  final MinistryInvite? invite;
  final String? errorMessage;

  const InviteCodeState({
    this.isLoading = false,
    this.isSuccess = false,
    this.invite,
    this.errorMessage,
  });

  InviteCodeState copyWith({
    bool? isLoading,
    bool? isSuccess,
    MinistryInvite? invite,
    String? errorMessage,
    bool clearError = false,
  }) {
    return InviteCodeState(
      isLoading: isLoading ?? this.isLoading,
      isSuccess: isSuccess ?? this.isSuccess,
      invite: invite ?? this.invite,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

class InviteCodeNotifier extends StateNotifier<InviteCodeState> {
  final MinistryRepository _repository;
  int _currentGeneration = 0;
  String? _boundMinistryId;
  String? _boundUserId;

  InviteCodeNotifier({
    required MinistryRepository repository,
    String? boundMinistryId,
    String? boundUserId,
  })  : _repository = repository,
        _boundMinistryId = boundMinistryId,
        _boundUserId = boundUserId,
        super(const InviteCodeState());

  int get currentGeneration => _currentGeneration;
  String? get boundMinistryId => _boundMinistryId;
  String? get boundUserId => _boundUserId;

  void updateContext({String? ministryId, String? userId}) {
    if (_boundMinistryId != ministryId || _boundUserId != userId) {
      _currentGeneration++;
      _boundMinistryId = ministryId;
      _boundUserId = userId;
      state = const InviteCodeState();
    }
  }

  void reset() {
    _currentGeneration++;
    state = const InviteCodeState();
  }

  /// Generates a new invitation code for [ministryId] with duplicate submit
  /// protection, tenant fencing, and server RBAC authority preservation.
  Future<OnboardingMutationResult<MinistryInvite>> generateInvite(
    String ministryId,
  ) async {
    // 1. Synchronous duplicate submit protection
    if (state.isLoading) {
      return const OnboardingMutationResult.discarded();
    }

    final requestGeneration = ++_currentGeneration;
    _boundMinistryId ??= ministryId;
    final expectedMinistryId = ministryId;
    final expectedUserId = _boundUserId;

    state = state.copyWith(
      isLoading: true,
      clearError: true,
      isSuccess: false,
    );

    try {
      final invite = await _repository.createInviteCode(
        expectedMinistryId,
        expiresInDays: 7,
      );

      // Tenant & session fencing check after await (Race M17-C):
      // Discard if active tenant or user changed during network call
      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      state = state.copyWith(
        isLoading: false,
        isSuccess: true,
        invite: invite,
        clearError: true,
      );
      return OnboardingMutationResult.success(invite);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const OnboardingMutationResult.discarded();
      }

      final errorMsg = e is AppFailure
          ? e.message
          : 'Não foi possível gerar o código de convite.';
      state = state.copyWith(
        isLoading: false,
        errorMessage: errorMsg,
      );
      return OnboardingMutationResult.failure(errorMsg);
    }
  }
}
