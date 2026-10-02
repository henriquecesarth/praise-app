import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';

@immutable
class MemberFormState {
  final String? ministryId;
  final bool isSubmitting;
  final String? error;
  final bool isSuccess;
  final MinistryMember? savedMember;
  final bool isInvalidated;

  const MemberFormState({
    this.ministryId,
    this.isSubmitting = false,
    this.error,
    this.isSuccess = false,
    this.savedMember,
    this.isInvalidated = false,
  });

  MemberFormState copyWith({
    String? ministryId,
    bool? isSubmitting,
    String? error,
    bool clearError = false,
    bool? isSuccess,
    MinistryMember? savedMember,
    bool? isInvalidated,
  }) {
    return MemberFormState(
      ministryId: ministryId ?? this.ministryId,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      error: clearError ? null : (error ?? this.error),
      isSuccess: isSuccess ?? this.isSuccess,
      savedMember: savedMember ?? this.savedMember,
      isInvalidated: isInvalidated ?? this.isInvalidated,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MemberFormState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          isSubmitting == other.isSubmitting &&
          error == other.error &&
          isSuccess == other.isSuccess &&
          savedMember == other.savedMember &&
          isInvalidated == other.isInvalidated;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      isSubmitting.hashCode ^
      error.hashCode ^
      isSuccess.hashCode ^
      savedMember.hashCode ^
      isInvalidated.hashCode;
}

class MemberFormNotifier extends StateNotifier<MemberFormState> {
  final MembersRepository _repository;
  int _requestSequence = 0;

  MemberFormNotifier({required MembersRepository repository})
      : _repository = repository,
        super(const MemberFormState());

  Future<MinistryMember?> submitAdd({
    required String ministryId,
    required String name,
    required String email,
    String role = 'member',
    String? birthDate,
    List<String> roleIds = const [],
  }) async {
    if (state.isSubmitting || state.isInvalidated) return null;

    final cleanName = name.trim();
    final cleanEmail = email.trim();

    if (cleanName.isEmpty) {
      state = state.copyWith(error: 'Nome é obrigatório.');
      return null;
    }
    if (cleanEmail.isEmpty || !cleanEmail.contains('@') || !cleanEmail.contains('.')) {
      state = state.copyWith(error: 'Informe um e-mail válido.');
      return null;
    }

    final seq = ++_requestSequence;
    state = state.copyWith(
      ministryId: ministryId,
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
    );

    try {
      final created = await _repository.addMember(
        ministryId: ministryId,
        name: cleanName,
        email: cleanEmail,
        role: role,
        birthDate: birthDate,
        roleIds: roleIds,
      );

      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) {
        return null;
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        savedMember: created,
      );
      return created;
    } on AppFailure catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) {
        return null;
      }
      state = state.copyWith(
        isSubmitting: false,
        error: e.message,
      );
      return null;
    } catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) {
        return null;
      }
      state = state.copyWith(
        isSubmitting: false,
        error: 'Erro ao adicionar integrante.',
      );
      return null;
    }
  }

  Future<MinistryMember?> submitUpdate({
    required String ministryId,
    required String memberId,
    required String name,
    String? email,
    String? birthDate,
    required String role,
    List<String>? roleIds,
  }) async {
    if (state.isSubmitting || state.isInvalidated) return null;

    final cleanName = name.trim();
    if (cleanName.isEmpty) {
      state = state.copyWith(error: 'Nome é obrigatório.');
      return null;
    }

    if (email != null && email.trim().isNotEmpty) {
      final cleanEmail = email.trim();
      if (!cleanEmail.contains('@') || !cleanEmail.contains('.')) {
        state = state.copyWith(error: 'Informe um e-mail válido.');
        return null;
      }
    }

    final seq = ++_requestSequence;
    state = state.copyWith(
      ministryId: ministryId,
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
    );

    try {
      final updated = await _repository.updateMember(
        ministryId: ministryId,
        memberId: memberId,
        name: cleanName,
        email: email,
        birthDate: birthDate,
        role: role,
        roleIds: roleIds,
      );

      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) {
        return null;
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        savedMember: updated,
      );
      return updated;
    } on AppFailure catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) {
        return null;
      }
      state = state.copyWith(
        isSubmitting: false,
        error: e.message,
      );
      return null;
    } catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) {
        return null;
      }
      state = state.copyWith(
        isSubmitting: false,
        error: 'Erro ao atualizar dados do integrante.',
      );
      return null;
    }
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void invalidateTenant() {
    ++_requestSequence;
    state = const MemberFormState(
      isInvalidated: true,
      error: 'Sessão ou ministério alterado. A operação foi cancelada.',
    );
  }

  void reset() {
    ++_requestSequence;
    state = const MemberFormState();
  }
}
