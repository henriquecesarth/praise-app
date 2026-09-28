import 'package:flutter/foundation.dart';
import '../../../../core/utils/date_utils.dart';

/// Pure civil wall-clock model representing a member unavailability period.
///
/// Matches the authoritative backend DTO from `/ministries/:ministryId/availability/my`.
/// Dates and times use strict civil formatting without UTC instant conversion.
@immutable
class MemberAvailability {
  final String id;
  final String ministryId;
  final String memberId;
  final String startDate; // YYYY-MM-DD
  final String endDate; // YYYY-MM-DD
  final String? startTime; // HH:mm
  final String? endTime; // HH:mm
  final bool allDay;
  final String startsAt; // YYYY-MM-DDTHH:mm:ss (civil)
  final String endsAt; // YYYY-MM-DDTHH:mm:ss (civil)
  final String? reason;
  final String createdAt;
  final String updatedAt;

  const MemberAvailability({
    required this.id,
    required this.ministryId,
    required this.memberId,
    required this.startDate,
    required this.endDate,
    this.startTime,
    this.endTime,
    required this.allDay,
    required this.startsAt,
    required this.endsAt,
    this.reason,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MemberAvailability.fromJson(Map<String, dynamic> json) {
    return MemberAvailability(
      id: json['id'] as String? ?? '',
      ministryId: (json['ministryId'] ?? json['ministry_id'] ?? '') as String,
      memberId: (json['memberId'] ?? json['member_id'] ?? '') as String,
      startDate: (json['startDate'] ?? json['start_date'] ?? '') as String,
      endDate: (json['endDate'] ?? json['end_date'] ?? '') as String,
      startTime: (json['startTime'] ?? json['start_time']) as String?,
      endTime: (json['endTime'] ?? json['end_time']) as String?,
      allDay: (json['allDay'] ?? json['all_day'] ?? false) as bool,
      startsAt: (json['startsAt'] ?? json['starts_at'] ?? '') as String,
      endsAt: (json['endsAt'] ?? json['ends_at'] ?? '') as String,
      reason: json['reason'] as String?,
      createdAt: (json['createdAt'] ?? json['created_at'] ?? '') as String,
      updatedAt: (json['updatedAt'] ?? json['updated_at'] ?? '') as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'ministryId': ministryId,
      'memberId': memberId,
      'startDate': startDate,
      'endDate': endDate,
      'startTime': startTime,
      'endTime': endTime,
      'allDay': allDay,
      'startsAt': startsAt,
      'endsAt': endsAt,
      'reason': reason,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  /// Human-readable date and time range in PT-BR.
  String get formattedPeriod {
    final startFmt = AppDateUtils.formatDatePtBR(startDate);
    final endFmt = AppDateUtils.formatDatePtBR(endDate);

    if (allDay) {
      if (startDate == endDate) {
        return '$startFmt • Dia inteiro';
      }
      return '$startFmt a $endFmt • Dia inteiro';
    }

    final startT = AppDateUtils.formatTimePtBR(startTime);
    final endT = AppDateUtils.formatTimePtBR(endTime);

    if (startDate == endDate) {
      return '$startFmt das $startT às $endT';
    }
    return '$startFmt às $startT a $endFmt às $endT';
  }

  /// Checks whether this availability period has completely passed relative to [referenceNow].
  bool isPast([DateTime? referenceNow]) {
    final now = referenceNow ?? DateTime.now();
    final todayStr = _toCivilDateStr(now);

    if (endDate.compareTo(todayStr) < 0) {
      return true;
    }
    if (endDate == todayStr && !allDay && endTime != null) {
      final nowTimeStr =
          '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      return endTime!.compareTo(nowTimeStr) <= 0;
    }
    return false;
  }

  /// Checks whether this availability period is currently active today.
  bool isCurrent([DateTime? referenceNow]) {
    final now = referenceNow ?? DateTime.now();
    final todayStr = _toCivilDateStr(now);

    final started = startDate.compareTo(todayStr) <= 0;
    final ended = isPast(now);
    return started && !ended;
  }

  static String _toCivilDateStr(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MemberAvailability &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          memberId == other.memberId &&
          startDate == other.startDate &&
          endDate == other.endDate &&
          startTime == other.startTime &&
          endTime == other.endTime &&
          allDay == other.allDay &&
          startsAt == other.startsAt &&
          endsAt == other.endsAt &&
          reason == other.reason;

  @override
  int get hashCode =>
      id.hashCode ^
      ministryId.hashCode ^
      memberId.hashCode ^
      startDate.hashCode ^
      endDate.hashCode ^
      startTime.hashCode ^
      endTime.hashCode ^
      allDay.hashCode ^
      startsAt.hashCode ^
      endsAt.hashCode ^
      reason.hashCode;
}

/// Payload sent to `POST /ministries/:ministryId/availability/my`.
@immutable
class CreateAvailabilityPayload {
  final String startDate;
  final String endDate;
  final String? startTime;
  final String? endTime;
  final bool allDay;
  final String? reason;

  const CreateAvailabilityPayload({
    required this.startDate,
    required this.endDate,
    this.startTime,
    this.endTime,
    required this.allDay,
    this.reason,
  });

  Map<String, dynamic> toJson() {
    return {
      'startDate': startDate.trim(),
      'endDate': endDate.trim(),
      'startTime': allDay
          ? null
          : (startTime?.trim().isEmpty == true ? null : startTime?.trim()),
      'endTime': allDay
          ? null
          : (endTime?.trim().isEmpty == true ? null : endTime?.trim()),
      'allDay': allDay,
      'reason':
          reason != null && reason!.trim().isNotEmpty ? reason!.trim() : null,
    };
  }
}

/// Payload sent to `PATCH /ministries/:ministryId/availability/my/:id`.
@immutable
class UpdateAvailabilityPayload {
  final String? startDate;
  final String? endDate;
  final String? startTime;
  final String? endTime;
  final bool? allDay;
  final String? reason;

  const UpdateAvailabilityPayload({
    this.startDate,
    this.endDate,
    this.startTime,
    this.endTime,
    this.allDay,
    this.reason,
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    if (startDate != null) map['startDate'] = startDate!.trim();
    if (endDate != null) map['endDate'] = endDate!.trim();
    if (allDay != null) {
      map['allDay'] = allDay;
      if (allDay == true) {
        map['startTime'] = null;
        map['endTime'] = null;
      } else {
        if (startTime != null) map['startTime'] = startTime!.trim();
        if (endTime != null) map['endTime'] = endTime!.trim();
      }
    } else {
      if (startTime != null) map['startTime'] = startTime!.trim();
      if (endTime != null) map['endTime'] = endTime!.trim();
    }
    if (reason != null) {
      final trimmed = reason!.trim();
      map['reason'] = trimmed.isNotEmpty ? trimmed : null;
    }
    return map;
  }
}

/// Response returned by `GET /ministries/:ministryId/availability/my`.
@immutable
class AvailabilityListResponse {
  final List<MemberAvailability> data;
  final String? nextCursor;

  const AvailabilityListResponse({
    required this.data,
    this.nextCursor,
  });

  factory AvailabilityListResponse.fromJson(Map<String, dynamic> json) {
    final list = (json['data'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(MemberAvailability.fromJson)
        .toList();

    return AvailabilityListResponse(
      data: list,
      nextCursor: json['nextCursor'] as String?,
    );
  }
}

/// Client-side UX validation helper matching backend rules.
class AvailabilityValidator {
  static final RegExp _dateRegex = RegExp(r'^\d{4}-\d{2}-\d{2}$');
  static final RegExp _timeRegex = RegExp(r'^\d{2}:\d{2}$');

  /// Validates availability fields. Returns null if valid, or an error message in PT-BR.
  static String? validate({
    required String startDate,
    required String endDate,
    required bool allDay,
    String? startTime,
    String? endTime,
    String? reason,
  }) {
    final sDate = startDate.trim();
    final eDate = endDate.trim();

    if (sDate.isEmpty || !_dateRegex.hasMatch(sDate)) {
      return 'A data inicial é obrigatória (formato: AAAA-MM-DD).';
    }
    if (eDate.isEmpty || !_dateRegex.hasMatch(eDate)) {
      return 'A data final é obrigatória (formato: AAAA-MM-DD).';
    }

    if (eDate.compareTo(sDate) < 0) {
      return 'A data final não pode ser anterior à data inicial.';
    }

    final startDt = DateTime.tryParse(sDate);
    final endDt = DateTime.tryParse(eDate);
    if (startDt == null || endDt == null) {
      return 'Data inválida informada.';
    }

    // Maximum span: 90 days
    final diffDays = endDt.difference(startDt).inDays;
    if (diffDays > 90) {
      return 'O período de indisponibilidade não pode exceder 90 dias.';
    }

    if (!allDay) {
      final sTime = startTime?.trim() ?? '';
      final eTime = endTime?.trim() ?? '';

      if (sTime.isEmpty || !_timeRegex.hasMatch(sTime)) {
        return 'O horário inicial é obrigatório quando não for dia inteiro.';
      }
      if (eTime.isEmpty || !_timeRegex.hasMatch(eTime)) {
        return 'O horário final é obrigatório quando não for dia inteiro.';
      }

      if (sDate == eDate && eTime.compareTo(sTime) <= 0) {
        return 'O horário final deve ser posterior ao horário inicial.';
      }
    }

    if (reason != null && reason.length > 255) {
      return 'O motivo não pode exceder 255 caracteres.';
    }

    return null;
  }
}
