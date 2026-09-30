import 'package:dio/dio.dart';
import '../../../core/http/api_client.dart';
import '../../../core/logging/app_logger.dart';
import '../domain/user_notification.dart';

class NotificationPageResult {
  final List<UserNotification> items;
  final String? nextCursor;

  const NotificationPageResult({
    required this.items,
    this.nextCursor,
  });
}

abstract class NotificationRepository {
  Future<NotificationPageResult> getNotifications({
    int limit = 20,
    String? cursor,
  });

  Future<int> getUnreadCount();

  Future<UserNotification> markAsRead(String notificationId);

  Future<int> markAllAsRead();
}

class HttpNotificationRepository implements NotificationRepository {
  final ApiClient _apiClient;
  final AppLogger _logger;

  HttpNotificationRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  @override
  Future<NotificationPageResult> getNotifications({
    int limit = 20,
    String? cursor,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'limit': limit,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      };

      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/auth/notifications',
        queryParameters: queryParams,
      );

      final data = response.data ?? {};
      final rawItems = (data['items'] as List<dynamic>?) ??
          (data['notifications'] as List<dynamic>?) ??
          [];

      final items = rawItems
          .whereType<Map<String, dynamic>>()
          .map((m) => UserNotification.fromMap(m))
          .toList();

      final nextCursor = data['nextCursor']?.toString();

      return NotificationPageResult(
        items: items,
        nextCursor: nextCursor,
      );
    } on DioException catch (e) {
      _logger.warning('Failed to fetch notifications: [${e.response?.statusCode}] ${e.message}');
      rethrow;
    } catch (e) {
      _logger.warning('Unexpected error fetching notifications: $e');
      rethrow;
    }
  }

  @override
  Future<int> getUnreadCount() async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/auth/notifications/unread-count',
      );

      final data = response.data ?? {};
      final count = data['unreadCount'] ?? data['count'] ?? 0;
      if (count is num) {
        return count.toInt();
      }
      return int.tryParse(count.toString()) ?? 0;
    } on DioException catch (e) {
      _logger.warning('Failed to fetch unread notification count: [${e.response?.statusCode}] ${e.message}');
      return 0;
    } catch (e) {
      _logger.warning('Unexpected error fetching unread count: $e');
      return 0;
    }
  }

  @override
  Future<UserNotification> markAsRead(String notificationId) async {
    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/auth/notifications/$notificationId/read',
      );

      final data = response.data ?? {};
      return UserNotification.fromMap(data);
    } on DioException catch (e) {
      _logger.warning('Failed to mark notification $notificationId as read: [${e.response?.statusCode}] ${e.message}');
      rethrow;
    } catch (e) {
      _logger.warning('Unexpected error marking notification as read: $e');
      rethrow;
    }
  }

  @override
  Future<int> markAllAsRead() async {
    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/auth/notifications/read-all',
      );

      final data = response.data ?? {};
      final updated = data['updatedCount'] ?? 0;
      if (updated is num) {
        return updated.toInt();
      }
      return int.tryParse(updated.toString()) ?? 0;
    } on DioException catch (e) {
      _logger.warning('Failed to mark all notifications as read: [${e.response?.statusCode}] ${e.message}');
      rethrow;
    } catch (e) {
      _logger.warning('Unexpected error marking all notifications as read: $e');
      rethrow;
    }
  }
}
