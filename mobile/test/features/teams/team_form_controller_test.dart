import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/teams/data/team_repository.dart';
import 'package:louvaio_mobile/features/teams/domain/team.dart';
import 'package:louvaio_mobile/features/teams/presentation/controllers/team_form_controller.dart';

class FakeTeamRepo implements TeamRepository {
  Team? createdTeamToReturn;
  Team? updatedTeamToReturn;
  Completer<Team>? pendingCompleter;
  Completer<void>? pendingDeleteCompleter;
  Exception? errorToThrow;

  String? lastCreateName;
  List<String>? lastCreateMembers;
  List<String>? lastUpdateMembers;

  @override
  Future<List<Team>> getTeams(String ministryId) async =>
      throw UnimplementedError();

  @override
  Future<Team> getTeamById(String ministryId, String teamId) async =>
      throw UnimplementedError();

  @override
  Future<Team> createTeam(String ministryId,
      {required String name,
      String? description,
      List<String>? memberIds}) async {
    lastCreateName = name;
    lastCreateMembers = memberIds;
    if (errorToThrow != null) throw errorToThrow!;
    if (pendingCompleter != null) return pendingCompleter!.future;
    return createdTeamToReturn ??
        Team(id: 'created-1', ministryId: ministryId, name: name, memberIds: memberIds ?? []);
  }

  @override
  Future<Team> updateTeam(String ministryId, String teamId,
      {String? name,
      String? description,
      List<String>? memberIds}) async {
    lastUpdateMembers = memberIds;
    if (errorToThrow != null) throw errorToThrow!;
    if (pendingCompleter != null) return pendingCompleter!.future;
    return updatedTeamToReturn ??
        Team(id: teamId, ministryId: ministryId, name: name ?? '', memberIds: memberIds ?? []);
  }

  @override
  Future<void> deleteTeam(String ministryId, String teamId) async {
    if (errorToThrow != null) throw errorToThrow!;
    if (pendingDeleteCompleter != null) return pendingDeleteCompleter!.future;
  }
}

class FakeMembersRepo implements MembersRepository {
  List<MinistryMember> membersToReturn = [];
  Completer<List<MinistryMember>>? pendingCompleter;
  Exception? errorToThrow;

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async {
    if (errorToThrow != null) throw errorToThrow!;
    if (pendingCompleter != null) return pendingCompleter!.future;
    return membersToReturn;
  }

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async => [];

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async =>
      throw UnimplementedError();

  @override
  Future<MinistryMember> addMember({
    required String ministryId,
    required String name,
    required String email,
    String role = 'member',
    String? birthDate,
    List<String> roleIds = const [],
  }) async =>
      throw UnimplementedError();

  @override
  Future<MinistryMember> updateMember({
    required String ministryId,
    required String memberId,
    String? name,
    String? email,
    String? birthDate,
    String? role,
    List<String>? roleIds,
  }) async =>
      throw UnimplementedError();

  @override
  Future<void> removeMember({
    required String ministryId,
    required String memberId,
  }) async =>
      throw UnimplementedError();
}

