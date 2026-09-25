import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/http/api_client.dart';
import '../core/logging/app_logger.dart';
import '../core/storage/preferences_storage.dart';
import '../features/auth/data/auth_repository.dart';
import '../features/auth/presentation/controllers/auth_controller.dart';
import '../features/dashboard/data/dashboard_repository.dart';
import '../features/dashboard/presentation/controllers/dashboard_controller.dart';
import '../features/ministry_context/data/ministry_repository.dart';
import '../features/ministry_context/presentation/controllers/ministry_context_controller.dart';
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

/// Provider for local preferences storage.
/// Must be overridden in ootstrap() with the initialized SharedPreferences instance.
final preferencesStorageProvider = Provider<PreferencesStorage>((ref) {
  throw UnimplementedError(
      'preferencesStorageProvider must be initialized in bootstrap');
});

/// Provider for the FirebaseAuth instance.
final firebaseAuthProvider = Provider<FirebaseAuth>((ref) {
  return FirebaseAuth.instance;
});

/// Provider for the central HTTP API client.
final apiClientProvider = Provider<ApiClient>((ref) {
  final environment = ref.watch(appEnvironmentProvider);
  final logger = ref.watch(appLoggerProvider);
  final auth = ref.watch(firebaseAuthProvider);

  return ApiClient(
    environment: environment,
    logger: logger,
    tokenProvider: ({bool forceRefresh = false}) async {
      final user = auth.currentUser;
      if (user == null) return null;
      return user.getIdToken(forceRefresh);
    },
    onAuthenticationFailed: () async {
      await auth.signOut();
      final preferences = ref.read(preferencesStorageProvider);
      await preferences.clear();
    },
  );
});

/// Provider for the authentication repository.
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return FirebaseAuthRepository(
    firebaseAuth: ref.watch(firebaseAuthProvider),
    apiClient: ref.watch(apiClientProvider),
    preferencesStorage: ref.watch(preferencesStorageProvider),
  );
});

/// Provider for the authentication state notifier.
final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(authRepositoryProvider));
});

/// Provider for the ministry repository.
final ministryRepositoryProvider = Provider<MinistryRepository>((ref) {
  return HttpMinistryRepository(
    apiClient: ref.watch(apiClientProvider),
  );
});

/// Provider for the ministry context state notifier.
final ministryContextNotifierProvider =
    StateNotifierProvider<MinistryContextNotifier, MinistryContextState>((ref) {
  return MinistryContextNotifier(
    repository: ref.watch(ministryRepositoryProvider),
    preferencesStorage: ref.watch(preferencesStorageProvider),
  );
});

/// Provider for the dashboard repository.
final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  return HttpDashboardRepository(
    apiClient: ref.watch(apiClientProvider),
  );
});

/// Provider for the dashboard state notifier.
final dashboardNotifierProvider =
    StateNotifierProvider<DashboardNotifier, DashboardState>((ref) {
  return DashboardNotifier(
    repository: ref.watch(dashboardRepositoryProvider),
  );
});

/// Provider for application routing.
final routerProvider = Provider<GoRouter>((ref) {
  return createRouter(ref);
});
