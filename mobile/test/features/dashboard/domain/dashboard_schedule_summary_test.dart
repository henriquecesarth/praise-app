import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';

void main() {
  group('DashboardScheduleSummary Domain Model', () {
    test('deserializes complete backend json correctly', () {
      final json = {
        'id': 'sch_1',
        'ministry_id': 'min_1',
        'title': 'Culto da Família',
        'date': '2026-09-30',
        'time': '19:30',
        'duration_minutes': 120,
        'notes': 'Traje livre',
        'isVisible': true,
        'colorPalette': '#7C3AED',
        'participants': [
          {'id': 'p1', 'name': 'Lucas', 'role': 'Violão', 'confirmed': true},
          {'id': 'p2', 'name': 'Ana', 'role': 'Vocal', 'confirmed': false},
          {'id': 'p3', 'name': 'Pedro', 'role': 'Bateria'},
        ],
        'songs': [
          {'id': 's1', 'title': 'Música 1'},
          {'id': 's2', 'title': 'Música 2'},
        ],
        'created_at': '2026-09-20T10:00:00.000Z',
      };

      final summary = DashboardScheduleSummary.fromJson(json);

      expect(summary.id, equals('sch_1'));
      expect(summary.ministryId, equals('min_1'));
      expect(summary.title, equals('Culto da Família'));
      expect(summary.date, equals('2026-09-30'));
      expect(summary.time, equals('19:30'));
      expect(summary.durationMinutes, equals(120));
      expect(summary.notes, equals('Traje livre'));
      expect(summary.isVisible, isTrue);
      expect(summary.colorPalette, equals('#7C3AED'));
      expect(summary.participants.length, equals(3));
      expect(summary.totalParticipants, equals(3));
      expect(summary.confirmedCount, equals(1));
      expect(summary.declinedCount, equals(1));
      expect(summary.songsCount, equals(2));
      expect(summary.formattedDateTime, equals('30/09/2026 às 19:30'));
    });

    test('handles durationMinutes camelCase fallback', () {
      final json = {
        'id': 'sch_2',
        'date': '2026-10-05',
        'durationMinutes': 90,
      };

      final summary = DashboardScheduleSummary.fromJson(json);
      expect(summary.durationMinutes, equals(90));
    });

    test('isUpcoming correctly evaluates based on schedule date', () {
      final now = DateTime(2026, 9, 25, 12, 0);

      const pastSchedule = DashboardScheduleSummary(
        id: '1',
        ministryId: 'm1',
        title: 'Passado',
        date: '2026-09-24',
      );
      const todaySchedule = DashboardScheduleSummary(
        id: '2',
        ministryId: 'm1',
        title: 'Hoje',
        date: '2026-09-25',
      );
      const futureSchedule = DashboardScheduleSummary(
        id: '3',
        ministryId: 'm1',
        title: 'Futuro',
        date: '2026-09-26',
      );

      expect(pastSchedule.isUpcoming(now), isFalse);
      expect(todaySchedule.isUpcoming(now), isTrue);
      expect(futureSchedule.isUpcoming(now), isTrue);
    });

    test('supports value equality and hash code', () {
      const s1 = DashboardScheduleSummary(
        id: '1',
        ministryId: 'm1',
        title: 'Culto',
        date: '2026-09-30',
        participants: [
          DashboardScheduleParticipant(id: 'p1', name: 'N1', role: 'R1'),
        ],
      );
      const s2 = DashboardScheduleSummary(
        id: '1',
        ministryId: 'm1',
        title: 'Culto',
        date: '2026-09-30',
        participants: [
          DashboardScheduleParticipant(id: 'p1', name: 'N1', role: 'R1'),
        ],
      );
      const s3 = DashboardScheduleSummary(
        id: '2',
        ministryId: 'm1',
        title: 'Culto',
        date: '2026-09-30',
      );

      expect(s1, equals(s2));
      expect(s1.hashCode, equals(s2.hashCode));
      expect(s1, isNot(equals(s3)));
    });
  });
}
