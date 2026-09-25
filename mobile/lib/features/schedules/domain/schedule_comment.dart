import 'package:flutter/foundation.dart';

/// Comment on a schedule, as returned by:
///   GET  /api/v1/ministries/:ministryId/schedules/:scheduleId/comments
///   POST /api/v1/ministries/:ministryId/schedules/:scheduleId/comments (HTTP 201)
///
/// Field contract mirrors backend ScheduleCommentRecord.
@immutable
class ScheduleComment {
  final String id;
  final String scheduleId;
  final String ministryId;
  final String userId;
  final String userName;
  final String content;

  /// ISO-8601 string from the backend. Displayed chronologically (ascending).
  final String createdAt;

  const ScheduleComment({
    required this.id,
    required this.scheduleId,
    required this.ministryId,
    required this.userId,
    required this.userName,
    required this.content,
    required this.createdAt,
  });

  factory ScheduleComment.fromJson(Map<String, dynamic> json) {
    return ScheduleComment(
      id: json['id'] as String? ?? '',
      scheduleId:
          json['schedule_id'] as String? ?? json['scheduleId'] as String? ?? '',
      ministryId:
          json['ministry_id'] as String? ?? json['ministryId'] as String? ?? '',
      userId: json['user_id'] as String? ?? json['userId'] as String? ?? '',
      userName: json['user_name'] as String? ??
          json['userName'] as String? ??
          'Usuário',
      content: json['content'] as String? ?? '',
      createdAt:
          json['created_at'] as String? ?? json['createdAt'] as String? ?? '',
    );
  }

  /// Parsed creation time for display formatting.
  DateTime? get createdAtDateTime => DateTime.tryParse(createdAt);

  /// Formatted creation time, e.g. 'HH:mm' or 'DD/MM/YYYY'.
  String get formattedTime {
    final dt = createdAtDateTime;
    if (dt == null) return '';
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  /// Short human-readable date for display.
  String get formattedDate {
    final dt = createdAtDateTime;
    if (dt == null) return '';
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return formattedTime;
    }
    final d = dt.day.toString().padLeft(2, '0');
    final mo = dt.month.toString().padLeft(2, '0');
    return '$d/$mo/${dt.year}';
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleComment &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          scheduleId == other.scheduleId;

  @override
  int get hashCode => id.hashCode ^ scheduleId.hashCode;

  @override
  String toString() =>
      'ScheduleComment(id: $id, userName: $userName, createdAt: $createdAt)';
}
