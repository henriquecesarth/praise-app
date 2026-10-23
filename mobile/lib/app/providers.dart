import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/http/api_client.dart';
import '../core/logging/app_logger.dart';
import '../core/storage/preferences_storage.dart';
import '../features/auth/data/auth_repository.dart';
import '../features/auth/domain/auth_user.dart';
import '../features/auth/presentation/controllers/auth_controller.dart';
import '../features/dashboard/data/dashboard_repository.dart';
import '../features/dashboard/presentation/controllers/dashboard_controller.dart';
import '../features/ministry_context/data/ministry_repository.dart';
import '../features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'environment/app_environment.dart';
import 'router/app_router.dart';
import '../features/schedules/presentation/controllers/schedule_providers.dart';
import '../features/repertoire/presentation/controllers/repertoire_providers.dart';
import '../features/availability/presentation/controllers/availability_providers.dart';
import '../features/push_notifications/presentation/controllers/push_notification_providers.dart';
import '../features/members/presentation/controllers/members_providers.dart';
import '../features/notifications/presentation/controllers/notification_providers.dart';
import '../features/liturgies/presentation/controllers/liturgy_providers.dart';
import '../features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import '../features/ministry_context/presentation/controllers/create_ministry_controller.dart';
import '../features/ministry_context/presentation/controllers/join_ministry_controller.dart';
import '../features/members/presentation/controllers/invite_code_controller.dart';
import '../features/teams/presentation/controllers/teams_providers.dart';
export '../features/schedules/presentation/controllers/schedule_providers.dart';
export '../features/repertoire/presentation/controllers/repertoire_providers.dart';
export '../features/availability/presentation/controllers/availability_providers.dart';
export '../features/push_notifications/presentation/controllers/push_notification_providers.dart';
export '../features/members/presentation/controllers/members_providers.dart';
export '../features/liturgies/presentation/controllers/liturgy_providers.dart';
export '../features/smart_chords/presentation/controllers/smart_chord_providers.dart';
export '../features/ministry_context/presentation/controllers/create_ministry_controller.dart';
export '../features/ministry_context/presentation/controllers/join_ministry_controller.dart';
export '../features/members/presentation/controllers/invite_code_controller.dart';
export '../features/teams/presentation/controllers/teams_providers.dart';

