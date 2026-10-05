import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/utils/civil_date.dart';

void main() {
  group('CivilDate Gregorian & Leap Year Invariants', () {
    test('correctly identifies leap years across centuries', () {
      // Divisible by 4 and not 100 -> leap
      expect(CivilDate.isLeapYear(2024), isTrue);
      expect(CivilDate.isLeapYear(2028), isTrue);

      // Not divisible by 4 -> not leap
      expect(CivilDate.isLeapYear(2025), isFalse);
      expect(CivilDate.isLeapYear(2026), isFalse);

      // Divisible by 100 but not 400 -> not leap
      expect(CivilDate.isLeapYear(1900), isFalse);
      expect(CivilDate.isLeapYear(2100), isFalse);

      // Divisible by 400 -> leap
      expect(CivilDate.isLeapYear(2000), isTrue);
    });

    test('daysInMonth respects leap and non-leap Februaries', () {
      expect(CivilDate.daysInMonth(2024, 2), 29);
      expect(CivilDate.daysInMonth(2026, 2), 28);
      expect(CivilDate.daysInMonth(1900, 2), 28);
      expect(CivilDate.daysInMonth(2000, 2), 29);

      expect(CivilDate.daysInMonth(2026, 1), 31);
      expect(CivilDate.daysInMonth(2026, 4), 30);
      expect(CivilDate.daysInMonth(2026, 12), 31);
    });

    test('tryParse parses valid civil dates and rejects invalid Gregorian dates', () {
      expect(CivilDate.tryParse('2026-10-05'), const CivilDate(2026, 10, 5));
      expect(CivilDate.tryParse('2024-02-29'), const CivilDate(2024, 2, 29));

      // Invalid leap year
      expect(CivilDate.tryParse('2026-02-29'), isNull);

      // Out of bounds months/days
      expect(CivilDate.tryParse('2026-00-10'), isNull);
      expect(CivilDate.tryParse('2026-13-10'), isNull);
      expect(CivilDate.tryParse('2026-04-31'), isNull);
      expect(CivilDate.tryParse('2026-10-32'), isNull);

      // Malformed / non-ISO
      expect(CivilDate.tryParse('10/05/2026'), isNull);
      expect(CivilDate.tryParse('2026-10-5'), isNull);
      expect(CivilDate.tryParse('invalid'), isNull);
      expect(CivilDate.tryParse(null), isNull);
    });
  });

  group('CivilDate Ordinal & Inclusive Span Math (R2-2, R2-3)', () {
    test('exact 90-day all-day boundary: 90 inclusive days accepted, 91 rejected', () {
      // 2026-01-01 to 2026-03-31:
      // Jan: 31 days, Feb: 28 days, Mar: 31 days = exactly 90 inclusive civil days
      final jan01 = CivilDate.parse('2026-01-01');
      final mar31 = CivilDate.parse('2026-03-31');
      final apr01 = CivilDate.parse('2026-04-01');

      expect(jan01.inclusiveDaysTo(mar31), 90);
      expect(jan01.inclusiveDaysTo(apr01), 91);
    });

    test('exact 90-day boundary in leap year 2024', () {
      // In 2024 (leap year, Feb has 29 days):
      // Jan: 31 days, Feb: 29 days, Mar: 30 days = 90 days
      final jan01 = CivilDate.parse('2024-01-01');
      final mar30 = CivilDate.parse('2024-03-30');
      final mar31 = CivilDate.parse('2024-03-31');

      expect(jan01.inclusiveDaysTo(mar30), 90);
      expect(jan01.inclusiveDaysTo(mar31), 91);
    });

    test('month and year boundary day additions and subtractions', () {
      final dec31 = CivilDate.parse('2026-12-31');
      final jan01Next = dec31.addDays(1);
      expect(jan01Next, const CivilDate(2027, 1, 1));
      expect(jan01Next.addDays(-1), dec31);

      final feb28 = CivilDate.parse('2026-02-28');
      expect(feb28.addDays(1), const CivilDate(2026, 3, 1));

      final leapFeb28 = CivilDate.parse('2024-02-28');
      expect(leapFeb28.addDays(1), const CivilDate(2024, 2, 29));
      expect(leapFeb28.addDays(2), const CivilDate(2024, 3, 1));
    });

    test('inclusiveDaysTo returns negative when target is before start', () {
      final d1 = CivilDate.parse('2026-10-10');
      final d2 = CivilDate.parse('2026-10-05');
      expect(d1.inclusiveDaysTo(d2), -1);
    });

    test('toIsoDate produces strict YYYY-MM-DD without Z or UTC offset', () {
      const cd = CivilDate(2026, 5, 4);
      expect(cd.toIsoDate(), '2026-05-04');
      expect(cd.toString(), '2026-05-04');
      expect(cd.toIsoDate().contains('Z'), isFalse);
      expect(cd.toIsoDate().contains('T'), isFalse);
    });
  });

  group('DST Independence (R2-4)', () {
    test('civil date calculations are completely independent of local timezone or DST', () {
      // Standard civil dates
      final d1 = CivilDate.parse('2026-10-01');
      final d2 = CivilDate.parse('2026-10-31');

      // The civil span is deterministically 31 days
      expect(d1.inclusiveDaysTo(d2), 31);
      expect(d2.differenceInDays(d1), 30);

      // Consecutive days always have a difference of exactly 1 day
      final dayA = CivilDate.parse('2026-10-17');
      final dayB = CivilDate.parse('2026-10-18');
      expect(dayB.differenceInDays(dayA), 1);
      expect(dayA.inclusiveDaysTo(dayB), 2);
    });
  });
}
