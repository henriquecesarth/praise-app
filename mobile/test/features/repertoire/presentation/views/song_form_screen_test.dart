import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
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

  setUp(() {
    fakeRepo = FakeRepertoireRepo();
  });

  Widget buildSubject({SongDetail? initialSong}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier(role: 'admin')),
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
  });
}
