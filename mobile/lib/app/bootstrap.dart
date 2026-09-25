import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/storage/preferences_storage.dart';
import '../firebase_options.dart';
import 'app.dart';
import 'providers.dart';
import 'theme/app_theme.dart';

/// Centralized application bootstrap routine.
///
/// Ensures Flutter bindings, Firebase, and persistent preferences are initialized
/// before running the widget tree inside [ProviderScope].
Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (_) {
    runApp(const FirebaseInitErrorApp());
    return;
  }

  final sharedPreferences = await SharedPreferences.getInstance();
  final preferencesStorage = SharedPreferencesStorage(sharedPreferences);

  runApp(
    ProviderScope(
      overrides: [
        preferencesStorageProvider.overrideWithValue(preferencesStorage),
      ],
      child: const LouvAioApp(),
    ),
  );
}

/// Safe startup failure state rendered when Firebase fails to initialize.
class FirebaseInitErrorApp extends StatelessWidget {
  const FirebaseInitErrorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: EdgeInsets.all(24.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 56,
                    color: AppColors.error,
                  ),
                  SizedBox(height: 16),
                  Text(
                    'Falha na Inicialização',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: AppColors.green,
                    ),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Não foi possível inicializar os serviços do LouvAIO. Verifique sua conexão e tente reiniciar o aplicativo.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
