import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/utils/date_utils.dart';
import '../../../push_notifications/domain/push_notification_payload.dart';
import '../../../push_notifications/presentation/controllers/push_notification_providers.dart';
import '../../domain/user_notification.dart';
import '../controllers/notification_providers.dart';

/// Notification Center screen for LouvAIO Mobile.
///
/// Features:
/// - List of notifications, newest first.
/// - Unread indicators and visual differentiation.
/// - "Marcar todas como lidas" action.
/// - Interactive tap handling: marks as read and routes safely via [NotificationRouter].
/// - Four explicit states: Loading, Error with retry, Empty, and Content.
/// - Pull-to-refresh and pagination.
class NotificationCenterScreen extends ConsumerWidget {
  const NotificationCenterScreen({super.key});

  static Future<void> show(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const NotificationCenterScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(notificationListProvider);
    final notifier = ref.read(notificationListProvider.notifier);
    final theme = Theme.of(context);

    final unreadCount = state.items.where((n) => !n.isRead).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Notificações',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          if (state.items.isNotEmpty)
            TextButton.icon(
              onPressed: unreadCount > 0 ? () => notifier.markAllAsRead() : null,
              icon: const Icon(Icons.done_all, size: 18),
              label: const Text('Marcar lidas'),
            ),
        ],
      ),
      body: _buildBody(context, ref, state, notifier, theme),
    );
  }

  Widget _buildBody(
    BuildContext context,
    WidgetRef ref,
    dynamic state,
    dynamic notifier,
    ThemeData theme,
  ) {
    if (state.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.hasError) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.error_outline_rounded,
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                state.errorMessage ?? 'Erro ao carregar notificações.',
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => notifier.loadInitial(),
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    if (state.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => notifier.refresh(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.6,
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(32.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.notifications_none_rounded,
                        size: 64,
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Nenhuma notificação por aqui ainda.',
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => notifier.refresh(),
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: state.items.length + (state.hasMore || state.hasLoadMoreError ? 1 : 0),
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (ctx, index) {
          if (index == state.items.length) {
            if (state.isLoadingMore) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 16.0),
                child: Center(child: CircularProgressIndicator()),
              );
            }
            if (state.hasLoadMoreError) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 16.0, horizontal: 24.0),
                child: Column(
                  children: [
                    Text(
                      state.loadMoreErrorMessage ?? 'Erro ao carregar mais notificações.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.error,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => notifier.loadMore(),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Tentar novamente'),
                    ),
                  ],
                ),
              );
            }
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 16.0, horizontal: 24.0),
              child: Center(
                child: OutlinedButton(
                  onPressed: () => notifier.loadMore(),
                  child: const Text('Carregar mais antigas'),
                ),
              ),
            );
          }

          final item = state.items[index] as UserNotification;
          return _NotificationTile(
            notification: item,
            onTap: () async {
              // 1. Mark as read
              if (!item.isRead) {
                await notifier.markAsRead(item.id);
              }

              // 2. Map and navigate via NotificationRouter
              if (ctx.mounted) {
                final pushType = item.type == UserNotificationType.scheduleComment
                    ? PushNotificationType.scheduleComment
                    : item.type == UserNotificationType.announcement
                        ? PushNotificationType.announcement
                        : PushNotificationType.schedule;

                final payload = PushNotificationPayload(
                  type: pushType,
                  ministryId:
                      item.ministryId.isNotEmpty ? item.ministryId : null,
                  resourceId:
                      item.resourceId.isNotEmpty ? item.resourceId : null,
                  notificationId: item.id,
                  title: item.title,
                  body: item.body,
                );

                ref.read(notificationRouterProvider).handlePayload(payload, ctx);
              }
            },
          );
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final UserNotification notification;
  final VoidCallback onTap;

  const _NotificationTile({
    required this.notification,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUnread = !notification.isRead;

    IconData icon;
    Color iconColor;

    switch (notification.type) {
      case UserNotificationType.scheduleAssigned:
      case UserNotificationType.scheduleUpdated:
        icon = Icons.calendar_today_rounded;
        iconColor = theme.colorScheme.primary;
        break;
      case UserNotificationType.scheduleComment:
        icon = Icons.chat_bubble_outline_rounded;
        iconColor = theme.colorScheme.secondary;
        break;
      case UserNotificationType.announcement:
        icon = Icons.campaign_outlined;
        iconColor = Colors.orange.shade700;
        break;
      case UserNotificationType.unknown:
        icon = Icons.notifications_outlined;
        iconColor = theme.colorScheme.onSurface;
        break;
    }

    final formattedDate = AppDateUtils.formatAnnouncementDate(notification.createdAt);

    return InkWell(
      onTap: onTap,
      child: Container(
        color: isUnread
            ? theme.colorScheme.primary.withValues(alpha: 0.06)
            : Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        constraints: const BoxConstraints(minHeight: 56), // Touch target >= 44px
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 20,
              backgroundColor: iconColor.withValues(alpha: 0.12),
              child: Icon(icon, size: 20, color: iconColor),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          notification.title,
                          style: TextStyle(
                            fontWeight: isUnread ? FontWeight.bold : FontWeight.w500,
                            fontSize: 15,
                            color: theme.colorScheme.onSurface,
                          ),
                        ),
                      ),
                      if (isUnread) ...[
                        const SizedBox(width: 8),
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    notification.body,
                    style: TextStyle(
                      fontSize: 13,
                      color: theme.colorScheme.onSurface.withValues(
                        alpha: isUnread ? 0.85 : 0.65,
                      ),
                      height: 1.3,
                    ),
                  ),
                  if (formattedDate.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      formattedDate,
                      style: TextStyle(
                        fontSize: 11,
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.45),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
