import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/controllers/availability_providers.dart';
import 'package:louvaio_mobile/features/availability/presentation/widgets/availability_form_modal.dart';

class FakeModalAvailabilityRepository implements AvailabilityRepository {
  CreateAvailabilityPayload? lastCreatedPayload;
  UpdateAvailabilityPayload? lastUpdatedPayload;
  String? lastUpdatedId;
  bool shouldThrow = false;
  AppFailure? failureToThrow;

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(
    String ministryId, {
    int limit = 50,
    String? cursor,
  }) async {
    throw UnimplementedError();
  }

  @override
  Future<MemberAvailability> createMyAvailability(
    String ministryId,
    CreateAvailabilityPayload payload,
  ) async {
    lastCreatedPayload = payload;
    if (shouldThrow) {
      throw failureToThrow ??
          const AppFailure(message: 'Erro ao criar indisponibilidade.');
    }
    return MemberAvailability(
      id: 'new_id',
      ministryId: ministryId,
      memberId: 'mem_1',
      startDate: payload.startDate,
      endDate: payload.endDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      allDay: payload.allDay,
      startsAt: '${payload.startDate}T00:00:00',
      endsAt: '${payload.endDate}T23:59:59',
      reason: payload.reason,
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    );
  }

  @override
  Future<MemberAvailability> updateMyAvailability(
    String ministryId,
    String id,
    UpdateAvailabilityPayload payload,
  ) async {
    lastUpdatedId = id;
    lastUpdatedPayload = payload;
    if (shouldThrow) {
      throw failureToThrow ??
          const AppFailure(message: 'Erro ao atualizar indisponibilidade.');
    }
    return MemberAvailability(
      id: id,
      ministryId: ministryId,
      memberId: 'mem_1',
      startDate: payload.startDate ?? '2026-10-04',
      endDate: payload.endDate ?? '2026-10-04',
      startTime: payload.startTime,
      endTime: payload.endTime,
      allDay: payload.allDay ?? true,
      startsAt: '2026-10-04T00:00:00',
      endsAt: '2026-10-04T23:59:59',
      reason: payload.reason,
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    );
  }

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) async {
    throw UnimplementedError();
  }
}

class FakePreferencesStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}

  @override
  String? getSelectedMinistryId() => null;

  @override
  String? getThemeMode() => null;

  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}

  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

void main() {
  late FakeModalAvailabilityRepository fakeRepo;

  setUp(() {
    fakeRepo = FakeModalAvailabilityRepository();
  });

  Widget buildModalApp({
    MemberAvailability? editingItem,
    required ValueChanged<MemberAvailability> onSaved,
  }) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        preferencesStorageProvider.overrideWithValue(FakePreferencesStorage()),
        availabilityRepositoryProvider.overrideWithValue(fakeRepo),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: AvailabilityFormModal(
            ministryId: 'min_1',
            editingItem: editingItem,
            onSaved: onSaved,
          ),
        ),
      ),
    );
  }

  group('AvailabilityFormModal', () {
    testWidgets('renders create modal with defaults and toggles all-day',
        (tester) async {
      await tester.pumpWidget(buildModalApp(onSaved: (_) {}));
      await tester.pumpAndSettle();

      expect(find.text('Nova Indisponibilidade'), findsOneWidget);
      expect(find.text('Dia inteiro'), findsOneWidget);
      expect(find.text('Adicionar'), findsOneWidget);

      // By default allDay is true, so time pickers are not visible
      expect(find.text('Horário Inicial'), findsNothing);
      expect(find.text('Horário Final'), findsNothing);

      // Toggle allDay to false
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      // Now time pickers appear
      expect(find.text('Horário Inicial'), findsOneWidget);
      expect(find.text('Horário Final'), findsOneWidget);
    });

    testWidgets('submits create payload to repository and invokes onSaved',
        (tester) async {
      MemberAvailability? savedResult;

      await tester.pumpWidget(buildModalApp(onSaved: (item) {
        savedResult = item;
      }));
      await tester.pumpAndSettle();

      // Enter optional reason
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Motivo (opcional)'),
        'Retiro espiritual',
      );
      await tester.pumpAndSettle();

      // Tap Adicionar
      await tester.tap(find.widgetWithText(FilledButton, 'Adicionar'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastCreatedPayload, isNotNull);
      expect(fakeRepo.lastCreatedPayload?.allDay, isTrue);
      expect(fakeRepo.lastCreatedPayload?.reason, 'Retiro espiritual');
      expect(savedResult, isNotNull);
      expect(savedResult?.id, 'new_id');
    });

    testWidgets('renders edit modal pre-filled with item and calls update',
        (tester) async {
      const existing = MemberAvailability(
        id: 'edit_target',
        ministryId: 'min_1',
        memberId: 'mem_1',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        startTime: '18:00',
        endTime: '21:00',
        allDay: false,
        startsAt: '2026-10-10T18:00:00',
        endsAt: '2026-10-10T21:00:00',
        reason: 'Compromisso pessoal',
        createdAt: '',
        updatedAt: '',
      );

      MemberAvailability? updatedResult;

      await tester.pumpWidget(buildModalApp(
        editingItem: existing,
        onSaved: (item) {
          updatedResult = item;
        },
      ));
      await tester.pumpAndSettle();

      expect(find.text('Editar Indisponibilidade'), findsOneWidget);
      expect(find.text('Compromisso pessoal'), findsOneWidget);
      expect(find.text('Salvar'), findsOneWidget);

      // Change reason
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Motivo (opcional)'),
        'Compromisso alterado',
      );
      await tester.pumpAndSettle();

      // Tap Salvar
      await tester.tap(find.widgetWithText(FilledButton, 'Salvar'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedId, 'edit_target');
      expect(fakeRepo.lastUpdatedPayload?.reason, 'Compromisso alterado');
      expect(updatedResult?.id, 'edit_target');
    });

    testWidgets('displays server error banner when repository fails',
        (tester) async {
      fakeRepo.shouldThrow = true;
      fakeRepo.failureToThrow = const AppFailure(
        message: 'O período de indisponibilidade não pode exceder 90 dias.',
        statusCode: 400,
      );

      await tester.pumpWidget(buildModalApp(onSaved: (_) {}));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilledButton, 'Adicionar'));
      await tester.pumpAndSettle();

      expect(
        find.text('O período de indisponibilidade não pode exceder 90 dias.'),
        findsOneWidget,
      );
      // Button still visible to allow correction
      expect(find.widgetWithText(FilledButton, 'Adicionar'), findsOneWidget);
    });
  });
}
