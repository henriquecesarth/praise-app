/// Supported notification types within LouvAIO User Notification domain.
enum UserNotificationType {
  scheduleAssigned,
  scheduleUpdated,
  scheduleComment,
  announcement,
  unknown;

  static UserNotificationType fromString(String? val) {
    if (val == null) return UserNotificationType.unknown;
    switch (val.toLowerCase().trim()) {
      case 'schedule_assigned':
        return UserNotificationType.scheduleAssigned;
      case 'schedule_updated':
        return UserNotificationType.scheduleUpdated;
      case 'schedule_comment':
        return UserNotificationType.scheduleComment;
      case 'announcement':
        return UserNotificationType.announcement;
      default:
        return UserNotificationType.unknown;
    }
  }

  String toTypeString() {
    switch (this) {
      case UserNotificationType.scheduleAssigned:
        return 'schedule_assigned';
      case UserNotificationType.scheduleUpdated:
        return 'schedule_updated';
      case UserNotificationType.scheduleComment:
        return 'schedule_comment';
      case UserNotificationType.announcement:
        return 'announcement';
      case UserNotificationType.unknown:
        return 'unknown';
    }
  }
}

/// Persistent user notification model.
class UserNotification {
  final String id;
  final String userId;
  final String ministryId;
  final UserNotificationType type;
  final String resourceId;
  final String title;
  final String body;
  final Map<String, dynamic> data;
  final DateTime createdAt;
  final DateTime? readAt;

  const UserNotification({
    required this.id,
    required this.userId,
    required this.ministryId,
    required this.type,
    required this.resourceId,
    required this.title,
    required this.body,
    this.data = const {},
    required this.createdAt,
    this.readAt,
  });

  bool get isRead => readAt != null;

  factory UserNotification.fromMap(Map<String, dynamic> map) {
    return UserNotification(
      id: map['id']?.toString() ?? '',
      userId: map['user_id']?.toString() ?? map['userId']?.toString() ?? '',
      ministryId:
          map['ministry_id']?.toString() ?? map['ministryId']?.toString() ?? '',
      type: UserNotificationType.fromString(map['type']?.toString()),
      resourceId:
          map['resource_id']?.toString() ?? map['resourceId']?.toString() ?? '',
      title: map['title']?.toString() ?? '',
      body: map['body']?.toString() ?? '',
      data: map['data'] is Map
          ? Map<String, dynamic>.from(map['data'] as Map)
          : const {},
      createdAt: map['created_at'] != null
          ? DateTime.tryParse(map['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
      readAt: map['read_at'] != null
          ? DateTime.tryParse(map['read_at'].toString())
          : null,
    );
  }

  UserNotification copyWith({
    DateTime? readAt,
  }) {
    return UserNotification(
      id: id,
      userId: userId,
      ministryId: ministryId,
      type: type,
      resourceId: resourceId,
      title: title,
      body: body,
      data: data,
      createdAt: createdAt,
      readAt: readAt ?? this.readAt,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is UserNotification &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          readAt == other.readAt;

  @override
  int get hashCode => id.hashCode ^ readAt.hashCode;
}
