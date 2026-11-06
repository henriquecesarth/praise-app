import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';

class _AuthRepository implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword(
          {required String email, required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp(
          {required String name,
          required String email,
          required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _AuthNotifier extends AuthNotifier {
  _AuthNotifier() : super(_AuthRepository());

  void setUser(String? id) {
    state = id == null
        ? const AuthState.unauthenticated()
        : AuthState.authenticated(
            AuthUser(id: id, email: '$id@louvaio.test', name: id),
          );
  }
}

class _MinistryRepository implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => const [
        Ministry(id: 'min-shared', name: 'Ministério compartilhado'),
        Ministry(id: 'min-other', name: 'Outro ministério'),
      ];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('router preserves initial user selection and isolates a later account',
      () async {
    final storage = InMemoryPreferencesStorage();
    await storage.setSelectedMinistryIdForUser('user-a', 'min-other');
    final auth = _AuthNotifier();
    final container = ProviderContainer(overrides: [
      authNotifierProvider.overrideWith((ref) => auth),
      preferencesStorageProvider.overrideWithValue(storage),
      ministryRepositoryProvider.overrideWithValue(_MinistryRepository()),
    ]);
    addTearDown(container.dispose);

    container.read(routerProvider); // Installs the real auth/router listener.
    auth.setUser('user-a');
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(ministryContextNotifierProvider).selectedMinistry?.id,
        'min-other');

    auth.setUser('user-b');
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    final ministry = container.read(ministryContextNotifierProvider);
    expect(ministry.needsSelection, isTrue);
    expect(ministry.selectedMinistry, isNull);
    expect(storage.getSelectedMinistryIdForUser('user-b'), isNull);
  });
}
