import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/shell/app_shell.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry_onboarding.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/teams/data/team_repository.dart';
import 'package:louvaio_mobile/features/teams/domain/team.dart';
import 'package:louvaio_mobile/features/teams/presentation/views/team_form_screen.dart';
import 'package:louvaio_mobile/features/teams/presentation/views/teams_screen.dart';
import 'package:louvaio_mobile/features/teams/presentation/widgets/team_card.dart';
import 'package:louvaio_mobile/features/teams/presentation/widgets/team_picker_sheet.dart';

class WidgetMockTeamRepo implements TeamRepository {
  List<Team> teams = [];
  String? lastDeletedTeamId;

  @override
  Future<List<Team>> getTeams(String ministryId) async => teams;

  @override
  Future<Team> getTeamById(String ministryId, String teamId) async =>
      teams.firstWhere((t) => t.id == teamId);

  @override
  Future<Team> createTeam(String ministryId,
      {required String name,
      String? description,
      List<String>? memberIds}) async {
    final newTeam = Team(
      id: 'team-new-',
      ministryId: ministryId,
      name: name,
      description: description,
      memberIds: memberIds ?? const [],
    );
    teams.add(newTeam);
    return newTeam;
  }

  @override
  Future<Team> updateTeam(String ministryId, String teamId,
      {String? name,
      String? description,
      List<String>? memberIds}) async {
    final idx = teams.indexWhere((t) => t.id == teamId);
    final updated = Team(
      id: teamId,
      ministryId: ministryId,
      name: name ?? (idx >= 0 ? teams[idx].name : ''),
      description: description,
      memberIds: memberIds ?? (idx >= 0 ? teams[idx].memberIds : const []),
    );
    if (idx >= 0) teams[idx] = updated;
    return updated;
  }

  @override
  Future<void> deleteTeam(String ministryId, String teamId) async {
    lastDeletedTeamId = teamId;
    teams.removeWhere((t) => t.id == teamId);
  }
}

class WidgetMockMembersRepo implements MembersRepository {
  List<MinistryMember> members = [];

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async => members;

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async => [];

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async =>
      members.firstWhere((m) => m.id == memberId);

  @override
  Future<MinistryMember> addMember({required String ministryId, required String name, required String email, String role = 'member', String? birthDate, List<String> roleIds = const []}) async =>
      throw UnimplementedError();

  @override
  Future<MinistryMember> updateMember({required String ministryId, required String memberId, String? name, String? email, String? birthDate, String? role, List<String>? roleIds}) async =>
      throw UnimplementedError();

  @override
  Future<void> removeMember({required String ministryId, required String memberId}) async =>
      throw UnimplementedError();
}

class FakePreferences implements PreferencesStorage {
  String? _selectedMinistryId;
  String? _themeMode;

  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {
    _selectedMinistryId = ministryId;
  }

  @override
  String? getSelectedMinistryId() => _selectedMinistryId;

  @override
  Future<void> setThemeMode(String? themeMode) async {
    _themeMode = themeMode;
  }

  @override
  String? getThemeMode() => _themeMode;

  @override
  Future<void> clear() async {
    _selectedMinistryId = null;
    _themeMode = null;
  }
}

class FakeMinistryRepo implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => [];

  @override
  Future<Ministry> createMinistry({required String name}) async =>
      throw UnimplementedError();

  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) async =>
      throw UnimplementedError();

  @override
  Future<MinistryInvite> createInviteCode(String ministryId, {int expiresInDays = 7}) async =>
      throw UnimplementedError();
}

class FakeAuthRepo implements AuthRepository {
  @override
  Stream<fb.User?> authStateChanges() => const Stream.empty();

  @override
  fb.User? get currentFirebaseUser => null;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;

  @override
  Future<fb.UserCredential> signInWithEmailAndPassword({required String email, required String password}) =>
      throw UnimplementedError();

  @override
  Future<AuthUser> signUp({required String name, required String email, required String password}) =>
      throw UnimplementedError();

  @override
  Future<AuthUser> getMe() async =>
      const AuthUser(id: 'usr-admin-1', email: 'admin@louvaio.com', name: 'Admin Test');

