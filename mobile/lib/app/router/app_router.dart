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

GoRouter createRouter(Ref ref) {
  final refreshNotifier = _RouterRefreshNotifier(ref);

  return GoRouter(
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
  _RouterRefreshNotifier(Ref ref) {
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      if (next.isAuthenticated && previous?.user?.id != next.user?.id) {
        ref.read(ministryContextNotifierProvider.notifier).bootstrap();
      } else if (next.isUnauthenticated) {
        ref.read(ministryContextNotifierProvider.notifier).reset();
      }
      notifyListeners();
    });

    ref.listen<MinistryContextState>(ministryContextNotifierProvider, (_, __) {
      notifyListeners();
    });

    // Handle case where auth is already authenticated before router initialization
    final auth = ref.read(authNotifierProvider);
    final ministry = ref.read(ministryContextNotifierProvider);
    if (auth.isAuthenticated && ministry.isInitializing) {
      Future.microtask(() {
        ref.read(ministryContextNotifierProvider.notifier).bootstrap();
      });
    }
  }
}
