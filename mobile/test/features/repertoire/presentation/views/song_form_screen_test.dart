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
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

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
  AppFailure? saveErrorToThrow;

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
    if (saveErrorToThrow != null) throw saveErrorToThrow!;
    lastCreatedData = data;
    return SongDetail(id: 'new-song-id', ministryId: ministryId, title: data.title);
  }

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async {
    if (saveErrorToThrow != null) throw saveErrorToThrow!;
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

    testWidgets('creates a new version, edits it, and serializes both versions on save', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Lugar Secreto');
      await tester.ensureVisible(find.byKey(const ValueKey('key_chip_C')));
      await tester.tap(find.byKey(const ValueKey('key_chip_C')));
      await tester.pumpAndSettle();

      // Add a second version
      await tester.ensureVisible(find.byKey(const ValueKey('add_version_button')));
      await tester.tap(find.byKey(const ValueKey('add_version_button')));
      await tester.pumpAndSettle();

      // Edit the newly added second version
      await tester.ensureVisible(find.byKey(const ValueKey('song_version_name_input')));
      await tester.enterText(find.byKey(const ValueKey('song_version_name_input')), 'Acústico');
      await tester.ensureVisible(find.byKey(const ValueKey('key_chip_A')));
      await tester.tap(find.byKey(const ValueKey('key_chip_A')));
      await tester.enterText(find.byKey(const ValueKey('song_bpm_input')), '75');
      await tester.pumpAndSettle();

      // Save song
      await tester.ensureVisible(find.byKey(const ValueKey('song_form_save_button')));
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final created = fakeRepo.lastCreatedData;
      expect(created, isNotNull);
      expect(created!.versions, isNotNull);
      expect(created.versions, hasLength(2));
      expect(created.versions![0].name, equals('Original'));
      expect(created.versions![0].key, equals('C'));
      expect(created.versions![1].name, equals('Acústico'));
      expect(created.versions![1].key, equals('A'));
      expect(created.versions![1].bpm, equals(75));
      expect(created.versions![0].id, isNot(equals(created.versions![1].id)));
    });

    testWidgets('editing one version preserves other versions, their stable IDs, classifications and links', (tester) async {
      const existing = SongDetail(
        id: 'song-multi-edit',
        ministryId: 'min_1',
        title: 'Bondade de Deus',
        versions: [
          SongVersion(
            id: 'v_orig_stable',
            name: 'Original',
            key: 'Ab',
            bpm: 63,
            duration: '04:55',
            classificationIds: ['cls-1'],
            notes: 'Nota original preservada',
            links: [
              SongLink(label: 'Vídeo', url: 'https://youtube.com/watch?v=bondade1'),
            ],
          ),
          SongVersion(
            id: 'v_sec_stable',
            name: 'Versão Jovem',
            key: 'G',
            bpm: 70,
            duration: '04:30',
            notes: 'Nota antiga',
          ),
        ],
      );

      await tester.pumpWidget(buildSubject(initialSong: existing));
      await tester.pumpAndSettle();

      // Switch to second version to edit it
      await tester.ensureVisible(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      // Modify second version's name and BPM
      await tester.ensureVisible(find.byKey(const ValueKey('song_version_name_input')));
      await tester.enterText(find.byKey(const ValueKey('song_version_name_input')), 'Versão Jovem (Ao Vivo)');
      await tester.enterText(find.byKey(const ValueKey('song_bpm_input')), '74');
      await tester.pumpAndSettle();

      // Save
      await tester.ensureVisible(find.byKey(const ValueKey('song_form_save_button')));
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData;
      expect(updated, isNotNull);
      expect(updated!.versions, hasLength(2));
      // Version 0 is completely preserved
      expect(updated.versions![0].id, equals('v_orig_stable'));
      expect(updated.versions![0].name, equals('Original'));
      expect(updated.versions![0].key, equals('Ab'));
      expect(updated.versions![0].bpm, equals(63));
      expect(updated.versions![0].duration, equals('04:55'));
      expect(updated.versions![0].classificationIds, equals(['cls-1']));
      expect(updated.versions![0].notes, equals('Nota original preservada'));
      expect(updated.versions![0].links, hasLength(1));
      expect(updated.versions![0].links.first.url, equals('https://youtube.com/watch?v=bondade1'));

      // Version 1 has updated values and preserved stable ID
      expect(updated.versions![1].id, equals('v_sec_stable'));
      expect(updated.versions![1].name, equals('Versão Jovem (Ao Vivo)'));
      expect(updated.versions![1].key, equals('G'));
      expect(updated.versions![1].bpm, equals(74));
    });

    testWidgets('duplicating a version generates a distinct ID and copies fields; deleting a version requires confirmation', (tester) async {
      const existing = SongDetail(
        id: 'song-dup-del',
        ministryId: 'min_1',
        title: ' Leão ',
        versions: [
          SongVersion(
            id: 'v_base_1',
            name: 'Estúdio',
            key: 'F#m',
            bpm: 130,
            classificationIds: ['cls-1'],
          ),
        ],
      );

      await tester.pumpWidget(buildSubject(initialSong: existing));
      await tester.pumpAndSettle();

      // Duplicate version 0
      await tester.ensureVisible(find.byKey(const ValueKey('duplicate_version_button_0')));
      await tester.tap(find.byKey(const ValueKey('duplicate_version_button_0')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('version_card_0')), findsOneWidget);
      expect(find.byKey(const ValueKey('version_card_1')), findsOneWidget);
      expect(find.text('Estúdio (Cópia)'), findsWidgets);

      // Add a 3rd version so we can delete one and still have 2 versions
      await tester.ensureVisible(find.byKey(const ValueKey('add_version_button')));
      await tester.tap(find.byKey(const ValueKey('add_version_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('version_card_2')), findsOneWidget);

      // Delete version 2 with confirmation
      await tester.ensureVisible(find.byKey(const ValueKey('delete_version_button_2')));
      await tester.tap(find.byKey(const ValueKey('delete_version_button_2')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('confirm_delete_version_button')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('confirm_delete_version_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('version_card_2')), findsNothing);

      // Save and verify version 0 and duplicated version 1 have distinct IDs
      await tester.ensureVisible(find.byKey(const ValueKey('song_form_save_button')));
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData!;
      expect(updated.versions, hasLength(2));
      expect(updated.versions![0].id, equals('v_base_1'));
      expect(updated.versions![1].id, isNotNull);
      expect(updated.versions![1].id, isNot(equals('v_base_1')));
      expect(updated.versions![1].name, equals('Estúdio (Cópia)'));
      expect(updated.versions![1].key, equals('F#m'));
      expect(updated.versions![1].bpm, equals(130));
      expect(updated.versions![1].classificationIds, equals(['cls-1']));
    });

    testWidgets('save failure surfaces error snackbar without popping or losing edited versions', (tester) async {
      fakeRepo.saveErrorToThrow = const AppFailure(
        message: 'Falha ao salvar versões no servidor.',
        statusCode: 500,
      );

      const existing = SongDetail(
        id: 'song-err-1',
        ministryId: 'min_1',
        title: 'Santo Pra Sempre',
        versions: [
          SongVersion(id: 'v_1', name: 'Original', key: 'G'),
        ],
      );

      await tester.pumpWidget(buildPushableSubject(initialSong: existing));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Song Form'));
      await tester.pumpAndSettle();

      // Add a second version and edit it
      await tester.ensureVisible(find.byKey(const ValueKey('add_version_button')));
      await tester.tap(find.byKey(const ValueKey('add_version_button')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const ValueKey('song_version_name_input')));
      await tester.enterText(find.byKey(const ValueKey('song_version_name_input')), 'Versão Piano');
      await tester.pumpAndSettle();

      // Attempt save
      await tester.ensureVisible(find.byKey(const ValueKey('song_form_save_button')));
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      // Error snackbar is surfaced, form remains open with both versions intact
      expect(find.text('Falha ao salvar versões no servidor.'), findsOneWidget);
      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('version_card_0')), findsOneWidget);
      expect(find.byKey(const ValueKey('version_card_1')), findsOneWidget);
      expect(find.text('Versão Piano'), findsWidgets);
    });

    testWidgets(
        'F01: Web-created song with free-text artist {id: "", name: "Free Artist"} survives secondary-version edit and save without sending artist_id: null',
        (tester) async {
      final loadedFromBackend = SongDetail.fromJson(const {
        'id': 'song-free-1',
        'ministry_id': 'min_1',
        'title': 'Canção Web',
        'artist_id': null,
        'artist': {'id': '', 'name': 'Free Artist'},
        'artist_name': 'Free Artist',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'key': 'G',
            'bpm': 72,
            'notes': 'Nota v1',
          },
          {
            'id': 'v_2',
            'name': 'Acústico',
            'key': 'E',
            'bpm': 68,
            'notes': 'Nota v2 inicial',
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: loadedFromBackend));
      await tester.pumpAndSettle();

      // Free-text artist name is displayed on the artist picker tile
      expect(find.text('Free Artist'), findsOneWidget);

      // Switch to secondary version (index 1) and modify its notes
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_version_notes_input')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_version_notes_input')),
        'Nota v2 editada no mobile',
      );
      await tester.pumpAndSettle();

      // Save
      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData;
      expect(updated, isNotNull);
      final serializedJson = updated!.toJson();
      // Must NOT send artist_id: null when user did not modify the artist
      expect(serializedJson.containsKey('artist_id'), isFalse);
      expect(updated.versions![1].notes, equals('Nota v2 editada no mobile'));
    });

    testWidgets(
        'F01: ID-backed artist survives an unrelated edit and intentional artist removal sends artist_id: null',
        (tester) async {
      final loadedWithIdArtist = SongDetail.fromJson(const {
        'id': 'song-id-art',
        'ministry_id': 'min_1',
        'title': 'Pra Onde Eu Iria',
        'artist_id': 'art-1',
        'artist': {'id': 'art-1', 'name': 'Morada'},
        'artist_name': 'Morada',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'key': 'G',
            'bpm': 128,
            'notes': 'Nota inicial',
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: loadedWithIdArtist));
      await tester.pumpAndSettle();

      expect(find.text('Morada'), findsOneWidget);

      // Edit version notes without touching artist
      await tester.ensureVisible(
        find.byKey(const ValueKey('song_version_notes_input')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_version_notes_input')),
        'Nota atualizada',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData!;
      expect(updated.artistId, equals('art-1'));
      expect(updated.toJson()['artist_id'], equals('art-1'));
    });

    testWidgets(
        'F01: intentional artist removal on free-text artist sends explicit artist_id: null',
        (tester) async {
      final loadedFromBackend = SongDetail.fromJson(const {
        'id': 'song-free-unlink',
        'ministry_id': 'min_1',
        'title': 'Canção Para Desvincular',
        'artist_id': null,
        'artist': {'id': '', 'name': 'Free Artist'},
        'artist_name': 'Free Artist',
        'versions': [
          {'id': 'v_1', 'name': 'Original', 'key': 'G', 'bpm': 72},
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: loadedFromBackend));
      await tester.pumpAndSettle();

      expect(find.text('Free Artist'), findsOneWidget);

      // Open artist picker and tap "Sem artista / Desvincular"
      await tester.ensureVisible(
        find.byKey(const ValueKey('artist_picker_tile')),
      );
      await tester.tap(find.byKey(const ValueKey('artist_picker_tile')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Sem artista / Desvincular'));
      await tester.pumpAndSettle();

      expect(find.text('Nenhum artista selecionado'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData!;
      final serializedJson = updated.toJson();
      expect(serializedJson.containsKey('artist_id'), isTrue);
      expect(serializedJson['artist_id'], isNull);
    });

    testWidgets(
        'F03: editing a version notes preserves fractional BPM and artist without truncation',
        (tester) async {
      final loadedWithFractionalBpm = SongDetail.fromJson(const {
        'id': 'song-frac-edit',
        'ministry_id': 'min_1',
        'title': 'Canção Fracionada',
        'artist_id': null,
        'artist': {'id': '', 'name': 'Free Artist'},
        'artist_name': 'Free Artist',
        'bpm': 72.5,
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'key': 'E',
            'bpm': 72.5,
            'notes': 'Nota original',
          },
        ],
      });

      await tester.pumpWidget(
        buildSubject(initialSong: loadedWithFractionalBpm),
      );
      await tester.pumpAndSettle();

      expect(find.text('72.5'), findsOneWidget);

      // Edit version notes only
      await tester.ensureVisible(
        find.byKey(const ValueKey('song_version_notes_input')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_version_notes_input')),
        'Nota alterada sem mexer no BPM',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData;
      expect(updated, isNotNull);
      final serializedJson = updated!.toJson();
      expect(serializedJson['bpm'], equals(72.5));
      expect((serializedJson['versions'] as List)[0]['bpm'], equals(72.5));
      expect(serializedJson.containsKey('artist_id'), isFalse);
    });

    testWidgets(
        'F03: entering fractional BPM in form validates and serializes exact decimal while integer BPM remains compatible',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('song_title_input')),
        'Nova Música Fracionada',
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '68.5',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final created = fakeRepo.lastCreatedData;
      expect(created, isNotNull);
      expect(created!.bpm, equals(68.5));
      expect(created.versions![0].bpm, equals(68.5));
      expect(created.toJson()['bpm'], equals(68.5));
      expect((created.toJson()['versions'] as List)[0]['bpm'], equals(68.5));
    });

    testWidgets(
        'F04: renaming a version preserves textual BPM "Rubato" in the HTTP payload',
        (tester) async {
      final loadedWithTextBpm = SongDetail.fromJson(const {
        'id': 'song-rubato-edit',
        'ministry_id': 'min_1',
        'title': 'Canção Rubato',
        'bpm': 'Rubato',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'key': 'E',
            'bpm': 'Rubato',
            'notes': 'Nota original',
          },
          {
            'id': 'v_2',
            'name': 'Live',
            'key': 'G',
            'bpm': 'Rubato',
            'notes': 'Live version',
          },
        ],
      });

      await tester.pumpWidget(
        buildSubject(initialSong: loadedWithTextBpm),
      );
      await tester.pumpAndSettle();

      expect(find.text('Rubato'), findsWidgets);

      // Select secondary version (v_2) and rename it
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_version_name_input')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_version_name_input')),
        'Live Renamed',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData;
      expect(updated, isNotNull);
      final serializedJson = updated!.toJson();
      expect(serializedJson['bpm'], equals('Rubato'));
      expect((serializedJson['versions'] as List)[1]['name'], equals('Live Renamed'));
      expect((serializedJson['versions'] as List)[1]['bpm'], equals('Rubato'));
    });

    testWidgets(
        'F04: switching between versions preserves distinct textual and numeric BPM values',
        (tester) async {
      final multiBpmSong = SongDetail.fromJson(const {
        'id': 'song-mixed-bpm',
        'ministry_id': 'min_1',
        'title': 'Canção Mista',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'bpm': 72,
          },
          {
            'id': 'v_2',
            'name': 'Acústico',
            'bpm': 'Rubato',
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: multiBpmSong));
      await tester.pumpAndSettle();

      // Version 0 has 72
      expect(find.text('72'), findsOneWidget);

      // Switch to Version 1 (Rubato)
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      expect(find.text('Rubato'), findsOneWidget);

      // Switch back to Version 0 (72)
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_0')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      expect(find.text('72'), findsOneWidget);
    });

    testWidgets(
        'F04: textual BPM can be changed to numeric and vice versa',
        (tester) async {
      final song = SongDetail.fromJson(const {
        'id': 'song-change-bpm',
        'ministry_id': 'min_1',
        'title': 'Troca de BPM',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'bpm': 'Rubato',
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: song));
      await tester.pumpAndSettle();

      expect(find.text('Rubato'), findsOneWidget);

      // Change from 'Rubato' to '80'
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '80',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      final updated = fakeRepo.lastUpdatedData!;
      expect(updated.bpm, equals(80));
      expect(updated.versions![0].bpm, equals(80));
      expect(updated.toJson()['bpm'], equals(80));
      expect((updated.toJson()['versions'] as List)[0]['bpm'], equals(80));
    });

    testWidgets(
        'F02 (R3): invalid BPM 1000 across version switching does not convert BPM to null, blocks save visibly, preserves invalid draft on return, and saves after correction',
        (tester) async {
      final song = SongDetail.fromJson(const {
        'id': 'song-f02-invalid-switch',
        'ministry_id': 'min_1',
        'title': 'Teste F02',
        'bpm': 120,
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'key': 'C',
            'bpm': 120,
          },
          {
            'id': 'v_2',
            'name': 'Secundária',
            'key': 'G',
            'bpm': 72.5,
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: song));
      await tester.pumpAndSettle();

      // 1. Select secondary version (v_2 with BPM 72.5)
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();
      expect(find.text('72.5'), findsOneWidget);

      // 2. Enter invalid BPM 1000
      await tester.ensureVisible(
        find.byKey(const ValueKey('song_bpm_input')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '1000',
      );
      await tester.pumpAndSettle();

      // 3. Switch to primary version (v_1)
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_0')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      // 4. Attempt to save while on v_1 -> must fail visibly without issuing HTTP request
      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedData, isNull);
      expect(
        find.text('1 a 999 ou texto de até 10 caracteres'),
        findsOneWidget,
      );
      expect(find.text('1000'), findsOneWidget);

      // 5. Switch to v_1 and return to v_2 -> invalid draft '1000' is still preserved
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_0')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();
      expect(find.text('1000'), findsOneWidget);

      // 6. Correct the invalid field to 84.5 and save normally
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '84.5',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedData, isNotNull);
      final serialized = fakeRepo.lastUpdatedData!.toJson();
      expect((serialized['versions'] as List)[0]['bpm'], equals(120));
      expect((serialized['versions'] as List)[1]['bpm'], equals(84.5));
    });

    testWidgets(
        'F02 (R3): explicit user clearing after invalid BPM draft saves bpm as null',
        (tester) async {
      final song = SongDetail.fromJson(const {
        'id': 'song-f02-clear',
        'ministry_id': 'min_1',
        'title': 'Teste F02 Clear',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'bpm': 120,
          },
          {
            'id': 'v_2',
            'name': 'Secundária',
            'bpm': 72.5,
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: song));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '1000',
      );
      await tester.pumpAndSettle();

      // Switch to v_1 and back to v_2
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_0')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      // Explicitly clear BPM
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedData, isNotNull);
      final serialized = fakeRepo.lastUpdatedData!.toJson();
      expect((serialized['versions'] as List)[1]['bpm'], isNull);
    });

    testWidgets(
        'F03 (R3): untouched textual BPM " Rubato " is preserved byte-for-byte when renaming version and switching versions',
        (tester) async {
      final song = SongDetail.fromJson(const {
        'id': 'song-f03-spaced',
        'ministry_id': 'min_1',
        'title': 'Teste F03 Spaced',
        'bpm': ' Rubato ',
        'versions': [
          {
            'id': 'v_1',
            'name': 'Original',
            'bpm': ' Rubato ',
          },
          {
            'id': 'v_2',
            'name': 'Secundária',
            'bpm': ' Rubato ',
          },
        ],
      });

      await tester.pumpWidget(buildSubject(initialSong: song));
      await tester.pumpAndSettle();

      // Switch to v_2, rename it without touching BPM, switch back to v_1, and save
      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_1')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_1')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_version_name_input')),
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_version_name_input')),
        'Secundária Renomeada',
      );
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('edit_version_button_0')),
      );
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const ValueKey('song_form_save_button')),
      );
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedData, isNotNull);
      final serialized = fakeRepo.lastUpdatedData!.toJson();
      expect(serialized['bpm'], equals(' Rubato '));
      expect((serialized['versions'] as List)[0]['bpm'], equals(' Rubato '));
      expect(
        (serialized['versions'] as List)[1]['name'],
        equals('Secundária Renomeada'),
      );
      expect((serialized['versions'] as List)[1]['bpm'], equals(' Rubato '));
    });
  });
}
