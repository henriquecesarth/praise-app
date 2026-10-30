import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';

class _Auth extends Mock implements FirebaseAuth {}

class _User extends Mock implements User {}

class _Credential extends Mock implements UserCredential {}

class _Preferences extends Mock
    implements PreferencesStorage, UserChordFontPreferencesStorage {}

class _Adapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions) respond;
  _Adapter(this.respond);
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) => respond(options);
  @override
  void close({bool force = false}) {}
}

class _Attempt {
  final started = Completer<void>();
  final result = Completer<UserCredential>();
}

/// Models the SDK's independent native identity mutation, not just returned
/// credentials. In particular, finish() may restore currentUser after logout.
class _Fixture {
  final auth = _Auth();
  final preferences = _Preferences();
  final events = StreamController<User?>.broadcast(sync: true);
  final attempts = <String, _Attempt>{'a': _Attempt(), 'b': _Attempt()};
  final users = <String, _User>{'a': _User(), 'b': _User()};
  final nativeCalls = <String>[];
  final cachedUsers = <String>[];
  User? nativeUser;
  Future<void> Function()? beforeMe;
  Future<void> Function()? beforeSignup;
  int meRequests = 0;
  int meStatus = 200;
  Future<String?> Function(bool)? getToken;
  late final ApiClient client;
  late final FirebaseAuthRepository repository;
  late final AuthNotifier notifier;

