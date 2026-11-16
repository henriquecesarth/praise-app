import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_detail_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_form_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_list_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/song_smart_chords_controller.dart';

class FakeSmartChordRepository implements SmartChordRepository {
  List<SmartChord> chordsToReturn = [];
  List<SmartChord> songChordsToReturn = [];
  SmartChord? detailToReturn;
  Exception? errorToThrow;
  Completer<void>? createCompleter;
  Completer<void>? updateCompleter;
  Completer<void>? deleteCompleter;
  int getChordsCallCount = 0;
  int getBySongCallCount = 0;
  int getDetailCallCount = 0;
  int createCallCount = 0;
  int updateCallCount = 0;
  int deleteCallCount = 0;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async {
    getChordsCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return chordsToReturn;
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async {
    getBySongCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return songChordsToReturn;
  }

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    getDetailCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    if (detailToReturn != null) return detailToReturn!;
    return SmartChord(
      id: id,
      userId: 'u-1',
      title: 'Fake Chord',
      originalKey: 'C',
      content: '[C]Content',
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
    );
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCallCount++;
    if (createCompleter != null) await createCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return SmartChord(
      id: 'sc-created',
      userId: 'u-1',
      title: (payload['title'] as String?) ?? 'New Chord',
      originalKey: (payload['original_key'] as String?) ?? 'C',
      content: (payload['content'] as String?) ?? '',
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async {
    updateCallCount++;
    if (updateCompleter != null) await updateCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return SmartChord(
      id: id,
      userId: 'u-1',
      title: (payload['title'] as String?) ?? 'Updated Chord',
      originalKey: (payload['original_key'] as String?) ?? 'C',
      content: (payload['content'] as String?) ?? '',
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:05:00Z',
    );
  }

  @override
  Future<void> deleteSmartChord(String id) async {
    deleteCallCount++;
    if (deleteCompleter != null) await deleteCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
  }

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

class _CallbackLinkRepository extends FakeSmartChordRepertoireLinkRepository {
  final Future<List<SmartChord>> Function(
    String ministryId,
    String songId,
    String? versionId,
    String? linkStatus,
  ) _handler;

  _CallbackLinkRepository(this._handler);

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
    String? versionId,
    String? linkStatus,
  }) =>
      _handler(ministryId, songId, versionId, linkStatus);
}

class FakeSmartChordRepertoireLinkRepository implements SmartChordRepertoireLinkRepository {
  List<SmartChord> chordsToReturn = [];
  int getMySmartChordsCallCount = 0;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    return const SmartChordRepertoireLink.unlinked();
  }

  String? lastVersionId;
  String? lastLinkStatus;

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
    String? versionId,
  }) async {
    return const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<SmartChordRepertoireLink> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    return const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
    String? versionId,
    String? linkStatus,
  }) async {
    getMySmartChordsCallCount++;
    lastVersionId = versionId;
    lastLinkStatus = linkStatus;
    return chordsToReturn;
  }
}

