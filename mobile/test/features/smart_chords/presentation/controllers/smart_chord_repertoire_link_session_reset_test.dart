import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_providers.dart';

class _FakeLinkRepository implements SmartChordRepertoireLinkRepository {
  Completer<SmartChordRepertoireLink>? loadCompleter;
  SmartChordRepertoireLink? linkToReturn;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    if (loadCompleter != null) return loadCompleter!.future;
    return linkToReturn ?? const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async => throw UnimplementedError();

  @override
  Future<SmartChordRepertoireLink> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async => throw UnimplementedError();

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async => [];
}

void main() {
  group('SmartChordRepertoireLink Session Isolation & Reset', () {
    late _FakeLinkRepository fakeRepo;
    late ProviderContainer container;

    setUp(() {
      fakeRepo = _FakeLinkRepository();
      container = ProviderContainer(
        overrides: [
          smartChordRepertoireLinkRepositoryProvider.overrideWithValue(fakeRepo),
        ],
      );
    });

    tearDown(() {
      container.dispose();
    });

    test('AUTH_RESET_LINK_STATE_TEST: resetAuthenticatedFeatures resets link notifier state to pristine', () async {
      fakeRepo.linkToReturn = const SmartChordRepertoireLink(
        link: SmartChordSongLink(
          id: 'userA_chord1_min1',
          smartChordId: 'chord-1',
          ministryId: 'min-1',
          songId: 'song-1',
          userId: 'user-a',
        ),
        song: SmartChordSongSummary(id: 'song-1', title: 'User A Song'),
      );

      // User A loads chord
      await container.read(smartChordRepertoireLinkNotifierProvider.notifier).load(
        ministryId: 'min-1',
        chordId: 'chord-1',
      );

      final userAState = container.read(smartChordRepertoireLinkNotifierProvider);
      expect(userAState.isLinked, isTrue);
      expect(userAState.link!.song!.title, equals('User A Song'));
      expect(userAState.chordId, equals('chord-1'));

      // User A logs out -> triggers resetAuthenticatedFeatures
      resetAuthenticatedFeatures(container);

      // Verify link notifier state was wiped to clean default
      final resetState = container.read(smartChordRepertoireLinkNotifierProvider);
      expect(resetState.isLinked, isFalse);
      expect(resetState.link, isNull);
      expect(resetState.chordId, isNull);
      expect(resetState.ministryId, isNull);
      expect(resetState.isLoading, isFalse);
      expect(resetState.hasError, isFalse);
    });

    test('LATE_RESPONSE_AFTER_LOGOUT_TEST: in-flight User A response completing after logout is discarded for User B', () async {
      fakeRepo.loadCompleter = Completer<SmartChordRepertoireLink>();

      // 1. User A starts link load
      final userAPendingLoad = container
          .read(smartChordRepertoireLinkNotifierProvider.notifier)
          .load(ministryId: 'min-1', chordId: 'chord-user-a');

      expect(container.read(smartChordRepertoireLinkNotifierProvider).isLoading, isTrue);

      // 2. User A logs out -> triggers resetAuthenticatedFeatures
      resetAuthenticatedFeatures(container);

      // 3. User B session begins / clean provider container read
      final userBInitialState = container.read(smartChordRepertoireLinkNotifierProvider);
      expect(userBInitialState.isLinked, isFalse);
      expect(userBInitialState.chordId, isNull);

      // 4. User A async response completes late
      fakeRepo.loadCompleter!.complete(
        const SmartChordRepertoireLink(
          link: SmartChordSongLink(
            id: 'userA_chord1_min1',
            smartChordId: 'chord-user-a',
            ministryId: 'min-1',
            songId: 'song-secret',
            userId: 'user-a',
          ),
          song: SmartChordSongSummary(id: 'song-secret', title: 'Secret User A Song'),
        ),
      );
      await userAPendingLoad;

      // 5. User B sees only clean/default link state, never User A state
      final userBFinalState = container.read(smartChordRepertoireLinkNotifierProvider);
      expect(userBFinalState.isLinked, isFalse);
      expect(userBFinalState.link, isNull);
      expect(userBFinalState.chordId, isNull);
      expect(userBFinalState.errorMessage, isNull);
    });
  });
}
