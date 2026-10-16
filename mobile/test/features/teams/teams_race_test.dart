import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry_onboarding.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/teams/data/team_repository.dart';
import 'package:louvaio_mobile/features/teams/domain/team.dart';
import 'package:louvaio_mobile/features/teams/presentation/controllers/teams_list_controller.dart';
import 'package:louvaio_mobile/features/teams/presentation/controllers/team_form_controller.dart';
import 'package:louvaio_mobile/features/teams/presentation/views/team_form_screen.dart';
import 'package:louvaio_mobile/features/teams/presentation/widgets/team_picker_sheet.dart';

class RaceMockTeamRepo implements TeamRepository {
  Completer<List<Team>>? pendingListCompleter;
  Completer<Team>? pendingCreateCompleter;
  Completer<Team>? pendingEditCompleter;
  Completer<void>? pendingDeleteCompleter;

  @override
  Future<List<Team>> getTeams(String ministryId) async {
    if (pendingListCompleter != null) return pendingListCompleter!.future;
    return [];
  }

  @override
  Future<Team> getTeamById(String ministryId, String teamId) async =>
      throw UnimplementedError();

  @override
  Future<Team> createTeam(String ministryId,
      {required String name,
      String? description,
      List<String>? memberIds}) async {
    if (pendingCreateCompleter != null) return pendingCreateCompleter!.future;
    return Team(id: 't-created', ministryId: ministryId, name: name);
  }

  @override
  Future<Team> updateTeam(String ministryId, String teamId,
      {String? name,
      String? description,
      List<String>? memberIds}) async {
    if (pendingEditCompleter != null) return pendingEditCompleter!.future;
    return Team(id: teamId, ministryId: ministryId, name: name ?? '');
  }

  @override
  Future<void> deleteTeam(String ministryId, String teamId) async {
    if (pendingDeleteCompleter != null) return pendingDeleteCompleter!.future;
  }
}

