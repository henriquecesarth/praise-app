import 'package:flutter/foundation.dart';

/// Ministry musical/ministerial role domain model matching backend GET /api/v1/ministries/:ministryId/roles.
@immutable
class MinistryRole {
  final String id;
  final String name;
  final String? icon;

  const MinistryRole({
    required this.id,
    required this.name,
    this.icon,
  });

  factory MinistryRole.fromJson(Map<String, dynamic> json) {
    return MinistryRole(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      icon: json['icon'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (icon != null) 'icon': icon,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MinistryRole &&
          runtimeType == other.runtimeType &&
          id == other.id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'MinistryRole(id: $id, name: $name)';
}
