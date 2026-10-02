import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';

@immutable
class MemberDetailState {
  final String? ministryId;
  final String? memberId;
  final bool isLoading;
  final MinistryMember? member;
  final List<MinistryRole> roles;
  final String? error;
  final bool isNotFound;
  final bool isUnauthorized;
  final bool isSubmitting;
  final String? actionError;
  final bool isDeleted;
  final bool isInvalidated;

  const MemberDetailState({
    this.ministryId,
    this.memberId,
    this.isLoading = false,
    this.member,
    this.roles = const [],
    this.error,
    this.isNotFound = false,
    this.isUnauthorized = false,
    this.isSubmitting = false,
    this.actionError,
    this.isDeleted = false,
    this.isInvalidated = false,
  });

  Map<String, MinistryRole> get rolesById => {
        for (final r in roles) r.id: r,
      };

  List<MinistryRole> get assignedRoles {
    if (member == null) return const [];
    final map = rolesById;
    return member!.roleIds
        .map((id) => map[id])
        .whereType<MinistryRole>()
        .toList();
  }

  MemberDetailState copyWith({
    String? ministryId,
    String? memberId,
    bool? isLoading,
    MinistryMember? member,
    List<MinistryRole>? roles,
    String? error,
    bool clearError = false,
    bool? isNotFound,
    bool? isUnauthorized,
    bool? isSubmitting,
    String? actionError,
    bool clearActionError = false,
    bool? isDeleted,
    bool? isInvalidated,
  }) {
    return MemberDetailState(
      ministryId: ministryId ?? this.ministryId,
      memberId: memberId ?? this.memberId,
      isLoading: isLoading ?? this.isLoading,
      member: member ?? this.member,
      roles: roles ?? this.roles,
      error: clearError ? null : (error ?? this.error),
      isNotFound: isNotFound ?? this.isNotFound,
      isUnauthorized: isUnauthorized ?? this.isUnauthorized,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      isDeleted: isDeleted ?? this.isDeleted,
      isInvalidated: isInvalidated ?? this.isInvalidated,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MemberDetailState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          memberId == other.memberId &&
          isLoading == other.isLoading &&
          member == other.member &&
          listEquals(roles, other.roles) &&
          error == other.error &&
          isNotFound == other.isNotFound &&
          isUnauthorized == other.isUnauthorized &&
          isSubmitting == other.isSubmitting &&
          actionError == other.actionError &&
          isDeleted == other.isDeleted &&
          isInvalidated == other.isInvalidated;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      memberId.hashCode ^
      isLoading.hashCode ^
      member.hashCode ^
      Object.hashAll(roles) ^
      error.hashCode ^
      isNotFound.hashCode ^
      isUnauthorized.hashCode ^
      isSubmitting.hashCode ^
      actionError.hashCode ^
      isDeleted.hashCode ^
      isInvalidated.hashCode;
}

class MemberDetailNotifier extends StateNotifier<MemberDetailState> {
  final MembersRepository _repository;
  int _requestSequence = 0;

  MemberDetailNotifier({required MembersRepository repository})
      : _repository = repository,
        super(const MemberDetailState());

  Future<void> load({
    required String ministryId,
    required String memberId,
    MinistryMember? initialMember,
  }) async {
    final seq = ++_requestSequence;

    if (state.ministryId != ministryId || state.memberId != memberId) {
      state = MemberDetailState(
        ministryId: ministryId,
        memberId: memberId,
        member: initialMember,
        isLoading: true,
      );
    } else {
      state = state.copyWith(isLoading: true, clearError: true, clearActionError: true);
    }

    try {
      final results = await Future.wait([
        _repository.getMemberById(ministryId, memberId),
        _repository.getRoles(ministryId),
      ]);

      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) return;

      state = state.copyWith(
        member: results[0] as MinistryMember,
        roles: results[1] as List<MinistryRole>,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) return;

      final isNotFound = e.statusCode == 404 ||
          e.code == '404' ||
          e.message.toLowerCase().contains('não encontrado');
      final isUnauthorized = e.statusCode == 403 ||
          e.statusCode == 401 ||
          e.code == '403' ||
          e.code == '401' ||
          e.message.toLowerCase().contains('restrita') ||
          e.message.toLowerCase().contains('não autorizado');

      state = state.copyWith(
        isLoading: false,
        error: isNotFound || isUnauthorized ? null : e.message,
        isNotFound: isNotFound,
        isUnauthorized: isUnauthorized,
      );
    } catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar dados do integrante.',
      );
    }
  }

  Future<bool> removeMember({String? expectedMinistryId}) async {
    final ministryId = state.ministryId;
    final memberId = state.memberId;
    if (ministryId == null || memberId == null || state.isSubmitting || state.isInvalidated) return false;
    if (expectedMinistryId != null && expectedMinistryId != ministryId) return false;

    final seq = ++_requestSequence;
    state = state.copyWith(isSubmitting: true, clearActionError: true);

    try {
      await _repository.removeMember(
        ministryId: ministryId,
        memberId: memberId,
      );

      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) return false;

      state = state.copyWith(
        isSubmitting: false,
        isDeleted: true,
      );
      return true;
    } on AppFailure catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) return false;
      state = state.copyWith(
        isSubmitting: false,
        actionError: e.message,
      );
      return false;
    } catch (e) {
      if (!mounted || seq != _requestSequence || state.isInvalidated || state.ministryId != ministryId) return false;
      state = state.copyWith(
        isSubmitting: false,
        actionError: 'Erro ao remover integrante.',
      );
      return false;
    }
  }

  void updateMemberLocally(MinistryMember updatedMember) {
    if (state.memberId == updatedMember.id) {
      state = state.copyWith(member: updatedMember);
    }
  }

  void invalidateTenant() {
    ++_requestSequence;
    state = const MemberDetailState(isInvalidated: true);
  }

  void reset() {
    ++_requestSequence;
    state = const MemberDetailState();
  }
}
