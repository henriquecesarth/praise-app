import 'dart:async';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/vocal/data/vocal_exercise_repository.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_exercise.dart';
import 'package:louvaio_mobile/features/vocal/presentation/vocal_player_screen.dart';
import 'package:mocktail/mocktail.dart';

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockUser extends Mock implements User {}

class _FakeAuthRepository
    implements
        AuthRepository,
        ChordFontPreferenceUpdater,
        ChordLineSpacingPreferenceUpdater,
        VocalRangePreferenceUpdater {
  final StreamController<User?> _authStream =
      StreamController<User?>.broadcast();
  User? _currentFirebaseUser;
  AuthUser _currentMe;
  int patchVocalCalls = 0;
  (int, int)? lastPatchedVocalRange;

  _FakeAuthRepository({required AuthUser initialUser, required User fbUser})
    : _currentMe = initialUser,
      _currentFirebaseUser = fbUser;

  void switchUser(AuthUser? nextUser, User? nextFbUser) {
    if (nextUser != null) {
      _currentMe = nextUser;
    }
    _currentFirebaseUser = nextFbUser;
    _authStream.add(nextFbUser);
  }

  @override
  Stream<User?> authStateChanges() async* {
    yield _currentFirebaseUser;
    yield* _authStream.stream;
  }

  @override
  User? get currentFirebaseUser => _currentFirebaseUser;

  @override
  Future<AuthUser> getMe() async => _currentMe;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => 'token-123';

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
  Future<void> signOut() async {
    _currentFirebaseUser = null;
    _authStream.add(null);
  }

  @override
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) async {
    _currentMe = _currentMe.copyWith(chordFontFamily: chordFontFamily);
    return chordFontFamily;
  }

  @override
  Future<int> updateChordLineSpacingPreference({required int spacingPx}) async {
    _currentMe = _currentMe.copyWith(chordLineSpacingPx: spacingPx);
    return spacingPx;
  }

  @override
  Future<(int, int)> updateVocalRangePreference({
    required int minMidi,
    required int maxMidi,
  }) async {
    patchVocalCalls++;
    lastPatchedVocalRange = (minMidi, maxMidi);
    _currentMe = _currentMe.copyWith(
      vocalMinMidi: minMidi,
      vocalMaxMidi: maxMidi,
    );
    return (minMidi, maxMidi);
  }
}

class _InMemoryVocalExerciseRepository implements VocalExerciseRepository {
  final Map<String, List<VocalExercise>> _byUser = {};
  final String? Function() currentUserId;
  int _counter = 0;

  _InMemoryVocalExerciseRepository({required this.currentUserId});

  List<VocalExercise> _listForActiveUser() {
    final uid = currentUserId() ?? '';
    return _byUser.putIfAbsent(uid, () => []);
  }

  @override
  Future<List<VocalExercise>> listCustomExercises() async {
    return List.unmodifiable(_listForActiveUser());
  }

  @override
  Future<VocalExercise> getCustomExerciseById(String id) async {
    return _listForActiveUser().firstWhere((e) => e.id == id);
  }

  @override
  Future<VocalExercise> createCustomExercise(
    CustomVocalExerciseDraft draft,
  ) async {
    final created = VocalExercise(
      id: 'custom-${++_counter}',
      title: draft.title.trim(),
      description: draft.description.trim(),
      notes: draft.notes,
      noteDurations: draft.noteDurations,
      minTranspose: draft.minTranspose,
      maxTranspose: draft.maxTranspose,
      category: draft.category,
      isCustom: true,
    );
    _listForActiveUser().add(created);
    return created;
  }

  @override
  Future<VocalExercise> updateCustomExercise(
    String id,
    CustomVocalExercisePatch patch,
  ) async {
    final list = _listForActiveUser();
    final idx = list.indexWhere((e) => e.id == id);
    final current = list[idx];
    final updated = current.copyWith(
      title: patch.title?.trim() ?? current.title,
      description: patch.description?.trim() ?? current.description,
      notes: patch.notes ?? current.notes,
      noteDurations: patch.noteDurations ?? current.noteDurations,
      category: patch.category ?? current.category,
      isCustom: true,
    );
    list[idx] = updated;
    return updated;
  }

  @override
  Future<void> deleteCustomExercise(String id) async {
    _listForActiveUser().removeWhere((e) => e.id == id);
  }
}

class _MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) handler;
  _MockAdapter(this.handler);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) => handler(options);

  @override
  void close({bool force = false}) {}
}

