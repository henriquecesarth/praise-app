import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_form_controller.dart';

class MockScheduleRepo implements ScheduleRepository {
  int createCalls = 0;
  int updateCalls = 0;
  Map<String, dynamic>? lastSubmittedPayload;
  String? lastSubmittedMinistryId;
  AppFailure? errorToThrow;

  // For async fence testing
  Future<List<MinistryMember>> Function(String ministryId)? customGetMembers;
  Future<List<MinistryRole>> Function(String ministryId)? customGetRoles;

  @override
  Future<ScheduleDetail> createSchedule(
    String ministryId,
    Map<String, dynamic> data,
  ) async {
    createCalls++;
    lastSubmittedMinistryId = ministryId;
    lastSubmittedPayload = data;
    if (errorToThrow != null) throw errorToThrow!;
    return ScheduleDetail(
      id: 'sched-created-1',
      ministryId: ministryId,
      title: data['title'] as String? ?? 'Culto',
      date: data['date'] as String? ?? '2026-10-18',
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
    lastSubmittedMinistryId = ministryId;
    lastSubmittedPayload = data;
    if (errorToThrow != null) throw errorToThrow!;
    return ScheduleDetail(
      id: scheduleId,
      ministryId: ministryId,
      title: data['title'] as String? ?? 'Culto',
      date: data['date'] as String? ?? '2026-10-18',
      time: data['time'] as String? ?? '19:00',
    );
  }

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async {
    if (customGetMembers != null) return customGetMembers!(ministryId);
    return [
      MinistryMember(
        id: 'm1',
        name: 'Member 1 ($ministryId)',
        role: 'member',
        userId: 'u1',
      ),
    ];
  }

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async {
    if (customGetRoles != null) return customGetRoles!(ministryId);
    return [
      MinistryRole(
        id: 'r1',
        name: 'Vocal ($ministryId)',
      ),
    ];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('M11-R2 ScheduleFormNotifier Dirty State', () {
    test('form starts pristine, becomes dirty on edit, returns pristine on revert', () {
      final repo = MockScheduleRepo();
      final notifier = ScheduleFormNotifier(repository: repo);

      notifier.init(ministryId: 'min-1', boundUserId: 'user-1');
      expect(notifier.state.isDirty, isFalse);

      // Edit title -> dirty
      notifier.setTitle('Ensaio Geral');
      expect(notifier.state.isDirty, isTrue);

      // Revert title -> pristine
      notifier.setTitle('Culto');
      expect(notifier.state.isDirty, isFalse);

      // Edit duration -> dirty
      notifier.setDurationMinutes(90);
      expect(notifier.state.isDirty, isTrue);

      // Revert duration -> pristine
      notifier.setDurationMinutes(120);
      expect(notifier.state.isDirty, isFalse);

      // Edit isVisible -> dirty
      notifier.setIsVisible(false);
      expect(notifier.state.isDirty, isTrue);

      // Revert isVisible -> pristine
      notifier.setIsVisible(true);
      expect(notifier.state.isDirty, isFalse);

      // Add a song -> dirty
      const testSong = ScheduleSong(id: 's1', title: 'Graça');
      notifier.addSong(testSong);
      expect(notifier.state.isDirty, isTrue);

      // Remove the song -> pristine
      notifier.removeSong(0);
      expect(notifier.state.isDirty, isFalse);
    });
  });

  group('M11-R2 Async Generation Fence', () {
    test('Alpha late response does not overwrite Beta state after tenant switch', () async {
      final repo = MockScheduleRepo();
      final notifier = ScheduleFormNotifier(repository: repo);

      // Simulate Alpha taking longer than Beta
      repo.customGetMembers = (ministryId) async {
        if (ministryId == 'alpha-min') {
          await Future.delayed(const Duration(milliseconds: 50));
          return [
            const MinistryMember(id: 'alpha-user', name: 'Alpha Member', role: 'member', userId: 'au1'),
          ];
        } else {
          // Beta is fast
          return [
            const MinistryMember(id: 'beta-user', name: 'Beta Member', role: 'member', userId: 'bu1'),
          ];
        }
      };

      // 1. Alpha starts loading
      notifier.init(ministryId: 'alpha-min', boundUserId: 'u1');

      // 2. User quickly switches to Beta before Alpha completes
      notifier.init(ministryId: 'beta-min', boundUserId: 'u1');

      // Wait for both async loads to settle
      await Future.delayed(const Duration(milliseconds: 100));

      // 3. Final state must contain Beta ONLY, never Alpha
      expect(notifier.state.ministryId, equals('beta-min'));
      expect(notifier.state.availableMembers.length, equals(1));
      expect(notifier.state.availableMembers.first.id, equals('beta-user'));
    });
  });

  group('M11-R2 Tenant and Auth Fail-Closed Guards', () {
    test('invalidateTenant sets isInvalidated and prevents submit', () async {
      final repo = MockScheduleRepo();
      final notifier = ScheduleFormNotifier(repository: repo);

      notifier.init(ministryId: 'min-alpha', boundUserId: 'user-1');
      notifier.invalidateTenant();

      expect(notifier.state.isInvalidated, isTrue);

      final result = await notifier.submit(
        currentMinistryId: 'min-alpha',
        currentUserId: 'user-1',
      );

      expect(result, isNull);
      expect(repo.createCalls, equals(0));
    });

    test('submit rejects cross-tenant submission when activeMinistryId != boundMinistryId', () async {
      final repo = MockScheduleRepo();
      final notifier = ScheduleFormNotifier(repository: repo);

      notifier.init(ministryId: 'min-alpha', boundUserId: 'user-1');

      final result = await notifier.submit(
        currentMinistryId: 'min-beta', // Mismatch!
        currentUserId: 'user-1',
      );

      expect(result, isNull);
      expect(notifier.state.isInvalidated, isTrue);
      expect(repo.createCalls, equals(0));
    });

    test('submit rejects session identity mismatch when currentUserId != boundUserId', () async {
      final repo = MockScheduleRepo();
      final notifier = ScheduleFormNotifier(repository: repo);

      notifier.init(ministryId: 'min-alpha', boundUserId: 'user-1');

      final result = await notifier.submit(
        currentMinistryId: 'min-alpha',
        currentUserId: 'user-2', // Changed user!
      );

      expect(result, isNull);
      expect(notifier.state.isInvalidated, isTrue);
      expect(repo.createCalls, equals(0));
    });

    test('submit includes isVisible in payload', () async {
      final repo = MockScheduleRepo();
      final notifier = ScheduleFormNotifier(repository: repo);

      notifier.init(ministryId: 'min-1', boundUserId: 'user-1');
      notifier.setIsVisible(false);

      final result = await notifier.submit(
        currentMinistryId: 'min-1',
        currentUserId: 'user-1',
      );

      expect(result, isNotNull);
      expect(repo.createCalls, equals(1));
      expect(repo.lastSubmittedPayload?['is_visible'], isFalse);
    });
  });

  group('M11-R2 Mutation Error Matrix Safety', () {
    final testCases = <String, AppFailure>{
      '400 Bad Request': const AppFailure(message: 'Dados inválidos para a escala', statusCode: 400),
      '401 Unauthorized': const AppFailure(message: 'Sessão expirada', statusCode: 401),
      '403 Forbidden': const AppFailure(message: 'Sem permissão de líder', statusCode: 403),
      '404 Not Found': const AppFailure(message: 'Ministério ou escala não encontrado', statusCode: 404),
      '409 Conflict': const AppFailure(message: 'Conflito de versão', statusCode: 409),
      '500 Server Error': const AppFailure(message: 'Erro interno do servidor', statusCode: 500),
      'Network Failure': AppFailure.network(message: 'Sem conexão com a internet'),
    };

    for (final entry in testCases.entries) {
      test('safely handles ${entry.key} with isSubmitting false and error populated', () async {
        final repo = MockScheduleRepo();
        repo.errorToThrow = entry.value;

        final notifier = ScheduleFormNotifier(repository: repo);
        notifier.init(ministryId: 'min-1', boundUserId: 'user-1');

        final result = await notifier.submit(
          currentMinistryId: 'min-1',
          currentUserId: 'user-1',
        );

        expect(result, isNull);
        expect(notifier.state.isSubmitting, isFalse);
        expect(notifier.state.error, equals(entry.value.message));
        expect(notifier.state.submitSuccess, isFalse);
      });
    }
  });
}
