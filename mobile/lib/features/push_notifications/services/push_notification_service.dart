import 'dart:async';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../../../core/logging/app_logger.dart';
import '../data/push_device_repository.dart';
import '../domain/push_notification_payload.dart';

typedef NotificationTapCallback = void Function(PushNotificationPayload payload);

/// Service managing device FCM token synchronization, foreground alerts, and notification tap handling.
class PushNotificationService {
  final FirebaseMessaging? _customMessaging;
  final FlutterLocalNotificationsPlugin? _customLocalNotifications;
  final PushDeviceRepository _pushDeviceRepo;
  final AppLogger _logger;

  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _foregroundMessageSub;
  StreamSubscription<RemoteMessage>? _messageOpenedSub;

  String? _currentToken;
  bool _isInitialized = false;
  bool _isRegisteredWithBackend = false;
  NotificationTapCallback? _onNotificationTap;

  static const String notificationChannelId = 'louvaio_notifications';
  static const String notificationChannelName = 'LouvAIO Notificações';
  static const String notificationChannelDescription =
      'Notificações de escalas, comentários e avisos do ministério';

  final int? _androidSdkVersion;

  PushNotificationService({
    FirebaseMessaging? messaging,
    FlutterLocalNotificationsPlugin? localNotifications,
    required PushDeviceRepository pushDeviceRepo,
    required AppLogger logger,
    int? androidSdkVersion,
  })  : _customMessaging = messaging,
        _customLocalNotifications = localNotifications,
        _pushDeviceRepo = pushDeviceRepo,
        _logger = logger,
        _androidSdkVersion = androidSdkVersion;

  FirebaseMessaging? get _messaging {
    if (_customMessaging != null) return _customMessaging;
    try {
      return FirebaseMessaging.instance;
    } catch (e) {
      _logger.warning('FirebaseMessaging unavailable: $e');
      return null;
    }
  }

  FlutterLocalNotificationsPlugin get _localNotifications =>
      _customLocalNotifications ?? FlutterLocalNotificationsPlugin();

  String? get currentToken => _currentToken;
  bool get isRegisteredWithBackend => _isRegisteredWithBackend;
  bool get isInitialized => _isInitialized;

  void setNotificationTapHandler(NotificationTapCallback handler) {
    _onNotificationTap = handler;
  }

  /// Initializes local notifications and FCM listeners.
  /// Safe to call multiple times (idempotent).
  Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      final messaging = _messaging;
      if (messaging == null) {
        _logger.warning('Push notifications unavailable: FirebaseMessaging could not be obtained.');
        return;
      }

      // 1. Android local notification setup
      const androidSettings =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const initSettings = InitializationSettings(android: androidSettings);

      await _localNotifications.initialize(
        settings: initSettings,
        onDidReceiveNotificationResponse: (NotificationResponse response) {
          final payloadStr = response.payload;
          if (payloadStr != null && payloadStr.isNotEmpty) {
            final payload = PushNotificationPayload.fromJsonString(payloadStr);
            _handleNotificationTap(payload);
          }
        },
      );

