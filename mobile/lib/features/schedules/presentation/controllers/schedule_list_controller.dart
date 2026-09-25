import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/schedule_repository.dart';
import '../../domain/schedule.dart';

@immutable
class ScheduleListState {
  final String? ministryId;
  final bool isLoading;
  final bool isRefreshing;
  final List<ScheduleSummary> schedules;
  final String? error;

  const ScheduleListState({
    this.ministryId,
    this.isLoading = false,
    this.isRefreshing = false,
    this.schedules = const [],
    this.error,
  });

  /// Upcoming schedules: today or future, sorted nearest-first.
  List<ScheduleSummary> upcomingSchedules([DateTime? referenceNow]) {
    final list = schedules.where((s) => s.isUpcoming(referenceNow)).toList();
    list.sort((a, b) {
      final dateCmp = a.date.compareTo(b.date);
      if (dateCmp != 0) return dateCmp;
      return a.time.compareTo(b.time);
    });
    return list;
  }

  /// Past schedules: before today, sorted latest-first.
  List<ScheduleSummary> pastSchedules([DateTime? referenceNow]) {
    final list = schedules.where((s) => !s.isUpcoming(referenceNow)).toList();
    list.sort((a, b) {
      final dateCmp = b.date.compareTo(a.date);
      if (dateCmp != 0) return dateCmp;
      return b.time.compareTo(a.time);
    });
    return list;
  }

  ScheduleListState copyWith({
    String? ministryId,
    bool? isLoading,
    bool? isRefreshing,
    List<ScheduleSummary>? schedules,
    String? error,
    bool clearError = false,
  }) {
    return ScheduleListState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      schedules: schedules ?? this.schedules,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleListState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          isLoading == other.isLoading &&
          isRefreshing == other.isRefreshing &&
          listEquals(schedules, other.schedules) &&
          error == other.error;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      isLoading.hashCode ^
      isRefreshing.hashCode ^
      Object.hashAll(schedules) ^
      error.hashCode;
}

class ScheduleListNotifier extends StateNotifier<ScheduleListState> {
  final ScheduleRepository _repository;

  ScheduleListNotifier({required ScheduleRepository repository})
      : _repository = repository,
        super(const ScheduleListState());

  /// Loads schedules for [ministryId]. Clears stale data on ministry switch.
  Future<void> loadForMinistry(String ministryId) async {
    if (state.ministryId != ministryId) {
      state = ScheduleListState(
        ministryId: ministryId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(
        isLoading: true,
        clearError: true,
      );
    }

    await _fetchSchedules(ministryId);
  }

  /// Pull-to-refresh without blanking existing data.
  Future<void> refresh() async {
    final ministryId = state.ministryId;
    if (ministryId == null || state.isRefreshing) return;
    state = state.copyWith(isRefreshing: true);
    await _fetchSchedules(ministryId);
    state = state.copyWith(isRefreshing: false);
  }

  /// Retry after error.
  Future<void> retry() async {
    final ministryId = state.ministryId;
    if (ministryId == null) return;
    state = state.copyWith(isLoading: true, clearError: true);
    await _fetchSchedules(ministryId);
  }

  Future<void> _fetchSchedules(String targetMinistryId) async {
    try {
      final list = await _repository.listSchedules(targetMinistryId);
      if (state.ministryId != targetMinistryId) return; // stale
      state = state.copyWith(
        schedules: list,
        isLoading: false,
        isRefreshing: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (state.ministryId != targetMinistryId) return;
      state = state.copyWith(
        error: e.message,
        isLoading: false,
        isRefreshing: false,
      );
    } catch (e) {
      if (state.ministryId != targetMinistryId) return;
      state = state.copyWith(
        error: 'Não foi possível carregar as escalas.',
        isLoading: false,
        isRefreshing: false,
      );
    }
  }

  void reset() {
    state = const ScheduleListState();
  }
}