class RaceMockMembersRepo implements MembersRepository {
  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async => [
        const MinistryMember(id: 'm1', name: 'Alice'),
      ];

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async => [];

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async =>
      throw UnimplementedError();

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

void main() {
  late RaceMockTeamRepo mockTeamRepo;
  late RaceMockMembersRepo mockMembersRepo;

  setUp(() {
    mockTeamRepo = RaceMockTeamRepo();
    mockMembersRepo = RaceMockMembersRepo();
  });

  group('M18 Async Race Suite (M18-RACE-01 to M18-RACE-06)', () {
    test('M18-RACE-01: Alpha Team list request pending -> Beta selected -> Alpha completes -> Discard', () async {
      final notifier = TeamsListNotifier(repository: mockTeamRepo);

      final alphaCompleter = Completer<List<Team>>();
      mockTeamRepo.pendingListCompleter = alphaCompleter;

      // Start Alpha load
      final alphaFuture = notifier.load('min-alpha');
      expect(notifier.state.ministryId, equals('min-alpha'));
      expect(notifier.state.isLoading, isTrue);

      // Tenant switches to Beta before Alpha finishes
      final betaCompleter = Completer<List<Team>>();
      mockTeamRepo.pendingListCompleter = betaCompleter;
      final betaFuture = notifier.load('min-beta');
      expect(notifier.state.ministryId, equals('min-beta'));

      // Alpha finishes late with Alpha data
      alphaCompleter.complete([
        const Team(id: 't-alpha', ministryId: 'min-alpha', name: 'Alpha Team'),
      ]);
      await alphaFuture;

      // Alpha data must be discarded; state is under Beta
      expect(notifier.state.ministryId, equals('min-beta'));
      expect(notifier.state.teams, isEmpty);

      // Beta completes
      betaCompleter.complete([
        const Team(id: 't-beta', ministryId: 'min-beta', name: 'Beta Team'),
      ]);
      await betaFuture;

      expect(notifier.state.teams.length, equals(1));
      expect(notifier.state.teams.first.name, equals('Beta Team'));
    });

    test('M18-RACE-02: Alpha create pending -> Beta selected -> completes -> Discarded (no Beta contamination)', () async {
      final formNotifier = TeamFormNotifier(
        teamRepository: mockTeamRepo,
        membersRepository: mockMembersRepo,
      );

      formNotifier.init(
        ministryId: 'min-alpha',
        boundUserId: 'usr-1',
      );

      final createCompleter = Completer<Team>();
      mockTeamRepo.pendingCreateCompleter = createCompleter;

      final future = formNotifier.createTeam(name: 'Alpha Team');

      // Tenant switches to Beta
      formNotifier.invalidateTenant();

      createCompleter.complete(const Team(id: 't-alpha', ministryId: 'min-alpha', name: 'Alpha Team'));
      final result = await future;

      expect(result.isDiscarded, isTrue);
    });

    test('M18-RACE-03: User A edit pending -> User B switches -> completes -> Discarded', () async {
      final formNotifier = TeamFormNotifier(
        teamRepository: mockTeamRepo,
        membersRepository: mockMembersRepo,
      );

      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-A',
        initialTeam: const Team(id: 't-1', ministryId: 'min-1', name: 'Original'),
      );

      final editCompleter = Completer<Team>();
      mockTeamRepo.pendingEditCompleter = editCompleter;

      final future = formNotifier.updateTeam(teamId: 't-1', name: 'Updated');

      // User session switches to User B
      formNotifier.init(
        ministryId: 'min-1',
        boundUserId: 'usr-B',
      );

      editCompleter.complete(const Team(id: 't-1', ministryId: 'min-1', name: 'Updated'));
      final result = await future;

      expect(result.isDiscarded, isTrue);
    });

    test('M18-RACE-04: Alpha delete pending -> Beta switches -> completes -> Discarded', () async {
      final formNotifier = TeamFormNotifier(
        teamRepository: mockTeamRepo,
        membersRepository: mockMembersRepo,
      );

      formNotifier.init(
        ministryId: 'min-alpha',
        boundUserId: 'usr-1',
        initialTeam: const Team(id: 't-1', ministryId: 'min-alpha', name: 'To Delete'),
      );

      final deleteCompleter = Completer<void>();
      mockTeamRepo.pendingDeleteCompleter = deleteCompleter;

      final future = formNotifier.deleteTeam('t-1');

      // Tenant switches
      formNotifier.invalidateTenant();

      deleteCompleter.complete();
      final result = await future;

      expect(result.isDiscarded, isTrue);
    });

    testWidgets('M18-RACE-05: Alpha Team form dirty -> tenant Beta -> Forced dismiss regardless of dirty guard', (tester) async {
      final fakeRepo = FakeMinistryContextRepo();
      final fakePrefs = FakePreferences();
      final ministryContext = MinistryContextNotifier(
        repository: fakeRepo,
        preferencesStorage: fakePrefs,
      );

      const minAlpha = Ministry(id: 'min-alpha', name: 'Alpha', role: 'admin');
      const minBeta = Ministry(id: 'min-beta', name: 'Beta', role: 'admin');

      ministryContext.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: [minAlpha, minBeta],
        selectedMinistry: minAlpha,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            teamRepositoryProvider.overrideWithValue(mockTeamRepo),
            membersRepositoryProvider.overrideWithValue(mockMembersRepo),
            ministryContextNotifierProvider.overrideWith((ref) => ministryContext),
            authNotifierProvider.overrideWith((ref) => MockAuthNotifier(
                  const AuthState(
                    status: AuthStatus.authenticated,
                    user: AuthUser(
                        id: 'usr-1',
                        email: 'test@louvaio.com',
                        name: 'User 1'),
                  ),
                )),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => TextButton(
                  onPressed: () {
                    Navigator.of(ctx).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            const TeamFormScreen(ministryId: 'min-alpha'),
                      ),
                    );
                  },
                  child: const Text('Open Form'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open Form'));
      await tester.pumpAndSettle();

      expect(find.byType(TeamFormScreen), findsOneWidget);

      // Enter text to make form dirty
      await tester.enterText(
          find.byKey(const ValueKey('team_name_field')), 'Draft Alpha Name');
      await tester.pumpAndSettle();

      // Ministry switches to Beta
      await ministryContext.selectMinistry(minBeta);
      await tester.pumpAndSettle();

      // The screen must be popped without showing any discard confirmation dialog!
      expect(find.text('Descartar alterações?'), findsNothing);
      expect(find.byType(TeamFormScreen), findsNothing);
    });

    testWidgets('M18-RACE-06: Alpha TeamPicker open -> tenant Beta -> Dismissed (no Alpha import into Beta)', (tester) async {
      final fakeRepo = FakeMinistryContextRepo();
      final fakePrefs = FakePreferences();
      final ministryContext = MinistryContextNotifier(
        repository: fakeRepo,
        preferencesStorage: fakePrefs,
      );

      const minAlpha = Ministry(id: 'min-alpha', name: 'Alpha', role: 'admin');
      const minBeta = Ministry(id: 'min-beta', name: 'Beta', role: 'admin');

      ministryContext.state = const MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        availableMinistries: [minAlpha, minBeta],
        selectedMinistry: minAlpha,
      );

      Team? importedTeam;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            teamRepositoryProvider.overrideWithValue(mockTeamRepo),
            ministryContextNotifierProvider.overrideWith((ref) => ministryContext),
          ],
          child: MaterialApp(
            home: Builder(
              builder: (ctx) => Scaffold(
                body: ElevatedButton(
                  onPressed: () {
                    TeamPickerSheet.show(
                      context: ctx,
                      ministryId: 'min-alpha',
                      availableMembers: const [
                        MinistryMember(id: 'm1', name: 'Alice')
                      ],
                      onTeamSelected: (t) => importedTeam = t,
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byType(TeamPickerSheet), findsOneWidget);

      // Tenant switches to Beta while picker is open
      await ministryContext.selectMinistry(minBeta);
      await tester.pumpAndSettle();

      // TeamPickerSheet must be dismissed
      expect(find.byType(TeamPickerSheet), findsNothing);
      expect(importedTeam, isNull);
    });
  });
}

class FakeAuthRepo implements AuthRepository {
  @override
  Stream<fb.User?> authStateChanges() => const Stream.empty();

  @override
  fb.User? get currentFirebaseUser => null;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;

  @override
  Future<fb.UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();

  @override
  Future<AuthUser> getMe() async =>
      const AuthUser(id: 'usr-1', email: 'test@louvaio.com', name: 'User 1');

  @override
  Future<void> signOut() async {}
}

class MockAuthNotifier extends AuthNotifier {
  MockAuthNotifier(AuthState initialState) : super(FakeAuthRepo()) {
    state = initialState;
  }
}

class FakeMinistryContextRepo implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => [];

  @override
  Future<Ministry> createMinistry({required String name}) async =>
      throw UnimplementedError();

  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) async =>
      throw UnimplementedError();

  @override
  Future<MinistryInvite> createInviteCode(
    String ministryId, {
    int expiresInDays = 7,
  }) async =>
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
