import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/login_screen.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/vocal/data/vocal_exercise_repository.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_exercise.dart';
import 'package:louvaio_mobile/features/vocal/presentation/vocal_player_screen.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MockUser extends Mock implements User {}

class _MultiAccountAuthRepository
    implements
        AuthRepository,
        ChordFontPreferenceUpdater,
        ChordLineSpacingPreferenceUpdater,
        VocalRangePreferenceUpdater,
        AuthAttemptInvalidator {
  final PreferencesStorage storage;
  final Map<String, AuthUser> _profiles;
  final Map<String, User> _fbUsers;
  final StreamController<User?> _authStream =
      StreamController<User?>.broadcast(sync: true);

  User? _currentFirebaseUser;
  String? _activeUid;
  Completer<AuthUser>? pendingGetMeForA;

  _MultiAccountAuthRepository({
    required this.storage,
    required Map<String, AuthUser> profiles,
    required Map<String, User> fbUsers,
  })  : _profiles = Map<String, AuthUser>.from(profiles),
        _fbUsers = Map<String, User>.from(fbUsers);

  void signInAs(String uid) {
    _activeUid = uid;
    _currentFirebaseUser = _fbUsers[uid];
    _authStream.add(_currentFirebaseUser);
  }

  @override
  void cancelPendingAuthentication() {
    _activeUid = null;
    _currentFirebaseUser = null;
  }

  @override
  Stream<User?> authStateChanges() => _authStream.stream;

  @override
  User? get currentFirebaseUser => _currentFirebaseUser;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async =>
      _activeUid == null ? null : 'token-$_activeUid';

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
  Future<AuthUser> getMe() async {
    final uidAtStart = _activeUid;
    if (uidAtStart == null) {
      throw const AppFailure(
        message: 'Unauthenticated',
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      );
    }
    if (uidAtStart == 'user-a' && pendingGetMeForA != null) {
      final delayed = await pendingGetMeForA!.future;
      if (_activeUid != uidAtStart) {
        throw const AppFailure(
          message: 'Sessão alterada.',
          statusCode: 401,
          code: 'SESSION_CHANGED',
        );
      }
      return delayed;
    }

    var user = _profiles[uidAtStart]!;
    await storage.setUserChordFontFamily(user.id, user.chordFontFamily);
    await storage.setUserChordLineSpacingPx(user.id, user.chordLineSpacingPx);
    if (user.vocalMinMidi != null && user.vocalMaxMidi != null) {
      await storage.setUserVocalRange(
        user.id,
        user.vocalMinMidi,
        user.vocalMaxMidi,
      );
    }
    return user;
  }

  @override
  Future<void> signOut() async {
    _activeUid = null;
    _currentFirebaseUser = null;
    await storage.clear();
    _authStream.add(null);
  }

  @override
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) async {
    final uid = _activeUid!;
    final updated = _profiles[uid]!.copyWith(chordFontFamily: chordFontFamily);
    _profiles[uid] = updated;
    await storage.setUserChordFontFamily(uid, chordFontFamily);
    return chordFontFamily;
  }

  @override
  Future<int> updateChordLineSpacingPreference({required int spacingPx}) async {
    final uid = _activeUid!;
    final updated = _profiles[uid]!.copyWith(chordLineSpacingPx: spacingPx);
    _profiles[uid] = updated;
    await storage.setUserChordLineSpacingPx(uid, spacingPx);
    return spacingPx;
  }

  @override
  Future<(int, int)> updateVocalRangePreference({
    required int minMidi,
    required int maxMidi,
  }) async {
    final uid = _activeUid!;
    final updated = _profiles[uid]!.copyWith(
      vocalMinMidi: minMidi,
      vocalMaxMidi: maxMidi,
    );
    _profiles[uid] = updated;
    await storage.setUserVocalRange(uid, minMidi, maxMidi);
    return (minMidi, maxMidi);
  }
}

class _UserScopedMinistryRepository implements MinistryRepository {
  final String? Function() activeUserId;
  final Map<String, List<Ministry>> ministriesByUser;

