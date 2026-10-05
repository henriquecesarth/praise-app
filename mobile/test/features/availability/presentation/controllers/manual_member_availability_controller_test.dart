import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/manual_member_availability_controller.dart';

class FakeAvailabilityRepository implements AvailabilityRepository {
  List<MemberAvailability> listResult = [];
  String? nextCursorResult;
  bool shouldThrowList = false;
  bool shouldThrowMutation = false;
  AppFailure? listFailure;
  AppFailure? mutationFailure;

  String? lastMinistryId;
  String? lastMemberId;
  String? lastDeletedId;
  CreateAvailabilityPayload? lastCreatedPayload;
  UpdateAvailabilityPayload? lastUpdatedPayload;

  Completer<AvailabilityListResponse>? pendingListCompleter;
  Completer<MemberAvailability>? pendingCreateCompleter;

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
    String ministryId,
    String memberId, {
    int limit = 50,
    String? cursor,
  }) async {
    lastMinistryId = ministryId;
    lastMemberId = memberId;

    if (pendingListCompleter != null) {
      return pendingListCompleter!.future;
    }

    if (shouldThrowList) {
      throw listFailure ??
          const AppFailure(message: 'Erro ao carregar indisponibilidades.');
    }

    return AvailabilityListResponse(
      data: listResult,
      nextCursor: nextCursorResult,
    );
  }

  @override
  Future<MemberAvailability> createManualMemberAvailability(
    String ministryId,
    String memberId,
    CreateAvailabilityPayload payload,
  ) async {
    lastMinistryId = ministryId;
    lastMemberId = memberId;
    lastCreatedPayload = payload;

    if (pendingCreateCompleter != null) {
      return pendingCreateCompleter!.future;
    }

    if (shouldThrowMutation) {
      throw mutationFailure ??
          const AppFailure(message: 'Erro ao criar indisponibilidade.');
    }

    return MemberAvailability(
      id: 'created_id_1',
      ministryId: ministryId,
      memberId: memberId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      allDay: payload.allDay,
      startsAt: '${payload.startDate}T00:00:00',
      endsAt: '${payload.endDate}T23:59:59',
      reason: payload.reason,
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    );
  }

  @override
  Future<MemberAvailability> updateManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
    UpdateAvailabilityPayload payload,
  ) async {
    lastMinistryId = ministryId;
    lastMemberId = memberId;
    lastUpdatedPayload = payload;

    if (shouldThrowMutation) {
      throw mutationFailure ??
          const AppFailure(message: 'Erro ao atualizar indisponibilidade.');
    }

    return MemberAvailability(
      id: id,
      ministryId: ministryId,
      memberId: memberId,
      startDate: payload.startDate ?? '2026-10-01',
      endDate: payload.endDate ?? '2026-10-01',
      startTime: payload.startTime,
      endTime: payload.endTime,
      allDay: payload.allDay ?? true,
      startsAt: '2026-10-01T00:00:00',
      endsAt: '2026-10-01T23:59:59',
      reason: payload.reason,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    );
  }

  @override
  Future<void> deleteManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
  ) async {
    lastMinistryId = ministryId;
    lastMemberId = memberId;
    lastDeletedId = id;

    if (shouldThrowMutation) {
      throw mutationFailure ??
          const AppFailure(message: 'Erro ao remover indisponibilidade.');
    }
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
}

MemberAvailability createDummyManualItem({
  required String id,
  required String ministryId,
  required String memberId,
  String startDate = '2026-10-15',
  String endDate = '2026-10-15',
  bool allDay = true,
  String? reason,
}) {
  return MemberAvailability(
    id: id,
    ministryId: ministryId,
    memberId: memberId,
    startDate: startDate,
    endDate: endDate,
    allDay: allDay,
    startsAt: '${startDate}T00:00:00',
    endsAt: '${endDate}T23:59:59',
    reason: reason,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  );
}

