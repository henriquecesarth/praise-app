import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/push_notifications/domain/push_notification_payload.dart';

void main() {
  group('PushNotificationPayload', () {
    test('parses schedule notification payload correctly', () {
      final data = {
        'type': 'schedule',
        'ministryId': 'min-123',
        'resourceId': 'sch-456',
        'notificationId': 'notif-789',
        'title': 'Nova Escala',
        'body': 'Domingo Manhã',
      };

      final payload = PushNotificationPayload.fromMap(data);

      expect(payload.type, PushNotificationType.schedule);
      expect(payload.ministryId, 'min-123');
      expect(payload.resourceId, 'sch-456');
      expect(payload.notificationId, 'notif-789');
      expect(payload.title, 'Nova Escala');
      expect(payload.body, 'Domingo Manhã');
    });

    test('parses schedule_comment notification payload and snake_case keys correctly', () {
      final data = {
        'type': 'schedule_comment',
        'ministry_id': 'min-123',
        'schedule_id': 'sch-456',
        'notification_id': 'notif-789',
        'title': 'Novo Comentário',
        'message': 'Mensagem na escala',
      };

      final payload = PushNotificationPayload.fromMap(data);

      expect(payload.type, PushNotificationType.scheduleComment);
      expect(payload.ministryId, 'min-123');
      expect(payload.resourceId, 'sch-456');
      expect(payload.notificationId, 'notif-789');
      expect(payload.title, 'Novo Comentário');
      expect(payload.body, 'Mensagem na escala');
    });

    test('parses announcement payload correctly', () {
      final data = {
        'type': 'announcement',
        'ministryId': 'min-999',
        'title': 'Aviso Geral',
        'body': 'Ensaio cancelado',
      };

      final payload = PushNotificationPayload.fromMap(data);

      expect(payload.type, PushNotificationType.announcement);
      expect(payload.ministryId, 'min-999');
      expect(payload.resourceId, isNull);
      expect(payload.title, 'Aviso Geral');
      expect(payload.body, 'Ensaio cancelado');
    });

    test('fails closed to PushNotificationType.unknown on unrecognized type', () {
      final data = {
        'type': 'non_existent_custom_type',
        'ministryId': 'min-123',
      };

      final payload = PushNotificationPayload.fromMap(data);

      expect(payload.type, PushNotificationType.unknown);
      expect(payload.ministryId, 'min-123');
    });

    test('handles null and empty maps safely', () {
      final payloadNull = PushNotificationPayload.fromMap(null);
      expect(payloadNull.type, PushNotificationType.unknown);
      expect(payloadNull.ministryId, isNull);

      final payloadEmpty = PushNotificationPayload.fromMap({});
      expect(payloadEmpty.type, PushNotificationType.unknown);
    });

    test('normalizes empty strings to null for IDs', () {
      final data = {
        'type': 'schedule',
        'ministryId': '   ',
        'resourceId': '',
      };

      final payload = PushNotificationPayload.fromMap(data);

      expect(payload.ministryId, isNull);
      expect(payload.resourceId, isNull);
    });

    test('serializes and deserializes to JSON string deterministically', () {
      const original = PushNotificationPayload(
        type: PushNotificationType.schedule,
        ministryId: 'min-1',
        resourceId: 'sch-1',
        notificationId: 'notif-1',
        title: 'Título',
        body: 'Corpo',
      );

      final jsonStr = original.toJsonString();
      final parsed = PushNotificationPayload.fromJsonString(jsonStr);

      expect(parsed.type, PushNotificationType.schedule);
      expect(parsed.ministryId, 'min-1');
      expect(parsed.resourceId, 'sch-1');
      expect(parsed.notificationId, 'notif-1');
      expect(parsed.title, 'Título');
      expect(parsed.body, 'Corpo');
    });

    test('fromJsonString fails closed on malformed JSON', () {
      final payload = PushNotificationPayload.fromJsonString('invalid json {');
      expect(payload.type, PushNotificationType.unknown);
    });
  });
}
