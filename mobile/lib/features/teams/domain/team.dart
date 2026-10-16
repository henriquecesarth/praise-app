import 'package:flutter/foundation.dart';

/// Team domain model matching backend ministry_teams document.
///
/// Invariants:
/// - TEAM_HAS_MEMBER_ROLE_MAPPING = NO
/// - TEAM_HAS_SCHEDULE_ROLE_MAPPING = NO
/// - TEAM_HAS_DYNAMIC_SCHEDULE_LINK = NO
@immutable
class Team {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final List<String> memberIds;
  final String? createdBy;
  final String? createdAt;
  final String? updatedAt;

  const Team({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.memberIds = const [],
    this.createdBy,
    this.createdAt,
    this.updatedAt,
  });

  factory Team.fromJson(Map<String, dynamic> json) {
    final rawMembers = json['member_ids'] ?? json['memberIds'];
    return Team(
      id: json['id'] as String? ?? '',
      ministryId: (json['ministry_id'] ?? json['ministryId']) as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      memberIds: rawMembers is List
          ? rawMembers.whereType<String>().toList()
          : const [],
      createdBy: (json['created_by'] ?? json['createdBy']) as String?,
      createdAt: (json['created_at'] ?? json['createdAt']) as String?,
      updatedAt: (json['updated_at'] ?? json['updatedAt']) as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ministry_id': ministryId,
        'name': name,
        if (description != null) 'description': description,
        'member_ids': memberIds,
        if (createdBy != null) 'created_by': createdBy,
        if (createdAt != null) 'created_at': createdAt,
        if (updatedAt != null) 'updated_at': updatedAt,
      };

  Team copyWith({
    String? id,
    String? ministryId,
    String? name,
    String? description,
    bool clearDescription = false,
    List<String>? memberIds,
    String? createdBy,
    String? createdAt,
    String? updatedAt,
  }) {
    return Team(
      id: id ?? this.id,
      ministryId: ministryId ?? this.ministryId,
      name: name ?? this.name,
      description:
          clearDescription ? null : (description ?? this.description),
      memberIds: memberIds ?? this.memberIds,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Team &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          name == other.name &&
          description == other.description &&
          listEquals(memberIds, other.memberIds) &&
          createdBy == other.createdBy &&
          createdAt == other.createdAt &&
          updatedAt == other.updatedAt;

  @override
  int get hashCode => Object.hash(
        id,
        ministryId,
        name,
        description,
        Object.hashAll(memberIds),
        createdBy,
        createdAt,
        updatedAt,
      );

  @override
  String toString() =>
      'Team(id: $id, ministryId: $ministryId, name: $name, membersCount: ${memberIds.length})';
}
