import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/dashboard/presentation/controllers/dashboard_controller.dart';

class FakeDashboardRepository implements DashboardRepository {
  List<DashboardScheduleSummary> schedulesToReturn = [];
  List<Announcement> announcementsToReturn = [];
  Exception? schedulesException;
  Exception? announcementsException;
  String? lastMinistryIdSchedules;
  String? lastMinistryIdAnnouncements;

  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async {
    lastMinistryIdSchedules = ministryId;
    if (schedulesException != null) throw schedulesException!;
    return schedulesToReturn;
  }

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId,
      {int limit = 20}) async {
    lastMinistryIdAnnouncements = ministryId;
    if (announcementsException != null) throw announcementsException!;
    return announcementsToReturn;
  }
}

void main() {
  group('DashboardNotifier', () {
    late FakeDashboardRepository repository;
    late DashboardNotifier notifier;

    setUp(() {
      repository = FakeDashboardRepository();
      notifier = DashboardNotifier(repository: repository);
    });

    test('initial state is uninitialized with empty lists', () {
      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.schedules, isEmpty);
      expect(notifier.state.announcements, isEmpty);
      expect(notifier.state.isSchedulesLoading, isFalse);
      expect(notifier.state.isAnnouncementsLoading, isFalse);
    });

    test('loadForMinistry loads schedules and announcements concurrently',
        () async {
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
          id: 's1',
          ministryId: 'm1',
          title: 'Culto 1',
          date: '2026-09-30',
        ),
      ];
      repository.announcementsToReturn = [
        const Announcement(
          id: 'a1',
          ministryId: 'm1',
          title: 'Aviso 1',
          content: 'Conteúdo 1',
        ),
      ];

      await notifier.loadForMinistry('m1');

      expect(notifier.state.ministryId, equals('m1'));
      expect(notifier.state.schedules.length, equals(1));
      expect(notifier.state.announcements.length, equals(1));
      expect(notifier.state.isSchedulesLoading, isFalse);
      expect(notifier.state.isAnnouncementsLoading, isFalse);
      expect(repository.lastMinistryIdSchedules, equals('m1'));
      expect(repository.lastMinistryIdAnnouncements, equals('m1'));
    });

    test('upcomingSchedules filters past schedules and sorts nearest first',
        () async {
      final now = DateTime(2026, 9, 25, 12, 0);

      notifier.state = notifier.state.copyWith(
        schedules: [
          const DashboardScheduleSummary(
            id: 'far_future',
            ministryId: 'm1',
            title: 'Longe',
            date: '2026-10-15',
            time: '19:00',
          ),
          const DashboardScheduleSummary(
            id: 'past',
            ministryId: 'm1',
            title: 'Passado',
            date: '2026-09-20',
            time: '19:00',
          ),
          const DashboardScheduleSummary(
            id: 'near_future',
            ministryId: 'm1',
            title: 'Perto',
            date: '2026-09-28',
            time: '20:00',
          ),
          const DashboardScheduleSummary(
            id: 'same_day_earlier',
            ministryId: 'm1',
            title: 'Mesmo Dia Cedo',
            date: '2026-09-28',
            time: '10:00',
          ),
        ],
      );

      final upcoming = notifier.state.upcomingSchedules(now);

      expect(upcoming.length, equals(3));
      // Excludes 'past' (2026-09-20)
      expect(upcoming.any((s) => s.id == 'past'), isFalse);
      // Nearest first
      expect(upcoming[0].id, equals('same_day_earlier')); // 2026-09-28 10:00
      expect(upcoming[1].id, equals('near_future')); // 2026-09-28 20:00
      expect(upcoming[2].id, equals('far_future')); // 2026-10-15 19:00
    });

    test('ministry switch immediately clears old dashboard data without flash',
        () async {
      // 1. Load for Ministry A
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
          id: 's_a',
          ministryId: 'min_a',
          title: 'Schedule A',
          date: '2026-09-30',
        ),
      ];
      repository.announcementsToReturn = [
        const Announcement(
          id: 'a_a',
          ministryId: 'min_a',
          title: 'Announcement A',
          content: 'A',
        ),
      ];

      await notifier.loadForMinistry('min_a');
      expect(notifier.state.schedules.first.title, equals('Schedule A'));

      // 2. Prepare Ministry B data
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
          id: 's_b',
          ministryId: 'min_b',
          title: 'Schedule B',
          date: '2026-10-01',
        ),
      ];
      repository.announcementsToReturn = [];

      // 3. Switch to Ministry B
      final future = notifier.loadForMinistry('min_b');

      // Immediate state check: old A data is gone, ministryId is min_b
      expect(notifier.state.ministryId, equals('min_b'));
      expect(notifier.state.schedules, isEmpty);
      expect(notifier.state.announcements, isEmpty);
      expect(notifier.state.isSchedulesLoading, isTrue);

      await future;

      expect(notifier.state.schedules.first.title, equals('Schedule B'));
      expect(notifier.state.isSchedulesLoading, isFalse);
    });

    test('partial failure: schedules succeed while announcements fail',
        () async {
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
          id: 's1',
          ministryId: 'm1',
          title: 'Escala OK',
          date: '2026-09-30',
        ),
      ];
      repository.announcementsException = const AppFailure(
        message: 'Falha ao carregar avisos.',
        statusCode: 500,
      );

      await notifier.loadForMinistry('m1');

      expect(notifier.state.schedules.length, equals(1));
      expect(notifier.state.schedulesError, isNull);
      expect(notifier.state.announcements, isEmpty);
      expect(notifier.state.announcementsError,
          equals('Falha ao carregar avisos.'));
    });

    test('partial failure: announcements succeed while schedules fail',
        () async {
      repository.schedulesException = const AppFailure(
        message: 'Acesso negado às escalas.',
        statusCode: 403,
      );
      repository.announcementsToReturn = [
        const Announcement(
          id: 'a1',
          ministryId: 'm1',
          title: 'Aviso OK',
          content: 'OK',
        ),
      ];

      await notifier.loadForMinistry('m1');

      expect(notifier.state.schedules, isEmpty);
      expect(
          notifier.state.schedulesError, equals('Acesso negado às escalas.'));
      expect(notifier.state.announcements.length, equals(1));
      expect(notifier.state.announcementsError, isNull);
    });

    test('pull-to-refresh preserves existing data during reload', () async {
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
          id: 's1',
          ministryId: 'm1',
          title: 'Escala 1',
          date: '2026-09-30',
        ),
      ];
      repository.announcementsToReturn = [
        const Announcement(
          id: 'a1',
          ministryId: 'm1',
          title: 'Aviso 1',
          content: 'C1',
        ),
      ];

      await notifier.loadForMinistry('m1');

      // Update backend data
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
          id: 's1',
          ministryId: 'm1',
          title: 'Escala 1 Atualizada',
          date: '2026-09-30',
        ),
      ];

      await notifier.refresh();

      expect(
          notifier.state.schedules.first.title, equals('Escala 1 Atualizada'));
      expect(notifier.state.isRefreshing, isFalse);
    });

    test('section retries re-trigger only failed section', () async {
      repository.schedulesException =
          const AppFailure(message: 'Erro temporário.');
      repository.announcementsToReturn = [
        const Announcement(
            id: 'a1', ministryId: 'm1', title: 'A1', content: 'C1'),
      ];

      await notifier.loadForMinistry('m1');
      expect(notifier.state.schedulesError, isNotNull);

      // Fix error and retry only schedules
      repository.schedulesException = null;
      repository.schedulesToReturn = [
        const DashboardScheduleSummary(
            id: 's1',
            ministryId: 'm1',
            title: 'Recuperado',
            date: '2026-09-30'),
      ];

      await notifier.retrySchedules();

      expect(notifier.state.schedulesError, isNull);
      expect(notifier.state.schedules.first.title, equals('Recuperado'));
      expect(notifier.state.announcements.length, equals(1));
    });
  });
}
