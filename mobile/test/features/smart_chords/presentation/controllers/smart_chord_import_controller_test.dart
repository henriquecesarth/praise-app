import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_import_controller.dart';

class _FakeSmartChordRepo implements SmartChordRepository {
  SmartChordImportDraft? pdfDraftToReturn;
  SmartChordImportDraft? textDraftToReturn;
  Exception? errorToThrow;
  Completer<void>? pdfCompleter;
  Completer<void>? createCompleter;
  Map<String, dynamic>? lastCreatedPayload;
  int createCallCount = 0;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async => [];

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async => throw UnimplementedError();

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCallCount++;
    if (createCompleter != null) await createCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    lastCreatedPayload = payload;
    return SmartChord(
      id: 'sc-created-1',
      userId: 'user-1',
      title: payload['title'] as String,
      artistName: payload['artist_name'] as String?,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async => throw UnimplementedError();

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    if (pdfCompleter != null) await pdfCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return pdfDraftToReturn ??
        const SmartChordImportDraft(
          title: 'Extracted PDF Song',
          artistName: 'Extracted Artist',
          originalKey: 'G',
          content: '[G]Graças Te [D]dou',
          warnings: [],
          sourceType: 'pdf',
        );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    if (errorToThrow != null) throw errorToThrow!;
    return textDraftToReturn ??
        const SmartChordImportDraft(
          title: 'Text Song',
          artistName: 'Text Artist',
          originalKey: 'A',
          content: '[A]Santo [E]Deus',
          warnings: [ImportWarning(code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Alinhamento incerto')],
          sourceType: 'text',
        );
  }
}

class _FakeLinkRepo implements SmartChordRepertoireLinkRepository {
  Completer<void>? linkCompleter;
  Exception? errorToThrow;
  int linkCallCount = 0;
  String? lastMinistryId;
  String? lastChordId;
  String? lastSongId;

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
  }) async {
    linkCallCount++;
    if (linkCompleter != null) await linkCompleter!.future;
    lastMinistryId = ministryId;
    lastChordId = chordId;
    lastSongId = songId;
    if (errorToThrow != null) throw errorToThrow!;
    return SmartChordRepertoireLink(
      link: SmartChordSongLink(
        id: 'link-1',
        userId: 'user-1',
        smartChordId: chordId,
        songId: songId,
        ministryId: ministryId,
      ),
      song: SmartChordSongSummary(
        id: songId,
        title: 'Song Title',
      ),
    );
  }

  @override
  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {}

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async => [];
}

