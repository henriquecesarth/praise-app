import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/notification_repository.dart';
import 'notification_controller.dart';

final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final logger = ref.watch(appLoggerProvider);
  return HttpNotificationRepository(
    apiClient: apiClient,
    logger: logger,
  );
});

final unreadNotificationCountProvider =
    StateNotifierProvider<UnreadNotificationCountNotifier, int>((ref) {
  final repository = ref.watch(notificationRepositoryProvider);
  return UnreadNotificationCountNotifier(repository);
});

final notificationListProvider =
    StateNotifierProvider<NotificationListNotifier, NotificationListState>((ref) {
  final repository = ref.watch(notificationRepositoryProvider);
  final unreadCountNotifier = ref.watch(unreadNotificationCountProvider.notifier);
  return NotificationListNotifier(
    repository: repository,
    unreadCountNotifier: unreadCountNotifier,
  );
});
