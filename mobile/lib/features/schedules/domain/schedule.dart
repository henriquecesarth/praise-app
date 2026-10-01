import 'package:flutter/foundation.dart';
import '../../../../core/utils/date_utils.dart';
import 'schedule_participant.dart';

/// Song summary embedded in schedule payload.
///
/// Preserves unknown/opaque fields from backend/web losslessly via [rawJson].
@immutable
class ScheduleSong {
  final String id;
  final String? title;
  final String? artist;
  final String? key;
  final Map<String, dynamic> rawJson;

  const ScheduleSong({
    required this.id,
    this.title,
    this.artist,
    this.key,
    this.rawJson = const {},
  });

  factory ScheduleSong.fromJson(Map<String, dynamic> json) {
    return ScheduleSong(
      id: json['id'] as String? ?? json['songId'] as String? ?? '',
      title: json['title'] as String?,
      artist: json['artist'] as String?,
      key: json['key'] as String?,
      rawJson: Map<String, dynamic>.unmodifiable(json),
    );
  }

  Map<String, dynamic> toJson() {
    if (rawJson.isNotEmpty) {
      final map = Map<String, dynamic>.from(rawJson);
      map['id'] = id;
      if (title != null) map['title'] = title;
      if (artist != null) map['artist'] = artist;
      if (key != null) map['key'] = key;
      return map;
    }
    return {
      'id': id,
      if (title != null) 'title': title,
      if (artist != null) 'artist': artist,
      if (key != null) 'key': key,
    };
  }

  ScheduleSong copyWith({
    String? id,
    String? title,
    String? artist,
    String? key,
    Map<String, dynamic>? rawJson,
  }) {
    return ScheduleSong(
      id: id ?? this.id,
      title: title ?? this.title,
      artist: artist ?? this.artist,
      key: key ?? this.key,
      rawJson: rawJson ?? this.rawJson,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleSong &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          title == other.title &&
          artist == other.artist &&
          key == other.key &&
          mapEquals(rawJson, other.rawJson);

  @override
  int get hashCode => id.hashCode ^ title.hashCode ^ artist.hashCode ^ key.hashCode;
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

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        if (time != null) 'time': time,
        'type': type,
      };

  ScheduleTimelineItem copyWith({
    String? id,
    String? title,
    String? time,
    String? type,
  }) {
    return ScheduleTimelineItem(
      id: id ?? this.id,
      title: title ?? this.title,
      time: time ?? this.time,
      type: type ?? this.type,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleTimelineItem &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          title == other.title &&
          time == other.time &&
          type == other.type;

  @override
  int get hashCode =>
      id.hashCode ^ title.hashCode ^ time.hashCode ^ type.hashCode;
}

/// Clothing piece embedded in schedule payload matching web/canonical structure:
/// { id, name, description, colors: [...] }
@immutable
class ScheduleClothingPiece {
  final String id;
  final String name;
  final String description;
  final List<String> colors;
  final String? colorHex;

  const ScheduleClothingPiece({
    this.id = '',
    this.name = '',
    this.description = '',
    this.colors = const [],
    this.colorHex,
  });

  factory ScheduleClothingPiece.fromJson(Map<String, dynamic> json) {
    final rawColors = json['colors'];
    final List<String> parsedColors = [];
    if (rawColors is List) {
      for (final c in rawColors) {
        if (c != null) {
          final s = c.toString().trim();
          if (s.isNotEmpty) parsedColors.add(s);
        }
      }
    }
    final singleColor = json['colorHex'] as String? ?? json['color'] as String?;
    if (parsedColors.isEmpty && singleColor != null && singleColor.trim().isNotEmpty) {
      parsedColors.add(singleColor.trim());
    }

    final rawName = json['name'] as String? ?? '';
    final rawDesc = json['description'] as String? ?? '';
    final resolvedName = rawName.isNotEmpty ? rawName : rawDesc;
    final resolvedDesc = rawDesc.isNotEmpty ? rawDesc : rawName;

    return ScheduleClothingPiece(
      id: json['id']?.toString() ?? '',
      name: resolvedName,
      description: resolvedDesc,
      colors: List.unmodifiable(parsedColors),
      colorHex: parsedColors.isNotEmpty ? parsedColors.first : singleColor,
    );
  }

  Map<String, dynamic> toJson() {
    final effectiveColors = colors.isNotEmpty
        ? colors
        : (colorHex != null && colorHex!.trim().isNotEmpty
            ? [colorHex!.trim()]
            : const <String>[]);
    final effectiveName = name.isNotEmpty
        ? name
        : (description.isNotEmpty ? description : 'Peça de roupa');
    final effectiveDesc = description.isNotEmpty
        ? description
        : (name.isNotEmpty ? name : 'Peça de roupa');

    return {
      if (id.isNotEmpty) 'id': id,
      'name': effectiveName,
      'description': effectiveDesc,
      'colors': effectiveColors,
      if (effectiveColors.isNotEmpty) 'colorHex': effectiveColors.first,
    };
  }

  ScheduleClothingPiece copyWith({
    String? id,
    String? name,
    String? description,
    List<String>? colors,
    String? colorHex,
  }) {
    List<String>? resolvedColors = colors;
    if (resolvedColors == null && colorHex != null) {
      if (this.colors.length > 1) {
        resolvedColors = [colorHex, ...this.colors.skip(1)];
      } else {
        resolvedColors = [colorHex];
      }
    }
    final newColorHex = colorHex ??
        (resolvedColors != null && resolvedColors.isNotEmpty
            ? resolvedColors.first
            : this.colorHex);

    return ScheduleClothingPiece(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      colors: resolvedColors ?? this.colors,
      colorHex: newColorHex,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! ScheduleClothingPiece || runtimeType != other.runtimeType) {
      return false;
    }
    final effectiveColorsThis = colors.isNotEmpty
        ? colors
        : (colorHex != null ? [colorHex!] : const <String>[]);
    final effectiveColorsOther = other.colors.isNotEmpty
        ? other.colors
        : (other.colorHex != null ? [other.colorHex!] : const <String>[]);

    return id == other.id &&
        (name == other.name || name.isEmpty || other.name.isEmpty) &&
        (description == other.description ||
            description.isEmpty ||
            other.description.isEmpty) &&
        listEquals(effectiveColorsThis, effectiveColorsOther);
  }

  @override
  int get hashCode =>
      id.hashCode ^
      name.hashCode ^
      description.hashCode ^
      (colors.isNotEmpty ? colors.first.hashCode : (colorHex?.hashCode ?? 0));
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
