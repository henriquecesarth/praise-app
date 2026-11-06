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
void resetAuthenticatedFeatures(
  dynamic refOrContainer, {
  bool preservePendingShareIntent = false,
  bool preserveSavedMinistrySelection = false,
}) {
  final dynamic container =
      refOrContainer is Ref ? refOrContainer.container : refOrContainer;
  try {
    container.read(teamFormNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    container.read(teamFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(teamsListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(createMinistryNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(joinMinistryNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(inviteCodeNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(ministryContextNotifierProvider.notifier).reset(
          preserveSavedSelection: preserveSavedMinistrySelection,
        );
  } catch (_) {}
  try {
    container.read(dashboardNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(scheduleListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container
        .read(scheduleFormNotifierProvider.notifier)
        .invalidateTenant();
  } catch (_) {}
  try {
    container.read(membersDirectoryNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container
        .read(memberDetailNotifierProvider.notifier)
        .invalidateTenant();
  } catch (_) {}
  try {
    container.read(memberDetailNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(memberFormNotifierProvider.notifier).invalidateTenant();
  } catch (_) {}
  try {
    container.read(memberFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(adminAvailabilityNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container
        .read(manualMemberAvailabilityNotifierProvider.notifier)
        .reset();
  } catch (_) {}
  try {
    container.read(liturgyListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container
        .read(liturgyDetailNotifierProvider.notifier)
        .invalidateTenant();
  } catch (_) {}
  try {
    container.read(liturgyDetailNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container
        .read(liturgyFormNotifierProvider.notifier)
        .invalidateTenant();
  } catch (_) {}
  try {
    container.read(liturgyFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(smartChordListNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(songSmartChordsNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container
        .read(smartChordRepertoireLinkNotifierProvider.notifier)
        .reset();
  } catch (_) {}
  try {
    container.read(smartChordDetailNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(smartChordFormNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(smartChordImportNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(songFormNotifierProvider.notifier).reset();
  } catch (_) {}

  container.invalidate(createMinistryNotifierProvider);
  container.invalidate(joinMinistryNotifierProvider);
  container.invalidate(inviteCodeNotifierProvider);
  container.invalidate(dashboardNotifierProvider);
  container.invalidate(scheduleListNotifierProvider);
  container.invalidate(scheduleDetailNotifierProvider);
  container.invalidate(scheduleFormNotifierProvider);
  container.invalidate(commentsNotifierProvider);
  container.invalidate(membersDirectoryNotifierProvider);
  container.invalidate(memberDetailNotifierProvider);
  container.invalidate(memberFormNotifierProvider);
  container.invalidate(availabilityListNotifierProvider);
  container.invalidate(adminAvailabilityNotifierProvider);
  container.invalidate(manualMemberAvailabilityNotifierProvider);
  container.invalidate(repertoireListNotifierProvider);
  container.invalidate(songDetailNotifierProvider);
  container.invalidate(songFormNotifierProvider);
  container.invalidate(liturgyListNotifierProvider);
  container.invalidate(liturgyDetailNotifierProvider);
  container.invalidate(liturgyFormNotifierProvider);
  container.invalidate(smartChordListNotifierProvider);
  container.invalidate(songSmartChordsNotifierProvider);
  container.invalidate(smartChordRepertoireLinkNotifierProvider);
  container.invalidate(smartChordDetailNotifierProvider);
  container.invalidate(smartChordFormNotifierProvider);

  container.invalidate(unreadNotificationCountProvider);
  container.invalidate(notificationListProvider);
  try {
    container.read(notificationRouterProvider).clearPendingPayload();
  } catch (_) {}
  if (!preservePendingShareIntent) {
    try {
      container.read(shareIntentRouterProvider).clearPendingPayload();
    } catch (_) {}
  }
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
    implements
        PreferencesStorage,
        UserChordFontPreferencesStorage,
        UserMinistrySelectionStorage {
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
  Future<void> setSelectedMinistryIdForUser(
      String userId, String? ministryId) async {
    final key = 'selectedMinistryId:$userId';
    if (ministryId == null) {
      _data.remove(key);
    } else {
      _data[key] = ministryId;
    }
  }

  @override
  String? getSelectedMinistryIdForUser(String userId) =>
      _data['selectedMinistryId:$userId'];

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
final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((ref) {
  final environment = ref.watch(appEnvironmentProvider);
  final logger = ref.watch(appLoggerProvider);
  return ApiClient(
    environment: environment,
    logger: logger,
  );
});

/// Provider for the authentication repository.
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final auth = ref.watch(firebaseAuthProvider);
  if (auth == null) {
    return const _NoopAuthRepository();
  }
  final apiClient = ref.watch(apiClientProvider);
  final repository = FirebaseAuthRepository(
    firebaseAuth: auth,
    apiClient: apiClient,
    preferencesStorage: ref.watch(preferencesStorageProvider),
  );
  Future<String?> tokenProvider({bool forceRefresh = false}) =>
      repository.getIdToken(forceRefresh: forceRefresh);
  Future<void> onAuthenticationFailed() async {
    // The interceptor checks the initiating session immediately before this
    // callback. Fence native mutations and clear features before yielding,
    // so a newer login cannot be cleared by an old 401 callback.
    final signOut = repository.signOut();
    resetAuthenticatedFeatures(ref.container);
    await signOut;
  }

  apiClient.tokenProvider = tokenProvider;
  apiClient.onAuthenticationFailed = onAuthenticationFailed;
  ref.onDispose(() {
    if (identical(apiClient.tokenProvider, tokenProvider)) {
      apiClient.tokenProvider = null;
    }
    if (identical(apiClient.onAuthenticationFailed, onAuthenticationFailed)) {
      apiClient.onAuthenticationFailed = null;
    }
    repository.dispose();
  });
  return repository;
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
  }) =>
      throw UnimplementedError();

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();

  @override
  Future<AuthUser> getMe() => throw UnimplementedError();

  @override
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) =>
      throw UnimplementedError();

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
        await ref
            .read(pushNotificationNotifierProvider.notifier)
            .unregisterOnLogout();
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
