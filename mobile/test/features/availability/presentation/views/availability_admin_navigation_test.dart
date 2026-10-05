import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/shell/app_shell.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/availability/presentation/views/admin_availability_screen.dart';
import 'package:louvaio_mobile/features/availability/presentation/views/manual_member_availability_screen.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/members/presentation/views/member_detail_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';

class MockAuthRepository extends Mock implements AuthRepository {}
class MockMinistryRepository extends Mock implements MinistryRepository {}

class FakeDashboardRepo implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async => [];

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId, {int limit = 20}) async => [];

  @override
  Future<Announcement> createAnnouncement(
    String ministryId,
    Map<String, dynamic> data,
  ) async {
    return Announcement(
      id: 'ann_new',
      ministryId: ministryId,
      title: data['title'] as String? ?? '',
      content: data['content'] as String? ?? '',
      important: data['important'] as bool? ?? false,
    );
  }
}

class FakeScheduleRepo implements ScheduleRepository {
  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

  @override
  Future<ScheduleDetail> getScheduleDetail(String ministryId, String scheduleId) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<ScheduleDetail> confirmParticipation(String ministryId, String scheduleId, bool confirmed) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<List<ScheduleComment>> getComments(String ministryId, String scheduleId) async => [];

  @override
  Future<ScheduleComment> postComment(String ministryId, String scheduleId, String content) async =>
      const ScheduleComment(id: 'c1', scheduleId: 's1', ministryId: 'min_1', userId: 'u1', userName: 'User', content: 'content', createdAt: '2026-10-01');

  @override
  Future<ScheduleDetail> createSchedule(String ministryId, Map<String, dynamic> data) async =>
      const ScheduleDetail(id: 's_new', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<ScheduleDetail> updateSchedule(String ministryId, String scheduleId, Map<String, dynamic> data) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-01');

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async => [];

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async => [];
}

class FakeRepertoireRepo implements RepertoireRepository {
  @override
  Future<PaginatedSongs> listSongs(String ministryId, {String? search, String? classificationId, String? cursor, int? page, int? limit}) async =>
      const PaginatedSongs(songs: [], total: 0);

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async =>
      SongDetail(id: songId, ministryId: ministryId, title: 'Música');

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [];
}

class FakeMembersRepo implements MembersRepository {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async => members;

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async => roles;

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async {
    return members.firstWhere((m) => m.id == memberId);
  }

  @override
  Future<MinistryMember> addMember({
    required String ministryId,
    required String name,
    required String email,
    String role = 'member',
    String? birthDate,
    List<String> roleIds = const [],
  }) async => throw UnimplementedError();

  @override
  Future<MinistryMember> updateMember({
    required String ministryId,
    required String memberId,
    String? name,
    String? email,
    String? birthDate,
    String? role,
    List<String>? roleIds,
  }) async => throw UnimplementedError();

  @override
  Future<void> removeMember({required String ministryId, required String memberId}) async {}
}

class FakeAvailabilityRepo implements AvailabilityRepository {
  List<ConsolidatedAvailabilityItem> consolidated = [];
  List<MemberAvailability> manualItems = [];

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(String ministryId, {String? cursor, int limit = 50}) async =>
      const AvailabilityListResponse(data: []);

  @override
  Future<MemberAvailability> createMyAvailability(String ministryId, CreateAvailabilityPayload payload) async =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateMyAvailability(String ministryId, String id, UpdateAvailabilityPayload payload) async =>
      throw UnimplementedError();

  @override
  Future<void> deleteMyAvailability(String ministryId, String availabilityId) async {}

  @override
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
    String ministryId, {
    required String from,
    required String to,
    String? memberId,
    int limit = 50,
    String? cursor,
  }) async =>
      ConsolidatedAvailabilityResponse(data: consolidated);

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
    String ministryId,
    String memberId, {
    int limit = 50,
    String? cursor,
  }) async =>
      AvailabilityListResponse(data: manualItems);

  @override
  Future<MemberAvailability> createManualMemberAvailability(
    String ministryId,
    String memberId,
    CreateAvailabilityPayload payload,
  ) async =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateManualMemberAvailability(
    String ministryId,
    String memberId,
    String availabilityId,
    UpdateAvailabilityPayload payload,
  ) async =>
      throw UnimplementedError();

  @override
  Future<void> deleteManualMemberAvailability(String ministryId, String memberId, String availabilityId) async {}
}

