import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/members/presentation/controllers/members_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class FakeMembersRepository implements MembersRepository {
  List<MinistryMember> membersToReturn = [];
  List<MinistryRole> rolesToReturn = [];
  Exception? membersError;
  Exception? rolesError;
  String? lastMinistryId;

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async {
    lastMinistryId = ministryId;
    if (membersError != null) throw membersError!;
    return membersToReturn;
  }

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async {
    if (rolesError != null) throw rolesError!;
    return rolesToReturn;
  }
}

void main() {
  group('MembersDirectoryNotifier', () {
    late FakeMembersRepository repo;
    late MembersDirectoryNotifier notifier;

    final testRoles = [
      const MinistryRole(id: 'role_vocal', name: 'Vocal'),
      const MinistryRole(id: 'role_guitar', name: 'Violão'),
      const MinistryRole(id: 'role_drums', name: 'Bateria'),
    ];

    final testMembers = [
      const MinistryMember(
        id: 'mem_1',
        name: 'Alice Silva',
        email: 'alice@louvaio.com',
        phone: '11999990001',
        role: 'admin',
        roleIds: ['role_vocal'],
      ),
      const MinistryMember(
        id: 'mem_2',
        name: 'Bruno Souza',
        email: 'bruno@louvaio.com',
        phone: '11999990002',
        role: 'member',
        roleIds: ['role_guitar'],
      ),
      const MinistryMember(
        id: 'mem_3',
        name: 'Carlos Dias',
        email: 'carlos@louvaio.com',
        role: 'member',
        roleIds: ['role_drums'],
      ),
    ];

    setUp(() {
      repo = FakeMembersRepository();
      notifier = MembersDirectoryNotifier(repository: repo);
    });

    test('initial state is uninitialized with empty list and no error', () {
      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.members, isEmpty);
      expect(notifier.state.roles, isEmpty);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    test('loadForMinistry fetches members and roles concurrently', () async {
      repo.membersToReturn = testMembers;
      repo.rolesToReturn = testRoles;

      await notifier.loadForMinistry('min_1');

      expect(notifier.state.ministryId, equals('min_1'));
      expect(notifier.state.members.length, equals(3));
      expect(notifier.state.roles.length, equals(3));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
      expect(repo.lastMinistryId, equals('min_1'));
    });

    test('loadForMinistry handles failure gracefully and sets error', () async {
      repo.membersError =
          const AppFailure(message: 'Sem permissão para listar membros.');

      await notifier.loadForMinistry('min_1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error,
          equals('Sem permissão para listar membros.'));
      expect(notifier.state.members, isEmpty);
    });

    test('searchQuery filters members by name, email, phone and musical role',
        () async {
      notifier.state = MembersDirectoryState(
        ministryId: 'min_1',
        members: testMembers,
        roles: testRoles,
      );

      // Search by name
      notifier.setSearchQuery('Alice');
      expect(notifier.state.filteredMembers.length, equals(1));
      expect(notifier.state.filteredMembers.first.name, equals('Alice Silva'));

      // Search by email
      notifier.setSearchQuery('bruno@');
      expect(notifier.state.filteredMembers.length, equals(1));
      expect(notifier.state.filteredMembers.first.name, equals('Bruno Souza'));

      // Search by phone
      notifier.setSearchQuery('0002');
      expect(notifier.state.filteredMembers.length, equals(1));
      expect(notifier.state.filteredMembers.first.name, equals('Bruno Souza'));

      // Search by musical role name
      notifier.setSearchQuery('Bateria');
      expect(notifier.state.filteredMembers.length, equals(1));
      expect(notifier.state.filteredMembers.first.name, equals('Carlos Dias'));

      // Search with no match
      notifier.setSearchQuery('Inexistente');
      expect(notifier.state.filteredMembers, isEmpty);

      // Clear search
      notifier.setSearchQuery('');
      expect(notifier.state.filteredMembers.length, equals(3));
    });

    test('role filter filters by admin, member, or musical role ID', () async {
      notifier.state = MembersDirectoryState(
        ministryId: 'min_1',
        members: testMembers,
        roles: testRoles,
      );

      // Filter admin
      notifier.setRoleFilter('admin');
      expect(notifier.state.filteredMembers.length, equals(1));
      expect(notifier.state.filteredMembers.first.name, equals('Alice Silva'));

      // Filter member
      notifier.setRoleFilter('member');
      expect(notifier.state.filteredMembers.length, equals(2));

      // Filter musical role 'role_guitar'
      notifier.setRoleFilter('role_guitar');
      expect(notifier.state.filteredMembers.length, equals(1));
      expect(notifier.state.filteredMembers.first.name, equals('Bruno Souza'));

      // Clear filter
      notifier.setRoleFilter(null);
      expect(notifier.state.filteredMembers.length, equals(3));
    });

    test('pull-to-refresh updates members without blanking state', () async {
      notifier.state = MembersDirectoryState(
        ministryId: 'min_1',
        members: testMembers,
        roles: testRoles,
      );

      repo.membersToReturn = [
        ...testMembers,
        const MinistryMember(id: 'mem_4', name: 'Novo Integrante'),
      ];
      repo.rolesToReturn = testRoles;

      await notifier.refresh();

      expect(notifier.state.members.length, equals(4));
      expect(notifier.state.isRefreshing, isFalse);
    });

    test('reset clears state back to empty defaults', () {
      notifier.state = MembersDirectoryState(
        ministryId: 'min_1',
        members: testMembers,
        roles: testRoles,
      );

      notifier.reset();

      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.members, isEmpty);
      expect(notifier.state.roles, isEmpty);
    });
  });
}
