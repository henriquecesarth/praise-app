import 'package:flutter/material.dart';

import 'app/theme/app_theme.dart';
import 'features/vocal/presentation/vocal_player_screen.dart';

/// Technical test harness entry point for M21 isolated audio benchmarking.
/// Restricted strictly to local developer bench tests; never packaged or distributed
/// to end users. The canonical production and staging applications always boot via
/// main.dart with full authentication and route guard protection.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const VocalHomologationApp());
}

class VocalHomologationApp extends StatelessWidget {
  const VocalHomologationApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'M21 Vocal',
    theme: AppTheme.lightTheme,
    home: const VocalPlayerScreen(),
  );
}
