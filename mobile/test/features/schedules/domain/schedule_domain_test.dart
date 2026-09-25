import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';

void main() {
  group('ScheduleParticipant', () {
    test('fromJson accepts both userId and user_id', () {
      final withSnake = ScheduleParticipant.fromJson(const {
        'id': 'p1',
        'user_id': 'u1',
        'name': 'Maria',
        'role': 'Vocalista',
        'confirmed': true,
      });
      expect(withSnake.userId, equals('u1'));
      expect(withSnake.confirmed, isTrue);

      final withCamel = ScheduleParticipant.fromJson(const {
        'id': 'p2',
        'userId': 'u2',
        'name': 'João',
        'role': 'Violão',
        'confirmed': false,
      });
      expect(withCamel.userId, equals('u2'));
      expect(withCamel.confirmed, isFalse);
    });

    test('confirmed null means pending', () {
      final p = ScheduleParticipant.fromJson(const {
        'id': 'p1',
        'name': 'Pedro',
        'role': 'Bateria',
      });
      expect(p.confirmed, isNull);
    });
  });

  group('ScheduleDetail', () {
    test('fromJson maps both duration_minutes and durationMinutes', () {
      final withSnake = ScheduleDetail.fromJson(const {
        'id': 's1',
        'ministry_id': 'min1',
        'title': 'Culto',
        'date': '2026-10-01',
        'time': '19:00',
        'duration_minutes': 90,
      });
      expect(withSnake.durationMinutes, equals(90));

      final withCamel = ScheduleDetail.fromJson(const {
        'id': 's2',
        'ministry_id': 'min1',
        'title': 'Culto 2',
        'date': '2026-10-01',
        'time': '19:00',
        'durationMinutes': 120,
      });
      expect(withCamel.durationMinutes, equals(120));
    });

    test('formattedDuration renders hours and minutes correctly', () {
      final s45 = ScheduleDetail.fromJson(const {
        'id': '1',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
        'duration_minutes': 45,
      });
      expect(s45.formattedDuration, equals('45min'));

      final s60 = ScheduleDetail.fromJson(const {
        'id': '2',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
        'duration_minutes': 60,
      });
      expect(s60.formattedDuration, equals('1h'));

      final s90 = ScheduleDetail.fromJson(const {
        'id': '3',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
        'duration_minutes': 90,
      });
      expect(s90.formattedDuration, equals('1h 30min'));

      final sNull = ScheduleDetail.fromJson(const {
        'id': '4',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
      });
      expect(sNull.formattedDuration, isEmpty);
    });

    test('civil date is not converted through UTC', () {
      // Date '2026-10-01' must remain '01/10/2026' regardless of timezone
      final s = ScheduleDetail.fromJson(const {
        'id': 's1',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
        'time': '19:00',
      });
      expect(s.formattedDate, equals('01/10/2026'));
      expect(s.formattedTime, equals('19:00'));
    });

    test('isUpcoming uses civil-date comparison', () {
      final future = ScheduleDetail.fromJson(const {
        'id': 's1',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2099-01-01',
      });
      expect(future.isUpcoming(), isTrue);

      final past = ScheduleDetail.fromJson(const {
        'id': 's2',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2020-01-01',
      });
      expect(past.isUpcoming(), isFalse);
    });

    test('participants are parsed correctly', () {
      final s = ScheduleDetail.fromJson(const {
        'id': 's1',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
        'participants': [
          {'id': 'p1', 'name': 'Maria', 'role': 'Vocalista', 'confirmed': true},
          {'id': 'p2', 'name': 'João', 'role': 'Violão'},
        ],
      });
      expect(s.participants.length, equals(2));
      expect(s.confirmedCount, equals(1));
      expect(s.totalParticipants, equals(2));
    });

    test('songs are parsed and counted', () {
      final s = ScheduleDetail.fromJson(const {
        'id': 's1',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-10-01',
        'songs': [
          {'id': 'song1', 'title': 'Amazing Grace'},
          {'id': 'song2', 'title': 'Oceans'},
        ],
      });
      expect(s.songs.length, equals(2));
      expect(s.songs[0].title, equals('Amazing Grace'));
    });
  });

  group('ScheduleSummary', () {
    test('fromJson maps all fields', () {
      final s = ScheduleSummary.fromJson(const {
        'id': 's1',
        'ministry_id': 'min1',
        'title': 'Culto Domingo',
        'date': '2026-10-05',
        'time': '18:30',
        'duration_minutes': 120,
        'participants': [
          {'id': 'p1', 'name': 'Ana', 'role': 'Vocal', 'confirmed': true},
        ],
        'songs': [
          {'id': 'song1'},
          {'id': 'song2'}
        ],
      });
      expect(s.id, equals('s1'));
      expect(s.ministryId, equals('min1'));
      expect(s.title, equals('Culto Domingo'));
      expect(s.durationMinutes, equals(120));
      expect(s.songsCount, equals(2));
      expect(s.confirmedCount, equals(1));
    });

    test('isUpcoming distinguishes future vs past using civil date', () {
      final referenceNow = DateTime(2026, 9, 25, 12, 0);

      final past = ScheduleSummary.fromJson(const {
        'id': '1',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-09-24'
      });
      expect(past.isUpcoming(referenceNow), isFalse);

      final today = ScheduleSummary.fromJson(const {
        'id': '2',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-09-25'
      });
      expect(
          today.isUpcoming(referenceNow), isTrue); // today counts as upcoming

      final future = ScheduleSummary.fromJson(const {
        'id': '3',
        'ministry_id': 'm',
        'title': 'T',
        'date': '2026-09-30'
      });
      expect(future.isUpcoming(referenceNow), isTrue);
    });
  });

  group('ScheduleComment', () {
    test('fromJson handles both snake_case and camelCase field names', () {
      final withSnake = ScheduleComment.fromJson(const {
        'id': 'c1',
        'schedule_id': 's1',
        'ministry_id': 'min1',
        'user_id': 'u1',
        'user_name': 'Maria',
        'content': 'Ótima escala!',
        'created_at': '2026-09-25T10:30:00',
      });
      expect(withSnake.userId, equals('u1'));
      expect(withSnake.userName, equals('Maria'));
      expect(withSnake.content, equals('Ótima escala!'));

      final withCamel = ScheduleComment.fromJson(const {
        'id': 'c2',
        'scheduleId': 's1',
        'ministryId': 'min1',
        'userId': 'u2',
        'userName': 'João',
        'content': 'Amém!',
        'createdAt': '2026-09-25T11:00:00',
      });
      expect(withCamel.userId, equals('u2'));
      expect(withCamel.userName, equals('João'));
    });

    test('formattedDate returns HH:mm for today comments', () {
      final now = DateTime.now();
      final comment = ScheduleComment.fromJson({
        'id': 'c1',
        'schedule_id': 's1',
        'ministry_id': 'm',
        'user_id': 'u1',
        'user_name': 'Ana',
        'content': 'Teste',
        'created_at': now.toIso8601String(),
      });
      // For today, formattedDate returns time only
      final formatted = comment.formattedDate;
      expect(formatted, matches(RegExp(r'^\d{2}:\d{2}$')));
    });
  });
}
