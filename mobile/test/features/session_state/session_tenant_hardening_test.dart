import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/availability_list_controller.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/availability_providers.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/dashboard/presentation/controllers/dashboard_controller.dart';
import 'package:louvaio_mobile/features/dashboard/presentation/dashboard_view.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_list_controller.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_detail_controller.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_list_controller.dart';
import 'package:louvaio_mobile/features/notifications/data/notification_repository.dart';
import 'package:louvaio_mobile/features/notifications/domain/user_notification.dart';
import 'package:louvaio_mobile/features/notifications/presentation/controllers/notification_controller.dart';
import 'package:louvaio_mobile/features/notifications/presentation/controllers/notification_providers.dart';
import 'package:louvaio_mobile/features/push_notifications/domain/push_notification_payload.dart';

MemberAvailability createDummyAvailability({
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
    startsAt: '${startDate}T00:00:00',
    endsAt: '${endDate}T23:59:59',
    reason: reason,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  );
}

class MockUser extends Mock implements User {}

class MockAuthRepository extends Mock implements AuthRepository {}

class FakeDashboardRepo implements DashboardRepository {
  Future<List<DashboardScheduleSummary>> Function(String ministryId)?
      getSchedulesHandler;
  Future<List<Announcement>> Function(String ministryId)?
      getAnnouncementsHandler;

  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async {
    if (getSchedulesHandler != null) return getSchedulesHandler!(ministryId);
    return [];
  }

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId,
      {int limit = 20}) async {
    if (getAnnouncementsHandler != null) {
      return getAnnouncementsHandler!(ministryId);
    }
    return [];
  }
}

class FakeScheduleRepo implements ScheduleRepository {
  Future<List<ScheduleSummary>> Function(String ministryId)?
      listSchedulesHandler;
  Future<ScheduleDetail> Function(String ministryId, String scheduleId)?
      getScheduleDetailHandler;

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async {
    if (listSchedulesHandler != null) return listSchedulesHandler!(ministryId);
    return [];
  }

  @override
  Future<ScheduleDetail> getScheduleDetail(
      String ministryId, String scheduleId) async {
    if (getScheduleDetailHandler != null) {
      return getScheduleDetailHandler!(ministryId, scheduleId);
    }
    return ScheduleDetail(
      id: scheduleId,
      ministryId: ministryId,
      title: 'Schedule',
      date: '2026-10-01',
    );
  }

  @override
  Future<ScheduleDetail> confirmParticipation(
      String ministryId, String scheduleId, bool confirmed) async {
    return ScheduleDetail(
      id: scheduleId,
      ministryId: ministryId,
      title: 'Schedule',
      date: '2026-10-01',
    );
  }

  @override
  Future<List<ScheduleComment>> getComments(
          String ministryId, String scheduleId) async =>
      [];

  @override
  Future<ScheduleComment> postComment(
      String ministryId, String scheduleId, String content) async {
    return ScheduleComment(
      id: 'c1',
      ministryId: ministryId,
      scheduleId: scheduleId,
      userId: 'u1',
      userName: 'User',
      content: content,
      createdAt: DateTime.now().toIso8601String(),
    );
  }
}

class FakeAvailabilityRepo implements AvailabilityRepository {
  Future<AvailabilityListResponse> Function(String ministryId)? listHandler;

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(String ministryId,
      {int limit = 50, String? cursor}) async {
    if (listHandler != null) return listHandler!(ministryId);
    return const AvailabilityListResponse(data: []);
  }

  @override
  Future<MemberAvailability> createMyAvailability(
      String ministryId, CreateAvailabilityPayload payload) async {
    throw UnimplementedError();
  }

  @override
  Future<MemberAvailability> updateMyAvailability(
      String ministryId, String id, UpdateAvailabilityPayload payload) async {
    throw UnimplementedError();
  }

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) async {}
}

