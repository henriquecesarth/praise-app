import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/dashboard/presentation/dashboard_view.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';

class FakeDashboardRepo implements DashboardRepository {
  List<DashboardScheduleSummary> schedules = [];
  List<Announcement> announcements = [];
  Exception? schedulesError;
  Exception? announcementsError;

  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async {
    if (schedulesError != null) throw schedulesError!;
    return schedules;
  }

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId,
      {int limit = 20}) async {
    if (announcementsError != null) throw announcementsError!;
    return announcements;
  }
}

class FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => 'fake-token';
  @override
  Future<AuthUser> getMe() async => const AuthUser(
        id: 'user_1',
        email: 'henrique@louvaio.com',
        name: 'Henrique Teixeira',
      );
  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

void main() {
  const testMinistry = Ministry(
    id: 'min_test_1',
    name: 'Ministério Central',
    slug: 'ministerio-central',
    role: 'admin',
    ownerUserId: 'user_1',
  );

  const testUser = AuthUser(
    id: 'user_1',
    email: 'henrique@louvaio.com',
    name: 'Henrique Teixeira',
  );

  Widget createWidget({
    required FakeDashboardRepo repo,
    Ministry? ministry = testMinistry,
    bool hasMultiple = true,
    ValueChanged<int>? onNavigateToTab,
    Size size = const Size(400, 800),
  }) {
    final authRepo = FakeAuthRepo();
    final authNotifier = AuthNotifier(authRepo)
      ..state = const AuthState.authenticated(testUser);

    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
          ),
        ),
        authRepositoryProvider.overrideWithValue(authRepo),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        dashboardRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: size),
          child: Scaffold(
            body: DashboardView(
              selectedMinistry: ministry,
              hasMultipleMinistries: hasMultiple,
              onNavigateToTab: onNavigateToTab ?? (_) {},
            ),
          ),
        ),
      ),
    );
  }

  group('DashboardView Presentation', () {
    late FakeDashboardRepo repo;

    setUp(() {
      repo = FakeDashboardRepo();
    });

    testWidgets(
        'renders greeting, ministry banner and empty states when no data exists',
        (tester) async {
      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.textContaining('PAINEL DO INTEGRANTE'), findsOneWidget);
      expect(find.textContaining('Ministério Central'), findsOneWidget);
      expect(find.text('ADMINISTRADOR'), findsOneWidget);
      expect(find.text('Nenhuma próxima escala agendada.'), findsOneWidget);
      expect(find.text('Nenhum aviso publicado no momento.'), findsOneWidget);
    });

    testWidgets('renders upcoming schedules and announcements correctly',
        (tester) async {
      final now = DateTime.now();
      final futureDateStr =
          '${now.year}-${(now.month).toString().padLeft(2, '0')}-${(now.day + 2).toString().padLeft(2, '0')}';

      repo.schedules = [
        DashboardScheduleSummary(
          id: 'sch_1',
          ministryId: 'min_test_1',
          title: 'Culto de Domingo',
          date: futureDateStr,
          time: '19:00',
          participants: const [
            DashboardScheduleParticipant(
                id: 'p1', name: 'Ana', role: 'Vocal', confirmed: true),
          ],
        ),
      ];
      repo.announcements = [
        const Announcement(
          id: 'ann_1',
          ministryId: 'min_test_1',
          title: 'Ensaio Extra',
          content: 'Quinta-feira às 20h.',
          author: 'Pr. Marcos',
          important: true,
        ),
      ];

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Culto de Domingo'), findsOneWidget);
      expect(find.text('Ensaio Extra'), findsOneWidget);
      expect(find.text('Quinta-feira às 20h.'), findsOneWidget);
      expect(find.text('IMPORTANTE'), findsOneWidget);
      expect(find.text('Pr. Marcos'), findsOneWidget);
    });

    testWidgets('tap "Ver todas as escalas" navigates to tab index 1',
        (tester) async {
      int? navigatedIndex;

      await tester.pumpWidget(createWidget(
        repo: repo,
        onNavigateToTab: (idx) => navigatedIndex = idx,
      ));
      await tester.pumpAndSettle();

      final verTodasBtn = find.text('Ver todas');
      expect(verTodasBtn, findsOneWidget);

      await tester.tap(verTodasBtn);
      await tester.pumpAndSettle();

      expect(navigatedIndex, equals(1));
    });

    testWidgets(
        'renders error alert with retry for schedules when announcements succeed',
        (tester) async {
      repo.schedulesError = Exception('Falha de rede nas escalas.');
      repo.announcements = [
        const Announcement(
          id: 'ann_1',
          ministryId: 'min_test_1',
          title: 'Aviso Funciona',
          content: 'Avisos carregaram perfeitamente.',
        ),
      ];

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      // Schedules section shows error
      expect(find.textContaining('Não foi possível carregar as escalas'),
          findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Announcements section rendered successfully
      expect(find.text('Aviso Funciona'), findsOneWidget);
    });

    testWidgets(
        'renders responsive side-by-side layout on tablet width (>= 600dp)',
        (tester) async {
      tester.view.physicalSize = const Size(1200, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      repo.announcements = [
        const Announcement(
            id: 'a1',
            ministryId: 'min_test_1',
            title: 'Aviso Tablet',
            content: 'Conteúdo'),
      ];

      // Tablet size (1200 x 800)
      await tester.pumpWidget(createWidget(
        repo: repo,
        size: const Size(1200, 800),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Próximas Escalas'), findsOneWidget);
      expect(find.text('Avisos da Equipe'), findsOneWidget);
      expect(find.text('Aviso Tablet'), findsOneWidget);
    });

    testWidgets('production UI contains NO raw UID or technical API URLs',
        (tester) async {
      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.textContaining('XnpmlGGY6PZCRT90U0hYlLrEwjf2'), findsNothing);
      expect(find.textContaining('http://'), findsNothing);
      expect(find.textContaining('https://'), findsNothing);
    });
  });
}
