import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_form_screen.dart';

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword(
          {required String email, required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp(
          {required String name,
          required String email,
          required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class FakeAuthNotifier extends AuthNotifier {
  FakeAuthNotifier([
    AuthState initialState = const AuthState.authenticated(
      AuthUser(id: 'admin_user', email: 'admin@test.com', name: 'Admin'),
    ),
  ]) : super(_FakeAuthRepo()) {
    state = initialState;
  }

  void setUser(AuthUser? user) {
    if (user != null) {
      state = AuthState.authenticated(user);
    } else {
      state = const AuthState.unauthenticated();
    }
  }

  @override
  Future<void> logout() async {
    state = const AuthState.unauthenticated();
  }
}

class _FakePreferencesStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}
  @override
  String? getSelectedMinistryId() => null;
  @override
  String? getThemeMode() => null;
  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}
  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => [];
}

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier({String role = 'admin'})
      : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(id: 'min_1', name: 'Min 1', role: role),
      availableMinistries: [
        Ministry(id: 'min_1', name: 'Min 1', role: role),
      ],
    );
  }
}

class FakeRepertoireRepo implements RepertoireRepository {
  List<Artist> artists = [
    const Artist(id: 'art-1', ministryId: 'min_1', name: 'Morada'),
    const Artist(id: 'art-2', ministryId: 'min_1', name: 'Diante do Trono'),
  ];
  List<Classification> classifications = [
    const Classification(id: 'cls-1', ministryId: 'min_1', name: 'Adoracao', color: '#10B981'),
  ];
  SongFormData? lastCreatedData;
  SongFormData? lastUpdatedData;
  AppFailure? artistErrorToThrow;

  @override
  Future<PaginatedSongs> listSongs(String ministryId,
      {String? search, String? classificationId, String? cursor, int? page, int? limit}) async {
    return const PaginatedSongs(songs: [], total: 0);
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => classifications;

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => artists;

  @override
  Future<Artist> createArtist(String ministryId, String name) async {
    if (artistErrorToThrow != null) throw artistErrorToThrow!;
    final newArtist = Artist(id: 'art-new', ministryId: ministryId, name: name);
    artists.add(newArtist);
    return newArtist;
  }

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async {
    lastCreatedData = data;
    return SongDetail(id: 'new-song-id', ministryId: ministryId, title: data.title);
  }

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async {
    lastUpdatedData = data;
    return SongDetail(id: songId, ministryId: ministryId, title: data.title);
  }

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}
}

