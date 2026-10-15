import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_form_controller.dart';

import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';

class MockScheduleRepo implements ScheduleRepository {
  int createCalls = 0;
  int updateCalls = 0;
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
    return ScheduleDetail(
      id: 'sched-1',
      ministryId: ministryId,
      title: data['title'] as String? ?? 'Culto',
      date: data['date'] as String? ?? '2026-10-25',
      time: data['time'] as String? ?? '19:00',
    );
  }

  @override
  Future<ScheduleDetail> updateSchedule(
    String ministryId,
    String scheduleId,
    Map<String, dynamic> data,
  ) async {
    updateCalls++;
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
  int checkCalls = 0;
  List<CheckScheduleConflictsPayload> checkPayloads = [];
  Future<ScheduleConflictCheckResponse> Function(
    String ministryId,
    CheckScheduleConflictsPayload payload,
  )? customCheck;

  bool shouldThrow = false;
  AppFailure? failureToThrow;

  @override
  Future<ScheduleConflictCheckResponse> checkScheduleConflicts(
    String ministryId,
    CheckScheduleConflictsPayload payload,
  ) async {
    checkCalls++;
    checkPayloads.add(payload);

    if (customCheck != null) {
      return customCheck!(ministryId, payload);
    }

    if (shouldThrow) {
      throw failureToThrow ??
          const AppFailure(message: 'Erro na verificação de conflitos.');
    }

    return ScheduleConflictCheckResponse(
      scheduleWindow: ScheduleCivilWindow(
        startsAt: '${payload.date}T${payload.time}:00',
        endsAt: '${payload.date}T21:00:00',
        durationMinutes: payload.durationMinutes ?? 120,
      ),
      conflicts: payload.participantIds.map((id) {
        final isConflict = id.contains('conflict');
        return ParticipantConflictResult(
          participantId: id,
          memberId: id,
          hasConflict: isConflict,
          unavailabilities: isConflict
              ? [
                  ParticipantConflictDetail(
                    id: 'u_$id',
                    startsAt: '${payload.date}T00:00:00',
                    endsAt: '${payload.date}T23:59:59',
                    allDay: true,
                  )
                ]
              : [],
        );
      }).toList(),
    );
  }

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(String ministryId,
          {int limit = 50, String? cursor}) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> createMyAvailability(
          String ministryId, CreateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateMyAvailability(String ministryId, String id,
          UpdateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) =>
      throw UnimplementedError();

  @override
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
          String ministryId,
          {required String from,
          required String to,
          String? memberId,
          int limit = 50,
          String? cursor}) =>
      throw UnimplementedError();

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
          String ministryId, String memberId,
          {int limit = 50, String? cursor}) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> createManualMemberAvailability(
          String ministryId,
          String memberId,
          CreateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateManualMemberAvailability(
          String ministryId,
          String memberId,
          String id,
          UpdateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<void> deleteManualMemberAvailability(
          String ministryId, String memberId, String id) =>
      throw UnimplementedError();
}

void main() {
  late MockScheduleRepo scheduleRepo;
  late MockAvailabilityRepo availabilityRepo;
  late ScheduleFormNotifier notifier;

  setUp(() {
    scheduleRepo = MockScheduleRepo();
    availabilityRepo = MockAvailabilityRepo();
    notifier = ScheduleFormNotifier(
      repository: scheduleRepo,
      availabilityRepository: availabilityRepo,
    );
  });

  tearDown(() {
    notifier.dispose();
  });

  group('ScheduleFormNotifier Availability Conflict Hardening', () {
    test('init in create mode evaluates availability for available members',
        () async {
      scheduleRepo.members = [
        const MinistryMember(id: 'mem_ok', name: 'Membro Normal', role: 'Vocal'),
        const MinistryMember(
            id: 'mem_conflict', name: 'Membro Ocupado', role: 'Bateria'),
      ];

      notifier.init(ministryId: 'min_1');

      // Allow members load and conflict check to complete
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(availabilityRepo.checkCalls, 1);
      final state = notifier.state;
      expect(state.availabilityConflictByMemberId.containsKey('mem_ok'), isTrue);
      expect(state.hasConflict('mem_ok'), isFalse);

      expect(
          state.availabilityConflictByMemberId.containsKey('mem_conflict'), isTrue);
      expect(state.hasConflict('mem_conflict'), isTrue);

      // No participants selected yet
      expect(state.selectedConflictsCount, 0);
      expect(state.conflictingParticipants, isEmpty);
    });

    test('init in edit mode evaluates existing participants immediately',
        () async {
      const initialSchedule = ScheduleDetail(
        id: 'sched_1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-25',
        time: '19:00',
        durationMinutes: 120,
        participants: [ ScheduleParticipant(
            id: 'mem_conflict',
            name: 'Membro Ocupado',
            role: 'Bateria',
          ), ScheduleParticipant(
            id: 'mem_ok',
            name: 'Membro Livre',
            role: 'Teclado',
          ),
        ],
      );

      notifier.init(
        ministryId: 'min_1',
        initialSchedule: initialSchedule,
      );

      // Wait for immediate conflict check to resolve
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final state = notifier.state;
      expect(state.selectedConflictsCount, 1);
      expect(state.conflictingParticipants.length, 1);
      expect(state.conflictingParticipants.first.id, 'mem_conflict');
      expect(state.hasConflict('mem_conflict'), isTrue);
      expect(state.hasConflict('mem_ok'), isFalse);
    });

    test('debounces date, time, and duration changes by 300ms', () async {
      scheduleRepo.members = [
        const MinistryMember(id: 'mem_1', name: 'Membro', role: 'Vocal'),
      ];

      notifier.init(ministryId: 'min_1');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(availabilityRepo.checkCalls, 1);

      // Rapidly change date, time, duration in < 300ms
      notifier.setDate('2026-11-01');
      notifier.setTime('20:00');
      notifier.setDurationMinutes(90);

      // Before 300ms, no new network calls have been made
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(availabilityRepo.checkCalls, 1);

      // After 300ms debounce expires, exactly 1 new check was made with the final values
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(availabilityRepo.checkCalls, 2);

      final lastPayload = availabilityRepo.checkPayloads.last;
      expect(lastPayload.date, '2026-11-01');
      expect(lastPayload.time, '20:00');
      expect(lastPayload.durationMinutes, 90);
    });

    test('Race Condition B: generation token fences stale out-of-order responses',
        () async {
      scheduleRepo.members = [
        const MinistryMember(id: 'mem_conflict_d1', name: 'M1', role: 'Vocal'),
        const MinistryMember(id: 'mem_ok_d2', name: 'M2', role: 'Vocal'),
      ];

      final completerD1 = Completer<ScheduleConflictCheckResponse>();
      final completerD2 = Completer<ScheduleConflictCheckResponse>();

      availabilityRepo.customCheck = (minId, payload) {
        if (payload.date == '2026-10-25') {
          return completerD1.future;
        } else {
          return completerD2.future;
        }
      };

      notifier.init(ministryId: 'min_1');
      // Trigger check for D1
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // Now change date to D2
      notifier.setDate('2026-10-30');
      // Wait for debounce to fire D2 request
      await Future<void>.delayed(const Duration(milliseconds: 350));

      expect(availabilityRepo.checkCalls, 2);

      // D2 finishes FIRST (e.g. fast cache or network)
      completerD2.complete(const ScheduleConflictCheckResponse(
        scheduleWindow: ScheduleCivilWindow(
          startsAt: '2026-10-30T19:00:00',
          endsAt: '2026-10-30T21:00:00',
          durationMinutes: 120,
        ),
        conflicts: [ ParticipantConflictResult(
            participantId: 'mem_ok_d2',
            hasConflict: false,
          ),
        ],
      ));

      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(notifier.state.availabilityConflictByMemberId.containsKey('mem_ok_d2'),
          isTrue);

      // D1 finishes LATER (stale slow response)
      completerD1.complete(const ScheduleConflictCheckResponse(
        scheduleWindow: ScheduleCivilWindow(
          startsAt: '2026-10-25T19:00:00',
          endsAt: '2026-10-25T21:00:00',
          durationMinutes: 120,
        ),
        conflicts: [ ParticipantConflictResult(
            participantId: 'mem_conflict_d1',
            hasConflict: true,
          ),
        ],
      ));

      await Future<void>.delayed(const Duration(milliseconds: 50));

      // Invariant: D1 stale response was safely discarded by generation token check!
      expect(
          notifier.state.availabilityConflictByMemberId.containsKey('mem_conflict_d1'),
          isFalse);
      expect(notifier.state.availabilityConflictByMemberId.containsKey('mem_ok_d2'),
          isTrue);
    });

    test('Race Condition A: tenant invalidation discards in-flight conflict checks',
        () async {
      final completer = Completer<ScheduleConflictCheckResponse>();
      availabilityRepo.customCheck = (minId, payload) => completer.future;

      notifier.init(ministryId: 'min_1');
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // Tenant switch happens while check is in-flight
      notifier.invalidateTenant();
      expect(notifier.state.isInvalidated, isTrue);

      // Request finishes later
      completer.complete(const ScheduleConflictCheckResponse(
        scheduleWindow: ScheduleCivilWindow(
          startsAt: '2026-10-25T19:00:00',
          endsAt: '2026-10-25T21:00:00',
          durationMinutes: 120,
        ),
        conflicts: [
          ParticipantConflictResult(
            participantId: 'mem_1',
            hasConflict: true,
          ),
        ],
      ));

      await Future<void>.delayed(const Duration(milliseconds: 50));
      // Stale data is NOT applied to state
      expect(notifier.state.availabilityConflictByMemberId, isEmpty);
      expect(notifier.state.isCheckingConflicts, isFalse);
    });

    test('Race Condition D: participant removal updates count synchronously with 0ms latency',
        () async {
      const initialSchedule = ScheduleDetail(
        id: 's1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-25',
        time: '19:00',
        participants: [ ScheduleParticipant(
            id: 'mem_conflict_1',
            name: 'P1',
            role: 'Bateria',
          ), ScheduleParticipant(
            id: 'mem_conflict_2',
            name: 'P2',
            role: 'Guitarra',
          ),
        ],
      );

      notifier.init(ministryId: 'min_1', initialSchedule: initialSchedule);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(notifier.state.selectedConflictsCount, 2);
      final initialCheckCalls = availabilityRepo.checkCalls;

      // Remove 1 conflicting participant
      notifier.removeParticipant(0);

      // Immediately updated synchronously without extra network call!
      expect(notifier.state.selectedConflictsCount, 1);
      expect(availabilityRepo.checkCalls, initialCheckCalls);

      // Remove the second conflicting participant
      notifier.removeParticipant(0);
      expect(notifier.state.selectedConflictsCount, 0);
      expect(availabilityRepo.checkCalls, initialCheckCalls);
    });

    test('splits candidates into chunks of 50 and merges results', () async {
      // Create 65 members (exceeding backend 50 limit)
      scheduleRepo.members = List.generate(
        65,
        (i) => MinistryMember(
          id: i == 60 ? 'mem_conflict_60' : 'mem_$i',
          name: 'Member $i',
          role: 'Vocal',
        ),
      );

      notifier.init(ministryId: 'min_1');
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // Should have performed 2 chunked requests: 50 and 15
      expect(availabilityRepo.checkCalls, 2);
      expect(availabilityRepo.checkPayloads[0].participantIds.length, 50);
      expect(availabilityRepo.checkPayloads[1].participantIds.length, 15);

      // Merged map contains all 65 results
      expect(notifier.state.availabilityConflictByMemberId.length, 65);
      expect(notifier.state.hasConflict('mem_conflict_60'), isTrue);
      expect(notifier.state.hasConflict('mem_0'), isFalse);
    });

    test('advisory save: conflicts never block submit', () async {
      const initialSchedule = ScheduleDetail(
        id: 'sched_1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-25',
        time: '19:00',
        participants: [ ScheduleParticipant(
            id: 'mem_conflict',
            name: 'Membro Indisponivel',
            role: 'Vocal',
          ),
        ],
      );

      notifier.init(ministryId: 'min_1', initialSchedule: initialSchedule);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(notifier.state.selectedConflictsCount, 1);

      // Submit should succeed smoothly despite conflict
      final saved = await notifier.submit();
      expect(saved, isNotNull);
      expect(scheduleRepo.updateCalls, 1);
      expect(notifier.state.submitSuccess, isTrue);
    });

    test('API failure sets conflictError, retryConflictCheck retries', () async {
      availabilityRepo.shouldThrow = true;
      scheduleRepo.members = [
        const MinistryMember(id: 'mem_1', name: 'Membro', role: 'Vocal'),
      ];

      notifier.init(ministryId: 'min_1');
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(notifier.state.isCheckingConflicts, isFalse);
      expect(notifier.state.conflictError, isNotNull);

      // Submit is STILL not blocked by conflict checking failure!
      final saved = await notifier.submit();
      expect(saved, isNotNull);

      // Retry recovers when repository succeeds
      availabilityRepo.shouldThrow = false;
      notifier.retryConflictCheck();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(notifier.state.conflictError, isNull);
      expect(notifier.state.availabilityConflictByMemberId.isNotEmpty, isTrue);
    });
  });
}
