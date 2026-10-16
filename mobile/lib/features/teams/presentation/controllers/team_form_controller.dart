import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../members/data/members_repository.dart';
import '../../../schedules/domain/ministry_member.dart';
import '../../data/team_repository.dart';
import '../../domain/team.dart';

enum TeamMutationOutcome {
  success,
  failure,
  discarded,
}

@immutable
class TeamMutationResult<T> {
  final TeamMutationOutcome outcome;
  final T? data;
  final String? errorMessage;

  const TeamMutationResult.success([this.data])
      : outcome = TeamMutationOutcome.success,
        errorMessage = null;

  const TeamMutationResult.failure(this.errorMessage)
      : outcome = TeamMutationOutcome.failure,
        data = null;

  const TeamMutationResult.discarded()
      : outcome = TeamMutationOutcome.discarded,
        data = null,
        errorMessage = null;

  bool get isSuccess => outcome == TeamMutationOutcome.success;
  bool get isFailure => outcome == TeamMutationOutcome.failure;
  bool get isDiscarded => outcome == TeamMutationOutcome.discarded;
}

@immutable
class TeamFormState {
  final String ministryId;
  final String boundUserId;
  final Team? initialTeam;
  final String name;
  final String description;
  final Set<String> selectedMemberIds;
  final List<MinistryMember> availableMembers;
  final bool isLoadingMembers;
  final bool isSubmitting;
  final bool isInvalidated;
  final String? errorMessage;

  const TeamFormState({
    this.ministryId = '',
    this.boundUserId = '',
    this.initialTeam,
    this.name = '',
    this.description = '',
    this.selectedMemberIds = const {},
    this.availableMembers = const [],
    this.isLoadingMembers = false,
    this.isSubmitting = false,
    this.isInvalidated = false,
    this.errorMessage,
  });

  bool get isEditing => initialTeam != null;

  /// Dynamic dirty check.
  /// When changes are reverted to initial values, state returns to pristine (false).
  /// If the form is invalidated due to tenant mismatch, returns false to bypass discard dialogs.
  bool get isDirty {
    if (isInvalidated) return false;
    final init = initialTeam;
    if (init == null) {
      return name.trim().isNotEmpty ||
          description.trim().isNotEmpty ||
          selectedMemberIds.isNotEmpty;
    }

    final activeInitialMemberIds = init.memberIds
        .toSet()
        .intersection(availableMembers.map((m) => m.id).toSet());

    return name.trim() != init.name.trim() ||
        description.trim() != (init.description ?? '').trim() ||
        !setEquals(selectedMemberIds, activeInitialMemberIds);
  }

