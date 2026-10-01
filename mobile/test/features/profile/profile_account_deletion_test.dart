import 'dart:async';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/shell/app_shell.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
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
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';

class MockAuthRepository extends Mock implements AuthRepository {}
class MockMinistryRepository extends Mock implements MinistryRepository {}
class MockFirebaseUser extends Mock implements fb.User {}

class FakeDashboardRepo implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async => [];

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId, {int limit = 20}) async => [];
}

class FakeScheduleRepo implements ScheduleRepository {
  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

  @override
  Future<ScheduleDetail> getScheduleDetail(String ministryId, String scheduleId) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<ScheduleDetail> confirmParticipation(String ministryId, String scheduleId, bool confirmed) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<List<ScheduleComment>> getComments(String ministryId, String scheduleId) async => [];

  @override
  Future<ScheduleComment> postComment(String ministryId, String scheduleId, String content) async =>
      const ScheduleComment(id: 'c1', scheduleId: 's1', ministryId: 'min_1', userId: 'u1', userName: 'User', content: 'content', createdAt: '2026-10-01');

  @override
  Future<ScheduleDetail> createSchedule(String ministryId, Map<String, dynamic> data) async =>
      const ScheduleDetail(id: 's_new', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<ScheduleDetail> updateSchedule(String ministryId, String scheduleId, Map<String, dynamic> data) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async => [];

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async => [];
}

class FakeRepertoireRepo implements RepertoireRepository {
  @override
  Future<PaginatedSongs> listSongs(String ministryId, {String? search, String? classificationId, String? cursor, int? page, int? limit}) async =>
      const PaginatedSongs(songs: [], total: 0);

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async =>
      SongDetail(id: songId, ministryId: ministryId, title: 'Música');

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [];
}

void main() {
  const testUser = AuthUser(
    id: 'user_123',
    email: 'membro@louvaio.test',
    name: 'Membro Teste',
  );

  const testMinistry = Ministry(
    id: 'min_test_1',
    name: 'Comunidade da Fé',
    role: 'member',
    subscriptionStatus: 'active',
  );

  group('Mobile Profile Account Deletion Entry Point', () {
    late MockAuthRepository mockAuthRepo;
    late MockMinistryRepository mockMinistryRepo;
    late StreamController<fb.User?> authStreamController;
    late SharedPreferencesStorage storage;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      storage = SharedPreferencesStorage(prefs);

      mockAuthRepo = MockAuthRepository();
      mockMinistryRepo = MockMinistryRepository();
      authStreamController = StreamController<fb.User?>.broadcast();

      when(() => mockAuthRepo.authStateChanges())
          .thenAnswer((_) => authStreamController.stream);
      when(() => mockAuthRepo.getMe()).thenAnswer((_) async => testUser);
      when(() => mockAuthRepo.signOut()).thenAnswer((_) async {});

      when(() => mockMinistryRepo.getMyMinistries())
          .thenAnswer((_) async => [testMinistry]);
    });

    tearDown(() {
      authStreamController.close();
    });

    Widget createTestApp() {
      return ProviderScope(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          authRepositoryProvider.overrideWithValue(mockAuthRepo),
          ministryRepositoryProvider.overrideWithValue(mockMinistryRepo),
          dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
          scheduleRepositoryProvider.overrideWithValue(FakeScheduleRepo()),
          repertoireRepositoryProvider.overrideWithValue(FakeRepertoireRepo()),
          authNotifierProvider.overrideWith((ref) {
            final n = AuthNotifier(mockAuthRepo);
            n.state = const AuthState.authenticated(testUser);
            return n;
          }),
          ministryContextNotifierProvider.overrideWith((ref) {
            final n = MinistryContextNotifier(
              repository: mockMinistryRepo,
              preferencesStorage: storage,
            );
            n.state = const MinistryContextState(
              status: MinistryBootstrapStatus.ready,
              availableMinistries: [testMinistry],
              selectedMinistry: testMinistry,
            );
            return n;
          }),
        ],
        child: const MaterialApp(
          home: AppShell(),
        ),
      );
    }

