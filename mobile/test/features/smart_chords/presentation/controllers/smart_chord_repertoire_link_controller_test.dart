import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_repertoire_link_controller.dart';

class FakeSmartChordRepertoireLinkRepository
    implements SmartChordRepertoireLinkRepository {
  SmartChordRepertoireLink? linkToReturn;
  Exception? errorToThrow;
  Completer<void>? loadCompleter;
  Completer<void>? setLinkCompleter;
  Completer<void>? removeLinkCompleter;
  int getLinkCallCount = 0;
  int setLinkCallCount = 0;
  int removeLinkCallCount = 0;
  int getBySongCallCount = 0;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    getLinkCallCount++;
    if (loadCompleter != null) await loadCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return linkToReturn ?? const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async {
    setLinkCallCount++;
    if (setLinkCompleter != null) await setLinkCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return SmartChordRepertoireLink(
      link: SmartChordSongLink(
        id: "u-1_${chordId}_$ministryId",
        smartChordId: chordId,
        ministryId: ministryId,
        songId: songId,
        userId: "u-1",
      ),
      song: SmartChordSongSummary(
        id: songId,
        title: "Song $songId",
      ),
    );
  }

  @override
  Future<SmartChordRepertoireLink> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    removeLinkCallCount++;
    if (removeLinkCompleter != null) await removeLinkCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async {
    getBySongCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return [];
  }
}

