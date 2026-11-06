import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/smart_chord_picker_modal.dart';

class _FakeChordRepo implements SmartChordRepository {
  List<SmartChord> chords = [];

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async {
    if (search != null && search.isNotEmpty) {
      return chords.where((c) => c.title.toLowerCase().contains(search.toLowerCase())).toList();
    }
    return chords;
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async => chords.firstWhere((c) => c.id == id);

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async => throw UnimplementedError();

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async => throw UnimplementedError();

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Draft',
      content: '',
      warnings: [],
      sourceType: 'pdf',
    );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    return const SmartChordImportDraft(
      title: 'Draft',
      content: '',
      warnings: [],
      sourceType: 'text',
    );
  }

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) async {
    return const SmartChordImportDraft(
      title: 'Cifra URL',
      content: '',
      warnings: [],
      sourceType: 'url',
    );
  }

  @override
  Future<SmartChordImportDraft> importCapturedUrlDraft(
    String url,
    String musicalHtml,
  ) async => throw UnimplementedError('Captured URL import is unsupported by this fake.');

  @override
  Future<SmartChordImportDraft> importImageDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Cifra Imagem',
      content: '',
      warnings: [],
      sourceType: 'image',
    );
  }
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
  late _FakeChordRepo fakeChordRepo;
  late _FakeLinkRepo fakeLinkRepo;

  setUp(() {
    fakeChordRepo = _FakeChordRepo();
    fakeLinkRepo = _FakeLinkRepo();
    fakeChordRepo.chords = [
      const SmartChord(
        id: 'sc-1',
        userId: 'u-1',
        title: 'Grandes Coisas',
        originalKey: 'G',
        content: '[G]Tu és Deus',
        artistName: 'Fernandinho',
        createdAt: '',
        updatedAt: '',
      ),
      const SmartChord(
        id: 'sc-2',
        userId: 'u-1',
        title: 'Oceanos',
        originalKey: 'D',
        content: '[D]Tua graça',
        artistName: 'Hillsong',
        createdAt: '',
        updatedAt: '',
      ),
    ];
  });

  Widget buildSubject({required String songTitle}) {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(fakeChordRepo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(fakeLinkRepo),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => ElevatedButton(
              onPressed: () {
                SmartChordPickerModal.show(
                  ctx,
                  ministryId: 'min-1',
                  songId: 'song-grandes',
                  songTitle: songTitle,
                );
              },
              child: const Text('Abrir Picker'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('renders modal with list of personal chords and highlights title match', (tester) async {
    await tester.pumpWidget(buildSubject(songTitle: 'Grandes Coisas'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Picker'));
    await tester.pumpAndSettle();

    // Verify modal title and instructions
    expect(find.text('Vincular Cifra Existente'), findsOneWidget);
    expect(find.text('Grandes Coisas'), findsWidgets);
    expect(find.text('Oceanos'), findsOneWidget);

    // Verify "Título igual" chip for matching song
    expect(find.text('Título igual'), findsOneWidget);

    // Tap on the matching chord to link it
    await tester.tap(find.text('Grandes Coisas').first);
    await tester.pumpAndSettle();

    // Assert link repo was called
    expect(fakeLinkRepo.lastLinkedChordId, equals('sc-1'));
    expect(fakeLinkRepo.lastLinkedSongId, equals('song-grandes'));
  });
}
