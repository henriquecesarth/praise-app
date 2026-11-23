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
import '../features/ministry_audio/data/ministry_audio_download_manager.dart';
import '../features/ministry_audio/data/ministry_audio_repository.dart';
import '../features/ministry_audio/data/ministry_audio_storage_info.dart';
import '../features/ministry_audio/data/ministry_audio_transfer_policy.dart';
import '../features/ministry_audio/data/ministry_audio_transport.dart';
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
import '../features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import '../features/ministry_context/presentation/controllers/create_ministry_controller.dart';
import '../features/ministry_context/presentation/controllers/join_ministry_controller.dart';
import '../features/members/presentation/controllers/invite_code_controller.dart';
import '../features/teams/presentation/controllers/teams_providers.dart';
import '../features/vocal/presentation/controllers/vocal_providers.dart';
import '../features/rehearsal_packages/presentation/controllers/rehearsal_package_controller.dart';
export '../features/schedules/presentation/controllers/schedule_providers.dart';
export '../features/repertoire/presentation/controllers/repertoire_providers.dart';
export '../features/availability/presentation/controllers/availability_providers.dart';
export '../features/push_notifications/presentation/controllers/push_notification_providers.dart';
export '../features/members/presentation/controllers/members_providers.dart';
export '../features/smart_chords/presentation/controllers/smart_chord_providers.dart';
export '../features/ministry_context/presentation/controllers/create_ministry_controller.dart';
export '../features/ministry_context/presentation/controllers/join_ministry_controller.dart';
export '../features/members/presentation/controllers/invite_code_controller.dart';
export '../features/teams/presentation/controllers/teams_providers.dart';
export '../features/vocal/presentation/controllers/vocal_providers.dart';
export '../features/rehearsal_packages/presentation/controllers/rehearsal_package_controller.dart';

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
  try {
    container.read(repertoireFoldersNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(repertoireArtistsNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(customVocalExercisesNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(rehearsalPackagesNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(songVersionAudioBindingsNotifierProvider.notifier).reset();
  } catch (_) {}
  try {
    container.read(rehearsalPackageManagerProvider).invalidateSession();
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
  container.invalidate(repertoireFoldersNotifierProvider);
  container.invalidate(repertoireArtistsNotifierProvider);
  container.invalidate(songDetailNotifierProvider);
  container.invalidate(songFormNotifierProvider);
  container.invalidate(smartChordListNotifierProvider);
  container.invalidate(songSmartChordsNotifierProvider);
  container.invalidate(smartChordRepertoireLinkNotifierProvider);
  container.invalidate(smartChordDetailNotifierProvider);
  container.invalidate(smartChordFormNotifierProvider);
  container.invalidate(smartChordImportNotifierProvider);
  container.invalidate(customVocalExercisesNotifierProvider);
  container.invalidate(rehearsalPackagesNotifierProvider);
  container.invalidate(songVersionAudioBindingsNotifierProvider);
  container.invalidate(ministryAudioRepositoryProvider);
  container.invalidate(ministryAudioCacheProvider);
  container.invalidate(ministryAudioDownloadManagerProvider);

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
        UserChordLineSpacingPreferencesStorage,
        UserPdfMarkerPreferencesStorage,
        UserVocalRangePreferencesStorage,
        VocalPlayerVolumePreferencesStorage,
        UserMinistrySelectionStorage {
  final Map<String, String> _data = {};
  final Map<String, int> _intData = {};
  final Map<String, bool> _boolData = {};
  final Map<String, double> _doubleData = {};

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
  Future<void> setUserChordLineSpacingPx(
      String userId, int? lineSpacingPx) async {
    final key = 'louvaio_chord_line_spacing_user_$userId';
    if (lineSpacingPx == null) {
      _intData.remove(key);
    } else {
      _intData[key] = lineSpacingPx;
    }
  }

  @override
  int? getUserChordLineSpacingPx(String userId) =>
      _intData['louvaio_chord_line_spacing_user_$userId'];

  @override
  Future<void> setUserPdfMarkerText(String userId, String? markerText) async {
    final key = 'louvaio_pdf_marker_text_user_$userId';
    if (markerText == null) {
      _data.remove(key);
    } else {
      _data[key] = markerText;
    }
  }

  @override
  String? getUserPdfMarkerText(String userId) =>
      _data['louvaio_pdf_marker_text_user_$userId'];

  @override
  Future<void> setUserPdfMarkerEnabled(String userId, bool enabled) async {
    _boolData['louvaio_pdf_marker_enabled_user_$userId'] = enabled;
  }

  @override
  bool getUserPdfMarkerEnabled(String userId) =>
      _boolData['louvaio_pdf_marker_enabled_user_$userId'] ?? false;

  @override
  Future<void> setUserVocalRange(
    String userId,
    int? minMidi,
    int? maxMidi,
  ) async {
    final minKey = 'louvaio_vocal_min_midi_user_$userId';
    final maxKey = 'louvaio_vocal_max_midi_user_$userId';
    if (minMidi == null || maxMidi == null) {
      _intData.remove(minKey);
      _intData.remove(maxKey);
    } else {
      _intData[minKey] = minMidi;
      _intData[maxKey] = maxMidi;
    }
  }

  @override
  (int, int)? getUserVocalRange(String userId) {
    final minVal = _intData['louvaio_vocal_min_midi_user_$userId'];
    final maxVal = _intData['louvaio_vocal_max_midi_user_$userId'];
    if (minVal == null || maxVal == null) return null;
    return (minVal, maxVal);
  }

  @override
  Future<void> setVocalPlayerVolume(double volume, {String? userId}) async {
    final clamped = volume.isFinite ? volume.clamp(0.0, 1.0) : 1.0;
    final key = userId != null && userId.isNotEmpty
        ? 'louvaio_vocal_player_volume_user_$userId'
        : 'louvaio_vocal_player_volume_default';
    _doubleData[key] = clamped;
  }

  @override
  double? getVocalPlayerVolume({String? userId}) {
    if (userId != null && userId.isNotEmpty) {
      final specific = _doubleData['louvaio_vocal_player_volume_user_$userId'];
      if (specific != null && specific.isFinite) {
        return specific.clamp(0.0, 1.0);
      }
    }
    final fallback = _doubleData['louvaio_vocal_player_volume_default'];
    if (fallback != null && fallback.isFinite) {
      return fallback.clamp(0.0, 1.0);
    }
    return null;
  }

  @override
  Future<void> clear() async {
    _data.clear();
    _intData.clear();
    _boolData.clear();
    _doubleData.clear();
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

final chordLineSpacingPreferenceProvider = Provider<int>((ref) {
  final authState = ref.watch(authNotifierProvider);
  return authState.chordLineSpacingPx;
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

/// Read-only ministry audio library repository bound to the authenticated
/// [ApiClient] session and to the active ministry context (id + generation
/// stamp, so A -> B -> A and notifier rebuilds are detected).
final ministryAudioRepositoryProvider = Provider<MinistryAudioRepository>((
  ref,
) {
  final notifier = ref.watch(ministryContextNotifierProvider.notifier);
  return HttpMinistryAudioRepository(
    apiClient: ref.watch(apiClientProvider),
    activeMinistryId: () => notifier.contextStamp?.ministryId,
    contextEpoch: () => notifier.contextStamp,
  );
});

/// Storage query for the future ministry audio library (reuses the single
/// rehearsal SAF adapter; performs no writes).
final ministryAudioStorageInfoSourceProvider =
    Provider<MinistryAudioStorageInfoSource>((ref) {
  return SafMinistryAudioStorageInfoSource(
    port: ref.watch(rehearsalPackageSafPortProvider),
  );
});

/// Secure six-stem WAV download/storage (no UI, no playback). Bound to the
/// authenticated session and the ministry context stamp; disposed (cancelling
/// any running transfer) on logout/account switch.
final ministryAudioDownloadManagerProvider =
    Provider<MinistryAudioDownloadManager>((ref) {
  final notifier = ref.watch(ministryContextNotifierProvider.notifier);
  final apiClient = ref.watch(apiClientProvider);
  final transport = DioMinistryAudioTransport(
    apiClient: apiClient,
    policy: MinistryAudioTransferPolicy.forEnvironment(
      ref.watch(appEnvironmentProvider),
    ),
  );
  final manager = MinistryAudioDownloadManager(
    repository: ref.watch(ministryAudioRepositoryProvider),
    transport: transport,
    storage: ref.watch(ministryAudioStorageInfoSourceProvider),
    context: () {
      final session = apiClient.sessionContextProvider?.call();
      final stamp = notifier.contextStamp;
      final ministryId = stamp?.ministryId;
      if (session == null || stamp == null || ministryId == null) return null;
      return MinistryAudioDownloadContext(
        userId: session.userId,
        sessionGeneration: session.sessionGeneration,
        ministryId: ministryId,
        epoch: stamp,
      );
    },
  );
  ref.onDispose(() {
    manager.dispose();
    transport.close();
  });
  return manager;
});

/// Quota + LRU + online revalidation over the download manager (no UI, no
/// playback). Disposed on logout/account switch with the manager.
final ministryAudioCacheProvider = Provider<MinistryAudioCache>((ref) {
  final cache = MinistryAudioCache(
    manager: ref.watch(ministryAudioDownloadManagerProvider),
  );
  ref.onDispose(cache.dispose);
  return cache;
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