class FakeRepertoireRepo implements RepertoireRepository {
  Future<PaginatedSongs> Function(String ministryId)? listSongsHandler;

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    if (listSongsHandler != null) return listSongsHandler!(ministryId);
    return const PaginatedSongs(songs: [], total: 0);
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    return SongDetail(
      id: songId,
      ministryId: ministryId,
      title: 'Song',
      artistName: 'Artist',
    );
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async =>
      [];
}

class FakeMinistryRepo implements MinistryRepository {
  List<Ministry> ministries;
  FakeMinistryRepo({this.ministries = const []});

  @override
  Future<List<Ministry>> getMyMinistries() async => ministries;
}

class FakeNotificationRepo implements NotificationRepository {
  Future<NotificationPageResult> Function({int limit, String? cursor})?
      getNotificationsHandler;
  Future<int> Function()? getUnreadCountHandler;

  @override
  Future<NotificationPageResult> getNotifications({
    int limit = 20,
    String? cursor,
  }) async {
    if (getNotificationsHandler != null) {
      return getNotificationsHandler!(limit: limit, cursor: cursor);
    }
    return const NotificationPageResult(items: []);
  }

  @override
  Future<int> getUnreadCount() async {
    if (getUnreadCountHandler != null) return getUnreadCountHandler!();
    return 0;
  }

  @override
  Future<UserNotification> markAsRead(String notificationId) async =>
      throw UnimplementedError();

  @override
  Future<int> markAllAsRead() async => 0;
}

class FakeAuthRepo implements AuthRepository {
  final StreamController<User?> _controller =
      StreamController<User?>.broadcast();
  AuthUser? userToReturn;
  AppFailure? failureToThrow;
  int signOutCount = 0;

  FakeAuthRepo({this.userToReturn, this.failureToThrow});

  @override
  Stream<User?> authStateChanges() => _controller.stream;

  void emitUser(User? user) => _controller.add(user);

  @override
  User? get currentFirebaseUser => null;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => 'fake-token';

  @override
  Future<AuthUser> getMe() async {
    if (failureToThrow != null) throw failureToThrow!;
    if (userToReturn != null) return userToReturn!;
    throw const AppFailure(message: 'Not authenticated');
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword(
          {required String email, required String password}) async =>
      throw UnimplementedError();

  @override
  Future<AuthUser> signUp(
          {required String name,
          required String email,
          required String password}) async =>
      throw UnimplementedError();

  @override
  Future<void> signOut() async {
    signOutCount++;
    _controller.add(null);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const testEnv = AppEnvironment(
    env: AppEnv.development,
    apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
  );

  const testUser = AuthUser(
    id: 'user_a',
    email: 'user_a@louvaio.com',
    name: 'User Alpha',
  );

  const minA = Ministry(
    id: 'min_a',
    name: 'Ministério Alfa',
    role: 'admin',
  );

  const minB = Ministry(
    id: 'min_b',
    name: 'Ministério Beta',
    role: 'member',
  );

  group('M7 Regression A: Dashboard Tenant Isolation & Stale Flash Prevention',
      () {
    testWidgets(
        'Ministry A dashboard loaded -> switch to B -> zero A data rendered under B',
        (tester) async {
      tester.view.physicalSize = const Size(1200, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeDashboardRepo = FakeDashboardRepo();
      final completerB = Completer<List<DashboardScheduleSummary>>();

      fakeDashboardRepo.getSchedulesHandler = (mId) async {
        if (mId == 'min_a') {
          return [
            const DashboardScheduleSummary(
              id: 's_a',
              ministryId: 'min_a',
              title: 'Escala Alfa Exclusiva',
              date: '2026-10-01',
              time: '19:00',
            ),
          ];
        } else {
          return completerB.future;
        }
      };

      fakeDashboardRepo.getAnnouncementsHandler = (mId) async {
        if (mId == 'min_a') {
          return [
            const Announcement(
              id: 'a_a',
              ministryId: 'min_a',
              title: 'Aviso Alfa Exclusivo',
              content: 'Apenas para Alfa',
            ),
          ];
        }
        return [];
      };

      final authRepo = FakeAuthRepo(userToReturn: testUser);
      final authNotifier = AuthNotifier(authRepo)
        ..state = const AuthState.authenticated(testUser);

      // Render under Ministry A
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(testEnv),
            authRepositoryProvider.overrideWithValue(authRepo),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            dashboardRepositoryProvider.overrideWithValue(fakeDashboardRepo),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: DashboardView(
                selectedMinistry: minA,
                hasMultipleMinistries: true,
                onNavigateToTab: (_) {},
              ),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Ministry A content is visible
      expect(find.text('Escala Alfa Exclusiva'), findsOneWidget);
      expect(find.text('Aviso Alfa Exclusivo'), findsOneWidget);

      // Switch to Ministry B while B request is still pending
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(testEnv),
            authRepositoryProvider.overrideWithValue(authRepo),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            dashboardRepositoryProvider.overrideWithValue(fakeDashboardRepo),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: DashboardView(
                selectedMinistry: minB,
                hasMultipleMinistries: true,
                onNavigateToTab: (_) {},
              ),
            ),
          ),
        ),
      );

      // Pump single frame
      await tester.pump();

      // ZERO Ministry A data is rendered under Ministry B context!
      expect(find.text('Escala Alfa Exclusiva'), findsNothing);
      expect(find.text('Aviso Alfa Exclusivo'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsWidgets);

      // Now Ministry B finishes loading
      completerB.complete([
        const DashboardScheduleSummary(
          id: 's_b',
          ministryId: 'min_b',
          title: 'Escala Beta Exclusiva',
          date: '2026-10-02',
          time: '20:00',
        ),
      ]);

      await tester.pumpAndSettle();

      // Ministry B content is visible, A remains absent
      expect(find.text('Escala Alfa Exclusiva'), findsNothing);
      expect(find.text('Escala Beta Exclusiva'), findsOneWidget);
    });
  });

