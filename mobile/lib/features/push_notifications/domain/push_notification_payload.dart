import 'dart:convert';

/// Supported push notification routing types for LouvAIO mobile.
enum PushNotificationType {
  schedule,
  scheduleComment,
  announcement,
  unknown;

  static PushNotificationType fromString(String? value) {
    if (value == null) return PushNotificationType.unknown;
    switch (value.trim().toLowerCase()) {
      case 'schedule':
      case 'schedule_assigned':
      case 'schedule_updated':
        return PushNotificationType.schedule;
      case 'schedule_comment':
        return PushNotificationType.scheduleComment;
      case 'announcement':
        return PushNotificationType.announcement;
      default:
        return PushNotificationType.unknown;
    }
  }

  String toTypeString() {
    switch (this) {
      case PushNotificationType.schedule:
        return 'schedule';
      case PushNotificationType.scheduleComment:
        return 'schedule_comment';
      case PushNotificationType.announcement:
        return 'announcement';
      case PushNotificationType.unknown:
        return 'unknown';
    }
  }
}

/// Typed push notification routing contract.
///
/// Contains strictly routing identifiers and notification text.
/// Fails closed to [PushNotificationType.unknown] for any unrecognized or malformed payload.
class PushNotificationPayload {
  final PushNotificationType type;
  final String? ministryId;
  final String? resourceId;
  final String? notificationId;
  final String? title;
  final String? body;
  final Map<String, dynamic> rawData;

  const PushNotificationPayload({
    required this.type,
    this.ministryId,
    this.resourceId,
    this.notificationId,
    this.title,
    this.body,
    this.rawData = const {},
  });

  /// Factory constructor with fail-safe parsing from string or map representations.
  factory PushNotificationPayload.fromMap(
    Map<dynamic, dynamic>? map, {
    String? title,
    String? body,
  }) {
    if (map == null || map.isEmpty) {
      return PushNotificationPayload(
        type: PushNotificationType.unknown,
        title: title,
        body: body,
      );
    }

    final normalized = <String, dynamic>{};
    map.forEach((key, value) {
      if (key != null) {
        normalized[key.toString()] = value;
      }
    });

    final rawType = normalized['type']?.toString();
    final type = PushNotificationType.fromString(rawType);

    final rawMinistryId = normalized['ministryId'] ?? normalized['ministry_id'];
    final rawResourceId = normalized['resourceId'] ??
        normalized['resource_id'] ??
        normalized['scheduleId'] ??
        normalized['schedule_id'];
    final rawNotificationId =
        normalized['notificationId'] ?? normalized['notification_id'];

    final payloadTitle =
        normalized['title']?.toString() ?? title ?? normalized['title'];
    final payloadBody =
        normalized['body']?.toString() ?? body ?? normalized['message'];

    return PushNotificationPayload(
      type: type,
      ministryId: rawMinistryId?.toString().trim().isNotEmpty == true
          ? rawMinistryId.toString().trim()
          : null,
      resourceId: rawResourceId?.toString().trim().isNotEmpty == true
          ? rawResourceId.toString().trim()
          : null,
      notificationId: rawNotificationId?.toString().trim().isNotEmpty == true
          ? rawNotificationId.toString().trim()
          : null,
      title: payloadTitle?.toString(),
      body: payloadBody?.toString(),
      rawData: normalized,
    );
  }

  factory PushNotificationPayload.fromJsonString(String jsonStr) {
    try {
      final decoded = jsonDecode(jsonStr);
      if (decoded is Map) {
        return PushNotificationPayload.fromMap(decoded);
      }
    } catch (_) {
      // Malformed json fails safely to unknown
    }
    return const PushNotificationPayload(type: PushNotificationType.unknown);
  }

  Map<String, dynamic> toMap() {
    return {
      'type': type.toTypeString(),
      if (ministryId != null) 'ministryId': ministryId,
      if (resourceId != null) 'resourceId': resourceId,
      if (notificationId != null) 'notificationId': notificationId,
      if (title != null) 'title': title,
      if (body != null) 'body': body,
    };
  }

  String toJsonString() => jsonEncode(toMap());

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PushNotificationPayload &&
          runtimeType == other.runtimeType &&
          type == other.type &&
          ministryId == other.ministryId &&
          resourceId == other.resourceId &&
          notificationId == other.notificationId;

  @override
  int get hashCode =>
      type.hashCode ^
      ministryId.hashCode ^
      resourceId.hashCode ^
      notificationId.hashCode;

  @override
  String toString() =>
      'PushNotificationPayload(type: $type, ministryId: $ministryId, resourceId: $resourceId, notificationId: $notificationId)';
}
