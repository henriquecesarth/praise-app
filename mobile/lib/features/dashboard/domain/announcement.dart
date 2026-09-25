import 'package:flutter/foundation.dart';
import '../../../../core/utils/date_utils.dart';

/// Announcement domain model for mobile dashboard.
///
/// Maps raw record from `GET /api/v1/ministries/:id/announcements`.
@immutable
class Announcement {
  final String id;
  final String ministryId;
  final String title;
  final String content;
  final String author;
  final bool important;
  final String createdBy;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const Announcement({
    required this.id,
    required this.ministryId,
    required this.title,
    required this.content,
    this.author = 'Liderança',
    this.important = false,
    this.createdBy = '',
    this.createdAt,
    this.updatedAt,
  });

  factory Announcement.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic val) {
      if (val is String && val.isNotEmpty) {
        return DateTime.tryParse(val);
      }
      return null;
    }

    return Announcement(
      id: json['id'] as String? ?? '',
      ministryId:
          json['ministry_id'] as String? ?? json['ministryId'] as String? ?? '',
      title: json['title'] as String? ?? '',
      content: json['content'] as String? ?? '',
      author: json['author'] as String? ?? 'Liderança',
      important: json['important'] as bool? ?? false,
      createdBy:
          json['created_by'] as String? ?? json['createdBy'] as String? ?? '',
      createdAt: parseDate(json['created_at'] ?? json['createdAt']),
      updatedAt: parseDate(json['updated_at'] ?? json['updatedAt']),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ministry_id': ministryId,
        'title': title,
        'content': content,
        'author': author,
        'important': important,
        'created_by': createdBy,
        'created_at': createdAt?.toIso8601String(),
        'updated_at': updatedAt?.toIso8601String(),
      };

  /// Human-readable publication date in PT-BR conventions.
  String formattedDate([DateTime? referenceNow]) =>
      AppDateUtils.formatAnnouncementDate(createdAt, referenceNow);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Announcement &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          title == other.title &&
          content == other.content &&
          author == other.author &&
          important == other.important &&
          createdBy == other.createdBy &&
          createdAt == other.createdAt &&
          updatedAt == other.updatedAt;

  @override
  int get hashCode =>
      id.hashCode ^
      ministryId.hashCode ^
      title.hashCode ^
      content.hashCode ^
      author.hashCode ^
      important.hashCode ^
      createdBy.hashCode ^
      createdAt.hashCode ^
      updatedAt.hashCode;
}