      // Create high-importance Android channel
      final androidPlugin = _localNotifications.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        const channel = AndroidNotificationChannel(
          notificationChannelId,
          notificationChannelName,
          description: notificationChannelDescription,
          importance: Importance.max,
        );
        await androidPlugin.createNotificationChannel(channel);
      }

      // 2. Foreground message listener (does NOT force navigate)
      _foregroundMessageSub = FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        _handleForegroundMessage(message);
      });

      // 3. Background tap listener (user tapped notification while app was in background)
      _messageOpenedSub =
          FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        final payload = PushNotificationPayload.fromMap(
          message.data,
          title: message.notification?.title,
          body: message.notification?.body,
        );
        _handleNotificationTap(payload);
      });

      // 4. Terminated state tap check (user opened app by tapping notification)
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        final payload = PushNotificationPayload.fromMap(
          initialMessage.data,
          title: initialMessage.notification?.title,
          body: initialMessage.notification?.body,
        );
        _handleNotificationTap(payload);
      }

      _isInitialized = true;
      _logger.debug('PushNotificationService initialized successfully.');
    } catch (e) {
      _logger.warning('Non-fatal error initializing push notifications: $e');
    }
  }

  /// Requests notification permission on Android 13+ / iOS.
  /// On Android <= 12 (API <= 32), runtime POST_NOTIFICATIONS prompt is not required.
  Future<bool> requestPermission() async {
    if (_androidSdkVersion != null && _androidSdkVersion <= 32) {
      _logger.debug(
        'Android API $_androidSdkVersion <= 32: runtime permission prompt not required.',
      );
      return true;
    }

    try {
      final messaging = _messaging;
      if (messaging == null) return false;

      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );

      final granted = settings.authorizationStatus == AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional;
      _logger.debug('Notification permission status: ${settings.authorizationStatus}');
      return granted;
    } catch (e) {
      _logger.warning('Failed to request notification permission: $e');
      return false;
    }
  }

  /// Obtains current FCM token and registers it with the backend.
  /// Listens for token refreshes and updates backend automatically.
  Future<bool> syncTokenWithBackend({String? appVersion, String? deviceModel}) async {
    try {
      final messaging = _messaging;
      if (messaging == null) {
        _logger.warning('FirebaseMessaging unavailable for token sync.');
        return false;
      }

      final token = await messaging.getToken();
      if (token == null || token.isEmpty) {
        _logger.warning('FCM getToken() returned empty token.');
        return false;
      }

      _currentToken = token;
      final registered = await _pushDeviceRepo.registerDevice(
        fcmToken: token,
        platform: 'android',
        appVersion: appVersion,
        deviceModel: deviceModel,
      );

      _isRegisteredWithBackend = registered;

      // Subscribe to token rotation
      _tokenRefreshSub ??= messaging.onTokenRefresh.listen((newToken) async {
        _currentToken = newToken;
        final res = await _pushDeviceRepo.registerDevice(
          fcmToken: newToken,
          platform: 'android',
          appVersion: appVersion,
          deviceModel: deviceModel,
        );
        _isRegisteredWithBackend = res;
      });

      return registered;
    } catch (e) {
      _logger.warning('Non-fatal failure syncing push token with backend: $e');
      return false;
    }
  }

  /// Unregisters current push token from backend and deletes the local FCM token on logout.
  Future<bool> unregisterCurrentToken() async {
    final tokenToUnregister = _currentToken;
    bool backendSuccess = true;

    if (tokenToUnregister != null) {
      try {
        backendSuccess = await _pushDeviceRepo.unregisterDevice(fcmToken: tokenToUnregister);
      } catch (e) {
        _logger.warning('Non-fatal error unregistering device token on backend: $e');
        backendSuccess = false;
      }
    }

    // Always invalidate local FCM token so logged-out device stops receiving pushes
    try {
      final messaging = _messaging;
      if (messaging != null) {
        await messaging.deleteToken();
        _logger.debug('FCM token deleted and invalidated locally.');
      }
    } catch (e) {
      _logger.warning('Non-fatal error deleting FCM token locally: $e');
    }

    _currentToken = null;
    _isRegisteredWithBackend = false;
    return backendSuccess;
  }

  /// Handles incoming messages while the app is in the foreground.
  /// Shows a heads-up local notification without force-navigating.
  Future<void> _handleForegroundMessage(RemoteMessage message) async {
    try {
      final title = message.notification?.title ?? message.data['title']?.toString() ?? 'LouvAIO';
      final body = message.notification?.body ?? message.data['body']?.toString() ?? '';

      final payload = PushNotificationPayload.fromMap(
        message.data,
        title: title,
        body: body,
      );

      const androidDetails = AndroidNotificationDetails(
        notificationChannelId,
        notificationChannelName,
        channelDescription: notificationChannelDescription,
        importance: Importance.max,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
      );

      const notificationDetails = NotificationDetails(android: androidDetails);

      // Generate a stable notification ID
      final notificationId = message.messageId?.hashCode ?? DateTime.now().millisecondsSinceEpoch.remainder(100000);

      await _localNotifications.show(
        id: notificationId,
        title: title,
        body: body,
        notificationDetails: notificationDetails,
        payload: payload.toJsonString(),
      );
    } catch (e) {
      _logger.warning('Error displaying foreground notification: $e');
    }
  }

  void _handleNotificationTap(PushNotificationPayload payload) {
    _logger.debug('Push notification tapped with payload: $payload');
    if (_onNotificationTap != null) {
      _onNotificationTap!(payload);
    }
  }

  @visibleForTesting
  void handleNotificationTap(PushNotificationPayload payload) {
    _handleNotificationTap(payload);
  }

  void dispose() {
    _tokenRefreshSub?.cancel();
    _foregroundMessageSub?.cancel();
    _messageOpenedSub?.cancel();
  }
}