  _UserScopedMinistryRepository({
    required this.activeUserId,
    required this.ministriesByUser,
  });

  @override
  Future<List<Ministry>> getMyMinistries() async {
    final uid = activeUserId();
    if (uid == null) return const [];
    return List<Ministry>.unmodifiable(ministriesByUser[uid] ?? const []);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _UserScopedDashboardRepository implements DashboardRepository {
  @override
  Future<List<Announcement>> getAnnouncements(
    String ministryId, {
    int limit = 20,
  }) async =>
      const [];

  @override
  Future<List<DashboardScheduleSummary>> getSchedules(
    String ministryId,
  ) async =>
      const [];

  @override
  Future<Announcement> createAnnouncement(
    String ministryId,
    Map<String, dynamic> data,
  ) =>
      throw UnimplementedError();
}

class _UserScopedVocalExerciseRepository implements VocalExerciseRepository {
  final String? Function() activeUserId;
  final Map<String, List<VocalExercise>> exercisesByUser;
  Completer<List<VocalExercise>>? pendingLoadForA;

  _UserScopedVocalExerciseRepository({
    required this.activeUserId,
    required this.exercisesByUser,
  });

  @override
  Future<List<VocalExercise>> listCustomExercises() async {
    final uid = activeUserId();
    if (uid == null) return const [];
    if (uid == 'user-a' && pendingLoadForA != null) {
      return pendingLoadForA!.future;
    }
    return List<VocalExercise>.unmodifiable(exercisesByUser[uid] ?? const []);
  }

  @override
  Future<VocalExercise> getCustomExerciseById(String id) async {
    final uid = activeUserId() ?? '';
    return (exercisesByUser[uid] ?? const []).firstWhere((e) => e.id == id);
  }

  @override
  Future<VocalExercise> createCustomExercise(
    CustomVocalExerciseDraft draft,
  ) async {
    final uid = activeUserId()!;
    final created = VocalExercise(
      id: 'custom-$uid-${(exercisesByUser[uid]?.length ?? 0) + 1}',
      title: draft.title,
      description: draft.description,
      notes: draft.notes,
      noteDurations: draft.noteDurations,
      minTranspose: draft.minTranspose,
      maxTranspose: draft.maxTranspose,
      category: draft.category,
      isCustom: true,
    );
    exercisesByUser.putIfAbsent(uid, () => []).add(created);
    return created;
  }

  @override
  Future<VocalExercise> updateCustomExercise(
    String id,
    CustomVocalExercisePatch patch,
  ) =>
      throw UnimplementedError();

  @override
  Future<void> deleteCustomExercise(String id) async {
    final uid = activeUserId()!;
    exercisesByUser[uid]?.removeWhere((e) => e.id == id);
  }
}

class _UserScopedSmartChordRepository implements SmartChordRepository {
  final String? Function() activeUserId;
  final Map<String, List<SmartChord>> chordsByUser;
  Completer<List<SmartChord>>? pendingLoadForA;

  _UserScopedSmartChordRepository({
    required this.activeUserId,
    required this.chordsByUser,
  });

  @override
  Future<List<SmartChord>> getSmartChords({
    String? search,
    int? page,
    int? limit,
  }) async {
    final uid = activeUserId();
    if (uid == null) return const [];
    if (uid == 'user-a' && pendingLoadForA != null) {
      return pendingLoadForA!.future;
    }
    return List<SmartChord>.unmodifiable(chordsByUser[uid] ?? const []);
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async {
    final uid = activeUserId();
    if (uid == null) return const [];
    return (chordsByUser[uid] ?? const [])
        .where((c) => c.songId == songId)
        .toList(growable: false);
  }

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    final uid = activeUserId() ?? '';
    return (chordsByUser[uid] ?? const []).firstWhere((c) => c.id == id);
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) =>
      throw UnimplementedError();

  @override
  Future<SmartChord> updateSmartChord(
    String id,
    Map<String, dynamic> payload,
  ) =>
      throw UnimplementedError();

  @override
  Future<void> deleteSmartChord(String id) => throw UnimplementedError();

  @override
  Future<SmartChordImportDraft> importPdfDraft(
    List<int> bytes,
    String filename,
  ) =>
      throw UnimplementedError();

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) =>
      throw UnimplementedError();

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) =>
      throw UnimplementedError();

