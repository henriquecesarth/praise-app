import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/admin_availability_controller.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class FakeAvailabilityRepository implements AvailabilityRepository {
  List<ConsolidatedAvailabilityItem> listResult = [];
  String? nextCursorResult;
  bool shouldThrow = false;
  AppFailure? failureToThrow;
  int listCallCount = 0;
  String? lastMinistryId;
  String? lastFrom;
  String? lastTo;
  String? lastMemberId;
  String? lastCursor;

  Completer<ConsolidatedAvailabilityResponse>? pendingCompleter;

  @override
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
    String ministryId, {
    required String from,
    required String to,
    String? memberId,
    int limit = 50,
    String? cursor,
  }) async {
    listCallCount++;
    lastMinistryId = ministryId;
    lastFrom = from;
    lastTo = to;
    lastMemberId = memberId;
    lastCursor = cursor;

    if (pendingCompleter != null) {
      return pendingCompleter!.future;
    }

    if (shouldThrow) {
      throw failureToThrow ??
          const AppFailure(message: 'Erro ao carregar disponibilidade.');
    }

    return ConsolidatedAvailabilityResponse(
      data: listResult,
      nextCursor: nextCursorResult,
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

class FakeMembersRepository implements MembersRepository {
  List<MinistryMember> members = [];

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async => members;

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async =>
      throw UnimplementedError();

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async => [];

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

ConsolidatedAvailabilityItem createDummyConsolidatedItem({
  required String id,
  required String ministryId,
  required String memberId,
  required String memberName,
  String startDate = '2026-10-10',
  String endDate = '2026-10-10',
  bool allDay = true,
}) {
  return ConsolidatedAvailabilityItem(
    id: id,
    ministryId: ministryId,
    memberId: memberId,
    memberName: memberName,
    startDate: startDate,
    endDate: endDate,
    allDay: allDay,
    startsAt: '${startDate}T00:00:00',
    endsAt: '${endDate}T23:59:59',
  );
}

void main() {
  late FakeAvailabilityRepository repository;
  late FakeMembersRepository membersRepository;
  late AdminAvailabilityNotifier notifier;

  setUp(() {
    repository = FakeAvailabilityRepository();
    membersRepository = FakeMembersRepository();
    notifier = AdminAvailabilityNotifier(
      repository: repository,
      membersRepository: membersRepository,
    );
  });

  group('AdminAvailabilityNotifier', () {
    test('loadForMinistry populates items and members on success', () async {
      final item = createDummyConsolidatedItem(
        id: 'c1',
        ministryId: 'min_1',
        memberId: 'm1',
        memberName: 'Membro Teste',
      );
      repository.listResult = [item];
      membersRepository.members = const [
        MinistryMember(id: 'm1', name: 'Membro Teste', role: 'member'),
      ];

      await notifier.loadForMinistry('min_1');

      final state = notifier.state;
      expect(state.isLoading, isFalse);
      expect(state.items.length, 1);
      expect(state.items.first.memberName, 'Membro Teste');
      expect(state.members.length, 1);
      expect(state.error, isNull);
      expect(state.rangeError, isNull);
      expect(state.isUnauthorized, isFalse);
    });

    test('loadForMinistry rejects range exceeding 90 days and skips repository call', () async {
      await notifier.loadForMinistry(
        'min_1',
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-06-01', // > 90 days
      );

      final state = notifier.state;
      expect(state.isLoading, isFalse);
      expect(state.rangeError, isNotNull);
      expect(state.rangeError, contains('90 dias civis'));
      expect(repository.listCallCount, 0);
    });

    test('loadForMinistry flags isUnauthorized on 403 Forbidden', () async {
      repository.shouldThrow = true;
      repository.failureToThrow = const AppFailure(
        message: 'Acesso restrito a administradores.',
        statusCode: 403,
      );

      await notifier.loadForMinistry('min_1');

      final state = notifier.state;
      expect(state.isLoading, isFalse);
      expect(state.isUnauthorized, isTrue);
      expect(state.error, 'Acesso restrito a administradores.');
    });

    test('setPreset updates planning window and triggers reload', () async {
      await notifier.loadForMinistry('min_1');
      expect(repository.listCallCount, 1);

      await notifier.setPreset('7d');
      expect(repository.listCallCount, 2);
      expect(notifier.state.selectedPreset, '7d');

      await notifier.setPreset('this_month');
      expect(repository.listCallCount, 3);
      expect(notifier.state.selectedPreset, 'this_month');
    });

    test('setMemberFilter filters by memberId and clears when null', () async {
      await notifier.loadForMinistry('min_1');

      await notifier.setMemberFilter('mem_filter_1');
      expect(notifier.state.selectedMemberId, 'mem_filter_1');
      expect(repository.lastMemberId, 'mem_filter_1');

      await notifier.setMemberFilter(null);
      expect(notifier.state.selectedMemberId, isNull);
      expect(repository.lastMemberId, isNull);
    });

    test('loadMore appends and deduplicates items', () async {
      final item1 = createDummyConsolidatedItem(
        id: 'c1',
        ministryId: 'min_1',
        memberId: 'm1',
        memberName: 'Nome 1',
      );
      repository.listResult = [item1];
      repository.nextCursorResult = 'cur_2';

      await notifier.loadForMinistry('min_1');
      expect(notifier.state.items.length, 1);

      final item2 = createDummyConsolidatedItem(
        id: 'c2',
        ministryId: 'min_1',
        memberId: 'm2',
        memberName: 'Nome 2',
      );
      // Repository returns c1 again and new c2
      repository.listResult = [item1, item2];
      repository.nextCursorResult = null;

      await notifier.loadMore();

      expect(notifier.state.items.length, 2);
      expect(notifier.state.items.map((i) => i.id).toList(), ['c1', 'c2']);
      expect(notifier.state.nextCursor, isNull);
    });

    test('refresh preserves items during fetch and replaces on arrival', () async {
      final initialItem = createDummyConsolidatedItem(
        id: 'c1',
        ministryId: 'min_1',
        memberId: 'm1',
        memberName: 'Inicial',
      );
      repository.listResult = [initialItem];

      await notifier.loadForMinistry('min_1');
      expect(notifier.state.items.first.memberName, 'Inicial');

      final updatedItem = createDummyConsolidatedItem(
        id: 'c1',
        ministryId: 'min_1',
        memberId: 'm1',
        memberName: 'Atualizado',
      );
      repository.listResult = [updatedItem];

      await notifier.refresh();

      expect(notifier.state.items.first.memberName, 'Atualizado');
      expect(notifier.state.isRefreshing, isFalse);
    });

    test('multi-tenant generation safety: discards pending Alpha response after switch to Beta', () async {
      final completerAlpha = Completer<ConsolidatedAvailabilityResponse>();
      repository.pendingCompleter = completerAlpha;

      // Start loading Ministry Alpha
      final futureAlpha = notifier.loadForMinistry('min_alpha');
      expect(notifier.state.ministryId, 'min_alpha');
      expect(notifier.state.isLoading, isTrue);

      // User switches to Ministry Beta before Alpha completes
      repository.pendingCompleter = null;
      repository.listResult = [
        createDummyConsolidatedItem(
          id: 'c_beta',
          ministryId: 'min_beta',
          memberId: 'm_beta',
          memberName: 'Membro Beta',
        ),
      ];

      await notifier.loadForMinistry('min_beta');
      expect(notifier.state.ministryId, 'min_beta');
      expect(notifier.state.items.first.memberName, 'Membro Beta');

      // Now complete the delayed Alpha request
      completerAlpha.complete(ConsolidatedAvailabilityResponse(
        data: [
          createDummyConsolidatedItem(
            id: 'c_alpha',
            ministryId: 'min_alpha',
            memberId: 'm_alpha',
            memberName: 'Membro Alpha Obsoleto',
          ),
        ],
      ));
      await futureAlpha;

      // State MUST remain Beta, Alpha response discarded
      expect(notifier.state.ministryId, 'min_beta');
      expect(notifier.state.items.first.memberName, 'Membro Beta');
    });

    test('reset clears all state and increments sequence', () async {
      repository.listResult = [
        createDummyConsolidatedItem(
          id: 'c1',
          ministryId: 'min_1',
          memberId: 'm1',
          memberName: 'M',
        ),
      ];
      await notifier.loadForMinistry('min_1');
      expect(notifier.state.items.isNotEmpty, isTrue);

      notifier.reset();

      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.items.isEmpty, isTrue);
      expect(notifier.state.members.isEmpty, isTrue);
    });
  });
}

