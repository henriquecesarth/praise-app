import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/features/notifications/data/notification_repository.dart';
import 'package:louvaio_mobile/features/notifications/domain/user_notification.dart';
import 'package:louvaio_mobile/features/notifications/presentation/controllers/notification_controller.dart';

class MockNotificationRepository extends Mock implements NotificationRepository {}

void main() {
  late MockNotificationRepository mockRepo;

  setUp(() {
    mockRepo = MockNotificationRepository();
  });

  final testNotification1 = UserNotification(
    id: 'n1',
    userId: 'u1',
    ministryId: 'm1',
    type: UserNotificationType.scheduleAssigned,
    resourceId: 's1',
    title: 'Escala 1',
    body: 'Corpo 1',
    createdAt: DateTime.now(),
  );

  final testNotification2 = UserNotification(
    id: 'n2',
    userId: 'u1',
    ministryId: 'm1',
    type: UserNotificationType.scheduleUpdated,
    resourceId: 's2',
    title: 'Escala 2',
    body: 'Corpo 2',
    createdAt: DateTime.now(),
  );

  group('UnreadNotificationCountNotifier', () {
    test('initializes and loads unread count from repository', () async {
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 3);

      final notifier = UnreadNotificationCountNotifier(mockRepo);
      await pumpEventQueue();

      expect(notifier.state, 3);

      notifier.increment();
      expect(notifier.state, 4);

      notifier.decrement();
      expect(notifier.state, 3);

      notifier.reset();
      expect(notifier.state, 0);
    });
  });

  group('NotificationListNotifier', () {
    test('loadInitial loads page 1 items and nextCursor', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenAnswer((_) async => NotificationPageResult(
                items: [testNotification1],
                nextCursor: 'cursor_page_2',
              ));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 1);

      final unreadNotifier = UnreadNotificationCountNotifier(mockRepo);
      final listNotifier = NotificationListNotifier(
        repository: mockRepo,
        unreadCountNotifier: unreadNotifier,
      );

      await pumpEventQueue();

      expect(listNotifier.state.isLoading, isFalse);
      expect(listNotifier.state.items.length, 1);
      expect(listNotifier.state.items.first.id, 'n1');
      expect(listNotifier.state.nextCursor, 'cursor_page_2');
      expect(listNotifier.state.hasMore, isTrue);
    });

    test('loadMore appends subsequent items', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenAnswer((_) async => NotificationPageResult(
                items: [testNotification1],
                nextCursor: 'cursor_page_2',
              ));
      when(() => mockRepo.getNotifications(
            limit: any(named: 'limit'),
            cursor: 'cursor_page_2',
          )).thenAnswer((_) async => NotificationPageResult(
            items: [testNotification2],
            nextCursor: null,
          ));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 2);

      final unreadNotifier = UnreadNotificationCountNotifier(mockRepo);
      final listNotifier = NotificationListNotifier(
        repository: mockRepo,
        unreadCountNotifier: unreadNotifier,
      );

      await pumpEventQueue();
      expect(listNotifier.state.items.length, 1);

      await listNotifier.loadMore();
      expect(listNotifier.state.items.length, 2);
      expect(listNotifier.state.items[1].id, 'n2');
      expect(listNotifier.state.hasMore, isFalse);
    });

    test('markAsRead updates item optimistically and decrements unread count', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenAnswer((_) async => NotificationPageResult(
                items: [testNotification1],
                nextCursor: null,
              ));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 1);
      when(() => mockRepo.markAsRead('n1')).thenAnswer(
        (_) async => testNotification1.copyWith(readAt: DateTime.now()),
      );

      final unreadNotifier = UnreadNotificationCountNotifier(mockRepo);
      final listNotifier = NotificationListNotifier(
        repository: mockRepo,
        unreadCountNotifier: unreadNotifier,
      );

      await pumpEventQueue();
      expect(listNotifier.state.items.first.isRead, isFalse);

      await listNotifier.markAsRead('n1');

      expect(listNotifier.state.items.first.isRead, isTrue);
      expect(unreadNotifier.state, 0);
      verify(() => mockRepo.markAsRead('n1')).called(1);
    });

    test('markAllAsRead marks all unread items as read and resets unread count', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenAnswer((_) async => NotificationPageResult(
                items: [testNotification1, testNotification2],
                nextCursor: null,
              ));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 2);
      when(() => mockRepo.markAllAsRead()).thenAnswer((_) async => 2);

      final unreadNotifier = UnreadNotificationCountNotifier(mockRepo);
      final listNotifier = NotificationListNotifier(
        repository: mockRepo,
        unreadCountNotifier: unreadNotifier,
      );

      await pumpEventQueue();
      expect(listNotifier.state.items.every((n) => !n.isRead), isTrue);

      await listNotifier.markAllAsRead();

      expect(listNotifier.state.items.every((n) => n.isRead), isTrue);
      expect(unreadNotifier.state, 0);
      verify(() => mockRepo.markAllAsRead()).called(1);
    });

    test('sets error state when loading fails', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenThrow(Exception('Network error'));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 0);

      final listNotifier = NotificationListNotifier(
        repository: mockRepo,
      );

      await pumpEventQueue();

      expect(listNotifier.state.isLoading, isFalse);
      expect(listNotifier.state.hasError, isTrue);
      expect(listNotifier.state.errorMessage, isNotNull);
    });

    test('reset clears state back to default empty state', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenAnswer((_) async => NotificationPageResult(
                items: [testNotification1],
                nextCursor: 'cursor_123',
              ));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 1);

      final listNotifier = NotificationListNotifier(repository: mockRepo);
      await pumpEventQueue();

      expect(listNotifier.state.items.isNotEmpty, isTrue);
      expect(listNotifier.state.nextCursor, isNotNull);

      listNotifier.reset();

      expect(listNotifier.state.items, isEmpty);
      expect(listNotifier.state.nextCursor, isNull);
      expect(listNotifier.state.hasMore, isFalse);
      expect(listNotifier.state.errorMessage, isNull);
      expect(listNotifier.state.loadMoreErrorMessage, isNull);
    });

    test('loadMore handles failure: sets loadMoreErrorMessage without clearing existing items', () async {
      when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
          .thenAnswer((_) async => NotificationPageResult(
                items: [testNotification1],
                nextCursor: 'cursor_page_2',
              ));
      when(() => mockRepo.getNotifications(
            limit: any(named: 'limit'),
            cursor: 'cursor_page_2',
          )).thenThrow(Exception('Transient network failure'));
      when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 1);

      final listNotifier = NotificationListNotifier(repository: mockRepo);
      await pumpEventQueue();

      expect(listNotifier.state.items.length, 1);
      expect(listNotifier.state.hasMore, isTrue);

      await listNotifier.loadMore();

      // Existing items are preserved
      expect(listNotifier.state.items.length, 1);
      expect(listNotifier.state.items.first.id, 'n1');
      // Still has more (cursor preserved for retry)
      expect(listNotifier.state.hasMore, isTrue);
      expect(listNotifier.state.nextCursor, 'cursor_page_2');
      // Has pagination error
      expect(listNotifier.state.hasLoadMoreError, isTrue);
      expect(listNotifier.state.loadMoreErrorMessage, isNotNull);
      expect(listNotifier.state.isLoadingMore, isFalse);

      // Now mock successful retry
      when(() => mockRepo.getNotifications(
            limit: any(named: 'limit'),
            cursor: 'cursor_page_2',
          )).thenAnswer((_) async => NotificationPageResult(
            items: [testNotification2],
            nextCursor: null,
          ));

      await listNotifier.loadMore();

      expect(listNotifier.state.items.length, 2);
      expect(listNotifier.state.hasLoadMoreError, isFalse);
      expect(listNotifier.state.loadMoreErrorMessage, isNull);
      expect(listNotifier.state.hasMore, isFalse);
    });
  });
}
