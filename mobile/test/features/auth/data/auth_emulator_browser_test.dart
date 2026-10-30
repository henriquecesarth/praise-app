@TestOn('browser')
library;

import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
// Browser unit tests do not run the application's generated plugin registrant.
// ignore: depend_on_referenced_packages
import 'package:firebase_core_web/firebase_core_web.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_web/firebase_auth_web.dart';
// ignore: depend_on_referenced_packages
import 'package:flutter_web_plugins/flutter_web_plugins.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';

class _Preferences extends Mock
    implements PreferencesStorage, UserChordFontPreferencesStorage {}

class _Adapter implements HttpClientAdapter {
  final FirebaseAuth auth;
  _Adapter(this.auth);
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path == '/auth/signup') {
      final input = options.data as Map<String, dynamic>;
      await Dio().post<dynamic>(
        'http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-demo-key',
        data: {
          'email': input['email'],
          'password': input['password'],
          'returnSecureToken': true,
        },
      );
      return ResponseBody.fromString(
        '{}',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    final user = auth.currentUser!;
    return ResponseBody.fromString(
      jsonEncode({
        'id': user.uid,
        'email': user.email,
        'name': 'Local Emulator User',
      }),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  const enabled = bool.fromEnvironment('M20_C7_AUTH_EMULATOR');
  final control = Dio(
    BaseOptions(
      baseUrl: 'http://127.0.0.1:19098',
      receiveTimeout: const Duration(seconds: 9),
    ),
  );
  late FirebaseAuth auth;
  const password = 'local-demo-password';
  Future<void> gate(String command) async {
    await control.get<dynamic>('/_control/$command');
  }

  setUpAll(() async {
    if (!enabled) return;
    TestWidgetsFlutterBinding.ensureInitialized();
    FirebaseCoreWeb.registerWith(null);
    FirebaseAuthWeb.registerWith(webPluginRegistrar);
    final app = await Firebase.initializeApp(
      name: 'm20-c7',
      options: const FirebaseOptions(
        apiKey: 'local-demo-key',
        appId: '1:123:web:m20c7',
        messagingSenderId: '123',
        projectId: 'demo-m20-c7',
      ),
    );
    auth = FirebaseAuth.instanceFor(app: app);
    await auth.useAuthEmulator('127.0.0.1', 19098);
    await auth.setPersistence(Persistence.NONE);
    for (final email in ['a@example.test', 'b@example.test']) {
      await auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
    }
    await auth.signOut();
  });

  test(
    'real Firebase SDK late signIn after signOut restores SDK identity (baseline)',
    () async {
      await gate('arm');
      final login = auth.signInWithEmailAndPassword(
        email: 'a@example.test',
        password: password,
      );
      await gate('wait');
      await auth.signOut();
      expect(auth.currentUser, isNull);
      await gate('release');
      await login;
      expect(auth.currentUser?.email, 'a@example.test');
      await auth.signOut();
    },
    skip: !enabled,
    timeout: const Timeout(Duration(seconds: 25)),
  );

  for (final scenario in [
    'login-logout',
    'signup-logout',
    'latest-login',
    'generation',
  ]) {
    test(
      'real Firebase SDK + production auth stack: $scenario',
      () async {
        final preferences = _Preferences();
        when(() => preferences.clear()).thenAnswer((_) async {});
        when(
          () => preferences.setUserChordFontFamily(any(), any()),
        ).thenAnswer((_) async {});
        late FirebaseAuthRepository repository;
        final client = ApiClient(
          environment: const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
          ),
          logger: const AppLogger(isDebug: false),
          tokenProvider: ({bool forceRefresh = false}) =>
              repository.getIdToken(forceRefresh: forceRefresh),
        );
        client.dio.httpClientAdapter = _Adapter(auth);
        repository = FirebaseAuthRepository(
          firebaseAuth: auth,
          apiClient: client,
          preferencesStorage: preferences,
        );
        final notifier = AuthNotifier(repository);
        try {
          await Future<void>.delayed(Duration.zero);
          if (scenario == 'generation') {
            final generations = <int>[];
            final subscription = auth.authStateChanges().listen((user) {
              final context = repository.currentSessionContext;
              if (user != null && context != null) {
                generations.add(context.sessionGeneration);
              }
            });
            await notifier.login(email: 'a@example.test', password: password);
            final first = repository.currentSessionContext!;
            expect(first.sessionGeneration, 2);
            await notifier.login(email: 'b@example.test', password: password);
            expect(repository.currentSessionContext!.sessionGeneration, 3);
            expect(generations.toSet().difference({2, 3}), isEmpty);
            expect(notifier.state.user?.id, auth.currentUser?.uid);
            await subscription.cancel();
          } else {
            await gate('arm');
            final first = scenario == 'signup-logout'
                ? notifier.signup(
                    name: 'Local Signup',
                    email: 'signup@example.test',
                    password: password,
                  )
                : notifier.login(email: 'a@example.test', password: password);
            await gate('wait');
            final second = scenario == 'latest-login'
                ? notifier.login(email: 'b@example.test', password: password)
                : notifier.logout();
            await gate('release');
            await Future.wait([first, second]);
            if (scenario == 'latest-login') {
              expect(auth.currentUser?.email, 'b@example.test');
              expect(notifier.state.user?.id, auth.currentUser?.uid);
            } else {
              expect(auth.currentUser, isNull);
              expect(repository.currentSessionContext, isNull);
              expect(notifier.state.isUnauthenticated, isTrue);
            }
            expect(notifier.state.hasBootstrapError, isFalse);
          }
        } finally {
          notifier.dispose();
          await repository.signOut();
          repository.dispose();
          client.dio.close(force: true);
        }
      },
      skip: !enabled,
      timeout: const Timeout(Duration(seconds: 25)),
    );
  }
}
