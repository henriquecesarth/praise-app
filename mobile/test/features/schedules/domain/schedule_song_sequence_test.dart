import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_song_sequence.dart';

void main() {
  group('ScheduleSongSequenceContext', () {
    test('returns empty context when songs list is empty or has only blank ids',
        () {
      final empty = ScheduleSongSequenceContext.fromScheduleSongs(
        ministryId: 'min_1',
        scheduleId: 'sch_1',
        songs: const [],
      );
      expect(empty.isEmpty, isTrue);
      expect(empty.isNotEmpty, isFalse);
      expect(empty.positionLabel, isEmpty);
      expect(empty.currentItem, isNull);
      expect(empty.hasPrevious, isFalse);
      expect(empty.hasNext, isFalse);
      expect(empty.movePrevious(), isNull);
      expect(empty.moveNext(), isNull);

      final blankOnly = ScheduleSongSequenceContext.fromScheduleSongs(
        ministryId: 'min_1',
        scheduleId: 'sch_1',
        songs: const [
          ScheduleSong(id: '  ', title: 'Ignorada'),
        ],
      );
      expect(blankOnly.isEmpty, isTrue);
    });

    test(
        'preserves saved order, repeated songs with distinct versions, fallback titles, and initial slot index',
        () {
      final context = ScheduleSongSequenceContext.fromScheduleSongs(
        ministryId: 'min_1',
        scheduleId: 'sch_1',
        songs: const [
          ScheduleSong(
            id: 'song_1',
            title: 'Bondade de Deus',
            versionId: 'v1',
            versionName: 'Original',
            key: 'G',
          ),
          ScheduleSong(id: '', title: 'Slot Inválido'),
          ScheduleSong(
            id: 'song_2',
            title: '   ',
            versionId: null,
            key: 'C',
          ),
          ScheduleSong(
            id: 'song_1',
            title: 'Bondade de Deus',
            versionId: 'v2',
            versionName: 'Acústica',
            key: 'A',
          ),
        ],
        initialScheduleSlotIndex: 3,
      );

      expect(context.isEmpty, isFalse);
      expect(context.items, hasLength(3));
      expect(context.items[0].scheduleSlotIndex, equals(0));
      expect(context.items[0].songId, equals('song_1'));
      expect(context.items[0].versionId, equals('v1'));

      // Fallback title keeps saved schedule slot number (i + 1)
      expect(context.items[1].scheduleSlotIndex, equals(2));
      expect(context.items[1].songId, equals('song_2'));
      expect(context.items[1].title, equals('Música 3'));

      expect(context.items[2].scheduleSlotIndex, equals(3));
      expect(context.items[2].songId, equals('song_1'));
      expect(context.items[2].versionId, equals('v2'));
      expect(context.items[2].versionName, equals('Acústica'));
      expect(context.items[2].key, equals('A'));

      expect(context.currentIndex, equals(2));
      expect(context.positionLabel, equals('3 de 3'));
      expect(context.hasPrevious, isTrue);
      expect(context.hasNext, isFalse);
      expect(context.moveNext(), isNull);
    });

    test('navigates cleanly across items and clamps out-of-range indices', () {
      final first = ScheduleSongSequenceContext.fromScheduleSongs(
        ministryId: 'min_1',
        scheduleId: 'sch_1',
        songs: const [
          ScheduleSong(id: 's1', title: 'Música Um', versionId: 'v1'),
          ScheduleSong(id: 's2', title: 'Música Dois', versionId: 'v2'),
          ScheduleSong(id: 's3', title: 'Música Tres', versionId: 'v3'),
        ],
      );

      expect(first.currentIndex, equals(0));
      expect(first.positionLabel, equals('1 de 3'));
      expect(first.hasPrevious, isFalse);
      expect(first.hasNext, isTrue);
      expect(first.previousItem, isNull);
      expect(first.nextItem?.songId, equals('s2'));
      expect(identical(first.moveToIndex(0), first), isTrue);
      expect(first.moveToIndex(-5).currentIndex, equals(0));
      expect(first.moveToIndex(99).currentIndex, equals(2));

      final second = first.moveNext()!;
      expect(second.currentIndex, equals(1));
      expect(second.positionLabel, equals('2 de 3'));
      expect(second.hasPrevious, isTrue);
      expect(second.hasNext, isTrue);
      expect(second.previousItem?.songId, equals('s1'));
      expect(second.nextItem?.songId, equals('s3'));

      final backToFirst = second.movePrevious()!;
      expect(backToFirst.currentIndex, equals(0));
      expect(backToFirst.currentItem?.versionId, equals('v1'));
    });
  });
}