void main() {
  late FakeSmartChordRepertoireLinkRepository repository;
  late SmartChordRepertoireLinkNotifier notifier;

  setUp(() {
    repository = FakeSmartChordRepertoireLinkRepository();
    notifier = SmartChordRepertoireLinkNotifier(repository: repository);
  });

  group('SmartChordRepertoireLinkNotifier', () {
    test('load fetches link and updates state', () async {
      repository.linkToReturn = const SmartChordRepertoireLink(
        link: SmartChordSongLink(
          id: 'u-1_sc-1_min-1',
          smartChordId: 'sc-1',
          ministryId: 'min-1',
          songId: 'song-1',
          userId: 'u-1',
        ),
        song: SmartChordSongSummary(
          id: 'song-1',
          title: 'Oceanos',
          artistName: 'Hillsong',
        ),
      );

      await notifier.load(ministryId: 'min-1', chordId: 'sc-1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isLinked, isTrue);
      expect(notifier.state.link!.song!.title, equals('Oceanos'));
      expect(repository.getLinkCallCount, equals(1));
    });

    test('load deduplication avoids redundant fetch', () async {
      repository.linkToReturn = const SmartChordRepertoireLink.unlinked();

      await notifier.load(ministryId: 'min-1', chordId: 'sc-1');
      expect(repository.getLinkCallCount, equals(1));

      // Second load with same params should be a no-op when not forced
      await notifier.load(ministryId: 'min-1', chordId: 'sc-1');
      expect(repository.getLinkCallCount, equals(1));

      // With force: true it fetches again
      await notifier.load(ministryId: 'min-1', chordId: 'sc-1', force: true);
      expect(repository.getLinkCallCount, equals(2));
    });

    test('load error records error message', () async {
      repository.errorToThrow = const AppFailure(
        message: 'Falha ao buscar vínculo.',
        statusCode: 500,
      );

      await notifier.load(ministryId: 'min-1', chordId: 'sc-1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.hasError, isTrue);
      expect(notifier.state.errorMessage, equals('Falha ao buscar vínculo.'));
    });

    test('load race condition: in-flight response from older generation is discarded', () async {
      repository.loadCompleter = Completer<void>();

      final pendingLoad = notifier.load(ministryId: 'min-1', chordId: 'sc-1');
      expect(notifier.state.isLoading, isTrue);

      // User resets or switches ministry
      notifier.reset();
      expect(notifier.state.isLoading, isFalse);

      repository.linkToReturn = const SmartChordRepertoireLink(
        link: SmartChordSongLink(
          id: 'u-1_sc-1_min-1',
          smartChordId: 'sc-1',
          ministryId: 'min-1',
          songId: 'song-1',
          userId: 'u-1',
        ),
        song: SmartChordSongSummary(id: 'song-1', title: 'Old Song'),
      );
      repository.loadCompleter!.complete();
      await pendingLoad;

      expect(notifier.state.link, isNull);
      expect(notifier.state.chordId, isNull);
    });

    test('setLink success calls repo and sets link in state', () async {
      final success = await notifier.setLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
        songId: 'song-2',
      );

      expect(success, isTrue);
      expect(notifier.state.isLinked, isTrue);
      expect(notifier.state.link!.song!.title, equals('Song song-2'));
      expect(repository.setLinkCallCount, equals(1));
    });

    test('setLink failure returns false and sets errorMessage', () async {
      repository.errorToThrow = const AppFailure(
        message: 'Acesso negado',
        statusCode: 403,
      );

      final success = await notifier.setLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
        songId: 'song-2',
      );

      expect(success, isFalse);
      expect(notifier.state.hasError, isTrue);
      expect(notifier.state.errorMessage, equals('Acesso negado'));
    });

    test('unlink success sets unlinked state', () async {
      notifier.state = notifier.state.copyWith(
        link: const SmartChordRepertoireLink(
          link: SmartChordSongLink(
            id: 'x',
            smartChordId: 'sc-1',
            ministryId: 'min-1',
            songId: 'song-1',
            userId: 'u',
          ),
          song: SmartChordSongSummary(id: 'song-1', title: 'Song 1'),
        ),
      );
      expect(notifier.state.isLinked, isTrue);

      final success = await notifier.unlink(
        ministryId: 'min-1',
        chordId: 'sc-1',
      );

      expect(success, isTrue);
      expect(notifier.state.isLinked, isFalse);
      expect(repository.removeLinkCallCount, equals(1));
    });

    test('reset clears state and increments generation', () {
      notifier.state = notifier.state.copyWith(
        chordId: 'sc-1',
        ministryId: 'min-1',
        errorMessage: 'Err',
      );

      notifier.reset();

      expect(notifier.state.chordId, isNull);
      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.errorMessage, isNull);
    });

    test('LINK_MUTATION_RACE_GUARD: parallel setLink is rejected while isSaving', () async {
      repository.setLinkCompleter = Completer<void>();

      final firstCall = notifier.setLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
        songId: 'song-1',
      );
      expect(notifier.state.isSaving, isTrue);

      // Attempt second parallel setLink while first is in-flight
      final secondCallResult = await notifier.setLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
        songId: 'song-2',
      );
      expect(secondCallResult, isFalse);
      expect(repository.setLinkCallCount, equals(1));

      // Complete first in-flight operation
      repository.setLinkCompleter!.complete();
      final firstCallResult = await firstCall;
      expect(firstCallResult, isTrue);
      expect(notifier.state.isSaving, isFalse);
      expect(repository.setLinkCallCount, equals(1));
    });

    test('LINK_MUTATION_RACE_GUARD: parallel unlink is rejected while isSaving', () async {
      repository.removeLinkCompleter = Completer<void>();

      final firstCall = notifier.unlink(
        ministryId: 'min-1',
        chordId: 'sc-1',
      );
      expect(notifier.state.isSaving, isTrue);

      // Attempt second parallel unlink while first is in-flight
      final secondCallResult = await notifier.unlink(
        ministryId: 'min-1',
        chordId: 'sc-1',
      );
      expect(secondCallResult, isFalse);
      expect(repository.removeLinkCallCount, equals(1));

      // Complete first in-flight operation
      repository.removeLinkCompleter!.complete();
      final firstCallResult = await firstCall;
      expect(firstCallResult, isTrue);
      expect(notifier.state.isSaving, isFalse);
      expect(repository.removeLinkCallCount, equals(1));
    });
  });
}
