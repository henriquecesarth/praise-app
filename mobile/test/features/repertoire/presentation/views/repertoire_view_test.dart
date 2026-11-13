import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry_onboarding.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_folders_repository.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/repertoire_folder.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_list_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/repertoire_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/widgets/song_card.dart';

class FakeRepertoireRepo implements RepertoireRepository {
  List<SongSummary> songs = [];
  List<Classification> classifications = [];
  List<Artist> artists = [];
  Exception? listError;
  int listCalls = 0;

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    listCalls++;
    if (listError != null) throw listError!;

    var filtered = List<SongSummary>.from(songs);
    if (search != null && search.isNotEmpty) {
      final q = search.toLowerCase();
      filtered = filtered
          .where(
            (s) =>
                s.title.toLowerCase().contains(q) ||
                s.displayArtist.toLowerCase().contains(q),
          )
          .toList();
    }
    if (classificationId != null && classificationId.isNotEmpty) {
      filtered = filtered
          .where((s) => s.classification?.id == classificationId)
          .toList();
    }

    return PaginatedSongs(
      songs: filtered,
      total: filtered.length,
      hasMore: false,
    );
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    return SongDetail(
      id: songId,
      ministryId: ministryId,
      title: 'Detalhe da Música',
      artistName: 'Artista',
      originalKey: 'G',
      lyrics: 'Letra...',
    );
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async {
    return classifications;
  }

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async {
    return SongDetail(
      id: 'mock-song',
      ministryId: ministryId,
      title: data.title,
    );
  }

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async {
    return SongDetail(
      id: songId,
      ministryId: ministryId,
      title: data.title,
    );
  }

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async =>
      artists;

  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      Artist(id: 'mock-artist', ministryId: ministryId, name: name);
}

class _FakeFoldersRepo implements RepertoireFoldersRepository {
  List<RepertoireFolder> folders = [];
  Map<String, List<SongSummary>> folderSongs = {};
  List<String> deletedArtistIds = [];

  @override
  Future<List<RepertoireFolder>> listFolders(String ministryId) async => folders;

  @override
  Future<RepertoireFolder> getFolder(String ministryId, String folderId) async {
    final base = folders.firstWhere((f) => f.id == folderId);
    final songs = folderSongs[folderId] ?? const [];
    return base.copyWith(songs: songs, songCount: songs.length);
  }

  @override
  Future<RepertoireFolder> createFolder(
    String ministryId, {
    required String name,
    String? description,
  }) async {
    final created = RepertoireFolder(
      id: 'f_${folders.length + 1}',
      ministryId: ministryId,
      name: name,
      description: description,
    );
    folders = [...folders, created];
    return created;
  }

  @override
  Future<RepertoireFolder> updateFolder(
    String ministryId,
    String folderId, {
    required String name,
    String? description,
  }) async {
    late RepertoireFolder updated;
    folders = folders.map((f) {
      if (f.id != folderId) return f;
      updated = f.copyWith(name: name, description: description);
      return updated;
    }).toList();
    return updated;
  }

  @override
  Future<void> deleteFolder(String ministryId, String folderId) async {
    folders = folders.where((f) => f.id != folderId).toList();
    folderSongs.remove(folderId);
  }

  @override
  Future<void> addSongToFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {}

  @override
  Future<void> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    folderSongs[folderId] =
        (folderSongs[folderId] ?? []).where((s) => s.id != songId).toList();
  }

  @override
  Future<void> deleteArtist(String ministryId, String artistId) async {
    deletedArtistIds.add(artistId);
  }
}

class _StubPrefsStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}
  @override
  String? getSelectedMinistryId() => 'min_1';
  @override
  String? getThemeMode() => null;
  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}
  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

class _StubMinistryRepo implements MinistryRepository {
  @override
  Future<Ministry> createMinistry({required String name}) =>
      throw UnimplementedError();
  @override
  Future<MinistryInvite> createInviteCode(String ministryId,
          {int expiresInDays = 7}) =>
      throw UnimplementedError();
  @override
  Future<List<Ministry>> getMyMinistries() async => const [];
  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) =>
      throw UnimplementedError();
}

class _FakeMinistryContextNotifier extends MinistryContextNotifier {
  _FakeMinistryContextNotifier(MinistryContextState initialState)
      : super(
          repository: _StubMinistryRepo(),
          preferencesStorage: _StubPrefsStorage(),
        ) {
    state = initialState;
  }
}

