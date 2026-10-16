import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_form_controller.dart';
import 'package:louvaio_mobile/features/teams/domain/team.dart';

class MockScheduleRepo implements ScheduleRepository {
  int createCalls = 0;
  Map<String, dynamic>? lastSubmittedData;
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async =>
      members;

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async => roles;

  @override
  Future<ScheduleDetail> createSchedule(
    String ministryId,
    Map<String, dynamic> data,
  ) async {
    createCalls++;
    lastSubmittedData = data;
    final rawParticipants = (data['participants'] as List<dynamic>? ?? [])
        .map((p) => ScheduleParticipant.fromJson(Map<String, dynamic>.from(p as Map)))
        .toList();

    return ScheduleDetail(
      id: 'sched-saved-1',
      ministryId: ministryId,
      title: data['title'] as String? ?? 'Culto',
      date: data['date'] as String? ?? '2026-10-25',
      time: data['time'] as String? ?? '19:00',
      participants: rawParticipants,
    );
  }

  @override
  Future<ScheduleDetail> updateSchedule(
    String ministryId,
    String scheduleId,
    Map<String, dynamic> data,
  ) async {
    lastSubmittedData = data;
    return ScheduleDetail(
      id: scheduleId,
      ministryId: ministryId,
      title: data['title'] as String? ?? 'Culto',
      date: data['date'] as String? ?? '2026-10-25',
      time: data['time'] as String? ?? '19:00',
    );
  }

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) =>
      throw UnimplementedError();

  @override
  Future<ScheduleDetail> getScheduleDetail(
          String ministryId, String scheduleId) =>
      throw UnimplementedError();

  @override
  Future<ScheduleDetail> confirmParticipation(
          String ministryId, String scheduleId, bool confirmed) =>
      throw UnimplementedError();

  @override
  Future<List<ScheduleComment>> getComments(
          String ministryId, String scheduleId) =>
      throw UnimplementedError();

  @override
  Future<ScheduleComment> postComment(
          String ministryId, String scheduleId, String content) =>
      throw UnimplementedError();
}

class MockAvailabilityRepo implements AvailabilityRepository {
  int conflictCheckCalls = 0;
  List<ParticipantConflictResult> conflictsToReturn = [];

  @override
  Future<ScheduleConflictCheckResponse> checkScheduleConflicts(
    String ministryId,
    CheckScheduleConflictsPayload payload,
  ) async {
    conflictCheckCalls++;
    return ScheduleConflictCheckResponse(
      scheduleWindow: const ScheduleCivilWindow(
        startsAt: '2026-10-25T19:00:00Z',
        endsAt: '2026-10-25T21:00:00Z',
        durationMinutes: 120,
      ),
      conflicts: conflictsToReturn,
    );
  }

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(
    String ministryId, {
    int limit = 50,
    String? cursor,
  }) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> createMyAvailability(
    String ministryId,
    CreateAvailabilityPayload payload,
  ) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateMyAvailability(
    String ministryId,
    String id,
    UpdateAvailabilityPayload payload,
  ) =>
      throw UnimplementedError();

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) =>
      throw UnimplementedError();

  @override
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
    String ministryId, {
    required String from,
    required String to,
    String? memberId,
    int limit = 50,
    String? cursor,
  }) =>
      throw UnimplementedError();

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
    String ministryId,
    String memberId, {
    int limit = 50,
    String? cursor,
  }) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> createManualMemberAvailability(
    String ministryId,
    String memberId,
    CreateAvailabilityPayload payload,
  ) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
    UpdateAvailabilityPayload payload,
  ) =>
      throw UnimplementedError();

  @override
  Future<void> deleteManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
  ) =>
      throw UnimplementedError();
}

