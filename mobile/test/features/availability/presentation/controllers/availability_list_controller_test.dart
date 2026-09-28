import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/availability_list_controller.dart';

class FakeAvailabilityRepository implements AvailabilityRepository {
  List<MemberAvailability> listResult = [];
  String? nextCursorResult;
  bool shouldThrow = false;
  AppFailure? failureToThrow;
  int listCallCount = 0;
  String? lastMinistryId;
  String? lastCursor;

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(
    String ministryId, {
    int limit = 50,
    String? cursor,
  }) async {
    listCallCount++;
    lastMinistryId = ministryId;
    lastCursor = cursor;

    if (shouldThrow) {
      throw failureToThrow ??
          const AppFailure(message: 'Erro ao carregar indisponibilidades.');
    }
    return AvailabilityListResponse(
      data: listResult,
      nextCursor: nextCursorResult,
    );
  }

  @override
  Future<MemberAvailability> createMyAvailability(
    String ministryId,
    CreateAvailabilityPayload payload,
  ) async {
    throw UnimplementedError();
  }

  @override
  Future<MemberAvailability> updateMyAvailability(
    String ministryId,
    String id,
    UpdateAvailabilityPayload payload,
  ) async {
    throw UnimplementedError();
  }

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) async {
    throw UnimplementedError();
  }
}

MemberAvailability createDummyAvailability({
  required String id,
  required String ministryId,
  String startDate = '2026-10-04',
  String endDate = '2026-10-04',
  bool allDay = true,
  String? reason,
}) {
  return MemberAvailability(
    id: id,
    ministryId: ministryId,
    memberId: 'mem_1',
    startDate: startDate,
    endDate: endDate,
    allDay: allDay,
    startsAt: '$startDate"T00:00:00',
    endsAt: '$endDate"T23:59:59',
    reason: reason,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  );
}

void main() {
  late FakeAvailabilityRepository repository;
  late AvailabilityListNotifier notifier;

  setUp(() {
    repository = FakeAvailabilityRepository();
    notifier = AvailabilityListNotifier(repository: repository);
  });

  group('AvailabilityListNotifier', () {
    test('loadForMinistry populates items and nextCursor on success', () async {
      final item = createDummyAvailability(id: 'avail_1', ministryId: 'min_A');
      repository.listResult = [item];
      repository.nextCursorResult = 'cur_123';

      await notifier.loadForMinistry('min_A');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.ministryId, 'min_A');
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, 'avail_1');
      expect(notifier.state.nextCursor, 'cur_123');
      expect(notifier.state.hasMore, isTrue);
      expect(notifier.state.error, isNull);
    });

    test('loadForMinistry sets error on failure', () async {
      repository.shouldThrow = true;
      repository.failureToThrow =
          const AppFailure(message: 'Falha de conexão', statusCode: 500);

      await notifier.loadForMinistry('min_A');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.error, 'Falha de conexão');
    });

    test('loadForMinistry clears previous items immediately on ministry switch',
        () async {
      // First ministry
      final itemA = createDummyAvailability(id: 'avail_A', ministryId: 'min_A');
      repository.listResult = [itemA];
      await notifier.loadForMinistry('min_A');
      expect(notifier.state.items.length, 1);

      // Now switch to min_B
      repository.listResult = [
        createDummyAvailability(id: 'avail_B', ministryId: 'min_B'),
      ];

      final future = notifier.loadForMinistry('min_B');

      // Old items cleared synchronously during initial switch
      expect(notifier.state.ministryId, 'min_B');
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.isLoading, isTrue);

      await future;

      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, 'avail_B');
    });

    test('refresh preserves items while refreshing, replaces on success',
        () async {
      final item1 = createDummyAvailability(id: 'avail_1', ministryId: 'min_A');
      repository.listResult = [item1];
      repository.nextCursorResult = 'page1';
      await notifier.loadForMinistry('min_A');

      final item2 = createDummyAvailability(id: 'avail_2', ministryId: 'min_A');
      repository.listResult = [item2];
      repository.nextCursorResult = null;

      await notifier.refresh();

      expect(notifier.state.isRefreshing, isFalse);
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, 'avail_2');
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, isFalse);
    });

    test('loadMore appends items and deduplicates defensively by ID', () async {
      final item1 = createDummyAvailability(id: 'avail_1', ministryId: 'min_A');
      repository.listResult = [item1];
      repository.nextCursorResult = 'cursor_page2';
      await notifier.loadForMinistry('min_A');

      final item2 = createDummyAvailability(id: 'avail_2', ministryId: 'min_A');
      // Duplicate item1 + new item2
      repository.listResult = [item1, item2];
      repository.nextCursorResult = null;

      await notifier.loadMore();

      expect(notifier.state.isLoadingMore, isFalse);
      expect(notifier.state.items.length, 2);
      expect(notifier.state.items.map((i) => i.id).toList(),
          ['avail_1', 'avail_2']);
      expect(notifier.state.nextCursor, isNull);
    });

    test('loadMore does nothing when hasMore is false', () async {
      final item1 = createDummyAvailability(id: 'avail_1', ministryId: 'min_A');
      repository.listResult = [item1];
      repository.nextCursorResult = null;
      await notifier.loadForMinistry('min_A');

      final beforeCount = repository.listCallCount;
      await notifier.loadMore();

      expect(repository.listCallCount, beforeCount);
    });

    test('addCreated prepends item when ministryId matches', () async {
      final item1 = createDummyAvailability(id: 'avail_1', ministryId: 'min_A');
      repository.listResult = [item1];
      await notifier.loadForMinistry('min_A');

      final newItem =
          createDummyAvailability(id: 'avail_new', ministryId: 'min_A');
      notifier.addCreated(newItem);

      expect(notifier.state.items.length, 2);
      expect(notifier.state.items.first.id, 'avail_new');
    });

    test('updateItem replaces existing item by ID', () async {
      final item1 = createDummyAvailability(
          id: 'avail_1', ministryId: 'min_A', reason: 'Old');
      repository.listResult = [item1];
      await notifier.loadForMinistry('min_A');

      const updated = MemberAvailability(
        id: 'avail_1',
        ministryId: 'min_A',
        memberId: 'mem_1',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
        allDay: true,
        startsAt: '2026-10-04T00:00:00',
        endsAt: '2026-10-05T00:00:00',
        reason: 'Updated Reason',
        createdAt: '',
        updatedAt: '',
      );

      notifier.updateItem(updated);

      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.reason, 'Updated Reason');
    });

    test('removeItem filters out item by ID', () async {
      final item1 = createDummyAvailability(id: 'avail_1', ministryId: 'min_A');
      final item2 = createDummyAvailability(id: 'avail_2', ministryId: 'min_A');
      repository.listResult = [item1, item2];
      await notifier.loadForMinistry('min_A');

      notifier.removeItem('avail_1');

      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, 'avail_2');
    });
  });
}
