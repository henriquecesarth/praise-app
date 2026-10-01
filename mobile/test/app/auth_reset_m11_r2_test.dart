import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';

class StubMinistryRepo implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => [];
}

class StubDashboardRepo implements DashboardRepository {
  @override
  Future<List<Announcement>> getAnnouncements(String ministryId, {int limit = 20}) async => [];
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async => [];
  @override
  Future<Announcement> createAnnouncement(String ministryId, Map<String, dynamic> data) async =>
      throw UnimplementedError();
}

class StubScheduleRepo implements ScheduleRepository {
  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('M11-R2 Authenticated Reset Discipline', () {
    test('resetAuthenticatedFeatures resets all user-scoped feature state to pristine', () {
      final container = ProviderContainer(
        overrides: [
          ministryRepositoryProvider.overrideWithValue(StubMinistryRepo()),
          dashboardRepositoryProvider.overrideWithValue(StubDashboardRepo()),
          scheduleRepositoryProvider.overrideWithValue(StubScheduleRepo()),
        ],
      );

      // 1. Simulate active state for User A
      container.read(scheduleFormNotifierProvider.notifier).init(
            ministryId: 'min-alpha',
            boundUserId: 'user-a',
          );
      container.read(scheduleFormNotifierProvider.notifier).setTitle('Culto do User A');

      expect(container.read(scheduleFormNotifierProvider).ministryId, equals('min-alpha'));
      expect(container.read(scheduleFormNotifierProvider).boundUserId, equals('user-a'));
      expect(container.read(scheduleFormNotifierProvider).title, equals('Culto do User A'));
      expect(container.read(scheduleFormNotifierProvider).isInvalidated, isFalse);

      // 2. User A logs out -> triggers resetAuthenticatedFeatures
      resetAuthenticatedFeatures(container);

      // 3. Verify schedule form was reset (zero User A data remains)
      expect(container.read(scheduleFormNotifierProvider).boundUserId, isNot(equals('user-a')));
      expect(container.read(scheduleFormNotifierProvider).title, isNot(equals('Culto do User A')));

      // 4. Verify dashboard state was wiped
      expect(container.read(dashboardNotifierProvider).ministryId, isNull);
      expect(container.read(dashboardNotifierProvider).schedules, isEmpty);
      expect(container.read(dashboardNotifierProvider).announcements, isEmpty);

      // 5. Verify ministry context state was wiped
      expect(container.read(ministryContextNotifierProvider).selectedMinistry, isNull);
      expect(container.read(ministryContextNotifierProvider).availableMinistries, isEmpty);

      container.dispose();
    });
  });
}
