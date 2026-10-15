import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/invite_code_sheet.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry_onboarding.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/ministry_empty_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/widgets/create_ministry_sheet.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/widgets/join_ministry_sheet.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/widgets/ministry_switcher_sheet.dart';

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<fb.User?> authStateChanges() => const Stream.empty();
  @override
  fb.User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<fb.UserCredential> signInWithEmailAndPassword({required String email, required String password}) => throw UnimplementedError();
  @override
  Future<AuthUser> signUp({required String name, required String email, required String password}) => throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class FakeAuthNotifier extends AuthNotifier {
  FakeAuthNotifier([
    AuthState initialState = const AuthState.authenticated(
      AuthUser(id: 'usr_test', email: 'test@louvaio.app', name: 'Tester'),
    ),
  ]) : super(_FakeAuthRepo()) {
    state = initialState;
  }
}

class FakeMinistryRepository implements MinistryRepository {
  List<Ministry> ministries = [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Ministry>> getMyMinistries() async => ministries;

  @override
  Future<Ministry> createMinistry({required String name}) async {
    return Ministry(id: 'min_created_1', name: name, role: 'admin');
  }

  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) async {
    return const JoinMinistryResult(
      message: 'Ingressou com sucesso',
      ministry: Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
      role: 'member',
    );
  }

  @override
  Future<MinistryInvite> createInviteCode(String ministryId, {int expiresInDays = 7}) async {
    return MinistryInvite(
      id: 'inv_1',
      ministryId: ministryId,
      code: 'PR-TEST1',
      expiresAt: DateTime.now().add(const Duration(days: 7)),
    );
  }
}

class FakePreferencesStorage implements PreferencesStorage {
  String? selectedId;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<void> setSelectedMinistryId(String? id) async {
    selectedId = id;
  }

  @override
  String? getSelectedMinistryId() => selectedId;
}