void main() {
  const testEnv = AppEnvironment(
    env: AppEnv.development,
    apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
  );

  const testUser = AuthUser(
    id: 'user_123',
    email: 'admin@louvaio.test',
    name: 'Admin LouvAIO',
  );

  const adminMinistry = Ministry(
    id: 'min_test_admin',
    name: 'Igreja Central Admin',
    role: 'admin',
    subscriptionStatus: 'active',
  );

  const memberMinistry = Ministry(
    id: 'min_test_member',
    name: 'Igreja Central Membro',
    role: 'member',
    subscriptionStatus: 'active',
  );

  group('Admin Availability Navigation from AppShell Profile', () {
    late MockAuthRepository mockAuthRepo;
    late MockMinistryRepository mockMinistryRepo;
    late StreamController<fb.User?> authStreamController;
    late SharedPreferencesStorage storage;
    late FakeAvailabilityRepo availabilityRepo;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      storage = SharedPreferencesStorage(prefs);

      mockAuthRepo = MockAuthRepository();
      mockMinistryRepo = MockMinistryRepository();
      authStreamController = StreamController<fb.User?>.broadcast();
      availabilityRepo = FakeAvailabilityRepo();

      when(() => mockAuthRepo.authStateChanges())
          .thenAnswer((_) => authStreamController.stream);
      when(() => mockAuthRepo.getMe()).thenAnswer((_) async => testUser);
      when(() => mockAuthRepo.signOut()).thenAnswer((_) async {});
    });

    tearDown(() {
      authStreamController.close();
    });

    Widget createAppShell({required Ministry ministry}) {
      when(() => mockMinistryRepo.getMyMinistries())
          .thenAnswer((_) async => [ministry]);

      return ProviderScope(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          appEnvironmentProvider.overrideWithValue(testEnv),
          authRepositoryProvider.overrideWithValue(mockAuthRepo),
          ministryRepositoryProvider.overrideWithValue(mockMinistryRepo),
          dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
          scheduleRepositoryProvider.overrideWithValue(FakeScheduleRepo()),
          repertoireRepositoryProvider.overrideWithValue(FakeRepertoireRepo()),
          membersRepositoryProvider.overrideWithValue(FakeMembersRepo()),
          availabilityRepositoryProvider.overrideWithValue(availabilityRepo),
          authNotifierProvider.overrideWith((ref) {
            final n = AuthNotifier(mockAuthRepo);
            n.state = const AuthState.authenticated(testUser);
            return n;
          }),
          ministryContextNotifierProvider.overrideWith((ref) {
            final n = MinistryContextNotifier(
              repository: mockMinistryRepo,
              preferencesStorage: storage,
            );
            n.state = MinistryContextState(
              status: MinistryBootstrapStatus.ready,
              availableMinistries: [ministry],
              selectedMinistry: ministry,
            );
            return n;
          }),
        ],
        child: const MaterialApp(
          home: AppShell(),
        ),
      );
    }

    testWidgets('Admin user sees "Disponibilidade da Equipe" tile and can open screen', (tester) async {
      await tester.pumpWidget(createAppShell(ministry: adminMinistry));
      await tester.pumpAndSettle();

      // Navigate to Perfil tab (index 3)
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      // Verify the tile is displayed for admin
      final tileFinder = find.byKey(const ValueKey('admin_availability_tile'));
      expect(tileFinder, findsOneWidget);
      expect(find.text('Disponibilidade da Equipe'), findsOneWidget);

      // Tap the tile to navigate to AdminAvailabilityScreen
      await tester.tap(tileFinder);
      await tester.pumpAndSettle();

      expect(find.byType(AdminAvailabilityScreen), findsOneWidget);
      expect(find.text('Disponibilidade da Equipe'), findsOneWidget);
    });

    testWidgets('Ordinary member does NOT see "Disponibilidade da Equipe" tile', (tester) async {
      await tester.pumpWidget(createAppShell(ministry: memberMinistry));
      await tester.pumpAndSettle();

      // Navigate to Perfil tab (index 3)
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      // Verify tile is hidden for member
      expect(find.byKey(const ValueKey('admin_availability_tile')), findsNothing);
      expect(find.text('Disponibilidade da Equipe'), findsNothing);
    });
  });

  group('Manual Member Availability Navigation from MemberDetailScreen', () {
    late FakeMembersRepo membersRepo;
    late FakeAvailabilityRepo availabilityRepo;
    late MockMinistryRepository mockMinistryRepo;
    late SharedPreferencesStorage storage;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      storage = SharedPreferencesStorage(prefs);

      membersRepo = FakeMembersRepo();
      availabilityRepo = FakeAvailabilityRepo();
      mockMinistryRepo = MockMinistryRepository();
    });

    Widget createMemberDetailApp({
      required Ministry ministry,
      required MinistryMember member,
    }) {
      membersRepo.members = [member];

      return ProviderScope(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          appEnvironmentProvider.overrideWithValue(testEnv),
          membersRepositoryProvider.overrideWithValue(membersRepo),
          availabilityRepositoryProvider.overrideWithValue(availabilityRepo),
          ministryContextNotifierProvider.overrideWith((ref) {
            final n = MinistryContextNotifier(
              repository: mockMinistryRepo,
              preferencesStorage: storage,
            );
            n.state = MinistryContextState(
              status: MinistryBootstrapStatus.ready,
              availableMinistries: [ministry],
              selectedMinistry: ministry,
            );
            return n;
          }),
        ],
        child: MaterialApp(
          home: MemberDetailScreen(
            ministryId: ministry.id,
            memberId: member.id,
            initialMember: member,
          ),
        ),
      );
    }

    testWidgets('Admin inspecting eligible manual member sees "Gerenciar indisponibilidade" button and opens screen', (tester) async {
      const manualMember = MinistryMember(
        id: 'mem_manual_1',
        name: 'Manual Singer',
        isManual: true,
        userId: null,
      );

      await tester.pumpWidget(createMemberDetailApp(
        ministry: adminMinistry,
        member: manualMember,
      ));
      await tester.pumpAndSettle();

      // Button must be visible for admin on manual member
      final manageBtn = find.byKey(const ValueKey('manage_availability_button'));
      expect(manageBtn, findsOneWidget);
      expect(find.text('Gerenciar indisponibilidade'), findsOneWidget);

      // Tap button and verify navigation to ManualMemberAvailabilityScreen
      await tester.tap(manageBtn);
      await tester.pumpAndSettle();

      expect(find.byType(ManualMemberAvailabilityScreen), findsOneWidget);
      expect(find.textContaining('Manual Singer'), findsWidgets);
    });

    testWidgets('Admin inspecting linked/authenticated member does NOT see button', (tester) async {
      const linkedMember = MinistryMember(
        id: 'mem_linked_1',
        name: 'Linked Singer',
        isManual: false,
        userId: 'user_auth_123',
      );

      await tester.pumpWidget(createMemberDetailApp(
        ministry: adminMinistry,
        member: linkedMember,
      ));
      await tester.pumpAndSettle();

      // Linked member must NOT show manage availability button
      expect(find.byKey(const ValueKey('manage_availability_button')), findsNothing);
      expect(find.text('Gerenciar indisponibilidade'), findsNothing);
    });

    testWidgets('Ordinary member inspecting manual member does NOT see button', (tester) async {
      const manualMember = MinistryMember(
        id: 'mem_manual_2',
        name: 'Manual Guitarist',
        isManual: true,
        userId: null,
      );

      await tester.pumpWidget(createMemberDetailApp(
        ministry: memberMinistry,
        member: manualMember,
      ));
      await tester.pumpAndSettle();

      // Non-admin viewer must NOT see admin manage button
      expect(find.byKey(const ValueKey('manage_availability_button')), findsNothing);
      expect(find.text('Gerenciar indisponibilidade'), findsNothing);
    });
  });
}
