import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

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

      notifier.dispose();
    });
  });
}