void main() {
  test(
    'FirebaseAuthRepository.updateVocalRangePreference sends PATCH /auth/me/preferences and preserves Smart Chords preferences',
    () async {
      final mockAuth = _MockFirebaseAuth();
      final mockUser = _MockUser();
      when(() => mockUser.uid).thenReturn('user-vocal-1');
      when(() => mockAuth.currentUser).thenReturn(mockUser);
      when(
        () => mockAuth.authStateChanges(),
      ).thenAnswer((_) => Stream.value(mockUser));

      final storage = InMemoryPreferencesStorage();
      await storage.setUserChordFontFamily('user-vocal-1', 'Georgia');
      await storage.setUserChordLineSpacingPx('user-vocal-1', 12);

      final apiClient = ApiClient(
        environment: const AppEnvironment(
          env: AppEnv.development,
          apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
        ),
        logger: const AppLogger(isDebug: false),
      );

      Map<String, dynamic>? sentPayload;
      apiClient.dio.httpClientAdapter = _MockAdapter((options) async {
        expect(options.method, 'PATCH');
        expect(options.path, '/auth/me/preferences');
        sentPayload = Map<String, dynamic>.from(options.data as Map);
        return ResponseBody.fromString(
          '{"preferences":{"chord_font_family":"Georgia","chord_line_spacing_px":12,"vocal_min_midi":57,"vocal_max_midi":84}}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final repo = FirebaseAuthRepository(
        firebaseAuth: mockAuth,
        apiClient: apiClient,
        preferencesStorage: storage,
      );

      final confirmed = await repo.updateVocalRangePreference(
        minMidi: 57,
        maxMidi: 84,
      );
      expect(confirmed, (57, 84));
      expect(sentPayload, {'vocal_min_midi': 57, 'vocal_max_midi': 84});
      expect(storage.getUserVocalRange('user-vocal-1'), (57, 84));
      expect(storage.getUserChordFontFamily('user-vocal-1'), 'Georgia');
      expect(storage.getUserChordLineSpacingPx('user-vocal-1'), 12);
    },
  );

  testWidgets(
    'VocalPlayerScreen hydrates saved vocal range, saves updates, and manages custom exercises with account isolation',
    (tester) async {
      final fbUserA = _MockUser();
      final fbUserB = _MockUser();
      when(() => fbUserA.uid).thenReturn('uid-a');
      when(() => fbUserB.uid).thenReturn('uid-b');

      const userA = AuthUser(
        id: 'uid-a',
        email: 'a@louvaio.test',
        name: 'Cantor A',
        chordFontFamily: 'Georgia',
        chordLineSpacingPx: 8,
        vocalMinMidi: 57, // Lá3
        vocalMaxMidi: 84, // Dó6
      );

      const userB = AuthUser(
        id: 'uid-b',
        email: 'b@louvaio.test',
        name: 'Cantor B',
      );

      final fakeAuthRepo = _FakeAuthRepository(
        initialUser: userA,
        fbUser: fbUserA,
      );

      late ProviderContainer container;
      final customRepo = _InMemoryVocalExerciseRepository(
        currentUserId: () => container.read(authNotifierProvider).user?.id,
      );

      container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(fakeAuthRepo),
          vocalExerciseRepositoryProvider.overrideWithValue(customRepo),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: VocalPlayerScreen()),
        ),
      );
      await tester.pumpAndSettle();

      // 1. Hydrated Cantor A vocal range (Lá3 a Dó6)
      expect(find.text('Extensão vocal: Lá3 a Dó6'), findsOneWidget);

      // 2. Select preset Voz Aguda (Dó4–Mi6) and save to profile
      final agudaChip = find.byKey(const ValueKey('vocal_range_preset_aguda'));
      await tester.ensureVisible(agudaChip);
      await tester.tap(agudaChip);
      await tester.pumpAndSettle();
      expect(find.text('Extensão vocal: Dó4 a Mi6'), findsOneWidget);

      final saveRangeBtn = find.byKey(
        const ValueKey('vocal_save_range_button'),
      );
      await tester.ensureVisible(saveRangeBtn);
      await tester.tap(saveRangeBtn);
      await tester.pumpAndSettle();

      expect(fakeAuthRepo.patchVocalCalls, 1);
      expect(fakeAuthRepo.lastPatchedVocalRange, (60, 88));
      expect(find.text('Extensão salva no seu perfil!'), findsOneWidget);
      // Smart Chords preferences preserved on AuthUser
      expect(container.read(authNotifierProvider).user?.chordFontFamily, 'Georgia');
      expect(container.read(authNotifierProvider).user?.chordLineSpacingPx, 8);

      // 3. Create a custom vocal exercise for Cantor A
      final newCustomBtn = find.byKey(
        const ValueKey('vocal_new_custom_button'),
      );
      await tester.ensureVisible(newCustomBtn);
      await tester.pumpAndSettle();
      await tester.tap(newCustomBtn);
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('custom_exercise_title_input')),
        'Arpejo Personalizado A',
      );
      await tester.enterText(
        find.byKey(const ValueKey('custom_exercise_description_input')),
        'Exercício exclusivo do Cantor A',
      );
      await tester.tap(
        find.byKey(const ValueKey('custom_save_exercise_button')),
      );
      await tester.pumpAndSettle();

      // Custom exercise is created and auto-selected
      expect(find.text('Arpejo Personalizado A'), findsWidgets);
      expect(
        container.read(customVocalExercisesNotifierProvider).exercises,
        hasLength(1),
      );

      // 4. Switch account to Cantor B -> Cantor A custom exercises and range are cleared
      fakeAuthRepo.switchUser(userB, fbUserB);
      await tester.pumpAndSettle();

      expect(
        container.read(customVocalExercisesNotifierProvider).exercises,
        isEmpty,
      );
      expect(find.text('Extensão vocal: Dó3 a Dó6'), findsOneWidget);
      expect(find.text('Arpejo Personalizado A'), findsNothing);
    },
  );
}
