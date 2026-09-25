import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/shell/app_shell.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/ministry_empty_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/ministry_selector_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/widgets/ministry_switcher_sheet.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

class MockMinistryRepository extends Mock implements MinistryRepository {}

class MockPreferencesStorage extends Mock implements PreferencesStorage {}

class FakeDashboardRepo implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(
          String ministryId) async =>
      [];

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId,
          {int limit = 20}) async =>
      [];
}

class FakeScheduleRepo implements ScheduleRepository {
  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

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
  group('Ministry Screens & Shell Presentation', () {
    late MockAuthRepository authRepo;
    late MockMinistryRepository ministryRepo;
    late MockPreferencesStorage preferencesStorage;

    const testUser = AuthUser(
      id: 'usr_secret_uid_123',
      email: 'membro@louvaio.com',
      name: 'Membro LouvAIO',
    );

    const ministry1 = Ministry(
      id: 'min_1',
      name: 'Ministério Principal',
      role: 'admin',
    );
    const ministry2 = Ministry(
      id: 'min_2',
      name: 'Ministério Secundário',
      role: 'member',
    );

    setUp(() {
      authRepo = MockAuthRepository();
      ministryRepo = MockMinistryRepository();
      preferencesStorage = MockPreferencesStorage();

      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn('min_1');
      when(() => preferencesStorage.setSelectedMinistryId(any()))
          .thenAnswer((_) async {});
      when(() => authRepo.authStateChanges())
          .thenAnswer((_) => const Stream.empty());
      when(() => authRepo.signOut()).thenAnswer((_) async {});
    });

    testWidgets(
        'B. MinistryEmptyScreen displays informative message and actions',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            preferencesStorageProvider.overrideWithValue(preferencesStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            ministryRepositoryProvider.overrideWithValue(ministryRepo),
            ministryContextNotifierProvider.overrideWith((ref) {
              final n = MinistryContextNotifier(
                repository: ministryRepo,
                preferencesStorage: preferencesStorage,
              );
              n.state = const MinistryContextState(
                status: MinistryBootstrapStatus.empty,
                availableMinistries: [],
                selectedMinistry: null,
              );
              return n;
            }),
          ],
          child: const MaterialApp(home: MinistryEmptyScreen()),
        ),
      );

      expect(find.text('Nenhum ministério vinculado'), findsOneWidget);
      expect(
        find.textContaining(
            'Sua conta foi autenticada, mas ainda não está associada'),
        findsOneWidget,
      );
      expect(find.text('Atualizar'), findsOneWidget);
      expect(find.text('Sair da Conta'), findsOneWidget);
    });

    testWidgets(
        'D. MinistrySelectorScreen lists ministries and allows selection',
        (tester) async {
      final notifier = MinistryContextNotifier(
        repository: ministryRepo,
        preferencesStorage: preferencesStorage,
      );
      notifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.needsSelection,
        availableMinistries: [ministry1, ministry2],
        selectedMinistry: null,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            preferencesStorageProvider.overrideWithValue(preferencesStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            ministryRepositoryProvider.overrideWithValue(ministryRepo),
            ministryContextNotifierProvider.overrideWith((ref) => notifier),
          ],
          child: const MaterialApp(home: MinistrySelectorScreen()),
        ),
      );

      expect(find.text('Selecionar Ministério'), findsOneWidget);
      expect(find.text('Ministério Principal'), findsOneWidget);
      expect(find.text('Administrador'), findsOneWidget);
      expect(find.text('Ministério Secundário'), findsOneWidget);
      expect(find.text('Membro'), findsOneWidget);

      // Tap on second ministry
      await tester.tap(find.text('Ministério Secundário'));
      await tester.pump();

      expect(notifier.state.selectedMinistry, ministry2);
      expect(notifier.state.isReady, isTrue);
      verify(() => preferencesStorage.setSelectedMinistryId('min_2')).called(1);
    });

    testWidgets(
        'MinistrySwitcherSheet displays ministries and switches selection',
        (tester) async {
      final notifier = MinistryContextNotifier(
        repository: ministryRepo,
        preferencesStorage: preferencesStorage,
      );
      notifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: [ministry1, ministry2],
        selectedMinistry: ministry1,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            preferencesStorageProvider.overrideWithValue(preferencesStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            ministryRepositoryProvider.overrideWithValue(ministryRepo),
            ministryContextNotifierProvider.overrideWith((ref) => notifier),
          ],
          child: const MaterialApp(
            home: Scaffold(body: MinistrySwitcherSheet()),
          ),
        ),
      );

      expect(find.text('Trocar Ministério'), findsOneWidget);
      expect(find.text('Ministério Principal'), findsOneWidget);
      expect(find.text('Ministério Secundário'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);

      // Switch to ministry 2
      await tester.tap(find.text('Ministério Secundário'));
      await tester.pump();

      expect(notifier.state.selectedMinistry, ministry2);
    });

    testWidgets(
        'M. AppShell renders compact phone layout with bottom NavigationBar',
        (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.production,
                apiBaseUrl: 'https://api.louvaio.com/api/v1',
              ),
            ),
            preferencesStorageProvider.overrideWithValue(preferencesStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
            scheduleRepositoryProvider.overrideWithValue(FakeScheduleRepo()),
            authNotifierProvider.overrideWith((ref) {
              final n = AuthNotifier(authRepo);
              n.state = const AuthState.authenticated(testUser);
              return n;
            }),
            ministryContextNotifierProvider.overrideWith((ref) {
              final n = MinistryContextNotifier(
                repository: ministryRepo,
                preferencesStorage: preferencesStorage,
              );
              n.state = const MinistryContextState(
                status: MinistryBootstrapStatus.ready,
                availableMinistries: [ministry1],
                selectedMinistry: ministry1,
              );
              return n;
            }),
          ],
          child: const MaterialApp(home: AppShell()),
        ),
      );

      await tester.pumpAndSettle();

      // Renders bottom NavigationBar
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
      expect(find.text('Início'), findsOneWidget);
      expect(find.text('Escalas'), findsOneWidget);
      expect(find.text('Repertório'), findsOneWidget);
      expect(find.text('Perfil'), findsOneWidget);

      // Home shows greeting and selected ministry
      expect(find.textContaining('Olá, Membro LouvAIO'), findsOneWidget);
      expect(find.text('Ministério Principal'), findsWidgets);
      expect(find.text('ADMINISTRADOR'), findsOneWidget);
    });

    testWidgets(
        'N. AppShell renders tablet layout with side NavigationRail and navigation works',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 768);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.production,
                apiBaseUrl: 'https://api.louvaio.com/api/v1',
              ),
            ),
            preferencesStorageProvider.overrideWithValue(preferencesStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
            scheduleRepositoryProvider.overrideWithValue(FakeScheduleRepo()),
            authNotifierProvider.overrideWith((ref) {
              final n = AuthNotifier(authRepo);
              n.state = const AuthState.authenticated(testUser);
              return n;
            }),
            ministryContextNotifierProvider.overrideWith((ref) {
              final n = MinistryContextNotifier(
                repository: ministryRepo,
                preferencesStorage: preferencesStorage,
              );
              n.state = const MinistryContextState(
                status: MinistryBootstrapStatus.ready,
                availableMinistries: [ministry1, ministry2],
                selectedMinistry: ministry1,
              );
              return n;
            }),
          ],
          child: const MaterialApp(home: AppShell()),
        ),
      );

      await tester.pumpAndSettle();

      // Tablet renders NavigationRail, NOT NavigationBar
      expect(find.byType(NavigationRail), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);

      // Navigate to Escalas tab
      await tester.tap(find.text('Escalas'));
      await tester.pumpAndSettle();
      expect(find.text('Próximas'), findsOneWidget);
      expect(find.text('Anteriores'), findsOneWidget);

      // Navigate to Repertório tab
      await tester.tap(find.text('Repertório'));
      await tester.pumpAndSettle();
      expect(find.text('Repertório Musical'), findsOneWidget);

      // Navigate to Perfil tab
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      // O. Profile displays authoritative identity and context
      expect(find.text('Membro LouvAIO'), findsOneWidget);
      expect(find.text('membro@louvaio.com'), findsOneWidget);
      expect(find.text('Contexto do Ministério'), findsOneWidget);
      expect(find.text('Sair da Conta'), findsOneWidget);

      // O. Production UI must NOT expose technical UID
      expect(find.textContaining('usr_secret_uid_123'), findsNothing);

      // P. Tapping Sair da Conta calls auth logout
      await tester.tap(find.text('Sair da Conta'));
      await tester.pump();
      verify(() => authRepo.signOut()).called(1);
    });
  });
}
