import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/availability/domain/consolidated_availability.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';

void main() {
  group('ConsolidatedAvailabilityItem Model & DTO', () {
    test('parses camelCase backend response and omits reason by design', () {
      final json = {
        'id': 'avail_cons_1',
        'ministryId': 'min_100',
        'memberId': 'mem_200',
        'memberName': 'Lucas Silva',
        'startDate': '2026-10-10',
        'endDate': '2026-10-12',
        'startTime': null,
        'endTime': null,
        'allDay': true,
        'startsAt': '2026-10-10T00:00:00',
        'endsAt': '2026-10-13T00:00:00',
        'status': 'unavailable',
        'type': 'unavailability',
        'reason': 'Confidential reason that should not leak',
      };

      final item = ConsolidatedAvailabilityItem.fromJson(json);

      expect(item.id, 'avail_cons_1');
      expect(item.ministryId, 'min_100');
      expect(item.memberId, 'mem_200');
      expect(item.memberName, 'Lucas Silva');
      expect(item.startDate, '2026-10-10');
      expect(item.endDate, '2026-10-12');
      expect(item.startTime, isNull);
      expect(item.endTime, isNull);
      expect(item.allDay, isTrue);
      expect(item.startsAt, '2026-10-10T00:00:00');
      expect(item.endsAt, '2026-10-13T00:00:00');

      final serialized = item.toJson();
      expect(serialized.containsKey('reason'), isFalse);
    });

    test('supports snake_case backend keys defensively', () {
      final json = {
        'id': 'avail_cons_2',
        'ministry_id': 'min_101',
        'member_id': 'mem_201',
        'member_name': 'Ana Costa',
        'start_date': '2026-10-15',
        'end_date': '2026-10-15',
        'start_time': '18:00',
        'end_time': '21:00',
        'all_day': false,
        'starts_at': '2026-10-15T18:00:00',
        'ends_at': '2026-10-15T21:00:00',
      };

      final item = ConsolidatedAvailabilityItem.fromJson(json);

      expect(item.id, 'avail_cons_2');
      expect(item.ministryId, 'min_101');
      expect(item.memberId, 'mem_201');
      expect(item.memberName, 'Ana Costa');
      expect(item.startDate, '2026-10-15');
      expect(item.endDate, '2026-10-15');
      expect(item.startTime, '18:00');
      expect(item.endTime, '21:00');
      expect(item.allDay, isFalse);
    });

    test('formattedPeriod correctly formats all-day and timed periods', () {
      const sameDayAllDay = ConsolidatedAvailabilityItem(
        id: '1',
        ministryId: 'm',
        memberId: 'mem',
        memberName: 'Nome',
        startDate: '2026-10-15',
        endDate: '2026-10-15',
        allDay: true,
        startsAt: '2026-10-15T00:00:00',
        endsAt: '2026-10-16T00:00:00',
      );
      expect(sameDayAllDay.formattedPeriod, '15/10/2026 • Dia inteiro');

      const multiDayAllDay = ConsolidatedAvailabilityItem(
        id: '2',
        ministryId: 'm',
        memberId: 'mem',
        memberName: 'Nome',
        startDate: '2026-10-15',
        endDate: '2026-10-18',
        allDay: true,
        startsAt: '2026-10-15T00:00:00',
        endsAt: '2026-10-19T00:00:00',
      );
      expect(multiDayAllDay.formattedPeriod, '15/10/2026 a 18/10/2026 • Dia inteiro');

      const sameDayTimed = ConsolidatedAvailabilityItem(
        id: '3',
        ministryId: 'm',
        memberId: 'mem',
        memberName: 'Nome',
        startDate: '2026-10-15',
        endDate: '2026-10-15',
        startTime: '19:00',
        endTime: '21:30',
        allDay: false,
        startsAt: '2026-10-15T19:00:00',
        endsAt: '2026-10-15T21:30:00',
      );
      expect(sameDayTimed.formattedPeriod, '15/10/2026 das 19:00 às 21:30');
    });

    test('isPast and isCurrent evaluate based on civil date comparison', () {
      final todayCivil = DateTime.now();
      final todayStr = '${todayCivil.year.toString().padLeft(4, '0')}-${todayCivil.month.toString().padLeft(2, '0')}-${todayCivil.day.toString().padLeft(2, '0')}';

      const pastItem = ConsolidatedAvailabilityItem(
        id: 'past',
        ministryId: 'm',
        memberId: 'mem',
        memberName: 'N',
        startDate: '2020-01-01',
        endDate: '2020-01-02',
        allDay: true,
        startsAt: '2020-01-01T00:00:00',
        endsAt: '2020-01-03T00:00:00',
      );
      expect(pastItem.isPast(), isTrue);
      expect(pastItem.isCurrent(), isFalse);

      final currentItem = ConsolidatedAvailabilityItem(
        id: 'curr',
        ministryId: 'm',
        memberId: 'mem',
        memberName: 'N',
        startDate: todayStr,
        endDate: todayStr,
        allDay: true,
        startsAt: '${todayStr}T00:00:00',
        endsAt: '${todayStr}T23:59:59',
      );
      expect(currentItem.isPast(), isFalse);
      expect(currentItem.isCurrent(), isTrue);

      const futureItem = ConsolidatedAvailabilityItem(
        id: 'fut',
        ministryId: 'm',
        memberId: 'mem',
        memberName: 'N',
        startDate: '2099-12-01',
        endDate: '2099-12-02',
        allDay: true,
        startsAt: '2099-12-01T00:00:00',
        endsAt: '2099-12-03T00:00:00',
      );
      expect(futureItem.isPast(), isFalse);
      expect(futureItem.isCurrent(), isFalse);
    });
  });

  group('CivilPlanningWindow & AvailabilityPlanningPeriod', () {
    test('preset calculations produce correct civil date boundaries', () {
      final anchor = DateTime(2026, 10, 5);

      final p7 = AvailabilityPlanningPeriod.preset7Days(anchor);
      expect(p7.from, '2026-10-05');
      expect(p7.to, '2026-10-11');
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays(p7.from, p7.to), 7);

      final p15 = AvailabilityPlanningPeriod.preset15Days(anchor);
      expect(p15.from, '2026-10-05');
      expect(p15.to, '2026-10-19');
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays(p15.from, p15.to), 15);

      final p30 = AvailabilityPlanningPeriod.preset30Days(anchor);
      expect(p30.from, '2026-10-05');
      expect(p30.to, '2026-11-03');
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays(p30.from, p30.to), 30);

      final pMonth = AvailabilityPlanningPeriod.presetThisMonth(anchor);
      expect(pMonth.from, '2026-10-01');
      expect(pMonth.to, '2026-10-31');
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays(pMonth.from, pMonth.to), 31);
    });

    test('validateRange enforces exact 90-day civil boundary', () {
      expect(AvailabilityPlanningPeriod.validateRange('2026-10-01', '2026-10-01'), isNull);

      // Exactly 90 inclusive days in 2026 (non-leap)
      expect(AvailabilityPlanningPeriod.validateRange('2026-01-01', '2026-03-31'), isNull);
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays('2026-01-01', '2026-03-31'), 90);

      // 91 inclusive days in 2026 -> rejected
      final over90 = AvailabilityPlanningPeriod.validateRange('2026-01-01', '2026-04-01');
      expect(over90, contains('90 dias civis'));
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays('2026-01-01', '2026-04-01'), 91);

      // Exactly 90 inclusive days in 2024 (leap year)
      expect(AvailabilityPlanningPeriod.validateRange('2024-01-01', '2024-03-30'), isNull);
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays('2024-01-01', '2024-03-30'), 90);

      // 91 inclusive days in 2024 (leap year) -> rejected
      final over90Leap = AvailabilityPlanningPeriod.validateRange('2024-01-01', '2024-03-31');
      expect(over90Leap, contains('90 dias civis'));
      expect(AvailabilityPlanningPeriod.calculateInclusiveDays('2024-01-01', '2024-03-31'), 91);

      final inverted = AvailabilityPlanningPeriod.validateRange('2026-10-15', '2026-10-10');
      expect(inverted, contains('não pode ser anterior'));

      final invalidFormat = AvailabilityPlanningPeriod.validateRange('invalid', '2026-10-10');
      expect(invalidFormat, contains('formato: AAAA-MM-DD'));
    });
  });

  group('ManualMemberEligibility Invariants (R2-1)', () {
    test('strictly requires isManual == true && userId == null', () {
      // 1. userId == null -> eligible when manual
      const eligibleManualMember = MinistryMember(
        id: 'mem_1',
        name: 'Membro Manual 1',
        isManual: true,
        userId: null,
      );
      expect(ManualMemberEligibility.isEligible(eligibleManualMember), isTrue);
      expect(eligibleManualMember.isEligibleManualMember, isTrue);

      // 2. userId == "" -> NOT eligible
      const emptyStringUserId = MinistryMember(
        id: 'mem_2',
        name: 'Membro com String Vazia',
        isManual: true,
        userId: '',
      );
      expect(ManualMemberEligibility.isEligible(emptyStringUserId), isFalse);
      expect(emptyStringUserId.isEligibleManualMember, isFalse);

      // 3. userId == "   " (whitespace) -> NOT eligible
      const whitespaceUserId = MinistryMember(
        id: 'mem_3',
        name: 'Membro com Espaços',
        isManual: true,
        userId: '   ',
      );
      expect(ManualMemberEligibility.isEligible(whitespaceUserId), isFalse);
      expect(whitespaceUserId.isEligibleManualMember, isFalse);

      // 4. linked non-empty userId -> NOT eligible
      const linkedMember = MinistryMember(
        id: 'mem_4',
        name: 'Membro Vinculado',
        isManual: true,
        userId: 'usr_xyz',
      );
      expect(ManualMemberEligibility.isEligible(linkedMember), isFalse);
      expect(linkedMember.isEligibleManualMember, isFalse);

      // 5. isManual == false -> NOT eligible
      const unlinkedNonManualMember = MinistryMember(
        id: 'mem_5',
        name: 'Membro Não Manual Sem User',
        isManual: false,
        userId: null,
      );
      expect(ManualMemberEligibility.isEligible(unlinkedNonManualMember), isFalse);
      expect(unlinkedNonManualMember.isEligibleManualMember, isFalse);
    });
  });
}
