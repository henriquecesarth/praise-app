import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';

void main() {
  group('Ministry Domain Model', () {
    test('deserializes complete backend json correctly', () {
      final json = {
        'id': 'min_123',
        'name': 'Ministério Graça e Paz',
        'slug': 'graca-e-paz',
        'role': 'admin',
        'owner_user_id': 'usr_owner_456',
        'subscription_status': 'active',
        'organization_id': 'org_789',
        'created_at': '2026-09-01T10:00:00.000Z',
        'updated_at': '2026-09-02T15:30:00.000Z',
        'unknown_custom_field': 'custom_value',
      };

      final ministry = Ministry.fromJson(json);

      expect(ministry.id, 'min_123');
      expect(ministry.name, 'Ministério Graça e Paz');
      expect(ministry.slug, 'graca-e-paz');
      expect(ministry.role, 'admin');
      expect(ministry.ownerUserId, 'usr_owner_456');
      expect(ministry.subscriptionStatus, 'active');
      expect(ministry.organizationId, 'org_789');
      expect(ministry.createdAt, isNotNull);
      expect(ministry.updatedAt, isNotNull);
      expect(ministry.extraFields?['unknown_custom_field'], 'custom_value');
    });

    test('handles missing optional fields with safe defaults', () {
      final json = {
        'id': 'min_minimal',
        'name': 'Minimal Ministry',
      };

      final ministry = Ministry.fromJson(json);

      expect(ministry.id, 'min_minimal');
      expect(ministry.name, 'Minimal Ministry');
      expect(ministry.role, 'member');
      expect(ministry.slug, isNull);
      expect(ministry.ownerUserId, isNull);
      expect(ministry.subscriptionStatus, isNull);
      expect(ministry.organizationId, isNull);
      expect(ministry.createdAt, isNull);
      expect(ministry.updatedAt, isNull);
      expect(ministry.extraFields, isNull);
    });

    test('serializes to JSON correctly', () {
      final now = DateTime.utc(2026, 9, 25, 12, 0, 0);
      final ministry = Ministry(
        id: 'min_test',
        name: 'Test Ministry',
        slug: 'test-slug',
        role: 'member',
        ownerUserId: 'usr_owner',
        subscriptionStatus: 'active',
        organizationId: 'org_1',
        createdAt: now,
        updatedAt: now,
        extraFields: {'meta': 'data'},
      );

      final json = ministry.toJson();

      expect(json['id'], 'min_test');
      expect(json['name'], 'Test Ministry');
      expect(json['slug'], 'test-slug');
      expect(json['role'], 'member');
      expect(json['owner_user_id'], 'usr_owner');
      expect(json['subscription_status'], 'active');
      expect(json['organization_id'], 'org_1');
      expect(json['created_at'], now.toIso8601String());
      expect(json['meta'], 'data');
    });

    test('roleLabel formats known roles and unknown roles safely in PT-BR', () {
      const admin = Ministry(id: '1', name: 'M1', role: 'admin');
      expect(admin.roleLabel, 'Administrador');
      expect(admin.isAdmin, isTrue);

      const member = Ministry(id: '2', name: 'M2', role: 'member');
      expect(member.roleLabel, 'Membro');
      expect(member.isAdmin, isFalse);

      const leader = Ministry(id: '3', name: 'M3', role: 'leader');
      expect(leader.roleLabel, 'Líder');
      expect(leader.isAdmin, isFalse);

      const unknown = Ministry(id: '4', name: 'M4', role: 'coordinator');
      expect(unknown.roleLabel, 'Coordinator');
      expect(unknown.isAdmin, isFalse);

      const emptyRole = Ministry(id: '5', name: 'M5', role: '');
      expect(emptyRole.roleLabel, 'Membro');
      expect(emptyRole.isAdmin, isFalse);
    });

    test('supports value equality and hashCode', () {
      const m1 = Ministry(id: '1', name: 'Name', role: 'admin');
      const m2 = Ministry(id: '1', name: 'Name', role: 'admin');
      const m3 = Ministry(id: '2', name: 'Name', role: 'admin');

      expect(m1 == m2, isTrue);
      expect(m1 == m3, isFalse);
      expect(m1.hashCode, m2.hashCode);
    });
  });
}
