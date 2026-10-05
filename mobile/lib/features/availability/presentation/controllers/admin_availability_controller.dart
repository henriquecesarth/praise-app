import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../members/data/members_repository.dart';
import '../../../schedules/domain/ministry_member.dart';
import '../../data/availability_repository.dart';
import '../../domain/consolidated_availability.dart';

@immutable
class AdminAvailabilityState {
  final String? ministryId;
  final bool isLoading;
  final bool isRefreshing;
  final bool isLoadingMore;
  final List<ConsolidatedAvailabilityItem> items;
  final String selectedPreset; // '7d', '15d', '30d', 'this_month', 'custom'
  final String from;
  final String to;
  final String? selectedMemberId;
  final List<MinistryMember> members;
  final String? nextCursor;
  final String? error;
  final bool isUnauthorized;
  final String? rangeError;

  const AdminAvailabilityState({
    this.ministryId,
    this.isLoading = false,
    this.isRefreshing = false,
    this.isLoadingMore = false,
    this.items = const [],
    this.selectedPreset = '30d',
    this.from = '',
    this.to = '',
    this.selectedMemberId,
    this.members = const [],
    this.nextCursor,
    this.error,
    this.isUnauthorized = false,
    this.rangeError,
  });

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  AdminAvailabilityState copyWith({
    String? ministryId,
    bool? isLoading,
    bool? isRefreshing,
    bool? isLoadingMore,
    List<ConsolidatedAvailabilityItem>? items,
    String? selectedPreset,
    String? from,
    String? to,
    String? selectedMemberId,
    bool clearSelectedMemberId = false,
    List<MinistryMember>? members,
    String? nextCursor,
    bool clearCursor = false,
    String? error,
    bool clearError = false,
    bool? isUnauthorized,
    String? rangeError,
    bool clearRangeError = false,
  }) {
    return AdminAvailabilityState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      items: items ?? this.items,
      selectedPreset: selectedPreset ?? this.selectedPreset,
      from: from ?? this.from,
      to: to ?? this.to,
      selectedMemberId: clearSelectedMemberId
          ? null
          : (selectedMemberId ?? this.selectedMemberId),
      members: members ?? this.members,
      nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
      error: clearError ? null : (error ?? this.error),
      isUnauthorized: isUnauthorized ?? this.isUnauthorized,
      rangeError: clearRangeError ? null : (rangeError ?? this.rangeError),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AdminAvailabilityState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          isLoading == other.isLoading &&
          isRefreshing == other.isRefreshing &&
          isLoadingMore == other.isLoadingMore &&
          listEquals(items, other.items) &&
          selectedPreset == other.selectedPreset &&
          from == other.from &&
          to == other.to &&
          selectedMemberId == other.selectedMemberId &&
          listEquals(members, other.members) &&
          nextCursor == other.nextCursor &&
          error == other.error &&
          isUnauthorized == other.isUnauthorized &&
          rangeError == other.rangeError;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      isLoading.hashCode ^
      isRefreshing.hashCode ^
      isLoadingMore.hashCode ^
      Object.hashAll(items) ^
      selectedPreset.hashCode ^
      from.hashCode ^
      to.hashCode ^
      selectedMemberId.hashCode ^
      Object.hashAll(members) ^
      nextCursor.hashCode ^
      error.hashCode ^
      isUnauthorized.hashCode ^
      rangeError.hashCode;
}

class AdminAvailabilityNotifier extends StateNotifier<AdminAvailabilityState> {
  final AvailabilityRepository _repository;
  final MembersRepository _membersRepository;
  int _requestSequence = 0;

  AdminAvailabilityNotifier({
    required AvailabilityRepository repository,
    required MembersRepository membersRepository,
  })  : _repository = repository,
        _membersRepository = membersRepository,
        super(const AdminAvailabilityState());

  /// Loads consolidated availability for [ministryId].
  Future<void> loadForMinistry(
    String ministryId, {
    String? preset,
    String? from,
    String? to,
    String? memberId,
  }) async {
    final seq = ++_requestSequence;

    // Resolve date range from preset or custom
    final effectivePreset = preset ?? state.selectedPreset;
    String effectiveFrom;
    String effectiveTo;

    if (effectivePreset == '7d') {
      final p = AvailabilityPlanningPeriod.preset7Days();
      effectiveFrom = p.from;
      effectiveTo = p.to;
    } else if (effectivePreset == '15d') {
      final p = AvailabilityPlanningPeriod.preset15Days();
      effectiveFrom = p.from;
      effectiveTo = p.to;
    } else if (effectivePreset == 'this_month') {
      final p = AvailabilityPlanningPeriod.presetThisMonth();
      effectiveFrom = p.from;
      effectiveTo = p.to;
    } else if (effectivePreset == 'custom' && from != null && to != null) {
      effectiveFrom = from;
      effectiveTo = to;
    } else {
      // Default: 30d
      final p = AvailabilityPlanningPeriod.preset30Days();
      effectiveFrom = p.from;
      effectiveTo = p.to;
    }

    final validationErr = AvailabilityPlanningPeriod.validateRange(
      effectiveFrom,
      effectiveTo,
    );

    if (validationErr != null) {
      state = state.copyWith(
        ministryId: ministryId,
        selectedPreset: effectivePreset,
        from: effectiveFrom,
        to: effectiveTo,
        rangeError: validationErr,
        isLoading: false,
      );
      return;
    }

    final isNewTenant = state.ministryId != ministryId;
    if (isNewTenant) {
      state = AdminAvailabilityState(
        ministryId: ministryId,
        isLoading: true,
        selectedPreset: effectivePreset,
        from: effectiveFrom,
        to: effectiveTo,
        selectedMemberId: memberId,
      );
    } else {
      state = state.copyWith(
        isLoading: true,
        selectedPreset: effectivePreset,
        from: effectiveFrom,
        to: effectiveTo,
        selectedMemberId: memberId ?? state.selectedMemberId,
        clearError: true,
        clearRangeError: true,
      );
    }

    // Load active members for filter dropdown if not yet loaded or on tenant change
    if (isNewTenant || state.members.isEmpty) {
      _loadMembers(ministryId, seq);
    }

    try {
      final response = await _repository.listConsolidatedAvailability(
        ministryId,
        from: effectiveFrom,
        to: effectiveTo,
        memberId: memberId ?? state.selectedMemberId,
      );

      // Stale response / tenant-switch guard
      if (seq != _requestSequence || state.ministryId != ministryId) return;

      state = state.copyWith(
        isLoading: false,
        items: response.data,
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
        clearError: true,
        clearRangeError: true,
        isUnauthorized: false,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: e.message,
        isUnauthorized: e.statusCode == 403,
      );
    } catch (e) {
      if (seq != _requestSequence || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar disponibilidade consolidada.',
        isUnauthorized: false,
      );
    }
  }

