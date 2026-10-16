import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_providers.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/song_link_picker_modal.dart';

class _FakeRepertoireRepo implements RepertoireRepository {
  List<SongSummary> songs = [];

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    return PaginatedSongs(songs: songs, total: songs.length);
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async => throw UnimplementedError();
  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [];
  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async => throw UnimplementedError();
  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async => throw UnimplementedError();
  @override
  Future<void> deleteSong(String ministryId, String songId) async {}
  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [];
  @override
  Future<Artist> createArtist(String ministryId, String name) async => throw UnimplementedError();
}

class _FakeLinkRepo implements SmartChordRepertoireLinkRepository {
  String? lastLinkedSongId;
  String? lastLinkedChordId;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async => const SmartChordRepertoireLink.unlinked();

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async {
    lastLinkedChordId = chordId;
    lastLinkedSongId = songId;
    return SmartChordRepertoireLink(
      link: SmartChordSongLink(
        id: "u_${chordId}_$ministryId",
        smartChordId: chordId,
        ministryId: ministryId,
        songId: songId,
        userId: "u",
      ),
      song: SmartChordSongSummary(id: songId, title: "Linked Song"),
    );
  }

  @override
  Future<SmartChordRepertoireLink> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async => const SmartChordRepertoireLink.unlinked();

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async => [];
}

void main() {
  late _FakeRepertoireRepo fakeRepo;
  late _FakeLinkRepo fakeLinkRepo;

  setUp(() {
    fakeRepo = _FakeRepertoireRepo();
    fakeLinkRepo = _FakeLinkRepo();
    fakeRepo.songs = [
      const SongSummary(
        id: 's-1',
        ministryId: 'min-1',
        title: 'Grandes Coisas',
        artistName: 'Fernandinho',
      ),
      const SongSummary(
        id: 's-2',
        ministryId: 'min-1',
        title: 'Oceanos',
        artistName: 'Hillsong',
      ),
    ];
  });

  Widget buildSubject({required String chordTitle}) {
    return ProviderScope(
      overrides: [
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(fakeLinkRepo),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => ElevatedButton(
              onPressed: () {
                SongLinkPickerModal.show(
                  ctx,
                  ministryId: 'min-1',
                  chordId: 'sc-grandes',
                  chordTitle: chordTitle,
                );
              },
              child: const Text('Abrir Picker'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('renders modal with list of songs and links chosen song', (tester) async {
    await tester.pumpWidget(buildSubject(chordTitle: 'Grandes Coisas'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Picker'));
    await tester.pumpAndSettle();

    expect(find.text('Vincular ao Repertório'), findsOneWidget);
    expect(find.text('Grandes Coisas'), findsWidgets);
    expect(find.text('Oceanos'), findsOneWidget);

    // Title match badge
    expect(find.text('Título igual'), findsOneWidget);

    // Tap to select song
    await tester.tap(find.text('Grandes Coisas').first);
    await tester.pumpAndSettle();

    expect(fakeLinkRepo.lastLinkedChordId, equals('sc-grandes'));
    expect(fakeLinkRepo.lastLinkedSongId, equals('s-1'));
  });
}
