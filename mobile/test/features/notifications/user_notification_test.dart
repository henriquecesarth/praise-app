import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/notifications/domain/user_notification.dart';

void main() {
  group('UserNotification domain & deserialization', () {
    test('parses schedule_assigned notification correctly', () {
      final map = {
        'id': 'notif_1',
        'user_id': 'user_123',
        'ministry_id': 'min_abc',
        'type': 'schedule_assigned',
        'resource_id': 'sched_789',
        'title': 'Nova escala: Culto',
        'body': 'Você foi escalado(a)',
        'created_at': '2026-10-01T12:00:00.000Z',
        'read_at': null,
      };

      final notif = UserNotification.fromMap(map);

      expect(notif.id, 'notif_1');
      expect(notif.userId, 'user_123');
      expect(notif.ministryId, 'min_abc');
      expect(notif.type, UserNotificationType.scheduleAssigned);
      expect(notif.resourceId, 'sched_789');
      expect(notif.title, 'Nova escala: Culto');
      expect(notif.body, 'Você foi escalado(a)');
      expect(notif.isRead, isFalse);
      expect(notif.readAt, isNull);
    });

    test('parses read_at and computes isRead correctly', () {
      final map = {
        'id': 'notif_2',
        'type': 'schedule_updated',
        'created_at': '2026-10-01T10:00:00.000Z',
        'read_at': '2026-10-01T11:00:00.000Z',
      };

      final notif = UserNotification.fromMap(map);
      expect(notif.type, UserNotificationType.scheduleUpdated);
      expect(notif.isRead, isTrue);
      expect(notif.readAt, isNotNull);
    });

    test('maps schedule_comment and announcement correctly', () {
      final comm = UserNotification.fromMap({
        'id': 'notif_3',
        'type': 'schedule_comment',
      });
      expect(comm.type, UserNotificationType.scheduleComment);

      final ann = UserNotification.fromMap({
        'id': 'notif_4',
        'type': 'announcement',
      });
      expect(ann.type, UserNotificationType.announcement);

      final unk = UserNotification.fromMap({
        'id': 'notif_5',
        'type': 'future_unknown_type',
      });
      expect(unk.type, UserNotificationType.unknown);
    });
  });
}