  Future<void> _loadMembers(String ministryId, int currentSeq) async {
    try {
      final list = await _membersRepository.getMembers(ministryId);
      if (currentSeq != _requestSequence || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(members: list);
    } catch (_) {
      // Non-blocking for members dropdown
    }
  }

  /// Changes the preset filter ('7d', '15d', '30d', 'this_month') and reloads.
  Future<void> setPreset(String preset) async {
    final mId = state.ministryId;
    if (mId == null) return;
    await loadForMinistry(
      mId,
      preset: preset,
      memberId: state.selectedMemberId,
    );
  }

  /// Sets a custom date range and reloads.
  Future<void> setCustomRange(String from, String to) async {
    final mId = state.ministryId;
    if (mId == null) return;
    await loadForMinistry(
      mId,
      preset: 'custom',
      from: from,
      to: to,
      memberId: state.selectedMemberId,
    );
  }

  /// Filters by member (or clears member filter when null).
  Future<void> setMemberFilter(String? memberId) async {
    final mId = state.ministryId;
    if (mId == null) return;
    state = state.copyWith(
      selectedMemberId: memberId,
      clearSelectedMemberId: memberId == null,
    );
    await loadForMinistry(
      mId,
      preset: state.selectedPreset,
      from: state.from,
      to: state.to,
      memberId: memberId,
    );
  }

  /// Pull-to-refresh: reloads current view preserving existing items until response arrives.
  Future<void> refresh() async {
    final mId = state.ministryId;
    if (mId == null) return;

    final seq = ++_requestSequence;
    state = state.copyWith(isRefreshing: true, clearError: true);

    try {
      final response = await _repository.listConsolidatedAvailability(
        mId,
        from: state.from,
        to: state.to,
        memberId: state.selectedMemberId,
      );

      if (seq != _requestSequence || state.ministryId != mId) return;

      state = state.copyWith(
        isRefreshing: false,
        items: response.data,
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
        clearError: true,
        clearRangeError: true,
        isUnauthorized: false,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence || state.ministryId != mId) return;
      state = state.copyWith(
        isRefreshing: false,
        error: e.message,
        isUnauthorized: e.statusCode == 403,
      );
    } catch (e) {
      if (seq != _requestSequence || state.ministryId != mId) return;
      state = state.copyWith(
        isRefreshing: false,
        error: 'Erro ao atualizar disponibilidade.',
      );
    }
  }

  /// Loads next page using cursor pagination.
  Future<void> loadMore() async {
    final mId = state.ministryId;
    final cursor = state.nextCursor;
    if (mId == null ||
        cursor == null ||
        state.isLoadingMore ||
        state.isLoading ||
        state.isRefreshing) {
      return;
    }

    final seq = ++_requestSequence;
    state = state.copyWith(isLoadingMore: true);

    try {
      final response = await _repository.listConsolidatedAvailability(
        mId,
        from: state.from,
        to: state.to,
        memberId: state.selectedMemberId,
        cursor: cursor,
      );

      if (seq != _requestSequence || state.ministryId != mId) return;

      // Defensive deduplication by ID
      final existingIds = state.items.map((i) => i.id).toSet();
      final newItems =
          response.data.where((i) => !existingIds.contains(i.id)).toList();

      state = state.copyWith(
        isLoadingMore: false,
        items: [...state.items, ...newItems],
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence || state.ministryId != mId) return;
      state = state.copyWith(
        isLoadingMore: false,
        error: e.message,
      );
    } catch (_) {
      if (seq != _requestSequence || state.ministryId != mId) return;
      state = state.copyWith(
        isLoadingMore: false,
        error: 'Erro ao carregar mais períodos.',
      );
    }
  }

  /// Synchronously invalidates tenant-scoped state when ministry changes.
  void invalidateTenant() {
    ++_requestSequence;
    state = const AdminAvailabilityState();
  }

  /// Complete reset (e.g. on logout or user switch).
  void reset() {
    ++_requestSequence;
    state = const AdminAvailabilityState();
  }
}