  @override
  Future<void> signOut() async {}
}

class MockAuthNotifier extends AuthNotifier {
  MockAuthNotifier(AuthState initialState) : super(FakeAuthRepo()) {
    state = initialState;
  }
}

class FakeDashboardRepo implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async => [];

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId, {int limit = 20}) async => [];

  @override
  Future<Announcement> createAnnouncement(String ministryId, Map<String, dynamic> data) async =>
      throw UnimplementedError();
}

class FakeScheduleRepo implements ScheduleRepository {
  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

  @override
  Future<ScheduleDetail> getScheduleDetail(String ministryId, String scheduleId) async =>
      throw UnimplementedError();

  @override
  Future<ScheduleDetail> confirmParticipation(String ministryId, String scheduleId, bool confirmed) async =>
      throw UnimplementedError();

  @override
  Future<List<ScheduleComment>> getComments(String ministryId, String scheduleId) async => [];

  @override
  Future<ScheduleComment> postComment(String ministryId, String scheduleId, String content) async =>
      throw UnimplementedError();

  @override
  Future<ScheduleDetail> createSchedule(String ministryId, Map<String, dynamic> data) async =>
      throw UnimplementedError();

  @override
  Future<ScheduleDetail> updateSchedule(String ministryId, String scheduleId, Map<String, dynamic> data) async =>
      throw UnimplementedError();

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
      throw UnimplementedError();

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [];

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [];

  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      throw UnimplementedError();

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async =>
      throw UnimplementedError();

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async =>
      throw UnimplementedError();

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}
}

