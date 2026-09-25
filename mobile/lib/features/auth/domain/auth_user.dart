/// Authenticated LouvAIO user domain model matching backend /api/v1/auth/me.
class AuthUser {
  final String id;
  final String email;
  final String name;

  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'name': name,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthUser &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          email == other.email &&
          name == other.name;

  @override
  int get hashCode => id.hashCode ^ email.hashCode ^ name.hashCode;

  @override
  String toString() => 'AuthUser(id: $id, email: $email, name: $name)';
}
