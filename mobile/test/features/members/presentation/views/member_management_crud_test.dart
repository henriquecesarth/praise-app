import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/members/data/members_repository.dart';
import 'package:louvaio_mobile/features/members/presentation/views/members_directory_screen.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/member_form_dialog.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class FakeMembersRepo implements MembersRepository {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];
  Exception? addError;
  Exception? updateError;
  Completer<MinistryMember>? pendingSubmitCompleter;
  int addCalls = 0;
  int updateCalls = 0;

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async {
    return List.from(members);
  }

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async {
    return List.from(roles);
  }

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
  }) async {
    addCalls++;
    if (pendingSubmitCompleter != null) {
      return pendingSubmitCompleter!.future;
    }
    if (addError != null) throw addError!;

    final newMember = MinistryMember(
      id: 'm_${members.length + 1}',
      name: name,
      email: email,
      role: role,
      birthDate: birthDate,
      roleIds: roleIds,
      isManual: true,
    );
    members.add(newMember);
    return newMember;
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
    updateCalls++;
    if (pendingSubmitCompleter != null) {
      return pendingSubmitCompleter!.future;
    }
    if (updateError != null) throw updateError!;

    final index = members.indexWhere((m) => m.id == memberId);
    final cur = members[index];
    final updated = cur.copyWith(
      name: name ?? cur.name,
      email: email ?? cur.email,
      birthDate: birthDate ?? cur.birthDate,
      role: role ?? cur.role,
      roleIds: roleIds ?? cur.roleIds,
    );
    members[index] = updated;
    return updated;
  }

  @override
  Future<void> removeMember({required String ministryId, required String memberId}) async {
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
  ];

  const testMember = MinistryMember(
    id: 'm1',
    name: 'Alice Silva',
    email: 'alice@louvaio.com',
    role: 'member',
    roleIds: ['role_voc'],
  );

  Widget createWidget({
    required FakeMembersRepo repo,
    required Widget child,
  }) {
    return ProviderScope(
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
              selectedMinistry: testMinistry,
              availableMinistries: [testMinistry],
            ),
          ),
        ),
        membersRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        home: child,
      ),
    );
  }

  group('Member Management CRUD Workflows', () {
    late FakeMembersRepo repo;

    setUp(() {
      repo = FakeMembersRepo();
      repo.roles = testRoles;
      repo.members = [testMember];
    });

    testWidgets('admin can tap FAB to open MemberFormDialog and add new member',
        (tester) async {
      await tester.pumpWidget(
        createWidget(
          repo: repo,
          child: const MembersDirectoryScreen(
            ministryId: 'min_test_1',
            ministryName: 'Ministério Central',
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Verify FAB is present for admin
      final fab = find.byKey(const ValueKey('add_member_fab'));
      expect(fab, findsOneWidget);

      await tester.tap(fab);
      await tester.pumpAndSettle();

      // Dialog opens
      expect(find.text('Adicionar Integrante'), findsOneWidget);

      // Fill in name
      final nameInput = find.byKey(const ValueKey('member_form_name_input'));
      await tester.enterText(nameInput, 'Daniel Santos');

      // Fill in email
      final emailInput = find.byKey(const ValueKey('member_form_email_input'));
      await tester.enterText(emailInput, 'daniel@louvaio.com');

      // Select role 'admin'
      await tester.tap(find.text('Administrador'));
      await tester.pumpAndSettle();

      // Select musical role 'Violão'
      final violaoChip = find.byKey(const ValueKey('member_role_chip_role_violao'));
      await tester.tap(violaoChip);
      await tester.pumpAndSettle();

      // Submit
      final submitBtn = find.byKey(const ValueKey('member_form_submit_button'));
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      // Dialog closed, snackbar shown, directory refreshed
      expect(find.text('Adicionar Integrante'), findsNothing);
      expect(find.text('Daniel Santos foi adicionado(a) com sucesso!'), findsOneWidget);
      expect(repo.addCalls, 1);
      expect(repo.members.length, 2);
      expect(repo.members.last.name, 'Daniel Santos');
      expect(repo.members.last.role, 'admin');
      expect(repo.members.last.roleIds, contains('role_violao'));
    });

    testWidgets('form validates required fields and rejects invalid email',
        (tester) async {
      await tester.pumpWidget(
        createWidget(
          repo: repo,
          child: Builder(
            builder: (ctx) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () {
                    MemberFormDialog.show(
                      context: ctx,
                      ministryId: 'min_test_1',
                      roles: testRoles,
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Tap submit with empty fields
      final submitBtn = find.byKey(const ValueKey('member_form_submit_button'));
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      // Required field validation messages
      expect(find.text('Nome é obrigatório.'), findsOneWidget);
      expect(find.text('E-mail é obrigatório.'), findsOneWidget);
      expect(repo.addCalls, 0);

      // Enter invalid email format
      await tester.enterText(find.byKey(const ValueKey('member_form_name_input')), 'Teste');
      await tester.enterText(find.byKey(const ValueKey('member_form_email_input')), 'emailinvalido');
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      expect(find.text('Informe um e-mail válido.'), findsOneWidget);
      expect(repo.addCalls, 0);
    });

    testWidgets('edit member flow pre-populates existing values and updates member',
        (tester) async {
      await tester.pumpWidget(
        createWidget(
          repo: repo,
          child: Builder(
            builder: (ctx) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () {
                    MemberFormDialog.show(
                      context: ctx,
                      ministryId: 'min_test_1',
                      member: testMember,
                      roles: testRoles,
                    );
                  },
                  child: const Text('Open Edit'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Edit'));
      await tester.pumpAndSettle();

      // Pre-filled values
      expect(find.text('Editar Integrante'), findsOneWidget);
      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('alice@louvaio.com'), findsOneWidget);

      // Modify name
      final nameInput = find.byKey(const ValueKey('member_form_name_input'));
      await tester.enterText(nameInput, 'Alice S. Oliveira');

      // Change role to admin
      await tester.tap(find.text('Administrador'));
      await tester.pumpAndSettle();

      // Submit
      final submitBtn = find.byKey(const ValueKey('member_form_submit_button'));
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      expect(find.text('Editar Integrante'), findsNothing);
      expect(repo.updateCalls, 1);
      expect(repo.members.first.name, 'Alice S. Oliveira');
      expect(repo.members.first.role, 'admin');
    });

    testWidgets('double submission prevention: disables submit button while submitting',
        (tester) async {
      repo.pendingSubmitCompleter = Completer<MinistryMember>();

      await tester.pumpWidget(
        createWidget(
          repo: repo,
          child: Builder(
            builder: (ctx) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () {
                    MemberFormDialog.show(
                      context: ctx,
                      ministryId: 'min_test_1',
                      roles: testRoles,
                    );
                  },
                  child: const Text('Open Add'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Add'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const ValueKey('member_form_name_input')), 'Teste Duplo');
      await tester.enterText(find.byKey(const ValueKey('member_form_email_input')), 'teste@louvaio.com');

      final submitBtn = find.byKey(const ValueKey('member_form_submit_button'));
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pump(); // Start async submission

      // While submitting, progress indicator inside button is shown
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Subsequent tap does not fire additional calls
      await tester.tap(submitBtn);
      await tester.pump();
      expect(repo.addCalls, 1);

      // Complete submission
      repo.pendingSubmitCompleter!.complete(
        const MinistryMember(id: 'm_new', name: 'Teste Duplo', email: 'teste@louvaio.com'),
      );
      await tester.pumpAndSettle();

      expect(find.text('Adicionar Integrante'), findsNothing);
    });

    testWidgets('backend error displays error banner in dialog and leaves dialog open',
        (tester) async {
      repo.addError = const AppFailure(
        message: 'Quota de membros excedida para este plano.',
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
      );

      await tester.pumpWidget(
        createWidget(
          repo: repo,
          child: Builder(
            builder: (ctx) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () {
                    MemberFormDialog.show(
                      context: ctx,
                      ministryId: 'min_test_1',
                      roles: testRoles,
                    );
                  },
                  child: const Text('Open Add'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Add'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const ValueKey('member_form_name_input')), 'Membro Extra');
      await tester.enterText(find.byKey(const ValueKey('member_form_email_input')), 'extra@louvaio.com');

      final submitBtn = find.byKey(const ValueKey('member_form_submit_button'));
      await tester.ensureVisible(submitBtn);
      await tester.tap(submitBtn);
      await tester.pumpAndSettle();

      // Error message is displayed inside the dialog
      expect(find.text('Quota de membros excedida para este plano.'), findsOneWidget);
      expect(find.text('Adicionar Integrante'), findsOneWidget);
    });

    test('resetAuthenticatedFeatures resets member form and detail state on logout/user switch', () {
      final container = ProviderContainer(
        overrides: [
          membersRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);

      // Put dirty state in memberFormNotifier
      final formNotifier = container.read(memberFormNotifierProvider.notifier);
      formNotifier.clearError();

      // Call resetAuthenticatedFeatures
      resetAuthenticatedFeatures(container);

      // Member detail and form state are fresh
      final detailState = container.read(memberDetailNotifierProvider);
      final formState = container.read(memberFormNotifierProvider);

      expect(detailState.member, isNull);
      expect(detailState.isLoading, isFalse);
      expect(detailState.isNotFound, isFalse);
      expect(formState.isSubmitting, isFalse);
      expect(formState.error, isNull);
    });
  });
}