    testWidgets('Profile displays Excluir minha conta action', (tester) async {
      await tester.pumpWidget(createTestApp());
      await tester.pumpAndSettle();

      // Navigate to Perfil tab (index 3)
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      expect(find.text('Excluir minha conta'), findsOneWidget);
      expect(
        find.text('Gerenciar encerramento permanente da conta no portal LouvAIO'),
        findsOneWidget,
      );
    });

    testWidgets('Tapping Excluir minha conta displays confirmation dialog with web explanation', (tester) async {
      await tester.pumpWidget(createTestApp());
      await tester.pumpAndSettle();

      // Navigate to Perfil tab
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      // Tap Excluir minha conta tile
      await tester.tap(find.text('Excluir minha conta'));
      await tester.pumpAndSettle();

      // Dialog must be present explaining web portal management
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(
        find.textContaining('O encerramento e a exclusão definitiva da sua conta são gerenciados de forma segura pelo portal web'),
        findsOneWidget,
      );
      expect(find.text('Cancelar'), findsOneWidget);
      expect(find.text('Prosseguir no navegador'), findsOneWidget);

      // Dismiss dialog
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('No destructive deletion is performed locally in Flutter app', (tester) async {
      await tester.pumpWidget(createTestApp());
      await tester.pumpAndSettle();

      // Navigate to Perfil tab
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Excluir minha conta'));
      await tester.pumpAndSettle();

      // Tapping Cancelar dismisses without any delete/signOut call
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      verifyNever(() => mockAuthRepo.signOut());
    });
  });

  group('Mobile Stale Session Fail-Closed Handling', () {
    test('AuthNotifier fails closed on 403 ACCOUNT_DELETION_IN_PROGRESS', () async {
      final mockAuthRepo = MockAuthRepository();
      final controller = StreamController<fb.User?>.broadcast();

      when(() => mockAuthRepo.authStateChanges())
          .thenAnswer((_) => controller.stream);
      when(() => mockAuthRepo.signOut()).thenAnswer((_) async {});
      when(() => mockAuthRepo.getMe()).thenThrow(
        const AppFailure(
          message: 'Sua conta está em processo de exclusão ou foi excluída.',
          statusCode: 403,
          code: 'ACCOUNT_DELETION_IN_PROGRESS',
        ),
      );

      final notifier = AuthNotifier(mockAuthRepo);

      controller.add(MockFirebaseUser());
      await Future<void>.delayed(Duration.zero);

      // Must call signOut() and transition to unauthenticated
      verify(() => mockAuthRepo.signOut()).called(1);
      expect(notifier.state.status, AuthStatus.unauthenticated);
      expect(notifier.state.user, isNull);

      notifier.dispose();
      controller.close();
    });

    test('AuthInterceptor fails closed on 403 with ACCOUNT_DELETION_IN_PROGRESS payload', () async {
      var authFailedCalled = false;
      final dio = Dio();

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async => 'test-token',
        onAuthenticationFailed: () async {
          authFailedCalled = true;
        },
        dio: dio,
      );

      final dioException = DioException(
        requestOptions: RequestOptions(path: '/api/v1/schedules'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/v1/schedules'),
          statusCode: 403,
          data: {
            'error': {
              'code': 'ACCOUNT_DELETION_IN_PROGRESS',
              'message': 'Conta em processo de exclusão.',
            },
          },
        ),
      );

      var nextCalled = false;

      // Run onError
      await interceptor.onError(
        dioException,
        ErrorInterceptorHandlerWrapper(
          onNext: (err) {
            nextCalled = true;
          },
        ),
      );

      expect(authFailedCalled, isTrue);
      expect(nextCalled, isTrue);
    });
  });
}

class ErrorInterceptorHandlerWrapper extends ErrorInterceptorHandler {
  final void Function(DioException err) onNext;

  ErrorInterceptorHandlerWrapper({required this.onNext});

  @override
  void next(DioException err) {
    onNext(err);
  }
}

