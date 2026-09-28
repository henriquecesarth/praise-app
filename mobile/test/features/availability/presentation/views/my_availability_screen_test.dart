import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/availability_providers.dart';
import 'package:louvaio_mobile/features/availability/presentation/views/my_availability_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';

class FakeScreenAvailabilityRepository implements AvailabilityRepository {
  List<MemberAvailability> items = [];
  String? nextCursor;
  bool shouldThrowList = false;
  bool shouldThrowDelete = false;
  String? lastDeletedId;
  int listCalls = 0;

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(
    String ministryId, {
    int limit = 50,
    String? cursor,
  }) async {
    listCalls++;
    if (shouldThrowList) {
      throw const AppFailure(message: 'Erro ao carregar lista.');
    }
    return AvailabilityListResponse(
      data: items,
      nextCursor: nextCursor,
    );
  }

  @override
  Future<MemberAvailability> createMyAvailability(
    String ministryId,
    CreateAvailabilityPayload payload,
  ) async {
    throw UnimplementedError();
  }

  @override
  Future<MemberAvailability> updateMyAvailability(
    String ministryId,
    String id,
    UpdateAvailabilityPayload payload,
  ) async {
    throw UnimplementedError();
  }

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) async {
    lastDeletedId = id;
    if (shouldThrowDelete) {
      throw const AppFailure(message: 'Erro ao remover item.', statusCode: 400);
    }
  }
}

class FakeMinistryRepository implements MinistryRepository {
  List<Ministry> ministries = [];
  @override
  Future<List<Ministry>> getMyMinistries() async => ministries;
}

class FakePreferencesStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}

  @override
  String? getSelectedMinistryId() => null;

  @override
  String? getThemeMode() => null;

  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}

  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

MemberAvailability createSampleItem({
  required String id,
  required String ministryId,
  String startDate = '2026-10-04',
  String endDate = '2026-10-04',
  bool allDay = true,
  String? reason,
}) {
  return MemberAvailability(
    id: id,
    ministryId: ministryId,
    memberId: 'mem_1',
    startDate: startDate,
    endDate: endDate,
    allDay: allDay,
    startsAt: '$startDate"T00:00:00',
    endsAt: '$endDate"T23:59:59',
    reason: reason,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  );
}

