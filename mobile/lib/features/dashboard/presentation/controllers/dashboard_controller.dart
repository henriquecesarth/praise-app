import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/dashboard_repository.dart';
import '../../domain/announcement.dart';
import '../../domain/dashboard_schedule_summary.dart';

@immutable
class DashboardState {
  final String? ministryId;
  final bool isSchedulesLoading;
  final bool isAnnouncementsLoading;
  final List<DashboardScheduleSummary> schedules;
  final List<Announcement> announcements;
  final String? schedulesError;
  final String? announcementsError;
  final bool isRefreshing;

  const DashboardState({
    this.ministryId,
    this.isSchedulesLoading = false,
    this.isAnnouncementsLoading = false,
    this.schedules = const [],
    this.announcements = const [],
    this.schedulesError,
    this.announcementsError,
    this.isRefreshing = false,
  });

  /// Filtered upcoming schedules sorted nearest first.
  List<DashboardScheduleSummary> upcomingSchedules([DateTime? referenceNow]) {
    final list = schedules.where((s) => s.isUpcoming(referenceNow)).toList();
    list.sort((a, b) {
      final dateCmp = a.date.compareTo(b.date);
      if (dateCmp != 0) return dateCmp;
      return a.time.compareTo(b.time);
    });
    return list;
  }

  /// Initial or full loading check.
  bool get isLoading =>
      (isSchedulesLoading || isAnnouncementsLoading) &&
      schedules.isEmpty &&
      announcements.isEmpty &&
      schedulesError == null &&
      announcementsError == null;

