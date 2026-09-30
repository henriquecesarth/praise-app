import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/push_notifications/presentation/controllers/push_notification_controller.dart';
import 'package:louvaio_mobile/features/push_notifications/presentation/notification_router.dart';
import 'package:louvaio_mobile/features/push_notifications/services/push_notification_service.dart';
import 'package:mocktail/mocktail.dart';

class MockPushNotificationService extends Mock
    implements PushNotificationService {}

class MockNotificationRouter extends Mock implements NotificationRouter {}

void main() {
  late MockPushNotificationService mockService;
  late MockNotificationRouter mockRouter;
  late PushNotificationNotifier notifier;

  setUp(() {
    mockService = MockPushNotificationService();
    mockRouter = MockNotificationRouter();

    when(() => mockService.setNotificationTapHandler(any()))
        .thenReturn(null);

    notifier = PushNotificationNotifier(
      service: mockService,
      router: mockRouter,
    );
  });

  group('PushNotificationNotifier', () {
    test('initial state has default values', () {
      expect(notifier.state.isInitialized, isFalse);
      expect(notifier.state.isPermissionGranted, isFalse);
      expect(notifier.state.isRegisteredWithBackend, isFalse);
      expect(notifier.state.token, isNull);
    });

    test('initializeAndSync initializes service and registers token', () async {
      when(() => mockService.initialize()).thenAnswer((_) async {});
      when(() => mockService.syncTokenWithBackend(
            appVersion: any(named: 'appVersion'),
            deviceModel: any(named: 'deviceModel'),
          )).thenAnswer((_) async => true);
      when(() => mockService.currentToken).thenReturn('fcm-token-abc');

      await notifier.initializeAndSync(
        appVersion: '1.1.0',
        deviceModel: 'Android Test',
      );

      expect(notifier.state.isInitialized, isTrue);
      expect(notifier.state.isRegisteredWithBackend, isTrue);
      expect(notifier.state.token, 'fcm-token-abc');
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.errorMessage, isNull);
    });

    test('requestPermission updates state when granted', () async {
      when(() => mockService.requestPermission()).thenAnswer((_) async => true);
      when(() => mockService.syncTokenWithBackend()).thenAnswer((_) async => true);
      when(() => mockService.currentToken).thenReturn('fcm-token-granted');

      final granted = await notifier.requestPermission();

      expect(granted, isTrue);
      expect(notifier.state.isPermissionGranted, isTrue);
      expect(notifier.state.isRegisteredWithBackend, isTrue);
      expect(notifier.state.token, 'fcm-token-granted');
    });

    test('requestPermission handles user denial correctly', () async {
      when(() => mockService.requestPermission()).thenAnswer((_) async => false);

      final granted = await notifier.requestPermission();

      expect(granted, isFalse);
      expect(notifier.state.isPermissionGranted, isFalse);
    });

    test('unregisterOnLogout unregisters token and resets state', () async {
      when(() => mockService.unregisterCurrentToken()).thenAnswer((_) async => true);

      await notifier.unregisterOnLogout();

      expect(notifier.state.isInitialized, isFalse);
      expect(notifier.state.isRegisteredWithBackend, isFalse);
      expect(notifier.state.token, isNull);
      verify(() => mockService.unregisterCurrentToken()).called(1);
    });
  });
}
