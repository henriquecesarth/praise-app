import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/auth/presentation/login_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/vocal/presentation/vocal_player_screen.dart';

class _MockAuthRepository implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) => throw UnimplementedError();
  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) => throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _TestAuthNotifier extends AuthNotifier {
  _TestAuthNotifier() : super(_MockAuthRepository());

  void setUnauthenticated() {
    state = const AuthState.unauthenticated();
  }

  void setAuthenticated(String id) {
    state = AuthState.authenticated(
      AuthUser(id: id, email: '$id@louvaio.test', name: 'User $id'),
    );
  }

  void setInitializing() {
    state = const AuthState.initializing();
  }

  void setBootstrapError(String message) {
    state = AuthState.bootstrapError(
      AppFailure.network(message: message),
    );
  }
}

class _MockMinistryRepository implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => const [
    Ministry(id: 'min-1', name: 'Ministério Principal'),
  ];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Vocal Auth Guard & Anonymous Access Restriction', () {
    testWidgets('LoginScreen does not display any offline vocal exercise button', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authNotifierProvider.overrideWith((ref) => _TestAuthNotifier()),
          ],
          child: const MaterialApp(home: LoginScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Exercícios vocais offline'), findsNothing);
      expect(find.textContaining('Exercícios vocais'), findsNothing);
    });

    testWidgets(
      'unauthenticated visitor navigating to /vocal is redirected to /login',
      (tester) async {
        final auth = _TestAuthNotifier()..setUnauthenticated();
        final storage = InMemoryPreferencesStorage();

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _MockMinistryRepository(),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pumpAndSettle();

        // Router is on /login
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(find.byType(VocalPlayerScreen), findsNothing);

        // Attempt direct navigation to /vocal
        final BuildContext context = tester.element(find.byType(LoginScreen));
        final router = ProviderScope.containerOf(context).read(routerProvider);
        router.go('/vocal');
        await tester.pumpAndSettle();

        // Must still be blocked and on LoginScreen, NEVER VocalPlayerScreen
        expect(find.byType(VocalPlayerScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
      },
    );

    testWidgets(
      'during auth initialization, /vocal redirects to secure loading screen',
      (tester) async {
        final auth = _TestAuthNotifier()..setInitializing();
        final storage = InMemoryPreferencesStorage();

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _MockMinistryRepository(),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pump();

        // Loading indicator is shown, vocal screen is NOT exposed
        expect(find.byType(CircularProgressIndicator), findsOneWidget);
        expect(find.byType(VocalPlayerScreen), findsNothing);
      },
    );

    testWidgets(
      'bootstrap error redirects /vocal to secure recovery screen without vocal CTA',
      (tester) async {
        final auth = _TestAuthNotifier()
          ..setBootstrapError('Erro de conexão com o servidor');
        final storage = InMemoryPreferencesStorage();

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _MockMinistryRepository(),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Falha na conexão'), findsOneWidget);
        expect(find.text('Exercícios vocais offline'), findsNothing);
        expect(find.byType(VocalPlayerScreen), findsNothing);

        // Attempt direct navigation to /vocal
        final BuildContext context = tester.element(
          find.text('Falha na conexão'),
        );
        final router = ProviderScope.containerOf(context).read(routerProvider);
        router.go('/vocal');
        await tester.pumpAndSettle();

        expect(find.byType(VocalPlayerScreen), findsNothing);
        expect(find.text('Falha na conexão'), findsOneWidget);
      },
    );

    testWidgets(
      'authenticated user can access /vocal, and logging out redirects immediately to /login',
      (tester) async {
        final auth = _TestAuthNotifier()..setAuthenticated('user-1');
        final storage = InMemoryPreferencesStorage();
        await storage.setSelectedMinistryIdForUser('user-1', 'min-1');

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _MockMinistryRepository(),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pumpAndSettle();

        // Navigate to /vocal as authenticated user
        final BuildContext context = tester.element(find.byType(LouvAioApp));
        final router = ProviderScope.containerOf(context).read(routerProvider);
        router.go('/vocal');
        await tester.pumpAndSettle();

        // Vocal player is successfully displayed
        expect(find.byType(VocalPlayerScreen), findsOneWidget);
        expect(find.text('Aquecimento vocal'), findsOneWidget);

        // Logout occurs while inside /vocal
        auth.setUnauthenticated();
        await tester.pumpAndSettle();

        // VocalPlayerScreen must be immediately evicted, redirecting to LoginScreen
        expect(find.byType(VocalPlayerScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
      },
    );
  });
}
