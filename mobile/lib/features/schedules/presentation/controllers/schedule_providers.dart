import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/schedule_repository.dart';
import '../controllers/schedule_list_controller.dart';
import '../controllers/schedule_detail_controller.dart';

/// Provider for the schedule HTTP repository.
final scheduleRepositoryProvider = Provider<ScheduleRepository>((ref) {
  return HttpScheduleRepository(
    apiClient: ref.watch(apiClientProvider),
  );
});

/// Ministry-scoped schedule list provider.
/// Keyed by ministryId — invalidated automatically on ministry switch.
final scheduleListNotifierProvider =
    StateNotifierProvider<ScheduleListNotifier, ScheduleListState>((ref) {
  return ScheduleListNotifier(
    repository: ref.watch(scheduleRepositoryProvider),
  );
});

/// Schedule detail provider.
/// Keyed by ministryId + scheduleId — reset when either changes.
final scheduleDetailNotifierProvider =
    StateNotifierProvider<ScheduleDetailNotifier, ScheduleDetailState>((ref) {
  return ScheduleDetailNotifier(
    repository: ref.watch(scheduleRepositoryProvider),
  );
});

/// Comments provider.
/// Keyed by ministryId + scheduleId — reset when either changes.
final commentsNotifierProvider =
    StateNotifierProvider<CommentsNotifier, CommentsState>((ref) {
  return CommentsNotifier(
    repository: ref.watch(scheduleRepositoryProvider),
  );
});
