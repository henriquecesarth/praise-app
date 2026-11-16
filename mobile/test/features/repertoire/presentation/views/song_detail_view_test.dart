import 'dart:async';

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
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_song_sequence.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_repertoire_link_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/song_smart_chords_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_form_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_lyric_line.dart';

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
  _FakeAuthNotifier({String userId = 'member_user'}) : super(_FakeAuthRepo()) {
    state = AuthState.authenticated(
      AuthUser(id: userId, email: '$userId@test.com', name: 'Member'),
    );
  }

  void setUnauthenticated() {
    state = const AuthState.unauthenticated();
  }
}

class FakeRepertoireRepo implements RepertoireRepository {
  SongDetail? detail;
  Exception? detailError;
  Future<SongDetail> Function(String ministryId, String songId)? onGetSongDetail;

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
    if (onGetSongDetail != null) {
      return onGetSongDetail!(ministryId, songId);
    }
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

  Widget createSubject({
    String role = 'member',
    String userId = 'member_user',
  }) {
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
        ministryContextNotifierProvider.overrideWith(
          (ref) => FakeMinistryContextNotifier(
            MinistryContextState(
              status: MinistryBootstrapStatus.ready,
              selectedMinistry:
                  Ministry(id: 'min_1', name: 'Ministério 1', role: role),
              availableMinistries: [
                Ministry(id: 'min_1', name: 'Ministério 1', role: role),
                Ministry(id: 'min_2', name: 'Ministério 2', role: role),
              ],
            ),
          ),
        ),
        authNotifierProvider.overrideWith(
          (ref) => _FakeAuthNotifier(userId: userId),
        ),
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
      await tester.pumpWidget(createSubject(role: 'admin'));
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

      await tester.pumpWidget(createSubject(role: 'admin'));
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

      await tester.pumpWidget(createSubject(role: 'admin'));
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

      await tester.pumpWidget(createSubject(role: 'admin'));
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

      await tester.pumpWidget(createSubject(role: 'admin'));
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

      await tester.pumpWidget(createSubject(role: 'admin'));
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

    testWidgets(
        'D1 Music Stand Bar: renders linked Smart Chords inline with toggle, transposition (-1/+1/Resetar), multi-chord switching and unlink',
        (tester) async {
      final linkedChords = <SmartChord>[
        const SmartChord(
          id: 'sc_1',
          userId: 'member_user',
          title: 'Em Teus Braços (Violão)',
          artistName: 'Laura Souguellis',
          originalKey: 'E',
          content: '| E | A9 |\n[E]Seguro estou nos [A9]braços',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        ),
        const SmartChord(
          id: 'sc_2',
          userId: 'member_user',
          title: 'Em Teus Braços (Capo 2)',
          artistName: 'Laura Souguellis',
          originalKey: 'D',
          content: '[D]Seguro estou nos [G]braços',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        ),
      ];
      String? lastUnlinkedChordId;
      final fakeLinkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => List<SmartChord>.from(linkedChords),
        onRemoveLink: (ministryId, chordId) async {
          lastUnlinkedChordId = chordId;
          linkedChords.removeWhere((c) => c.id == chordId);
        },
      );

      await tester.pumpWidget(
        ProviderScope(
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
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry:
                      Ministry(id: 'min_1', name: 'Ministério 1', role: 'admin'),
                  availableMinistries: [
                    Ministry(id: 'min_1', name: 'Ministério 1', role: 'admin'),
                  ],
                ),
              ),
            ),
            authNotifierProvider.overrideWith((ref) => _FakeAuthNotifier()),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(fakeLinkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: fakeLinkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: fakeLinkRepo,
              ),
            ),
          ],
          child: const MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 'song_1',
              initialTitle: 'Em Teus Braços',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Music Stand Bar and inline sheet are active by default when linked chords exist
      expect(
        find.byKey(const ValueKey('song_detail_music_stand_bar')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('song_detail_inline_chord_sheet')),
        findsOneWidget,
      );
      expect(
        find.text('Original • Tom: E'),
        findsOneWidget,
      );

      // Transpose +1 semitone (E -> F)
      final upBtn = find.byKey(
        const ValueKey('song_detail_transpose_up_button'),
      );
      await tester.ensureVisible(upBtn);
      await tester.pumpAndSettle();
      await tester.tap(upBtn);
      await tester.pumpAndSettle();
      expect(
        find.text('Original • Tom: F (+1)'),
        findsOneWidget,
      );

      // Reset transposition
      final resetBtn = find.byKey(
        const ValueKey('song_detail_transpose_reset_button'),
      );
      await tester.tap(resetBtn);
      await tester.pumpAndSettle();
      expect(
        find.text('Original • Tom: E'),
        findsOneWidget,
      );

      // Switch to Apenas Letra mode and back to Cifra Inteligente
      final lyricsModeChip = find.byKey(
        const ValueKey('song_detail_view_mode_lyrics'),
      );
      await tester.ensureVisible(lyricsModeChip);
      await tester.pumpAndSettle();
      await tester.tap(lyricsModeChip);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('song_detail_inline_chord_sheet')),
        findsNothing,
      );
      final chordModeChip = find.byKey(
        const ValueKey('song_detail_view_mode_chord'),
      );
      await tester.ensureVisible(chordModeChip);
      await tester.pumpAndSettle();
      await tester.tap(chordModeChip);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('song_detail_inline_chord_sheet')),
        findsOneWidget,
      );

      // Switch to second linked Smart Chord (sc_2, Key D)
      final pill2 = find.byKey(const ValueKey('song_detail_chord_pill_sc_2'));
      await tester.ensureVisible(pill2);
      await tester.pumpAndSettle();
      await tester.tap(pill2);
      await tester.pumpAndSettle();
      expect(
        find.text('Original • Tom: D'),
        findsOneWidget,
      );

      // Unlink sc_2 from options menu
      final optionsMenu = find.byKey(
        const ValueKey('song_detail_chord_options_menu'),
      );
      await tester.ensureVisible(optionsMenu);
      await tester.pumpAndSettle();
      await tester.tap(optionsMenu);
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('song_detail_unlink_smart_chord_button')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('confirm_unlink_smart_chord_button')),
      );
      await tester.pumpAndSettle();

      expect(lastUnlinkedChordId, 'sc_2');
      expect(find.text('Original • Tom: E'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('song_detail_chord_pill_sc_2')),
        findsNothing,
      );

      // Zoom in & out updates font readout
      expect(find.byKey(const ValueKey('song_detail_font_size_label')), findsOneWidget);
      expect(find.text('15px'), findsOneWidget);
      final zoomIn = find.byKey(const ValueKey('song_detail_zoom_in_button'));
      await tester.ensureVisible(zoomIn);
      await tester.tap(zoomIn);
      await tester.pumpAndSettle();
      expect(find.text('16px'), findsOneWidget);

      // Toggle auto-scroll speed and enter fullscreen stand
      await tester.tap(
        find.byKey(const ValueKey('song_detail_autoscroll_speed_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('3x'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_detail_fullscreen_button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('song_fullscreen_exit_button')),
        findsOneWidget,
      );
      final exitBtn = find.byKey(
        const ValueKey('song_fullscreen_exit_button'),
      );
      await tester.ensureVisible(exitBtn);
      await tester.tap(exitBtn);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('song_detail_music_stand_bar')),
        findsOneWidget,
      );
    });

    testWidgets(
        'fullscreen stand toolbar wraps cleanly on 320px width without overflow and syncs controls',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      const chord = SmartChord(
        id: 'sc_fs',
        userId: 'member_user',
        title: 'Em Teus Braços',
        originalKey: 'E',
        content: 'E         B/D#\nSeguro estou em Ti\n[C#m]Para sempre [A]Deus',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      );
      fakeRepo.detail = const SongDetail(
        id: 'song_fs',
        ministryId: 'min_1',
        title: 'Em Teus Braços',
        artistName: 'Laura Souguellis',
        originalKey: 'E',
      );
      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [chord],
        onRemoveLink: (_, __) async {},
      );

      await tester.pumpWidget(
        ProviderScope(
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
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: linkRepo,
              ),
            ),
          ],
          child: const MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 'song_fs',
              initialTitle: 'Em Teus Braços',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final fullscreenBtn = find.byKey(
        const ValueKey('song_detail_fullscreen_button'),
      );
      await tester.ensureVisible(fullscreenBtn);
      await tester.tap(fullscreenBtn);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(
        find.byKey(const ValueKey('song_fullscreen_exit_button')),
        findsOneWidget,
      );

      final fsTransposeUp = find.byTooltip('Meio tom acima');
      await tester.ensureVisible(fsTransposeUp);
      await tester.tap(fsTransposeUp);
      await tester.pumpAndSettle();
      final fsZoomIn = find.byTooltip('Aumentar zoom');
      await tester.ensureVisible(fsZoomIn);
      await tester.tap(fsZoomIn);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      final exitBtn = find.byKey(
        const ValueKey('song_fullscreen_exit_button'),
      );
      await tester.ensureVisible(exitBtn);
      await tester.tap(exitBtn);
      await tester.pumpAndSettle();

      expect(find.text('Original • Tom: F (+1)'), findsOneWidget);
      expect(find.text('16px'), findsOneWidget);
    });

    testWidgets(
        'FASE 2/3/5: respects initialVersionId, scopes smart chords by version, associates pending classification, and wraps cleanly at 320px',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      const chordV1 = SmartChord(
        id: 'sc_v1',
        userId: 'member_user',
        title: 'Lugar Secreto (Original)',
        versionId: 'v1',
        originalKey: 'C',
        content: '[C]Tu és tudo',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
        repertoireLink: SmartChordSongLink(
          id: 'l_v1',
          userId: 'member_user',
          smartChordId: 'sc_v1',
          ministryId: 'min_1',
          songId: 'song_ver',
          versionId: 'v1',
          linkStatus: 'active',
        ),
      );
      const chordV2 = SmartChord(
        id: 'sc_v2',
        userId: 'member_user',
        title: 'Lugar Secreto (Acústica)',
        versionId: 'v2',
        originalKey: 'D',
        content: '[D]Tu és tudo',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
        repertoireLink: SmartChordSongLink(
          id: 'l_v2',
          userId: 'member_user',
          smartChordId: 'sc_v2',
          ministryId: 'min_1',
          songId: 'song_ver',
          versionId: 'v2',
          linkStatus: 'active',
        ),
      );
      var pendingResolved = false;
      String? recordedSetVersionId;

      fakeRepo.detail = const SongDetail(
        id: 'song_ver',
        ministryId: 'min_1',
        title: 'Lugar Secreto',
        artistName: 'Gabriela Rocha',
        originalKey: 'C',
        versions: [
          SongVersion(id: 'v1', name: 'Original', key: 'C'),
          SongVersion(id: 'v2', name: 'Acústica', key: 'D'),
        ],
      );

      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async {
          final pendingChord = SmartChord(
            id: 'sc_pend',
            userId: 'member_user',
            title: 'Cifra Legada',
            originalKey: 'G',
            content: '[G]Legado',
            createdAt: '2026-11-10T00:00:00Z',
            updatedAt: '2026-11-10T00:00:00Z',
            repertoireLink: pendingResolved
                ? const SmartChordSongLink(
                    id: 'l_pend',
                    userId: 'member_user',
                    smartChordId: 'sc_pend',
                    ministryId: 'min_1',
                    songId: 'song_ver',
                    versionId: 'v2',
                    linkStatus: 'active',
                  )
                : const SmartChordSongLink(
                    id: 'l_pend',
                    userId: 'member_user',
                    smartChordId: 'sc_pend',
                    ministryId: 'min_1',
                    songId: 'song_ver',
                    versionId: null,
                    linkStatus: 'pending_classification',
                    pendingReason: 'legacy_ambiguous',
                  ),
          );
          return [chordV1, chordV2, pendingChord];
        },
        onRemoveLink: (_, __) async {},
        onSetLink: (ministryId, chordId, songId, versionId) async {
          recordedSetVersionId = versionId;
          pendingResolved = true;
          return SmartChordRepertoireLink(
            link: SmartChordSongLink(
              id: 'l_pend',
              userId: 'member_user',
              smartChordId: chordId,
              ministryId: ministryId,
              songId: songId,
              versionId: versionId,
              linkStatus: 'active',
            ),
            song: SmartChordSongSummary(id: songId, title: 'Lugar Secreto'),
          );
        },
      );

      await tester.pumpWidget(
        ProviderScope(
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
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry:
                      Ministry(id: 'min_1', name: 'Ministério 1', role: 'admin'),
                  availableMinistries: [
                    Ministry(id: 'min_1', name: 'Ministério 1', role: 'admin'),
                  ],
                ),
              ),
            ),
            authNotifierProvider.overrideWith((ref) => _FakeAuthNotifier()),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: linkRepo,
              ),
            ),
          ],
          child: const MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 'song_ver',
              initialTitle: 'Lugar Secreto',
              initialVersionId: 'v2',
              backLabel: 'Voltar',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Context back button & active version scoped chord
      expect(find.text('Voltar'), findsOneWidget);
      expect(find.text('Tom: D'), findsOneWidget);
      expect(find.text('Acústica • Tom: D'), findsOneWidget);
      expect(find.textContaining('Lugar Secreto (Original)'), findsNothing);
      expect(
        find.byKey(const ValueKey('song_detail_pending_classification_banner')),
        findsOneWidget,
      );

      // Classify pending chord for active version (v2)
      final classifyBtn = find.byKey(
        const ValueKey('song_detail_classify_pending_sc_pend'),
      );
      await tester.ensureVisible(classifyBtn);
      await tester.pumpAndSettle();
      final classifyBtnSize = tester.getSize(classifyBtn);
      expect(classifyBtnSize.width, greaterThanOrEqualTo(44));
      expect(classifyBtnSize.height, greaterThanOrEqualTo(44));
      await tester.tap(classifyBtn);
      await tester.pumpAndSettle();

      expect(recordedSetVersionId, equals('v2'));
      expect(
        find.byKey(const ValueKey('song_detail_chord_pill_sc_pend')),
        findsOneWidget,
      );
      expect(
        find.text('Lugar Secreto (Acústica) (D)'),
        findsOneWidget,
      );

      // Switch to version v1 -> shows only chordV1
      final v1Chip = find.byKey(const ValueKey('detail_version_chip_v1'));
      await tester.ensureVisible(v1Chip);
      await tester.pumpAndSettle();
      await tester.tap(v1Chip);
      await tester.pumpAndSettle();

      expect(find.text('Original • Tom: C'), findsOneWidget);
      expect(find.text('Acústica • Tom: D'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'FASE 3: shows explicit version fallback notice and pops back to schedule on context back button tap',
        (tester) async {
      fakeRepo.detail = const SongDetail(
        id: 'song_ver',
        ministryId: 'min_1',
        title: 'Lugar Secreto',
        artistName: 'Gabriela Rocha',
        originalKey: 'C',
        versions: [
          SongVersion(id: 'v1', name: 'Original', key: 'C'),
          SongVersion(id: 'v2', name: 'Acústica', key: 'D'),
        ],
      );

      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => [],
        onRemoveLink: (_, __) async {},
      );
      final navKey = GlobalKey<NavigatorState>();

      await tester.pumpWidget(
        ProviderScope(
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
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: linkRepo,
              ),
            ),
          ],
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Escala Origem')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const SongDetailView(
            ministryId: 'min_1',
            songId: 'song_ver',
            initialTitle: 'Lugar Secreto',
            initialVersionId: 'ver-removida',
            backLabel: 'Voltar',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('song_detail_version_fallback_banner')),
        findsOneWidget,
      );
      expect(find.textContaining('não foi encontrada'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_detail_context_back_button')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Escala Origem'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'R2.2 Fase 1: compact D1 music stand bar keeps accessible controls without overflow across phone/tablet, dark theme and 1.5x text scale',
        (tester) async {
      const chord = SmartChord(
        id: 'sc_r22_1',
        userId: 'admin_owner',
        title: 'Em Teus Braços (Piano)',
        originalKey: 'E',
        content: '[E]Seguro estou nos [A]braços\n[B]Nunca me [E]deixou',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      );
      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [chord],
        onRemoveLink: (_, __) async {},
      );

      Future<void> pumpViewport(
        Size size, {
        double textScale = 1.0,
        Brightness brightness = Brightness.light,
      }) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              appEnvironmentProvider.overrideWithValue(
                const AppEnvironment(
                  env: AppEnv.development,
                  apiBaseUrl: 'http://localhost:3000/api/v1',
                ),
              ),
              repertoireRepositoryProvider.overrideWithValue(fakeRepo),
              songDetailNotifierProvider.overrideWith(
                (ref) => SongDetailNotifier(repository: fakeRepo),
              ),
              ministryContextNotifierProvider.overrideWith(
                (ref) => FakeMinistryContextNotifier(
                  const MinistryContextState(
                    status: MinistryBootstrapStatus.ready,
                    selectedMinistry: Ministry(
                      id: 'min_1',
                      name: 'Ministério 1',
                      role: 'admin',
                    ),
                  ),
                ),
              ),
              authNotifierProvider.overrideWith(
                (ref) => _FakeAuthNotifier(userId: 'admin_owner'),
              ),
              smartChordRepertoireLinkRepositoryProvider
                  .overrideWithValue(linkRepo),
              songSmartChordsNotifierProvider.overrideWith(
                (ref) => SongSmartChordsNotifier(
                  repository: _NoopSmartChordRepo(),
                  linkRepository: linkRepo,
                ),
              ),
              smartChordRepertoireLinkNotifierProvider.overrideWith(
                (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
              ),
            ],
            child: MaterialApp(
              theme: ThemeData(brightness: brightness, useMaterial3: true),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(textScale),
                ),
                child: child!,
              ),
              home: const SongDetailView(
                ministryId: 'min_1',
                songId: 'song_1',
                initialTitle: 'Em Teus Braços',
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          tester.takeException(),
          isNull,
          reason: 'No overflow at $size / scale=$textScale / $brightness',
        );
      }

      await pumpViewport(const Size(320, 640), textScale: 1.5);
      expect(
        find.byKey(const ValueKey('song_detail_music_stand_bar')),
        findsOneWidget,
      );
      expect(find.byTooltip('Cifra Inteligente'), findsOneWidget);
      expect(find.byTooltip('Apenas Letra'), findsOneWidget);
      expect(find.byTooltip('Abrir no Cifrador'), findsOneWidget);
      expect(find.text('Desvincular'), findsNothing);
      for (final buttonKey in const [
        ValueKey('song_detail_view_mode_chord'),
        ValueKey('song_detail_view_mode_lyrics'),
        ValueKey('song_detail_open_smart_chord_button'),
        ValueKey('song_detail_transpose_down_button'),
        ValueKey('song_detail_transpose_up_button'),
        ValueKey('song_detail_zoom_out_button'),
        ValueKey('song_detail_zoom_in_button'),
        ValueKey('song_detail_autoscroll_toggle_button'),
        ValueKey('song_detail_autoscroll_speed_button'),
        ValueKey('song_detail_fullscreen_button'),
      ]) {
        final size = tester.getSize(find.byKey(buttonKey));
        expect(
          size.width,
          greaterThanOrEqualTo(44),
          reason: '$buttonKey width >= 44dp',
        );
        expect(
          size.height,
          greaterThanOrEqualTo(44),
          reason: '$buttonKey height >= 44dp',
        );
      }

      await pumpViewport(const Size(360, 740));
      await pumpViewport(
        const Size(393, 851),
        brightness: Brightness.dark,
      );
      await pumpViewport(const Size(900, 1280));
    });

    testWidgets(
        'R2.2 Fase 2: fullscreen stand aligns content to top, handles wide progression scroll, centers block on tablet, and docks compact controls at bottom',
        (tester) async {
      const chord = SmartChord(
        id: 'sc_fs_r22',
        userId: 'member_user',
        title: 'Tablatura & Progressão',
        originalKey: 'E',
        content:
            '| E9 | B/D# | C#m7 | A9 | E9 | B/D# | C#m7 | A9 | E9 | B/D# | C#m7 | A9 |\n'
            '[E]Santo é o Senhor [B]para sempre',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      );
      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [chord],
        onRemoveLink: (_, __) async {},
      );

      Widget buildFullscreenHost({required Size size}) {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });
        return ProviderScope(
          key: ValueKey('fs_${size.width}_${size.height}'),
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider
                .overrideWith((ref) => FakeMinistryContextNotifier()),
            authNotifierProvider.overrideWith((ref) => _FakeAuthNotifier()),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
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

      // Phone portrait: short song is top-aligned (not centered near middle of 844px)
      await tester.pumpWidget(buildFullscreenHost(size: const Size(390, 844)));
      await tester.pumpAndSettle();
      final phoneFsBtn = find.byKey(
        const ValueKey('song_detail_fullscreen_button'),
      );
      await tester.ensureVisible(phoneFsBtn);
      await tester.pumpAndSettle();
      await tester.tap(phoneFsBtn);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      final headerRect = tester.getRect(
        find.byKey(const ValueKey('song_fullscreen_header_title')),
      );
      expect(headerRect.top, lessThan(120));
      final headerWidget = tester.widget<Text>(
        find.byKey(const ValueKey('song_fullscreen_header_title')),
      );
      expect(headerWidget.textAlign, equals(TextAlign.start));
      expect(find.byType(ChordLyricLine), findsWidgets);
      expect(
        tester.getTopLeft(find.byType(ChordLyricLine).first).dy,
        lessThan(280),
      );

      final scrollWidget = tester.widget<SingleChildScrollView>(
        find.byKey(const ValueKey('song_fullscreen_scroll_container')),
      );
      expect(
        (scrollWidget.padding as EdgeInsets).bottom,
        greaterThanOrEqualTo(96),
      );

      final dockRect = tester.getRect(
        find.byKey(const ValueKey('song_fullscreen_bottom_bar')),
      );
      expect(dockRect.height, lessThanOrEqualTo(110));
      expect(dockRect.bottom, greaterThan(700));

      // Pop and verify tablet responsive max-width block centered horizontally
      final exitBtn = find.byKey(
        const ValueKey('song_fullscreen_exit_button'),
      );
      await tester.ensureVisible(exitBtn);
      await tester.tap(exitBtn);
      await tester.pumpAndSettle();

      await tester.pumpWidget(buildFullscreenHost(size: const Size(1200, 900)));
      await tester.pumpAndSettle();
      final tabletFsBtn = find.byKey(
        const ValueKey('song_detail_fullscreen_button'),
      );
      await tester.ensureVisible(tabletFsBtn);
      await tester.pumpAndSettle();
      await tester.tap(tabletFsBtn);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      final tabletScrollRect = tester.getRect(
        find.byKey(const ValueKey('song_fullscreen_scroll_container')),
      );
      expect(tabletScrollRect.width, lessThanOrEqualTo(900));
      expect(tabletScrollRect.left, greaterThan(100));
    });

    testWidgets(
        'R2.2 Fase 3: schedule sequential navigation preserves order/versions/zoom/speed, resets transpose, steps in-place in fullscreen, handles rapid skip races & 404, and pops cleanly on ministry switch',
        (tester) async {
      final songs = {
        's1': const SongDetail(
          id: 's1',
          ministryId: 'min_1',
          title: 'Música Um',
          originalKey: 'C',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'C'),
            SongVersion(id: 'v2', name: 'Acústica', key: 'D'),
          ],
        ),
        's2': const SongDetail(
          id: 's2',
          ministryId: 'min_1',
          title: 'Música Dois',
          originalKey: 'G',
          versions: [SongVersion(id: 'v_two', name: 'Principal', key: 'G')],
        ),
      };
      final chordCalls = <(String, String?)>[];
      var delayS2 = false;
      var failS2With404 = false;
      final s2Completer = Completer<SongDetail>();

      fakeRepo.onGetSongDetail = (ministryId, songId) async {
        if (songId == 's2' && failS2With404) {
          throw const AppFailure(
            message: 'Música não encontrada na escala',
            statusCode: 404,
          );
        }
        if (songId == 's2' && delayS2) {
          return s2Completer.future;
        }
        return songs[songId]!;
      };

      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [],
        onGetChordsForSongScoped: ({
          required ministryId,
          required songId,
          versionId,
          linkStatus,
        }) async {
          if (linkStatus != 'pending_classification') {
            chordCalls.add((songId, versionId));
          }
          return [
            SmartChord(
              id: 'sc_${songId}_${versionId ?? 'none'}',
              userId: 'admin_owner',
              title: 'Cifra $songId',
              versionId: versionId,
              originalKey: versionId == 'v2' ? 'D' : (songId == 's2' ? 'G' : 'C'),
              content: '[C]Conteúdo $songId ($versionId)',
              createdAt: '2026-11-10T00:00:00Z',
              updatedAt: '2026-11-10T00:00:00Z',
            ),
          ];
        },
        onRemoveLink: (_, __) async {},
      );

      final sequence = ScheduleSongSequenceContext.fromScheduleSongs(
        ministryId: 'min_1',
        scheduleId: 'sch_99',
        songs: const [
          ScheduleSong(
            id: 's1',
            title: 'Música Um',
            versionId: 'v1',
            versionName: 'Original',
          ),
          ScheduleSong(
            id: 's2',
            title: 'Música Dois',
            versionId: 'v_two',
            versionName: 'Principal',
          ),
          ScheduleSong(
            id: 's1',
            title: 'Música Um',
            versionId: 'v2',
            versionName: 'Acústica',
          ),
        ],
        initialScheduleSlotIndex: 0,
      );

      final navKey = GlobalKey<NavigatorState>();
      final ministryNotifier = FakeMinistryContextNotifier();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider
                .overrideWith((ref) => ministryNotifier),
            authNotifierProvider.overrideWith((ref) => _FakeAuthNotifier()),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
          ],
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Tela Escala')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => SongDetailView(
            ministryId: 'min_1',
            songId: 's1',
            initialTitle: 'Música Um',
            initialVersionId: 'v1',
            backLabel: 'Voltar',
            scheduleSequence: sequence,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Voltar'), findsOneWidget);
      expect(find.text('1 de 3'), findsOneWidget);
      expect(find.text('Original • Tom: C'), findsOneWidget);
      expect(chordCalls, contains(('s1', 'v1')));
      expect(chordCalls, contains(('s1', 'v2')));

      // Modify transpose, zoom and scroll speed on song 1
      final seqTransposeUp = find.byKey(
        const ValueKey('song_detail_transpose_up_button'),
      );
      await tester.ensureVisible(seqTransposeUp);
      await tester.pumpAndSettle();
      await tester.tap(seqTransposeUp);
      await tester.pumpAndSettle();
      expect(find.text('Original • Tom: C# (+1)'), findsOneWidget);

      final seqZoomIn = find.byKey(
        const ValueKey('song_detail_zoom_in_button'),
      );
      await tester.ensureVisible(seqZoomIn);
      await tester.tap(seqZoomIn);
      final seqSpeed = find.byKey(
        const ValueKey('song_detail_autoscroll_speed_button'),
      );
      await tester.ensureVisible(seqSpeed);
      await tester.tap(seqSpeed);
      await tester.pumpAndSettle();
      expect(find.text('16px'), findsOneWidget);
      expect(find.text('3x'), findsOneWidget);

      // Advance inline: 1 -> 2. Zoom & speed persist; transpose resets cleanly to 0
      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_next_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('2 de 3'), findsOneWidget);
      expect(find.text('Principal • Tom: G'), findsOneWidget);
      expect(find.text('16px'), findsOneWidget);
      expect(find.text('3x'), findsOneWidget);
      expect(chordCalls, contains(('s2', 'v_two')));

      // Advance inline: 2 -> 3 (repeated song s1 with version v2 served from cache)
      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_next_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('3 de 3'), findsOneWidget);
      expect(find.text('Acústica • Tom: D'), findsOneWidget);
      expect(chordCalls.where((c) => c == ('s1', 'v2')).length, equals(1));

      // 404 resilience: skip back to s2 when s2 throws 404 -> sequence bar still works to move to s1 (v1)
      failS2With404 = true;
      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('2 de 3'), findsOneWidget);
      expect(find.text('Música não encontrada na escala'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
        findsOneWidget,
      );
      failS2With404 = false;

      // Rapid skip race: from s2(404) click prev to s1(slot0) vs forward: let's go back to slot 0, then race 1->2->3
      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('1 de 3'), findsOneWidget);

      delayS2 = true;
      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_next_button')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_next_button')),
      );
      await tester.pumpAndSettle();
      s2Completer.complete(songs['s2']!);
      await tester.pumpAndSettle();
      delayS2 = false;

      expect(find.text('3 de 3'), findsOneWidget);
      expect(find.text('Acústica • Tom: D'), findsOneWidget);

      // Open fullscreen from slot 3 -> skip prev inside fullscreen in-place -> closes back to slot 2 inline
      final seqFsBtn = find.byKey(
        const ValueKey('song_detail_fullscreen_button'),
      );
      await tester.ensureVisible(seqFsBtn);
      await tester.pumpAndSettle();
      await tester.tap(seqFsBtn);
      await tester.pumpAndSettle();
      expect(find.text('3 de 3'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_fullscreen_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('2 de 3'), findsOneWidget);
      expect(find.textContaining('Música Dois'), findsWidgets);

      await tester.tap(
        find.descendant(
          of: find.byKey(const ValueKey('song_fullscreen_bottom_bar')),
          matching: find.byTooltip('Meio tom acima'),
        ),
      );
      await tester.pumpAndSettle();

      final exitBtn = find.byKey(
        const ValueKey('song_fullscreen_exit_button'),
      );
      await tester.ensureVisible(exitBtn);
      await tester.tap(exitBtn);
      await tester.pumpAndSettle();
      expect(find.text('2 de 3'), findsOneWidget);
      expect(find.text('Principal • Tom: G# (+1)'), findsOneWidget);

      // Re-open fullscreen and verify ministry switch pops BOTH fullscreen & SongDetailView cleanly
      await tester.ensureVisible(seqFsBtn);
      await tester.pumpAndSettle();
      await tester.tap(seqFsBtn);
      await tester.pumpAndSettle();
      ministryNotifier.switchMinistry(
        const Ministry(id: 'min_2', name: 'Ministério 2', role: 'member'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Tela Escala'), findsOneWidget);
    });

    testWidgets(
        'R2.2 Adendo RBAC Mobile: member reads admin shared chords & navigates schedule without seeing admin link/unlink/edit actions; secondary admin cannot modify another admin chord',
        (tester) async {
      const adminChord = SmartChord(
        id: 'sc_admin',
        userId: 'admin_owner',
        title: 'Em Teus Braços (Admin)',
        originalKey: 'E',
        content: '[E]Seguro estou nos [A]braços',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      );
      const pendingForeignChord = SmartChord(
        id: 'sc_pend_admin',
        userId: 'admin_owner',
        title: 'Cifra Pendente',
        originalKey: 'G',
        content: '[G]Pendente',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
        repertoireLink: SmartChordSongLink(
          id: 'l_pend',
          userId: 'admin_owner',
          smartChordId: 'sc_pend_admin',
          ministryId: 'min_1',
          songId: 'song_1',
          versionId: null,
          linkStatus: 'pending_classification',
          pendingReason: 'legacy_ambiguous',
        ),
      );
      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => [adminChord, pendingForeignChord],
        onRemoveLink: (_, __) async {},
      );

      Widget buildRoleSubject({
        required String role,
        required String userId,
      }) {
        return ProviderScope(
          key: ValueKey('role_${role}_$userId'),
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry: Ministry(
                    id: 'min_1',
                    name: 'Ministério 1',
                    role: role,
                  ),
                ),
              ),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _FakeAuthNotifier(userId: userId),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
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

      // 1. Member: reads shared admin chord + transposes + toggles mode, hides ALL admin/owner controls
      await tester.pumpWidget(
        buildRoleSubject(role: 'member', userId: 'member_reader'),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('song_detail_music_stand_bar')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('song_detail_inline_chord_sheet')),
        findsOneWidget,
      );
      expect(find.byTooltip('Vincular cifra existente'), findsNothing);
      expect(find.byTooltip('Nova Cifra para esta música'), findsNothing);
      expect(
        find.byKey(const ValueKey('song_detail_open_smart_chord_button')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_chord_options_menu')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_pending_classification_banner')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_classify_pending_sc_pend_admin')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('edit_song_button')), findsNothing);
      expect(find.byKey(const ValueKey('delete_song_button')), findsNothing);

      // Member still uses transposition & mode switch
      final memberTransposeUp = find.byKey(
        const ValueKey('song_detail_transpose_up_button'),
      );
      await tester.ensureVisible(memberTransposeUp);
      await tester.pumpAndSettle();
      await tester.tap(memberTransposeUp);
      await tester.pumpAndSettle();
      expect(find.text('Original • Tom: F (+1)'), findsOneWidget);

      // 2. Secondary Admin viewing admin_owner's chord: sees Link & New Chord, but NOT Abrir no Cifrador / Opções (Desvincular) / foreign pending classify
      await tester.pumpWidget(
        buildRoleSubject(role: 'admin', userId: 'secondary_admin'),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Vincular cifra existente'), findsOneWidget);
      expect(find.byTooltip('Nova Cifra para esta música'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('song_detail_open_smart_chord_button')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_chord_options_menu')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_classify_pending_sc_pend_admin')),
        findsNothing,
      );

      // 3. Fail-closed when owner identity on active/pending chord is blank even for admin
      final blankOwnerLinkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => [
          adminChord.copyWith(userId: ''),
          pendingForeignChord.copyWith(userId: ''),
        ],
        onRemoveLink: (_, __) async {},
      );
      await tester.pumpWidget(
        ProviderScope(
          key: const ValueKey('role_admin_blank_owner'),
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry: Ministry(
                    id: 'min_1',
                    name: 'Ministério 1',
                    role: 'admin',
                  ),
                ),
              ),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _FakeAuthNotifier(userId: 'admin_owner'),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(blankOwnerLinkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: blankOwnerLinkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: blankOwnerLinkRepo,
              ),
            ),
          ],
          child: const MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 'song_1',
              initialTitle: 'Em Teus Braços',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('song_detail_open_smart_chord_button')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_chord_options_menu')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('song_detail_pending_classification_banner')),
        findsNothing,
      );

      // 4. Fail-closed when authenticated admin identity is blank (empty userId)
      await tester.pumpWidget(
        ProviderScope(
          key: const ValueKey('role_admin_blank_current_user'),
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry: Ministry(
                    id: 'min_1',
                    name: 'Ministério 1',
                    role: 'admin',
                  ),
                ),
              ),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _FakeAuthNotifier(userId: ''),
            ),
            smartChordRepertoireLinkRepositoryProvider.overrideWithValue(
              _FakeLinkRepo(
                onGetChordsForSong: () async => const [],
                onRemoveLink: (_, __) async {},
              ),
            ),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: _FakeLinkRepo(
                  onGetChordsForSong: () async => const [],
                  onRemoveLink: (_, __) async {},
                ),
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: _FakeLinkRepo(
                  onGetChordsForSong: () async => const [],
                  onRemoveLink: (_, __) async {},
                ),
              ),
            ),
          ],
          child: const MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 'song_1',
              initialTitle: 'Em Teus Braços',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byTooltip('Vincular cifra existente'), findsNothing);
      expect(find.byTooltip('Nova Cifra para esta música'), findsNothing);
      expect(find.text('Vincular cifra existente'), findsNothing);
      expect(find.text('Cadastrar nova cifra inteligente'), findsNothing);
    });

    testWidgets(
        'R2.2.1 Compact Header & Fullscreen: aligns Voltar and 1 de 2 on single row and keeps visible Tela cheia button for admin and member across 320dp, 360dp and 393dp',
        (tester) async {
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      const chord = SmartChord(
        id: 'sc_r221_hdr',
        userId: 'admin_owner',
        title: 'Cifra R221',
        versionId: 'v1',
        originalKey: 'E',
        content: '[E]VersaoUm',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      );
      fakeRepo.detail = const SongDetail(
        id: 's1',
        ministryId: 'min_1',
        title: 'Música da Escala',
        artistName: 'Banda Teste',
        originalKey: 'E',
        versions: [
          SongVersion(id: 'v1', name: 'Original', key: 'E'),
          SongVersion(id: 'v2', name: 'Acústica', key: 'G'),
        ],
      );
      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [chord],
        onRemoveLink: (_, __) async {},
      );
      final sequence = ScheduleSongSequenceContext.fromScheduleSongs(
        ministryId: 'min_1',
        scheduleId: 'sch_r221',
        songs: const [
          ScheduleSong(
            id: 's1',
            title: 'Música da Escala',
            versionId: 'v1',
            versionName: 'Original',
          ),
          ScheduleSong(
            id: 's2',
            title: 'Segunda Música',
            versionId: 'v2',
            versionName: 'Principal',
          ),
        ],
        initialScheduleSlotIndex: 0,
      );

      for (final viewportWidth in const [320.0, 360.0, 393.0]) {
        for (final role in const ['member', 'admin']) {
          tester.view.physicalSize = Size(viewportWidth, 740);
          tester.view.devicePixelRatio = 1.0;

          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                appEnvironmentProvider.overrideWithValue(
                  const AppEnvironment(
                    env: AppEnv.development,
                    apiBaseUrl: 'http://localhost:3000/api/v1',
                  ),
                ),
                repertoireRepositoryProvider.overrideWithValue(fakeRepo),
                songDetailNotifierProvider.overrideWith(
                  (ref) => SongDetailNotifier(repository: fakeRepo),
                ),
                ministryContextNotifierProvider.overrideWith(
                  (ref) => FakeMinistryContextNotifier(
                    MinistryContextState(
                      status: MinistryBootstrapStatus.ready,
                      selectedMinistry: Ministry(
                        id: 'min_1',
                        name: 'Ministério 1',
                        role: role,
                      ),
                    ),
                  ),
                ),
                authNotifierProvider.overrideWith(
                  (ref) => _FakeAuthNotifier(
                    userId: role == 'admin' ? 'admin_owner' : 'member_user',
                  ),
                ),
                smartChordRepertoireLinkRepositoryProvider
                    .overrideWithValue(linkRepo),
                songSmartChordsNotifierProvider.overrideWith(
                  (ref) => SongSmartChordsNotifier(
                    repository: _NoopSmartChordRepo(),
                    linkRepository: linkRepo,
                  ),
                ),
                smartChordRepertoireLinkNotifierProvider.overrideWith(
                  (ref) =>
                      SmartChordRepertoireLinkNotifier(repository: linkRepo),
                ),
              ],
              child: MaterialApp(
                key: ValueKey('hdr_${viewportWidth}_$role'),
                home: Scaffold(
                  body: Builder(
                    builder: (context) => Center(
                      child: ElevatedButton(
                        onPressed: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => SongDetailView(
                                ministryId: 'min_1',
                                songId: 's1',
                                initialTitle: 'Música da Escala',
                                initialVersionId: 'v1',
                                backLabel: 'Voltar',
                                scheduleSequence: sequence,
                              ),
                            ),
                          );
                        },
                        child: const Text('Abrir'),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.tap(find.text('Abrir'));
          await tester.pumpAndSettle();

          expect(
            tester.takeException(),
            isNull,
            reason: 'No overflow for $role at ${viewportWidth}dp',
          );
          expect(find.text('Voltar'), findsOneWidget);
          expect(find.text('Voltar para Escala'), findsNothing);
          expect(find.text('1 de 2'), findsOneWidget);
          expect(find.text('Música 1 de 2'), findsNothing);

          final headerRect = tester.getRect(
            find.byKey(const ValueKey('song_detail_context_header')),
          );
          final backRect = tester.getRect(
            find.byKey(const ValueKey('song_detail_context_back_button')),
          );
          final seqRect = tester.getRect(
            find.byKey(const ValueKey('song_detail_sequence_bar')),
          );
          expect(headerRect.height, lessThanOrEqualTo(60.0));
          expect(
            (backRect.center.dy - seqRect.center.dy).abs(),
            lessThanOrEqualTo(2.0),
            reason: 'Header items vertically aligned at ${viewportWidth}dp',
          );
          expect(backRect.right, lessThanOrEqualTo(seqRect.left));
          expect(seqRect.right, lessThanOrEqualTo(viewportWidth));

          final fsFinder = find.byKey(
            const ValueKey('song_detail_fullscreen_button'),
          );
          expect(fsFinder, findsOneWidget);
          expect(find.text('Tela cheia'), findsOneWidget);
          final fsRect = tester.getRect(fsFinder);
          expect(fsRect.left, greaterThanOrEqualTo(0.0));
          expect(fsRect.right, lessThanOrEqualTo(viewportWidth));
          expect(fsRect.width, greaterThanOrEqualTo(44.0));
          expect(fsRect.height, greaterThanOrEqualTo(44.0));
        }
      }

      // Open and exit fullscreen stand cleanly as member on narrow width (320dp)
      tester.view.physicalSize = const Size(320, 740);
      tester.view.devicePixelRatio = 1.0;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _FakeAuthNotifier(userId: 'member_user'),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
          ],
          child: MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 's1',
              initialTitle: 'Música da Escala',
              initialVersionId: 'v1',
              backLabel: 'Voltar',
              scheduleSequence: sequence,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('song_detail_fullscreen_button')),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
        find.byKey(const ValueKey('song_fullscreen_exit_button')),
        findsOneWidget,
      );
      expect(find.text('VersaoUm'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_fullscreen_exit_button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('song_detail_fullscreen_button')),
        findsOneWidget,
      );
    });

    testWidgets(
        'R2.2.1 Cached Prefetch Version Switch: switches between prefetched versions instantaneously without redundant requests or loading flicker',
        (tester) async {
      fakeRepo.detail = const SongDetail(
        id: 's_cache',
        ministryId: 'min_1',
        title: 'Música Multi-Versão',
        artistName: 'Banda Teste',
        originalKey: 'E',
        versions: [
          SongVersion(id: 'v1', name: 'Original', key: 'E'),
          SongVersion(id: 'v2', name: 'Acústica', key: 'G'),
          SongVersion(id: 'v3', name: 'Ao Vivo', key: 'D'),
        ],
      );
      final calls = <(String?, String?)>[];
      const chordsByVer = <String, SmartChord>{
        'v1': SmartChord(
          id: 'sc_v1',
          userId: 'admin_owner',
          title: 'Cifra Original',
          versionId: 'v1',
          originalKey: 'E',
          content: '[E]VersaoUm',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        ),
        'v2': SmartChord(
          id: 'sc_v2',
          userId: 'admin_owner',
          title: 'Cifra Acústica',
          versionId: 'v2',
          originalKey: 'G',
          content: '[G]VersaoDois',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        ),
        'v3': SmartChord(
          id: 'sc_v3',
          userId: 'admin_owner',
          title: 'Cifra Ao Vivo',
          versionId: 'v3',
          originalKey: 'D',
          content: '[D]VersaoTres',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        ),
      };

      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [],
        onGetChordsForSongScoped: ({
          required ministryId,
          required songId,
          versionId,
          linkStatus,
        }) async {
          calls.add((versionId, linkStatus));
          if (linkStatus == 'pending_classification') return const [];
          final chord = chordsByVer[versionId];
          return chord != null ? [chord] : const [];
        },
        onRemoveLink: (_, __) async {},
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _FakeAuthNotifier(userId: 'member_user'),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
          ],
          child: const MaterialApp(
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 's_cache',
              initialTitle: 'Música Multi-Versão',
              initialVersionId: 'v1',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Member does not fetch pending_classification, and all versions are prefetched.
      expect(calls.where((c) => c.$2 == 'pending_classification'), isEmpty);
      expect(calls.map((c) => c.$1), containsAll(const ['v1', 'v2', 'v3']));
      final callsBeforeSwitch = calls.length;

      expect(find.text('Original • Tom: E'), findsOneWidget);
      expect(find.text('VersaoUm'), findsOneWidget);

      // Instant v1 -> v2 switch (single frame, 0 network calls, no loading card)
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v2')));
      await tester.pump();
      expect(calls.length, equals(callsBeforeSwitch));
      expect(
        find.byKey(const ValueKey('song_detail_chord_content_loading')),
        findsNothing,
      );
      expect(find.text('Letra não cadastrada para esta música.'), findsNothing);
      expect(find.text('Acústica • Tom: G'), findsOneWidget);
      expect(find.text('Tom: G'), findsOneWidget);
      expect(find.text('VersaoDois'), findsOneWidget);

      // Instant v2 -> v3 switch
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v3')));
      await tester.pump();
      expect(calls.length, equals(callsBeforeSwitch));
      expect(find.text('Ao Vivo • Tom: D'), findsOneWidget);
      expect(find.text('Tom: D'), findsOneWidget);
      expect(find.text('VersaoTres'), findsOneWidget);

      // Instant v3 -> v1 switch
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v1')));
      await tester.pump();
      expect(calls.length, equals(callsBeforeSwitch));
      expect(find.text('Original • Tom: E'), findsOneWidget);
      expect(find.text('Tom: E'), findsOneWidget);
      expect(find.text('VersaoUm'), findsOneWidget);
    });

    testWidgets(
        'R2.2.1 Uncached Version Transition UX: updates selection & key immediately, preserves stand bar, scopes loading to content area without empty-lyrics flash or navigation lock',
        (tester) async {
      fakeRepo.detail = const SongDetail(
        id: 's_slow',
        ministryId: 'min_1',
        title: 'Música Transição',
        artistName: 'Banda Teste',
        originalKey: 'E',
        versions: [
          SongVersion(id: 'v1', name: 'Original', key: 'E'),
          SongVersion(id: 'v2', name: 'Versão 2', key: 'A'),
        ],
      );
      final v2Completer = Completer<List<SmartChord>>();
      final linkRepo = _FakeLinkRepo(
        onGetChordsForSong: () async => const [],
        onGetChordsForSongScoped: ({
          required ministryId,
          required songId,
          versionId,
          linkStatus,
        }) {
          if (linkStatus == 'pending_classification') {
            return Future.value(const <SmartChord>[]);
          }
          if (versionId == 'v2') {
            return v2Completer.future;
          }
          return Future.value(const [
            SmartChord(
              id: 'sc_slow_v1',
              userId: 'admin_owner',
              title: 'Cifra V1',
              versionId: 'v1',
              originalKey: 'E',
              content: '[E]ConteudoUm',
              createdAt: '2026-11-10T00:00:00Z',
              updatedAt: '2026-11-10T00:00:00Z',
            ),
          ]);
        },
        onRemoveLink: (_, __) async {},
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry: Ministry(
                    id: 'min_1',
                    name: 'Ministério 1',
                    role: 'admin',
                  ),
                ),
              ),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _FakeAuthNotifier(userId: 'admin_owner'),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => ElevatedButton(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const SongDetailView(
                          ministryId: 'min_1',
                          songId: 's_slow',
                          initialTitle: 'Música Transição',
                          initialVersionId: 'v1',
                          backLabel: 'Voltar',
                        ),
                      ),
                    );
                  },
                  child: const Text('Abrir Música'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Abrir Música'));
      // Advance frames for v1 to load while v2Completer remains pending.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text('ConteudoUm'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('song_detail_music_stand_bar')),
        findsOneWidget,
      );

      // Switch to slow uncached v2: chip, key, stand bar & scoped loading update cleanly
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v2')));
      await tester.pump();

      final v2Chip = tester.widget<ChoiceChip>(
        find.byKey(const ValueKey('detail_version_chip_v2')),
      );
      expect(v2Chip.selected, isTrue);
      expect(
        find.byKey(const ValueKey('song_detail_music_stand_bar')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('song_detail_chord_content_loading')),
        findsOneWidget,
      );
      expect(find.text('Versão 2 • Tom: A'), findsOneWidget);
      expect(find.text('Tom: A'), findsOneWidget);
      expect(find.text('Letra não cadastrada para esta música.'), findsNothing);

      // User can switch right back to cached v1 even while v2 request is still in-flight
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v1')));
      await tester.pump();
      expect(find.text('ConteudoUm'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('song_detail_chord_content_loading')),
        findsNothing,
      );

      // Tap back to v2 and complete v2 request -> coherent chord sheet renders
      await tester.tap(find.byKey(const ValueKey('detail_version_chip_v2')));
      await tester.pump();
      v2Completer.complete(const [
        SmartChord(
          id: 'sc_slow_v2',
          userId: 'admin_owner',
          title: 'Cifra V2',
          versionId: 'v2',
          originalKey: 'A',
          content: '[A]ConteudoDois',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        ),
      ]);
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('song_detail_chord_content_loading')),
        findsNothing,
      );
      expect(find.text('Versão 2 • Tom: A'), findsOneWidget);
      expect(find.text('ConteudoDois'), findsOneWidget);

      // Navigation stays unlocked
      await tester.tap(
        find.byKey(const ValueKey('song_detail_context_back_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Abrir Música'), findsOneWidget);
    });
  });
}

