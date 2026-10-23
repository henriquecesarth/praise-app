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
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/song_detail_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_form_screen.dart';

class _FakeAuthRepo implements AuthRepository {
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
  Future<void> signOut() async {}
}

class _FakeAuthNotifier extends AuthNotifier {
  _FakeAuthNotifier() : super(_FakeAuthRepo()) {
    state = const AuthState.authenticated(
      AuthUser(id: 'member_user', email: 'member@test.com', name: 'Member'),
    );
  }
}

class FakeRepertoireRepo implements RepertoireRepository {
  SongDetail? detail;
  Exception? detailError;

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async =>
      const PaginatedSongs(songs: [], total: 0);

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    if (detailError != null) throw detailError!;
    return detail ??
        SongDetail(
          id: songId,
          ministryId: ministryId,
          title: 'Música Default',
          artistName: 'Artista',
        );
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async =>
      [];

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async =>
      SongDetail(id: 'mock-song', ministryId: ministryId, title: data.title);

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async =>
      SongDetail(id: songId, ministryId: ministryId, title: data.title);

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [];

  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      Artist(id: 'mock-artist', ministryId: ministryId, name: name);
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Ministry>> getMyMinistries() async => [];
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

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier([MinistryContextState? initialState])
      : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = initialState ??
        const MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          selectedMinistry:
              Ministry(id: 'min_1', name: 'Ministério 1', role: 'member'),
          availableMinistries: [
            Ministry(id: 'min_1', name: 'Ministério 1', role: 'member'),
            Ministry(id: 'min_2', name: 'Ministério 2', role: 'member'),
          ],
        );
  }

  void switchMinistry(Ministry ministry) {
    state = state.copyWith(selectedMinistry: ministry);
  }
}

