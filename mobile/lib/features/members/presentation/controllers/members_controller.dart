import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';

@immutable
class MembersDirectoryState {
  final String? ministryId;
  final List<MinistryMember> members;
  final List<MinistryRole> roles;
  final bool isLoading;
  final bool isRefreshing;
  final String? error;
  final String searchQuery;
  final String? selectedRoleFilter;

  const MembersDirectoryState({
    this.ministryId,
    this.members = const [],
    this.roles = const [],
    this.isLoading = false,
    this.isRefreshing = false,
    this.error,
    this.searchQuery = '',
    this.selectedRoleFilter,
  });

  bool get isEmpty => !isLoading && members.isEmpty && error == null;

  Map<String, MinistryRole> get rolesById => {
        for (final r in roles) r.id: r,
      };

  List<MinistryMember> get filteredMembers {
    var result = members;
    final q = searchQuery.trim().toLowerCase();
    if (q.isNotEmpty) {
      result = result.where((m) {
        final matchesName = m.name.toLowerCase().contains(q);
        final matchesEmail = m.email.toLowerCase().contains(q);
        final matchesPhone = m.phone.toLowerCase().contains(q);
        final matchesMusicalRole = m.roleIds.any((rId) {
          final role = rolesById[rId];
          return role != null && role.name.toLowerCase().contains(q);
        });
        return matchesName || matchesEmail || matchesPhone || matchesMusicalRole;
      }).toList();
    }

    if (selectedRoleFilter != null && selectedRoleFilter!.isNotEmpty) {
      if (selectedRoleFilter == 'admin') {
        result = result.where((m) => m.isAdmin).toList();
      } else if (selectedRoleFilter == 'member') {
        result = result.where((m) => !m.isAdmin).toList();
      } else {
        result = result
            .where((m) => m.roleIds.contains(selectedRoleFilter!))
            .toList();
      }
    }

    return result;
  }

  MembersDirectoryState copyWith({
    String? ministryId,
    List<MinistryMember>? members,
    List<MinistryRole>? roles,
    bool? isLoading,
    bool? isRefreshing,
    String? error,
    bool clearError = false,
    String? searchQuery,
    String? selectedRoleFilter,
    bool clearRoleFilter = false,
  }) {
    return MembersDirectoryState(
      ministryId: ministryId ?? this.ministryId,
      members: members ?? this.members,
      roles: roles ?? this.roles,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      error: clearError ? null : (error ?? this.error),
      searchQuery: searchQuery ?? this.searchQuery,
      selectedRoleFilter: clearRoleFilter
          ? null
          : (selectedRoleFilter ?? this.selectedRoleFilter),
    );
  }
}

class MembersDirectoryNotifier extends StateNotifier<MembersDirectoryState> {
  final MembersRepository _repository;
  int _requestSequence = 0;

  MembersDirectoryNotifier({required MembersRepository repository})
      : _repository = repository,
        super(const MembersDirectoryState());

  Future<void> loadForMinistry(String ministryId) async {
    final seq = ++_requestSequence;

    if (state.ministryId != ministryId) {
      state = MembersDirectoryState(
        ministryId: ministryId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(
        isLoading: true,
        clearError: true,
      );
    }

    try {
      final results = await Future.wait([
        _repository.getMembers(ministryId),
        _repository.getRoles(ministryId),
      ]);

      if (seq != _requestSequence) return;

      state = state.copyWith(
        members: results[0] as List<MinistryMember>,
        roles: results[1] as List<MinistryRole>,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence) return;
      state = state.copyWith(
        isLoading: false,
        error: e.message,
      );
    } catch (e) {
      if (seq != _requestSequence) return;
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar integrantes do ministério.',
      );
    }
  }

  Future<void> refresh() async {
    final ministryId = state.ministryId;
    if (ministryId == null || state.isRefreshing) return;

    final seq = ++_requestSequence;
    state = state.copyWith(isRefreshing: true);

    try {
      final results = await Future.wait([
        _repository.getMembers(ministryId),
        _repository.getRoles(ministryId),
      ]);

      if (seq != _requestSequence) return;

      state = state.copyWith(
        members: results[0] as List<MinistryMember>,
        roles: results[1] as List<MinistryRole>,
        isRefreshing: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence) return;
      state = state.copyWith(
        isRefreshing: false,
        error: e.message,
      );
    } catch (e) {
      if (seq != _requestSequence) return;
      state = state.copyWith(
        isRefreshing: false,
        error: 'Erro ao atualizar integrantes.',
      );
    }
  }

  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
  }

  void setRoleFilter(String? roleFilter) {
    if (roleFilter == null) {
      state = state.copyWith(clearRoleFilter: true);
    } else {
      state = state.copyWith(selectedRoleFilter: roleFilter);
    }
  }

  void reset() {
    ++_requestSequence;
    state = const MembersDirectoryState();
  }
}
