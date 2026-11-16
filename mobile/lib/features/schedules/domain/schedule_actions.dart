import '../../../core/utils/date_utils.dart';
import 'schedule.dart';

/// Builds a Google Calendar event creation URI from civil date/time fields.
///
/// Uses local civil wall-clock values (`YYYYMMDDTHHmmss/YYYYMMDDTHHmmss`) so
/// schedules are never shifted across timezones by UTC normalization.
Uri? buildGoogleCalendarEventUri(ScheduleDetail schedule) {
  final civil = CivilDate.tryParse(schedule.date);
  if (civil == null) return null;

  var hour = 19;
  var minute = 0;
  final timeMatch = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(schedule.time.trim());
  if (timeMatch != null) {
    hour = (int.tryParse(timeMatch.group(1)!) ?? 19).clamp(0, 23);
    minute = (int.tryParse(timeMatch.group(2)!) ?? 0).clamp(0, 59);
  }

  final duration =
      (schedule.durationMinutes != null && schedule.durationMinutes! > 0)
          ? schedule.durationMinutes!
          : 120;

  final start = DateTime(civil.year, civil.month, civil.day, hour, minute);
  final end = start.add(Duration(minutes: duration));

  String fmt(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '$y$m${d}T$hh${mm}00';
  }

  final detailsBuffer = StringBuffer();
  if (schedule.songs.isNotEmpty) {
    detailsBuffer.writeln('Músicas:');
    for (var i = 0; i < schedule.songs.length; i++) {
      final s = schedule.songs[i];
      final keyPart = (s.key != null && s.key!.trim().isNotEmpty)
          ? ' (Tom: ${s.key!.trim()})'
          : '';
      detailsBuffer.writeln('${i + 1}ª. ${s.title ?? "Música"}$keyPart');
    }
  }
  if (schedule.notes != null && schedule.notes!.trim().isNotEmpty) {
    if (detailsBuffer.isNotEmpty) detailsBuffer.writeln();
    detailsBuffer.writeln('Observações: ${schedule.notes!.trim()}');
  }

  return Uri.https('calendar.google.com', '/calendar/render', {
    'action': 'TEMPLATE',
    'text': schedule.title,
    'dates': '${fmt(start)}/${fmt(end)}',
    if (detailsBuffer.isNotEmpty) 'details': detailsBuffer.toString().trim(),
  });
}

/// Formats a concise shareable summary for clipboard/external sharing.
String buildScheduleShareSummary(ScheduleDetail schedule) {
  final buffer = StringBuffer();
  buffer.writeln('Escala: ${schedule.title}');

  final weekday = AppDateUtils.formatWeekdayPtBR(schedule.date);
  final fullDate = AppDateUtils.formatFullDatePtBR(schedule.date);
  final time = schedule.formattedTime;
  final dateLine = [
    if (weekday.isNotEmpty) weekday,
    if (fullDate.isNotEmpty) fullDate,
    if (time.isNotEmpty) 'às $time',
  ].join(', ');
  if (dateLine.isNotEmpty) {
    buffer.writeln('Data: $dateLine');
  }
  if (schedule.formattedDuration.isNotEmpty) {
    buffer.writeln('Duração: ${schedule.formattedDuration}');
  }

  if (schedule.participants.isNotEmpty) {
    buffer.writeln(
      'Participantes: ${schedule.confirmedCount} de ${schedule.totalParticipants} confirmados',
    );
  }

  if (schedule.songs.isNotEmpty) {
    buffer.writeln();
    buffer.writeln('Músicas:');
    for (var i = 0; i < schedule.songs.length; i++) {
      final song = schedule.songs[i];
      final parts = <String>[
        song.title?.trim().isNotEmpty == true ? song.title!.trim() : 'Música',
        if (song.versionName != null && song.versionName!.trim().isNotEmpty)
          song.versionName!.trim(),
        if (song.key != null && song.key!.trim().isNotEmpty)
          'Tom ${song.key!.trim()}',
      ];
      buffer.writeln('${i + 1}ª ${parts.join(' • ')}');
    }
  }

  if (schedule.notes != null && schedule.notes!.trim().isNotEmpty) {
    buffer.writeln();
    buffer.writeln('Observações: ${schedule.notes!.trim()}');
  }

  return buffer.toString().trim();
}
