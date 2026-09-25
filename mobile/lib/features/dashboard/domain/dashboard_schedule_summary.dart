import 'package:flutter/foundation.dart';
import '../../../../core/utils/date_utils.dart';

/// Participant summary embedded in schedule payload.
@immutable
class DashboardScheduleParticipant {
  final String id;
  final String name;
  final String role;
  final bool? confirmed;

  const DashboardScheduleParticipant({
    required this.id,
    required this.name,
    required this.role,
    this.confirmed,
  });

  factory DashboardScheduleParticipant.fromJson(Map<String, dynamic> json) {
    return DashboardScheduleParticipant(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      role: json['role'] as String? ?? 'Integrante',
      confirmed: json['confirmed'] as bool?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'role': role,
        if (confirmed != null) 'confirmed': confirmed,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DashboardScheduleParticipant &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          name == other.name &&
          role == other.role &&
          confirmed == other.confirmed;

  @override
  int get hashCode =>
      id.hashCode ^ name.hashCode ^ role.hashCode ^ confirmed.hashCode;
}

/// Concise schedule model for dashboard display.
///
/// Maps raw record from `GET /api/v1/ministries/:id/schedules`.
@immutable
class DashboardScheduleSummary {
  final String id;
  final String ministryId;
  final String title;
  final String date; // YYYY-MM-DD
  final String time; // HH:mm
  final int? durationMinutes;
  final String? notes;
  final bool isVisible;
  final String? colorPalette;
  final List<DashboardScheduleParticipant> participants;
  final int songsCount;
  final DateTime? createdAt;

  const DashboardScheduleSummary({
    required this.id,
    required this.ministryId,
    required this.title,
    required this.date,
    this.time = '19:00',
    this.durationMinutes,
    this.notes,
    this.isVisible = true,
    this.colorPalette,
    this.participants = const [],
    this.songsCount = 0,
    this.createdAt,
  });

  factory DashboardScheduleSummary.fromJson(Map<String, dynamic> json) {
    final rawParticipants = json['participants'];
    final participants = <DashboardScheduleParticipant>[];
    if (rawParticipants is List) {
      for (final p in rawParticipants) {
        if (p is Map<String, dynamic>) {
          participants.add(DashboardScheduleParticipant.fromJson(p));
        }
      }
    }

    final rawSongs = json['songs'];
    final songsCount = rawSongs is List ? rawSongs.length : 0;

    DateTime? parseDate(dynamic val) {
      if (val is String && val.isNotEmpty) {
        return DateTime.tryParse(val);
      }
      return null;
    }

    final rawDuration = json['duration_minutes'] ?? json['durationMinutes'];
    final duration = rawDuration is num ? rawDuration.toInt() : null;

    return DashboardScheduleSummary(
      id: json['id'] as String? ?? '',
      ministryId:
          json['ministry_id'] as String? ?? json['ministryId'] as String? ?? '',
      title: json['title'] as String? ?? 'Culto',
      date: json['date'] as String? ?? '',
      time: json['time'] as String? ?? '19:00',
      durationMinutes: duration,
      notes: json['notes'] as String?,
      isVisible: json['isVisible'] as bool? ?? true,
      colorPalette: json['colorPalette'] as String?,
      participants: participants,
      songsCount: songsCount,
      createdAt: parseDate(json['created_at'] ?? json['createdAt']),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ministry_id': ministryId,
        'title': title,
        'date': date,
        'time': time,
        if (durationMinutes != null) 'duration_minutes': durationMinutes,
        if (notes != null) 'notes': notes,
        'isVisible': isVisible,
        if (colorPalette != null) 'colorPalette': colorPalette,
        'participants': participants.map((p) => p.toJson()).toList(),
        'songs_count': songsCount,
        if (createdAt != null) 'created_at': createdAt?.toIso8601String(),
      };

  /// True if schedule occurs today or in the future.
  bool isUpcoming([DateTime? referenceNow]) =>
      AppDateUtils.isUpcoming(date, referenceNow);

  /// Human-readable schedule date in PT-BR conventions ('DD/MM/YYYY').
  String get formattedDate => AppDateUtils.formatDatePtBR(date);

  /// Human-readable schedule time in 24h format ('HH:mm').
  String get formattedTime => AppDateUtils.formatTimePtBR(time);

  /// Formatted date and time ('DD/MM/YYYY às HH:mm').
  String get formattedDateTime =>
      AppDateUtils.formatScheduleDateTimePtBR(date, time);

  /// Relative indicator ('Hoje', 'Nesta semana', etc.).
  String weeksUntil([DateTime? referenceNow]) =>
      AppDateUtils.formatWeeksUntil(date, referenceNow);

  /// Total count of assigned participants.
  int get totalParticipants => participants.length;

  /// Count of participants with confirmed attendance.
  int get confirmedCount =>
      participants.where((p) => p.confirmed == true).length;

  /// Count of participants marked as unavailable/declined.
  int get declinedCount =>
      participants.where((p) => p.confirmed == false).length;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DashboardScheduleSummary &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          title == other.title &&
          date == other.date &&
          time == other.time &&
          durationMinutes == other.durationMinutes &&
          notes == other.notes &&
          isVisible == other.isVisible &&
          colorPalette == other.colorPalette &&
          listEquals(participants, other.participants) &&
          songsCount == other.songsCount;

  @override
  int get hashCode =>
      id.hashCode ^
      ministryId.hashCode ^
      title.hashCode ^
      date.hashCode ^
      time.hashCode ^
      durationMinutes.hashCode ^
      notes.hashCode ^
      isVisible.hashCode ^
      colorPalette.hashCode ^
      Object.hashAll(participants) ^
      songsCount.hashCode;
}
