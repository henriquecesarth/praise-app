import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/push_notification_service.dart';
import '../notification_router.dart';

class PushNotificationState {
  final bool isInitialized;
  final bool isPermissionGranted;
  final bool isRegisteredWithBackend;
  final String? token;
  final bool isLoading;
  final String? errorMessage;

  const PushNotificationState({
    this.isInitialized = false,
    this.isPermissionGranted = false,
    this.isRegisteredWithBackend = false,
    this.token,
    this.isLoading = false,
    this.errorMessage,
  });

  PushNotificationState copyWith({
    bool? isInitialized,
    bool? isPermissionGranted,
    bool? isRegisteredWithBackend,
    String? token,
    bool? isLoading,
    String? errorMessage,
  }) {
    return PushNotificationState(
      isInitialized: isInitialized ?? this.isInitialized,
      isPermissionGranted: isPermissionGranted ?? this.isPermissionGranted,
      isRegisteredWithBackend:
          isRegisteredWithBackend ?? this.isRegisteredWithBackend,
      token: token ?? this.token,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class PushNotificationNotifier extends StateNotifier<PushNotificationState> {
  final PushNotificationService _service;
  final NotificationRouter _router;

  PushNotificationNotifier({
    required PushNotificationService service,
    required NotificationRouter router,
  })  : _service = service,
        _router = router,
        super(const PushNotificationState()) {
    _service.setNotificationTapHandler((payload) {
      _router.handlePayload(payload);
    });
  }

  /// Bootstrap push notification service and synchronize device token with backend.
  Future<void> initializeAndSync({
    String? appVersion,
    String? deviceModel,
    bool requestPermissionImmediately = false,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      await _service.initialize();

      bool granted = state.isPermissionGranted;
      if (requestPermissionImmediately) {
        granted = await _service.requestPermission();
      }

      final registered = await _service.syncTokenWithBackend(
        appVersion: appVersion,
        deviceModel: deviceModel,
      );

      state = state.copyWith(
        isInitialized: true,
        isPermissionGranted: granted,
        isRegisteredWithBackend: registered,
        token: _service.currentToken,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Falha ao sincronizar notificações.',
      );
    }
  }

  /// Requests notification permission from user and synchronizes token if granted.
  Future<bool> requestPermission() async {
    state = state.copyWith(isLoading: true);
    try {
      final granted = await _service.requestPermission();
      if (granted) {
        final registered = await _service.syncTokenWithBackend();
        state = state.copyWith(
          isPermissionGranted: true,
          isRegisteredWithBackend: registered,
          token: _service.currentToken,
          isLoading: false,
        );
      } else {
        state = state.copyWith(
          isPermissionGranted: false,
          isLoading: false,
        );
      }
      return granted;
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Falha ao solicitar permissão de notificações.',
      );
      return false;
    }
  }

  /// Best-effort token unregistration during explicit logout.
  Future<void> unregisterOnLogout() async {
    try {
      await _service.unregisterCurrentToken();
      state = const PushNotificationState();
    } catch (_) {
      // Non-fatal cleanup failure
    }
  }
}
