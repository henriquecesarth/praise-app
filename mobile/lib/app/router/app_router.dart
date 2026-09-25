import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/login_placeholder_screen.dart';
import '../shell/app_shell.dart';

/// Central GoRouter configuration for LouvAIO mobile.
final GoRouter appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      name: 'home',
      builder: (BuildContext context, GoRouterState state) => const AppShell(),
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
          const LoginPlaceholderScreen(),
    ),
  ],
);
