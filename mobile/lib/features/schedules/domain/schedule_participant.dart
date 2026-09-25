/// Schedule participant domain model matching backend ScheduleRecord.participants.
class ScheduleParticipant {
  final String id;
  final String? userId;
  final String name;
  final String role;
  final bool? confirmed;

  const ScheduleParticipant({
    required this.id,
    this.userId,
    required this.name,
    required this.role,
    this.confirmed,
  });

  factory ScheduleParticipant.fromJson(Map<String, dynamic> json) {
    return ScheduleParticipant(
      id: json['id'] as String? ?? '',
      userId: (json['userId'] ?? json['user_id']) as String?,
      name: json['name'] as String? ?? '',
      role: json['role'] as String? ?? '',
      confirmed: json['confirmed'] as bool?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        if (userId != null) 'userId': userId,
        'name': name,
        'role': role,
        if (confirmed != null) 'confirmed': confirmed,
      };

  ScheduleParticipant copyWith({
    String? id,
    String? userId,
    String? name,
    String? role,
    bool? confirmed,
  }) {
    return ScheduleParticipant(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      name: name ?? this.name,
      role: role ?? this.role,
      confirmed: confirmed ?? this.confirmed,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleParticipant &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          userId == other.userId &&
          name == other.name &&
          role == other.role &&
          confirmed == other.confirmed;

  @override
  int get hashCode =>
      id.hashCode ^
      userId.hashCode ^
      name.hashCode ^
      role.hashCode ^
      confirmed.hashCode;

  @override
  String toString() =>
      'ScheduleParticipant(id: $id, name: $name, role: $role, confirmed: $confirmed)';
}
