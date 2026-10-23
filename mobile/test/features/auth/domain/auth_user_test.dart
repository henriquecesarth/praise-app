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
      expect(user.chordFontFamily, 'monospace');
    });

    test('deserializes valid chord font preference from JSON', () {
      final json = {
        'id': 'usr_123',
        'email': 'teste@louvaio.com',
        'name': 'Henrique Hermogenes',
        'preferences': {
          'chord_font_family': 'Georgia',
        },
      };

      final user = AuthUser.fromJson(json);
      expect(user.chordFontFamily, 'Georgia');
    });

    test('falls back to default monospace for unknown font preference', () {
      final json = {
        'id': 'usr_123',
        'email': 'teste@louvaio.com',
        'name': 'Henrique',
        'preferences': {
          'chord_font_family': 'Comic Sans MS',
        },
      };

      final user = AuthUser.fromJson(json);
      expect(user.chordFontFamily, 'monospace');
    });

    test('handles missing or null fields gracefully with empty string and monospace defaults',
        () {
      final json = <String, dynamic>{};

      final user = AuthUser.fromJson(json);

      expect(user.id, '');
      expect(user.email, '');
      expect(user.name, '');
      expect(user.chordFontFamily, 'monospace');
    });

    test('serializes to JSON correctly including preferences', () {
      const user = AuthUser(
        id: 'usr_abc',
        email: 'admin@louvaio.com',
        name: 'Admin User',
        chordFontFamily: 'Verdana',
      );

      final json = user.toJson();

      expect(json, {
        'id': 'usr_abc',
        'email': 'admin@louvaio.com',
        'name': 'Admin User',
        'preferences': {
          'chord_font_family': 'Verdana',
        },
      });
    });

    test('supports copyWith', () {
      const user = AuthUser(
        id: 'usr_1',
        email: 'user@test.com',
        name: 'User One',
        chordFontFamily: 'monospace',
      );

      final updated = user.copyWith(chordFontFamily: 'Arial');
      expect(updated.id, 'usr_1');
      expect(updated.email, 'user@test.com');
      expect(updated.name, 'User One');
      expect(updated.chordFontFamily, 'Arial');
    });

    test('supports value equality and hash code', () {
      const user1 = AuthUser(
        id: 'usr_1',
        email: 'user@test.com',
        name: 'User One',
        chordFontFamily: 'Georgia',
      );
      const user2 = AuthUser(
        id: 'usr_1',
        email: 'user@test.com',
        name: 'User One',
        chordFontFamily: 'Georgia',
      );
      const user3 = AuthUser(
        id: 'usr_1',
        email: 'user@test.com',
        name: 'User One',
        chordFontFamily: 'Arial',
      );
      const user4 = AuthUser(
        id: 'usr_2',
        email: 'other@test.com',
        name: 'User Two',
      );

      expect(user1, equals(user2));
      expect(user1.hashCode, equals(user2.hashCode));
      expect(user1, isNot(equals(user3)));
      expect(user1, isNot(equals(user4)));
      expect(user1.toString(), contains('chordFontFamily: Georgia'));
    });
  });
}
