import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/push_notifications/domain/push_notification_payload.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_detail_view.dart';
import 'package:mocktail/mocktail.dart';

class MockAuthRepository extends Mock implements AuthRepository {}
class MockMinistryRepository extends Mock implements MinistryRepository {}
class MockPreferencesStorage extends Mock implements PreferencesStorage {}

void main() {
  late MockAuthRepository mockAuthRepo;
  late MockMinistryRepository mockMinistryRepo;
  late MockPreferencesStorage mockStorage;
  late GlobalKey<NavigatorState> navigatorKey;
  late AppLogger logger;

  setUp(() {
    mockAuthRepo = MockAuthRepository();
    mockMinistryRepo = MockMinistryRepository();
    mockStorage = MockPreferencesStorage();
    navigatorKey = GlobalKey<NavigatorState>();
    logger = const AppLogger(isDebug: false);

    when(() => mockAuthRepo.authStateChanges())
        .thenAnswer((_) => const Stream.empty());
    when(() => mockStorage.getSelectedMinistryId()).thenReturn(null);
    when(() => mockStorage.setSelectedMinistryId(any())).thenAnswer((_) async {});
    when(() => mockStorage.clear()).thenAnswer((_) async {});
  });

  Widget buildTestApp({
    required WidgetTester tester,
    required ProviderContainer container,
    required Widget child,
  }) {
    return UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        navigatorKey: navigatorKey,
        home: Scaffold(body: child),
      ),
    );
  }

  group('NotificationRouter', () {
    testWidgets('unauthenticated session: holds pending payload without navigating',
        (tester) async {
      when(() => mockAuthRepo.authStateChanges())
          .thenAnswer((_) => Stream.value(null));

      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(mockAuthRepo),
          preferencesStorageProvider.overrideWithValue(mockStorage),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = NotificationRouter(
        ref: container,
        navigatorKey: navigatorKey,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Home'),
        ),
      );
      await tester.pumpAndSettle();

      const payload = PushNotificationPayload(
        type: PushNotificationType.schedule,
        ministryId: 'min-1',
        resourceId: 'sch-100',
      );

      router.handlePayload(payload);

      expect(router.pendingPayload, equals(payload));
      expect(find.text('Home'), findsOneWidget);
      expect(find.byType(ScheduleDetailView), findsNothing);
    });

    testWidgets(
        'authenticated session: inaccessible ministry displays safe warning and stops',
        (tester) async {
      const user = AuthUser(id: 'usr-1', email: 'test@louvaio.com', name: 'Test User');
      const ministry1 = Ministry(id: 'min-1', name: 'Louvor Alpha', role: 'admin');

      final authNotifier = AuthNotifier(mockAuthRepo);
      authNotifier.state = const AuthState.authenticated(user);

      final ministryNotifier = MinistryContextNotifier(
        repository: mockMinistryRepo,
        preferencesStorage: mockStorage,
      );
      ministryNotifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: [ministry1],
        selectedMinistry: ministry1,
      );

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => authNotifier),
          ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
          preferencesStorageProvider.overrideWithValue(mockStorage),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = NotificationRouter(
        ref: container,
        navigatorKey: navigatorKey,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Dashboard'),
        ),
      );
      await tester.pumpAndSettle();

      // Notification targets min-999, which is not in user's available ministries
      const payload = PushNotificationPayload(
        type: PushNotificationType.schedule,
        ministryId: 'min-999',
        resourceId: 'sch-999',
      );

      router.handlePayload(payload);
      await tester.pumpAndSettle();

      expect(
        find.text('Você não tem acesso ao ministério desta notificação.'),
        findsOneWidget,
      );
      expect(ministryNotifier.state.selectedMinistry?.id, 'min-1');
      expect(find.byType(ScheduleDetailView), findsNothing);
    });

    testWidgets(
        'authenticated session: accessible different ministry switches context cleanly',
        (tester) async {
      const user = AuthUser(id: 'usr-1', email: 'test@louvaio.com', name: 'Test User');
      const ministry1 = Ministry(id: 'min-1', name: 'Louvor Alpha', role: 'member');
      const ministry2 = Ministry(id: 'min-2', name: 'Louvor Beta', role: 'admin');

      final authNotifier = AuthNotifier(mockAuthRepo);
      authNotifier.state = const AuthState.authenticated(user);

      final ministryNotifier = MinistryContextNotifier(
        repository: mockMinistryRepo,
        preferencesStorage: mockStorage,
      );
      ministryNotifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: [ministry1, ministry2],
        selectedMinistry: ministry1,
      );

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => authNotifier),
          ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
          preferencesStorageProvider.overrideWithValue(mockStorage),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = NotificationRouter(
        ref: container,
        navigatorKey: navigatorKey,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Dashboard'),
        ),
      );
      await tester.pumpAndSettle();

      const payload = PushNotificationPayload(
        type: PushNotificationType.announcement,
        ministryId: 'min-2',
      );

      router.handlePayload(payload);
      await tester.pumpAndSettle();

      expect(ministryNotifier.state.selectedMinistry?.id, 'min-2');
      expect(container.read(appShellTabProvider), 0);
    });

    testWidgets(
        'dispatchPendingIfReady executes held payload once auth and ministry are ready',
        (tester) async {
      const user = AuthUser(id: 'usr-1', email: 'test@louvaio.com', name: 'Test User');
      const ministry1 = Ministry(id: 'min-1', name: 'Louvor Alpha', role: 'admin');

      final authNotifier = AuthNotifier(mockAuthRepo);
      final ministryNotifier = MinistryContextNotifier(
        repository: mockMinistryRepo,
        preferencesStorage: mockStorage,
      );

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => authNotifier),
          ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
          preferencesStorageProvider.overrideWithValue(mockStorage),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = NotificationRouter(
        ref: container,
        navigatorKey: navigatorKey,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Login Screen'),
        ),
      );
      await tester.pumpAndSettle();

      // Tap arrives while unauthenticated
      const payload = PushNotificationPayload(
        type: PushNotificationType.announcement,
        ministryId: 'min-1',
      );
      router.handlePayload(payload);
      expect(router.pendingPayload, equals(payload));

      // User logs in and bootstrap completes
      authNotifier.state = const AuthState.authenticated(user);
      ministryNotifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: [ministry1],
        selectedMinistry: ministry1,
      );

      router.dispatchPendingIfReady();
      await tester.pumpAndSettle();

      expect(router.pendingPayload, isNull);
      expect(container.read(appShellTabProvider), 0);
    });
  });
}
