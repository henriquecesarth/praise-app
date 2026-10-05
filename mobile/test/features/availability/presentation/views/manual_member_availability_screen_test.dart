import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/views/manual_member_availability_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';

class FakeScreenAvailabilityRepo implements AvailabilityRepository {
  List<MemberAvailability> items = [];
  bool shouldThrow = false;
  AppFailure? failure;
  int listCallCount = 0;
  String? lastDeletedId;

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
    String ministryId,
    String memberId, {
    int limit = 50,
    String? cursor,
  }) async {
    listCallCount++;
    if (shouldThrow) {
      throw failure ?? const AppFailure(message: 'Erro ao carregar lista.');
    }
    return AvailabilityListResponse(data: items);
  }

  @override
  Future<void> deleteManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
  ) async {
    lastDeletedId = id;
    items.removeWhere((i) => i.id == id);
  }

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

class FakeMinistryRepo implements MinistryRepository {
  List<Ministry> ministries = [];

  @override
  Future<List<Ministry>> getMyMinistries() async => ministries;
}

class FakePrefsStorage implements PreferencesStorage {
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
  late FakeScreenAvailabilityRepo availabilityRepo;
  late FakeMinistryRepo ministryRepo;
  late FakePrefsStorage prefsStorage;

  setUp(() {
    availabilityRepo = FakeScreenAvailabilityRepo();
    ministryRepo = FakeMinistryRepo();
    prefsStorage = FakePrefsStorage();
  });

  Widget buildTestApp({
    required String ministryId,
    required bool isAdmin,
    required MinistryMember member,
  }) {
    final ministry = Ministry(
      id: ministryId,
      name: 'Ministério Beta',
      role: isAdmin ? 'admin' : 'member',
    );
    ministryRepo.ministries = [ministry];

    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        preferencesStorageProvider.overrideWithValue(prefsStorage),
        ministryRepositoryProvider.overrideWithValue(ministryRepo),
        availabilityRepositoryProvider.overrideWithValue(availabilityRepo),
      ],
      child: Consumer(
        builder: (context, ref, child) {
          return MaterialApp(
            home: Builder(
              builder: (ctx) {
                return Scaffold(
                  body: Center(
                    child: ElevatedButton(
                      onPressed: () async {
                        await ref
                            .read(ministryContextNotifierProvider.notifier)
                            .bootstrap();
                        if (ctx.mounted) {
                          Navigator.of(ctx).push(
                            MaterialPageRoute(
                              builder: (_) => ManualMemberAvailabilityScreen(
                                ministryId: ministryId,
                                member: member,
                              ),
                            ),
                          );
                        }
                      },
                      child: const Text('Abrir Tela'),
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }

  group('ManualMemberAvailabilityScreen Presentation', () {
    testWidgets('ineligible member with linked user_id shows block message', (tester) async {
      const linkedMember = MinistryMember(
        id: 'mem_linked',
        name: 'Carlos Vinculado',
        isManual: false,
        userId: 'usr_carlos_123',
      );

      await tester.pumpWidget(buildTestApp(
        ministryId: 'min_1',
        isAdmin: true,
        member: linkedMember,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Operação não permitida'), findsOneWidget);
      expect(
        find.textContaining('Apenas integrantes cadastrados manualmente podem ter disponibilidades gerenciadas'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.block_outlined), findsOneWidget);
    });

    testWidgets('ordinary non-admin member sees access restricted unauthorized state', (tester) async {
      const manualMember = MinistryMember(
        id: 'mem_manual',
        name: 'Membro Manual',
        isManual: true,
        userId: null,
      );

      await tester.pumpWidget(buildTestApp(
        ministryId: 'min_1',
        isAdmin: false,
        member: manualMember,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Acesso restrito'), findsOneWidget);
      expect(
        find.textContaining('Apenas administradores do ministério têm permissão'),
        findsOneWidget,
      );
    });

    testWidgets('eligible manual member shows empty state when no records exist', (tester) async {
      const manualMember = MinistryMember(
        id: 'mem_manual',
        name: 'Marcos Manual',
        isManual: true,
        userId: null,
      );
      availabilityRepo.items = [];

      await tester.pumpWidget(buildTestApp(
        ministryId: 'min_1',
        isAdmin: true,
        member: manualMember,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Marcos Manual • Cadastro manual'), findsOneWidget);
      expect(find.text('Nenhum período registrado'), findsOneWidget);
      expect(find.byType(FloatingActionButton), findsOneWidget);
    });

    testWidgets('displays items and shows reason for manual members', (tester) async {
      const manualMember = MinistryMember(
        id: 'mem_manual',
        name: 'Marcos Manual',
        isManual: true,
        userId: null,
      );
      availabilityRepo.items = [
        const MemberAvailability(
          id: 'avail_1',
          ministryId: 'min_1',
          memberId: 'mem_manual',
          startDate: '2026-10-20',
          endDate: '2026-10-20',
          allDay: true,
          startsAt: '2026-10-20T00:00:00',
          endsAt: '2026-10-21T00:00:00',
          reason: 'Plantão hospitalar noturno',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        ),
      ];

      await tester.pumpWidget(buildTestApp(
        ministryId: 'min_1',
        isAdmin: true,
        member: manualMember,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('20/10/2026 • Dia inteiro'), findsOneWidget);
      // Reason MUST be visible in manual member admin screen
      expect(find.text('Plantão hospitalar noturno'), findsOneWidget);
      expect(find.byIcon(Icons.delete_outline), findsOneWidget);
      expect(find.byIcon(Icons.edit_outlined), findsOneWidget);
    });

    testWidgets('delete workflow shows confirmation dialog and removes item on confirm', (tester) async {
      const manualMember = MinistryMember(
        id: 'mem_manual',
        name: 'Marcos Manual',
        isManual: true,
        userId: null,
      );
      availabilityRepo.items = [
        const MemberAvailability(
          id: 'del_100',
          ministryId: 'min_1',
          memberId: 'mem_manual',
          startDate: '2026-10-20',
          endDate: '2026-10-20',
          allDay: true,
          startsAt: '2026-10-20T00:00:00',
          endsAt: '2026-10-21T00:00:00',
          reason: 'Item a remover',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        ),
      ];

      await tester.pumpWidget(buildTestApp(
        ministryId: 'min_1',
        isAdmin: true,
        member: manualMember,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      // Tap delete icon button
      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();

      // Verify confirmation dialog
      expect(find.text('Excluir indisponibilidade'), findsOneWidget);
      expect(find.text('Cancelar'), findsOneWidget);
      final confirmDeleteBtn = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('Excluir'),
      );
      expect(confirmDeleteBtn, findsOneWidget);

      // Confirm delete
      await tester.tap(confirmDeleteBtn);
      await tester.pumpAndSettle();

      expect(availabilityRepo.lastDeletedId, 'del_100');
      expect(find.text('Item a remover'), findsNothing);
    });
  });
}

