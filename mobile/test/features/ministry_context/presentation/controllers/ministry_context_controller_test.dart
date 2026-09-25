import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';

class MockMinistryRepository extends Mock implements MinistryRepository {}

class MockPreferencesStorage extends Mock implements PreferencesStorage {}

void main() {
  group('MinistryContextNotifier', () {
    late MockMinistryRepository repository;
    late MockPreferencesStorage preferencesStorage;
    late MinistryContextNotifier notifier;

    const ministry1 = Ministry(
      id: 'min_1',
      name: 'Ministério Alpha',
      role: 'admin',
    );
    const ministry2 = Ministry(
      id: 'min_2',
      name: 'Ministério Beta',
      role: 'member',
    );
    const ministry3 = Ministry(
      id: 'min_3',
      name: 'Ministério Gamma',
      role: 'member',
    );

    setUp(() {
      repository = MockMinistryRepository();
      preferencesStorage = MockPreferencesStorage();
      notifier = MinistryContextNotifier(
        repository: repository,
        preferencesStorage: preferencesStorage,
      );
    });

    test('initial state is initializing', () {
      expect(notifier.state.isInitializing, isTrue);
      expect(notifier.state.availableMinistries, isEmpty);
      expect(notifier.state.selectedMinistry, isNull);
    });

    test(
        'B. authenticated user with zero ministries transitions to empty state and clears preference',
        () async {
      when(() => repository.getMyMinistries()).thenAnswer((_) async => []);
      when(() => preferencesStorage.setSelectedMinistryId(null))
          .thenAnswer((_) async {});

      await notifier.bootstrap();

      expect(notifier.state.isEmpty, isTrue);
      expect(notifier.state.availableMinistries, isEmpty);
      expect(notifier.state.selectedMinistry, isNull);
      verify(() => preferencesStorage.setSelectedMinistryId(null)).called(1);
    });

    test('C. exactly one ministry is auto-selected and preference is persisted',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1]);
      when(() => preferencesStorage.setSelectedMinistryId(ministry1.id))
          .thenAnswer((_) async {});

      await notifier.bootstrap();

      expect(notifier.state.isReady, isTrue);
      expect(notifier.state.availableMinistries, [ministry1]);
      expect(notifier.state.selectedMinistry, ministry1);
      verify(() => preferencesStorage.setSelectedMinistryId(ministry1.id))
          .called(1);
    });

    test(
        'D. multiple ministries with no saved preference transitions to needsSelection',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId()).thenReturn(null);
      when(() => preferencesStorage.setSelectedMinistryId(null))
          .thenAnswer((_) async {});

      await notifier.bootstrap();

      expect(notifier.state.needsSelection, isTrue);
      expect(notifier.state.availableMinistries.length, 2);
      expect(notifier.state.selectedMinistry, isNull);
      verify(() => preferencesStorage.setSelectedMinistryId(null)).called(1);
    });

    test(
        'E. multiple ministries with valid saved preference restores selection',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn('min_2');

      await notifier.bootstrap();

      expect(notifier.state.isReady, isTrue);
      expect(notifier.state.availableMinistries.length, 2);
      expect(notifier.state.selectedMinistry, ministry2);
      verifyNever(() => preferencesStorage.setSelectedMinistryId(null));
    });

    test('F. stale saved ministry is rejected and cleared from preferences',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn('min_deleted_or_different_user');
      when(() => preferencesStorage.setSelectedMinistryId(null))
          .thenAnswer((_) async {});

      await notifier.bootstrap();

      expect(notifier.state.needsSelection, isTrue);
      expect(notifier.state.selectedMinistry, isNull);
      verify(() => preferencesStorage.setSelectedMinistryId(null)).called(1);
    });

    test('G. User A selection is not reused after logout and User B login',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn(ministry1.id);

      await notifier.bootstrap();
      expect(notifier.state.selectedMinistry, ministry1);

      when(() => preferencesStorage.setSelectedMinistryId(null))
          .thenAnswer((_) async {});
      await notifier.reset();
      expect(notifier.state.isInitializing, isTrue);
      expect(notifier.state.selectedMinistry, isNull);
      verify(() => preferencesStorage.setSelectedMinistryId(null)).called(1);

      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry3]);
      when(() => preferencesStorage.getSelectedMinistryId()).thenReturn(null);
      when(() => preferencesStorage.setSelectedMinistryId(ministry3.id))
          .thenAnswer((_) async {});

      await notifier.bootstrap();
      expect(notifier.state.isReady, isTrue);
      expect(notifier.state.selectedMinistry, ministry3);
    });

    test(
        'H & I. switching ministry updates preference and does NOT perform backend mutation',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn('min_1');
      when(() => preferencesStorage.setSelectedMinistryId('min_2'))
          .thenAnswer((_) async {});

      await notifier.bootstrap();
      expect(notifier.state.selectedMinistry, ministry1);

      await notifier.selectMinistry(ministry2);

      expect(notifier.state.isReady, isTrue);
      expect(notifier.state.selectedMinistry, ministry2);
      verify(() => preferencesStorage.setSelectedMinistryId('min_2')).called(1);
      verify(() => repository.getMyMinistries()).called(1);
      verifyNoMoreInteractions(repository);
    });

    test('selectMinistry ignores ministry not in current available list',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1]);
      when(() => preferencesStorage.setSelectedMinistryId(ministry1.id))
          .thenAnswer((_) async {});

      await notifier.bootstrap();
      expect(notifier.state.selectedMinistry, ministry1);

      await notifier.selectMinistry(ministry3);
      expect(notifier.state.selectedMinistry, ministry1);
    });

    test(
        'J. selected ministry removed after refresh transitions to safe selection flow',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn('min_1');
      when(() => preferencesStorage.setSelectedMinistryId(null))
          .thenAnswer((_) async {});

      await notifier.bootstrap();
      expect(notifier.state.selectedMinistry, ministry1);

      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry2]);
      when(() => preferencesStorage.setSelectedMinistryId(ministry2.id))
          .thenAnswer((_) async {});

      await notifier.refresh();

      expect(notifier.state.isReady, isTrue);
      expect(notifier.state.selectedMinistry, ministry2);
    });

    test(
        'refresh retains selected ministry when still available in fresh response',
        () async {
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, ministry2]);
      when(() => preferencesStorage.getSelectedMinistryId())
          .thenReturn('min_2');
      when(() => preferencesStorage.setSelectedMinistryId('min_2'))
          .thenAnswer((_) async {});

      await notifier.bootstrap();
      expect(notifier.state.selectedMinistry, ministry2);

      const updatedMinistry2 = Ministry(
        id: 'min_2',
        name: 'Ministério Beta (Atualizado)',
        role: 'member',
      );
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [ministry1, updatedMinistry2]);

      await notifier.refresh();

      expect(notifier.state.isReady, isTrue);
      expect(notifier.state.selectedMinistry?.name,
          'Ministério Beta (Atualizado)');
    });

    test(
        'L. bootstrap network error transitions state to error with failure message',
        () async {
      when(() => repository.getMyMinistries()).thenThrow(
        const AppFailure(
          message: 'Falha de conexão com o servidor.',
          statusCode: 503,
        ),
      );

      await notifier.bootstrap();

      expect(notifier.state.hasError, isTrue);
      expect(
          notifier.state.failure?.message, 'Falha de conexão com o servidor.');
      expect(notifier.state.failure?.statusCode, 503);
    });
  });
}
