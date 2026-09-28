import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';

void main() {
  group('MemberAvailability Model & DTO', () {
    test('parses standard camelCase backend DTO correctly', () {
      final json = {
        'id': 'avail_1',
        'ministryId': 'min_123',
        'memberId': 'mem_456',
        'startDate': '2026-10-04',
        'endDate': '2026-10-04',
        'startTime': '19:00',
        'endTime': '22:00',
        'allDay': false,
        'startsAt': '2026-10-04T19:00:00',
        'endsAt': '2026-10-04T22:00:00',
        'reason': 'Viagem de trabalho',
        'createdAt': '2026-09-28T12:00:00.000Z',
        'updatedAt': '2026-09-28T12:00:00.000Z',
      };

      final item = MemberAvailability.fromJson(json);

      expect(item.id, 'avail_1');
      expect(item.ministryId, 'min_123');
      expect(item.memberId, 'mem_456');
      expect(item.startDate, '2026-10-04');
      expect(item.endDate, '2026-10-04');
      expect(item.startTime, '19:00');
      expect(item.endTime, '22:00');
      expect(item.allDay, isFalse);
      expect(item.startsAt, '2026-10-04T19:00:00');
      expect(item.endsAt, '2026-10-04T22:00:00');
      expect(item.reason, 'Viagem de trabalho');
      expect(item.createdAt, '2026-09-28T12:00:00.000Z');
      expect(item.updatedAt, '2026-09-28T12:00:00.000Z');
    });

    test('supports defensive snake_case fallback without throwing', () {
      final json = {
        'id': 'avail_2',
        'ministry_id': 'min_abc',
        'member_id': 'mem_def',
        'start_date': '2026-11-01',
        'end_date': '2026-11-03',
        'start_time': null,
        'end_time': null,
        'all_day': true,
        'starts_at': '2026-11-01T00:00:00',
        'ends_at': '2026-11-04T00:00:00',
        'reason': null,
        'created_at': '2026-09-28T12:00:00.000Z',
        'updated_at': '2026-09-28T12:00:00.000Z',
      };

      final item = MemberAvailability.fromJson(json);

      expect(item.id, 'avail_2');
      expect(item.ministryId, 'min_abc');
      expect(item.memberId, 'mem_def');
      expect(item.startDate, '2026-11-01');
      expect(item.endDate, '2026-11-03');
      expect(item.allDay, isTrue);
      expect(item.startTime, isNull);
      expect(item.endTime, isNull);
    });

    test('formattedPeriod formats all-day single day and multi-day', () {
      const singleDay = MemberAvailability(
        id: '1',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: true,
        startsAt: '2026-10-04T00:00:00',
        endsAt: '2026-10-05T00:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(singleDay.formattedPeriod, '04/10/2026 • Dia inteiro');

      const multiDay = MemberAvailability(
        id: '2',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-07',
        allDay: true,
        startsAt: '2026-10-04T00:00:00',
        endsAt: '2026-10-08T00:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(multiDay.formattedPeriod, '04/10/2026 a 07/10/2026 • Dia inteiro');
    });

    test('formattedPeriod formats timed single day and multi-day', () {
      const singleDayTimed = MemberAvailability(
        id: '1',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        startTime: '19:00',
        endTime: '22:00',
        allDay: false,
        startsAt: '2026-10-04T19:00:00',
        endsAt: '2026-10-04T22:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(singleDayTimed.formattedPeriod, '04/10/2026 das 19:00 às 22:00');

      const multiDayTimed = MemberAvailability(
        id: '2',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-05',
        startTime: '20:00',
        endTime: '02:00',
        allDay: false,
        startsAt: '2026-10-04T20:00:00',
        endsAt: '2026-10-05T02:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(multiDayTimed.formattedPeriod,
          '04/10/2026 às 20:00 a 05/10/2026 às 02:00');
    });

    test('isPast and isCurrent evaluate civil calendar dates correctly', () {
      final refNow = DateTime(2026, 10, 4, 15, 30); // 04/10/2026 15:30

      // Past item (ended yesterday)
      const pastItem = MemberAvailability(
        id: 'p',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        allDay: true,
        startsAt: '2026-10-01T00:00:00',
        endsAt: '2026-10-04T00:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(pastItem.isPast(refNow), isTrue);
      expect(pastItem.isCurrent(refNow), isFalse);

      // Current all-day item (today)
      const currentAllDay = MemberAvailability(
        id: 'c',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: true,
        startsAt: '2026-10-04T00:00:00',
        endsAt: '2026-10-05T00:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(currentAllDay.isPast(refNow), isFalse);
      expect(currentAllDay.isCurrent(refNow), isTrue);

      // Timed item today that ended at 14:00 (before 15:30)
      const endedTimedToday = MemberAvailability(
        id: 'et',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        startTime: '10:00',
        endTime: '14:00',
        allDay: false,
        startsAt: '2026-10-04T10:00:00',
        endsAt: '2026-10-04T14:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(endedTimedToday.isPast(refNow), isTrue);
      expect(endedTimedToday.isCurrent(refNow), isFalse);

      // Timed item today from 19:00 to 22:00 (after 15:30)
      const futureTimedToday = MemberAvailability(
        id: 'ft',
        ministryId: 'm',
        memberId: 'mem',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        startTime: '19:00',
        endTime: '22:00',
        allDay: false,
        startsAt: '2026-10-04T19:00:00',
        endsAt: '2026-10-04T22:00:00',
        createdAt: '',
        updatedAt: '',
      );
      expect(futureTimedToday.isPast(refNow), isFalse);
      expect(futureTimedToday.isCurrent(refNow), isTrue);
    });
  });

  group('AvailabilityValidator', () {
    test('validates valid all-day period', () {
      final err = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-06',
        allDay: true,
        reason: 'Viagem',
      );
      expect(err, isNull);
    });

    test('validates valid timed period with end after start', () {
      final err = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: false,
        startTime: '19:00',
        endTime: '22:00',
      );
      expect(err, isNull);
    });

    test('rejects endDate earlier than startDate', () {
      final err = AvailabilityValidator.validate(
        startDate: '2026-10-10',
        endDate: '2026-10-05',
        allDay: true,
      );
      expect(err, 'A data final não pode ser anterior à data inicial.');
    });

    test('rejects period exceeding 90 days', () {
      final err = AvailabilityValidator.validate(
        startDate: '2026-01-01',
        endDate: '2026-04-10', // > 90 days
        allDay: true,
      );
      expect(err, 'O período de indisponibilidade não pode exceder 90 dias.');
    });

    test('rejects timed availability with missing start or end time', () {
      final errMissingStart = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: false,
        startTime: '',
        endTime: '22:00',
      );
      expect(errMissingStart,
          'O horário inicial é obrigatório quando não for dia inteiro.');

      final errMissingEnd = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: false,
        startTime: '19:00',
        endTime: '',
      );
      expect(errMissingEnd,
          'O horário final é obrigatório quando não for dia inteiro.');
    });

    test('rejects same-day timed availability with endTime <= startTime', () {
      final errSame = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: false,
        startTime: '19:00',
        endTime: '19:00',
      );
      expect(errSame, 'O horário final deve ser posterior ao horário inicial.');

      final errBefore = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: false,
        startTime: '20:00',
        endTime: '19:00',
      );
      expect(
          errBefore, 'O horário final deve ser posterior ao horário inicial.');
    });

    test('rejects reason exceeding 255 chars', () {
      final longReason = 'A' * 256;
      final err = AvailabilityValidator.validate(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: true,
        reason: longReason,
      );
      expect(err, 'O motivo não pode exceder 255 caracteres.');
    });
  });

  group('Availability Payloads Serialization', () {
    test('CreateAvailabilityPayload serializes null times for all-day', () {
      const payload = CreateAvailabilityPayload(
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        startTime: '19:00',
        endTime: '22:00',
        allDay: true,
        reason: '   Descanso   ',
      );

      final json = payload.toJson();
      expect(json['startDate'], '2026-10-04');
      expect(json['endDate'], '2026-10-04');
      expect(json['allDay'], isTrue);
      expect(json['startTime'], isNull);
      expect(json['endTime'], isNull);
      expect(json['reason'], 'Descanso');
    });

    test('UpdateAvailabilityPayload only includes non-null updates', () {
      const payload = UpdateAvailabilityPayload(
        reason: 'Alterado',
      );

      final json = payload.toJson();
      expect(json.containsKey('startDate'), isFalse);
      expect(json.containsKey('endDate'), isFalse);
      expect(json['reason'], 'Alterado');
    });
  });
}
