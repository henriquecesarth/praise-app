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
  final String phone;
  final String? birthDate;
  final String? joinedAt;

  const MinistryMember({
    required this.id,
    this.userId,
    required this.name,
    this.email = '',
    this.role = 'member',
    this.roleIds = const [],
    this.isManual = false,
    this.phone = '',
    this.birthDate,
    this.joinedAt,
  });

  bool get isAdmin => role == 'admin';
  String get roleLabel => isAdmin ? 'Administrador' : 'Membro';

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts[0].isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[parts.length - 1][0]}'.toUpperCase();
  }

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
      phone: json['phone'] as String? ?? '',
      birthDate: (json['birth_date'] ?? json['birthDate']) as String?,
      joinedAt: (json['joined_at'] ?? json['created_at']) as String?,
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
        if (phone.isNotEmpty) 'phone': phone,
        if (birthDate != null) 'birth_date': birthDate,
        if (joinedAt != null) 'joined_at': joinedAt,
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