  DashboardState copyWith({
    String? ministryId,
    bool? isSchedulesLoading,
    bool? isAnnouncementsLoading,
    List<DashboardScheduleSummary>? schedules,
    List<Announcement>? announcements,
    String? schedulesError,
    bool clearSchedulesError = false,
    String? announcementsError,
    bool clearAnnouncementsError = false,
    bool? isRefreshing,
  }) {
    return DashboardState(
      ministryId: ministryId ?? this.ministryId,
      isSchedulesLoading: isSchedulesLoading ?? this.isSchedulesLoading,
      isAnnouncementsLoading:
          isAnnouncementsLoading ?? this.isAnnouncementsLoading,
      schedules: schedules ?? this.schedules,
      announcements: announcements ?? this.announcements,
      schedulesError:
          clearSchedulesError ? null : (schedulesError ?? this.schedulesError),
      announcementsError: clearAnnouncementsError
          ? null
          : (announcementsError ?? this.announcementsError),
      isRefreshing: isRefreshing ?? this.isRefreshing,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DashboardState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          isSchedulesLoading == other.isSchedulesLoading &&
          isAnnouncementsLoading == other.isAnnouncementsLoading &&
          listEquals(schedules, other.schedules) &&
          listEquals(announcements, other.announcements) &&
          schedulesError == other.schedulesError &&
          announcementsError == other.announcementsError &&
          isRefreshing == other.isRefreshing;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      isSchedulesLoading.hashCode ^
      isAnnouncementsLoading.hashCode ^
      Object.hashAll(schedules) ^
      Object.hashAll(announcements) ^
      schedulesError.hashCode ^
      announcementsError.hashCode ^
      isRefreshing.hashCode;
}

class DashboardNotifier extends StateNotifier<DashboardState> {
  final DashboardRepository _repository;
  int _requestSequence = 0;

  DashboardNotifier({required DashboardRepository repository})
      : _repository = repository,
        super(const DashboardState());

  /// Sets ministry context and loads dashboard. If ministry changed, clears old data immediately.
  Future<void> loadForMinistry(String ministryId) async {
    final seq = ++_requestSequence;

    if (state.ministryId != ministryId) {
      state = DashboardState(
        ministryId: ministryId,
        isSchedulesLoading: true,
        isAnnouncementsLoading: true,
      );
    } else {
      state = state.copyWith(
        isSchedulesLoading: true,
        isAnnouncementsLoading: true,
        clearSchedulesError: true,
        clearAnnouncementsError: true,
      );
    }

    await Future.wait([
      _loadSchedules(ministryId, seq),
      _loadAnnouncements(ministryId, seq),
    ]);
  }

  /// Pull-to-refresh: reloads without blanking existing data.
  Future<void> refresh() async {
    final ministryId = state.ministryId;
    if (ministryId == null || state.isRefreshing) return;

    final seq = ++_requestSequence;
    state = state.copyWith(isRefreshing: true);

    await Future.wait([
      _loadSchedules(ministryId, seq, isRefresh: true),
      _loadAnnouncements(ministryId, seq, isRefresh: true),
    ]);

    if (seq == _requestSequence) {
      state = state.copyWith(isRefreshing: false);
    }
  }

  /// Reloads only schedules (e.g. from section retry button).
  Future<void> retrySchedules() async {
    final ministryId = state.ministryId;
    if (ministryId == null) return;
    final seq = ++_requestSequence;
    state = state.copyWith(
      isSchedulesLoading: true,
      clearSchedulesError: true,
    );
    await _loadSchedules(ministryId, seq);
  }

  /// Reloads only announcements (e.g. from section retry button).
  Future<void> retryAnnouncements() async {
    final ministryId = state.ministryId;
    if (ministryId == null) return;
    final seq = ++_requestSequence;
    state = state.copyWith(
      isAnnouncementsLoading: true,
      clearAnnouncementsError: true,
    );
    await _loadAnnouncements(ministryId, seq);
  }

  Future<void> _loadSchedules(
    String targetMinistryId,
    int seq, {
    bool isRefresh = false,
  }) async {
    try {
      final list = await _repository.getSchedules(targetMinistryId);
      if (seq != _requestSequence || state.ministryId != targetMinistryId) {
        return;
      }

      state = state.copyWith(
        schedules: list,
        isSchedulesLoading: false,
        clearSchedulesError: true,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence || state.ministryId != targetMinistryId) {
        return;
      }
      state = state.copyWith(
        schedulesError: e.message,
        isSchedulesLoading: false,
      );
    } catch (e) {
      if (seq != _requestSequence || state.ministryId != targetMinistryId) {
        return;
      }
      state = state.copyWith(
        schedulesError: 'Não foi possível carregar as escalas da equipe.',
        isSchedulesLoading: false,
      );
    }
  }

  Future<void> _loadAnnouncements(
    String targetMinistryId,
    int seq, {
    bool isRefresh = false,
  }) async {
    try {
      final list = await _repository.getAnnouncements(targetMinistryId);
      if (seq != _requestSequence || state.ministryId != targetMinistryId) {
        return;
      }

      state = state.copyWith(
        announcements: list,
        isAnnouncementsLoading: false,
        clearAnnouncementsError: true,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence || state.ministryId != targetMinistryId) {
        return;
      }
      state = state.copyWith(
        announcementsError: e.message,
        isAnnouncementsLoading: false,
      );
    } catch (e) {
      if (seq != _requestSequence || state.ministryId != targetMinistryId) {
        return;
      }
      state = state.copyWith(
        announcementsError: 'Não foi possível carregar os avisos da equipe.',
        isAnnouncementsLoading: false,
      );
    }
  }

  /// Creates an announcement, then refetches from server to converge with authoritative state
  /// while strictly preventing duplicate announcement entries.
  Future<Announcement> createAnnouncement(
    String ministryId,
    Map<String, dynamic> data,
  ) async {
    final created = await _repository.createAnnouncement(ministryId, data);
    if (state.ministryId == ministryId) {
      final seq = ++_requestSequence;
      try {
        final authoritativeList =
            await _repository.getAnnouncements(ministryId);
        if (seq == _requestSequence && state.ministryId == ministryId) {
          final seen = <String>{};
          final merged = <Announcement>[];
          if (seen.add(created.id)) {
            merged.add(created);
          }
          for (final a in authoritativeList) {
            if (seen.add(a.id)) {
              merged.add(a);
            }
          }
          for (final a in state.announcements) {
            if (seen.add(a.id)) {
              merged.add(a);
            }
          }
          state = state.copyWith(
            announcements: merged,
            clearAnnouncementsError: true,
          );
        }
      } catch (_) {
        if (seq == _requestSequence && state.ministryId == ministryId) {
          final existing =
              state.announcements.where((a) => a.id != created.id).toList();
          state = state.copyWith(
            announcements: [created, ...existing],
            clearAnnouncementsError: true,
          );
        }
      }
    }
    return created;
  }

  void reset() {
    ++_requestSequence;
    state = const DashboardState();
  }
}