void main() {
  late FakeRepertoireRepo fakeRepo;

  setUp(() {
    fakeRepo = FakeRepertoireRepo();
  });

  Widget createSubject({String? ministryId = 'min_1'}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        repertoireListNotifierProvider.overrideWith((ref) {
          return RepertoireListNotifier(repository: fakeRepo);
        }),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: RepertoireView(ministryId: ministryId),
        ),
      ),
    );
  }

  group('RepertoireView Presentation', () {
    testWidgets('renders search field and empty state when catalogue is empty',
        (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Buscar música por título, artista ou letra...'),
          findsOneWidget);
      expect(find.text('Repertório Vazio'), findsOneWidget);
    });

    testWidgets(
        'renders classification filter chips when classifications exist',
        (tester) async {
      fakeRepo.classifications = [
        const Classification(
            id: 'c1', ministryId: 'min_1', name: 'Louvor', color: '#7C3AED'),
        const Classification(
            id: 'c2', ministryId: 'min_1', name: 'Adoração', color: '#06B6D4'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Todos'), findsOneWidget);
      expect(find.text('Louvor'), findsOneWidget);
      expect(find.text('Adoração'), findsOneWidget);
    });

    testWidgets('renders list of songs when data is present', (tester) async {
      fakeRepo.songs = [
        const SongSummary(
          id: 's1',
          ministryId: 'min_1',
          title: 'Grande é o Senhor',
          artistName: 'Adhemar de Campos',
          originalKey: 'A',
        ),
        const SongSummary(
          id: 's2',
          ministryId: 'min_1',
          title: 'Ruja o Leão',
          artistName: 'Talita Catanzaro',
          originalKey: 'Dm',
        ),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Grande é o Senhor'), findsOneWidget);
      expect(find.text('Adhemar de Campos'), findsOneWidget);
      expect(find.text('Ruja o Leão'), findsOneWidget);
      expect(find.byType(SongCard), findsNWidgets(2));
    });

    testWidgets('searching filters songs and clearing search restores list',
        (tester) async {
      fakeRepo.songs = [
        const SongSummary(
            id: 's1', ministryId: 'min_1', title: 'Aclame ao Senhor'),
        const SongSummary(
            id: 's2', ministryId: 'min_1', title: 'Vim Para Adorar-te'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Aclame ao Senhor'), findsOneWidget);
      expect(find.text('Vim Para Adorar-te'), findsOneWidget);

      // Enter search term
      await tester.enterText(find.byType(TextField), 'Vim');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();

      expect(find.text('Vim Para Adorar-te'), findsOneWidget);
      expect(find.text('Aclame ao Senhor'), findsNothing);

      // Clear search via clear button
      final clearButton = find.byIcon(Icons.clear);
      expect(clearButton, findsOneWidget);
      await tester.tap(clearButton);
      await tester.pumpAndSettle();

      expect(find.text('Aclame ao Senhor'), findsOneWidget);
      expect(find.text('Vim Para Adorar-te'), findsOneWidget);
    });

    testWidgets('displays error state and retry triggers reload',
        (tester) async {
      fakeRepo.listError =
          const AppFailure(message: 'Falha de conexão com a API.');

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Falha de conexão com a API.'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Clear error and press retry
      fakeRepo.listError = null;
      fakeRepo.songs = [
        const SongSummary(id: 's1', ministryId: 'min_1', title: 'Restaurado')
      ];

      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Restaurado'), findsOneWidget);
    });

    testWidgets('tapping a song card navigates to SongDetailView',
        (tester) async {
      fakeRepo.songs = [
        const SongSummary(
            id: 's1', ministryId: 'min_1', title: 'Música Clicável'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Música Clicável'));
      await tester.pumpAndSettle();

      expect(find.byType(SongDetailView), findsOneWidget);
    });

    testWidgets('renders responsive layout on tablet width without crash',
        (tester) async {
      tester.view.physicalSize = const Size(1200, 1920);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      fakeRepo.songs = [
        const SongSummary(id: 's1', ministryId: 'min_1', title: 'Tablet Song'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Tablet Song'), findsOneWidget);
    });

    testWidgets('displays prompt to select ministry when ministryId is null',
        (tester) async {
      await tester.pumpWidget(createSubject(ministryId: null));
      await tester.pumpAndSettle();

      expect(find.text('Selecione um ministério para ver o repertório.'),
          findsOneWidget);
    });

    testWidgets(
        'switches between Músicas, Pastas and Artistas tabs and filters by artist',
        (tester) async {
      final foldersRepo = _FakeFoldersRepo()
        ..folders = const [
          RepertoireFolder(
            id: 'f1',
            ministryId: 'min_1',
            name: 'Santa Ceia',
            songCount: 1,
          ),
        ]
        ..folderSongs = {
          'f1': const [
            SongSummary(
              id: 's1',
              ministryId: 'min_1',
              title: 'Digno é o Cordeiro',
              artistName: 'Diante do Trono',
            ),
          ],
        };
      fakeRepo.songs = const [
        SongSummary(
          id: 's1',
          ministryId: 'min_1',
          title: 'Digno é o Cordeiro',
          artistName: 'Diante do Trono',
        ),
        SongSummary(
          id: 's2',
          ministryId: 'min_1',
          title: 'A Casa é Sua',
          artistName: 'Casa Worship',
        ),
      ];
      fakeRepo.artists = const [
        Artist(id: 'a1', ministryId: 'min_1', name: 'Diante do Trono'),
        Artist(id: 'a2', ministryId: 'min_1', name: 'Casa Worship'),
      ];

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
            repertoireFoldersRepositoryProvider.overrideWithValue(foldersRepo),
            repertoireListNotifierProvider.overrideWith((ref) {
              return RepertoireListNotifier(repository: fakeRepo);
            }),
            repertoireFoldersNotifierProvider.overrideWith((ref) {
              return RepertoireFoldersNotifier(foldersRepository: foldersRepo);
            }),
            repertoireArtistsNotifierProvider.overrideWith((ref) {
              return RepertoireArtistsNotifier(
                repertoireRepository: fakeRepo,
                foldersRepository: foldersRepo,
              );
            }),
          ],
          child: const MaterialApp(
            home: Scaffold(body: RepertoireView(ministryId: 'min_1')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Open Pastas tab and inspect folder songs
      await tester.tap(find.text('Pastas'));
      await tester.pumpAndSettle();
      expect(find.text('Santa Ceia'), findsOneWidget);

      await tester.tap(find.text('Santa Ceia'));
      await tester.pumpAndSettle();
      expect(find.text('Digno é o Cordeiro'), findsOneWidget);

      // Open Artistas tab and tap Diante do Trono to filter Músicas
      await tester.tap(find.text('Artistas'));
      await tester.pumpAndSettle();
      expect(find.text('Diante do Trono'), findsOneWidget);
      expect(find.text('Casa Worship'), findsOneWidget);

      await tester.tap(find.text('Diante do Trono'));
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text('Digno é o Cordeiro'), findsOneWidget);
      expect(find.text('A Casa é Sua'), findsNothing);
    });

    testWidgets(
        'admin can rename folders, pick songs ignoring active search filter, and confirm artist delete',
        (tester) async {
      final foldersRepo = _FakeFoldersRepo()
        ..folders = const [
          RepertoireFolder(
            id: 'f1',
            ministryId: 'min_1',
            name: 'Santa Ceia',
            songCount: 0,
          ),
        ]
        ..folderSongs = {'f1': const []};
      fakeRepo.songs = const [
        SongSummary(
          id: 's1',
          ministryId: 'min_1',
          title: 'Digno é o Cordeiro',
          artistName: 'Diante do Trono',
        ),
        SongSummary(
          id: 's2',
          ministryId: 'min_1',
          title: 'A Casa é Sua',
          artistName: 'Casa Worship',
        ),
      ];
      fakeRepo.artists = const [
        Artist(id: 'a1', ministryId: 'min_1', name: 'Diante do Trono'),
      ];

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => _FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry: Ministry(
                    id: 'min_1',
                    name: 'Ministério',
                    role: 'admin',
                  ),
                ),
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            repertoireFoldersRepositoryProvider.overrideWithValue(foldersRepo),
            repertoireListNotifierProvider.overrideWith((ref) {
              return RepertoireListNotifier(repository: fakeRepo);
            }),
            repertoireFoldersNotifierProvider.overrideWith((ref) {
              return RepertoireFoldersNotifier(foldersRepository: foldersRepo);
            }),
            repertoireArtistsNotifierProvider.overrideWith((ref) {
              return RepertoireArtistsNotifier(
                repertoireRepository: fakeRepo,
                foldersRepository: foldersRepo,
              );
            }),
          ],
          child: const MaterialApp(
            home: Scaffold(body: RepertoireView(ministryId: 'min_1')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Apply an active search filter so listState.songs only contains s2
      await tester.enterText(find.byType(TextField), 'Casa');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text('Digno é o Cordeiro'), findsNothing);

      // Rename folder f1 in Pastas tab
      await tester.tap(find.text('Pastas'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('repertoire_folder_edit_button_f1')),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('repertoire_folder_name_input')),
        'Páscoa',
      );
      await tester.tap(
        find.byKey(const ValueKey('repertoire_folder_save_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Páscoa'), findsOneWidget);

      // Open renamed folder and open add-song picker: unfiltered list shows s1 too
      await tester.tap(find.text('Páscoa'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('repertoire_folder_add_song_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Digno é o Cordeiro'), findsOneWidget);
      expect(find.text('A Casa é Sua'), findsOneWidget);
      await tester.tap(find.text('Fechar'));
      await tester.pumpAndSettle();

      // Switch to Artistas tab: deleting artist requires confirmation
      await tester.tap(find.text('Artistas'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Excluir artista'));
      await tester.pumpAndSettle();
      expect(find.text('Excluir artista'), findsOneWidget);

      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(foldersRepo.deletedArtistIds, isEmpty);

      await tester.tap(find.byTooltip('Excluir artista'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('confirm_delete_artist_button_a1')),
      );
      await tester.pumpAndSettle();
      expect(foldersRepo.deletedArtistIds, ['a1']);
    });
  });
}