void main() {
  group('M17 Onboarding Presentation & Widgets', () {
    late FakeMinistryRepository fakeRepository;
    late FakePreferencesStorage fakePrefs;
    late FakeAuthNotifier fakeAuthNotifier;

    setUp(() {
      fakeRepository = FakeMinistryRepository();
      fakePrefs = FakePreferencesStorage();
      fakeAuthNotifier = FakeAuthNotifier();
    });

    Widget createTestApp({
      required Widget child,
      List<Override> overrides = const [],
    }) {
      return ProviderScope(
        overrides: [
          ministryRepositoryProvider.overrideWithValue(fakeRepository),
          preferencesStorageProvider.overrideWithValue(fakePrefs),
          authNotifierProvider.overrideWith((ref) => fakeAuthNotifier),
          ...overrides,
        ],
        child: MaterialApp(
          home: Scaffold(body: child),
        ),
      );
    }

    testWidgets('MinistryEmptyScreen renders primary CTAs and opens sheets', (tester) async {
      await tester.pumpWidget(
        createTestApp(
          child: const MinistryEmptyScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // Verifies title and description
      expect(find.text('Nenhum ministério vinculado'), findsOneWidget);
      expect(find.byKey(const ValueKey('empty_screen_create_ministry_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('empty_screen_join_ministry_button')), findsOneWidget);
      expect(find.text('Criar ministério'), findsOneWidget);
      expect(find.text('Entrar com código de convite'), findsOneWidget);

      // Tap "Criar ministério" opens CreateMinistrySheet
      await tester.tap(find.byKey(const ValueKey('empty_screen_create_ministry_button')));
      await tester.pumpAndSettle();

      expect(find.byType(CreateMinistrySheet), findsOneWidget);
      expect(find.text('Criar Novo Ministério'), findsOneWidget);

      // Close modal
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      // Tap "Entrar com código de convite" opens JoinMinistrySheet
      await tester.tap(find.byKey(const ValueKey('empty_screen_join_ministry_button')));
      await tester.pumpAndSettle();

      expect(find.byType(JoinMinistrySheet), findsOneWidget);
      expect(find.text('Entrar no Ministério'), findsOneWidget);
    });

    testWidgets('CreateMinistrySheet renders form, validates, and submits successfully', (tester) async {
      fakeRepository.ministries = [
        const Ministry(id: 'min_created_1', name: 'Ministério Central', role: 'admin'),
      ];

      await tester.pumpWidget(
        createTestApp(
          child: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => CreateMinistrySheet.show(context),
              child: const Text('Open'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byType(CreateMinistrySheet), findsOneWidget);

      // Enter empty name and submit -> shows validation error
      await tester.tap(find.byKey(const ValueKey('submit_create_ministry_button')));
      await tester.pumpAndSettle();

      expect(find.text('Nome do ministério é obrigatório.'), findsOneWidget);

      // Enter valid name
      await tester.enterText(find.byType(TextFormField), 'Ministério Central');
      await tester.pumpAndSettle();

      // Submit valid form
      await tester.tap(find.byKey(const ValueKey('submit_create_ministry_button')));
      await tester.pumpAndSettle();

      // Sheet pops on success
      expect(find.byType(CreateMinistrySheet), findsNothing);
    });

    testWidgets('JoinMinistrySheet validates input and handles submission', (tester) async {
      fakeRepository.ministries = [
        const Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
      ];

      await tester.pumpWidget(
        createTestApp(
          child: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => JoinMinistrySheet.show(context),
              child: const Text('Open'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byType(JoinMinistrySheet), findsOneWidget);

      // Submit empty
      await tester.tap(find.byKey(const ValueKey('submit_join_ministry_button')));
      await tester.pumpAndSettle();

      expect(find.text('Código de convite é obrigatório.'), findsOneWidget);

      // Enter code
      await tester.enterText(find.byType(TextFormField), 'pr-ab12cd');
      await tester.pumpAndSettle();

      // Submit
      await tester.tap(find.byKey(const ValueKey('submit_join_ministry_button')));
      await tester.pumpAndSettle();

      expect(find.byType(JoinMinistrySheet), findsNothing);
    });

    testWidgets('MinistrySwitcherSheet renders action tiles and opens sheets', (tester) async {
      fakeRepository.ministries = [
        const Ministry(id: 'min_1', name: 'Ministério Alfa', role: 'admin'),
        const Ministry(id: 'min_2', name: 'Ministério Beta', role: 'member'),
      ];

      await tester.pumpWidget(
        createTestApp(
          child: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => MinistrySwitcherSheet.show(context),
              child: const Text('Open Switcher'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open Switcher'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('switcher_create_ministry_tile')), findsOneWidget);
      expect(find.byKey(const ValueKey('switcher_join_ministry_tile')), findsOneWidget);
      expect(find.text('Criar novo ministério'), findsOneWidget);
      expect(find.text('Entrar com código'), findsOneWidget);

      // Tap create tile opens CreateMinistrySheet
      await tester.tap(find.byKey(const ValueKey('switcher_create_ministry_tile')));
      await tester.pumpAndSettle();

      expect(find.byType(CreateMinistrySheet), findsOneWidget);
    });

    testWidgets('InviteCodeSheet displays generated code and copies to clipboard', (tester) async {
      String? copiedText;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (MethodCall methodCall) async {
          if (methodCall.method == 'Clipboard.setData') {
            copiedText = (methodCall.arguments as Map?)?['text'] as String?;
            return null;
          }
          return null;
        },
      );

      await tester.pumpWidget(
        createTestApp(
          child: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () => InviteCodeSheet.show(
                  context: context,
                  ministryId: 'min_alpha',
                  ministryName: 'Ministério Alfa',
                ),
                child: const Text('Open Invite'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Open Invite'));
      await tester.pumpAndSettle();

      expect(find.byType(InviteCodeSheet), findsOneWidget);
      expect(find.text('PR-TEST1'), findsOneWidget);
      expect(find.byKey(const ValueKey('copy_invite_code_button')), findsOneWidget);
      expect(find.text('Copiar Código'), findsOneWidget);

      // Tap copy
      await tester.tap(find.byKey(const ValueKey('copy_invite_code_button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Copiado!'), findsOneWidget);
      expect(copiedText, 'PR-TEST1');

      // Settle the delayed timer
      await tester.pump(const Duration(seconds: 3));
    });
  });
}