import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_list_controller.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedules_view.dart';
import 'package:louvaio_mobile/features/schedules/presentation/widgets/schedule_card.dart';

class FakeScheduleRepo implements ScheduleRepository {
  List<ScheduleSummary> schedules = [];
  Exception? listError;
  int listCalls = 0;

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async {
    listCalls++;
    if (listError != null) throw listError!;
    return schedules;
  }

  @override
  Future<ScheduleDetail> getScheduleDetail(
          String ministryId, String scheduleId) async =>
      const ScheduleDetail(
        id: 's1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-01',
      );

  @override
  Future<ScheduleDetail> confirmParticipation(
          String ministryId, String scheduleId, bool confirmed) async =>
      const ScheduleDetail(
        id: 's1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-01',
      );

  @override
  Future<List<ScheduleComment>> getComments(
          String ministryId, String scheduleId) async =>
      [];

  @override
  Future<ScheduleComment> postComment(
          String ministryId, String scheduleId, String content) async =>
      const ScheduleComment(
        id: 'c1',
        scheduleId: 's1',
        ministryId: 'min_1',
        userId: 'u1',
        userName: 'User',
        content: 'content',
        createdAt: '2026-10-01',
      );
}

void main() {
  late FakeScheduleRepo fakeRepo;

  setUp(() {
    fakeRepo = FakeScheduleRepo();
  });

  Widget createSubject({String? ministryId = 'min_1'}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        scheduleRepositoryProvider.overrideWithValue(fakeRepo),
        scheduleListNotifierProvider.overrideWith((ref) {
          return ScheduleListNotifier(repository: fakeRepo);
        }),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SchedulesView(ministryId: ministryId),
        ),
      ),
    );
  }

  group('SchedulesView Presentation', () {
    testWidgets('renders tabs Próximas and Anteriores', (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Próximas'), findsOneWidget);
      expect(find.text('Anteriores'), findsOneWidget);
    });

    testWidgets('renders empty state when there are no schedules',
        (tester) async {
      fakeRepo.schedules = [];
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Nenhuma escala próxima encontrada.'), findsOneWidget);

      // Switch to Anteriores
      await tester.tap(find.text('Anteriores'));
      await tester.pumpAndSettle();
      expect(find.text('Nenhuma escala anterior registrada.'), findsOneWidget);
    });

    testWidgets('renders upcoming in Próximas and past in Anteriores',
        (tester) async {
      fakeRepo.schedules = [
        const ScheduleSummary(
          id: 's_past',
          ministryId: 'min_1',
          title: 'Culto Passado',
          date: '2020-01-01',
          time: '19:00',
        ),
        const ScheduleSummary(
          id: 's_upcoming',
          ministryId: 'min_1',
          title: 'Culto Próximo',
          date: '2099-01-01',
          time: '19:00',
        ),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Próximas tab shows upcoming
      expect(find.text('Culto Próximo'), findsOneWidget);
      expect(find.text('Culto Passado'), findsNothing);

      // Switch to Anteriores
      await tester.tap(find.text('Anteriores'));
      await tester.pumpAndSettle();

      expect(find.text('Culto Passado'), findsOneWidget);
      expect(find.text('Culto Próximo'), findsNothing);
    });

    testWidgets('displays error state and retry triggers reload',
        (tester) async {
      fakeRepo.listError =
          const AppFailure(message: 'Erro ao carregar escalas.');

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Erro ao carregar escalas.'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Fix error and retry
      fakeRepo.listError = null;
      fakeRepo.schedules = [
        const ScheduleSummary(
          id: 's_new',
          ministryId: 'min_1',
          title: 'Escala Recuperada',
          date: '2099-01-01',
          time: '19:00',
        ),
      ];

      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Escala Recuperada'), findsOneWidget);
    });

    testWidgets('renders responsive layout on tablet width without crash',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 768);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      fakeRepo.schedules = [
        const ScheduleSummary(
          id: 's_tablet',
          ministryId: 'min_1',
          title: 'Culto Tablet',
          date: '2099-01-01',
          time: '19:00',
        ),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Culto Tablet'), findsOneWidget);
      expect(find.byType(ScheduleCard), findsOneWidget);
    });

    testWidgets('empty ministryId displays prompt to select ministry',
        (tester) async {
      await tester.pumpWidget(createSubject(ministryId: null));
      await tester.pumpAndSettle();

      expect(find.text('Selecione um ministério para ver as escalas.'),
          findsOneWidget);
    });
  });
}
