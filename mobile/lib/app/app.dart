import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'providers.dart';
import 'theme/app_theme.dart';

/// Root application widget for LouvAIO.
class LouvAioApp extends ConsumerWidget {
  const LouvAioApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'LouvAIO',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      routerConfig: router,
      builder: (context, child) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: isDark
              ? AppTheme.darkSystemOverlayStyle
              : AppTheme.lightSystemOverlayStyle,
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
