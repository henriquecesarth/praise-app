import 'package:flutter/foundation.dart';
import 'package:louvaio_mobile/core/utils/date_utils.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';

/// Pure civil model representing an item in the consolidated administrative availability view.
///
/// Matches backend DTO from `GET /api/v1/ministries/:ministryId/availability`.
/// PRIVACY INVARIANT: 'reason', 'user_id', and internal user metadata are strictly omitted by design.
@immutable
class ConsolidatedAvailabilityItem {
  final String id;
  final String ministryId;
  final String memberId;
  final String memberName;
  final String startDate; // YYYY-MM-DD
  final String endDate; // YYYY-MM-DD
  final String? startTime; // HH:mm
  final String? endTime; // HH:mm
  final bool allDay;
  final String startsAt; // YYYY-MM-DDTHH:mm:ss (civil)
  final String endsAt; // YYYY-MM-DDTHH:mm:ss (civil)

  const ConsolidatedAvailabilityItem({
    required this.id,
    required this.ministryId,
    required this.memberId,
    required this.memberName,
    required this.startDate,
    required this.endDate,
    this.startTime,
    this.endTime,
    required this.allDay,
    required this.startsAt,
    required this.endsAt,
  });

  factory ConsolidatedAvailabilityItem.fromJson(Map<String, dynamic> json) {
    return ConsolidatedAvailabilityItem(
      id: json['id'] as String? ?? '',
      ministryId: (json['ministryId'] ?? json['ministry_id'] ?? '') as String,
      memberId: (json['memberId'] ?? json['member_id'] ?? '') as String,
      memberName: (json['memberName'] ?? json['member_name'] ?? 'Integrante') as String,
      startDate: (json['startDate'] ?? json['start_date'] ?? '') as String,
      endDate: (json['endDate'] ?? json['end_date'] ?? '') as String,
      startTime: (json['startTime'] ?? json['start_time']) as String?,
      endTime: (json['endTime'] ?? json['end_time']) as String?,
      allDay: (json['allDay'] ?? json['all_day'] ?? false) as bool,
      startsAt: (json['startsAt'] ?? json['starts_at'] ?? '') as String,
      endsAt: (json['endsAt'] ?? json['ends_at'] ?? '') as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'ministryId': ministryId,
      'memberId': memberId,
      'memberName': memberName,
      'startDate': startDate,
      'endDate': endDate,
      'startTime': startTime,
      'endTime': endTime,
      'allDay': allDay,
      'startsAt': startsAt,
      'endsAt': endsAt,
    };
  }

  /// Formatted period representation in PT-BR.
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

  /// Evaluates whether this unavailability period has completely passed.
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

  /// Evaluates whether this period is currently active today.
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
      other is ConsolidatedAvailabilityItem &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          memberId == other.memberId &&
          memberName == other.memberName &&
          startDate == other.startDate &&
          endDate == other.endDate &&
          startTime == other.startTime &&
          endTime == other.endTime &&
          allDay == other.allDay &&
          startsAt == other.startsAt &&
          endsAt == other.endsAt;

  @override
  int get hashCode =>
      id.hashCode ^
      ministryId.hashCode ^
      memberId.hashCode ^
      memberName.hashCode ^
      startDate.hashCode ^
      endDate.hashCode ^
      startTime.hashCode ^
      endTime.hashCode ^
      allDay.hashCode ^
      startsAt.hashCode ^
      endsAt.hashCode;
}

/// Civil date planning window returned in the consolidated availability response.
@immutable
class CivilPlanningWindow {
  final String from;
  final String to;

  const CivilPlanningWindow({
    required this.from,
    required this.to,
  });