void main() {
  late FakeScreenAvailabilityRepository fakeRepo;
  late FakeMinistryRepository fakeMinistryRepo;
  late FakePreferencesStorage fakeStorage;

  setUp(() {
    fakeRepo = FakeScreenAvailabilityRepository();
    fakeMinistryRepo = FakeMinistryRepository();
    fakeStorage = FakePreferencesStorage();
  });

  Widget buildTestApp({
    required String ministryId,
    double width = 400,
    double height = 800,
  }) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        preferencesStorageProvider.overrideWithValue(fakeStorage),
        ministryRepositoryProvider.overrideWithValue(fakeMinistryRepo),
        availabilityRepositoryProvider.overrideWithValue(fakeRepo),
      ],
      child: MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: Size(width, height)),
          child: MyAvailabilityScreen(ministryId: ministryId),
        ),
      ),
    );
  }

  group('MyAvailabilityScreen Presentation', () {
    testWidgets('renders empty state when user has no availability periods',
        (tester) async {
      fakeRepo.items = [];

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1'));
      await tester.pumpAndSettle();

      expect(find.text('Minha Indisponibilidade'), findsOneWidget);
      expect(find.text('Nenhuma indisponibilidade'), findsOneWidget);
      expect(
        find.textContaining('Você está disponível para todas as escalas'),
        findsOneWidget,
      );
      expect(find.text('Adicionar Indisponibilidade'), findsOneWidget);
    });

    testWidgets('renders error state and handles retry button', (tester) async {
      fakeRepo.shouldThrowList = true;

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1'));
      await tester.pumpAndSettle();

      expect(find.text('Erro ao carregar lista.'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Now fix and tap retry
      fakeRepo.shouldThrowList = false;
      fakeRepo.items = [createSampleItem(id: 'a1', ministryId: 'min_1')];

      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Erro ao carregar lista.'), findsNothing);
      expect(find.text('04/10/2026 • Dia inteiro'), findsOneWidget);
    });

    testWidgets('renders items and handles delete confirmation workflow',
        (tester) async {
      fakeRepo.items = [
        createSampleItem(
          id: 'del_1',
          ministryId: 'min_1',
          reason: 'Consulta médica',
        ),
      ];

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1'));
      await tester.pumpAndSettle();

      expect(find.text('04/10/2026 • Dia inteiro'), findsOneWidget);
      expect(find.text('Consulta médica'), findsOneWidget);

      // Tap delete button on card
      await tester.tap(find.byTooltip('Remover'));
      await tester.pumpAndSettle();

      // Verify confirmation dialog appears
      expect(find.text('Remover Indisponibilidade'), findsOneWidget);
      expect(
        find.textContaining('Deseja realmente remover este período'),
        findsOneWidget,
      );

      // Confirm deletion
      await tester.tap(find.widgetWithText(FilledButton, 'Remover'));
      await tester.pumpAndSettle();

      // Repository called
      expect(fakeRepo.lastDeletedId, 'del_1');

      // SnackBar shown and item removed
      expect(
          find.text('Período de indisponibilidade removido.'), findsOneWidget);
      expect(find.text('04/10/2026 • Dia inteiro'), findsNothing);
      expect(find.text('Nenhuma indisponibilidade'), findsOneWidget);
    });

    testWidgets('handles delete cancellation cleanly without repository call',
        (tester) async {
      fakeRepo.items = [createSampleItem(id: 'del_2', ministryId: 'min_1')];

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Remover'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastDeletedId, isNull);
      expect(find.text('04/10/2026 • Dia inteiro'), findsOneWidget);
    });

    testWidgets(
        'renders pagination "Carregar mais" button when hasMore is true',
        (tester) async {
      fakeRepo.items = [createSampleItem(id: 'a1', ministryId: 'min_1')];
      fakeRepo.nextCursor = 'page_2';

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1'));
      await tester.pumpAndSettle();

      expect(find.text('Carregar mais'), findsOneWidget);

      // Setup next page
      fakeRepo.items = [
        createSampleItem(
            id: 'a2',
            ministryId: 'min_1',
            startDate: '2026-10-15',
            endDate: '2026-10-15'),
      ];
      fakeRepo.nextCursor = null;

      await tester.tap(find.text('Carregar mais'));
      await tester.pumpAndSettle();

      expect(find.text('15/10/2026 • Dia inteiro'), findsOneWidget);
      expect(find.text('Carregar mais'), findsNothing);
    });

    testWidgets(
        'renders tablet layout with constrained width without stretching',
        (tester) async {
      fakeRepo.items = [createSampleItem(id: 'a1', ministryId: 'min_1')];

      // Tablet landscape width 1200
      await tester.pumpWidget(
          buildTestApp(ministryId: 'min_1', width: 1200, height: 800));
      await tester.pumpAndSettle();

      expect(find.text('Minha Indisponibilidade'), findsOneWidget);
      expect(find.text('04/10/2026 • Dia inteiro'), findsOneWidget);

      final constrainedBoxFinder = find.byWidgetPredicate(
        (widget) =>
            widget is ConstrainedBox && widget.constraints.maxWidth == 720,
      );
      expect(constrainedBoxFinder, findsOneWidget);
    });

    testWidgets('pops screen when active ministry changes to another ministry',
        (tester) async {
      const ministryA = Ministry(id: 'min_A', name: 'Alpha', role: 'member');
      const ministryB = Ministry(id: 'min_B', name: 'Beta', role: 'member');
      fakeMinistryRepo.ministries = [ministryA, ministryB];

      final container = ProviderContainer(
        overrides: [
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(
              env: AppEnv.development,
              apiBaseUrl: 'http://localhost:3000/api/v1',
            ),
          ),
          preferencesStorageProvider.overrideWithValue(fakeStorage),
          ministryRepositoryProvider.overrideWithValue(fakeMinistryRepo),
          availabilityRepositoryProvider.overrideWithValue(fakeRepo),
        ],
      );

      // Select Min A
      await container
          .read(ministryContextNotifierProvider.notifier)
          .bootstrap();
      container
          .read(ministryContextNotifierProvider.notifier)
          .selectMinistry(ministryA);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: Navigator(
              onGenerateRoute: (_) => MaterialPageRoute(
                builder: (context) => Scaffold(
                  body: ElevatedButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) =>
                              const MyAvailabilityScreen(ministryId: 'min_A'),
                        ),
                      );
                    },
                    child: const Text('Open Availability'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      // Open screen
      await tester.tap(find.text('Open Availability'));
      await tester.pumpAndSettle();

      expect(find.text('Minha Indisponibilidade'), findsOneWidget);

      // Now switch active ministry to min_B
      container
          .read(ministryContextNotifierProvider.notifier)
          .selectMinistry(ministryB);
      await tester.pumpAndSettle();

      // Screen popped!
      expect(find.text('Open Availability'), findsOneWidget);
    });
  });
}
