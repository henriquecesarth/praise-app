import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/storage/preferences_storage.dart';
import 'app.dart';
import 'providers.dart';

/// Centralized application bootstrap routine.
///
/// Ensures Flutter bindings and persistent non-secure preferences are ready
/// before building the widget tree inside [ProviderScope].
Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();

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
