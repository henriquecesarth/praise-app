/// Pure civil wall-clock date and time formatting utilities.
///
/// Avoids UTC conversions on calendar dates ('YYYY-MM-DD') to ensure
/// dates in timezones like America/Sao_Paulo (UTC-3) never shift backwards.
class AppDateUtils {
  static final RegExp _isoDatePattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})');
  static final RegExp _timePattern = RegExp(r'^(\d{1,2}):(\d{2})');

  /// Formats 'YYYY-MM-DD' as 'DD/MM/YYYY'.
  static String formatDatePtBR(String? value) {
    if (value == null || value.trim().isEmpty) return '';
    final match = _isoDatePattern.firstMatch(value.trim());
    if (match == null) return value;
    return '${match.group(3)}/${match.group(2)}/${match.group(1)}';
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
    if (dateStr == null || dateStr.trim().isEmpty) return false;
    final match = _isoDatePattern.firstMatch(dateStr.trim());
    if (match == null) return false;
    final year = int.tryParse(match.group(1)!);
    final month = int.tryParse(match.group(2)!);
    final day = int.tryParse(match.group(3)!);
    if (year == null || month == null || day == null) return false;

    final endOfDay = DateTime(year, month, day, 23, 59, 59);
    final now = referenceNow ?? DateTime.now();
    return endOfDay.isAfter(now) || endOfDay.isAtSameMomentAs(now);
  }

  /// Returns human-readable relative weeks/days for an upcoming schedule.
  static String formatWeeksUntil(String? dateStr, [DateTime? referenceNow]) {
    if (dateStr == null || dateStr.trim().isEmpty) return '';
    final match = _isoDatePattern.firstMatch(dateStr.trim());
    if (match == null) return '';
    final year = int.tryParse(match.group(1)!);
    final month = int.tryParse(match.group(2)!);
    final day = int.tryParse(match.group(3)!);
    if (year == null || month == null || day == null) return '';

    final now = referenceNow ?? DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final scheduleDate = DateTime(year, month, day);

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
