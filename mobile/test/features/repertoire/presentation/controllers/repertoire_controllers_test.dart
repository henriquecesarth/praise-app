import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_list_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/song_detail_controller.dart';

class MockRepertoireRepository extends Mock implements RepertoireRepository {}

void main() {
  late MockRepertoireRepository mockRepo;

  setUp(() {
    mockRepo = MockRepertoireRepository();
  });

  SongSummary makeSong(String id, String title) {
    return SongSummary(
      id: id,
      ministryId: 'min-1',
      title: title,
      artistName: 'Artista Teste',
      originalKey: 'C',
    );
  }

  group('RepertoireListNotifier', () {
    test(
        'loadForMinistry clears state immediately and populates songs on success',
        () async {
      final notifier = RepertoireListNotifier(repository: mockRepo);
      final songs = [makeSong('s1', 'Música 1'), makeSong('s2', 'Música 2')];

      when(() => mockRepo.listClassifications('min-1'))
          .thenAnswer((_) async => [
                const Classification(
                  id: 'c1',
                  ministryId: 'min-1',
                  name: 'Adoração',
                ),
              ]);

      when(() => mockRepo.listSongs(
            'min-1',
            search: any(named: 'search'),
            classificationId: any(named: 'classificationId'),
            cursor: any(named: 'cursor'),
            page: any(named: 'page'),
            limit: any(named: 'limit'),
          )).thenAnswer(
        (_) async => PaginatedSongs(
          songs: songs,
          total: 2,
          hasMore: false,
        ),
      );

      await notifier.loadForMinistry('min-1');

      expect(notifier.state.ministryId, equals('min-1'));
      expect(notifier.state.songs.length, equals(2));
      expect(notifier.state.total, equals(2));
      expect(notifier.state.hasMore, isFalse);
      expect(notifier.state.availableClassifications.length, equals(1));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    test(
        'loadForMinistry ignores stale response if ministry switched mid-request',
        () async {
      final notifier = RepertoireListNotifier(repository: mockRepo);

      when(() => mockRepo.listClassifications(any()))
          .thenAnswer((_) async => []);

      when(() => mockRepo.listSongs('min-1', page: 1)).thenAnswer((_) async {
        // Switch ministry before response arrives
        notifier.loadForMinistry('min-2');
        return PaginatedSongs(
          songs: [makeSong('s-stale', 'Música Stale')],
          total: 1,
        );
      });

      when(() => mockRepo.listSongs('min-2', page: 1)).thenAnswer((_) async {
        return PaginatedSongs(
          songs: [makeSong('s-fresh', 'Música Fresh')],
          total: 1,
        );
      });

      await notifier.loadForMinistry('min-1');

      // State must reflect only min-2
      expect(notifier.state.ministryId, equals('min-2'));
      expect(notifier.state.songs.first.title, equals('Música Fresh'));
    });

    test('loadMore appends songs and deduplicates by ID', () async {
      final notifier = RepertoireListNotifier(repository: mockRepo);
      final initialSongs = [
        makeSong('s1', 'Música 1'),
        makeSong('s2', 'Música 2')
      ];

      when(() => mockRepo.listClassifications('min-1'))
          .thenAnswer((_) async => []);
      when(() => mockRepo.listSongs('min-1', page: 1)).thenAnswer(
        (_) async => PaginatedSongs(
          songs: initialSongs,
          total: 3,
          hasMore: true,
          nextCursor: 'cursor-1',
        ),
      );

      await notifier.loadForMinistry('min-1');
      expect(notifier.state.songs.length, equals(2));
      expect(notifier.state.hasMore, isTrue);

      // Page 2 contains 's2' (duplicate) and 's3' (fresh)
      when(() => mockRepo.listSongs(
            'min-1',
            cursor: 'cursor-1',
            page: 2,
          )).thenAnswer(
        (_) async => PaginatedSongs(
          songs: [makeSong('s2', 'Música 2'), makeSong('s3', 'Música 3')],
          total: 3,
          hasMore: false,
          nextCursor: null,
        ),
      );

      await notifier.loadMore();

      expect(notifier.state.songs.length, equals(3));
      expect(notifier.state.songs.map((s) => s.id).toList(),
          equals(['s1', 's2', 's3']));
      expect(notifier.state.hasMore, isFalse);
    });

    test('clearSearch clears query and reloads initial list', () async {
      final notifier = RepertoireListNotifier(repository: mockRepo);

      when(() => mockRepo.listClassifications('min-1'))
          .thenAnswer((_) async => []);
      when(() => mockRepo.listSongs('min-1', page: 1)).thenAnswer(
        (_) async =>
            PaginatedSongs(songs: [makeSong('s1', 'Normal')], total: 1),
      );

      await notifier.loadForMinistry('min-1');

      when(() => mockRepo.listSongs('min-1', search: null, page: 1)).thenAnswer(
        (_) async =>
            PaginatedSongs(songs: [makeSong('s1', 'Normal')], total: 1),
      );

      notifier.clearSearch();

      expect(notifier.state.searchQuery, equals(''));
    });

    test('setClassificationFilter toggles filter on and off', () async {
      final notifier = RepertoireListNotifier(repository: mockRepo);

      when(() => mockRepo.listClassifications('min-1'))
          .thenAnswer((_) async => []);
      when(() => mockRepo.listSongs('min-1', page: 1)).thenAnswer(
        (_) async => const PaginatedSongs(songs: [], total: 0),
      );
      when(() => mockRepo.listSongs('min-1', classificationId: 'c1', page: 1))
          .thenAnswer(
        (_) async => const PaginatedSongs(songs: [], total: 0),
      );

      await notifier.loadForMinistry('min-1');

      notifier.setClassificationFilter('c1');
      expect(notifier.state.selectedClassificationId, equals('c1'));

      // Toggling same filter clears it
      notifier.setClassificationFilter('c1');
      expect(notifier.state.selectedClassificationId, isNull);
    });

    test('refresh preserves existing items while fetching', () async {
      final notifier = RepertoireListNotifier(repository: mockRepo);
      final initial = [makeSong('s1', 'Música 1')];

      when(() => mockRepo.listClassifications('min-1'))
          .thenAnswer((_) async => []);
      when(() => mockRepo.listSongs('min-1', page: 1)).thenAnswer(
        (_) async => PaginatedSongs(songs: initial, total: 1),
      );

      await notifier.loadForMinistry('min-1');

      final fresh = [
        makeSong('s1', 'Música 1 (Updated)'),
        makeSong('s2', 'Música 2')
      ];
      when(() => mockRepo.listSongs('min-1', page: 1)).thenAnswer(
        (_) async => PaginatedSongs(songs: fresh, total: 2),
      );

      final refreshFuture = notifier.refresh();
      expect(notifier.state.isRefreshing, isTrue);
      expect(notifier.state.songs, equals(initial)); // Preserved!

      await refreshFuture;
      expect(notifier.state.isRefreshing, isFalse);
      expect(notifier.state.songs.length, equals(2));
    });
  });

  group('SongDetailNotifier', () {
    test('load fetches song detail and stores on success', () async {
      final notifier = SongDetailNotifier(repository: mockRepo);
      const detail = SongDetail(
        id: 's-42',
        ministryId: 'min-1',
        title: 'Música 42',
        lyrics: 'Letra bonita...',
      );

      when(() => mockRepo.getSongDetail('min-1', 's-42'))
          .thenAnswer((_) async => detail);

      await notifier.load('min-1', 's-42');

      expect(notifier.state.song?.id, equals('s-42'));
      expect(notifier.state.song?.title, equals('Música 42'));
      expect(notifier.state.song?.lyrics, equals('Letra bonita...'));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    test('load ignores stale detail response if ministry or songId changed',
        () async {
      final notifier = SongDetailNotifier(repository: mockRepo);

      when(() => mockRepo.getSongDetail('min-1', 's-1')).thenAnswer((_) async {
        notifier.load('min-2', 's-2');
        return const SongDetail(id: 's-1', ministryId: 'min-1', title: 'Stale');
      });

      when(() => mockRepo.getSongDetail('min-2', 's-2')).thenAnswer((_) async {
        return const SongDetail(id: 's-2', ministryId: 'min-2', title: 'Fresh');
      });

      await notifier.load('min-1', 's-1');

      expect(notifier.state.ministryId, equals('min-2'));
      expect(notifier.state.songId, equals('s-2'));
      expect(notifier.state.song?.title, equals('Fresh'));
    });

    test('load maps AppFailure to error state', () async {
      final notifier = SongDetailNotifier(repository: mockRepo);

      when(() => mockRepo.getSongDetail('min-1', 's-missing')).thenThrow(
        const AppFailure(message: 'Música não encontrada.', statusCode: 404),
      );

      await notifier.load('min-1', 's-missing');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, equals('Música não encontrada.'));
      expect(notifier.state.song, isNull);
    });
  });
}