  TeamFormState copyWith({
    String? ministryId,
    String? boundUserId,
    Team? initialTeam,
    bool clearInitialTeam = false,
    String? name,
    String? description,
    Set<String>? selectedMemberIds,
    List<MinistryMember>? availableMembers,
    bool? isLoadingMembers,
    bool? isSubmitting,
    bool? isInvalidated,
    String? errorMessage,
    bool clearError = false,
  }) {
    return TeamFormState(
      ministryId: ministryId ?? this.ministryId,
      boundUserId: boundUserId ?? this.boundUserId,
      initialTeam:
          clearInitialTeam ? null : (initialTeam ?? this.initialTeam),
      name: name ?? this.name,
      description: description ?? this.description,
      selectedMemberIds: selectedMemberIds ?? this.selectedMemberIds,
      availableMembers: availableMembers ?? this.availableMembers,
      isLoadingMembers: isLoadingMembers ?? this.isLoadingMembers,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isInvalidated: isInvalidated ?? this.isInvalidated,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

class TeamFormNotifier extends StateNotifier<TeamFormState> {
  final TeamRepository _teamRepository;
  final MembersRepository _membersRepository;
  int _currentGeneration = 0;

  TeamFormNotifier({
    required TeamRepository teamRepository,
    required MembersRepository membersRepository,
  })  : _teamRepository = teamRepository,
        _membersRepository = membersRepository,
        super(const TeamFormState());

  int get currentGeneration => _currentGeneration;

  void init({
    required String ministryId,
    required String boundUserId,
    Team? initialTeam,
    List<MinistryMember>? availableMembers,
  }) {
    _currentGeneration++;
    final members = availableMembers ?? const [];

    // Intersect initial member IDs with currently active members
    // EDIT_SAVE_CANONICALIZES_TO_CURRENT_ACTIVE_SELECTION:
    // Stale/removed historical references are filtered out for active UI selection.
    final Set<String> initialSelected;
    if (initialTeam != null) {
      if (members.isNotEmpty) {
        final activeMemberIdSet = members.map((m) => m.id).toSet();
        initialSelected = initialTeam.memberIds
            .where((id) => activeMemberIdSet.contains(id))
            .toSet();
      } else {
        initialSelected = initialTeam.memberIds.toSet();
      }
    } else {
      initialSelected = const {};
    }

    state = TeamFormState(
      ministryId: ministryId,
      boundUserId: boundUserId,
      initialTeam: initialTeam,
      name: initialTeam?.name ?? '',
      description: initialTeam?.description ?? '',
      selectedMemberIds: initialSelected,
      availableMembers: members,
      isLoadingMembers: members.isEmpty,
    );

    if (members.isEmpty) {
      loadMembers(ministryId);
    }
  }

  Future<void> loadMembers(String ministryId) async {
    final generation = _currentGeneration;
    state = state.copyWith(isLoadingMembers: true, clearError: true);

    try {
      final members = await _membersRepository.getMembers(ministryId);
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId) {
        return;
      }

      final activeMemberIdSet = members.map((m) => m.id).toSet();
      final adjustedSelected = state.isEditing
          ? (state.initialTeam?.memberIds ?? [])
              .where((id) => activeMemberIdSet.contains(id))
              .toSet()
          : state.selectedMemberIds
              .where((id) => activeMemberIdSet.contains(id))
              .toSet();

      state = state.copyWith(
        availableMembers: members,
        selectedMemberIds: adjustedSelected,
        isLoadingMembers: false,
      );
    } catch (e) {
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isLoadingMembers: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
    }
  }

  void setName(String name) {
    if (state.name == name) return;
    state = state.copyWith(name: name, clearError: true);
  }

  void setDescription(String description) {
    if (state.description == description) return;
    state = state.copyWith(description: description, clearError: true);
  }

  void toggleMember(String memberId) {
    final current = Set<String>.from(state.selectedMemberIds);
    if (current.contains(memberId)) {
      current.remove(memberId);
    } else {
      current.add(memberId);
    }
    state = state.copyWith(selectedMemberIds: current, clearError: true);
  }

  Future<TeamMutationResult<Team>> createTeam({
    required String name,
    String? description,
  }) async {
    // TEAM_CREATE_DUPLICATE_SUBMIT = BLOCKED
    if (state.isSubmitting) return const TeamMutationResult.discarded();

    final generation = _currentGeneration;
    final ministryId = state.ministryId;
    final boundUserId = state.boundUserId;

    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final created = await _teamRepository.createTeam(
        ministryId,
        name: name,
        description: description,
        memberIds: state.selectedMemberIds.toList(),
      );

      // TEAM_CREATE_SESSION_FENCING & TEAM_MUTATION_TENANT_FENCING
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId ||
          state.boundUserId != boundUserId) {
        return const TeamMutationResult.discarded();
      }

      state = state.copyWith(isSubmitting: false);
      return TeamMutationResult.success(created);
    } catch (e) {
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId ||
          state.boundUserId != boundUserId) {
        return const TeamMutationResult.discarded();
      }

      final message = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(isSubmitting: false, errorMessage: message);
      return TeamMutationResult.failure(message);
    }
  }

  Future<TeamMutationResult<Team>> updateTeam({
    required String teamId,
    required String name,
    String? description,
  }) async {
    // TEAM_EDIT_DUPLICATE_SUBMIT = BLOCKED
    if (state.isSubmitting) return const TeamMutationResult.discarded();

    final generation = _currentGeneration;
    final ministryId = state.ministryId;
    final boundUserId = state.boundUserId;

    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      // EDIT_SAVE_CANONICALIZES_TO_CURRENT_ACTIVE_SELECTION
      final updated = await _teamRepository.updateTeam(
        ministryId,
        teamId,
        name: name,
        description: description,
        memberIds: state.selectedMemberIds.toList(),
      );

      // TEAM_EDIT_SESSION_FENCING & TEAM_MUTATION_TENANT_FENCING
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId ||
          state.boundUserId != boundUserId) {
        return const TeamMutationResult.discarded();
      }

      state = state.copyWith(isSubmitting: false);
      return TeamMutationResult.success(updated);
    } catch (e) {
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId ||
          state.boundUserId != boundUserId) {
        return const TeamMutationResult.discarded();
      }

      final message = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(isSubmitting: false, errorMessage: message);
      return TeamMutationResult.failure(message);
    }
  }

  Future<TeamMutationResult<void>> deleteTeam(String teamId) async {
    // TEAM_DELETE_DUPLICATE_SUBMIT = BLOCKED
    if (state.isSubmitting) return const TeamMutationResult.discarded();

    final generation = _currentGeneration;
    final ministryId = state.ministryId;
    final boundUserId = state.boundUserId;

    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      await _teamRepository.deleteTeam(ministryId, teamId);

      // TEAM_DELETE_SESSION_FENCING & TEAM_MUTATION_TENANT_FENCING
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId ||
          state.boundUserId != boundUserId) {
        return const TeamMutationResult.discarded();
      }

      state = state.copyWith(isSubmitting: false);
      return const TeamMutationResult.success();
    } catch (e) {
      if (generation != _currentGeneration ||
          state.isInvalidated ||
          state.ministryId != ministryId ||
          state.boundUserId != boundUserId) {
        return const TeamMutationResult.discarded();
      }

      final message = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(isSubmitting: false, errorMessage: message);
      return TeamMutationResult.failure(message);
    }
  }

  void invalidateTenant() {
    _currentGeneration++;
    state = state.copyWith(
      isInvalidated: true,
      isSubmitting: false,
    );
  }

  void reset() {
    _currentGeneration++;
    state = const TeamFormState();
  }
}