void main() {
  late FakeTeamRepo teamRepo;
  late FakeMembersRepo membersRepo;
  late TeamFormNotifier notifier;

  setUp(() {
    teamRepo = FakeTeamRepo();
    membersRepo = FakeMembersRepo();
    notifier = TeamFormNotifier(
      teamRepository: teamRepo,
      membersRepository: membersRepo,
    );
  });

  group('TeamFormNotifier', () {
    test('init in create mode sets empty member selection', () {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        availableMembers: [
          const MinistryMember(id: 'm1', name: 'Alice'),
          const MinistryMember(id: 'm2', name: 'Bob'),
        ],
      );

      expect(notifier.state.isEditing, isFalse);
      expect(notifier.state.ministryId, equals('min-1'));
      expect(notifier.state.boundUserId, equals('usr-1'));
      expect(notifier.state.selectedMemberIds, isEmpty);
      expect(notifier.state.availableMembers.length, equals(2));
      expect(notifier.state.isDirty, isFalse);
    });

    test('init in edit mode intersects initialTeam.memberIds with active members (EDIT_SAVE_CANONICALIZES_TO_CURRENT_ACTIVE_SELECTION)', () {
      const oldTeam = Team(
        id: 'team-1',
        ministryId: 'min-1',
        name: 'Vocalistas',
        description: 'Vozes',
        memberIds: ['m1', 'm-removed-ghost'],
      );

      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        initialTeam: oldTeam,
        availableMembers: [
          const MinistryMember(id: 'm1', name: 'Alice'),
          const MinistryMember(id: 'm2', name: 'Bob'),
        ],
      );

      expect(notifier.state.isEditing, isTrue);
      // 'm-removed-ghost' is not in availableMembers, so it is filtered out of selectedMemberIds
      expect(notifier.state.selectedMemberIds, equals({'m1'}));
      expect(notifier.state.isDirty, isFalse);
    });

    test('toggleMember adds and removes with Set uniqueness', () {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        availableMembers: [
          const MinistryMember(id: 'm1', name: 'Alice'),
        ],
      );

      notifier.toggleMember('m1');
      expect(notifier.state.selectedMemberIds, equals({'m1'}));
      expect(notifier.state.isDirty, isTrue);

      notifier.toggleMember('m1');
      expect(notifier.state.selectedMemberIds, isEmpty);
      expect(notifier.state.isDirty, isFalse);
    });

    test('dynamic isDirty calculation', () {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        availableMembers: [const MinistryMember(id: 'm1', name: 'Alice')],
      );

      expect(notifier.state.isDirty, isFalse);

      notifier.setName('Novo Nome');
      expect(notifier.state.isDirty, isTrue);

      notifier.setName('');
      expect(notifier.state.isDirty, isFalse);

      notifier.setDescription('Descrição');
      expect(notifier.state.isDirty, isTrue);

      notifier.setDescription('');
      expect(notifier.state.isDirty, isFalse);
    });

    test('createTeam success returns TeamMutationResult.success', () async {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        availableMembers: [const MinistryMember(id: 'm1', name: 'Alice')],
      );
      notifier.toggleMember('m1');

      final result = await notifier.createTeam(name: 'Banda', description: 'Desc');

      expect(result.isSuccess, isTrue);
      expect(result.data?.name, equals('Banda'));
      expect(teamRepo.lastCreateMembers, equals(['m1']));
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('TEAM_CREATE_DUPLICATE_SUBMIT = BLOCKED', () async {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        availableMembers: [],
      );

      final completer = Completer<Team>();
      teamRepo.pendingCompleter = completer;

      // First submit
      final f1 = notifier.createTeam(name: 'T1');
      expect(notifier.state.isSubmitting, isTrue);

      // Second submit while f1 in-flight
      final f2 = notifier.createTeam(name: 'T1 Duplicate');
      final result2 = await f2;

      expect(result2.isDiscarded, isTrue);

      completer.complete(const Team(id: 't1', ministryId: 'min-1', name: 'T1'));
      final result1 = await f1;
      expect(result1.isSuccess, isTrue);
    });

    test('TEAM_CREATE_SESSION_FENCING: user change while create in-flight discards result', () async {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-A',
        availableMembers: [],
      );

      final completer = Completer<Team>();
      teamRepo.pendingCompleter = completer;

      final future = notifier.createTeam(name: 'Team A');

      // User switches to User B (which triggers reset/init)
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-B',
        availableMembers: [],
      );

      completer.complete(const Team(id: 't-a', ministryId: 'min-1', name: 'Team A'));
      final result = await future;

      expect(result.isDiscarded, isTrue);
    });

    test('TEAM_MUTATION_TENANT_FENCING: tenant switch while edit in-flight discards result', () async {
      const oldTeam = Team(id: 't-1', ministryId: 'min-alpha', name: 'Alpha Team');
      notifier.init(
        ministryId: 'min-alpha',
        boundUserId: 'usr-1',
        initialTeam: oldTeam,
      );

      final completer = Completer<Team>();
      teamRepo.pendingCompleter = completer;

      final future = notifier.updateTeam(teamId: 't-1', name: 'Alpha Updated');

      // Ministry switches to Beta
      notifier.invalidateTenant();

      completer.complete(const Team(id: 't-1', ministryId: 'min-alpha', name: 'Alpha Updated'));
      final result = await future;

      expect(result.isDiscarded, isTrue);
    });

    test('deleteTeam success and duplicate submit protection', () async {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
        initialTeam: const Team(id: 't-1', ministryId: 'min-1', name: 'To Delete'),
      );

      final completer = Completer<void>();
      teamRepo.pendingDeleteCompleter = completer;

      final f1 = notifier.deleteTeam('t-1');
      expect(notifier.state.isSubmitting, isTrue);

      // Duplicate delete attempt
      final f2 = notifier.deleteTeam('t-1');
      final r2 = await f2;
      expect(r2.isDiscarded, isTrue);

      completer.complete();
      final r1 = await f1;
      expect(r1.isSuccess, isTrue);
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('error during create returns TeamMutationResult.failure', () async {
      notifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-1',
      );
      teamRepo.errorToThrow = const AppFailure(message: 'Nome já existe');

      final result = await notifier.createTeam(name: 'Duplicado');

      expect(result.isFailure, isTrue);
      expect(result.errorMessage, equals('Nome já existe'));
      expect(notifier.state.errorMessage, equals('Nome já existe'));
      expect(notifier.state.isSubmitting, isFalse);
    });
  });
}