class _NoopSmartChordRepo implements SmartChordRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeLinkRepo implements SmartChordRepertoireLinkRepository {
  final Future<List<SmartChord>> Function() onGetChordsForSong;
  final Future<List<SmartChord>> Function({
    required String ministryId,
    required String songId,
    String? versionId,
    String? linkStatus,
  })? onGetChordsForSongScoped;
  final Future<void> Function(String ministryId, String chordId) onRemoveLink;
  final Future<SmartChordRepertoireLink> Function(
    String ministryId,
    String chordId,
    String songId,
    String? versionId,
  )? onSetLink;

  _FakeLinkRepo({
    required this.onGetChordsForSong,
    this.onGetChordsForSongScoped,
    required this.onRemoveLink,
    this.onSetLink,
  });

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
    String? versionId,
    String? linkStatus,
  }) {
    if (onGetChordsForSongScoped != null) {
      return onGetChordsForSongScoped!(
        ministryId: ministryId,
        songId: songId,
        versionId: versionId,
        linkStatus: linkStatus,
      );
    }
    return onGetChordsForSong();
  }

  @override
  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) =>
      onRemoveLink(ministryId, chordId);

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async =>
      const SmartChordRepertoireLink.unlinked();

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
    String? versionId,
  }) async {
    if (onSetLink != null) {
      return onSetLink!(ministryId, chordId, songId, versionId);
    }
    throw UnimplementedError();
  }
}
