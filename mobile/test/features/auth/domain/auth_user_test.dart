import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';

void main() {
  group('AuthUser', () {
    test('creates AuthUser and correctly deserializes from JSON', () {
      final json = {
        'id': 'usr_123',
        'email': 'teste@louvaio.com',
        'name': 'Henrique Hermogenes',
      };

      final user = AuthUser.fromJson(json);

      expect(user.id, 'usr_123');
      expect(user.email, 'teste@louvaio.com');
      expect(user.name, 'Henrique Hermogenes');
    });

    test('handles missing or null fields gracefully with empty string defaults',
        () {
      final json = <String, dynamic>{};

      final user = AuthUser.fromJson(json);

      expect(user.id, '');
      expect(user.email, '');
      expect(user.name, '');
    });

    test('serializes to JSON correctly', () {
      const user = AuthUser(
        id: 'usr_abc',
        email: 'admin@louvaio.com',
        name: 'Admin User',
      );

      final json = user.toJson();

      expect(json, {
        'id': 'usr_abc',
        'email': 'admin@louvaio.com',
        'name': 'Admin User',
      });
    });

    test('supports value equality and hash code', () {
      const user1 = AuthUser(
        id: 'usr_1',
        email: 'user@test.com',
        name: 'User One',
      );
      const user2 = AuthUser(
        id: 'usr_1',
        email: 'user@test.com',
        name: 'User One',
      );
      const user3 = AuthUser(
        id: 'usr_2',
        email: 'other@test.com',
        name: 'User Two',
      );

      expect(user1, equals(user2));
      expect(user1.hashCode, equals(user2.hashCode));
      expect(user1, isNot(equals(user3)));
      expect(user1.toString(), contains('usr_1'));
    });
  });
}
