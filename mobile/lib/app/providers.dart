import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/http/api_client.dart';
import '../core/logging/app_logger.dart';
import '../core/storage/preferences_storage.dart';
import 'environment/app_environment.dart';
import 'router/app_router.dart';

/// Provider for the active runtime environment.
final appEnvironmentProvider = Provider<AppEnvironment>((ref) {
  return AppEnvironment.fromDartDefines();
});

/// Provider for the sanitizing logger.
final appLoggerProvider = Provider<AppLogger>((ref) {
  final environment = ref.watch(appEnvironmentProvider);
  return AppLogger(isDebug: !environment.isProduction);
});

/// Provider for the central HTTP API client.
final apiClientProvider = Provider<ApiClient>((ref) {
  final environment = ref.watch(appEnvironmentProvider);
  final logger = ref.watch(appLoggerProvider);
  return ApiClient(environment: environment, logger: logger);
});

/// Provider for local preferences storage.
/// Must be overridden in `bootstrap()` with the initialized SharedPreferences instance.
final preferencesStorageProvider = Provider<PreferencesStorage>((ref) {
  throw UnimplementedError(
      'preferencesStorageProvider must be initialized in bootstrap');
});

/// Provider for application routing.
final routerProvider = Provider<GoRouter>((ref) {
  return appRouter;
});
