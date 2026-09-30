import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/push_device_repository.dart';
import '../../services/push_notification_service.dart';
import '../../../notifications/presentation/controllers/notification_providers.dart';

export 'push_notification_controller.dart';
export '../notification_router.dart';

/// Global navigator key used for deep link routing from background/notification handlers.
final rootNavigatorKeyProvider = Provider<GlobalKey<NavigatorState>>((ref) {
  return GlobalKey<NavigatorState>();
});

/// Push device HTTP repository provider.
final pushDeviceRepositoryProvider = Provider<PushDeviceRepository>((ref) {
  return HttpPushDeviceRepository(
    apiClient: ref.watch(apiClientProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Push notification service provider.
final pushNotificationServiceProvider = Provider<PushNotificationService>((ref) {
  final service = PushNotificationService(
    pushDeviceRepo: ref.watch(pushDeviceRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
  ref.onDispose(() => service.dispose());
  return service;
});

/// Notification router provider.
final notificationRouterProvider = Provider<NotificationRouter>((ref) {
  return NotificationRouter(
    ref: ref,
    navigatorKey: ref.watch(rootNavigatorKeyProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Push notification state notifier provider.
final pushNotificationNotifierProvider =
    StateNotifierProvider<PushNotificationNotifier, PushNotificationState>((ref) {
  return PushNotificationNotifier(
    service: ref.watch(pushNotificationServiceProvider),
    router: ref.watch(notificationRouterProvider),
    onForegroundMessage: (_) {
      try {
        ref.read(unreadNotificationCountProvider.notifier).refresh();
        ref.read(notificationListProvider.notifier).refresh();
      } catch (_) {}
    },
  );
});
