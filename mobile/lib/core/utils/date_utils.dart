import 'civil_date.dart';
export 'civil_date.dart';

/// Pure civil wall-clock date and time formatting utilities.
///
/// Avoids UTC conversions on calendar dates ('YYYY-MM-DD') to ensure
/// dates in timezones like America/Sao_Paulo (UTC-3) never shift backwards.
class AppDateUtils {
  static final RegExp _isoDatePattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})');
  static final RegExp _timePattern = RegExp(r'^(\d{1,2}):(\d{2})');

  static const List<String> _weekdaysPtBr = [
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado',
    'Domingo',
  ];

  static const List<String> _monthsPtBr = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];

  static ({int year, int month, int day})? _parseCivilYmd(String? dateStr) {
    if (dateStr == null || dateStr.trim().isEmpty) return null;
    final match = _isoDatePattern.firstMatch(dateStr.trim());
    if (match == null) return null;
    final year = int.tryParse(match.group(1)!);
    final month = int.tryParse(match.group(2)!);
    final day = int.tryParse(match.group(3)!);
    if (year == null || month == null || day == null) return null;
    if (month < 1 || month > 12) return null;
    final maxDays = CivilDate.daysInMonth(year, month);
    if (day < 1 || day > maxDays) return null;
    return (year: year, month: month, day: day);
  }

  /// Formats 'YYYY-MM-DD' as 'DD/MM/YYYY'.
  static String formatDatePtBR(String? value) {
    if (value == null || value.trim().isEmpty) return '';
    final parsed = _parseCivilYmd(value);
    if (parsed == null) return value;
    final d = parsed.day.toString().padLeft(2, '0');
    final m = parsed.month.toString().padLeft(2, '0');
    return '$d/$m/${parsed.year}';
  }

  /// Returns Portuguese weekday name (e.g. 'Domingo', 'Quinta-feira') for a civil date.
  static String formatWeekdayPtBR(String? dateStr) {
    final parsed = _parseCivilYmd(dateStr);
    if (parsed == null) return '';
    final civil = DateTime(parsed.year, parsed.month, parsed.day);
    return _weekdaysPtBr[civil.weekday - 1];
  }

  /// Formats 'YYYY-MM-DD' as '1 de outubro de 2099'.
  static String formatFullDatePtBR(String? dateStr) {
    final parsed = _parseCivilYmd(dateStr);
    if (parsed == null) return formatDatePtBR(dateStr);
    final monthName = _monthsPtBr[parsed.month - 1];
    return '${parsed.day} de $monthName de ${parsed.year}';
  }

  /// Formats 'H:mm' or 'HH:mm' as 'HH:mm' (24-hour).
  static String formatTimePtBR(String? value) {
    if (value == null || value.trim().isEmpty) return '';
    final match = _timePattern.firstMatch(value.trim());
    if (match == null) return value;
    final hour = match.group(1)!.padLeft(2, '0');
    final minute = match.group(2)!;
    return '$hour:$minute';
  }

  /// Formats schedule date and time as 'DD/MM/YYYY às HH:mm'.
  static String formatScheduleDateTimePtBR(String? date, String? time) {
    final formattedDate = formatDatePtBR(date);
    final formattedTime = formatTimePtBR(time);
    if (formattedDate.isEmpty) return '';
    if (formattedTime.isEmpty) return formattedDate;
    return '$formattedDate às $formattedTime';
  }

  /// Checks if a schedule date ('YYYY-MM-DD') is upcoming relative to [referenceNow].
  ///
  /// A schedule on today's calendar date is considered upcoming until the end of the day (23:59:59).
  static bool isUpcoming(String? dateStr, [DateTime? referenceNow]) {
    final parsed = _parseCivilYmd(dateStr);
    if (parsed == null) return false;
    final endOfDay = DateTime(parsed.year, parsed.month, parsed.day, 23, 59, 59);
    final now = referenceNow ?? DateTime.now();
    return endOfDay.isAfter(now) || endOfDay.isAtSameMomentAs(now);
  }

  /// Returns human-readable relative weeks/days for an upcoming schedule.
  static String formatWeeksUntil(String? dateStr, [DateTime? referenceNow]) {
    final parsed = _parseCivilYmd(dateStr);
    if (parsed == null) return '';

    final now = referenceNow ?? DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final scheduleDate = DateTime(parsed.year, parsed.month, parsed.day);

    final diffDays = scheduleDate.difference(today).inDays;
    if (diffDays == 0) return 'Hoje';
    if (diffDays == 1) return 'Amanhã';
    if (diffDays > 1 && diffDays < 7) return 'Nesta semana';
    if (diffDays >= 7 && diffDays < 14) return 'Falta 1 semana';
    if (diffDays >= 14) {
      final weeks = diffDays ~/ 7;
      return 'Faltam $weeks semanas';
    }
    return '';
  }

  /// Returns day-granular relative indicator (e.g. 'Hoje', 'Amanhã', 'daqui a 6 dias').
  static String formatRelativeDaysLabel(
    String? dateStr, [
    DateTime? referenceNow,
  ]) {
    final parsed = _parseCivilYmd(dateStr);
    if (parsed == null) return '';

    final now = referenceNow ?? DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final scheduleDate = DateTime(parsed.year, parsed.month, parsed.day);
    final diffDays = scheduleDate.difference(today).inDays;

    if (diffDays == 0) return 'Hoje';
    if (diffDays == 1) return 'Amanhã';
    if (diffDays > 1 && diffDays < 30) return 'daqui a $diffDays dias';
    if (diffDays >= 30 && diffDays < 365) {
      final months = diffDays ~/ 30;
      return months == 1 ? 'daqui a 1 mês' : 'daqui a $months meses';
    }
    if (diffDays >= 365) {
      final years = diffDays ~/ 365;
      return years == 1 ? 'daqui a 1 ano' : 'daqui a $years anos';
    }
    if (diffDays == -1) return 'Ontem';
    final pastDays = -diffDays;
    return pastDays < 30 ? 'há $pastDays dias' : 'Encerrada';
  }

  /// Formats an ISO-8601 timestamp string as local 'DD/MM/YYYY às HH:mm'.
  static String formatTimestampPtBR(String? isoStr) {
    if (isoStr == null || isoStr.trim().isEmpty) return '';
    final parsed = DateTime.tryParse(isoStr.trim())?.toLocal();
    if (parsed == null) return '';
    final day = parsed.day.toString().padLeft(2, '0');
    final month = parsed.month.toString().padLeft(2, '0');
    final hour = parsed.hour.toString().padLeft(2, '0');
    final minute = parsed.minute.toString().padLeft(2, '0');
    return '$day/$month/${parsed.year} às $hour:$minute';
  }

  /// Formats publication date for announcements.
  ///
  /// Displays 'Hoje, HH:mm', 'Ontem, HH:mm', or 'DD/MM/YYYY às HH:mm'.
  static String formatAnnouncementDate(DateTime? dateTime,
      [DateTime? referenceNow]) {
    if (dateTime == null) return '';
    final now = referenceNow ?? DateTime.now();

    final isSameDay = dateTime.year == now.year &&
        dateTime.month == now.month &&
        dateTime.day == now.day;
    final timeStr =
        '${dateTime.hour.toString().padLeft(2, '0')}:${dateTime.minute.toString().padLeft(2, '0')}';

    if (isSameDay) return 'Hoje, $timeStr';

    final yesterday = now.subtract(const Duration(days: 1));
    final isYesterday = dateTime.year == yesterday.year &&
        dateTime.month == yesterday.month &&
        dateTime.day == yesterday.day;

    if (isYesterday) return 'Ontem, $timeStr';

    final day = dateTime.day.toString().padLeft(2, '0');
    final month = dateTime.month.toString().padLeft(2, '0');
    final year = dateTime.year.toString();
    return '$day/$month/$year às $timeStr';
  }
}