void main() {
  late FakeSmartChordRepository repository;

  setUp(() {
    repository = FakeSmartChordRepository();
  });

  group('SmartChordListNotifier', () {
    test('load loads chords successfully and sets state', () async {
      repository.chordsToReturn = [
        const SmartChord(
          id: 'sc-1',
          userId: 'u-1',
          title: 'Oceanos',
          originalKey: 'D',
          content: '[D]Tua graça',
          createdAt: '2026-10-13T00:00:00Z',
          updatedAt: '2026-10-13T00:00:00Z',
        ),
      ];

      final notifier = SmartChordListNotifier(repository: repository);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isEmpty, isTrue);

      await notifier.load();

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isSuccess, isTrue);
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.title, 'Oceanos');
      expect(repository.getChordsCallCount, 1);
    });

    test('load records error when repository throws AppFailure', () async {
      repository.errorToThrow = const AppFailure(message: 'Falha de rede.', statusCode: 500);

      final notifier = SmartChordListNotifier(repository: repository);
      await notifier.load();

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.hasError, isTrue);
      expect(notifier.state.errorMessage, 'Falha de rede.');
    });

    test('removeChord and upsertChord manipulate in-memory list', () {
      final notifier = SmartChordListNotifier(repository: repository);
      const c1 = SmartChord(
        id: '1',
        userId: 'u',
        title: 'Song 1',
        originalKey: 'C',
        content: '',
        createdAt: '',
        updatedAt: '',
      );
      const c2 = SmartChord(
        id: '2',
        userId: 'u',
        title: 'Song 2',
        originalKey: 'D',
        content: '',
        createdAt: '',
        updatedAt: '',
      );

      notifier.upsertChord(c1);
      expect(notifier.state.items.length, 1);

      notifier.upsertChord(c2);
      expect(notifier.state.items.length, 2);

      notifier.removeChord('1');
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, '2');
    });

    test('reset clears all state', () {
      final notifier = SmartChordListNotifier(repository: repository);
      notifier.upsertChord(const SmartChord(
        id: '1',
        userId: 'u',
        title: 'S',
        originalKey: 'C',
        content: '',
        createdAt: '',
        updatedAt: '',
      ));
      expect(notifier.state.items.isNotEmpty, isTrue);

      notifier.reset();
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.search, '');
    });
  });

  group('SongSmartChordsNotifier', () {
    test('load fetches chords for songId', () async {
      repository.songChordsToReturn = [
        const SmartChord(
          id: 'sc-song',
          userId: 'u',
          songId: 'song-99',
          title: 'Chord for Song',
          originalKey: 'E',
          content: '',
          createdAt: '',
          updatedAt: '',
        ),
      ];

      final notifier = SongSmartChordsNotifier(repository: repository);
      await notifier.load('song-99');

      expect(notifier.state.items.length, 1);
      expect(notifier.state.songId, 'song-99');
      expect(notifier.state.items.first.id, 'sc-song');
      expect(repository.getBySongCallCount, 1);
    });

    test('load with ministryId delegates to linkRepository.getMySmartChordsForSong', () async {
      final linkRepo = FakeSmartChordRepertoireLinkRepository();
      linkRepo.chordsToReturn = [
        const SmartChord(
          id: 'sc-linked',
          userId: 'u',
          songId: 'song-100',
          title: 'Linked Chord',
          originalKey: 'A',
          content: '',
          createdAt: '',
          updatedAt: '',
        ),
      ];

      final notifier = SongSmartChordsNotifier(
        repository: repository,
        linkRepository: linkRepo,
      );
      await notifier.load('song-100', ministryId: 'min-1');

      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, 'sc-linked');
      expect(linkRepo.getMySmartChordsCallCount, 1);
      expect(repository.getBySongCallCount, 0);
    });

    test('load with versionId scopes items and isolates pending classification chords', () async {
      final linkRepo = FakeSmartChordRepertoireLinkRepository();
      linkRepo.chordsToReturn = [
        const SmartChord(
          id: 'sc-v1',
          userId: 'u',
          songId: 'song-100',
          versionId: 'v1',
          title: 'Chord V1',
          originalKey: 'G',
          content: '',
          createdAt: '',
          updatedAt: '',
          repertoireLink: SmartChordSongLink(
            id: 'l1',
            userId: 'u',
            smartChordId: 'sc-v1',
            ministryId: 'min-1',
            songId: 'song-100',
            versionId: 'v1',
            linkStatus: 'active',
          ),
        ),
        const SmartChord(
          id: 'sc-v2',
          userId: 'u',
          songId: 'song-100',
          versionId: 'v2',
          title: 'Chord V2',
          originalKey: 'A',
          content: '',
          createdAt: '',
          updatedAt: '',
          repertoireLink: SmartChordSongLink(
            id: 'l2',
            userId: 'u',
            smartChordId: 'sc-v2',
            ministryId: 'min-1',
            songId: 'song-100',
            versionId: 'v2',
            linkStatus: 'active',
          ),
        ),
        const SmartChord(
          id: 'sc-pending',
          userId: 'u',
          songId: 'song-100',
          title: 'Chord Pending',
          originalKey: 'C',
          content: '',
          createdAt: '',
          updatedAt: '',
          repertoireLink: SmartChordSongLink(
            id: 'l3',
            userId: 'u',
            smartChordId: 'sc-pending',
            ministryId: 'min-1',
            songId: 'song-100',
            versionId: null,
            linkStatus: 'pending_classification',
            pendingReason: 'legacy_ambiguous',
          ),
        ),
      ];

      final notifier = SongSmartChordsNotifier(
        repository: repository,
        linkRepository: linkRepo,
      );
      await notifier.load('song-100', ministryId: 'min-1', versionId: 'v1');

      expect(notifier.state.versionId, 'v1');
      expect(notifier.state.items.map((e) => e.id).toList(), ['sc-v1']);
      expect(notifier.state.pendingItems.map((e) => e.id).toList(), ['sc-pending']);
    });

    test('reset clears state', () {
      final notifier = SongSmartChordsNotifier(repository: repository);
      notifier.reset();
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.songId, isNull);
    });

    test(
        'fetches active and pending chords in parallel, caches by (ministryId, songId, versionId), and skips pending when includePending is false',
        () async {
      final activeCompleter = Completer<List<SmartChord>>();
      final pendingCompleter = Completer<List<SmartChord>>();
      final calls = <(String?, String?)>[];

      final linkRepo = _CallbackLinkRepository((
        ministryId,
        songId,
        versionId,
        linkStatus,
      ) async {
        calls.add((versionId, linkStatus));
        if (linkStatus == 'pending_classification') {
          return pendingCompleter.future;
        }
        if (versionId == 'v1') {
          return activeCompleter.future;
        }
        return [
          SmartChord(
            id: 'sc-$versionId',
            userId: 'u',
            songId: songId,
            versionId: versionId,
            title: 'Chord $versionId',
            originalKey: 'D',
            content: '[$versionId]Test',
            createdAt: '',
            updatedAt: '',
          ),
        ];
      });

      final notifier = SongSmartChordsNotifier(
        repository: repository,
        linkRepository: linkRepo,
      );

      final loadV1Future = notifier.load(
        'song-1',
        ministryId: 'min-1',
        versionId: 'v1',
      );

      // Both active and pending must have been dispatched concurrently before either completes
      expect(calls, containsAll([('v1', null), (null, 'pending_classification')]));

      activeCompleter.complete([
        const SmartChord(
          id: 'sc-v1',
          userId: 'u',
          songId: 'song-1',
          versionId: 'v1',
          title: 'Chord v1',
          originalKey: 'C',
          content: '[C]Test',
          createdAt: '',
          updatedAt: '',
        ),
      ]);
      pendingCompleter.complete([
        const SmartChord(
          id: 'sc-pend',
          userId: 'u',
          songId: 'song-1',
          title: 'Pending',
          originalKey: 'G',
          content: '',
          createdAt: '',
          updatedAt: '',
          repertoireLink: SmartChordSongLink(
            id: 'l-p',
            userId: 'u',
            smartChordId: 'sc-pend',
            ministryId: 'min-1',
            songId: 'song-1',
            linkStatus: 'pending_classification',
          ),
        ),
      ]);
      await loadV1Future;
      expect(notifier.state.items.map((c) => c.id), ['sc-v1']);
      expect(notifier.state.pendingItems.map((c) => c.id), ['sc-pend']);

      // Switch to v2: pending already cached for (min-1, song-1), so only v2 is requested
      calls.clear();
      await notifier.load('song-1', ministryId: 'min-1', versionId: 'v2');
      expect(calls, [('v2', null)]);
      expect(notifier.state.items.map((c) => c.id), ['sc-v2']);
      expect(notifier.state.pendingItems.map((c) => c.id), ['sc-pend']);

      // Switch back to v1: 100% cache hit -> ZERO network calls!
      calls.clear();
      await notifier.load('song-1', ministryId: 'min-1', versionId: 'v1');
      expect(calls, isEmpty);
      expect(notifier.state.items.map((c) => c.id), ['sc-v1']);
      expect(notifier.state.isLoading, isFalse);

      // Different ministry never reuses min-1 cache and member (includePending: false) skips pending call
      calls.clear();
      await notifier.load(
        'song-1',
        ministryId: 'min-2',
        versionId: 'v1',
        includePending: false,
      );
      expect(calls, [('v1', null)]);

      // Reset clears all caches
      notifier.reset();
      calls.clear();
      await notifier.load(
        'song-1',
        ministryId: 'min-1',
        versionId: 'v1',
        includePending: false,
      );
      expect(calls, [('v1', null)]);
    });

    test(
        'prefetchVersions runs in parallel, deduplicates in-flight loads, and resolveSongVersions partitions unscoped backend chords',
        () async {
      final v2Completer = Completer<List<SmartChord>>();
      final calls = <(String?, String?)>[];

      final linkRepo = _CallbackLinkRepository((
        ministryId,
        songId,
        versionId,
        linkStatus,
      ) async {
        calls.add((versionId, linkStatus));
        if (songId == 'song-unscoped' && versionId == null) {
          return const [
            SmartChord(
              id: 'sc-u-v1',
              userId: 'u',
              songId: 'song-unscoped',
              title: 'U V1',
              originalKey: 'C',
              content: '[C]A',
              createdAt: '',
              updatedAt: '',
              repertoireLink: SmartChordSongLink(
                id: 'lu1',
                userId: 'u',
                smartChordId: 'sc-u-v1',
                ministryId: 'min-1',
                songId: 'song-unscoped',
                versionId: 'v1',
                linkStatus: 'active',
              ),
            ),
            SmartChord(
              id: 'sc-u-v2',
              userId: 'u',
              songId: 'song-unscoped',
              title: 'U V2',
              originalKey: 'D',
              content: '[D]B',
              createdAt: '',
              updatedAt: '',
              repertoireLink: SmartChordSongLink(
                id: 'lu2',
                userId: 'u',
                smartChordId: 'sc-u-v2',
                ministryId: 'min-1',
                songId: 'song-unscoped',
                versionId: 'v2',
                linkStatus: 'active',
              ),
            ),
          ];
        }
        if (versionId == 'v2') {
          return v2Completer.future;
        }
        return [
          SmartChord(
            id: 'sc-$versionId',
            userId: 'u',
            songId: songId,
            versionId: versionId,
            title: 'Chord $versionId',
            originalKey: 'E',
            content: '[E]C',
            createdAt: '',
            updatedAt: '',
          ),
        ];
      });

      final notifier = SongSmartChordsNotifier(
        repository: repository,
        linkRepository: linkRepo,
      );

      // Unscoped load + resolveSongVersions partitions all versions in 1 call
      await notifier.load(
        'song-unscoped',
        ministryId: 'min-1',
        includePending: false,
      );
      await notifier.resolveSongVersions(
        songId: 'song-unscoped',
        ministryId: 'min-1',
        activeVersionId: 'v1',
        versionIds: const ['v1', 'v2', 'v3'],
        includePending: false,
      );
      expect(notifier.state.versionId, 'v1');
      expect(notifier.state.items.map((c) => c.id), ['sc-u-v1']);
      expect(
        calls.where((c) => c.$1 == 'v1' || c.$1 == 'v2' || c.$1 == 'v3'),
        isEmpty,
      );

      calls.clear();
      await notifier.load(
        'song-unscoped',
        ministryId: 'min-1',
        versionId: 'v2',
        includePending: false,
      );
      expect(notifier.state.items.map((c) => c.id), ['sc-u-v2']);
      await notifier.load(
        'song-unscoped',
        ministryId: 'min-1',
        versionId: 'v3',
        includePending: false,
      );
      expect(notifier.state.items, isEmpty);
      expect(calls, isEmpty);

      // In-flight deduplication: prefetch starts v2; load joins same Future instead of calling twice
      calls.clear();
      final prefetchFuture = notifier.prefetchVersions(
        songId: 'song-dedup',
        ministryId: 'min-1',
        versionIds: const ['v2'],
      );
      final loadFuture = notifier.load(
        'song-dedup',
        ministryId: 'min-1',
        versionId: 'v2',
        includePending: false,
      );
      expect(calls, [('v2', null)]);
      v2Completer.complete(const [
        SmartChord(
          id: 'sc-v2-dedup',
          userId: 'u',
          songId: 'song-dedup',
          versionId: 'v2',
          title: 'Dedup V2',
          originalKey: 'D',
          content: '[D]Hi',
          createdAt: '',
          updatedAt: '',
        ),
      ]);
      await Future.wait([prefetchFuture, loadFuture]);
      expect(notifier.state.items.map((c) => c.id), ['sc-v2-dedup']);
      expect(calls, [('v2', null)]);
    });
  });

  group('SmartChordDetailNotifier', () {
    test('load fetches chord details and resets semitones to 0', () async {
      repository.detailToReturn = const SmartChord(
        id: 'sc-10',
        userId: 'u',
        title: 'Vitorioso',
        originalKey: 'G',
        content: '[G]Vitorioso...',
        createdAt: '',
        updatedAt: '',
      );

      final notifier = SmartChordDetailNotifier(repository: repository);
      await notifier.load('sc-10');

      expect(notifier.state.chord?.title, 'Vitorioso');
      expect(notifier.state.semitones, 0);
      expect(notifier.state.isNotFound, isFalse);
    });

    test('load sets isNotFound on 404 AppFailure', () async {
      repository.errorToThrow = const AppFailure(message: 'Não encontrada.', statusCode: 404);

      final notifier = SmartChordDetailNotifier(repository: repository);
      await notifier.load('missing-id');

      expect(notifier.state.isNotFound, isTrue);
      expect(notifier.state.hasError, isTrue);
    });

    test('transposeBy adjusts semitones within -11..+11 range', () {
      final notifier = SmartChordDetailNotifier(repository: repository);
      expect(notifier.state.semitones, 0);

      notifier.transposeBy(2);
      expect(notifier.state.semitones, 2);

      notifier.transposeBy(-5);
      expect(notifier.state.semitones, -3);

      notifier.setSemitones(15); // Exceeds upper clamp
      expect(notifier.state.semitones, 11);

      notifier.setSemitones(-20); // Exceeds lower clamp
      expect(notifier.state.semitones, -11);

      notifier.resetTransposition();
      expect(notifier.state.semitones, 0);
    });
  });

  group('SmartChordFormNotifier', () {
    test('createSmartChord calls repository and sets isSuccess', () async {
      final notifier = SmartChordFormNotifier(repository: repository);
      const chord = SmartChord(
        id: '',
        userId: '',
        title: 'Nova Cifra',
        originalKey: 'A',
        content: '[A]Texto',
        createdAt: '',
        updatedAt: '',
      );

      final result = await notifier.createSmartChord(chord);

      expect(result.isSuccess, isTrue);
      expect(result.data, isNotNull);
      expect(result.data!.id, 'sc-created');
      expect(notifier.state.isSuccess, isTrue);
      expect(repository.createCallCount, 1);
    });

    test('guards against double-submit on create', () async {
      repository.createCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(repository: repository);
      const chord = SmartChord(
        id: '',
        userId: '',
        title: 'Nova Cifra',
        originalKey: 'A',
        content: '[A]Texto',
        createdAt: '',
        updatedAt: '',
      );

      final firstCall = notifier.createSmartChord(chord);
      expect(notifier.state.isSubmitting, isTrue);

      final secondCall = await notifier.createSmartChord(chord);
      expect(secondCall.isDiscarded, isTrue); // Second call discarded immediately
      expect(repository.createCallCount, 1);

      repository.createCompleter!.complete();
      final result1 = await firstCall;
      expect(result1.isSuccess, isTrue);
      expect(result1.data, isNotNull);
    });

    test('updateSmartChord calls repository', () async {
      final notifier = SmartChordFormNotifier(repository: repository);
      const chord = SmartChord(
        id: 'sc-1',
        userId: 'u',
        title: 'Cifra Editada',
        originalKey: 'B',
        content: '[B]Texto',
        createdAt: '',
        updatedAt: '',
      );

      final updated = await notifier.updateSmartChord('sc-1', chord);

      expect(updated.isSuccess, isTrue);
      expect(updated.data, isNotNull);
      expect(updated.data!.id, 'sc-1');
      expect(repository.updateCallCount, 1);
    });

    test('deleteSmartChord calls repository and returns success', () async {
      final notifier = SmartChordFormNotifier(repository: repository);
      final result = await notifier.deleteSmartChord('sc-1');

      expect(result.isSuccess, isTrue);
      expect(repository.deleteCallCount, 1);
    });

    test('records errorMessage when repository throws', () async {
      repository.errorToThrow = const AppFailure(message: 'Erro ao salvar cifra.', statusCode: 400);
      final notifier = SmartChordFormNotifier(repository: repository);

      final result = await notifier.createSmartChord(const SmartChord(
        id: '',
        userId: '',
        title: 'X',
        originalKey: 'C',
        content: '',
        createdAt: '',
        updatedAt: '',
      ));

      expect(result.isFailure, isTrue);
      expect(result.outcome, MutationOutcome.failure);
      expect(result.errorMessage, 'Erro ao salvar cifra.');
      expect(notifier.state.errorMessage, 'Erro ao salvar cifra.');
      expect(notifier.state.isSubmitting, isFalse);
    });

    // R2-9: Session reset tests with pending Completers
    test('create success: in-flight request resolves after reset -> outcome is discarded, no state leak', () async {
      repository.createCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(
        repository: repository,
        boundUserId: 'user-a',
      );
      const chord = SmartChord(
        id: '',
        userId: 'user-a',
        title: 'Minha Cifra Secreta',
        originalKey: 'D',
        content: '[D]Letra Secreta',
        createdAt: '',
        updatedAt: '',
      );

      final pendingCreate = notifier.createSmartChord(chord, userId: 'user-a');
      expect(notifier.state.isSubmitting, isTrue);

      // Session reset / logout occurs while request is in flight: User B logs in
      notifier.reset(newUserId: 'user-b');
      expect(notifier.state.isSubmitting, isFalse);
      expect(notifier.state.isSuccess, isFalse);

      // User A request finally arrives
      repository.createCompleter!.complete();
      final outcome = await pendingCreate;

      expect(outcome.isDiscarded, isTrue);
      expect(outcome.outcome, MutationOutcome.discarded);
      expect(outcome.data, isNull);
      expect(notifier.state.isSuccess, isFalse);
      expect(notifier.state.errorMessage, isNull);
    });

    test('create error: in-flight request fails after reset -> outcome is discarded, no User-B error leak', () async {
      repository.createCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(
        repository: repository,
        boundUserId: 'user-a',
      );
      const chord = SmartChord(
        id: '',
        userId: 'user-a',
        title: 'Cifra Com Falha',
        originalKey: 'E',
        content: '[E]Letra',
        createdAt: '',
        updatedAt: '',
      );

      final pendingCreate = notifier.createSmartChord(chord, userId: 'user-a');

      // Logout / reset occurs
      notifier.reset(newUserId: 'user-b');

      // Request fails on backend
      repository.errorToThrow = const AppFailure(message: 'Erro no backend User A', statusCode: 500);
      repository.createCompleter!.complete();
      final outcome = await pendingCreate;

      expect(outcome.isDiscarded, isTrue);
      expect(outcome.outcome, MutationOutcome.discarded);
      expect(notifier.state.errorMessage, isNull);
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('update success: in-flight request resolves after reset -> outcome is discarded', () async {
      repository.updateCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(
        repository: repository,
        boundUserId: 'user-a',
      );
      const chord = SmartChord(
        id: 'sc-1',
        userId: 'user-a',
        title: 'Cifra Atualizada',
        originalKey: 'F',
        content: '[F]Letra',
        createdAt: '',
        updatedAt: '',
      );

      final pendingUpdate = notifier.updateSmartChord('sc-1', chord, userId: 'user-a');
      notifier.reset(newUserId: 'user-b');

      repository.updateCompleter!.complete();
      final outcome = await pendingUpdate;

      expect(outcome.isDiscarded, isTrue);
      expect(outcome.outcome, MutationOutcome.discarded);
      expect(notifier.state.isSuccess, isFalse);
      expect(notifier.state.errorMessage, isNull);
    });

    test('update error: in-flight request fails after reset -> outcome is discarded', () async {
      repository.updateCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(
        repository: repository,
        boundUserId: 'user-a',
      );
      const chord = SmartChord(
        id: 'sc-1',
        userId: 'user-a',
        title: 'Cifra Atualizada',
        originalKey: 'F',
        content: '[F]Letra',
        createdAt: '',
        updatedAt: '',
      );

      final pendingUpdate = notifier.updateSmartChord('sc-1', chord, userId: 'user-a');
      notifier.reset(newUserId: 'user-b');

      repository.errorToThrow = const AppFailure(message: 'Erro de rede', statusCode: 500);
      repository.updateCompleter!.complete();
      final outcome = await pendingUpdate;

      expect(outcome.isDiscarded, isTrue);
      expect(outcome.outcome, MutationOutcome.discarded);
      expect(notifier.state.errorMessage, isNull);
    });

    test('delete success: in-flight request resolves after reset -> outcome is discarded', () async {
      repository.deleteCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(
        repository: repository,
        boundUserId: 'user-a',
      );

      final pendingDelete = notifier.deleteSmartChord('sc-1', userId: 'user-a');
      notifier.reset(newUserId: 'user-b');

      repository.deleteCompleter!.complete();
      final outcome = await pendingDelete;

      expect(outcome.isDiscarded, isTrue);
      expect(outcome.outcome, MutationOutcome.discarded);
      expect(notifier.state.isSuccess, isFalse);
      expect(notifier.state.errorMessage, isNull);
    });

    test('delete error: in-flight request fails after reset -> outcome is discarded', () async {
      repository.deleteCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(
        repository: repository,
        boundUserId: 'user-a',
      );

      final pendingDelete = notifier.deleteSmartChord('sc-1', userId: 'user-a');
      notifier.reset(newUserId: 'user-b');

      repository.errorToThrow = const AppFailure(message: 'Falha ao deletar', statusCode: 500);
      repository.deleteCompleter!.complete();
      final outcome = await pendingDelete;

      expect(outcome.isDiscarded, isTrue);
      expect(outcome.outcome, MutationOutcome.discarded);
      expect(notifier.state.errorMessage, isNull);
    });
  });
}
