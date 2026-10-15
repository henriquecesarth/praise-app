import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/views/admin_availability_screen.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class FakeScreenAvailabilityRepo implements AvailabilityRepository {
  List<ConsolidatedAvailabilityItem> items = [];
  bool shouldThrow = false;
  AppFailure? failure;
  int listCallCount = 0;
  String? lastFrom;
  String? lastTo;

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
    lastFrom = from;
    lastTo = to;
    if (shouldThrow) {
      throw failure ?? const AppFailure(message: 'Erro ao carregar dados.');
    }
    return ConsolidatedAvailabilityResponse(data: items);
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

  @override
  Future<ScheduleConflictCheckResponse> checkScheduleConflicts(
          String ministryId, CheckScheduleConflictsPayload payload) =>
      throw UnimplementedError();
}

class FakeMembersRepo implements MembersRepository {
  List<MinistryMember> members = [];

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async => members;

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) =>
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
  }) =>
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
  }) =>
      throw UnimplementedError();

  @override
  Future<void> removeMember({
    required String ministryId,
    required String memberId,
  }) =>
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
  late FakeMembersRepo membersRepo;
  late FakeMinistryRepo ministryRepo;
  late FakePrefsStorage prefsStorage;

  setUp(() {
    availabilityRepo = FakeScreenAvailabilityRepo();
    membersRepo = FakeMembersRepo();
    ministryRepo = FakeMinistryRepo();
    prefsStorage = FakePrefsStorage();
  });

  Widget buildTestApp({
    required String ministryId,
    required bool isAdmin,
  }) {
    final ministry = Ministry(
      id: ministryId,
      name: 'Ministério Alpha',
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
        membersRepositoryProvider.overrideWithValue(membersRepo),
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
                              builder: (_) => AdminAvailabilityScreen(
                                ministryId: ministryId,
                                ministryName: ministry.name,
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

  group('AdminAvailabilityScreen Presentation', () {
    testWidgets('non-admin member sees access restricted unauthorized state', (tester) async {
      await tester.pumpWidget(buildTestApp(ministryId: 'min_1', isAdmin: false));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Acesso restrito'), findsOneWidget);
      expect(
        find.textContaining('Apenas administradores do ministério têm permissão'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
    });

    testWidgets('admin sees empty state when no unavailabilities in period', (tester) async {
      availabilityRepo.items = [];

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1', isAdmin: true));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Disponibilidade da Equipe'), findsOneWidget);
      expect(find.text('Todos disponíveis!'), findsOneWidget);
      expect(find.text('7 dias'), findsOneWidget);
      expect(find.text('15 dias'), findsOneWidget);
      expect(find.text('30 dias'), findsOneWidget);
    });

    testWidgets('admin sees items and privacy invariant: reason is never displayed', (tester) async {
      availabilityRepo.items = [
        const ConsolidatedAvailabilityItem(
          id: 'cons_1',
          ministryId: 'min_1',
          memberId: 'm1',
          memberName: 'Baterista João',
          startDate: '2026-10-25',
          endDate: '2026-10-25',
          allDay: true,
          startsAt: '2026-10-25T00:00:00',
          endsAt: '2026-10-26T00:00:00',
        ),
      ];

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1', isAdmin: true));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Baterista João'), findsOneWidget);
      expect(find.text('25/10/2026 • Dia inteiro'), findsOneWidget);
      expect(find.text('Agendado'), findsOneWidget);

      // Verify privacy preservation: no reason text in widget tree
      expect(find.textContaining('motivo'), findsNothing);
      expect(find.textContaining('razão'), findsNothing);
      expect(find.textContaining('reason'), findsNothing);
    });

    testWidgets('tapping preset chip changes filter and reloads', (tester) async {
      await tester.pumpWidget(buildTestApp(ministryId: 'min_1', isAdmin: true));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(availabilityRepo.listCallCount, 1);

      // Tap 7 dias chip
      await tester.tap(find.text('7 dias'));
      await tester.pumpAndSettle();

      expect(availabilityRepo.listCallCount, 2);
    });

    testWidgets('server error displays error banner with retry button', (tester) async {
      availabilityRepo.shouldThrow = true;

      await tester.pumpWidget(buildTestApp(ministryId: 'min_1', isAdmin: true));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Tela'));
      await tester.pumpAndSettle();

      expect(find.text('Erro ao carregar dados.'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Fix and tap retry
      availabilityRepo.shouldThrow = false;
      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Erro ao carregar dados.'), findsNothing);
    });
  });
}
