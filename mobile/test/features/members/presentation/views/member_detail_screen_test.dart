import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/members/presentation/views/member_detail_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class FakeMembersRepo implements MembersRepository {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];
  Exception? memberDetailError;
  Completer<MinistryMember>? pendingMemberCompleter;
  bool removeCalled = false;
  String? removedMemberId;

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async {
    return members;
  }

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async {
    return roles;
  }

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async {
    if (pendingMemberCompleter != null) {
      return pendingMemberCompleter!.future;
    }
    if (memberDetailError != null) throw memberDetailError!;
    return members.firstWhere(
      (m) => m.id == memberId,
      orElse: () => throw const AppFailure(message: 'Integrante não encontrado', code: '404'),
    );
  }

  @override
  Future<MinistryMember> addMember({
    required String ministryId,
    required String name,
    required String email,
    String role = 'member',
    String? birthDate,
    List<String> roleIds = const [],
  }) async {
    final m = MinistryMember(
      id: 'new_${members.length + 1}',
      name: name,
      email: email,
      role: role,
      birthDate: birthDate,
      roleIds: roleIds,
    );
    members.add(m);
    return m;
  }

  @override
  Future<MinistryMember> updateMember({
    required String ministryId,
    required String memberId,
    String? name,
    String? email,
    String? birthDate,
    String? role,
    List<String>? roleIds,
  }) async {
    final index = members.indexWhere((m) => m.id == memberId);
    if (index == -1) throw const AppFailure(message: 'Integrante não encontrado', code: '404');
    final current = members[index];
    final updated = current.copyWith(
      name: name ?? current.name,
      email: email ?? current.email,
      birthDate: birthDate ?? current.birthDate,
      role: role ?? current.role,
      roleIds: roleIds ?? current.roleIds,
    );
    members[index] = updated;
    return updated;
  }

  @override
  Future<void> removeMember({required String ministryId, required String memberId}) async {
    removeCalled = true;
    removedMemberId = memberId;
    members.removeWhere((m) => m.id == memberId);
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
  const testMinistryAdmin = Ministry(
    id: 'min_test_1',
    name: 'Ministério Central',
    slug: 'min-central',
    role: 'admin',
    ownerUserId: 'user_1',
  );

  const testMinistryMember = Ministry(
    id: 'min_test_1',
    name: 'Ministério Central',
    slug: 'min-central',
    role: 'member',
    ownerUserId: 'user_other',
  );

  final testRoles = [
    const MinistryRole(id: 'role_voc', name: 'Vocal'),
    const MinistryRole(id: 'role_violao', name: 'Violão'),
  ];

  const testMember = MinistryMember(
    id: 'm1',
    name: 'Carlos Oliveira',
    email: 'carlos@louvaio.com',
    phone: '11988887777',
    birthDate: '1990-05-15',
    role: 'member',
    isManual: true,
    roleIds: ['role_voc', 'role_violao'],
  );

  Widget createWidget({
    required FakeMembersRepo repo,
    Ministry activeMinistry = testMinistryAdmin,
    String ministryId = 'min_test_1',
    String memberId = 'm1',
    MinistryMember? initialMember,
    GlobalKey<NavigatorState>? navKey,
  }) {
    final mNotifier = FakeMinistryContextNotifier(
      MinistryContextState(
        status: MinistryBootstrapStatus.ready,
        selectedMinistry: activeMinistry,
        availableMinistries: [activeMinistry],
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
        navigatorKey: navKey,
        home: MemberDetailScreen(
          ministryId: ministryId,
          memberId: memberId,
          initialMember: initialMember,
        ),
      ),
    );
  }

  group('MemberDetailScreen Presentation & Hardening', () {
    late FakeMembersRepo repo;

    setUp(() {
      repo = FakeMembersRepo();
      repo.roles = testRoles;
      repo.members = [testMember];
    });

    testWidgets('renders loading indicator initially when no initialMember is provided',
        (tester) async {
      repo.pendingMemberCompleter = Completer<MinistryMember>();

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('admin viewer sees administrative controls and sensitive contact info',
        (tester) async {
      await tester.pumpWidget(createWidget(repo: repo, activeMinistry: testMinistryAdmin));
      await tester.pumpAndSettle();

      // Header and Name
      expect(find.text('Carlos Oliveira'), findsOneWidget);
      expect(find.text('MEMBRO'), findsOneWidget);
      expect(find.text('CADASTRO MANUAL'), findsOneWidget);

      // Admin controls in AppBar
      expect(find.byKey(const ValueKey('edit_member_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('delete_member_button')), findsOneWidget);

      // Admin action buttons in body
      expect(find.byKey(const ValueKey('manage_edit_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('manage_remove_button')), findsOneWidget);

      // Contact details visible to admin
      expect(find.text('Informações de Contato'), findsOneWidget);
      expect(find.text('carlos@louvaio.com'), findsOneWidget);
      expect(find.text('11988887777'), findsOneWidget);
      expect(find.text('15/05/1990'), findsOneWidget);

      // Musical roles
      expect(find.text('Funções Musicais / Atribuições'), findsOneWidget);
      expect(find.text('Vocal'), findsOneWidget);
      expect(find.text('Violão'), findsOneWidget);
    });

    testWidgets(
        'ordinary member viewer does NOT see admin controls or sensitive contact info (privacy hardening)',
        (tester) async {
      await tester.pumpWidget(createWidget(repo: repo, activeMinistry: testMinistryMember));
      await tester.pumpAndSettle();

      // Name and public role
      expect(find.text('Carlos Oliveira'), findsOneWidget);
      expect(find.text('MEMBRO'), findsOneWidget);

      // Musical roles are visible
      expect(find.text('Vocal'), findsOneWidget);
      expect(find.text('Violão'), findsOneWidget);

      // Admin controls in AppBar MUST NOT be present
      expect(find.byKey(const ValueKey('edit_member_button')), findsNothing);
      expect(find.byKey(const ValueKey('delete_member_button')), findsNothing);

      // Admin action buttons in body MUST NOT be present
      expect(find.byKey(const ValueKey('manage_edit_button')), findsNothing);
      expect(find.byKey(const ValueKey('manage_remove_button')), findsNothing);

      // Contact details card MUST NOT be present for ordinary members
      expect(find.text('Informações de Contato'), findsNothing);
      expect(find.text('carlos@louvaio.com'), findsNothing);
      expect(find.text('11988887777'), findsNothing);
      expect(find.text('15/05/1990'), findsNothing);
    });

    testWidgets('renders not found (404) state and allows user to go back',
        (tester) async {
      repo.memberDetailError = const AppFailure(
        message: 'Integrante não encontrado',
        code: '404',
      );

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Integrante não encontrado'), findsOneWidget);
      expect(find.textContaining('não pertence a este ministério'), findsOneWidget);
      expect(find.text('Voltar'), findsOneWidget);
    });

    testWidgets('renders unauthorized (403) state and allows user to go back',
        (tester) async {
      repo.memberDetailError = const AppFailure(
        message: 'Ação restrita a administradores do ministério.',
        code: '403',
      );

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Acesso restrito'), findsOneWidget);
      expect(find.textContaining('não tem permissão'), findsOneWidget);
      expect(find.text('Voltar'), findsOneWidget);
    });

    testWidgets('renders error state and retry successfully reloads member',
        (tester) async {
      repo.memberDetailError = const AppFailure(
        message: 'Falha temporária de rede.',
        code: '500',
      );

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Falha temporária de rede.'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Clear error and retry
      repo.memberDetailError = null;
      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Carlos Oliveira'), findsOneWidget);
    });

    testWidgets('pops screen when active ministry switches away (tenant-switch safety)',
        (tester) async {
      final navKey = GlobalKey<NavigatorState>();
      final mNotifier = FakeMinistryContextNotifier(
        const MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          selectedMinistry: testMinistryAdmin,
          availableMinistries: [testMinistryAdmin],
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

      // Push MemberDetailScreen
      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => const MemberDetailScreen(
            ministryId: 'min_test_1',
            memberId: 'm1',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Carlos Oliveira'), findsOneWidget);

      // Switch to different ministry
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

    testWidgets('admin can open remove confirmation and cancel without deleting',
        (tester) async {
      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      // Tap delete button in AppBar
      await tester.tap(find.byKey(const ValueKey('delete_member_button')));
      await tester.pumpAndSettle();

      // Confirmation dialog is shown
      expect(find.text('Remover integrante'), findsOneWidget);
      expect(find.textContaining('Deseja realmente remover Carlos Oliveira'), findsOneWidget);

      // Tap Cancelar
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(find.text('Remover integrante'), findsNothing);
      expect(repo.removeCalled, isFalse);
    });

    testWidgets('admin can confirm remove member, which calls repository and navigates back',
        (tester) async {
      final navKey = GlobalKey<NavigatorState>();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
              ),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(
                const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  selectedMinistry: testMinistryAdmin,
                  availableMinistries: [testMinistryAdmin],
                ),
              ),
            ),
            membersRepositoryProvider.overrideWithValue(repo),
          ],
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Previous Screen')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => const MemberDetailScreen(
            ministryId: 'min_test_1',
            memberId: 'm1',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Carlos Oliveira'), findsOneWidget);

      // Tap delete in AppBar
      await tester.tap(find.byKey(const ValueKey('delete_member_button')));
      await tester.pumpAndSettle();

      // Confirm removal
      final confirmBtn = find.byKey(const ValueKey('confirm_remove_member_button'));
      expect(confirmBtn, findsOneWidget);
      await tester.tap(confirmBtn);
      await tester.pumpAndSettle();

      expect(repo.removeCalled, isTrue);
      expect(repo.removedMemberId, 'm1');
      expect(find.text('Carlos Oliveira foi removido(a) do ministério.'), findsOneWidget);
      expect(find.text('Previous Screen'), findsOneWidget);
    });

    testWidgets('classifies HTTP 404 AppFailure via statusCode and renders Not Found view',
        (tester) async {
      final repo = FakeMembersRepo();
      repo.memberDetailError = const AppFailure(
        message: 'Qualquer mensagem de erro',
        statusCode: 404,
      );

      await tester.pumpWidget(
        createWidget(
          repo: repo,
          memberId: 'mem_nonexistent',
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Integrante não encontrado'), findsOneWidget);
      expect(find.byIcon(Icons.person_off_outlined), findsOneWidget);
    });

    testWidgets('classifies HTTP 403 AppFailure via statusCode and renders Restricted view',
        (tester) async {
      final repo = FakeMembersRepo();
      repo.memberDetailError = const AppFailure(
        message: 'Qualquer mensagem restrita',
        statusCode: 403,
      );

      await tester.pumpWidget(
        createWidget(
          repo: repo,
          memberId: 'mem_forbidden',
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Acesso restrito'), findsOneWidget);
      expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
    });

    test('tenant-switch race safety: late Alpha response discarded on Beta switch', () async {
      final repo = FakeMembersRepo();
      const alphaMember = MinistryMember(
        id: 'mem_alpha',
        name: 'Membro Alpha',
        role: 'member',
        roleIds: [],
      );
      const betaMember = MinistryMember(
        id: 'mem_beta',
        name: 'Membro Beta',
        role: 'member',
        roleIds: [],
      );
      repo.members = [alphaMember, betaMember];

      final container = ProviderContainer(
        overrides: [
          membersRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);

      final notifier = container.read(memberDetailNotifierProvider.notifier);

      final alphaCompleter = Completer<MinistryMember>();
      repo.pendingMemberCompleter = alphaCompleter;

      // Start load for ministry Alpha
      final futureAlpha = notifier.load(
        ministryId: 'min_alpha',
        memberId: 'mem_alpha',
      );

      expect(container.read(memberDetailNotifierProvider).ministryId, 'min_alpha');

      // Now switch and load for ministry Beta
      repo.pendingMemberCompleter = null;
      await notifier.load(
        ministryId: 'min_beta',
        memberId: 'mem_beta',
      );

      expect(container.read(memberDetailNotifierProvider).ministryId, 'min_beta');
      expect(container.read(memberDetailNotifierProvider).member?.name, 'Membro Beta');

      // Late response from Alpha completes now
      alphaCompleter.complete(alphaMember);
      await futureAlpha;

      // State MUST remain Beta, Alpha response discarded
      final finalState = container.read(memberDetailNotifierProvider);
      expect(finalState.ministryId, 'min_beta');
      expect(finalState.member?.name, 'Membro Beta');
    });
  });
}
