import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/utils/date_utils.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_actions.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/widgets/detail/schedule_song_presentation.dart';

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

  group('ScheduleSong', () {
    test('fromJson and toJson preserve versionId and versionName from camelCase and snake_case', () {
      final fromCamel = ScheduleSong.fromJson(const {
        'id': 'song-1',
        'title': 'Bondade de Deus',
        'artistName': 'Isaías Saad',
        'originalKey': 'G',
        'versionId': 'ver-2',
        'versionName': 'Acústico',
      });
      expect(fromCamel.artist, equals('Isaías Saad'));
      expect(fromCamel.key, equals('G'));
      expect(fromCamel.versionId, equals('ver-2'));
      expect(fromCamel.versionName, equals('Acústico'));
      expect(fromCamel.toJson()['versionId'], equals('ver-2'));
      expect(fromCamel.toJson()['versionName'], equals('Acústico'));

      final fromSnake = ScheduleSong.fromJson(const {
        'songId': 'song-2',
        'title': 'Oceanos',
        'version_id': 'ver-9',
        'version_name': 'Original',
      });
      expect(fromSnake.id, equals('song-2'));
      expect(fromSnake.versionId, equals('ver-9'));
      expect(fromSnake.versionName, equals('Original'));
    });
  });

  group('Schedule Detail Redesign Helpers', () {
    test('AppDateUtils formats weekday, full date, relative days and timestamps', () {
      final ref = DateTime(2026, 11, 16, 10, 0);
      expect(AppDateUtils.formatWeekdayPtBR('2026-11-22'), equals('Domingo'));
      expect(
        AppDateUtils.formatFullDatePtBR('2026-11-22'),
        equals('22 de novembro de 2026'),
      );
      expect(
        AppDateUtils.formatRelativeDaysLabel('2026-11-16', ref),
        equals('Hoje'),
      );
      expect(
        AppDateUtils.formatRelativeDaysLabel('2026-11-17', ref),
        equals('Amanhã'),
      );
      expect(
        AppDateUtils.formatRelativeDaysLabel('2026-11-22', ref),
        equals('daqui a 6 dias'),
      );
      expect(
        AppDateUtils.formatRelativeDaysLabel('2026-11-15', ref),
        equals('Ontem'),
      );
      expect(
        AppDateUtils.formatTimestampPtBR('2026-11-16T12:30:00Z'),
        matches(RegExp(r'^\d{2}/\d{2}/2026 às \d{2}:\d{2}$')),
      );
    });

    test('buildGoogleCalendarEventUri and buildScheduleShareSummary format local schedule safely', () {
      const detail = ScheduleDetail(
        id: 'sch_1',
        ministryId: 'min_1',
        title: 'Culto de Adoração',
        date: '2026-11-22',
        time: '19:30',
        durationMinutes: 90,
        notes: 'Ensaio às 18h',
        participants: [
          ScheduleParticipant(id: 'p1', name: 'Ana', role: 'Vocal', confirmed: true),
          ScheduleParticipant(id: 'p2', name: 'João', role: 'Violão'),
        ],
        songs: [
          ScheduleSong(
            id: 's1',
            title: 'Bondade de Deus',
            key: 'G',
            versionName: 'Acústico',
          ),
        ],
      );

      final uri = buildGoogleCalendarEventUri(detail);
      expect(uri, isNotNull);
      expect(uri!.host, equals('calendar.google.com'));
      expect(uri.queryParameters['action'], equals('TEMPLATE'));
      expect(uri.queryParameters['text'], equals('Culto de Adoração'));
      expect(
        uri.queryParameters['dates'],
        equals('20261122T193000/20261122T210000'),
      );
      expect(uri.queryParameters['details'], contains('Bondade de Deus'));

      final share = buildScheduleShareSummary(detail);
      expect(share, contains('Culto de Adoração'));
      expect(share, contains('Domingo, 22 de novembro de 2026, às 19:30'));
      expect(share, contains('1 de 2 confirmados'));
      expect(share, contains('1ª Bondade de Deus • Acústico • Tom G'));
      expect(share, contains('Ensaio às 18h'));
    });

    test('ScheduleSongPresentation resolves ordinal, classification and media indicators cleanly', () {
      const song = ScheduleSong(
        id: 'song-1',
        title: 'Grande É o Senhor',
        artist: 'Adhemar de Campos',
        key: 'A',
        versionId: 'v2',
        rawJson: {'has_lyrics': true, 'smart_chords_count': 2},
      );
      const summary = SongSummary(
        id: 'song-1',
        ministryId: 'min_1',
        title: 'Grande É o Senhor',
        classification: SongClassificationRef(
          id: 'c1',
          name: 'Louvor',
          color: '#7CC4A4',
        ),
        youtubeUrl: 'https://youtube.com/watch?v=abc123',
        hasYoutube: true,
        audioUrl: 'https://cdn.test/audio.mp3',
        versions: [
          SongVersion(id: 'v2', name: 'Congregacional', key: 'A'),
        ],
      );

      final pres = ScheduleSongPresentation.fromScheduleSong(
        index: 0,
        song: song,
        summary: summary,
      );
      expect(pres.ordinalLabel, equals('1ª'));
      expect(pres.classificationName, equals('Louvor'));
      expect(pres.versionName, equals('Congregacional'));
      expect(pres.hasChord, isTrue);
      expect(pres.hasLyrics, isTrue);
      expect(pres.hasAudio, isTrue);
      expect(pres.hasYoutube, isTrue);
      expect(pres.youtubeUrl, equals('https://youtube.com/watch?v=abc123'));
    });
  });
}
