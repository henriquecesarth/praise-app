import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/utils/date_utils.dart';

void main() {
  group('AppDateUtils', () {
    test('formatDatePtBR formats YYYY-MM-DD correctly', () {
      expect(AppDateUtils.formatDatePtBR('2026-09-30'), equals('30/09/2026'));
      expect(AppDateUtils.formatDatePtBR('2026-01-05'), equals('05/01/2026'));
      expect(AppDateUtils.formatDatePtBR(''), equals(''));
      expect(AppDateUtils.formatDatePtBR(null), equals(''));
      expect(AppDateUtils.formatDatePtBR('invalid'), equals('invalid'));
    });

    test('formatTimePtBR formats 24h time correctly', () {
      expect(AppDateUtils.formatTimePtBR('19:00'), equals('19:00'));
      expect(AppDateUtils.formatTimePtBR('9:30'), equals('09:30'));
      expect(AppDateUtils.formatTimePtBR('08:05'), equals('08:05'));
      expect(AppDateUtils.formatTimePtBR(''), equals(''));
      expect(AppDateUtils.formatTimePtBR(null), equals(''));
    });

    test('formatScheduleDateTimePtBR combines date and time', () {
      expect(
        AppDateUtils.formatScheduleDateTimePtBR('2026-09-30', '19:00'),
        equals('30/09/2026 às 19:00'),
      );
      expect(
        AppDateUtils.formatScheduleDateTimePtBR('2026-09-30', null),
        equals('30/09/2026'),
      );
      expect(
        AppDateUtils.formatScheduleDateTimePtBR(null, '19:00'),
        equals(''),
      );
    });

    test('isUpcoming correctly evaluates civil wall-clock dates', () {
      final now = DateTime(2026, 9, 25, 14, 30);

      // Past dates
      expect(AppDateUtils.isUpcoming('2026-09-24', now), isFalse);
      expect(AppDateUtils.isUpcoming('2026-08-15', now), isFalse);

      // Today (considered upcoming through 23:59:59)
      expect(AppDateUtils.isUpcoming('2026-09-25', now), isTrue);

      // Future dates
      expect(AppDateUtils.isUpcoming('2026-09-26', now), isTrue);
      expect(AppDateUtils.isUpcoming('2026-10-10', now), isTrue);

      // Invalid / empty
      expect(AppDateUtils.isUpcoming(null, now), isFalse);
      expect(AppDateUtils.isUpcoming('', now), isFalse);
      expect(AppDateUtils.isUpcoming('not-a-date', now), isFalse);
    });

    test('formatWeeksUntil returns human-friendly relative tags', () {
      final now = DateTime(2026, 9, 25, 10, 0);

      expect(AppDateUtils.formatWeeksUntil('2026-09-25', now), equals('Hoje'));
      expect(
          AppDateUtils.formatWeeksUntil('2026-09-26', now), equals('Amanhã'));
      expect(AppDateUtils.formatWeeksUntil('2026-09-28', now),
          equals('Nesta semana'));
      expect(AppDateUtils.formatWeeksUntil('2026-10-03', now),
          equals('Falta 1 semana'));
      expect(AppDateUtils.formatWeeksUntil('2026-10-10', now),
          equals('Faltam 2 semanas'));
      expect(AppDateUtils.formatWeeksUntil('2026-09-20', now), equals(''));
    });

    test('formatAnnouncementDate formats relative dates and timestamps', () {
      final now = DateTime(2026, 9, 25, 15, 0);

      // Today
      final todayDate = DateTime(2026, 9, 25, 10, 30);
      expect(AppDateUtils.formatAnnouncementDate(todayDate, now),
          equals('Hoje, 10:30'));

      // Yesterday
      final yesterdayDate = DateTime(2026, 9, 24, 18, 45);
      expect(AppDateUtils.formatAnnouncementDate(yesterdayDate, now),
          equals('Ontem, 18:45'));

      // Older
      final olderDate = DateTime(2026, 9, 20, 9, 15);
      expect(AppDateUtils.formatAnnouncementDate(olderDate, now),
          equals('20/09/2026 às 09:15'));

      // Null
      expect(AppDateUtils.formatAnnouncementDate(null, now), equals(''));
    });
  });
}
