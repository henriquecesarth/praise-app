/// Ministry membership domain model matching backend GET /api/v1/ministries/my-ministries.
///
/// NOTE: The backend remains the sole authority for security, tenancy, permissions,
/// and quotas. [role] is used exclusively for client-side presentation, navigation
/// hints, and visual styling. It must NEVER be treated as authorization authority.
class Ministry {
  final String id;
  final String name;
  final String? slug;
  final String role;
  final String? ownerUserId;
  final String? subscriptionStatus;
  final String? organizationId;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final Map<String, dynamic>? extraFields;

  const Ministry({
    required this.id,
    required this.name,
    this.slug,
    this.role = 'member',
    this.ownerUserId,
    this.subscriptionStatus,
    this.organizationId,
    this.createdAt,
    this.updatedAt,
    this.extraFields,
  });

  /// Human-readable PT-BR label for the user's role in this ministry.
  String get roleLabel {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'Administrador';
      case 'member':
        return 'Membro';
      case 'leader':
        return 'Líder';
      default:
        if (role.isEmpty) return 'Membro';
        return '${role[0].toUpperCase()}${role.substring(1)}';
    }
  }

  /// Visual presentation hint indicating administrative capabilities.
  /// Server-side enforcement remains mandatory for every mutation.
  bool get isAdmin => role.toLowerCase() == 'admin';

  factory Ministry.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic value) {
      if (value == null) return null;
      if (value is String && value.isNotEmpty) {
        return DateTime.tryParse(value);
      }
      return null;
    }

    // Preserve any unknown/custom fields without making them authority
    final knownKeys = {
      'id',
      'name',
      'slug',
      'role',
      'owner_user_id',
      'ownerUserId',
      'subscription_status',
      'subscriptionStatus',
      'organization_id',
      'organizationId',
      'created_at',
      'createdAt',
      'updated_at',
      'updatedAt',
    };

    final extras = <String, dynamic>{};
    json.forEach((k, v) {
      if (!knownKeys.contains(k)) {
        extras[k] = v;
      }
    });

    return Ministry(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      slug: json['slug'] as String?,
      role: json['role'] as String? ?? 'member',
      ownerUserId: (json['owner_user_id'] ?? json['ownerUserId']) as String?,
      subscriptionStatus: (json['subscription_status'] ??
          json['subscriptionStatus']) as String?,
      organizationId:
          (json['organization_id'] ?? json['organizationId']) as String?,
      createdAt: parseDate(json['created_at'] ?? json['createdAt']),
      updatedAt: parseDate(json['updated_at'] ?? json['updatedAt']),
      extraFields: extras.isNotEmpty ? extras : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (slug != null) 'slug': slug,
        'role': role,
        if (ownerUserId != null) 'owner_user_id': ownerUserId,
        if (subscriptionStatus != null)
          'subscription_status': subscriptionStatus,
        if (organizationId != null) 'organization_id': organizationId,
        if (createdAt != null) 'created_at': createdAt!.toIso8601String(),
        if (updatedAt != null) 'updated_at': updatedAt!.toIso8601String(),
        if (extraFields != null) ...extraFields!,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Ministry &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          name == other.name &&
          role == other.role &&
          ownerUserId == other.ownerUserId &&
          subscriptionStatus == other.subscriptionStatus;

  @override
  int get hashCode =>
      id.hashCode ^
      name.hashCode ^
      role.hashCode ^
      (ownerUserId?.hashCode ?? 0) ^
      (subscriptionStatus?.hashCode ?? 0);

  @override
  String toString() => 'Ministry(id: , name: , role: )';
}
