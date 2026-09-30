import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/notification_repository.dart';
import '../../domain/user_notification.dart';

/// State for the unread notification badge count.
class UnreadNotificationCountNotifier extends StateNotifier<int> {
  final NotificationRepository _repository;

  UnreadNotificationCountNotifier(this._repository) : super(0) {
    refresh();
  }

  Future<void> refresh() async {
    try {
      final count = await _repository.getUnreadCount();
      if (!mounted) return;
      state = count;
    } catch (_) {
      // Non-fatal
    }
  }

  void increment() {
    state = state + 1;
  }

  void decrement() {
    if (state > 0) {
      state = state - 1;
    }
  }

  void reset() {
    state = 0;
  }
}

/// State for the Notification Center list view.
class NotificationListState {
  final List<UserNotification> items;
  final String? nextCursor;
  final bool isLoading;
  final bool isLoadingMore;
  final String? errorMessage;
  final String? loadMoreErrorMessage;

  const NotificationListState({
    this.items = const [],
    this.nextCursor,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.errorMessage,
    this.loadMoreErrorMessage,
  });

  bool get hasError => errorMessage != null;
  bool get hasLoadMoreError => loadMoreErrorMessage != null;
  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;
  bool get isEmpty => !isLoading && items.isEmpty && !hasError;

  NotificationListState copyWith({
    List<UserNotification>? items,
    String? nextCursor,
    bool? isLoading,
    bool? isLoadingMore,
    String? errorMessage,
    String? loadMoreErrorMessage,
    bool clearError = false,
    bool clearLoadMoreError = false,
    bool clearCursor = false,
  }) {
    return NotificationListState(
      items: items ?? this.items,
      nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
      isLoading: isLoading ?? this.isLoading,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      loadMoreErrorMessage: clearLoadMoreError
          ? null
          : (loadMoreErrorMessage ?? this.loadMoreErrorMessage),
    );
  }
}

class NotificationListNotifier extends StateNotifier<NotificationListState> {
  final NotificationRepository _repository;
  final UnreadNotificationCountNotifier? _unreadCountNotifier;

  NotificationListNotifier({
    required NotificationRepository repository,
    UnreadNotificationCountNotifier? unreadCountNotifier,
  })  : _repository = repository,
        _unreadCountNotifier = unreadCountNotifier,
        super(const NotificationListState()) {
    loadInitial();
  }

  void reset() {
    state = const NotificationListState();
  }

  Future<void> loadInitial() async {
    state = state.copyWith(isLoading: true, clearError: true, clearLoadMoreError: true);

    try {
      final result = await _repository.getNotifications(limit: 20);
      if (!mounted) return;
      state = state.copyWith(
        items: result.items,
        nextCursor: result.nextCursor,
        clearCursor: result.nextCursor == null,
        isLoading: false,
        clearLoadMoreError: true,
      );
      if (mounted) {
        _unreadCountNotifier?.refresh();
      }
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Não foi possível carregar as notificações.',
      );
    }
  }

  Future<void> refresh() async {
    try {
      final result = await _repository.getNotifications(limit: 20);
      if (!mounted) return;
      state = state.copyWith(
        items: result.items,
        nextCursor: result.nextCursor,
        clearCursor: result.nextCursor == null,
        clearError: true,
        clearLoadMoreError: true,
      );
      if (mounted) {
        _unreadCountNotifier?.refresh();
      }
    } catch (_) {
      // Keep existing items on refresh failure
    }
  }

  Future<void> loadMore() async {
    if (state.isLoadingMore || !state.hasMore) return;

    state = state.copyWith(isLoadingMore: true, clearLoadMoreError: true);

    try {
      final result = await _repository.getNotifications(
        limit: 20,
        cursor: state.nextCursor,
      );
      if (!mounted) return;

      final combined = [...state.items, ...result.items];
      state = state.copyWith(
        items: combined,
        nextCursor: result.nextCursor,
        clearCursor: result.nextCursor == null,
        isLoadingMore: false,
        clearLoadMoreError: true,
      );
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(
        isLoadingMore: false,
        loadMoreErrorMessage: 'Não foi possível carregar mais notificações.',
      );
    }
  }

  Future<void> markAsRead(String notificationId) async {
    // Find target
    final index = state.items.indexWhere((n) => n.id == notificationId);
    if (index == -1) return;

    final target = state.items[index];
    if (target.isRead) return;

    // Optimistic update
    final now = DateTime.now();
    final updatedList = List<UserNotification>.from(state.items);
    updatedList[index] = target.copyWith(readAt: now);
    state = state.copyWith(items: updatedList);
    _unreadCountNotifier?.decrement();

    try {
      await _repository.markAsRead(notificationId);
    } catch (e) {
      if (!mounted) return;
      // Revert on error
      final revertedList = List<UserNotification>.from(state.items);
      revertedList[index] = target;
      state = state.copyWith(items: revertedList);
      _unreadCountNotifier?.increment();
    }
  }

  Future<void> markAllAsRead() async {
    final unreadCount = state.items.where((n) => !n.isRead).length;
    if (unreadCount == 0) return;

    final now = DateTime.now();
    final previousItems = state.items;
    final updatedList = state.items
        .map((n) => n.isRead ? n : n.copyWith(readAt: now))
        .toList();

    state = state.copyWith(items: updatedList);
    _unreadCountNotifier?.reset();

    try {
      await _repository.markAllAsRead();
    } catch (e) {
      if (!mounted) return;
      // Revert on error
      state = state.copyWith(items: previousItems);
      _unreadCountNotifier?.refresh();
    }
  }
}
