import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/controllers/auth_controller.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../features/ministry_context/presentation/ministry_empty_screen.dart';
import '../../features/ministry_context/presentation/ministry_selector_screen.dart';
import '../providers.dart';
import '../shell/app_shell.dart';

bool shouldPreservePendingShareOnAuthentication(
  AuthState? previous, {
  required bool hasAuthenticatedSession,
}) =>
    !hasAuthenticatedSession && previous?.user == null;

GoRouter createRouter(Ref ref) {
  final rootNavKey = ref.watch(rootNavigatorKeyProvider);
  final refreshNotifier = _RouterRefreshNotifier(ref, rootNavKey);

  return GoRouter(
    navigatorKey: rootNavKey,
    initialLocation: '/',
    refreshListenable: refreshNotifier,
    redirect: (BuildContext context, GoRouterState state) {
      final auth = ref.read(authNotifierProvider);
      final ministry = ref.read(ministryContextNotifierProvider);
      final loc = state.matchedLocation;
      final isLoggingIn = loc == '/login';
      final isNoMinistry = loc == '/no-ministry';
      final isSelectMinistry = loc == '/select-ministry';

      if (auth.isInitializing) {
        return null;
      }

      if (auth.hasBootstrapError) {
        return loc == '/' ? null : '/';
      }

      if (!auth.isAuthenticated) {
        return isLoggingIn ? null : '/login';
      }

      // Authenticated users should not be on /login
      if (isLoggingIn) {
        if (ministry.isEmpty) return '/no-ministry';
        if (ministry.needsSelection) return '/select-ministry';
        return '/';
      }

      // During active loading or error, remain on current screen
      if (ministry.isInitializing || ministry.isLoading || ministry.hasError) {
        return null;
      }

      if (ministry.isEmpty) {
        return isNoMinistry ? null : '/no-ministry';
      }

      if (ministry.needsSelection) {
        return isSelectMinistry ? null : '/select-ministry';
      }

      if (ministry.isReady) {
        if (isNoMinistry || isSelectMinistry) {
          return '/';
        }
        return null;
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        name: 'home',
        builder: (BuildContext context, GoRouterState state) {
          final auth = ref.watch(authNotifierProvider);
          if (auth.isInitializing) {
            return const Scaffold(
              body: Center(
                child: CircularProgressIndicator(),
              ),
            );
          }
          if (auth.hasBootstrapError) {
            final theme = Theme.of(context);
            return Scaffold(
              appBar: AppBar(title: const Text('LouvAIO')),
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.cloud_off_outlined,
                        size: 56,
                        color: theme.colorScheme.error,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Falha na conexão',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        auth.failure?.message ??
                            'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.7),
                        ),
                      ),
                      const SizedBox(height: 24),
                      FilledButton.icon(
                        onPressed: () {
                          ref
                              .read(authNotifierProvider.notifier)
                              .retryBootstrap();
                        },
                        icon: const Icon(Icons.refresh),
                        label: const Text('Tentar novamente'),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: () {
                          ref.read(authNotifierProvider.notifier).logout();
                        },
                        child: const Text('Sair da Conta'),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }
          return const AppShell();
        },
      ),
      GoRoute(
        path: '/app',
        name: 'app',
        redirect: (BuildContext context, GoRouterState state) => '/',
      ),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (BuildContext context, GoRouterState state) =>
            const LoginScreen(),
      ),
      GoRoute(
        path: '/select-ministry',
        name: 'select-ministry',
        builder: (BuildContext context, GoRouterState state) =>
            const MinistrySelectorScreen(),
      ),
      GoRoute(
        path: '/no-ministry',
        name: 'no-ministry',
        builder: (BuildContext context, GoRouterState state) =>
            const MinistryEmptyScreen(),
      ),
    ],
  );
}

class _RouterRefreshNotifier extends ChangeNotifier {
  bool _hasAuthenticatedSession = false;
  final GlobalKey<NavigatorState> _rootNavKey;

  _RouterRefreshNotifier(Ref ref, this._rootNavKey) {
    // Early initialize push listeners so pre-auth notification taps and foreground handlers are active
    Future.microtask(() {
      try {
        ref.read(pushNotificationNotifierProvider.notifier).initializeEarly();
      } catch (_) {}
      try {
        ref.read(shareIntentRouterProvider).initialize();
      } catch (_) {}
    });

    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      if (next.isAuthenticated && previous?.user?.id != next.user?.id) {
        final isInitialAuthentication =
            shouldPreservePendingShareOnAuthentication(
          previous,
          hasAuthenticatedSession: _hasAuthenticatedSession,
        );
        resetAuthenticatedFeatures(
          ref,
          preservePendingShareIntent: isInitialAuthentication,
          preserveSavedMinistrySelection: isInitialAuthentication,
        );
        _hasAuthenticatedSession = true;
        ref
            .read(ministryContextNotifierProvider.notifier)
            .bootstrap(userId: next.user?.id);
      } else if (next.isUnauthenticated) {
        final isInitialUnauthenticated =
            previous == null || previous.isInitializing;
        resetAuthenticatedFeatures(
          ref,
          preservePendingShareIntent: isInitialUnauthenticated,
        );
        _hasAuthenticatedSession = false;
        ref.read(notificationRouterProvider).clearPendingPayload();
      }
      notifyListeners();
    });

    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      if (next.isReady) {
        // Trigger push notification sync upon authenticated bootstrap
        try {
          ref
              .read(pushNotificationNotifierProvider.notifier)
              .initializeAndSync();
        } catch (_) {}
        try {
          // Dispatch any pending notification intent
          ref.read(notificationRouterProvider).dispatchPendingIfReady();
        } catch (_) {}
      }
      if (next.isReady || next.isEmpty) {
        _dispatchPendingShareAfterNavigationReady(ref, _rootNavKey);
      }
      notifyListeners();
    });

    // Handle case where auth is already authenticated before router initialization
    final auth = ref.read(authNotifierProvider);
    final ministry = ref.read(ministryContextNotifierProvider);
    if (auth.isAuthenticated && ministry.isInitializing) {
      Future.microtask(() {
        ref
            .read(ministryContextNotifierProvider.notifier)
            .bootstrap(userId: auth.user?.id);
      });
    } else if (auth.isAuthenticated && (ministry.isReady || ministry.isEmpty)) {
      Future.microtask(() {
        if (ministry.isReady) {
          try {
            ref
                .read(pushNotificationNotifierProvider.notifier)
                .initializeAndSync();
          } catch (_) {}
          try {
            ref.read(notificationRouterProvider).dispatchPendingIfReady();
          } catch (_) {}
        }
        _dispatchPendingShareAfterNavigationReady(ref, _rootNavKey);
      });
    }
  }
}

void _dispatchPendingShareAfterNavigationReady(
    Ref ref, GlobalKey<NavigatorState> navigatorKey) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (navigatorKey.currentState == null) return;
    try {
      ref.read(shareIntentRouterProvider).dispatchPendingIfReady();
    } catch (_) {}
  });
}
