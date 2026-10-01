import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/dashboard/presentation/controllers/dashboard_controller.dart';
import 'package:louvaio_mobile/features/dashboard/presentation/widgets/announcement_form_dialog.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';

class FakeDashboardRepo implements DashboardRepository {
  int getAnnouncementsCalls = 0;
  List<Announcement> serverAnnouncements = [];
  Map<String, dynamic>? lastCreatedData;

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId, {int limit = 20}) async {
    getAnnouncementsCalls++;
    return serverAnnouncements;
  }

  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async => [];

  @override
  Future<Announcement> createAnnouncement(String ministryId, Map<String, dynamic> data) async {
    lastCreatedData = data;
    final created = Announcement(
      id: 'ann-server-1',
      ministryId: ministryId,
      title: data['title'] as String? ?? '',
      content: data['content'] as String? ?? '',
      important: data['important'] as bool? ?? false,
    );
    // Simulate server adding it to its store
    serverAnnouncements = [created, ...serverAnnouncements];
    return created;
  }
}

class FakeMinistryRepo implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => [];
}

class FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => 'token';
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<UserCredential> signInWithEmailAndPassword({required String email, required String password}) => throw UnimplementedError();
  @override
  Future<AuthUser> signUp({required String name, required String email, required String password}) => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

void main() {
  const minAlpha = Ministry(
    id: 'min-alpha',
    name: 'Ministério Alpha',
    role: 'admin',
  );

  const minBeta = Ministry(
    id: 'min-beta',
    name: 'Ministério Beta',
    role: 'admin',
  );

  const testUserA = AuthUser(
    id: 'user-a',
    name: 'User Alpha',
    email: 'alpha@louvaio.com',
  );

  const testUserB = AuthUser(
    id: 'user-b',
    name: 'User Beta',
    email: 'beta@louvaio.com',
  );

  group('M11-R2 AnnouncementFormDialog Tenant & Session Protection', () {
    testWidgets('dialog auto-closes when active ministry switches away from bound ministry', (tester) async {
      late MinistryContextNotifier ministryNotifier;
      final authNotifier = AuthNotifier(FakeAuthRepo())
        ..state = const AuthState.authenticated(testUserA);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
              ),
            ),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            ministryRepositoryProvider.overrideWithValue(FakeMinistryRepo()),
          ],
          child: Consumer(
            builder: (context, ref, child) {
              ministryNotifier = ref.read(ministryContextNotifierProvider.notifier);
              return MaterialApp(
                home: Scaffold(
                  body: Builder(
                    builder: (ctx) => ElevatedButton(
                      onPressed: () {
                        showDialog(
                          context: ctx,
                          builder: (_) => const AnnouncementFormDialog(ministryId: 'min-alpha'),
                        );
                      },
                      child: const Text('Open Dialog'),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      );

      // Set initial ministry to Alpha
      ministryNotifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        selectedMinistry: minAlpha,
      );
      await tester.pumpAndSettle();

      // Open the dialog bound to min-alpha
      await tester.tap(find.text('Open Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Novo Comunicado'), findsOneWidget);

      // Now active ministry changes to min-beta
      ministryNotifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        selectedMinistry: minBeta,
      );
      await tester.pumpAndSettle();

      // The dialog MUST close safely without offering continue editing
      expect(find.text('Novo Comunicado'), findsNothing);
    });

    testWidgets('dialog auto-closes when authenticated user changes', (tester) async {
      final authNotifier = AuthNotifier(FakeAuthRepo())
        ..state = const AuthState.authenticated(testUserA);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
              ),
            ),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            ministryRepositoryProvider.overrideWithValue(FakeMinistryRepo()),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: ctx,
                      builder: (_) => const AnnouncementFormDialog(ministryId: 'min-alpha'),
                    );
                  },
                  child: const Text('Open Dialog'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Open dialog bound to user-a
      await tester.tap(find.text('Open Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Novo Comunicado'), findsOneWidget);

      // Active user changes to user-b
      authNotifier.state = const AuthState.authenticated(testUserB);
      await tester.pumpAndSettle();

      // Dialog MUST close
      expect(find.text('Novo Comunicado'), findsNothing);
    });
  });

  group('M11-R2 Announcement Authoritative Refresh and Deduplication', () {
    test('createAnnouncement queries server for authoritative list and deduplicates IDs', () async {
      final repo = FakeDashboardRepo();
      repo.serverAnnouncements = [
        const Announcement(
          id: 'ann-existing',
          ministryId: 'min-alpha',
          title: 'Aviso Antigo',
          content: 'Detalhes...',
        ),
      ];

      final notifier = DashboardNotifier(repository: repo);
      await notifier.loadForMinistry('min-alpha');

      expect(notifier.state.announcements.length, equals(1));
      expect(notifier.state.announcements.first.id, equals('ann-existing'));

      // Create new announcement
      final created = await notifier.createAnnouncement('min-alpha', {
        'title': 'Aviso Novo',
        'content': 'Conteúdo novo...',
        'important': true,
      });

      expect(created.id, equals('ann-server-1'));
      // Authoritative getAnnouncements was called
      expect(repo.getAnnouncementsCalls, greaterThanOrEqualTo(2));
      // State contains exactly the 2 distinct announcements without duplicate
      expect(notifier.state.announcements.length, equals(2));
      expect(notifier.state.announcements.map((a) => a.id).toSet().length, equals(2));
      expect(notifier.state.announcements.any((a) => a.id == 'ann-server-1'), isTrue);
      expect(notifier.state.announcements.any((a) => a.id == 'ann-existing'), isTrue);
    });
  });
}
