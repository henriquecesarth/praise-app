import 'package:flutter/foundation.dart';

/// Pure civil calendar date utility.
///
/// Operates strictly in civil calendar space (Gregorian) with zero dependence
/// on local wall-clock timezone, daylight saving time (DST), or UTC offsets.
/// Dates are formatted strictly as 'YYYY-MM-DD' without time or 'Z'.
@immutable
class CivilDate implements Comparable<CivilDate> {
  final int year;
  final int month;
  final int day;

  const CivilDate(this.year, this.month, this.day);

  static final RegExp _isoPattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

  static const List<int> _daysBeforeMonth = [
    0, // Jan
    31, // Feb
    59, // Mar
    90, // Apr
    120, // May
    151, // Jun
    181, // Jul
    212, // Aug
    243, // Sep
    273, // Oct
    304, // Nov
    334, // Dec
  ];

  /// Checks if [year] is a Gregorian leap year.
  static bool isLeapYear(int year) =>
      (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);

  /// Returns total days in given [month] (1-12) of [year].
  static int daysInMonth(int year, int month) {
    if (month < 1 || month > 12) return 0;
    if (month == 2) return isLeapYear(year) ? 29 : 28;
    if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
    return 31;
  }

  /// Parses strict 'YYYY-MM-DD' civil date string.
  /// Returns null if format or calendar values are invalid.
  static CivilDate? tryParse(String? value) {
    if (value == null) return null;
    final trimmed = value.trim();
    final match = _isoPattern.firstMatch(trimmed);
    if (match == null) return null;

    final y = int.tryParse(match.group(1)!);
    final m = int.tryParse(match.group(2)!);
    final d = int.tryParse(match.group(3)!);

    if (y == null || m == null || d == null) return null;
    if (y < 1900 || y > 2100) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > daysInMonth(y, m)) return null;

    return CivilDate(y, m, d);
  }

  /// Parses strict 'YYYY-MM-DD' civil date string or throws [FormatException].
  static CivilDate parse(String value) {
    final parsed = tryParse(value);
    if (parsed == null) {
      throw FormatException('Data civil inválida: "$value"');
    }
    return parsed;
  }

  /// Deterministic civil day ordinal (total days from 0001-01-01).
  ///
  /// Entirely independent of timezone, DST, and wall-clock duration.
  int get dayOrdinal {
    final prevYear = year - 1;
    final leapYears = (prevYear ~/ 4) - (prevYear ~/ 100) + (prevYear ~/ 400);
    final leapAdjustment = (month > 2 && isLeapYear(year)) ? 1 : 0;
    return (prevYear * 365) +
        leapYears +
        _daysBeforeMonth[month - 1] +
        leapAdjustment +
        day;
  }

  /// Calculates inclusive civil days between `this` and [other].
  ///
  /// Returns -1 if [other] is earlier than `this`.
  int inclusiveDaysTo(CivilDate other) {
    if (other < this) return -1;
    return other.dayOrdinal - dayOrdinal + 1;
  }

  /// Returns difference in civil days (`this.dayOrdinal - other.dayOrdinal`).
  int differenceInDays(CivilDate other) => dayOrdinal - other.dayOrdinal;

  /// Pure calendar addition/subtraction of civil days.
  CivilDate addDays(int days) {
    if (days == 0) return this;
    var y = year;
    var m = month;
    var d = day + days;

    if (days > 0) {
      while (true) {
        final dim = daysInMonth(y, m);
        if (d <= dim) break;
        d -= dim;
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
    } else {
      while (d < 1) {
        m--;
        if (m < 1) {
          m = 12;
          y--;
        }
        final dim = daysInMonth(y, m);
        d += dim;
      }
    }
    return CivilDate(y, m, d);
  }

  /// Formats strictly as 'YYYY-MM-DD'. Never converts to UTC or appends 'Z'.
  String toIsoDate() {
    final yStr = year.toString().padLeft(4, '0');
    final mStr = month.toString().padLeft(2, '0');
    final dStr = day.toString().padLeft(2, '0');
    return '$yStr-$mStr-$dStr';
  }

  @override
  String toString() => toIsoDate();

  @override
  int compareTo(CivilDate other) {
    if (year != other.year) return year.compareTo(other.year);
    if (month != other.month) return month.compareTo(other.month);
    return day.compareTo(other.day);
  }

  bool operator <(CivilDate other) => compareTo(other) < 0;
  bool operator <=(CivilDate other) => compareTo(other) <= 0;
  bool operator >(CivilDate other) => compareTo(other) > 0;
  bool operator >=(CivilDate other) => compareTo(other) >= 0;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CivilDate &&
          runtimeType == other.runtimeType &&
          year == other.year &&
          month == other.month &&
          day == other.day;

  @override
  int get hashCode => year.hashCode ^ month.hashCode ^ day.hashCode;
}
