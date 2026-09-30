import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import '../../../core/logging/app_logger.dart';
import '../../ministry_context/domain/ministry.dart';
import '../../schedules/presentation/views/schedule_detail_view.dart';
import '../domain/push_notification_payload.dart';

/// Provider for managing selected navigation tab index in [AppShell].
final appShellTabProvider = StateProvider<int>((ref) => 0);

/// Central tenant-safe notification router.
///
/// Ensures routing respects authentication, ministry boundaries, and multi-tenant isolation:
/// - Logged out: holds pending payload without exposing resource content.
/// - Inaccessible ministry: displays safe warning without data leak.
/// - Valid target: switches ministry context (invalidating stale caches) and navigates to target.
class NotificationRouter {
  final dynamic _ref;
  final GlobalKey<NavigatorState> navigatorKey;
  final AppLogger _logger;

  PushNotificationPayload? _pendingPayload;

  NotificationRouter({
    required dynamic ref,
    required this.navigatorKey,
    required AppLogger logger,
  })  : _ref = ref,
        _logger = logger;

  PushNotificationPayload? get pendingPayload => _pendingPayload;

  void clearPendingPayload() {
    _pendingPayload = null;
  }

  /// Handles an incoming notification tap payload.
  void handlePayload(PushNotificationPayload payload, [BuildContext? context]) {
    final ctx = context ?? navigatorKey.currentContext;
    _logger.debug('NotificationRouter handling payload: $payload');

    final authState = _ref.read(authNotifierProvider);

    // 1. Session verification: If not authenticated, store as pending intent.
    if (!authState.isAuthenticated) {
      _logger.debug('User unauthenticated; holding notification payload pending login.');
      _pendingPayload = payload;
      return;
    }

    final ministryState = _ref.read(ministryContextNotifierProvider);

    // 2. Tenant verification: If payload specifies a ministryId
    if (payload.ministryId != null && payload.ministryId!.isNotEmpty) {
      final currentMinistryId = ministryState.selectedMinistry?.id;

      if (currentMinistryId != payload.ministryId) {
        // Find if target ministry is among user's accessible ministries
        final targetMinistry = ministryState.availableMinistries
            .cast<Ministry?>()
            .firstWhere(
              (m) => m?.id == payload.ministryId,
              orElse: () => null,
            );

        if (targetMinistry == null) {
          _logger.warning(
            'Tenant access violation: Notification targets ministry ${payload.ministryId} which is inaccessible to user.',
          );
          if (ctx != null && ctx.mounted) {
            ScaffoldMessenger.of(ctx).showSnackBar(
              const SnackBar(
                content: Text('Você não tem acesso ao ministério desta notificação.'),
                duration: Duration(seconds: 4),
              ),
            );
          }
          return;
        }

        // Switch to target ministry cleanly (this resets other feature caches via AppShell listener)
        _logger.debug('Switching ministry context to: ${targetMinistry.name}');
        _ref
            .read(ministryContextNotifierProvider.notifier)
            .selectMinistry(targetMinistry);
      }
    }

    // 3. Resource navigation
    _navigateToTargetResource(payload, ctx);
  }

  void _navigateToTargetResource(
    PushNotificationPayload payload,
    BuildContext? context,
  ) {
    if (context == null || !context.mounted) {
      _logger.warning('Cannot navigate: context is null or unmounted.');
      return;
    }

    final nav = Navigator.of(context);
    final ministryState = _ref.read(ministryContextNotifierProvider);
    final effectiveMinistryId =
        payload.ministryId ?? ministryState.selectedMinistry?.id;

    switch (payload.type) {
      case PushNotificationType.schedule:
      case PushNotificationType.scheduleComment:
        if (payload.resourceId != null &&
            effectiveMinistryId != null &&
            effectiveMinistryId.isNotEmpty) {
          // Pop any child modal routes first to return to main stack
          nav.popUntil((route) => route.isFirst);
          _ref.read(appShellTabProvider.notifier).state = 1; // Escalas tab

          nav.push(
            MaterialPageRoute(
              builder: (_) => ScheduleDetailView(
                ministryId: effectiveMinistryId,
                scheduleId: payload.resourceId!,
                initialTitle: payload.title,
              ),
            ),
          );
        } else {
          nav.popUntil((route) => route.isFirst);
          _ref.read(appShellTabProvider.notifier).state = 1; // Escalas tab
        }
        break;

      case PushNotificationType.announcement:
        nav.popUntil((route) => route.isFirst);
        _ref.read(appShellTabProvider.notifier).state = 0; // Início / Dashboard
        break;

      case PushNotificationType.unknown:
        _logger.warning('Unknown notification type received: ${payload.type}. Falling back to home.');
        nav.popUntil((route) => route.isFirst);
        _ref.read(appShellTabProvider.notifier).state = 0;
        break;
    }
  }

  /// Dispatches any pending notification payload held before login/bootstrap.
  void dispatchPendingIfReady([BuildContext? context]) {
    if (_pendingPayload == null) return;

    final authState = _ref.read(authNotifierProvider);
    final ministryState = _ref.read(ministryContextNotifierProvider);

    if (authState.isAuthenticated && ministryState.isReady) {
      _logger.debug('Dispatching pending notification payload after authentication: $_pendingPayload');
      final payload = _pendingPayload!;
      _pendingPayload = null;
      handlePayload(payload, context);
    }
  }
}