/// Clears all authenticated feature caches from memory upon logout or user change.
/// Accepts either [Ref] or [ProviderContainer].
void resetAuthenticatedFeatures(dynamic refOrContainer) {
  try {
    refOrContainer.read(teamFormNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    refOrContainer.read(teamFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(teamsListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(createMinistryNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(joinMinistryNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(inviteCodeNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(ministryContextNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(dashboardNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(scheduleListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(scheduleFormNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    refOrContainer.read(membersDirectoryNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(memberDetailNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    refOrContainer.read(memberDetailNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(memberFormNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    refOrContainer.read(memberFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(adminAvailabilityNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(manualMemberAvailabilityNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(liturgyListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(liturgyDetailNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    refOrContainer.read(liturgyDetailNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(liturgyFormNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    refOrContainer.read(liturgyFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(smartChordListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(songSmartChordsNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(smartChordRepertoireLinkNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(smartChordDetailNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(smartChordFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(smartChordImportNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    refOrContainer.read(songFormNotifierProvider.notifier).reset();
  } catch (_) {}

  refOrContainer.invalidate(dashboardNotifierProvider);
  refOrContainer.invalidate(scheduleListNotifierProvider);
  refOrContainer.invalidate(scheduleDetailNotifierProvider);
  refOrContainer.invalidate(scheduleFormNotifierProvider);
  refOrContainer.invalidate(commentsNotifierProvider);
  refOrContainer.invalidate(membersDirectoryNotifierProvider);
  refOrContainer.invalidate(memberDetailNotifierProvider);
  refOrContainer.invalidate(memberFormNotifierProvider);
  refOrContainer.invalidate(availabilityListNotifierProvider);
  refOrContainer.invalidate(adminAvailabilityNotifierProvider);
  refOrContainer.invalidate(manualMemberAvailabilityNotifierProvider);
  refOrContainer.invalidate(repertoireListNotifierProvider);
  refOrContainer.invalidate(songDetailNotifierProvider);
  refOrContainer.invalidate(songFormNotifierProvider);
  refOrContainer.invalidate(liturgyListNotifierProvider);
  refOrContainer.invalidate(liturgyDetailNotifierProvider);
  refOrContainer.invalidate(liturgyFormNotifierProvider);
  refOrContainer.invalidate(smartChordListNotifierProvider);
  refOrContainer.invalidate(songSmartChordsNotifierProvider);
  refOrContainer.invalidate(smartChordRepertoireLinkNotifierProvider);
  refOrContainer.invalidate(smartChordDetailNotifierProvider);
  refOrContainer.invalidate(smartChordFormNotifierProvider);

  refOrContainer.invalidate(unreadNotificationCountProvider);
  refOrContainer.invalidate(notificationListProvider);
  try {
    refOrContainer.read(notificationRouterProvider).clearPendingPayload();
  } catch (_) {}
}

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
/// Overridden in bootstrap() with the initialized SharedPreferences instance.
final preferencesStorageProvider = Provider<PreferencesStorage>((ref) {
  return InMemoryPreferencesStorage();
});

class InMemoryPreferencesStorage
    implements PreferencesStorage, UserChordFontPreferencesStorage {
  final Map<String, String> _data = {};

  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {
    if (ministryId == null) {
      _data.remove('selectedMinistryId');
    } else {
      _data['selectedMinistryId'] = ministryId;
    }
  }

  @override
  String? getSelectedMinistryId() => _data['selectedMinistryId'];

  @override
  Future<void> setThemeMode(String? themeMode) async {
    if (themeMode == null) {
      _data.remove('themeMode');
    } else {
      _data['themeMode'] = themeMode;
    }
  }

  @override
  String? getThemeMode() => _data['themeMode'];

  @override
  Future<void> setUserChordFontFamily(String userId, String? fontFamily) async {
    final key = 'louvaio_chord_font_user_$userId';
    if (fontFamily == null) {
      _data.remove(key);
    } else {
      _data[key] = fontFamily;
    }
  }

  @override
  String? getUserChordFontFamily(String userId) =>
      _data['louvaio_chord_font_user_$userId'];

  @override
  Future<void> clear() async {
    _data.clear();
  }
}

/// Provider for the FirebaseAuth instance.
final firebaseAuthProvider = Provider<FirebaseAuth?>((ref) {
  try {
    return FirebaseAuth.instance;
  } catch (_) {
    return null;
  }
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
      if (auth == null) return null;
      final user = auth.currentUser;
      if (user == null) return null;
      return user.getIdToken(forceRefresh);
    },
    onAuthenticationFailed: () async {
      if (auth != null) {
        await auth.signOut();
      }
      final preferences = ref.read(preferencesStorageProvider);
      await preferences.clear();
      resetAuthenticatedFeatures(ref);
    },
  );
});

/// Provider for the authentication repository.
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final auth = ref.watch(firebaseAuthProvider);
  if (auth == null) {
    return const _NoopAuthRepository();
  }
  return FirebaseAuthRepository(
    firebaseAuth: auth,
    apiClient: ref.watch(apiClientProvider),
    preferencesStorage: ref.watch(preferencesStorageProvider),
  );
});

class _NoopAuthRepository
    implements AuthRepository, ChordFontPreferenceUpdater {
  const _NoopAuthRepository();

  @override
  Stream<User?> authStateChanges() => const Stream.empty();

  @override
  User? get currentFirebaseUser => null;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) => throw UnimplementedError();

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) => throw UnimplementedError();

  @override
  Future<AuthUser> getMe() => throw UnimplementedError();

  @override
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) => throw UnimplementedError();

  @override
  Future<void> signOut() async {}
}

/// Provider for the authentication state notifier.
final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(
    ref.watch(authRepositoryProvider),
    onBeforeSignOut: () async {
      try {
        await ref.read(pushNotificationNotifierProvider.notifier).unregisterOnLogout();
      } catch (_) {}
    },
  );
});

/// Reactive provider for the active user's effective chord font preference.
final chordFontPreferenceProvider = Provider<String>((ref) {
  final authState = ref.watch(authNotifierProvider);
  return authState.chordFontFamily;
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

/// Provider for the create ministry state notifier.
final createMinistryNotifierProvider =
    StateNotifierProvider<CreateMinistryNotifier, CreateMinistryState>((ref) {
  final auth = ref.watch(authNotifierProvider);
  return CreateMinistryNotifier(
    repository: ref.watch(ministryRepositoryProvider),
    contextNotifier: ref.watch(ministryContextNotifierProvider.notifier),
    boundUserId: auth.user?.id,
  );
});

/// Provider for the join ministry state notifier.
final joinMinistryNotifierProvider =
    StateNotifierProvider<JoinMinistryNotifier, JoinMinistryState>((ref) {
  final auth = ref.watch(authNotifierProvider);
  return JoinMinistryNotifier(
    repository: ref.watch(ministryRepositoryProvider),
    contextNotifier: ref.watch(ministryContextNotifierProvider.notifier),
    boundUserId: auth.user?.id,
  );
});

/// Provider for the invite code state notifier.
final inviteCodeNotifierProvider =
    StateNotifierProvider<InviteCodeNotifier, InviteCodeState>((ref) {
  final auth = ref.watch(authNotifierProvider);
  final ministry = ref.watch(ministryContextNotifierProvider);
  return InviteCodeNotifier(
    repository: ref.watch(ministryRepositoryProvider),
    boundMinistryId: ministry.selectedMinistry?.id,
    boundUserId: auth.user?.id,
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