  group('M7 Regression B: Stale In-flight Request Protection', () {
    test('DashboardNotifier: request in-flight during switch is discarded',
        () async {
      final repo = FakeDashboardRepo();
      final completerA = Completer<List<DashboardScheduleSummary>>();

      repo.getSchedulesHandler = (mId) {
        if (mId == 'min_a') return completerA.future;
        return Future.value([
          const DashboardScheduleSummary(
            id: 's_b',
            ministryId: 'min_b',
            title: 'Schedule B',
            date: '2026-10-02',
          ),
        ]);
      };

      final notifier = DashboardNotifier(repository: repo);

      // Start loading for min_a (pending)
      final futureA = notifier.loadForMinistry('min_a');

      // Switch to min_b immediately (resolves fast)
      await notifier.loadForMinistry('min_b');

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.schedules.first.title, 'Schedule B');

      // Now complete min_a delayed request
      completerA.complete([
        const DashboardScheduleSummary(
          id: 's_a',
          ministryId: 'min_a',
          title: 'Stale Schedule A',
          date: '2026-10-01',
        ),
      ]);
      await futureA;

      // Stale response from min_a must be discarded
      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.schedules.first.title, 'Schedule B');
      expect(notifier.state.schedules.any((s) => s.id == 's_a'), isFalse);
    });
  });

  group('M7 Regression C: Tenant Switch Protection across Other Features', () {
    test('ScheduleListNotifier: in-flight request discarded on ministry switch',
        () async {
      final repo = FakeScheduleRepo();
      final completerA = Completer<List<ScheduleSummary>>();

      repo.listSchedulesHandler = (mId) {
        if (mId == 'min_a') return completerA.future;
        return Future.value([
          const ScheduleSummary(
            id: 'sch_b',
            ministryId: 'min_b',
            title: 'Schedule B',
            date: '2026-10-02',
          ),
        ]);
      };

      final notifier = ScheduleListNotifier(repository: repo);

      final futureA = notifier.loadForMinistry('min_a');
      await notifier.loadForMinistry('min_b');

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.schedules.first.title, 'Schedule B');

      completerA.complete([
        const ScheduleSummary(
          id: 'sch_a',
          ministryId: 'min_a',
          title: 'Schedule A',
          date: '2026-10-01',
        ),
      ]);
      await futureA;

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.schedules.first.title, 'Schedule B');
      expect(notifier.state.schedules.any((s) => s.id == 'sch_a'), isFalse);
    });

    test(
        'ScheduleDetailNotifier: in-flight request discarded on switch or reset',
        () async {
      final repo = FakeScheduleRepo();
      final completerA = Completer<ScheduleDetail>();

      repo.getScheduleDetailHandler = (mId, sId) {
        if (mId == 'min_a') return completerA.future;
        return Future.value(
          ScheduleDetail(
            id: sId,
            ministryId: mId,
            title: 'Schedule B Detail',
            date: '2026-10-02',
          ),
        );
      };

      final notifier = ScheduleDetailNotifier(repository: repo);

      final futureA = notifier.load('min_a', 'sch_a');
      await notifier.load('min_b', 'sch_b');

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.schedule?.title, 'Schedule B Detail');

      completerA.complete(
        const ScheduleDetail(
          id: 'sch_a',
          ministryId: 'min_a',
          title: 'Stale A Detail',
          date: '2026-10-01',
        ),
      );
      await futureA;

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.schedule?.title, 'Schedule B Detail');
    });

    test(
        'AvailabilityListNotifier: in-flight request discarded on ministry switch',
        () async {
      final repo = FakeAvailabilityRepo();
      final completerA = Completer<AvailabilityListResponse>();

      repo.listHandler = (mId) {
        if (mId == 'min_a') return completerA.future;
        return Future.value(
          AvailabilityListResponse(
            data: [
              createDummyAvailability(
                id: 'av_b',
                ministryId: 'min_b',
                startDate: '2026-10-02',
                endDate: '2026-10-03',
              ),
            ],
          ),
        );
      };

      final notifier = AvailabilityListNotifier(repository: repo);

      final futureA = notifier.loadForMinistry('min_a');
      await notifier.loadForMinistry('min_b');

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.items.first.id, 'av_b');

      completerA.complete(
        AvailabilityListResponse(
          data: [
            createDummyAvailability(
              id: 'av_a',
              ministryId: 'min_a',
              startDate: '2026-10-01',
              endDate: '2026-10-01',
            ),
          ],
        ),
      );
      await futureA;

      expect(notifier.state.ministryId, 'min_b');
      expect(notifier.state.items.first.id, 'av_b');
      expect(notifier.state.items.any((a) => a.id == 'av_a'), isFalse);
    });
  });

  group('M7 Regression D & E: Logout & User-Change Isolation', () {
    test('resetAuthenticatedFeatures invalidates and resets all feature states',
        () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final storage = SharedPreferencesStorage(prefs);

      final container = ProviderContainer(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          appEnvironmentProvider.overrideWithValue(testEnv),
          authRepositoryProvider.overrideWithValue(FakeAuthRepo()),
          ministryRepositoryProvider
              .overrideWithValue(FakeMinistryRepo(ministries: [minA])),
          dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
          scheduleRepositoryProvider.overrideWithValue(FakeScheduleRepo()),
          availabilityRepositoryProvider
              .overrideWithValue(FakeAvailabilityRepo()),
          repertoireRepositoryProvider.overrideWithValue(FakeRepertoireRepo()),
          notificationRepositoryProvider
              .overrideWithValue(FakeNotificationRepo()),
        ],
      );
      addTearDown(container.dispose);

      // Mutate feature states
      container.read(dashboardNotifierProvider.notifier).state =
          const DashboardState(
        ministryId: 'min_a',
        schedules: [
          DashboardScheduleSummary(
            id: 's1',
            ministryId: 'min_a',
            title: 'Escala 1',
            date: '2026-10-01',
          ),
        ],
      );

      container.read(scheduleListNotifierProvider.notifier).state =
          const ScheduleListState(
        ministryId: 'min_a',
        schedules: [
          ScheduleSummary(
            id: 'sch1',
            ministryId: 'min_a',
            title: 'Schedule 1',
            date: '2026-10-01',
          ),
        ],
      );

      container.read(availabilityListNotifierProvider.notifier).state =
          AvailabilityListState(
        ministryId: 'min_a',
        items: [
          createDummyAvailability(
            id: 'av1',
            ministryId: 'min_a',
          ),
        ],
      );

      container.read(repertoireListNotifierProvider.notifier).state =
          const RepertoireListState(
        ministryId: 'min_a',
        songs: [
          SongSummary(
            id: 'song1',
            ministryId: 'min_a',
            title: 'Song 1',
            artistName: 'Artist 1',
          ),
        ],
      );

      container.read(unreadNotificationCountProvider.notifier).state = 4;
      container.read(notificationListProvider.notifier).state =
          NotificationListState(
        items: [
          UserNotification(
            id: 'n1',
            userId: 'u1',
            ministryId: 'min_a',
            type: UserNotificationType.scheduleAssigned,
            resourceId: 's1',
            title: 'Notif 1',
            body: 'Body 1',
            createdAt: DateTime.now(),
          ),
        ],
        nextCursor: 'cursor_123',
      );
      container.read(notificationRouterProvider).handlePayload(
        const PushNotificationPayload(
          type: PushNotificationType.schedule,
          ministryId: 'min_a',
          resourceId: 's1',
        ),
      );

      // Verify states are populated
      expect(container.read(dashboardNotifierProvider).schedules, isNotEmpty);
      expect(
          container.read(scheduleListNotifierProvider).schedules, isNotEmpty);
      expect(
          container.read(availabilityListNotifierProvider).items, isNotEmpty);
      expect(container.read(repertoireListNotifierProvider).songs, isNotEmpty);
      expect(container.read(unreadNotificationCountProvider), 4);
      expect(container.read(notificationListProvider).items, isNotEmpty);
      expect(container.read(notificationListProvider).nextCursor, 'cursor_123');
      expect(
          container.read(notificationRouterProvider).pendingPayload, isNotNull);

      // Execute logout cleanup
      resetAuthenticatedFeatures(container);

      // Verify ALL feature notifiers are back to initial/clean state
      expect(container.read(dashboardNotifierProvider).ministryId, isNull);
      expect(container.read(dashboardNotifierProvider).schedules, isEmpty);
      expect(container.read(scheduleListNotifierProvider).ministryId, isNull);
      expect(container.read(scheduleListNotifierProvider).schedules, isEmpty);
      expect(
          container.read(availabilityListNotifierProvider).ministryId, isNull);
      expect(container.read(availabilityListNotifierProvider).items, isEmpty);
      expect(container.read(repertoireListNotifierProvider).ministryId, isNull);
      expect(container.read(repertoireListNotifierProvider).songs, isEmpty);
      expect(container.read(unreadNotificationCountProvider), 0);
      expect(container.read(notificationListProvider).items, isEmpty);
      expect(container.read(notificationListProvider).nextCursor, isNull);
      expect(
          container.read(notificationRouterProvider).pendingPayload, isNull);
    });

    test('User A logout -> User B login -> notification state is completely isolated',
        () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final storage = SharedPreferencesStorage(prefs);

      const userA =
          AuthUser(id: 'user_a', email: 'a@louvaio.com', name: 'User Alpha');
      const userB =
          AuthUser(id: 'user_b', email: 'b@louvaio.com', name: 'User Beta');

      final authRepo = FakeAuthRepo(userToReturn: userA);
      final notificationRepo = FakeNotificationRepo();

      final notifA = UserNotification(
        id: 'n_a',
        userId: 'user_a',
        ministryId: 'min_a',
        type: UserNotificationType.scheduleAssigned,
        resourceId: 's_a',
        title: 'Escala User Alpha',
        body: 'Você foi escalado(a)',
        createdAt: DateTime.now(),
      );

      final container = ProviderContainer(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          authRepositoryProvider.overrideWithValue(authRepo),
          notificationRepositoryProvider.overrideWithValue(notificationRepo),
        ],
      );
      addTearDown(container.dispose);

      // 1. User A is active and has notifications + unread count
      container.read(authNotifierProvider.notifier).state =
          const AuthState.authenticated(userA);
      container.read(unreadNotificationCountProvider.notifier).state = 3;
      container.read(notificationListProvider.notifier).state =
          NotificationListState(
        items: [notifA],
        nextCursor: 'cursor_user_a',
      );

      expect(container.read(unreadNotificationCountProvider), 3);
      expect(container.read(notificationListProvider).items.first.title,
          'Escala User Alpha');
      expect(
          container.read(notificationListProvider).nextCursor, 'cursor_user_a');

      // 2. User A logs out
      resetAuthenticatedFeatures(container);
      await container.read(authNotifierProvider.notifier).logout();

      // State is immediately cleared
      expect(container.read(unreadNotificationCountProvider), 0);
      expect(container.read(notificationListProvider).items, isEmpty);
      expect(container.read(notificationListProvider).nextCursor, isNull);

      // 3. User B logs in
      authRepo.userToReturn = userB;
      container.read(authNotifierProvider.notifier).state =
          const AuthState.authenticated(userB);

      // User B sees clean state with zero trace of User A
      expect(container.read(unreadNotificationCountProvider), 0);
      expect(container.read(notificationListProvider).items, isEmpty);
      expect(container.read(notificationListProvider).nextCursor, isNull);
      expect(
          container.read(notificationRouterProvider).pendingPayload, isNull);
    });

    test('User A logout -> User B login -> no User A data reused', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final storage = SharedPreferencesStorage(prefs);

      const userA =
          AuthUser(id: 'user_a', email: 'a@louvaio.com', name: 'User Alpha');
      const userB =
          AuthUser(id: 'user_b', email: 'b@louvaio.com', name: 'User Beta');

      final authRepo = FakeAuthRepo(userToReturn: userA);
      final ministryRepo = FakeMinistryRepo(ministries: [minA]);
      final dashboardRepo = FakeDashboardRepo();

      dashboardRepo.getSchedulesHandler = (mId) async {
        if (mId == 'min_a') {
          return [
            const DashboardScheduleSummary(
              id: 's_a',
              ministryId: 'min_a',
              title: 'Escala User Alpha',
              date: '2026-10-01',
            ),
          ];
        }
        return [
          const DashboardScheduleSummary(
            id: 's_b',
            ministryId: 'min_b',
            title: 'Escala User Beta',
            date: '2026-10-02',
          ),
        ];
      };

      final container = ProviderContainer(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          authRepositoryProvider.overrideWithValue(authRepo),
          ministryRepositoryProvider.overrideWithValue(ministryRepo),
          dashboardRepositoryProvider.overrideWithValue(dashboardRepo),
        ],
      );
      addTearDown(container.dispose);

      // 1. User A logs in
      authRepo.emitUser(MockUser());
      container.read(authNotifierProvider.notifier).state =
          const AuthState.authenticated(userA);
      await container
          .read(dashboardNotifierProvider.notifier)
          .loadForMinistry('min_a');

      expect(container.read(dashboardNotifierProvider).schedules.first.title,
          'Escala User Alpha');

      // 2. User A logs out
      resetAuthenticatedFeatures(container);
      await container.read(authNotifierProvider.notifier).logout();

      expect(container.read(dashboardNotifierProvider).schedules, isEmpty);
      expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);

      // 3. User B logs in with different ministry
      authRepo.userToReturn = userB;
      ministryRepo.ministries = [minB];

      container.read(authNotifierProvider.notifier).state =
          const AuthState.authenticated(userB);
      await container
          .read(dashboardNotifierProvider.notifier)
          .loadForMinistry('min_b');

      expect(container.read(dashboardNotifierProvider).schedules.first.title,
          'Escala User Beta');
      expect(
          container
              .read(dashboardNotifierProvider)
              .schedules
              .any((s) => s.title == 'Escala User Alpha'),
          isFalse);
    });
  });

  group('M7 Regression F, G, H: Auth Cold-Start Recovery & Fail-Closed', () {
    testWidgets(
        'F: Firebase session + transient /auth/me failure -> recoverable retry state',
        (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final storage = SharedPreferencesStorage(prefs);

      // Setup auth repo with transient 503 failure
      final authRepo = FakeAuthRepo(
        failureToThrow: const AppFailure(
          message: 'Falha temporária no servidor (503)',
          statusCode: 503,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            preferencesStorageProvider.overrideWithValue(storage),
            authRepositoryProvider.overrideWithValue(authRepo),
            ministryRepositoryProvider.overrideWithValue(FakeMinistryRepo()),
            dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
          ],
          child: const LouvAioApp(),
        ),
      );

      await tester.pump();

      // Emit Firebase session
      authRepo.emitUser(MockUser());
      await tester.pumpAndSettle();

      // Verify NOT redirected to login screen
      expect(find.text('Acesse seu ministério de louvor'), findsNothing);

      // Verify dedicated bootstrap error recovery screen is rendered
      expect(find.text('Falha na conexão'), findsOneWidget);
      expect(
          find.text(
              'Não foi possível concluir a operação agora. Tente novamente em instantes.'),
          findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);
      expect(find.text('Sair da Conta'), findsOneWidget);

      // Session was NOT destroyed
      expect(authRepo.signOutCount, 0);
    });

    testWidgets(
        'G: Retry succeeds -> authenticated app continues without password re-entry',
        (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final storage = SharedPreferencesStorage(prefs);

      final authRepo = FakeAuthRepo(
        failureToThrow: const AppFailure(
          message: 'Servidor temporariamente indisponível',
          statusCode: 500,
        ),
      );

      final ministryRepo = FakeMinistryRepo(ministries: [minA]);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            preferencesStorageProvider.overrideWithValue(storage),
            authRepositoryProvider.overrideWithValue(authRepo),
            ministryRepositoryProvider.overrideWithValue(ministryRepo),
            dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
          ],
          child: const LouvAioApp(),
        ),
      );

      await tester.pump();

      // Emit Firebase session -> triggers transient error
      authRepo.emitUser(MockUser());
      await tester.pumpAndSettle();

      expect(find.text('Falha na conexão'), findsOneWidget);

      // Backend recovers!
      authRepo.failureToThrow = null;
      authRepo.userToReturn = testUser;

      // Tap 'Tentar novamente'
      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      // App successfully transitioned into AppShell WITHOUT requiring password re-entry!
      expect(find.text('LouvAIO'), findsOneWidget);
      expect(find.textContaining('Olá, User Alpha'), findsOneWidget);
      expect(find.text('Ministério Alfa'), findsWidgets);
      expect(find.text('Acesse seu ministério de louvor'), findsNothing);
    });

    test('H: Genuine auth failure (401) fails closed and signs out', () async {
      final mockAuthRepo = MockAuthRepository();
      final controller = StreamController<User?>.broadcast();
      when(() => mockAuthRepo.authStateChanges())
          .thenAnswer((_) => controller.stream);
      when(() => mockAuthRepo.signOut()).thenAnswer((_) async {});
      when(() => mockAuthRepo.getMe()).thenThrow(
        const AppFailure(message: 'Token expirado', statusCode: 401),
      );

      final notifier = AuthNotifier(mockAuthRepo);

      controller.add(MockUser());
      await Future<void>.delayed(Duration.zero);

      // Genuine 401 must call signOut() to clean up invalid Firebase credential
      verify(() => mockAuthRepo.signOut()).called(1);

      // Must fail closed to unauthenticated
      expect(notifier.state.status, AuthStatus.unauthenticated);
      expect(notifier.state.user, isNull);

      notifier.dispose();
      controller.close();
    });
  });
}
