import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/storage/preferences_storage.dart';
import '../firebase_options.dart';
import 'environment/app_environment.dart';
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
    final environment = AppEnvironment.fromDartDefines();
    const firebaseEnvironment = String.fromEnvironment('FIREBASE_ENV');
    if (firebaseEnvironment == 'staging' || firebaseEnvironment == 'qa') {
      const projectId = String.fromEnvironment('FIREBASE_STAGING_PROJECT_ID');
      const productionProjectId = 'praise-app-7a362';
      const qaProjectId = String.fromEnvironment('FIREBASE_QA_PROJECT_ID');
      final options = DefaultFirebaseOptions.currentPlatform;
      final stagingInvalid =
          firebaseEnvironment == 'staging' &&
          (projectId == productionProjectId || options.projectId != projectId);
      final qaInvalid =
          firebaseEnvironment == 'qa' &&
          (qaProjectId != productionProjectId ||
              options.projectId != qaProjectId);
      if (stagingInvalid ||
          qaInvalid ||
          options.apiKey.isEmpty ||
          options.appId.isEmpty ||
          options.messagingSenderId.isEmpty ||
          options.storageBucket == null ||
          options.storageBucket!.isEmpty) {
        throw StateError(
          firebaseEnvironment == 'qa'
              ? 'QA Firebase configuration is missing or unsafe.'
              : 'Staging Firebase configuration is missing or unsafe.',
        );
      }
    } else if (environment.isStaging) {
      throw StateError('Staging app requires FIREBASE_ENV=staging.');
    }
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } on ArgumentError catch (error) {
    debugPrint('[Bootstrap][ConfigError] ${error.runtimeType}: ${error.message}');
    runApp(const FirebaseInitErrorApp(isConfigurationError: true));
    return;
  } on StateError catch (error) {
    debugPrint('[Bootstrap][ConfigError] ${error.runtimeType}: ${error.message}');
    runApp(const FirebaseInitErrorApp(isConfigurationError: true));
    return;
  } on FirebaseException catch (error) {
    debugPrint('[Bootstrap][FirebaseError] code=${error.code}');
    runApp(const FirebaseInitErrorApp());
    return;
  } catch (error) {
    debugPrint('[Bootstrap][InitError] ${error.runtimeType}');
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

/// Safe startup failure state rendered when configuration or Firebase fails to initialize.
class FirebaseInitErrorApp extends StatelessWidget {
  final bool isConfigurationError;

  const FirebaseInitErrorApp({
    super.key,
    this.isConfigurationError = false,
  });

  @override
  Widget build(BuildContext context) {
    final description = isConfigurationError
        ? 'Não foi possível inicializar os serviços do LouvAIO devido a uma configuração de ambiente inválida.'
        : 'Não foi possível inicializar os serviços do LouvAIO. Verifique sua conexão e tente reiniciar o aplicativo.';

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 56, color: AppColors.error),
                  const SizedBox(height: 16),
                  const Text(
                    'Falha na Inicialização',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: AppColors.green,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    description,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14),
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
