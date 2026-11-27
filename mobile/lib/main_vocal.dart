import 'package:flutter/material.dart';

import 'app/theme/app_theme.dart';
import 'features/vocal/presentation/vocal_player_screen.dart';

/// Offline M21 Android homologation entry point, without Firebase/bootstrap.
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