  factory CivilPlanningWindow.fromJson(Map<String, dynamic> json) {
    return CivilPlanningWindow(
      from: json['from'] as String? ?? '',
      to: json['to'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {'from': from, 'to': to};
}

/// Authoritative response DTO for `GET /api/v1/ministries/:ministryId/availability`.
@immutable
class ConsolidatedAvailabilityResponse {
  final CivilPlanningWindow? window;
  final List<ConsolidatedAvailabilityItem> data;
  final String? nextCursor;

  const ConsolidatedAvailabilityResponse({
    this.window,
    required this.data,
    this.nextCursor,
  });

  factory ConsolidatedAvailabilityResponse.fromJson(Map<String, dynamic> json) {
    final list = (json['data'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(ConsolidatedAvailabilityItem.fromJson)
        .toList();

    CivilPlanningWindow? win;
    if (json['window'] is Map<String, dynamic>) {
      win = CivilPlanningWindow.fromJson(json['window'] as Map<String, dynamic>);
    }

    return ConsolidatedAvailabilityResponse(
      window: win,
      data: list,
      nextCursor: json['nextCursor'] as String?,
    );
  }
}

/// Period helper for administrative date range selection and validation.
class AvailabilityPlanningPeriod {
  static const int maxInclusiveDays = 90;

  static String _pad2(int n) => n.toString().padLeft(2, '0');

  static String formatIsoDate(DateTime dt) {
    return '${dt.year.toString().padLeft(4, '0')}-${_pad2(dt.month)}-${_pad2(dt.day)}';
  }

  static DateTime? parseIsoDate(String str) {
    final trimmed = str.trim();
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(trimmed)) return null;
    return DateTime.tryParse(trimmed);
  }

  /// Preset: next 7 days (today to today + 6).
  static ({String from, String to}) preset7Days([DateTime? referenceNow]) {
    final now = referenceNow ?? DateTime.now();
    final start = CivilDate(now.year, now.month, now.day);
    final end = start.addDays(6);
    return (from: start.toIsoDate(), to: end.toIsoDate());
  }

  /// Preset: next 15 days (today to today + 14).
  static ({String from, String to}) preset15Days([DateTime? referenceNow]) {
    final now = referenceNow ?? DateTime.now();
    final start = CivilDate(now.year, now.month, now.day);
    final end = start.addDays(14);
    return (from: start.toIsoDate(), to: end.toIsoDate());
  }

  /// Preset: next 30 days (today to today + 29).
  static ({String from, String to}) preset30Days([DateTime? referenceNow]) {
    final now = referenceNow ?? DateTime.now();
    final start = CivilDate(now.year, now.month, now.day);
    final end = start.addDays(29);
    return (from: start.toIsoDate(), to: end.toIsoDate());
  }

  /// Preset: this month (first day to last day of current month).
  static ({String from, String to}) presetThisMonth([DateTime? referenceNow]) {
    final now = referenceNow ?? DateTime.now();
    final start = CivilDate(now.year, now.month, 1);
    final daysInMonth = CivilDate.daysInMonth(now.year, now.month);
    final end = CivilDate(now.year, now.month, daysInMonth);
    return (from: start.toIsoDate(), to: end.toIsoDate());
  }

  /// Calculates inclusive days between two civil dates.
  /// Returns negative value if to < from.
  static int calculateInclusiveDays(String from, String to) {
    final cFrom = CivilDate.tryParse(from);
    final cTo = CivilDate.tryParse(to);
    if (cFrom == null || cTo == null) return -1;
    if (cTo < cFrom) return -1;
    return cFrom.inclusiveDaysTo(cTo);
  }

  /// Validates planning date range. Returns null if valid, or an error message in PT-BR.
  static String? validateRange(String from, String to) {
    final cFrom = CivilDate.tryParse(from);
    final cTo = CivilDate.tryParse(to);

    if (cFrom == null) {
      return 'A data inicial é obrigatória (formato: AAAA-MM-DD).';
    }
    if (cTo == null) {
      return 'A data final é obrigatória (formato: AAAA-MM-DD).';
    }

    if (cTo < cFrom) {
      return 'A data final não pode ser anterior à data inicial.';
    }

    final days = calculateInclusiveDays(from, to);
    if (days > maxInclusiveDays) {
      return 'O período de consulta não pode exceder 90 dias civis (selecionado: $days dias).';
    }

    return null;
  }
}

/// Helper to evaluate canonical manual-member eligibility for administrative availability mutation.
///
/// Invariant:
/// - `is_manual === true`
/// - `user_id == null` (strictly absent/null; empty string or whitespace does not qualify)
/// - Active (not removed).
class ManualMemberEligibility {
  static bool isEligible(MinistryMember member) =>
      member.isEligibleManualMember;
}