  @override
  Future<SmartChordImportDraft> importCapturedUrlDraft(
    String url,
    String musicalHtml,
  ) =>
      throw UnimplementedError();

  @override
  Future<SmartChordImportDraft> importImageDraft(
    List<int> bytes,
    String filename,
  ) =>
      throw UnimplementedError();
}

class _UserScopedLinkRepository implements SmartChordRepertoireLinkRepository {
  final String? Function() activeUserId;
  final Map<String, Map<String, SmartChordRepertoireLink>> linksByUser;
  final Map<String, List<SmartChord>> songChordsByUser;

  _UserScopedLinkRepository({
    required this.activeUserId,
    required this.linksByUser,
    required this.songChordsByUser,
  });

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    final uid = activeUserId();
    if (uid == null) return const SmartChordRepertoireLink.unlinked();
    return linksByUser[uid]?['$ministryId:$chordId'] ??
        const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async {
    final uid = activeUserId();
    if (uid == null) return const [];
    return List<SmartChord>.unmodifiable(
      songChordsByUser['$uid:$ministryId:$songId'] ?? const [],
    );
  }

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) =>
      throw UnimplementedError();

  @override
  Future<SmartChordRepertoireLink> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) =>
      throw UnimplementedError();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Gate 6 — Multi-Account Isolation (Conta A -> Logout -> Conta B -> Logout -> Conta A)', () {
    testWidgets(
      'isolates vocal exercises, vocal range, chord font/spacing, personal Smart Chords, repertoire links, ministry context, and SharedPreferences across A -> Logout -> B -> Logout -> A',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final rawPrefs = await SharedPreferences.getInstance();
        final prefsStorage = SharedPreferencesStorage(rawPrefs);

        final fbUserA = _MockUser();
        final fbUserB = _MockUser();
        when(() => fbUserA.uid).thenReturn('user-a');
        when(() => fbUserB.uid).thenReturn('user-b');

        const profileA = AuthUser(
          id: 'user-a',
          email: 'conta.a@louvaio.test',
          name: 'Conta A',
          chordFontFamily: 'Georgia',
          chordLineSpacingPx: 12,
          vocalMinMidi: 52, // Mi3
          vocalMaxMidi: 76, // Mi5
        );

        const profileB = AuthUser(
          id: 'user-b',
          email: 'conta.b@louvaio.test',
          name: 'Conta B',
          chordFontFamily: 'Verdana',
          chordLineSpacingPx: 4,
          vocalMinMidi: 60, // Dó4
          vocalMaxMidi: 88, // Mi6
        );

        final authRepo = _MultiAccountAuthRepository(
          storage: prefsStorage,
          profiles: {'user-a': profileA, 'user-b': profileB},
          fbUsers: {'user-a': fbUserA, 'user-b': fbUserB},
        );

        late ProviderContainer container;
        String? activeUserId() => container.read(authNotifierProvider).user?.id;

        final ministryRepo = _UserScopedMinistryRepository(
          activeUserId: activeUserId,
          ministriesByUser: {
            'user-a': const [
              Ministry(id: 'min-a1', name: 'Ministério Alpha A', role: 'admin'),
              Ministry(id: 'min-a2', name: 'Ministério Beta A', role: 'member'),
            ],
            'user-b': const [
              Ministry(id: 'min-b1', name: 'Ministério Exclusivo B', role: 'member'),
            ],
          },
        );

        final vocalRepo = _UserScopedVocalExerciseRepository(
          activeUserId: activeUserId,
          exercisesByUser: {
            'user-a': const [
              VocalExercise(
                id: 'custom-a-1',
                title: 'Vocalize Secreto Conta A',
                description: 'Exclusivo A',
                notes: [0, 4, 7, 4, 0],
                noteDurations: [1, 1, 1, 1, 2],
                minTranspose: -12,
                maxTranspose: 12,
                category: MelodicCategory.misto,
                isCustom: true,
              ),
            ],
            'user-b': const [
              VocalExercise(
                id: 'custom-b-1',
                title: 'Escala Pessoal Conta B',
                description: 'Exclusivo B',
                notes: [7, 5, 4, 2, 0],
                noteDurations: [1, 1, 1, 1, 2],
                minTranspose: -12,
                maxTranspose: 12,
                category: MelodicCategory.descendente,
                isCustom: true,
              ),
            ],
          },
        );

        const chordA = SmartChord(
          id: 'chord-a-1',
          userId: 'user-a',
          songId: 'song-shared-1',
          title: 'Cifra Pessoal Conta A',
          originalKey: 'G',
          content: '[G]Graça de A',
          createdAt: '2026-11-11T10:00:00Z',
          updatedAt: '2026-11-11T10:00:00Z',
        );

        const chordB = SmartChord(
          id: 'chord-b-1',
          userId: 'user-b',
          songId: 'song-shared-1',
          title: 'Cifra Pessoal Conta B',
          originalKey: 'D',
          content: '[D]Louvor de B',
          createdAt: '2026-11-11T10:00:00Z',
          updatedAt: '2026-11-11T10:00:00Z',
        );

        final smartChordRepo = _UserScopedSmartChordRepository(
          activeUserId: activeUserId,
          chordsByUser: {
            'user-a': const [chordA],
            'user-b': const [chordB],
          },
        );

        final linkRepo = _UserScopedLinkRepository(
          activeUserId: activeUserId,
          linksByUser: {
            'user-a': const {
              'min-a2:chord-a-1': SmartChordRepertoireLink(
                link: SmartChordSongLink(
                  id: 'link-a',
                  smartChordId: 'chord-a-1',
                  ministryId: 'min-a2',
                  songId: 'song-shared-1',
                  userId: 'user-a',
                ),
                song: SmartChordSongSummary(
                  id: 'song-shared-1',
                  title: 'Hino Compartilhado',
                ),
              ),
            },
            'user-b': const {},
          },
          songChordsByUser: {
            'user-a:min-a2:song-shared-1': const [chordA],
            'user-b:min-b1:song-shared-1': const [],
          },
        );

        container = ProviderContainer(
          overrides: [
            preferencesStorageProvider.overrideWithValue(prefsStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            ministryRepositoryProvider.overrideWithValue(ministryRepo),
            dashboardRepositoryProvider.overrideWithValue(
              _UserScopedDashboardRepository(),
            ),
            vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
            smartChordRepositoryProvider.overrideWithValue(smartChordRepo),
            smartChordRepertoireLinkRepositoryProvider.overrideWithValue(
              linkRepo,
            ),
          ],
        );
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const LouvAioApp(),
          ),
        );

        // =====================================================================
        // STEP 1: Login as Conta A
        // =====================================================================
        authRepo.signInAs('user-a');
        await tester.pumpAndSettle();

        expect(container.read(authNotifierProvider).isAuthenticated, isTrue);
        expect(container.read(authNotifierProvider).user?.id, 'user-a');
        expect(container.read(chordFontPreferenceProvider), 'Georgia');
        expect(container.read(chordLineSpacingPreferenceProvider), 12);
        expect(container.read(authNotifierProvider).vocalMinMidi, 52);
        expect(container.read(authNotifierProvider).vocalMaxMidi, 76);

        // Conta A has 2 ministries -> select min-a2
        expect(
          container.read(ministryContextNotifierProvider).needsSelection,
          isTrue,
        );
        await container
            .read(ministryContextNotifierProvider.notifier)
            .selectMinistry(
              const Ministry(
                id: 'min-a2',
                name: 'Ministério Beta A',
                role: 'member',
              ),
            );
        await tester.pumpAndSettle();
        expect(
          container.read(ministryContextNotifierProvider).selectedMinistry?.id,
          'min-a2',
        );
        expect(
          prefsStorage.getSelectedMinistryIdForUser('user-a'),
          'min-a2',
        );

        // Load Conta A personal Smart Chords, repertoire link, and custom vocal exercises
        await container.read(smartChordListNotifierProvider.notifier).load();
        await container.read(songSmartChordsNotifierProvider.notifier).load(
              'song-shared-1',
              ministryId: 'min-a2',
            );
        await container
            .read(smartChordRepertoireLinkNotifierProvider.notifier)
            .load(ministryId: 'min-a2', chordId: 'chord-a-1');
        await container
            .read(customVocalExercisesNotifierProvider.notifier)
            .loadForUser('user-a');

        expect(
          container.read(smartChordListNotifierProvider).items.map((c) => c.id),
          ['chord-a-1'],
        );
        expect(
          container
              .read(songSmartChordsNotifierProvider)
              .items
              .map((c) => c.id),
          ['chord-a-1'],
        );
        expect(
          container.read(smartChordRepertoireLinkNotifierProvider).isLinked,
          isTrue,
        );
        expect(
          container
              .read(customVocalExercisesNotifierProvider)
              .exercises
              .map((e) => e.title),
          ['Vocalize Secreto Conta A'],
        );

        // Navigate Conta A to /vocal and verify UI shows Conta A vocal range & custom exercise
        container.read(routerProvider).go('/vocal');
        await tester.pumpAndSettle();
        expect(find.byType(VocalPlayerScreen), findsOneWidget);
        expect(find.text('Extensão vocal: Mi3 a Mi5'), findsOneWidget);
        expect(find.text('Meus exercícios (1)'), findsOneWidget);
        final meusChipA = find.byKey(const ValueKey('vocal_category_filter_meus'));
        await tester.ensureVisible(meusChipA);
        await tester.pumpAndSettle();
        await tester.tap(meusChipA);
        await tester.pumpAndSettle();
        expect(find.text('Vocalize Secreto Conta A'), findsOneWidget);

        // =====================================================================
        // STEP 2: Logout Conta A
        // =====================================================================
        await container.read(authNotifierProvider.notifier).logout();
        await tester.pumpAndSettle();

        // Route /vocal must immediately evict unauthenticated user to /login
        expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);
        expect(find.byType(VocalPlayerScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);

        // All Riverpod caches and active ministry selection must be wiped
        expect(
          container.read(ministryContextNotifierProvider).selectedMinistry,
          isNull,
        );
        expect(
          container.read(ministryContextNotifierProvider).availableMinistries,
          isEmpty,
        );
        expect(container.read(smartChordListNotifierProvider).items, isEmpty);
        expect(container.read(songSmartChordsNotifierProvider).items, isEmpty);
        expect(
          container.read(smartChordRepertoireLinkNotifierProvider).isLinked,
          isFalse,
        );
        expect(
          container.read(customVocalExercisesNotifierProvider).exercises,
          isEmpty,
        );
        // Preferences reset to defaults when logged out
        expect(
          container.read(chordFontPreferenceProvider),
          AuthUser.defaultChordFont,
        );
        expect(
          container.read(chordLineSpacingPreferenceProvider),
          AuthUser.defaultChordLineSpacingPx,
        );
        expect(
          prefsStorage.getSelectedMinistryIdForUser('user-a'),
          isNull,
        );

        // =====================================================================
        // STEP 3: Login as Conta B
        // =====================================================================
        authRepo.signInAs('user-b');
        await tester.pumpAndSettle();

        expect(container.read(authNotifierProvider).isAuthenticated, isTrue);
        expect(container.read(authNotifierProvider).user?.id, 'user-b');
        // Conta B does NOT inherit Conta A preferences or permissions
        expect(container.read(chordFontPreferenceProvider), 'Verdana');
        expect(container.read(chordLineSpacingPreferenceProvider), 4);
        expect(container.read(authNotifierProvider).vocalMinMidi, 60);
        expect(container.read(authNotifierProvider).vocalMaxMidi, 88);

        // Conta B only sees its own ministry (min-b1)
        expect(
          container.read(ministryContextNotifierProvider).selectedMinistry?.id,
          'min-b1',
        );
        expect(
          container
              .read(ministryContextNotifierProvider)
              .availableMinistries
              .map((m) => m.id),
          ['min-b1'],
        );

        // Load Conta B Smart Chords and repertoire song chords
        await container.read(smartChordListNotifierProvider.notifier).load();
        await container.read(songSmartChordsNotifierProvider.notifier).load(
              'song-shared-1',
              ministryId: 'min-b1',
            );

        expect(
          container
              .read(smartChordListNotifierProvider)
              .items
              .map((c) => c.title),
          ['Cifra Pessoal Conta B'],
        );
        // Conta A's repertoire link for song-shared-1 is NOT visible to Conta B
        expect(container.read(songSmartChordsNotifierProvider).items, isEmpty);

        // Navigate Conta B to /vocal: sees Dó4 a Mi6 and Conta B's exercise, zero Conta A data
        container.read(routerProvider).go('/vocal');
        await tester.pumpAndSettle();
        expect(find.byType(VocalPlayerScreen), findsOneWidget);
        expect(find.text('Extensão vocal: Dó4 a Mi6'), findsOneWidget);
        expect(find.text('Meus exercícios (1)'), findsOneWidget);
        final meusChipB = find.byKey(const ValueKey('vocal_category_filter_meus'));
        await tester.ensureVisible(meusChipB);
        await tester.pumpAndSettle();
        await tester.tap(meusChipB);
        await tester.pumpAndSettle();
        expect(find.text('Escala Pessoal Conta B'), findsOneWidget);
        expect(find.text('Vocalize Secreto Conta A'), findsNothing);

        // =====================================================================
        // STEP 4: Logout Conta B
        // =====================================================================
        await container.read(authNotifierProvider.notifier).logout();
        await tester.pumpAndSettle();

        expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);
        expect(find.byType(VocalPlayerScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(
          container.read(customVocalExercisesNotifierProvider).exercises,
          isEmpty,
        );
        expect(container.read(smartChordListNotifierProvider).items, isEmpty);

        // =====================================================================
        // STEP 5: Return to Conta A -> Full recovery of Conta A data without B leak
        // =====================================================================
        authRepo.signInAs('user-a');
        await tester.pumpAndSettle();

        expect(container.read(authNotifierProvider).isAuthenticated, isTrue);
        expect(container.read(authNotifierProvider).user?.id, 'user-a');
        expect(container.read(chordFontPreferenceProvider), 'Georgia');
        expect(container.read(chordLineSpacingPreferenceProvider), 12);
        expect(container.read(authNotifierProvider).vocalMinMidi, 52);
        expect(container.read(authNotifierProvider).vocalMaxMidi, 76);

        // Conta A ministries recovered without Conta B's ministry
        expect(
          container
              .read(ministryContextNotifierProvider)
              .availableMinistries
              .map((m) => m.id),
          ['min-a1', 'min-a2'],
        );
        await container
            .read(ministryContextNotifierProvider.notifier)
            .selectMinistry(
              const Ministry(
                id: 'min-a2',
                name: 'Ministério Beta A',
                role: 'member',
              ),
            );
        await tester.pumpAndSettle();

        await container.read(smartChordListNotifierProvider.notifier).load();
        await container.read(songSmartChordsNotifierProvider.notifier).load(
              'song-shared-1',
              ministryId: 'min-a2',
            );

        expect(
          container
              .read(smartChordListNotifierProvider)
              .items
              .map((c) => c.title),
          ['Cifra Pessoal Conta A'],
        );
        expect(
          container
              .read(songSmartChordsNotifierProvider)
              .items
              .map((c) => c.title),
          ['Cifra Pessoal Conta A'],
        );

        container.read(routerProvider).go('/vocal');
        await tester.pumpAndSettle();
        expect(find.byType(VocalPlayerScreen), findsOneWidget);
        expect(find.text('Extensão vocal: Mi3 a Mi5'), findsOneWidget);
        expect(find.text('Meus exercícios (1)'), findsOneWidget);
        final meusChipReturnA = find.byKey(const ValueKey('vocal_category_filter_meus'));
        await tester.ensureVisible(meusChipReturnA);
        await tester.pumpAndSettle();
        await tester.tap(meusChipReturnA);
        await tester.pumpAndSettle();
        expect(find.text('Vocalize Secreto Conta A'), findsOneWidget);
        expect(find.text('Escala Pessoal Conta B'), findsNothing);
      },
    );

    test(
      'in-flight operations from Conta A (custom exercises and Smart Chords) completing after switch to Conta B are fenced and discarded',
      () async {
        SharedPreferences.setMockInitialValues({});
        final rawPrefs = await SharedPreferences.getInstance();
        final prefsStorage = SharedPreferencesStorage(rawPrefs);

        final fbUserA = _MockUser();
        final fbUserB = _MockUser();
        when(() => fbUserA.uid).thenReturn('user-a');
        when(() => fbUserB.uid).thenReturn('user-b');

        final authRepo = _MultiAccountAuthRepository(
          storage: prefsStorage,
          profiles: {
            'user-a': const AuthUser(
              id: 'user-a',
              email: 'a@louvaio.test',
              name: 'Conta A',
            ),
            'user-b': const AuthUser(
              id: 'user-b',
              email: 'b@louvaio.test',
              name: 'Conta B',
            ),
          },
          fbUsers: {'user-a': fbUserA, 'user-b': fbUserB},
        );

        late ProviderContainer container;
        String? activeUserId() => container.read(authNotifierProvider).user?.id;

        final vocalRepo = _UserScopedVocalExerciseRepository(
          activeUserId: activeUserId,
          exercisesByUser: {'user-b': const []},
        )..pendingLoadForA = Completer<List<VocalExercise>>();

        final smartChordRepo = _UserScopedSmartChordRepository(
          activeUserId: activeUserId,
          chordsByUser: {'user-b': const []},
        )..pendingLoadForA = Completer<List<SmartChord>>();

        container = ProviderContainer(
          overrides: [
            preferencesStorageProvider.overrideWithValue(prefsStorage),
            authRepositoryProvider.overrideWithValue(authRepo),
            vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
            smartChordRepositoryProvider.overrideWithValue(smartChordRepo),
          ],
        );
        addTearDown(container.dispose);

        // Initialize authNotifierProvider so it listens to authStateChanges
        container.read(authNotifierProvider);

        // 1. Login Conta A and start slow loads
        authRepo.signInAs('user-a');
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(container.read(authNotifierProvider).user?.id, 'user-a');

        final slowVocalLoad = container
            .read(customVocalExercisesNotifierProvider.notifier)
            .loadForUser('user-a');
        final slowChordLoad =
            container.read(smartChordListNotifierProvider.notifier).load();

        // 2. Logout Conta A and Login Conta B before A's requests finish
        await container.read(authNotifierProvider.notifier).logout();
        resetAuthenticatedFeatures(container);
        authRepo.signInAs('user-b');
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(container.read(authNotifierProvider).user?.id, 'user-b');

        // 3. Complete Conta A's stale responses now
        vocalRepo.pendingLoadForA!.complete(const [
          VocalExercise(
            id: 'stale-a',
            title: 'Stale Exercise A',
            description: '',
            notes: [0, 2, 4],
            noteDurations: [1, 1, 2],
            minTranspose: -12,
            maxTranspose: 12,
            category: MelodicCategory.ascendente,
            isCustom: true,
          ),
        ]);
        smartChordRepo.pendingLoadForA!.complete(const [
          SmartChord(
            id: 'stale-chord-a',
            userId: 'user-a',
            title: 'Stale Chord A',
            originalKey: 'C',
            content: '[C]Stale',
            createdAt: '',
            updatedAt: '',
          ),
        ]);

        await Future.wait([slowVocalLoad, slowChordLoad]);

        // 4. Conta B must NOT receive Conta A's stale responses
        expect(
          container.read(customVocalExercisesNotifierProvider).exercises,
          isEmpty,
        );
        expect(
          container.read(smartChordListNotifierProvider).items,
          isEmpty,
        );
      },
    );
  });
}
