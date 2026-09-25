import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';

void main() {
  group('Announcement Domain Model', () {
    test('deserializes complete backend json correctly', () {
      final json = {
        'id': 'ann_123',
        'ministry_id': 'min_456',
        'title': 'Ensaio Geral',
        'content': 'Lembrete do ensaio às 19h no templo.',
        'author': 'Pr. João',
        'important': true,
        'created_by': 'user_789',
        'created_at': '2026-09-25T14:30:00.000Z',
        'updated_at': '2026-09-25T14:30:00.000Z',
      };

      final ann = Announcement.fromJson(json);

      expect(ann.id, equals('ann_123'));
      expect(ann.ministryId, equals('min_456'));
      expect(ann.title, equals('Ensaio Geral'));
      expect(ann.content, equals('Lembrete do ensaio às 19h no templo.'));
      expect(ann.author, equals('Pr. João'));
      expect(ann.important, isTrue);
      expect(ann.createdBy, equals('user_789'));
      expect(ann.createdAt, isNotNull);
      expect(ann.updatedAt, isNotNull);
    });

    test('handles missing optional fields with safe defaults', () {
      final json = <String, dynamic>{
        'id': 'ann_min',
      };

      final ann = Announcement.fromJson(json);

      expect(ann.id, equals('ann_min'));
      expect(ann.ministryId, equals(''));
      expect(ann.title, equals(''));
      expect(ann.content, equals(''));
      expect(ann.author, equals('Liderança'));
      expect(ann.important, isFalse);
      expect(ann.createdBy, equals(''));
      expect(ann.createdAt, isNull);
      expect(ann.updatedAt, isNull);
    });

    test('serializes to JSON correctly', () {
      final ann = Announcement(
        id: 'ann_abc',
        ministryId: 'min_xyz',
        title: 'Comunicado',
        content: 'Conteúdo aqui',
        author: 'Líder',
        important: false,
        createdBy: 'user_1',
        createdAt: DateTime.utc(2026, 9, 25, 12, 0),
        updatedAt: DateTime.utc(2026, 9, 25, 12, 0),
      );

      final json = ann.toJson();

      expect(json['id'], equals('ann_abc'));
      expect(json['ministry_id'], equals('min_xyz'));
      expect(json['title'], equals('Comunicado'));
      expect(json['content'], equals('Conteúdo aqui'));
      expect(json['author'], equals('Líder'));
      expect(json['important'], isFalse);
      expect(json['created_by'], equals('user_1'));
      expect(json['created_at'], contains('2026-09-25'));
    });

    test('supports value equality and hashCode', () {
      final ann1 = Announcement(
        id: '1',
        ministryId: 'm1',
        title: 'T1',
        content: 'C1',
        author: 'A1',
        important: true,
        createdAt: DateTime.utc(2026, 9, 25),
      );
      final ann2 = Announcement(
        id: '1',
        ministryId: 'm1',
        title: 'T1',
        content: 'C1',
        author: 'A1',
        important: true,
        createdAt: DateTime.utc(2026, 9, 25),
      );
      const ann3 = Announcement(
        id: '2',
        ministryId: 'm1',
        title: 'T2',
        content: 'C2',
      );

      expect(ann1, equals(ann2));
      expect(ann1.hashCode, equals(ann2.hashCode));
      expect(ann1, isNot(equals(ann3)));
    });
  });
}