void main() {
  group('SmartChordImportNotifier', () {
    late _FakeSmartChordRepo repo;
    late _FakeLinkRepo linkRepo;
    late SmartChordImportNotifier notifier;

    setUp(() {
      repo = _FakeSmartChordRepo();
      linkRepo = _FakeLinkRepo();
      notifier = SmartChordImportNotifier(repository: repo, linkRepository: linkRepo);
    });

    test('initial state is pristine', () {
      expect(notifier.state.status, equals(ImportStatus.initial));
      expect(notifier.state.draft, isNull);
      expect(notifier.state.savedChord, isNull);
      expect(notifier.state.errorMessage, isNull);
    });

    test('importPdf extracts draft and transitions to preview state', () async {
      await notifier.importPdf([1, 2, 3], 'test.pdf');

      expect(notifier.state.status, equals(ImportStatus.preview));
      expect(notifier.state.draft, isNotNull);
      expect(notifier.state.draft!.title, equals('Extracted PDF Song'));
      expect(notifier.state.draft!.originalKey, equals('G'));
      expect(notifier.state.draft!.sourceType, equals('pdf'));
    });

    test('importText extracts draft with warnings and transitions to preview', () async {
      await notifier.importText('A       E\nSanto Deus');

      expect(notifier.state.status, equals(ImportStatus.preview));
      expect(notifier.state.draft, isNotNull);
      expect(notifier.state.draft!.title, equals('Text Song'));
      expect(notifier.state.draft!.warnings.length, equals(1));
      expect(notifier.state.draft!.warnings.first.code, equals('CHORD_ALIGNMENT_UNCERTAIN'));
    });

    test('stale extraction response from older generation is discarded', () async {
      final completer = Completer<void>();
      repo.pdfCompleter = completer;

      // Start import in gen 1
      final future = notifier.importPdf([1, 2, 3], 'stale.pdf');

      // Reset notifier to increment generation
      notifier.reset();
      expect(notifier.state.status, equals(ImportStatus.initial));

      // Resolve background extraction
      completer.complete();
      await future;

      // State should remain initial because gen 1 was discarded
      expect(notifier.state.status, equals(ImportStatus.initial));
      expect(notifier.state.draft, isNull);
    });

    test('saveChord persists personal SmartChord and transitions to saved state', () async {
      await notifier.importText('A       E\nSanto Deus');
      notifier.updateDraft(title: 'Custom Title', artistName: 'Custom Artist');

      final created = await notifier.saveChord();

      expect(created, isNotNull);
      expect(created!.title, equals('Custom Title'));
      expect(repo.lastCreatedPayload!['artist_name'], equals('Custom Artist'));
      expect(notifier.state.status, equals(ImportStatus.saved));
      expect(notifier.state.savedChord, isNotNull);
    });

    test('linkToRepertoire links saved chord to ministry song', () async {
      await notifier.importText('A       E\nSanto Deus');
      await notifier.saveChord();

      final success = await notifier.linkToRepertoire(ministryId: 'min-1', songId: 'song-42');

      expect(success, isTrue);
      expect(linkRepo.linkCallCount, equals(1));
      expect(linkRepo.lastMinistryId, equals('min-1'));
      expect(linkRepo.lastSongId, equals('song-42'));
      expect(notifier.state.status, equals(ImportStatus.success));
    });

    test('linkToRepertoire partial success safety: preserved savedChord if linking fails', () async {
      await notifier.importText('A       E\nSanto Deus');
      await notifier.saveChord();

      linkRepo.errorToThrow = const AppFailure(message: 'Falha de rede ao vincular.');

      final success = await notifier.linkToRepertoire(ministryId: 'min-1', songId: 'song-42');

      expect(success, isFalse);
      expect(notifier.state.savedChord, isNotNull); // Chord is preserved!
      expect(notifier.state.status, equals(ImportStatus.saved));
      expect(notifier.state.linkError, equals('Não foi possível concluir a operação. Tente novamente.'));
    });

    test('late remote create after reset is discarded locally and never returned for linking', () async {
      await notifier.importText('G\nLetra');
      repo.createCompleter = Completer<void>();
      final pending = notifier.saveChord();
      final duplicate = await notifier.saveChord();
      expect(duplicate, isNull);
      expect(repo.createCallCount, 1);
      notifier.reset();
      repo.createCompleter!.complete();
      expect(await pending, isNull);
      expect(repo.lastCreatedPayload, isNotNull); // remote create completed
      expect(notifier.state.savedChord, isNull);
      expect(await notifier.linkToRepertoire(ministryId: 'new-ministry', songId: 'song'), isFalse);
      expect(linkRepo.linkCallCount, 0);
    });

    test('disposing during extraction discards completion without reading disposed state', () async {
      repo.pdfCompleter = Completer<void>();
      final pending = notifier.importPdf([1], 'pending.pdf');
      notifier.dispose();
      repo.pdfCompleter!.complete();
      await pending;
    });

    test('disposing during create returns no stale chord', () async {
      await notifier.importText('G\nLetra');
      repo.createCompleter = Completer<void>();
      final pending = notifier.saveChord();
      notifier.dispose();
      repo.createCompleter!.complete();
      expect(await pending, isNull);
    });

    test('failed extraction can retry and clears the error', () async {
      repo.errorToThrow = const AppFailure(message: 'PDF inválido.', statusCode: 400);
      await notifier.importPdf([1], 'invalid.pdf');
      expect(notifier.state.draft, isNull);
      expect(notifier.state.errorMessage, 'PDF inválido.');
      repo.errorToThrow = null;
      await notifier.importPdf([1], 'valid.pdf');
      expect(notifier.state.status, ImportStatus.preview);
      expect(notifier.state.errorMessage, isNull);
    });

    test('reset during link discards local completion without deleting the saved chord remotely', () async {
      await notifier.importText('G\nLetra');
      await notifier.saveChord();
      linkRepo.linkCompleter = Completer<void>();
      final pending = notifier.linkToRepertoire(ministryId: 'min-a', songId: 'song');
      notifier.reset();
      linkRepo.linkCompleter!.complete();
      expect(await pending, isFalse);
      expect(notifier.state.savedChord, isNull);
      expect(notifier.state.status, ImportStatus.initial);
      expect(repo.createCallCount, 1);
    });
  });
}
