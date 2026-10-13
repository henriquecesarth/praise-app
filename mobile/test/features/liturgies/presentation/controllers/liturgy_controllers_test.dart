import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/liturgies/data/liturgy_repository.dart';
import 'package:louvaio_mobile/features/liturgies/domain/liturgy.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/controllers/liturgy_detail_controller.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/controllers/liturgy_form_controller.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/controllers/liturgy_list_controller.dart';

class FakeLiturgyRepository implements LiturgyRepository {
  List<Liturgy> liturgiesToReturn = [];
  Liturgy? detailToReturn;
  Exception? errorToThrow;
  int listCallCount = 0;
  int detailCallCount = 0;
  int createCallCount = 0;
  int updateCallCount = 0;
  int deleteCallCount = 0;

  @override
  Future<List<Liturgy>> listLiturgies(String ministryId) async {
    listCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return liturgiesToReturn;
  }

  @override
  Future<Liturgy> getLiturgyById(String ministryId, String liturgyId) async {
    detailCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    if (detailToReturn != null) return detailToReturn!;
    return Liturgy(
      id: liturgyId,
      ministryId: ministryId,
      title: 'Fake Liturgy',
      date: '2026-10-12',
    );
  }

  @override
  Future<Liturgy> createLiturgy(
    String ministryId, {
    required String title,
    required String date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    createCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return Liturgy(
      id: 'created-1',
      ministryId: ministryId,
      title: title,
      date: date,
      description: description,
    );
  }

  @override
  Future<Liturgy> updateLiturgy(
    String ministryId,
    String liturgyId, {
    String? title,
    String? date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    updateCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return Liturgy(
      id: liturgyId,
      ministryId: ministryId,
      title: title ?? 'Updated Liturgy',
      date: date ?? '2026-10-12',
    );
  }

  @override
  Future<bool> deleteLiturgy(String ministryId, String liturgyId) async {
    deleteCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return true;
  }
}

void main() {
  late FakeLiturgyRepository fakeRepo;

  setUp(() {
    fakeRepo = FakeLiturgyRepository();
  });

  group('LiturgyListNotifier', () {
    test('load populates state on success', () async {
      final notifier = LiturgyListNotifier(repository: fakeRepo);
      fakeRepo.liturgiesToReturn = [
        const Liturgy(id: 'lit-1', ministryId: 'min-1', title: 'Culto A', date: '2026-10-11'),
      ];

      await notifier.loadLiturgies('min-1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.errorMessage, isNull);
      expect(notifier.state.liturgies.length, equals(1));
      expect(notifier.state.liturgies.first.id, equals('lit-1'));
    });

    test('load records error when repository throws AppFailure', () async {
      final notifier = LiturgyListNotifier(repository: fakeRepo);
      fakeRepo.errorToThrow = const AppFailure(message: 'Falha de rede');

      await notifier.loadLiturgies('min-1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.errorMessage, equals('Falha de rede'));
      expect(notifier.state.hasError, isTrue);
    });

    test('generation fencing ignores stale responses', () async {
      final notifier = LiturgyListNotifier(repository: fakeRepo);
      // Simulate switching tenant before response completes
      final future1 = notifier.loadLiturgies('min-1');
      final future2 = notifier.loadLiturgies('min-2');

      await Future.wait([future1, future2]);

      expect(notifier.state.ministryId, equals('min-2'));
    });

    test('reset clears state completely', () async {
      final notifier = LiturgyListNotifier(repository: fakeRepo);
      fakeRepo.liturgiesToReturn = [
        const Liturgy(id: 'lit-1', ministryId: 'min-1', title: 'Culto A', date: '2026-10-11'),
      ];
      await notifier.loadLiturgies('min-1');
      expect(notifier.state.liturgies.isNotEmpty, isTrue);

      notifier.reset();
      expect(notifier.state.liturgies.isEmpty, isTrue);
      expect(notifier.state.ministryId, isNull);
    });
  });

  group('LiturgyDetailNotifier', () {
    test('load populates detail state on success', () async {
      final notifier = LiturgyDetailNotifier(repository: fakeRepo);
      fakeRepo.detailToReturn = const Liturgy(
        id: 'lit-1',
        ministryId: 'min-1',
        title: 'Culto Detalhe',
        date: '2026-10-11',
        items: [
          LiturgyItem(id: 'i-1', liturgyId: 'lit-1', title: 'Leitura Inicial', type: LiturgyItemType.reading),
        ],
      );

      await notifier.loadLiturgy('min-1', 'lit-1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.liturgy, isNotNull);
      expect(notifier.state.liturgy!.items.length, equals(1));
    });

    test('classifies 404 error as isNotFound', () async {
      final notifier = LiturgyDetailNotifier(repository: fakeRepo);
      fakeRepo.errorToThrow = const AppFailure(message: 'Não encontrada', statusCode: 404);

      await notifier.loadLiturgy('min-1', 'lit-404');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isNotFound, isTrue);
      expect(notifier.state.errorMessage, equals('Não encontrada'));
    });
  });

  group('LiturgyFormNotifier', () {
    test('createLiturgy creates liturgy and prevents double submit', () async {
      final notifier = LiturgyFormNotifier(repository: fakeRepo);

      final future1 = notifier.createLiturgy('min-1', title: 'Novo Culto', date: '2026-10-15');
      // Second immediate concurrent call should be ignored by double submit guard
      final future2 = notifier.createLiturgy('min-1', title: 'Culto Duplicado', date: '2026-10-15');

      final results = await Future.wait([future1, future2]);
      expect(results[0], isNotNull);
      expect(results[1], isNull);
      expect(fakeRepo.createCallCount, equals(1));
      expect(notifier.state.isSubmitting, isFalse);
      expect(notifier.state.isSuccess, isTrue);
    });

    test('updateLiturgy updates successfully', () async {
      final notifier = LiturgyFormNotifier(repository: fakeRepo);

      final result = await notifier.updateLiturgy('min-1', 'lit-1', title: 'Culto Modificado');
      expect(result, isNotNull);
      expect(result!.title, equals('Culto Modificado'));
      expect(fakeRepo.updateCallCount, equals(1));
    });

    test('deleteLiturgy calls repository delete', () async {
      final notifier = LiturgyFormNotifier(repository: fakeRepo);

      final ok = await notifier.deleteLiturgy('min-1', 'lit-1');
      expect(ok, isTrue);
      expect(fakeRepo.deleteCallCount, equals(1));
    });
  });
}