  _Fixture({Future<void> Function()? beforeLogout}) {
    for (final entry in users.entries) {
      when(() => entry.value.uid).thenReturn(entry.key);
      when(
        () => entry.value.getIdToken(any()),
      ).thenAnswer((invocation) async => getToken != null
          ? getToken!(invocation.positionalArguments.first as bool)
          : 'local-test-token-${entry.key}');
    }
    when(() => auth.currentUser).thenAnswer((_) => nativeUser);
    when(() => auth.authStateChanges()).thenAnswer((_) => events.stream);
    when(
      () => auth.signInWithEmailAndPassword(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    ).thenAnswer((invocation) {
      final key = (invocation.namedArguments[#email] as String)
          .split('@')
          .first;
      nativeCalls.add('login:$key');
      attempts[key]!.started.complete();
      return attempts[key]!.result.future;
    });
    when(() => auth.signOut()).thenAnswer((_) async {
      nativeCalls.add('logout');
      nativeUser = null;
      events.add(null);
    });
    when(() => preferences.clear()).thenAnswer((_) async {});
    when(() => preferences.setUserChordFontFamily(any(), any())).thenAnswer((
      invocation,
    ) async {
      cachedUsers.add(invocation.positionalArguments.first as String);
    });
    client = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
      tokenProvider: ({bool forceRefresh = false}) =>
          repository.getIdToken(forceRefresh: forceRefresh),
      onAuthenticationFailed: () => repository.signOut(),
    );
    client.dio.httpClientAdapter = _Adapter((options) async {
      if (options.path == '/auth/signup') {
        await beforeSignup?.call();
        return _json({'ok': true});
      }
      final uid = nativeUser?.uid;
      ++meRequests;
      await beforeMe?.call();
      if (meStatus == 401) {
        return ResponseBody.fromString('{"error":{"message":"Unauthorized"}}', 401,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
      }
      return _json({
        'id': uid,
        'email': '$uid@example.test',
        'name': 'User $uid',
      });
    });
    repository = FirebaseAuthRepository(
      firebaseAuth: auth,
      apiClient: client,
      preferencesStorage: preferences,
    );
    notifier = AuthNotifier(repository, onBeforeSignOut: beforeLogout);
  }

  static ResponseBody _json(Map<String, dynamic> value) =>
      ResponseBody.fromString(
        jsonEncode(value),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
  Future<void> login(String key) => notifier.login(
    email: '$key@example.test',
    password: 'local-only-password',
  );
  Future<void> signup() => notifier.signup(
    name: 'User A',
    email: 'a@example.test',
    password: 'local-only-password',
  );
  Future<void> started(String key) =>
      attempts[key]!.started.future.timeout(const Duration(seconds: 2));
  void finish(String key, {bool emit = true}) {
    nativeUser = users[key];
    if (emit) events.add(nativeUser);
    final credential = _Credential();
    when(() => credential.user).thenReturn(nativeUser);
    attempts[key]!.result.complete(credential);
  }

  Future<void> dispose() async {
    notifier.dispose();
    repository.dispose();
    await events.close();
    client.dio.close(force: true);
  }
}

void main() {
  group('M20-C7 production repository/controller/interceptor races', () {
    test(
      'logout while native login pending removes late Firebase identity and app session',
      () async {
        final f = _Fixture();
        final login = f.login('a');
        await f.started('a');
        final logout = f.notifier.logout();
        expect(f.repository.currentFirebaseUser, isNull);
        f.finish('a');
        await Future.wait([login, logout]);
        expect(f.nativeUser, isNull);
        expect(f.notifier.state.isUnauthenticated, isTrue);
        expect(f.meRequests, 0);
        expect(await f.repository.getIdToken(), isNull);
        await f.dispose();
      },
    );

    for (final signupPhase in ['provisioning', 'native', 'profile']) {
      test(
        'logout during signup $signupPhase cannot restore SDK or app identity',
        () async {
          final f = _Fixture();
          final gate = Completer<void>();
          final reached = Completer<void>();
          if (signupPhase == 'provisioning') {
            f.beforeSignup = () {
              reached.complete();
              return gate.future;
            };
          } else if (signupPhase == 'profile') {
            f.beforeMe = () {
              reached.complete();
              return gate.future;
            };
          }
          final signup = f.signup();
          if (signupPhase == 'provisioning') {
            await reached.future;
          } else {
            await f.started('a');
            if (signupPhase == 'profile') {
              f.finish('a');
              await reached.future;
            }
          }
          final logout = f.notifier.logout();
          if (signupPhase == 'native') {
            f.finish('a');
          } else {
            gate.complete();
          }
          await Future.wait([signup, logout]);
          expect(f.nativeUser, isNull);
          expect(f.notifier.state.isUnauthenticated, isTrue);
          expect(f.cachedUsers, isEmpty);
          if (signupPhase == 'provisioning') expect(f.nativeCalls, ['logout']);
          await f.dispose();
        },
      );
    }

    test(
      'logout with HTTP200 profile pending discards response and preference cache',
      () async {
        final f = _Fixture();
        final gate = Completer<void>();
        final reached = Completer<void>();
        f.beforeMe = () {
          reached.complete();
          return gate.future;
        };
        final login = f.login('a');
        await f.started('a');
        f.finish('a');
        await reached.future;
        await f.notifier.logout();
        gate.complete();
        await login;
        expect(f.notifier.state.isUnauthenticated, isTrue);
        expect(f.nativeUser, isNull);
        expect(f.cachedUsers, isEmpty);
        await f.dispose();
      },
    );

    test(
      'concurrent native logins serialize and latest intent B wins despite late A completion',
      () async {
        final f = _Fixture();
        final a = f.login('a');
        await f.started('a');
        final b = f.login('b');
        expect(f.nativeCalls, ['login:a']);
        f.finish('a');
        await f.started('b');
        expect(f.nativeCalls, ['login:a', 'logout', 'login:b']);
        f.finish('b');
        await Future.wait([a, b]);
        expect(f.nativeUser?.uid, 'b');
        expect(f.notifier.state.user?.id, 'b');
        expect(f.cachedUsers, ['b']);
        await f.dispose();
      },
    );

    test(
      'login B replaces A while A HTTP200 is pending; A cannot override B or cache',
      () async {
        final f = _Fixture();
        final gate = Completer<void>();
        final reached = Completer<void>();
        f.beforeMe = () {
          if (!reached.isCompleted) {
            reached.complete();
            return gate.future;
          }
          return Future<void>.value();
        };
        final a = f.login('a');
        await f.started('a');
        f.finish('a');
        await reached.future;
        final b = f.login('b');
        await f.started('b');
        f.finish('b');
        await b;
        gate.complete();
        await a;
        expect(f.notifier.state.user?.id, 'b');
        expect(f.nativeUser?.uid, 'b');
        expect(f.cachedUsers, ['b']);
        await f.dispose();
      },
    );

    test('logout push cleanup cannot sign out a newer login B', () async {
      final cleanup = Completer<void>();
      final f = _Fixture(beforeLogout: () => cleanup.future);
      final a = f.login('a');
      await f.started('a');
      final logout = f.notifier.logout();
      final b = f.login('b');
      f.finish('a');
      await f.started('b');
      f.finish('b');
      await b;
      cleanup.complete();
      await Future.wait([a, logout]);
      expect(f.nativeUser?.uid, 'b');
      expect(f.notifier.state.user?.id, 'b');
      expect(f.nativeCalls, ['login:a', 'logout', 'login:b']);
      await f.dispose();
    });

    test(
      'queued logout superseded by B cannot invalidate or sign out B',
      () async {
        final f = _Fixture();
        final a = f.login('a');
        await f.started('a');
        final logout = f.notifier.logout();
        final b = f.login('b');
        f.finish('a');
        await f.started('b');
        f.finish('b');
        await Future.wait([a, logout, b]);
        expect(f.nativeUser?.uid, 'b');
        expect(f.notifier.state.user?.id, 'b');
        expect(f.nativeCalls, ['login:a', 'logout', 'login:b']);
        await f.dispose();
      },
    );

    test(
      'delayed A and null stream events after B success cannot invalidate B',
      () async {
        final f = _Fixture();
        final a = f.login('a');
        await f.started('a');
        f.finish('a');
        await a;
        final b = f.login('b');
        await f.started('b');
        f.finish('b');
        await b;
        final context = f.repository.currentSessionContext;
        final requests = f.meRequests;
        f.events.add(f.users['a']);
        f.events.add(null);
        await Future<void>.delayed(Duration.zero);
        expect(f.repository.currentSessionContext, context);
        expect(f.notifier.state.user?.id, 'b');
        expect(f.meRequests, requests);
        await f.dispose();
      },
    );

    test(
      'logout invalidates completed native login while push cleanup and profile pending',
      () async {
        final cleanup = Completer<void>();
        final profile = Completer<void>();
        final reached = Completer<void>();
        final f = _Fixture(beforeLogout: () => cleanup.future);
        f.beforeMe = () {
          reached.complete();
          return profile.future;
        };
        final login = f.login('a');
        await f.started('a');
        f.finish('a');
        await reached.future;
        final logout = f.notifier.logout();
        expect(f.repository.currentSessionContext, isNull);
        expect(await f.repository.getIdToken(), isNull);
        profile.complete();
        await login;
        expect(f.cachedUsers, isEmpty);
        expect(f.notifier.state.isUnauthenticated, isTrue);
        cleanup.complete();
        await logout;
        expect(f.nativeUser, isNull);
        await f.dispose();
      },
    );

    test('account changes during forced refresh: SESSION_CHANGED recovers B without logout', () async {
      final f = _Fixture();
      final refreshing = Completer<void>();
      final release = Completer<String?>();
      f.meStatus = 401;
      f.getToken = (force) {
        if (force) { refreshing.complete(); return release.future; }
        return Future.value('local-token');
      };
      final login = f.login('a'); await f.started('a'); f.finish('a');
      await refreshing.future.timeout(const Duration(seconds: 2));
      f.nativeUser = f.users['b'];
      f.events.add(f.nativeUser);
      f.meStatus = 200;
      release.complete('obsolete-a-token');
      await login.timeout(const Duration(seconds: 2));
      expect(f.nativeUser?.uid, 'b');
      expect(f.notifier.state.user?.id, 'b');
      expect(f.notifier.state.hasBootstrapError, isFalse);
      expect(f.nativeCalls, ['login:a']);
      expect(f.meRequests, 2);
      await f.dispose();
    });

    test('signup profile 401 and retry401 can sign out without native queue deadlock', () async {
      final f = _Fixture();
      f.meStatus = 401;
      final signup = f.signup();
      await f.started('a'); f.finish('a');
      await signup.timeout(const Duration(seconds: 2));
      expect(f.nativeUser, isNull);
      expect(f.notifier.state.user, isNull);
      expect(f.notifier.state.isAuthenticated, isFalse);
      expect(f.notifier.state.isAuthenticating, isFalse);
      expect(f.meRequests, 2);
      await f.dispose();
    });

    for (final streamBeforeFuture in [true, false]) {
      test(
        'one generation per legitimate login, stream before Future=$streamBeforeFuture',
        () async {
          final f = _Fixture();
          final a = f.login('a');
          await f.started('a');
          f.finish('a', emit: streamBeforeFuture);
          await a;
          final first = f.repository.currentSessionContext!;
          expect(first.sessionGeneration, 2); // initial generation 1, login +1
          if (!streamBeforeFuture) f.events.add(f.nativeUser);
          await Future<void>.delayed(Duration.zero);
          expect(f.repository.currentSessionContext, first);
          final b = f.login('b');
          await f.started('b');
          f.finish('b', emit: streamBeforeFuture);
          await b;
          final second = f.repository.currentSessionContext!;
          expect(second.sessionGeneration, first.sessionGeneration + 1);
          if (!streamBeforeFuture) f.events.add(f.nativeUser);
          await Future<void>.delayed(Duration.zero);
          expect(f.repository.currentSessionContext, second);
          expect(f.notifier.state.user?.id, 'b');
          await f.dispose();
        },
      );
    }
  });
}