void main() {
  late FakeAvailabilityRepository repository;
  late ManualMemberAvailabilityNotifier notifier;

  setUp(() {
    repository = FakeAvailabilityRepository();
    notifier = ManualMemberAvailabilityNotifier(repository: repository);
  });

  group('ManualMemberAvailabilityNotifier', () {
    test('load populates items on success', () async {
      final item = createDummyManualItem(
        id: 'man_1',
        ministryId: 'min_1',
        memberId: 'mem_1',
        reason: 'Motivo pessoal',
      );
      repository.listResult = [item];

      await notifier.load(ministryId: 'min_1', memberId: 'mem_1');

      final state = notifier.state;
      expect(state.isLoading, isFalse);
      expect(state.items.length, 1);
      expect(state.items.first.id, 'man_1');
      expect(state.items.first.reason, 'Motivo pessoal');
      expect(state.error, isNull);
      expect(state.isUnauthorized, isFalse);
    });

    test('load sets isUnauthorized on 403 Forbidden', () async {
      repository.shouldThrowList = true;
      repository.listFailure = const AppFailure(
        message: 'Apenas administradores podem gerenciar integrantes manuais.',
        statusCode: 403,
      );

      await notifier.load(ministryId: 'min_1', memberId: 'mem_1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isUnauthorized, isTrue);
      expect(notifier.state.error, contains('Apenas administradores'));
    });

    test('load sets isNotFound on 404 Not Found', () async {
      repository.shouldThrowList = true;
      repository.listFailure = const AppFailure(
        message: 'Membro manual não encontrado.',
        statusCode: 404,
      );

      await notifier.load(ministryId: 'min_1', memberId: 'non_existing');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isNotFound, isTrue);
      expect(notifier.state.error, contains('não encontrado'));
    });

    test('createAvailability prepends item and prevents concurrent double-submit', () async {
      await notifier.load(ministryId: 'min_1', memberId: 'mem_1');

      final completer = Completer<MemberAvailability>();
      repository.pendingCreateCompleter = completer;

      const payload = CreateAvailabilityPayload(
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        allDay: true,
        reason: 'Novo registro',
      );

      // Start first create mutation
      final future1 = notifier.createAvailability(
        payload: payload,
      );
      expect(notifier.state.isSubmitting, isTrue);

      // Attempt second create mutation while first is pending (double submit attempt)
      final future2 = notifier.createAvailability(
        payload: payload,
      );
      final result2 = await future2;
      expect(result2, isFalse); // Blocked by isSubmitting

      // Complete first mutation
      completer.complete(const MemberAvailability(
        id: 'new_item_id',
        ministryId: 'min_1',
        memberId: 'mem_1',
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        allDay: true,
        startsAt: '2026-10-20T00:00:00',
        endsAt: '2026-10-21T00:00:00',
        reason: 'Novo registro',
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      ));
      final result1 = await future1;

      expect(result1, isTrue);
      expect(notifier.state.isSubmitting, isFalse);
      expect(notifier.state.items.first.id, 'new_item_id');
    });

    test('updateAvailability replaces item in state list', () async {
      final initialItem = createDummyManualItem(
        id: 'upd_1',
        ministryId: 'min_1',
        memberId: 'mem_1',
        reason: 'Original',
      );
      repository.listResult = [initialItem];
      await notifier.load(ministryId: 'min_1', memberId: 'mem_1');

      const payload = UpdateAvailabilityPayload(
        startDate: '2026-10-25',
        endDate: '2026-10-25',
        reason: 'Modificado',
      );

      final success = await notifier.updateAvailability(
        id: 'upd_1',
        payload: payload,
      );

      expect(success, isTrue);
      expect(notifier.state.items.first.reason, 'Modificado');
    });

    test('deleteAvailability removes item from state list', () async {
      final item1 = createDummyManualItem(
        id: 'del_1',
        ministryId: 'min_1',
        memberId: 'mem_1',
      );
      final item2 = createDummyManualItem(
        id: 'keep_2',
        ministryId: 'min_1',
        memberId: 'mem_1',
      );
      repository.listResult = [item1, item2];
      await notifier.load(ministryId: 'min_1', memberId: 'mem_1');
      expect(notifier.state.items.length, 2);

      final success = await notifier.deleteAvailability(
        id: 'del_1',
      );

      expect(success, isTrue);
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, 'keep_2');
      expect(repository.lastDeletedId, 'del_1');
    });

    test('multi-tenant generation safety: pending Alpha response discarded on switch to Beta', () async {
      final completerAlpha = Completer<AvailabilityListResponse>();
      repository.pendingListCompleter = completerAlpha;

      final futureAlpha = notifier.load(ministryId: 'min_alpha', memberId: 'mem_alpha');
      expect(notifier.state.ministryId, 'min_alpha');
      expect(notifier.state.isLoading, isTrue);

      // Switch to Beta
      repository.pendingListCompleter = null;
      repository.listResult = [
        createDummyManualItem(
          id: 'b1',
          ministryId: 'min_beta',
          memberId: 'mem_beta',
          reason: 'Item de Beta',
        ),
      ];

      await notifier.load(ministryId: 'min_beta', memberId: 'mem_beta');
      expect(notifier.state.ministryId, 'min_beta');
      expect(notifier.state.items.first.id, 'b1');

      // Now complete old Alpha request
      completerAlpha.complete(AvailabilityListResponse(
        data: [
          createDummyManualItem(
            id: 'a1',
            ministryId: 'min_alpha',
            memberId: 'mem_alpha',
            reason: 'Item de Alpha',
          ),
        ],
      ));
      await futureAlpha;

      // Must remain Beta, Alpha discarded
      expect(notifier.state.ministryId, 'min_beta');
      expect(notifier.state.items.first.id, 'b1');
    });

    test('reset clears state completely', () async {
      repository.listResult = [
        createDummyManualItem(
          id: 'item_1',
          ministryId: 'min_1',
          memberId: 'mem_1',
        ),
      ];
      await notifier.load(ministryId: 'min_1', memberId: 'mem_1');
      expect(notifier.state.items.isNotEmpty, isTrue);

      notifier.reset();

      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.memberId, isNull);
      expect(notifier.state.items.isEmpty, isTrue);
    });
  });
}