void main() {
  late FakeRepertoireRepo fakeRepo;

  setUp(() {
    fakeRepo = FakeRepertoireRepo();
    fakeRepo.detail = const SongDetail(
      id: 'song_1',
      ministryId: 'min_1',
      title: 'Em Teus Braços',
      artistName: 'Laura Souguellis',
      originalKey: 'E',
      bpm: 72,
      duration: '5:10',
      classification: SongClassificationRef(
        id: 'c1',
        name: 'Adoração',
        color: '#06B6D4',
      ),
      lyrics: 'Seguro estou nos braços\nDaquele que nunca me deixou...',
      notes: 'Iniciar com pad suave e teclado.',
      youtubeUrl: 'https://youtube.com/watch?v=laura',
      chordSheetUrl: 'https://cifraclub.com.br/laura',
      audioUrl: 'https://audio.com/ref.mp3',
      externalLinks: {
        'Spotify': 'https://spotify.com/laura',
      },
    );
  });

  Widget createSubject() {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        songDetailNotifierProvider.overrideWith((ref) {
          return SongDetailNotifier(repository: fakeRepo);
        }),
        ministryContextNotifierProvider
            .overrideWith((ref) => FakeMinistryContextNotifier()),
        authNotifierProvider.overrideWith((ref) => _FakeAuthNotifier()),
      ],
      child: const MaterialApp(
        home: SongDetailView(
          ministryId: 'min_1',
          songId: 'song_1',
          initialTitle: 'Em Teus Braços',
        ),
      ),
    );
  }

  group('SongDetailView Presentation', () {
    testWidgets('renders all song detail sections and metadata chips',
        (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Title & Artist
      expect(find.text('Em Teus Braços'), findsWidgets);
      expect(find.text('Laura Souguellis'), findsOneWidget);

      // Chips
      expect(find.text('Tom: E'), findsOneWidget);
      expect(find.text('72 BPM'), findsOneWidget);
      expect(find.text('5:10'), findsOneWidget);
      expect(find.text('Adoração'), findsOneWidget);

      // Links
      expect(find.text('Links e Recursos'), findsOneWidget);
      expect(find.text('Vídeo no YouTube'), findsOneWidget);
      expect(find.text('Cifra / Partitura'), findsOneWidget);
      expect(find.text('Áudio de Referência'), findsOneWidget);
      expect(find.text('Spotify'), findsOneWidget);

      // Notes
      expect(find.text('Observações'), findsOneWidget);
      expect(find.text('Iniciar com pad suave e teclado.'), findsOneWidget);

      // Lyrics
      expect(find.text('Letra da Música'), findsOneWidget);
      expect(find.textContaining('Seguro estou nos braços'), findsOneWidget);
    });

    testWidgets('renders fallback text when lyrics are missing',
        (tester) async {
      fakeRepo.detail = const SongDetail(
        id: 'song_1',
        ministryId: 'min_1',
        title: 'Música Sem Letra',
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(
          find.text('Letra não cadastrada para esta música.'), findsOneWidget);
    });

    testWidgets('handles 404 song not found by offering back button',
        (tester) async {
      fakeRepo.detailError = const AppFailure(
        message: 'Música não encontrada.',
        statusCode: 404,
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Música não encontrada.'), findsOneWidget);
      expect(find.text('Voltar ao Repertório'), findsOneWidget);
    });

    testWidgets('pops detail screen when active ministry changes',
        (tester) async {
      final navKey = GlobalKey<NavigatorState>();
      final ministryNotifier = FakeMinistryContextNotifier();
      final container = ProviderContainer(
        overrides: [
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(
              env: AppEnv.development,
              apiBaseUrl: 'http://localhost:3000/api/v1',
            ),
          ),
          repertoireRepositoryProvider.overrideWithValue(fakeRepo),
          ministryContextNotifierProvider
              .overrideWith((ref) => ministryNotifier),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Shell Screen')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Push SongDetailView
      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => const SongDetailView(
            ministryId: 'min_1',
            songId: 'song_1',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Em Teus Braços'), findsWidgets);

      // Switch active ministry to min_2
      ministryNotifier.switchMinistry(
        const Ministry(
          id: 'min_2',
          name: 'Ministério 2',
          role: 'member',
        ),
      );

      await tester.pumpAndSettle();

      // Detail screen popped back to Shell Screen
      expect(find.text('Shell Screen'), findsOneWidget);
    });

    testWidgets('renders responsive layout on tablet width without crash',
        (tester) async {
      tester.view.physicalSize = const Size(1200, 1920);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Em Teus Braços'), findsWidgets);
    });

    testWidgets('displays version selector chips and updates metadata, notes and links when switching versions',
        (tester) async {
      fakeRepo.detail = const SongDetail(
        id: 'song_multi',
        ministryId: 'min_1',
        title: 'Em Teus Braços',
        artistName: 'Laura Souguellis',
        originalKey: 'E',
        bpm: 72,
        duration: '5:10',
        versions: [
          SongVersion(
            id: 'v_1',
            name: 'Original',
            key: 'E',
            bpm: 72,
            duration: '5:10',
            notes: 'Arranjo original com pad',
            links: [
              SongLink(label: 'Vídeo', url: 'https://youtube.com/watch?v=v1'),
            ],
          ),
          SongVersion(
            id: 'v_2',
            name: 'Acústico',
            key: null,
            bpm: 65,
            duration: '4:15',
            notes: 'Apenas violão folk',
            links: [
              SongLink(label: 'Multitracks Acústico', url: 'https://multitracks.com/v2', isCustom: true),
            ],
          ),
        ],
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Both version chips are visible
      expect(find.byKey(const ValueKey('detail_version_chip_v_1')), findsOneWidget);
      expect(find.byKey(const ValueKey('detail_version_chip_v_2')), findsOneWidget);

      // Initially inspecting Version 1 (Original)
      expect(find.text('Tom: E'), findsOneWidget);
      expect(find.text('72 BPM'), findsOneWidget);
      expect(find.text('5:10'), findsOneWidget);
      expect(find.text('Arranjo original com pad'), findsOneWidget);

      // Switch to Version 2 (Acústico)
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v_2')));
      await tester.pumpAndSettle();

      // Null key hides 'Tom:' badge, BPM/duration/notes/links reflect Version 2
      expect(find.text('Tom: E'), findsNothing);
      expect(find.textContaining('Tom:'), findsNothing);
      expect(find.text('65 BPM'), findsOneWidget);
      expect(find.text('4:15'), findsOneWidget);
      expect(find.text('Apenas violão folk'), findsOneWidget);
      expect(find.text('Multitracks Acústico'), findsOneWidget);
    });

    testWidgets(
        'F02: secondary version with explicit null key opens SmartChordFormScreen with prefillKey: null (both call sites) while primary version prefills its valid key',
        (tester) async {
      fakeRepo.detail = const SongDetail(
        id: 'song_f02',
        ministryId: 'min_1',
        title: 'Santo Espírito',
        artistName: 'Laura Souguellis',
        originalKey: 'E',
        bpm: 72,
        versions: [
          SongVersion(
            id: 'v_1',
            name: 'Original',
            key: 'E',
            bpm: 72,
          ),
          SongVersion(
            id: 'v_2',
            name: 'Acústico Sem Tom',
            key: null,
            bpm: 68,
          ),
        ],
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // 1. Primary version (key: 'E') selected -> opens SmartChordFormScreen with prefillKey: 'E'
      await tester.ensureVisible(find.byTooltip('Nova Cifra para esta música'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Nova Cifra para esta música'));
      await tester.pumpAndSettle();

      var formScreen = tester.widget<SmartChordFormScreen>(
        find.byType(SmartChordFormScreen),
      );
      expect(formScreen.prefillKey, equals('E'));

      Navigator.of(tester.element(find.byType(SmartChordFormScreen))).pop();
      await tester.pumpAndSettle();

      // 2. Select secondary version with explicit key: null
      await tester.ensureVisible(
        find.byKey(const ValueKey('detail_version_chip_v_2')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v_2')));
      await tester.pumpAndSettle();

      // Call site 1: Header icon button 'Nova Cifra para esta música'
      await tester.ensureVisible(find.byTooltip('Nova Cifra para esta música'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Nova Cifra para esta música'));
      await tester.pumpAndSettle();

      formScreen = tester.widget<SmartChordFormScreen>(
        find.byType(SmartChordFormScreen),
      );
      expect(formScreen.prefillKey, isNull);

      Navigator.of(tester.element(find.byType(SmartChordFormScreen))).pop();
      await tester.pumpAndSettle();

      // Call site 2: Empty-state card ListTile 'Cadastrar nova cifra inteligente'
      await tester.ensureVisible(find.text('Cadastrar nova cifra inteligente'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cadastrar nova cifra inteligente'));
      await tester.pumpAndSettle();

      formScreen = tester.widget<SmartChordFormScreen>(
        find.byType(SmartChordFormScreen),
      );
      expect(formScreen.prefillKey, isNull);
    });
  });
}
