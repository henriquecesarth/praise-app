import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/controllers/auth_controller.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../providers.dart';
import '../shell/app_shell.dart';

GoRouter createRouter(Ref ref) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: _AuthStateListenable(ref),
    redirect: (BuildContext context, GoRouterState state) {
      final auth = ref.read(authNotifierProvider);
      final isLoggingIn = state.matchedLocation == '/login';

      if (auth.isInitializing) {
        return null;
      }

      final isAuthenticated = auth.isAuthenticated;

      if (!isAuthenticated && !isLoggingIn) {
        return '/login';
      }

      if (isAuthenticated && isLoggingIn) {
        return '/';
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
    ],
  );
}

class _AuthStateListenable extends ChangeNotifier {
  _AuthStateListenable(Ref ref) {
    ref.listen<AuthState>(authNotifierProvider, (_, __) {
      notifyListeners();
    });
  }
}
