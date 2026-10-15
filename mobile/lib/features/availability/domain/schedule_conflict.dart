import 'package:flutter/foundation.dart';

/// Pure civil wall-clock window for a schedule service.
@immutable
class ScheduleCivilWindow {
  final String startsAt;
  final String endsAt;
  final int durationMinutes;
  final String durationSource;

  const ScheduleCivilWindow({
    required this.startsAt,
    required this.endsAt,
    required this.durationMinutes,
    this.durationSource = 'explicit',
  });

  factory ScheduleCivilWindow.fromJson(Map<String, dynamic> json) {
    return ScheduleCivilWindow(
      startsAt: json['startsAt'] as String? ?? '',
      endsAt: json['endsAt'] as String? ?? '',
      durationMinutes: (json['durationMinutes'] as num?)?.toInt() ?? 120,
      durationSource: json['durationSource'] as String? ?? 'explicit',
    );
  }

  Map<String, dynamic> toJson() => {
        'startsAt': startsAt,
        'endsAt': endsAt,
        'durationMinutes': durationMinutes,
        'durationSource': durationSource,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleCivilWindow &&
          runtimeType == other.runtimeType &&
          startsAt == other.startsAt &&
          endsAt == other.endsAt &&
          durationMinutes == other.durationMinutes &&
          durationSource == other.durationSource;

  @override
  int get hashCode =>
      Object.hash(startsAt, endsAt, durationMinutes, durationSource);
}

/// Details of a specific unavailability interval conflicting with a schedule.
///
/// NOTE: Reason and private user notes are strictly omitted by the backend
/// contract to protect member privacy.
@immutable
class ParticipantConflictDetail {
  final String id;
  final String startsAt;
  final String endsAt;
  final bool allDay;

  const ParticipantConflictDetail({
    required this.id,
    required this.startsAt,
    required this.endsAt,
    required this.allDay,
  });

  factory ParticipantConflictDetail.fromJson(Map<String, dynamic> json) {
    return ParticipantConflictDetail(
      id: json['id'] as String? ?? '',
      startsAt: json['startsAt'] as String? ?? '',
      endsAt: json['endsAt'] as String? ?? '',
      allDay: json['allDay'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'startsAt': startsAt,
        'endsAt': endsAt,
        'allDay': allDay,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ParticipantConflictDetail &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          startsAt == other.startsAt &&
          endsAt == other.endsAt &&
          allDay == other.allDay;

  @override
  int get hashCode => Object.hash(id, startsAt, endsAt, allDay);
}

/// Conflict result for a single participant or candidate.
@immutable
class ParticipantConflictResult {
  final String participantId;
  final String? memberId;
  final bool hasConflict;
  final List<ParticipantConflictDetail> unavailabilities;

  const ParticipantConflictResult({
    required this.participantId,
    this.memberId,
    required this.hasConflict,
    this.unavailabilities = const [],
  });

  factory ParticipantConflictResult.fromJson(Map<String, dynamic> json) {
    final rawUnavailabilities =
        json['unavailabilities'] as List<dynamic>? ?? [];
    return ParticipantConflictResult(
      participantId: json['participantId'] as String? ?? '',
      memberId: json['memberId'] as String?,
      hasConflict: json['hasConflict'] as bool? ?? false,
      unavailabilities: rawUnavailabilities
          .whereType<Map<String, dynamic>>()
          .map(ParticipantConflictDetail.fromJson)
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'participantId': participantId,
        if (memberId != null) 'memberId': memberId,
        'hasConflict': hasConflict,
        'unavailabilities': unavailabilities.map((u) => u.toJson()).toList(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ParticipantConflictResult &&
          runtimeType == other.runtimeType &&
          participantId == other.participantId &&
          memberId == other.memberId &&
          hasConflict == other.hasConflict &&
          listEquals(unavailabilities, other.unavailabilities);

  @override
  int get hashCode => Object.hash(
        participantId,
        memberId,
        hasConflict,
        Object.hashAll(unavailabilities),
      );
}

/// Authoritative response from `POST /api/v1/ministries/:ministryId/availability/check-conflicts`.
@immutable
class ScheduleConflictCheckResponse {
  final ScheduleCivilWindow scheduleWindow;
  final List<ParticipantConflictResult> conflicts;
  final List<String> unresolvedParticipantIds;

  const ScheduleConflictCheckResponse({
    required this.scheduleWindow,
    this.conflicts = const [],
    this.unresolvedParticipantIds = const [],
  });

  factory ScheduleConflictCheckResponse.fromJson(Map<String, dynamic> json) {
    final windowMap = json['scheduleWindow'] as Map<String, dynamic>? ?? {};
    final rawConflicts = json['conflicts'] as List<dynamic>? ?? [];
    final rawUnresolved =
        json['unresolvedParticipantIds'] as List<dynamic>? ?? [];

    return ScheduleConflictCheckResponse(
      scheduleWindow: ScheduleCivilWindow.fromJson(windowMap),
      conflicts: rawConflicts
          .whereType<Map<String, dynamic>>()
          .map(ParticipantConflictResult.fromJson)
          .toList(),
      unresolvedParticipantIds: rawUnresolved.whereType<String>().toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'scheduleWindow': scheduleWindow.toJson(),
        'conflicts': conflicts.map((c) => c.toJson()).toList(),
        'unresolvedParticipantIds': unresolvedParticipantIds,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleConflictCheckResponse &&
          runtimeType == other.runtimeType &&
          scheduleWindow == other.scheduleWindow &&
          listEquals(conflicts, other.conflicts) &&
          listEquals(unresolvedParticipantIds, other.unresolvedParticipantIds);

  @override
  int get hashCode => Object.hash(
        scheduleWindow,
        Object.hashAll(conflicts),
        Object.hashAll(unresolvedParticipantIds),
      );
}

/// Input payload for checking availability conflicts.
@immutable
class CheckScheduleConflictsPayload {
  final String date; // YYYY-MM-DD
  final String time; // HH:mm
  final int? durationMinutes; // 15..1440
  final List<String> participantIds; // 1..50

  const CheckScheduleConflictsPayload({
    required this.date,
    required this.time,
    this.durationMinutes,
    required this.participantIds,
  });

  Map<String, dynamic> toJson() => {
        'date': date,
        'time': time,
        if (durationMinutes != null) 'durationMinutes': durationMinutes,
        'participantIds': participantIds,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CheckScheduleConflictsPayload &&
          runtimeType == other.runtimeType &&
          date == other.date &&
          time == other.time &&
          durationMinutes == other.durationMinutes &&
          listEquals(participantIds, other.participantIds);

  @override
  int get hashCode => Object.hash(
        date,
        time,
        durationMinutes,
        Object.hashAll(participantIds),
      );
}
