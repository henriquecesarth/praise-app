import 'package:flutter/foundation.dart';

/// Ministry member domain model matching backend GET /api/v1/ministries/:ministryId/members.
@immutable
class MinistryMember {
  final String id;
  final String? userId;
  final String name;
  final String email;
  final String role;
  final List<String> roleIds;
  final bool isManual;

  const MinistryMember({
    required this.id,
    this.userId,
    required this.name,
    this.email = '',
    this.role = 'member',
    this.roleIds = const [],
    this.isManual = false,
  });

  factory MinistryMember.fromJson(Map<String, dynamic> json) {
    final rawRoleIds = json['role_ids'] ?? json['roleIds'];
    return MinistryMember(
      id: json['id'] as String? ?? '',
      userId: (json['userId'] ?? json['user_id']) as String?,
      name: json['name'] as String? ?? '',
      email: json['email'] as String? ?? '',
      role: json['role'] as String? ?? 'member',
      roleIds: rawRoleIds is List
          ? rawRoleIds.whereType<String>().toList()
          : const [],
      isManual:
          json['is_manual'] as bool? ?? json['isManual'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        if (userId != null) 'user_id': userId,
        'name': name,
        'email': email,
        'role': role,
        'role_ids': roleIds,
        'is_manual': isManual,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MinistryMember &&
          runtimeType == other.runtimeType &&
          id == other.id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'MinistryMember(id: $id, name: $name, role: $role)';
}
