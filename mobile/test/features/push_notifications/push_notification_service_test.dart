import 'dart:async';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/push_notifications/data/push_device_repository.dart';
import 'package:louvaio_mobile/features/push_notifications/domain/push_notification_payload.dart';
import 'package:louvaio_mobile/features/push_notifications/services/push_notification_service.dart';
import 'package:mocktail/mocktail.dart';

class MockFirebaseMessaging extends Mock implements FirebaseMessaging {}

class MockFlutterLocalNotificationsPlugin extends Mock
    implements FlutterLocalNotificationsPlugin {}

class MockPushDeviceRepository extends Mock implements PushDeviceRepository {}

class MockNotificationSettings extends Mock implements NotificationSettings {}

void main() {
  late MockFirebaseMessaging mockMessaging;
  late MockFlutterLocalNotificationsPlugin mockLocalNotifications;
  late MockPushDeviceRepository mockRepo;
  late AppLogger logger;
  late PushNotificationService service;
  late StreamController<String> tokenRefreshController;

  setUpAll(() {
    registerFallbackValue(const InitializationSettings());
    registerFallbackValue(const NotificationDetails());
  });

  setUp(() {
    mockMessaging = MockFirebaseMessaging();
    mockLocalNotifications = MockFlutterLocalNotificationsPlugin();
    mockRepo = MockPushDeviceRepository();
    logger = const AppLogger(isDebug: false);

    tokenRefreshController = StreamController<String>.broadcast();
    when(() => mockMessaging.onTokenRefresh)
        .thenAnswer((_) => tokenRefreshController.stream);

    service = PushNotificationService(
      messaging: mockMessaging,
      localNotifications: mockLocalNotifications,
      pushDeviceRepo: mockRepo,
      logger: logger,
    );
  });

  tearDown(() {
    tokenRefreshController.close();
    service.dispose();
  });

  group('PushNotificationService', () {
    test('syncTokenWithBackend registers token and updates on token rotation', () async {
      when(() => mockMessaging.getToken())
          .thenAnswer((_) async => 'initial-token-12345');
      when(() => mockRepo.registerDevice(
            fcmToken: any(named: 'fcmToken'),
            platform: any(named: 'platform'),
            appVersion: any(named: 'appVersion'),
            deviceModel: any(named: 'deviceModel'),
          )).thenAnswer((_) async => true);

      final success = await service.syncTokenWithBackend(
        appVersion: '1.1.0',
        deviceModel: 'Android Test Device',
      );

      expect(success, isTrue);
      expect(service.currentToken, 'initial-token-12345');
      expect(service.isRegisteredWithBackend, isTrue);
      verify(() => mockRepo.registerDevice(
            fcmToken: 'initial-token-12345',
            platform: 'android',
            appVersion: '1.1.0',
            deviceModel: 'Android Test Device',
          )).called(1);

      // Simulate token rotation
      tokenRefreshController.add('rotated-token-67890');
      await pumpEventQueue();

      expect(service.currentToken, 'rotated-token-67890');
      verify(() => mockRepo.registerDevice(
            fcmToken: 'rotated-token-67890',
            platform: 'android',
            appVersion: '1.1.0',
            deviceModel: 'Android Test Device',
          )).called(1);
    });

    test('syncTokenWithBackend handles null token safely', () async {
      when(() => mockMessaging.getToken()).thenAnswer((_) async => null);

      final success = await service.syncTokenWithBackend();
      expect(success, isFalse);
      expect(service.currentToken, isNull);
      verifyNever(() => mockRepo.registerDevice(
            fcmToken: any(named: 'fcmToken'),
            platform: any(named: 'platform'),
          ));
    });

    test('requestPermission returns true when authorized (Android 13+ / iOS)', () async {
      final mockSettings = MockNotificationSettings();
      when(() => mockSettings.authorizationStatus)
          .thenReturn(AuthorizationStatus.authorized);
      when(() => mockMessaging.requestPermission(
            alert: any(named: 'alert'),
            badge: any(named: 'badge'),
            sound: any(named: 'sound'),
            provisional: any(named: 'provisional'),
          )).thenAnswer((_) async => mockSettings);

      final granted = await service.requestPermission();
      expect(granted, isTrue);
    });

    test('requestPermission returns false when denied', () async {
      final mockSettings = MockNotificationSettings();
      when(() => mockSettings.authorizationStatus)
          .thenReturn(AuthorizationStatus.denied);
      when(() => mockMessaging.requestPermission(
            alert: any(named: 'alert'),
            badge: any(named: 'badge'),
            sound: any(named: 'sound'),
            provisional: any(named: 'provisional'),
          )).thenAnswer((_) async => mockSettings);

      final granted = await service.requestPermission();
      expect(granted, isFalse);
    });

    test('unregisterCurrentToken removes token from backend and clears local state', () async {
      when(() => mockMessaging.getToken())
          .thenAnswer((_) async => 'token-to-be-removed');
      when(() => mockRepo.registerDevice(
            fcmToken: any(named: 'fcmToken'),
            platform: any(named: 'platform'),
          )).thenAnswer((_) async => true);
      when(() => mockRepo.unregisterDevice(fcmToken: 'token-to-be-removed'))
          .thenAnswer((_) async => true);

      await service.syncTokenWithBackend();
      expect(service.currentToken, 'token-to-be-removed');

      final success = await service.unregisterCurrentToken();
      expect(success, isTrue);
      expect(service.currentToken, isNull);
      expect(service.isRegisteredWithBackend, isFalse);
      verify(() => mockRepo.unregisterDevice(fcmToken: 'token-to-be-removed'))
          .called(1);
    });

    test('setNotificationTapHandler receives tapped payloads', () {
      PushNotificationPayload? received;
      service.setNotificationTapHandler((payload) {
        received = payload;
      });

      const payload = PushNotificationPayload(
        type: PushNotificationType.schedule,
        ministryId: 'min-1',
        resourceId: 'sch-100',
      );

      service.handleNotificationTap(payload);

      expect(received, equals(payload));
    });
  });
}
