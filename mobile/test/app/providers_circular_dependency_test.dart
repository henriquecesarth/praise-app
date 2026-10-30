import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}
class _MockUser extends Mock implements User {}
class _MockUserCredential extends Mock implements UserCredential {}

class _MockHttpAdapter implements HttpClientAdapter {
  final Map<String, dynamic> Function(RequestOptions options) onGet;

  _MockHttpAdapter({required this.onGet});

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.method == 'GET') {
      final data = onGet(options);
      return ResponseBody.fromString(
        jsonEncode(data),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    return ResponseBody.fromString('{}', 200);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  test('Direct test: apiClient tokenProvider and onAuthenticationFailed without cycle', () async {
    final auth = _MockFirebaseAuth();
    final user = _MockUser();
    final preferences = InMemoryPreferencesStorage();

    when(() => auth.currentUser).thenReturn(user);
    when(() => user.uid).thenReturn('uid-123');
    when(() => user.getIdToken(any())).thenAnswer((_) async => 'fake-token');
    when(() => auth.authStateChanges()).thenAnswer((_) => Stream.value(user));
    when(() => auth.signOut()).thenAnswer((_) async {});

    final container = ProviderContainer(
      overrides: [
        firebaseAuthProvider.overrideWithValue(auth),
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://127.0.0.1:3107/api/v1',
          ),
        ),
        appLoggerProvider.overrideWithValue(const AppLogger(isDebug: false)),
        preferencesStorageProvider.overrideWithValue(preferences),
      ],
    );

    // Read authRepositoryProvider so that it attaches to apiClientProvider
    final repo = container.read(authRepositoryProvider);
    expect(repo, isA<FirebaseAuthRepository>());

    // Read apiClientProvider
    final api = container.read(apiClientProvider);

    // Initialize providers that watch authNotifierProvider -> authRepositoryProvider
    final createNotifierBefore = container.read(createMinistryNotifierProvider.notifier);
    final joinNotifierBefore = container.read(joinMinistryNotifierProvider.notifier);
    final inviteNotifierBefore = container.read(inviteCodeNotifierProvider.notifier);
    final beforeCreateGen = createNotifierBefore.currentGeneration;
    final beforeJoinGen = joinNotifierBefore.currentGeneration;
    final beforeInviteGen = inviteNotifierBefore.currentGeneration;

    // Find AuthInterceptor
    final interceptor = api.dio.interceptors.whereType<AuthInterceptor>().first;

    // Verify tokenProvider works without throwing CircularDependencyError
    expect(interceptor.tokenProvider, isNotNull);
    final token = await interceptor.tokenProvider?.call();
    expect(token, 'fake-token');

    // Verify onAuthenticationFailed resets dependent onboarding/invite controllers without CircularDependencyError
    expect(interceptor.onAuthenticationFailed, isNotNull);
    await interceptor.onAuthenticationFailed?.call();
    expect(createNotifierBefore.currentGeneration, greaterThan(beforeCreateGen));
    expect(joinNotifierBefore.currentGeneration, greaterThan(beforeJoinGen));
    expect(inviteNotifierBefore.currentGeneration, greaterThan(beforeInviteGen));
  });

  test('Lifecycle: repository disposal invalidates captured sessionContextProvider and guards against stale callback clobbering', () async {
    final auth = _MockFirebaseAuth();
    final user = _MockUser();
    final preferences = InMemoryPreferencesStorage();

    when(() => auth.currentUser).thenReturn(user);
    when(() => user.uid).thenReturn('uid-lifecycle');
    when(() => user.getIdToken(any())).thenAnswer((_) async => 'token-lifecycle');
    when(() => auth.authStateChanges()).thenAnswer((_) => Stream.value(user));
    when(() => auth.signOut()).thenAnswer((_) async {});

    final api = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://127.0.0.1:3107/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    final repo1 = FirebaseAuthRepository(
      firebaseAuth: auth,
      apiClient: api,
      preferencesStorage: preferences,
    );

    final capturedSessionProvider = api.sessionContextProvider;
    expect(capturedSessionProvider, isNotNull);
    expect(capturedSessionProvider!()?.userId, 'uid-lifecycle');

    // Attach a second repository to the same ApiClient before disposing repo1
    final repo2 = FirebaseAuthRepository(
      firebaseAuth: auth,
      apiClient: api,
      preferencesStorage: preferences,
    );
    final repo2SessionProvider = api.sessionContextProvider;

    // Disposing repo1 must immediately invalidate its captured session closure
    // AND must NOT clobber repo2's active sessionContextProvider on api
    repo1.dispose();
    expect(capturedSessionProvider(), isNull);
    expect(repo1.currentSessionContext, isNull);
    expect(identical(api.sessionContextProvider, repo2SessionProvider), isTrue);
    expect(api.sessionContextProvider!()?.userId, 'uid-lifecycle');

    repo2.dispose();
    expect(api.sessionContextProvider, isNull);
  });

  testWidgets('Regression: Share/Login bootstrap completes /auth/me without CircularDependencyError', (tester) async {
    final auth = _MockFirebaseAuth();
    final user = _MockUser();
    final preferences = InMemoryPreferencesStorage();

    when(() => auth.currentUser).thenReturn(null);
    when(() => auth.authStateChanges()).thenAnswer((_) => Stream.value(null));
    when(() => auth.signOut()).thenAnswer((_) async {});

    final container = ProviderContainer(
      overrides: [
        firebaseAuthProvider.overrideWithValue(auth),
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://127.0.0.1:3107/api/v1',
          ),
        ),
        appLoggerProvider.overrideWithValue(const AppLogger(isDebug: false)),
        preferencesStorageProvider.overrideWithValue(preferences),
      ],
    );

    // Mock backend responses on Dio adapter
    final api = container.read(apiClientProvider);
    api.dio.httpClientAdapter = _MockHttpAdapter(onGet: (options) {
      if (options.path.contains('/auth/me')) {
        return {
          'id': 'uid-123',
          'name': 'Test User',
          'email': 'test@example.com',
          'chord_font_family': 'RobotoMono',
        };
      }
      return {};
    });

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const LouvAioApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);

    // Simulate native login
    when(() => auth.signInWithEmailAndPassword(
      email: any(named: 'email'),
      password: any(named: 'password'),
    )).thenAnswer((_) async {
      when(() => auth.currentUser).thenReturn(user);
      when(() => user.uid).thenReturn('uid-123');
      when(() => user.getIdToken(any())).thenAnswer((_) async => 'fake-token');
      final cred = _MockUserCredential();
      when(() => cred.user).thenReturn(user);
      return cred;
    });

    await tester.runAsync(() async {
      await container.read(authNotifierProvider.notifier).login(
        email: 'test@example.com',
        password: 'password123',
      );
    });

    // Verify authenticated state reached cleanly without CircularDependencyError
    expect(container.read(authNotifierProvider).isAuthenticated, isTrue);
    expect(container.read(authNotifierProvider).user?.id, 'uid-123');
    expect(container.read(authNotifierProvider).hasBootstrapError, isFalse);
  });
}
