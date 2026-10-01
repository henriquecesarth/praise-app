import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/members/presentation/controllers/members_providers.dart';
import 'package:louvaio_mobile/features/members/presentation/views/members_directory_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class FakeMembersRepo implements MembersRepository {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];
  Exception? membersError;
  Exception? rolesError;

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async {
    if (membersError != null) throw membersError!;
    return members;
  }

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async {
    if (rolesError != null) throw rolesError!;
    return roles;
  }
}

class FakeMinistryContextNotifier extends StateNotifier<MinistryContextState>
    implements MinistryContextNotifier {
  FakeMinistryContextNotifier(super.initialState);

  @override
  Future<void> bootstrap() async {}
  @override
  Future<void> refresh() async {}
  @override
  Future<void> selectMinistry(Ministry ministry) async {}
  @override
  Future<void> reset() async {}
}

void main() {
  const testMinistry = Ministry(
    id: 'min_test_1',
    name: 'Ministério Central',
    slug: 'min-central',
    role: 'admin',
    ownerUserId: 'user_1',
  );

  final testRoles = [
    const MinistryRole(id: 'role_voc', name: 'Vocal'),
    const MinistryRole(id: 'role_violao', name: 'Violão'),
    const MinistryRole(id: 'role_bat', name: 'Bateria'),
  ];

  final testMembers = [
    const MinistryMember(
      id: 'm1',
      name: 'Alice Silva',
      email: 'alice@louvaio.com',
      phone: '11999990001',
      role: 'admin',
      roleIds: ['role_voc'],
    ),
    const MinistryMember(
      id: 'm2',
      name: 'Bruno Souza',
      email: 'bruno@louvaio.com',
      phone: '11999990002',
      role: 'member',
      roleIds: ['role_violao'],
    ),
    const MinistryMember(
      id: 'm3',
      name: 'Carlos Dias',
      email: 'carlos@louvaio.com',
      role: 'member',
      roleIds: ['role_bat'],
    ),
  ];

  Widget createWidget({
    required FakeMembersRepo repo,
    FakeMinistryContextNotifier? ministryNotifier,
    String ministryId = 'min_test_1',
    String? ministryName = 'Ministério Central',
  }) {
    final mNotifier = ministryNotifier ??
        FakeMinistryContextNotifier(
          const MinistryContextState(
            status: MinistryBootstrapStatus.ready,
            selectedMinistry: testMinistry,
            availableMinistries: [testMinistry],
          ),
        );

    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
          ),
        ),
        ministryContextNotifierProvider.overrideWith((ref) => mNotifier),
        membersRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        home: MembersDirectoryScreen(
          ministryId: ministryId,
          ministryName: ministryName,
        ),
      ),
    );
  }

  group('MembersDirectoryScreen Presentation', () {
    late FakeMembersRepo repo;

    setUp(() {
      repo = FakeMembersRepo();
      repo.roles = testRoles;
    });

    testWidgets('renders empty state when ministry has 0 members',
        (tester) async {
      repo.members = [];

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Integrantes'), findsOneWidget);
      expect(find.text('Ministério Central'), findsOneWidget);
      expect(find.text('Nenhum integrante cadastrado'), findsOneWidget);
      expect(find.textContaining('ainda não possui integrantes'), findsOneWidget);
    });

    testWidgets('renders error banner and handles "Tentar novamente"',
        (tester) async {
      repo.membersError =
          const AppFailure(message: 'Falha de conexão com o servidor.');

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.textContaining('Falha de conexão'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Fix error and retry
      repo.membersError = null;
      repo.members = testMembers;

      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Bruno Souza'), findsOneWidget);
    });

    testWidgets('renders member list with system role and musical role badges',
        (tester) async {
      repo.members = testMembers;

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      // Header shows count badge
      expect(find.text('3 membros'), findsOneWidget);

      // Members displayed
      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('ADMINISTRADOR'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('member_card_m1')),
          matching: find.text('Vocal'),
        ),
        findsOneWidget,
      );

      expect(find.text('Bruno Souza'), findsOneWidget);
      expect(find.text('MEMBRO'), findsNWidgets(2)); // Bruno and Carlos
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('member_card_m2')),
          matching: find.text('Violão'),
        ),
        findsOneWidget,
      );
      expect(find.text('Carlos Dias'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('member_card_m3')),
          matching: find.text('Bateria'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('search filters member list by name and restores on clear',
        (tester) async {
      repo.members = testMembers;

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      final searchField = find.byKey(const ValueKey('member_search_input'));
      expect(searchField, findsOneWidget);

      // Search Alice
      await tester.enterText(searchField, 'Alice');
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Bruno Souza'), findsNothing);
      expect(find.text('Carlos Dias'), findsNothing);

      // Search with no results
      await tester.enterText(searchField, 'Nenhum');
      await tester.pumpAndSettle();

      expect(find.text('Nenhum integrante encontrado'), findsOneWidget);
      expect(find.text('Limpar filtros'), findsOneWidget);

      // Clear filters button restores all members
      await tester.tap(find.text('Limpar filtros'));
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Bruno Souza'), findsOneWidget);
      expect(find.text('Carlos Dias'), findsOneWidget);
    });

    testWidgets('role filter chips filter by admin and musical role',
        (tester) async {
      repo.members = testMembers;

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      // Filter Admins
      final adminChip = find.byKey(const ValueKey('role_filter_admin'));
      expect(adminChip, findsOneWidget);
      await tester.tap(adminChip);
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Bruno Souza'), findsNothing);

      // Filter Members
      final memberChip = find.byKey(const ValueKey('role_filter_member'));
      await tester.tap(memberChip);
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsNothing);
      expect(find.text('Bruno Souza'), findsOneWidget);
      expect(find.text('Carlos Dias'), findsOneWidget);

      // Filter by musical role 'role_voc' (Vocal)
      final vocChip = find.byKey(const ValueKey('role_filter_role_voc'));
      await tester.tap(vocChip);
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Bruno Souza'), findsNothing);
      expect(find.text('Carlos Dias'), findsNothing);
    });

    testWidgets('tapping member card opens MemberDetailSheet with full details',
        (tester) async {
      repo.members = testMembers;

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      // Tap Alice
      await tester.tap(find.text('Alice Silva'));
      await tester.pumpAndSettle();

      // Sheet opens
      expect(find.text('Funções Musicais'), findsOneWidget);
      expect(find.text('alice@louvaio.com'), findsNWidgets(2)); // list card + detail sheet
      expect(find.text('11999990001'), findsOneWidget);
      expect(find.text('Fechar'), findsOneWidget);

      // Tap Fechar closes sheet
      await tester.tap(find.text('Fechar'));
      await tester.pumpAndSettle();

      expect(find.text('Fechar'), findsNothing);
    });

    testWidgets('pops screen when active ministry changes (tenant switch)',
        (tester) async {
      repo.members = testMembers;
      final navKey = GlobalKey<NavigatorState>();
      final mNotifier = FakeMinistryContextNotifier(
        const MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          selectedMinistry: testMinistry,
          availableMinistries: [testMinistry],
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
              ),
            ),
            ministryContextNotifierProvider.overrideWith((ref) => mNotifier),
            membersRepositoryProvider.overrideWithValue(repo),
          ],
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Previous Screen')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Push MembersDirectoryScreen
      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => const MembersDirectoryScreen(
            ministryId: 'min_test_1',
            ministryName: 'Ministério Central',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);

      // Trigger ministry switch to another ministry
      mNotifier.state = mNotifier.state.copyWith(
        selectedMinistry: const Ministry(
          id: 'min_test_other',
          name: 'Outro Ministério',
          slug: 'outro',
        ),
      );
      await tester.pumpAndSettle();

      // Screen popped back to Previous Screen
      expect(find.text('Previous Screen'), findsOneWidget);
    });
  });
}