void main() {
  late FakeRepertoireRepo fakeRepo;
  late FakeAuthNotifier authNotifier;
  late FakeMinistryContextNotifier ministryNotifier;

  setUp(() {
    fakeRepo = FakeRepertoireRepo();
    authNotifier = FakeAuthNotifier();
    ministryNotifier = FakeMinistryContextNotifier(role: 'admin');
  });

  Widget buildSubject({SongDetail? initialSong}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        songFormNotifierProvider.overrideWith((ref) => SongFormNotifier(repository: fakeRepo)),
      ],
      child: MaterialApp(
        home: SongFormScreen(
          ministryId: 'min_1',
          initialSong: initialSong,
        ),
      ),
    );
  }

  Widget buildPushableSubject({SongDetail? initialSong, String ministryId = 'min_1'}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        songFormNotifierProvider.overrideWith((ref) => SongFormNotifier(repository: fakeRepo)),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => ElevatedButton(
              onPressed: () {
                Navigator.of(ctx).push(
                  MaterialPageRoute(
                    builder: (_) => SongFormScreen(
                      ministryId: ministryId,
                      initialSong: initialSong,
                    ),
                  ),
                );
              },
              child: const Text('Open Song Form'),
            ),
          ),
        ),
      ),
    );
  }

  group('SongFormScreen UI & Interactions', () {
    testWidgets('renders all fields and key selector in create mode', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('song_title_input')), findsOneWidget);
      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('song_bpm_input')), findsOneWidget);
      expect(find.byKey(const ValueKey('song_duration_input')), findsOneWidget);
      expect(find.byKey(const ValueKey('song_lyrics_input')), findsOneWidget);
      expect(find.byKey(const ValueKey('key_chip_G')), findsOneWidget);
    });

    testWidgets('validates required title on submit', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Tap save with empty title
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(find.textContaining('obrigat'), findsOneWidget);
      expect(fakeRepo.lastCreatedData, isNull);
    });

    testWidgets('selecting a tone chip updates selected key', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Tap 'D' tone chip
      await tester.tap(find.byKey(const ValueKey('key_chip_D')));
      await tester.pumpAndSettle();

      // Enter title
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Vem Me Buscar');
      await tester.pumpAndSettle();

      // Save
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastCreatedData?.title, equals('Vem Me Buscar'));
      expect(fakeRepo.lastCreatedData?.originalKey, equals('D'));
    });

    testWidgets('pop scope shows confirmation dialog when form is dirty', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Make dirty by typing in title
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Draft Title');
      await tester.pumpAndSettle();

      // Invoke pop
      final navigator = Navigator.of(tester.element(find.byType(SongFormScreen)));
      navigator.maybePop();
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('discard_dialog_confirm_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('discard_dialog_cancel_button')), findsOneWidget);
    });

    testWidgets('renders edit mode when initialSong is passed', (tester) async {
      const existing = SongDetail(
        id: 's-edit-1',
        ministryId: 'min_1',
        title: 'Musica Existente',
        originalKey: 'F',
        bpm: 110,
        duration: '04:00',
        lyrics: 'Linha 1 da letra...',
      );

      await tester.pumpWidget(buildSubject(initialSong: existing));
      await tester.pumpAndSettle();

      expect(find.text('Musica Existente'), findsOneWidget);
      expect(find.text('110'), findsOneWidget);
      expect(find.text('04:00'), findsOneWidget);
    });

    testWidgets('TEST_GAP-01: dirty form auto-dismisses immediately on tenant change without discard dialog', (tester) async {
      await tester.pumpWidget(buildPushableSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Song Form'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);

      // Make dirty by typing draft
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Rascunho Alpha');
      await tester.enterText(find.byKey(const ValueKey('song_lyrics_input')), 'Letra confidencial Alpha');
      await tester.pumpAndSettle();

      // Switch active ministry to Beta
      ministryNotifier.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        selectedMinistry: Ministry(id: 'min_beta', name: 'Beta', role: 'admin'),
        availableMinistries: [
          Ministry(id: 'min_1', name: 'Alpha', role: 'admin'),
          Ministry(id: 'min_beta', name: 'Beta', role: 'admin'),
        ],
      );
      await tester.pumpAndSettle();

      // Form route is popped immediately, no discard dialog shown, draft destroyed
      expect(find.byKey(const ValueKey('song_form_save_button')), findsNothing);
      expect(find.text('Descartar alterações?'), findsNothing);
      expect(find.text('Rascunho Alpha'), findsNothing);
      expect(find.text('Open Song Form'), findsOneWidget);
    });

    testWidgets('TEST_GAP-02: draft is destroyed and form auto-dismisses on logout', (tester) async {
      await tester.pumpWidget(buildPushableSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Song Form'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);

      // Enter private draft
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Privado User A');
      await tester.enterText(find.byKey(const ValueKey('song_lyrics_input')), 'Letra ultra confidencial');
      await tester.pumpAndSettle();

      // Logout occurs
      authNotifier.logout();
      await tester.pumpAndSettle();

      // Form route closed, draft text destroyed
      expect(find.byKey(const ValueKey('song_form_save_button')), findsNothing);
      expect(find.text('Privado User A'), findsNothing);
      expect(find.text('Letra ultra confidencial'), findsNothing);
      expect(find.text('Open Song Form'), findsOneWidget);
    });

    testWidgets('TEST_GAP-02: draft is destroyed and form auto-dismisses on user change (User A -> User B)', (tester) async {
      await tester.pumpWidget(buildPushableSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Song Form'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);

      // Enter private draft
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'User A Secret Song');
      await tester.pumpAndSettle();

      // Active user changes to User B
      authNotifier.setUser(const AuthUser(id: 'user_b', email: 'user.b@test.com', name: 'User B'));
      await tester.pumpAndSettle();

      // Form route closed, draft destroyed
      expect(find.byKey(const ValueKey('song_form_save_button')), findsNothing);
      expect(find.text('User A Secret Song'), findsNothing);
      expect(find.text('Open Song Form'), findsOneWidget);
    });

    testWidgets('TEST_GAP-04: quick-create artist failure preserves song draft', (tester) async {
      fakeRepo.artistErrorToThrow = const AppFailure(
        message: 'Nome de artista já cadastrado.',
        statusCode: 400,
      );

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Fill in draft data
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Grande é o Senhor');
      await tester.enterText(find.byKey(const ValueKey('song_bpm_input')), '128');
      await tester.ensureVisible(find.byKey(const ValueKey('key_chip_G')));
      await tester.tap(find.byKey(const ValueKey('key_chip_G')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const ValueKey('song_lyrics_input')));
      await tester.enterText(find.byKey(const ValueKey('song_lyrics_input')), 'Aleluia ao Deus Vivo');
      await tester.pumpAndSettle();

      // Open artist picker
      await tester.ensureVisible(find.byKey(const ValueKey('artist_picker_tile')));
      await tester.tap(find.byKey(const ValueKey('artist_picker_tile')));
      await tester.pumpAndSettle();

      // Tap "Novo" in sheet
      await tester.tap(find.widgetWithText(FilledButton, 'Novo'));
      await tester.pumpAndSettle();

      // Enter duplicate artist name in dialog
      await tester.enterText(find.byType(TextField).last, 'Morada');
      await tester.pumpAndSettle();

      // Tap "Criar"
      await tester.tap(find.widgetWithText(FilledButton, 'Criar'));
      await tester.pumpAndSettle();

      // Error snackbar is shown
      expect(find.text('Nome de artista já cadastrado.'), findsOneWidget);

      // Verify draft inputs are PRESERVED
      expect(find.text('Grande é o Senhor'), findsOneWidget);
      expect(find.text('128'), findsOneWidget);
      expect(find.text('Aleluia ao Deus Vivo'), findsOneWidget);
    });
  });
}
