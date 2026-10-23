import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';

class MockAuthRepository extends Mock
    implements AuthRepository, ChordFontPreferenceUpdater {}

class MockUser extends Mock implements User {}

class MockUserCredential extends Mock implements UserCredential {}

void main() {
  late MockAuthRepository mockRepository;
  late StreamController<User?> authStateStreamController;

  const testUser = AuthUser(
    id: 'usr_test_123',
    email: 'test@louvaio.com',
    name: 'Henrique Hermogenes',
  );

  setUp(() {
    mockRepository = MockAuthRepository();
    authStateStreamController = StreamController<User?>.broadcast();
    when(() => mockRepository.authStateChanges())
        .thenAnswer((_) => authStateStreamController.stream);
  });

  tearDown(() {
    authStateStreamController.close();
  });

  group('AuthNotifier', () {
    test(
        'initial state is initializing, transitions to unauthenticated on null user',
        () async {
      final notifier = AuthNotifier(mockRepository);

      expect(notifier.state.status, AuthStatus.initializing);

      authStateStreamController.add(null);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.status, AuthStatus.unauthenticated);
      expect(notifier.state.user, isNull);

      notifier.dispose();
    });

    test(
        'transitions to authenticated when authStateChanges emits user and getMe succeeds',
        () async {
      final mockUser = MockUser();
      when(() => mockRepository.getMe()).thenAnswer((_) async => testUser);

      final notifier = AuthNotifier(mockRepository);

      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.status, AuthStatus.authenticated);
      expect(notifier.state.user, testUser);

      notifier.dispose();
    });

    test('login succeeds and updates state to authenticated', () async {
      final mockCred = MockUserCredential();
      when(() => mockRepository.signInWithEmailAndPassword(
            email: 'test@louvaio.com',
            password: 'secretPassword123',
          )).thenAnswer((_) async => mockCred);
      when(() => mockRepository.getMe()).thenAnswer((_) async => testUser);

      final notifier = AuthNotifier(mockRepository);

      await notifier.login(
        email: 'test@louvaio.com',
        password: 'secretPassword123',
      );

      expect(notifier.state.status, AuthStatus.authenticated);
      expect(notifier.state.user, testUser);

      notifier.dispose();
    });

    test('login failure transitions state to error and rethrows', () async {
      when(() => mockRepository.signInWithEmailAndPassword(
                email: 'test@louvaio.com',
                password: 'wrongPassword',
              ))
          .thenThrow(
              const AppFailure(message: 'Senha incorreta', statusCode: 401));

      final notifier = AuthNotifier(mockRepository);

      await expectLater(
        notifier.login(
          email: 'test@louvaio.com',
          password: 'wrongPassword',
        ),
        throwsA(isA<AppFailure>()),
      );

      expect(notifier.state.status, AuthStatus.error);
      expect(notifier.state.failure?.message, 'Senha incorreta');

      notifier.dispose();
    });

    test('signup succeeds and updates state to authenticated', () async {
      when(() => mockRepository.signUp(
            name: 'Henrique',
            email: 'test@louvaio.com',
            password: 'secretPassword123',
          )).thenAnswer((_) async => testUser);

      final notifier = AuthNotifier(mockRepository);

      await notifier.signup(
        name: 'Henrique',
        email: 'test@louvaio.com',
        password: 'secretPassword123',
      );

      expect(notifier.state.status, AuthStatus.authenticated);
      expect(notifier.state.user, testUser);

      notifier.dispose();
    });

    test('logout succeeds and transitions to unauthenticated', () async {
      when(() => mockRepository.signOut()).thenAnswer((_) async {});

      final notifier = AuthNotifier(mockRepository);

      await notifier.logout();

      expect(notifier.state.status, AuthStatus.unauthenticated);
      expect(notifier.state.user, isNull);
      expect(notifier.state.chordFontFamily, 'monospace');

      notifier.dispose();
    });

    test('initial unauthenticated state has default monospace chord font', () {
      final notifier = AuthNotifier(mockRepository);

      expect(notifier.state.chordFontFamily, 'monospace');

      notifier.dispose();
    });

    test('authenticated state reflects user chord font preference', () async {
      const userWithFont = AuthUser(
        id: 'usr_georgia',
        email: 'georgia@louvaio.com',
        name: 'Georgia User',
        chordFontFamily: 'Georgia',
      );
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_georgia');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);
      when(() => mockRepository.getMe()).thenAnswer((_) async => userWithFont);

      final notifier = AuthNotifier(mockRepository);

      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.chordFontFamily, 'Georgia');

      notifier.dispose();
    });

    test('updateChordFontPreference updates state with confirmed font', () async {
      const initialUser = AuthUser(
        id: 'usr_1',
        email: 'user@louvaio.com',
        name: 'User One',
        chordFontFamily: 'monospace',
      );
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_1');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);
      when(() => mockRepository.getMe()).thenAnswer((_) async => initialUser);
      when(() => mockRepository.updateChordFontPreference(chordFontFamily: 'Arial'))
          .thenAnswer((_) async => 'Arial');

      final notifier = AuthNotifier(mockRepository);

      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.chordFontFamily, 'monospace');

      await notifier.updateChordFontPreference('Arial');

      expect(notifier.state.chordFontFamily, 'Arial');
      expect(notifier.state.user?.chordFontFamily, 'Arial');

      notifier.dispose();
    });

    test('updateChordFontPreference error rethrows and preserves previous state', () async {
      const initialUser = AuthUser(
        id: 'usr_1',
        email: 'user@louvaio.com',
        name: 'User One',
        chordFontFamily: 'Georgia',
      );
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_1');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);
      when(() => mockRepository.getMe()).thenAnswer((_) async => initialUser);
      when(() => mockRepository.updateChordFontPreference(chordFontFamily: 'Verdana'))
          .thenThrow(const AppFailure(message: 'Falha de rede', statusCode: 500));

      final notifier = AuthNotifier(mockRepository);

      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      await expectLater(
        notifier.updateChordFontPreference('Verdana'),
        throwsA(isA<AppFailure>()),
      );

      // State remains authenticated and font remains unchanged
      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.chordFontFamily, 'Georgia');

      notifier.dispose();
    });

    test('account isolation: switching accounts prevents preference leakage', () async {
      const userA = AuthUser(
        id: 'usr_a',
        email: 'a@louvaio.com',
        name: 'User A',
        chordFontFamily: 'Georgia',
      );
      const userB = AuthUser(
        id: 'usr_b',
        email: 'b@louvaio.com',
        name: 'User B',
        chordFontFamily: 'monospace',
      );

      final mockUserA = MockUser();
      when(() => mockUserA.uid).thenReturn('usr_a');
      final mockUserB = MockUser();
      when(() => mockUserB.uid).thenReturn('usr_b');

      when(() => mockRepository.signOut()).thenAnswer((_) async {});

      final notifier = AuthNotifier(mockRepository);

      // 1. User A logs in with Georgia
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUserA);
      when(() => mockRepository.getMe()).thenAnswer((_) async => userA);
      authStateStreamController.add(mockUserA);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.chordFontFamily, 'Georgia');

      // 2. Logout clears active session
      await notifier.logout();
      expect(notifier.state.isUnauthenticated, isTrue);
      expect(notifier.state.chordFontFamily, 'monospace');

      // 3. User B logs in without preference (default monospace)
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUserB);
      when(() => mockRepository.getMe()).thenAnswer((_) async => userB);
      authStateStreamController.add(mockUserB);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.chordFontFamily, 'monospace');

      // 4. Logout and user A logs back in
      await notifier.logout();
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUserA);
      when(() => mockRepository.getMe()).thenAnswer((_) async => userA);
      authStateStreamController.add(mockUserA);
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.chordFontFamily, 'Georgia');

      notifier.dispose();
    });

    test('stale response fencing: ignores in-flight getMe if user signed out', () async {
      final completer = Completer<AuthUser>();
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_slow');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);
      when(() => mockRepository.getMe()).thenAnswer((_) => completer.future);
      when(() => mockRepository.signOut()).thenAnswer((_) async {});

      final notifier = AuthNotifier(mockRepository);

      // In-flight fetch begins
      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      // User signs out before fetch finishes
      await notifier.logout();
      expect(notifier.state.isUnauthenticated, isTrue);

      // Fetch now finishes
      completer.complete(const AuthUser(
        id: 'usr_slow',
        email: 'slow@louvaio.com',
        name: 'Slow User',
        chordFontFamily: 'Times New Roman',
      ));
      await Future<void>.delayed(Duration.zero);

      // State must remain unauthenticated
      expect(notifier.state.isUnauthenticated, isTrue);
      expect(notifier.state.chordFontFamily, 'monospace');

      notifier.dispose();
    });

    test('stale preference fencing: ignores slow in-flight update if newer update occurred', () async {
      const initialUser = AuthUser(
        id: 'usr_1',
        email: 'user@louvaio.com',
        name: 'User One',
        chordFontFamily: 'monospace',
      );
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_1');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);
      when(() => mockRepository.getMe()).thenAnswer((_) async => initialUser);

      final slowCompleter = Completer<String>();
      when(() => mockRepository.updateChordFontPreference(chordFontFamily: 'Georgia'))
          .thenAnswer((_) => slowCompleter.future);
      when(() => mockRepository.updateChordFontPreference(chordFontFamily: 'Arial'))
          .thenAnswer((_) async => 'Arial');

      final notifier = AuthNotifier(mockRepository);
      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      // Launch slow update to Georgia (does not await yet)
      final future1 = notifier.updateChordFontPreference('Georgia');

      // Launch newer update to Arial which completes immediately
      await notifier.updateChordFontPreference('Arial');
      expect(notifier.state.chordFontFamily, 'Arial');

      // Now slow update to Georgia completes
      slowCompleter.complete('Georgia');
      await future1;

      // State must remain Arial (newer update wins, stale ignored)
      expect(notifier.state.chordFontFamily, 'Arial');

      notifier.dispose();
    });

    test('MOB-01: stale GET cannot overwrite successfully PATCHed newer preference', () async {
      const userWithGeorgia = AuthUser(
        id: 'usr_mob01',
        email: 'mob01@louvaio.com',
        name: 'User MOB01',
        chordFontFamily: 'Georgia',
      );

      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_mob01');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);

      final getMeCompleter = Completer<AuthUser>();
      when(() => mockRepository.getMe()).thenAnswer((_) => getMeCompleter.future);
      when(() => mockRepository.updateChordFontPreference(chordFontFamily: 'Verdana'))
          .thenAnswer((_) async => 'Verdana');

      final notifier = AuthNotifier(mockRepository);

      // 1. Initial auth event triggers slow getMe
      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);

      // 2. Before getMe finishes, user updates preference to Verdana (succeeds)
      notifier.state = const AuthState.authenticated(userWithGeorgia);
      await notifier.updateChordFontPreference('Verdana');
      expect(notifier.state.chordFontFamily, 'Verdana');

      // 3. Stale getMe now finishes with Georgia
      getMeCompleter.complete(userWithGeorgia);
      await Future<void>.delayed(Duration.zero);

      // 4. Must NOT overwrite Verdana with stale Georgia
      expect(notifier.state.chordFontFamily, 'Verdana');

      notifier.dispose();
    });

    test('fresh GET after PATCH successfully loads authoritative saved preference', () async {
      const userA = AuthUser(
        id: 'usr_fresh',
        email: 'fresh@louvaio.com',
        name: 'Fresh User',
        chordFontFamily: 'Georgia',
      );

      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_fresh');
      when(() => mockRepository.currentFirebaseUser).thenReturn(mockUser);
      when(() => mockRepository.getMe()).thenAnswer((_) async => userA);
      when(() => mockRepository.updateChordFontPreference(chordFontFamily: 'Verdana'))
          .thenAnswer((_) async => 'Verdana');

      final notifier = AuthNotifier(mockRepository);
      authStateStreamController.add(mockUser);
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.chordFontFamily, 'Georgia');

      // Update to Verdana
      await notifier.updateChordFontPreference('Verdana');
      expect(notifier.state.chordFontFamily, 'Verdana');

      // Now a fresh GET happens where backend returns Verdana
      const updatedUserA = AuthUser(
        id: 'usr_fresh',
        email: 'fresh@louvaio.com',
        name: 'Fresh User',
        chordFontFamily: 'Verdana',
      );
      when(() => mockRepository.getMe()).thenAnswer((_) async => updatedUserA);
      await notifier.retryBootstrap();

      expect(notifier.state.status, AuthStatus.authenticated);
      expect(notifier.state.chordFontFamily, 'Verdana');

      notifier.dispose();
    });
  });
}
