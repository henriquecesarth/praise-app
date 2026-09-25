import 'package:flutter/foundation.dart';
import '../../../../core/utils/date_utils.dart';
import 'schedule_participant.dart';

/// Song summary embedded in schedule payload.
@immutable
class ScheduleSong {
  final String id;
  final String? title;
  final String? artist;
  final String? key;

  const ScheduleSong({
    required this.id,
    this.title,
    this.artist,
    this.key,
  });

  factory ScheduleSong.fromJson(Map<String, dynamic> json) {
    return ScheduleSong(
      id: json['id'] as String? ?? json['songId'] as String? ?? '',
      title: json['title'] as String?,
      artist: json['artist'] as String?,
      key: json['key'] as String?,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleSong &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          title == other.title;

  @override
  int get hashCode => id.hashCode ^ title.hashCode;
}

/// Timeline item embedded in schedule payload.
@immutable
class ScheduleTimelineItem {
  final String id;
  final String title;
  final String? time;
  final String type;

  const ScheduleTimelineItem({
    required this.id,
    required this.title,
    this.time,
    required this.type,
  });

  factory ScheduleTimelineItem.fromJson(Map<String, dynamic> json) {
    return ScheduleTimelineItem(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      time: json['time'] as String?,
      type: json['type'] as String? ?? 'other',
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleTimelineItem &&
          runtimeType == other.runtimeType &&
          id == other.id;

  @override
  int get hashCode => id.hashCode;
}

/// Clothing piece embedded in schedule payload.
@immutable
class ScheduleClothingPiece {
  final String? description;
  final String? colorHex;

  const ScheduleClothingPiece({this.description, this.colorHex});

  factory ScheduleClothingPiece.fromJson(Map<String, dynamic> json) {
    return ScheduleClothingPiece(
      description: json['description'] as String?,
      colorHex: json['colorHex'] as String? ?? json['color'] as String?,
    );
  }
}

/// Full schedule detail model for the member-facing detail screen.
///
/// Maps raw ScheduleRecord from:
///   GET /api/v1/ministries/:ministryId/schedules/:scheduleId
///   PATCH /api/v1/ministries/:ministryId/schedules/:scheduleId/confirmation (response)
///
/// Civil date policy:
///   [date] is YYYY-MM-DD — treated as a civil DATE_ONLY without UTC conversion.
///   [time] is HH:mm — treated as a LOCAL_TIME without UTC conversion.
///   Never parse date/time through DateTime.parse with a UTC suffix.
@immutable
class ScheduleDetail {
  final String id;
  final String ministryId;
  final String title;

  /// Civil date only: 'YYYY-MM-DD'. No UTC conversion.
  final String date;

  /// Local time: 'HH:mm'. No UTC conversion.
  final String time;

  /// Duration in minutes. Backend emits both `duration_minutes` and
  /// `durationMinutes` for compatibility — fromJson accepts either.
  final int? durationMinutes;

  final String? notes;
  final bool isVisible;
  final String? colorPalette;
  final bool requireConfirmation;
  final List<ScheduleParticipant> participants;
  final List<ScheduleSong> songs;
  final List<ScheduleTimelineItem> timeline;
  final List<ScheduleClothingPiece> clothingPieces;
  final String createdAt;
  final String updatedAt;

  const ScheduleDetail({
    required this.id,
    required this.ministryId,
    required this.title,
    required this.date,
    this.time = '19:00',
    this.durationMinutes,
    this.notes,
    this.isVisible = true,
    this.colorPalette,
    this.requireConfirmation = false,
    this.participants = const [],
    this.songs = const [],
    this.timeline = const [],
    this.clothingPieces = const [],
    this.createdAt = '',
    this.updatedAt = '',
  });

  factory ScheduleDetail.fromJson(Map<String, dynamic> json) {
    List<ScheduleParticipant> parseParticipants(dynamic raw) {
      if (raw is! List) return const [];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(ScheduleParticipant.fromJson)
          .toList();
    }

    List<ScheduleSong> parseSongs(dynamic raw) {
      if (raw is! List) return const [];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(ScheduleSong.fromJson)
          .toList();
    }

    List<ScheduleTimelineItem> parseTimeline(dynamic raw) {
      if (raw is! List) return const [];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(ScheduleTimelineItem.fromJson)
          .toList();
    }

    List<ScheduleClothingPiece> parseClothing(dynamic raw) {
      if (raw is! List) return const [];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(ScheduleClothingPiece.fromJson)
          .toList();
    }

    // Backend may return duration_minutes, durationMinutes, or both.
    final rawDuration = json['duration_minutes'] ?? json['durationMinutes'];
    final duration = rawDuration is num ? rawDuration.toInt() : null;

    return ScheduleDetail(
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
      requireConfirmation: json['requireConfirmation'] as bool? ?? false,
      participants: parseParticipants(json['participants']),
      songs: parseSongs(json['songs']),
      timeline: parseTimeline(json['timeline']),
      clothingPieces: parseClothing(json['clothingPieces']),
      createdAt: json['created_at'] as String? ?? '',
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }

  /// Human-readable date: 'DD/MM/YYYY'.
  String get formattedDate => AppDateUtils.formatDatePtBR(date);

  /// Human-readable time: 'HH:mm'.
  String get formattedTime => AppDateUtils.formatTimePtBR(time);

  /// Combined date and time: 'DD/MM/YYYY às HH:mm'.
  String get formattedDateTime =>
      AppDateUtils.formatScheduleDateTimePtBR(date, time);

  /// Human-readable duration, e.g. '2h 30min' or '45min'.
  String get formattedDuration {
    final min = durationMinutes;
    if (min == null || min <= 0) return '';
    if (min < 60) return '${min}min';
    final h = min ~/ 60;
    final m = min % 60;
    return m == 0 ? '${h}h' : '${h}h ${m}min';
  }

  /// True if schedule is today or in the future (civil-date comparison).
  bool isUpcoming([DateTime? referenceNow]) =>
      AppDateUtils.isUpcoming(date, referenceNow);

  /// Relative label: 'Hoje', 'Amanhã', 'Nesta semana', etc.
  String weeksUntil([DateTime? referenceNow]) =>
      AppDateUtils.formatWeeksUntil(date, referenceNow);

  /// Confirmed participant count.
  int get confirmedCount =>
      participants.where((p) => p.confirmed == true).length;

  /// Total participant count.
  int get totalParticipants => participants.length;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleDetail &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          updatedAt == other.updatedAt;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode ^ updatedAt.hashCode;

  @override
  String toString() =>
      'ScheduleDetail(id: $id, ministryId: $ministryId, title: $title, date: $date)';
}

/// Schedule summary for list display.
///
/// Maps raw ScheduleRecord from GET /api/v1/ministries/:ministryId/schedules.
@immutable
class ScheduleSummary {
  final String id;
  final String ministryId;
  final String title;
  final String date; // YYYY-MM-DD civil date
  final String time; // HH:mm local time
  final int? durationMinutes;
  final List<ScheduleParticipant> participants;
  final int songsCount;

  const ScheduleSummary({
    required this.id,
    required this.ministryId,
    required this.title,
    required this.date,
    this.time = '19:00',
    this.durationMinutes,
    this.participants = const [],
    this.songsCount = 0,
  });

  factory ScheduleSummary.fromJson(Map<String, dynamic> json) {
    List<ScheduleParticipant> parseParticipants(dynamic raw) {
      if (raw is! List) return const [];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(ScheduleParticipant.fromJson)
          .toList();
    }

    final rawDuration = json['duration_minutes'] ?? json['durationMinutes'];
    final duration = rawDuration is num ? rawDuration.toInt() : null;
    final rawSongs = json['songs'];
    final songsCount = rawSongs is List ? rawSongs.length : 0;

    return ScheduleSummary(
      id: json['id'] as String? ?? '',
      ministryId:
          json['ministry_id'] as String? ?? json['ministryId'] as String? ?? '',
      title: json['title'] as String? ?? 'Culto',
      date: json['date'] as String? ?? '',
      time: json['time'] as String? ?? '19:00',
      durationMinutes: duration,
      participants: parseParticipants(json['participants']),
      songsCount: songsCount,
    );
  }

  /// True if schedule is today or in the future.
  bool isUpcoming([DateTime? referenceNow]) =>
      AppDateUtils.isUpcoming(date, referenceNow);

  /// Human-readable date 'DD/MM/YYYY'.
  String get formattedDate => AppDateUtils.formatDatePtBR(date);

  /// Human-readable time 'HH:mm'.
  String get formattedTime => AppDateUtils.formatTimePtBR(time);

  /// Combined 'DD/MM/YYYY às HH:mm'.
  String get formattedDateTime =>
      AppDateUtils.formatScheduleDateTimePtBR(date, time);

  /// Relative label.
  String weeksUntil([DateTime? referenceNow]) =>
      AppDateUtils.formatWeeksUntil(date, referenceNow);

  int get confirmedCount =>
      participants.where((p) => p.confirmed == true).length;

  int get totalParticipants => participants.length;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleSummary &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode;

  @override
  String toString() => 'ScheduleSummary(id: $id, title: $title, date: $date)';
}