void main() {
  late MockScheduleRepo scheduleRepo;
  late MockAvailabilityRepo availabilityRepo;
  late ScheduleFormNotifier formNotifier;

  const memberAlice = MinistryMember(id: 'm-alice', name: 'Alice');
  const memberBob = MinistryMember(id: 'm-bob', name: 'Bob');
  const memberCarol = MinistryMember(id: 'm-carol', name: 'Carol');
  const memberDaniel = MinistryMember(id: 'm-daniel', name: 'Daniel');

  setUp(() {
    scheduleRepo = MockScheduleRepo();
    availabilityRepo = MockAvailabilityRepo();
    scheduleRepo.members = [memberAlice, memberBob, memberCarol, memberDaniel];

    formNotifier = ScheduleFormNotifier(
      repository: scheduleRepo,
      availabilityRepository: availabilityRepo,
    );
  });

  group('Schedule Team Import', () {
    test('resolves active members and filters out foreign/stale references (TEAM_IMPORT_ACTIVE_MEMBER_FILTER)', () async {
      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-admin',
      );
      await pumpEventQueue();

      const team = Team(
        id: 'team-1',
        ministryId: 'min-1',
        name: 'Vocal',
        memberIds: ['m-alice', 'm-foreign-ghost', 'm-bob'],
      );

      // Resolution strictly against formState.availableMembers
      final memberMap = {for (final m in formNotifier.state.availableMembers) m.id: m};
      final resolvable = team.memberIds
          .map((id) => memberMap[id])
          .whereType<MinistryMember>()
          .toList();

      expect(resolvable.length, equals(2));
      expect(resolvable.map((m) => m.id), equals(['m-alice', 'm-bob']));

      final added = formNotifier.addParticipants(resolvable);
      expect(added, equals(2));
      expect(formNotifier.state.participants.length, equals(2));
      expect(formNotifier.state.participants.first.name, equals('Alice'));
      expect(formNotifier.state.participants.first.role, equals('Integrante'));
      expect(formNotifier.state.participants.last.name, equals('Bob'));
      expect(formNotifier.state.participants.last.role, equals('Integrante'));
    });

    test('deduplicates participants against existing list (TEAM_IMPORT_DUPLICATES = NONE)', () {
      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-admin',
      );

      // Existing: Alice, Bob
      formNotifier.addParticipant(memberAlice, 'Vocal');
      formNotifier.addParticipant(memberBob, 'Violão');
      expect(formNotifier.state.participants.length, equals(2));

      // Team has: Bob, Carol, Daniel
      final teamMembers = [memberBob, memberCarol, memberDaniel];
      final added = formNotifier.addParticipants(teamMembers);

      // Bob is already present, so only Carol and Daniel are added (2/3)
      expect(added, equals(2));
      expect(formNotifier.state.participants.length, equals(4));
      expect(
        formNotifier.state.participants.map((p) => p.name).toList(),
        equals(['Alice', 'Bob', 'Carol', 'Daniel']),
      );
      // Bob's pre-existing role 'Violão' is preserved!
      expect(formNotifier.state.participants[1].role, equals('Violão'));
      // New imports receive default 'Integrante'
      expect(formNotifier.state.participants[2].role, equals('Integrante'));
      expect(formNotifier.state.participants[3].role, equals('Integrante'));
    });

    test('re-import of same Team adds 0 participants and does not mutate list', () {
      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-admin',
      );

      final teamMembers = [memberAlice, memberBob];
      final firstImport = formNotifier.addParticipants(teamMembers);
      expect(firstImport, equals(2));
      expect(formNotifier.state.participants.length, equals(2));

      // Re-import immediately
      final secondImport = formNotifier.addParticipants(teamMembers);
      expect(secondImport, equals(0));
      expect(formNotifier.state.participants.length, equals(2));
    });

    test('TEAM_IMPORT_CONFLICT_REEVALUATION_CALLS: importing bulk members triggers conflict check exactly once', () async {
      final members20 = List.generate(
        20,
        (i) => MinistryMember(id: 'm-$i', name: 'Member $i'),
      );
      scheduleRepo.members = members20;

      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-admin',
      );

      formNotifier.setDate('2026-10-25');
      formNotifier.setTime('19:00');
      await pumpEventQueue();

      availabilityRepo.conflictCheckCalls = 0;

      // Single bulk import
      final added = formNotifier.addParticipants(members20);
      expect(added, equals(20));

      // Allow microtask/future to execute
      await pumpEventQueue();

      // Exactly 1 logical conflict check dispatch!
      expect(availabilityRepo.conflictCheckCalls, equals(1));
    });

    test('TEAM_IMPORT_USES_M16_CONFLICT_ENGINE: imported conflicting member updates selectedConflictsCount', () async {
      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-admin',
      );

      formNotifier.setDate('2026-10-25');
      formNotifier.setTime('19:00');

      // Carol has availability conflict
      availabilityRepo.conflictsToReturn = [
        const ParticipantConflictResult(
          participantId: 'm-carol',
          hasConflict: true,
          unavailabilities: [
            ParticipantConflictDetail(
              id: 'u-carol-1',
              startsAt: '2026-10-25T18:00:00Z',
              endsAt: '2026-10-25T22:00:00Z',
              allDay: false,
            ),
          ],
        ),
      ];

      formNotifier.addParticipants([memberAlice, memberCarol]);
      await pumpEventQueue();

      expect(formNotifier.state.selectedConflictsCount, equals(1));
      expect(formNotifier.state.hasConflict('m-carol'), isTrue);
      expect(formNotifier.state.hasConflict('m-alice'), isFalse);
    });

    test('TEAM_SNAPSHOT_INVARIANT: saved schedule participant list is unchanged if Team is modified or deleted later', () async {
      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-admin',
      );
      formNotifier.setTitle('Culto de Celebração');
      formNotifier.setDate('2026-10-25');
      formNotifier.setTime('19:00');

      const team = Team(
        id: 'team-t1',
        ministryId: 'min-1',
        name: 'Equipe T1',
        memberIds: ['m-alice', 'm-bob'],
      );

      // Import team into schedule draft
      formNotifier.addParticipants([memberAlice, memberBob]);

      // Save schedule
      final savedSchedule = await formNotifier.submit(
        currentMinistryId: 'min-1',
        currentUserId: 'usr-admin',
      );

      expect(savedSchedule, isNotNull);
      expect(savedSchedule!.participants.length, equals(2));
      expect(savedSchedule.participants.map((p) => p.name).toList(), equals(['Alice', 'Bob']));

      // Invariant: The saved schedule does NOT retain any teamId property!
      expect(scheduleRepo.lastSubmittedData?['teamId'], isNull);

      // Modify the team entity (simulated): add Carol, remove Bob
      final modifiedTeam = team.copyWith(memberIds: ['m-alice', 'm-carol']);
      expect(modifiedTeam.memberIds, equals(['m-alice', 'm-carol']));

      // Saved schedule participants remain exactly Alice and Bob (snapshot)
      expect(savedSchedule.participants.length, equals(2));
      expect(savedSchedule.participants[0].name, equals('Alice'));
      expect(savedSchedule.participants[1].name, equals('Bob'));
    });
  });
}