void main() {
  late WidgetMockTeamRepo mockTeamRepo;
  late WidgetMockMembersRepo mockMembersRepo;
  late FakePreferences fakePrefs;
  late FakeMinistryRepo fakeMinistryRepo;

  const adminMinistry = Ministry(id: 'min-1', name: 'Ministério Louvor', role: 'admin');
  const memberMinistry = Ministry(id: 'min-1', name: 'Ministério Louvor', role: 'member');

  const testEnv = AppEnvironment(
    env: AppEnv.development,
    apiBaseUrl: 'http://localhost:3000/api/v1',
  );

  const memberAlice = MinistryMember(id: 'm1', name: 'Alice');
  const memberBob = MinistryMember(id: 'm2', name: 'Bob');
  const memberCarol = MinistryMember(id: 'm3', name: 'Carol');

  setUp(() {
    mockTeamRepo = WidgetMockTeamRepo();
    mockMembersRepo = WidgetMockMembersRepo();
    mockMembersRepo.members = [memberAlice, memberBob, memberCarol];
    fakePrefs = FakePreferences();
    fakeMinistryRepo = FakeMinistryRepo();
  });

  Widget createTestWidget({required Widget child, Ministry ministry = adminMinistry}) {
    final ministryContext = MinistryContextNotifier(
      repository: fakeMinistryRepo,
      preferencesStorage: fakePrefs,
    );
    ministryContext.state = MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      availableMinistries: [ministry],
      selectedMinistry: ministry,
    );

    return ProviderScope(
      overrides: [
        preferencesStorageProvider.overrideWithValue(fakePrefs),
        appEnvironmentProvider.overrideWithValue(testEnv),
        teamRepositoryProvider.overrideWithValue(mockTeamRepo),
        membersRepositoryProvider.overrideWithValue(mockMembersRepo),
        ministryRepositoryProvider.overrideWithValue(fakeMinistryRepo),
        dashboardRepositoryProvider.overrideWithValue(FakeDashboardRepo()),
        scheduleRepositoryProvider.overrideWithValue(FakeScheduleRepo()),
        repertoireRepositoryProvider.overrideWithValue(FakeRepertoireRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => ministryContext),
        authNotifierProvider.overrideWith((ref) => MockAuthNotifier(
              const AuthState(
                status: AuthStatus.authenticated,
                user: AuthUser(
                  id: 'usr-admin-1',
                  email: 'admin@louvaio.com',
                  name: 'Admin Test',
                ),
              ),
            )),
      ],
      child: MaterialApp(
        home: child,
      ),
    );
  }

  group('Profile Admin Section - Equipes Tile', () {
    testWidgets('Admin sees Equipes tile in Profile and can open TeamsScreen', (tester) async {
      await tester.pumpWidget(createTestWidget(
        child: const AppShell(),
        ministry: adminMinistry,
      ));
      await tester.pumpAndSettle();

      // Go to Perfil tab (index 3)
      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      final teamsTileFinder = find.byKey(const ValueKey('profile_teams_tile'));
      expect(teamsTileFinder, findsOneWidget);
      expect(find.text('Equipes'), findsOneWidget);
      expect(find.text('Grupos de integrantes para organização e escalas'), findsOneWidget);

      await tester.tap(teamsTileFinder);
      await tester.pumpAndSettle();

      expect(find.byType(TeamsScreen), findsOneWidget);
    });

    testWidgets('Ordinary member does NOT see Equipes tile in Profile', (tester) async {
      await tester.pumpWidget(createTestWidget(
        child: const AppShell(),
        ministry: memberMinistry,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('profile_teams_tile')), findsNothing);
    });
  });

  group('TeamsScreen', () {
    testWidgets('displays empty state and Criar Equipe CTA when list is empty', (tester) async {
      mockTeamRepo.teams = [];

      await tester.pumpWidget(createTestWidget(
        child: const TeamsScreen(ministryId: 'min-1', ministryName: 'Ministério Louvor'),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Nenhuma equipe cadastrada'), findsOneWidget);
      expect(find.text('Crie equipes para organizar os integrantes do ministério e facilitar a criação de escalas.'), findsOneWidget);
      expect(find.byKey(const ValueKey('empty_create_team_button')), findsOneWidget);
    });

    testWidgets('displays team cards with active member resolution and filters by search', (tester) async {
      mockTeamRepo.teams = [
        const Team(id: 't1', ministryId: 'min-1', name: 'Equipe Vocal', description: 'Vozes principais', memberIds: ['m1', 'm2']),
        const Team(id: 't2', ministryId: 'min-1', name: 'Equipe Instrumental', description: 'Banda base', memberIds: ['m2', 'm3']),
      ];

      await tester.pumpWidget(createTestWidget(
        child: const TeamsScreen(ministryId: 'min-1', ministryName: 'Ministério Louvor'),
      ));
      await tester.pumpAndSettle();

      expect(find.byType(TeamCard), findsNWidgets(2));
      expect(find.text('Equipe Vocal'), findsOneWidget);
      expect(find.text('Equipe Instrumental'), findsOneWidget);
      expect(find.text('2 integrantes'), findsNWidgets(2));

      // Filter via search
      await tester.enterText(find.byKey(const ValueKey('teams_search_field')), 'Vocal');
      await tester.pumpAndSettle();

      expect(find.text('Equipe Vocal'), findsOneWidget);
      expect(find.text('Equipe Instrumental'), findsNothing);
    });

    testWidgets('delete button opens confirmation dialog and deleting removes card', (tester) async {
      mockTeamRepo.teams = [
        const Team(id: 't1', ministryId: 'min-1', name: 'Equipe Vocal', memberIds: ['m1']),
      ];

      await tester.pumpWidget(createTestWidget(
        child: const TeamsScreen(ministryId: 'min-1', ministryName: 'Ministério Louvor'),
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('team_menu_t1')), findsOneWidget);

      // Open popup menu on the card
      await tester.tap(find.byKey(const ValueKey('team_menu_t1')));
      await tester.pumpAndSettle();

      // Tap 'Excluir' in the menu
      await tester.tap(find.text('Excluir'));
      await tester.pumpAndSettle();

      // Verify dialog contents
      expect(find.text('Excluir equipe'), findsOneWidget);
      expect(find.textContaining('As escalas já criadas com esta equipe não serão alteradas.'), findsOneWidget);

      // Confirm delete
      await tester.tap(find.byKey(const ValueKey('confirm_delete_team_button')));
      await tester.pumpAndSettle();

      expect(mockTeamRepo.lastDeletedTeamId, equals('t1'));
      expect(find.text('Nenhuma equipe cadastrada'), findsOneWidget);
    });
  });

  group('TeamFormScreen', () {
    testWidgets('validates required name field', (tester) async {
      await tester.pumpWidget(createTestWidget(
        child: const TeamFormScreen(ministryId: 'min-1'),
      ));
      await tester.pumpAndSettle();

      // Tap save without entering a name
      await tester.tap(find.byKey(const ValueKey('team_form_save_button')));
      await tester.pumpAndSettle();

      expect(find.text('Nome da equipe é obrigatório.'), findsOneWidget);
    });

    testWidgets('member search and selection toggles in Set', (tester) async {
      await tester.pumpWidget(createTestWidget(
        child: const TeamFormScreen(ministryId: 'min-1'),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Alice'), findsOneWidget);
      expect(find.text('Bob'), findsOneWidget);

      // Select Alice
      await tester.tap(find.byKey(const ValueKey('team_member_tile_m1')));
      await tester.pumpAndSettle();

      expect(find.text('1 selecionados'), findsOneWidget);

      // Select Bob
      await tester.tap(find.byKey(const ValueKey('team_member_tile_m2')));
      await tester.pumpAndSettle();

      expect(find.text('2 selecionados'), findsOneWidget);

      // Unselect Alice
      await tester.tap(find.byKey(const ValueKey('team_member_tile_m1')));
      await tester.pumpAndSettle();

      expect(find.text('1 selecionados'), findsOneWidget);
    });

    testWidgets('dirty form guard triggers discard confirmation dialog on back press', (tester) async {
      await tester.pumpWidget(createTestWidget(
        child: Scaffold(
          body: Builder(
            builder: (ctx) => TextButton(
              onPressed: () {
                Navigator.of(ctx).push(
                  MaterialPageRoute(builder: (_) => const TeamFormScreen(ministryId: 'min-1')),
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byType(TeamFormScreen), findsOneWidget);

      // Make dirty
      await tester.enterText(find.byKey(const ValueKey('team_name_field')), 'Nova Equipe');
      await tester.pumpAndSettle();

      // Tap back button
      await tester.tap(find.byTooltip('Back'));
      await tester.pumpAndSettle();

      expect(find.text('Descartar alterações?'), findsOneWidget);

      // Continue editing
      await tester.tap(find.byKey(const ValueKey('discard_dialog_cancel_button')));
      await tester.pumpAndSettle();

      expect(find.byType(TeamFormScreen), findsOneWidget);

      // Tap back again and discard
      await tester.tap(find.byTooltip('Back'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('discard_dialog_confirm_button')));
      await tester.pumpAndSettle();

      expect(find.byType(TeamFormScreen), findsNothing);
    });
  });

  group('TeamPickerSheet', () {
    testWidgets('displays available teams and selecting one invokes onTeamSelected callback', (tester) async {
      mockTeamRepo.teams = [
        const Team(id: 't-picker-1', ministryId: 'min-1', name: 'Equipe Domingo', memberIds: ['m1', 'm2']),
      ];

      Team? pickedTeam;

      await tester.pumpWidget(createTestWidget(
        child: Builder(
          builder: (ctx) => ElevatedButton(
            onPressed: () {
              TeamPickerSheet.show(
                context: ctx,
                ministryId: 'min-1',
                availableMembers: [memberAlice, memberBob],
                onTeamSelected: (team) {
                  pickedTeam = team;
                },
              );
            },
            child: const Text('Open Picker'),
          ),
        ),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Picker'));
      await tester.pumpAndSettle();

      expect(find.byType(TeamPickerSheet), findsOneWidget);
      expect(find.text('Equipe Domingo'), findsOneWidget);
      expect(find.text('2 integrantes ativos'), findsOneWidget);

      // Tap the team tile
      await tester.tap(find.text('Equipe Domingo'));
      await tester.pumpAndSettle();

      // Picker sheet pops and callback receives team
      expect(find.byType(TeamPickerSheet), findsNothing);
      expect(pickedTeam, isNotNull);
      expect(pickedTeam!.id, equals('t-picker-1'));
      expect(pickedTeam!.name, equals('Equipe Domingo'));
    });
  });
}
