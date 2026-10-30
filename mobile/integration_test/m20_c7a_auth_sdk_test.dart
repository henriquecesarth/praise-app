import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';

class _Preferences extends Mock
    implements PreferencesStorage, UserChordFontPreferencesStorage {}

String? _uidFromIdToken(String? token) {
  if (token == null) return null;
  final claims = jsonDecode(
    utf8.decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))),
  );
  return claims is Map<String, dynamic> ? claims['sub'] as String? : null;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('M20-C7A Firebase Android SDK session fencing', (tester) async {
    late FirebaseAuth firebaseAuth;
    late FirebaseAuthRepository repository;
    late ApiClient api;
    late AuthNotifier notifier;
    final outbound = <({String? uid, String? boundUid, int? generation})>[];
    final backendProfileUids = <String?>[];
    var interceptorSessionChangedErrors = 0;
    var authFailureCallbackCount = 0;
    var injectCancellationOnce = false;
    var injectedCancellationCount = 0;
    final control = Dio(
      BaseOptions(
        baseUrl: 'http://127.0.0.1:19098',
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 20),
      ),
    );

    await tester.runAsync(() async {
      final app = await Firebase.initializeApp(
        name: 'm20-c7a-auth-sdk',
        options: const FirebaseOptions(
          apiKey: 'local-only-emulator-key',
          appId: '1:123456789:android:0123456789abcdef',
          messagingSenderId: '123456789',
          projectId: 'demo-m20-c1',
        ),
      );
      firebaseAuth = FirebaseAuth.instanceFor(app: app);
      await firebaseAuth.useAuthEmulator(
        '127.0.0.1',
        19098,
        automaticHostMapping: false,
      );
      await firebaseAuth.signOut();

      final preferences = _Preferences();
      when(() => preferences.clear()).thenAnswer((_) async {});
      when(
        () => preferences.setUserChordFontFamily(any(), any()),
      ).thenAnswer((_) async {});
      api = ApiClient(
        environment: const AppEnvironment(
          env: AppEnv.development,
          apiBaseUrl: 'http://127.0.0.1:19098/api/v1',
        ),
        logger: const AppLogger(isDebug: false),
        tokenProvider: ({bool forceRefresh = false}) =>
            repository.getIdToken(forceRefresh: forceRefresh),
        onAuthenticationFailed: () async {
          authFailureCallbackCount++;
          await repository.signOut();
        },
      );
      repository = FirebaseAuthRepository(
        firebaseAuth: firebaseAuth,
        apiClient: api,
        preferencesStorage: preferences,
      );
      api.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            if (options.path == '/auth/me') {
              final header = options.headers['Authorization']?.toString();
              outbound.add((
                uid: header?.startsWith('Bearer ') == true
                    ? _uidFromIdToken(header!.substring(7))
                    : null,
                boundUid:
                    options.extra[AuthInterceptor.sessionUserIdKey] as String?,
                generation:
                    options.extra[AuthInterceptor.sessionGenerationKey] as int?,
              ));
            }
            handler.next(options);
          },
          onResponse: (response, handler) {
            final data = response.data;
            if (response.requestOptions.path == '/auth/me' && data is Map) {
              backendProfileUids.add(data['id'] as String?);
            }
            handler.next(response);
          },
          onError: (error, handler) {
            if (error.error is AppFailure &&
                (error.error as AppFailure).code == 'SESSION_CHANGED') {
              interceptorSessionChangedErrors++;
            }
            handler.next(error);
          },
        ),
      );
      api.dio.interceptors.add(
        InterceptorsWrapper(
          onResponse: (response, handler) {
            if (injectCancellationOnce &&
                response.requestOptions.path == '/auth/me') {
              injectCancellationOnce = false;
              injectedCancellationCount++;
              return handler.reject(
                DioException(
                  requestOptions: response.requestOptions,
                  type: DioExceptionType.cancel,
                  error: const AppFailure(
                    message:
                        'Controlled transport SESSION_CHANGED cancellation',
                    statusCode: 401,
                    code: 'SESSION_CHANGED',
                  ),
                ),
              );
            }
            handler.next(response);
          },
        ),
      );
      notifier = AuthNotifier(repository);

      Future<Map<String, dynamic>> provision(String tag) async {
        final email =
            'm20-c7a-$tag-${DateTime.now().microsecondsSinceEpoch}@example.test';
        final response = await Dio().post<Map<String, dynamic>>(
          'http://127.0.0.1:3107/api/v1/auth/signup',
          data: {
            'name': 'M20 C7A $tag',
            'email': email,
            'password': 'M20c7a-test-password-39!',
          },
        );
        expect(response.statusCode, 201);
        return {
          'email': email,
          'password': 'M20c7a-test-password-39!',
          'uid':
              (response.data!['user'] as Map<String, dynamic>)['id'] as String,
        };
      }

      Future<void> gate(String action, String name) async {
        await control.get<dynamic>('/_control/$action/$name');
      }

      Future<void> reset() async {
        if (firebaseAuth.currentUser != null) await firebaseAuth.signOut();
      }

      // Normal login proves that the native SDK token is accepted by the
      // isolated backend and that /auth/me returns the same Firebase UID.
      final normal = await provision('normal');
      final normalCredential = await firebaseAuth.signInWithEmailAndPassword(
        email: normal['email']!,
        password: normal['password']!,
      );
      final normalUid = normalCredential.user!.uid;
      expect(normalUid, normal['uid']);
      await firebaseAuth.signOut();
      await notifier.login(
        email: normal['email']!,
        password: normal['password']!,
      );
      expect(firebaseAuth.currentUser?.uid, normalUid);
      expect(repository.currentSessionContext?.userId, normalUid);
      expect(repository.currentFirebaseUser?.uid, normalUid);
      expect(notifier.state.user?.id, normalUid);
      expect(notifier.state.isAuthenticated, isTrue);
      expect(outbound.last.uid, normalUid);
      expect(outbound.last.boundUid, normalUid);
      expect(
        outbound.last.generation,
        repository.currentSessionContext!.sessionGeneration,
      );
      expect(backendProfileUids.last, normalUid);
      debugPrint(
        'M20_C7A_NORMAL_LOGIN=PASS sdkUid:$normalUid sentTokenUid:${outbound.last.uid} backendUid:${backendProfileUids.last} generation:${repository.currentSessionContext!.sessionGeneration}',
      );
      final stableGeneration =
          repository.currentSessionContext!.sessionGeneration;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(
        repository.currentSessionContext!.sessionGeneration,
        stableGeneration,
      );

      // Firebase SDK completes the pending real sign-in after logout intent.
      await reset();
      final staleLogin = await provision('stale-login');
      await gate('arm', 'signin');
      final loginFuture = notifier.login(
        email: staleLogin['email']!,
        password: staleLogin['password']!,
      );
      await gate('wait', 'signin');
      final logoutFuture = notifier.logout();
      expect(notifier.state.isUnauthenticated, isTrue);
      expect(repository.currentFirebaseUser, isNull);
      await gate('release', 'signin');
      await Future.wait([loginFuture, logoutFuture]);
      expect(firebaseAuth.currentUser, isNull);
      expect(repository.currentFirebaseUser, isNull);
      expect(repository.currentSessionContext, isNull);
      expect(notifier.state.isUnauthenticated, isTrue);
      debugPrint(
        'M20_C7A_STALE_LOGIN_LOGOUT=PASS sdk:null repository-session:null',
      );

      // A signup reaches the real native sign-in after backend provisioning;
      // hold that SDK response, invalidate, and confirm it cannot restore A.
      await reset();
      final signupEmail =
          'm20-c7a-signup-${DateTime.now().microsecondsSinceEpoch}@example.test';
      await gate('arm', 'signup');
      final signupFuture = notifier.signup(
        name: 'M20 C7A delayed signup',
        email: signupEmail,
        password: 'M20c7a-test-password-39!',
      );
      await gate('wait', 'signup');
      await gate('arm', 'signin');
      await gate('release', 'signup');
      await gate('wait', 'signin');
      final signupLogout = notifier.logout();
      await gate('release', 'signin');
      await Future.wait([signupFuture, signupLogout]);
      expect(firebaseAuth.currentUser, isNull);
      expect(repository.currentSessionContext, isNull);
      expect(notifier.state.isUnauthenticated, isTrue);
      debugPrint('M20_C7A_STALE_SIGNUP_LOGOUT=PASS sdk:null');

      // A's late completion is cleaned before queued B is allowed to sign in.
      await reset();
      final userA = await provision('switch-a');
      final userB = await provision('switch-b');
      final observedAuthStates = <AuthState>[];
      final stateSubscription = notifier.addListener(observedAuthStates.add);
      await gate('arm', 'signin');
      final loginA = notifier.login(
        email: userA['email']!,
        password: userA['password']!,
      );
      await gate('wait', 'signin');
      final loginB = notifier.login(
        email: userB['email']!,
        password: userB['password']!,
      );
      await gate('release', 'signin');
      await Future.wait([loginA, loginB]);
      expect(firebaseAuth.currentUser?.email, userB['email']);
      expect(firebaseAuth.currentUser?.uid, userB['uid']);
      expect(
        repository.currentSessionContext?.userId,
        firebaseAuth.currentUser?.uid,
      );
      expect(
        repository.currentFirebaseUser?.uid,
        firebaseAuth.currentUser?.uid,
      );
      expect(notifier.state.user?.id, firebaseAuth.currentUser?.uid);
      expect(
        observedAuthStates
            .where((state) => state.isAuthenticated)
            .map((state) => state.user!.id),
        [userB['uid']],
      );
      final refreshed = await repository.getIdToken(forceRefresh: true);
      final refreshedUid = refreshed == null
          ? null
          : (jsonDecode(
                  utf8.decode(
                    base64Url.decode(
                      base64Url.normalize(refreshed.split('.')[1]),
                    ),
                  ),
                )
                as Map<String, dynamic>)['sub'];
      expect(refreshedUid, userB['uid']);
      stateSubscription();
      debugPrint(
        'M20_C7A_USER_SWITCH=PASS sdk:${firebaseAuth.currentUser!.uid} generation:${repository.currentSessionContext!.sessionGeneration}',
      );

      // Hold a real Firebase SDK refresh-token exchange for A while a later
      // login establishes B. The old refresh must be fenced after it returns.
      await notifier.login(
        email: userA['email']!,
        password: userA['password']!,
      );
      await gate('arm', 'refresh');
      final staleRefresh = repository
          .getIdToken(forceRefresh: true)
          .then<Object?>((value) => value, onError: (Object error) => error);
      await gate('wait', 'refresh');
      await notifier.login(
        email: userB['email']!,
        password: userB['password']!,
      );
      await gate('release', 'refresh');
      final refreshOutcome = await staleRefresh;
      expect(refreshOutcome, isA<AppFailure>());
      expect((refreshOutcome as AppFailure).code, 'SESSION_CHANGED');
      expect(firebaseAuth.currentUser?.uid, userB['uid']);
      expect(repository.currentFirebaseUser?.uid, userB['uid']);
      expect(notifier.state.user?.id, userB['uid']);
      debugPrint(
        'M20_C7A_TOKEN_REFRESH_DURING_SWITCH=PASS stale-A:discarded active-B:${userB['uid']}',
      );

      // Make one real accepted /auth/me request return test-controlled HTTP
      // 401. Hold the Firebase secure-token exchange, install B, then release.
      // AuthInterceptor must discard A's refresh and never invoke sign-out on B.
      await notifier.login(
        email: userA['email']!,
        password: userA['password']!,
      );
      await gate('arm', 'auth401');
      final oldProtectedRequest = api.dio
          .get<dynamic>('/auth/me')
          .then<Object?>((value) => value, onError: (Object error) => error);
      await gate('wait', 'auth401');
      await gate('arm', 'refresh');
      await gate('release', 'auth401');
      await gate('wait', 'refresh');
      await notifier.login(
        email: userB['email']!,
        password: userB['password']!,
      );
      final outboundAfterBLogin = outbound.length;
      await gate('release', 'refresh');
      final oldProtectedError = await oldProtectedRequest;
      expect(oldProtectedError, isA<DioException>());
      final protectedFailure =
          (oldProtectedError as DioException).error as AppFailure;
      expect(protectedFailure.code, 'SESSION_CHANGED');
      expect(
        outbound.length,
        outboundAfterBLogin,
        reason: 'obsolete A request must not retry under B',
      );
      expect(firebaseAuth.currentUser?.uid, userB['uid']);
      expect(repository.currentFirebaseUser?.uid, userB['uid']);
      expect(notifier.state.user?.id, userB['uid']);
      expect(
        authFailureCallbackCount,
        0,
        reason: 'obsolete A refresh must not log out legitimate B',
      );
      debugPrint(
        'M20_C7A_INTERCEPTOR_REFRESH_SWAP=PASS active-B:${userB['uid']} retry:0 signOutCallback:0',
      );

      // Delay a real authenticated backend response across logout. The
      // repository and AuthInterceptor must reject the response as stale.
      await gate('arm', 'authme');
      final oldMeInterceptorErrors = interceptorSessionChangedErrors;
      final successfulProfilesBeforeOldMe = backendProfileUids.length;
      final oldMe = repository.getMe().then<Object?>(
        (value) => value,
        onError: (Object error) => error,
      );
      await gate('wait', 'authme');
      await notifier.logout();
      await gate('release', 'authme');
      final oldMeError = await oldMe;
      expect(oldMeError, isA<AppFailure>());
      expect((oldMeError as AppFailure).code, 'SESSION_CHANGED');
      expect(interceptorSessionChangedErrors, oldMeInterceptorErrors + 1);
      expect(
        backendProfileUids.length,
        successfulProfilesBeforeOldMe,
        reason: 'AuthInterceptor discards stale HTTP 200 before consumer',
      );
      expect(outbound.last.uid, userB['uid']);
      expect(backendProfileUids.last, userB['uid']);
      expect(firebaseAuth.currentUser, isNull);
      expect(repository.currentFirebaseUser, isNull);
      expect(notifier.state.isUnauthenticated, isTrue);
      debugPrint('M20_C7A_AUTH_ME_ISOLATION=PASS stale-response:discarded');
      await notifier.login(
        email: userB['email']!,
        password: userB['password']!,
      );
      final recoveredProfile = await repository.getMe();
      expect(recoveredProfile.id, userB['uid']);
      injectCancellationOnce = true;
      final outboundBeforeRecovery = outbound.length;
      await notifier.retryBootstrap();
      expect(injectedCancellationCount, 1);
      expect(
        outbound.length,
        outboundBeforeRecovery + 2,
        reason: 'one controlled SESSION_CHANGED then one successful retry',
      );
      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.user?.id, userB['uid']);
      expect(firebaseAuth.currentUser?.uid, userB['uid']);
      debugPrint(
        'M20_C7A_SESSION_RECOVERY=PASS uid:${notifier.state.user!.id}',
      );
    });

    await tester.runAsync(() async {
      notifier.dispose();
      repository.dispose();
      api.dio.close(force: true);
      control.close(force: true);
      if (firebaseAuth.currentUser != null) await firebaseAuth.signOut();
    });
  }, timeout: const Timeout(Duration(minutes: 5)));

  testWidgets('M20-C7A physical Android Share waits for Firebase login without ministry', (
    tester,
  ) async {
    const shareText = 'M20C7A Shared G D';
    late FirebaseApp app;
    late FirebaseAuth auth;
    late ProviderContainer container;
    late String email;
    const password = 'M20c7a-share-password-39!';

    await tester.runAsync(() async {
      final existingApps = Firebase.apps
          .where((candidate) => candidate.name == 'm20-c7a-auth-sdk')
          .toList();
      if (existingApps.isEmpty) {
        app = await Firebase.initializeApp(
          name: 'm20-c7a-auth-sdk',
          options: const FirebaseOptions(
            apiKey: 'local-only-emulator-key',
            appId: '1:123456789:android:0123456789abcdef',
            messagingSenderId: '123456789',
            projectId: 'demo-m20-c1',
          ),
        );
      } else {
        app = existingApps.single;
      }
      auth = FirebaseAuth.instanceFor(app: app);
      if (existingApps.isEmpty) {
        await auth.useAuthEmulator(
          '127.0.0.1',
          19098,
          automaticHostMapping: false,
        );
      }
      await auth.signOut();
      email =
          'm20-c7a-share-${DateTime.now().microsecondsSinceEpoch}@example.test';
      final response = await Dio().post<Map<String, dynamic>>(
        'http://127.0.0.1:3107/api/v1/auth/signup',
        data: {'name': 'M20 C7A Share', 'email': email, 'password': password},
      );
      expect(response.statusCode, 201);
      await auth.signOut();
      final preferences = SharedPreferencesStorage(
        await SharedPreferences.getInstance(),
      );
      container = ProviderContainer(
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
      final appApi = container.read(apiClientProvider);
      container.read(authRepositoryProvider);
      appApi.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            final header = options.headers['Authorization']?.toString();
            debugPrint(
              'M20_C7A_SHARE_HTTP_REQUEST path:${options.path} tokenUid:${header?.startsWith('Bearer ') == true ? _uidFromIdToken(header!.substring(7)) : 'none'} session:${options.extra[AuthInterceptor.sessionUserIdKey] ?? 'none'} generation:${options.extra[AuthInterceptor.sessionGenerationKey] ?? 'none'}',
            );
            handler.next(options);
          },
          onResponse: (response, handler) {
            final data = response.data;
            debugPrint(
              'M20_C7A_SHARE_HTTP_RESPONSE path:${response.requestOptions.path} status:${response.statusCode} profileUid:${data is Map ? data['id'] ?? 'none' : 'none'}',
            );
            handler.next(response);
          },
          onError: (error, handler) {
            debugPrint(
              'M20_C7A_SHARE_HTTP_ERROR path:${error.requestOptions.path} status:${error.response?.statusCode ?? 'none'} type:${error.type.name} failure:${error.error is AppFailure ? (error.error as AppFailure).code ?? 'none' : error.error.runtimeType}',
            );
            handler.next(error);
          },
        ),
      );
    });

    final authTransitions = <String>[];
    final removeAuthListener = container
        .read(authNotifierProvider.notifier)
        .addListener(
          (state) => authTransitions.add(
            '${state.status.name}:${state.user?.id ?? 'none'}:${state.failure?.code ?? 'none'}',
          ),
        );

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const LouvAioApp(),
      ),
    );
    await tester.pump(const Duration(milliseconds: 500));
    final loginWatch = Stopwatch()..start();
    while ((!container.read(authNotifierProvider).isUnauthenticated ||
            find.text('Entrar').evaluate().isEmpty) &&
        loginWatch.elapsed < const Duration(seconds: 20)) {
      await tester.pump(const Duration(milliseconds: 100));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    if (find.text('Entrar').evaluate().isEmpty) {
      debugPrint(
        'M20_C7A_SHARE_LOGIN_ROUTE=${container.read(routerProvider).routeInformationProvider.value.uri}',
      );
    }
    expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);
    expect(find.text('Entrar'), findsWidgets);
    debugPrint('M20_C7A_SHARE_PENDING_READY');

    final shareWatch = Stopwatch()..start();
    while (container.read(shareIntentRouterProvider).pendingPayload?.text !=
            shareText &&
        shareWatch.elapsed < const Duration(seconds: 75)) {
      await tester.pump(const Duration(milliseconds: 100));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    expect(
      container.read(shareIntentRouterProvider).pendingPayload?.text,
      shareText,
      reason: 'physical Android ACTION_SEND remains pending before login',
    );
    expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);
    expect(find.byType(SmartChordImportScreen), findsNothing);
    debugPrint('M20_C7A_SHARE_HELD_PRE_LOGIN=PASS');

    await tester.runAsync(() async {
      try {
        await container
            .read(authNotifierProvider.notifier)
            .login(email: email, password: password);
      } catch (error) {
        debugPrint('M20_C7A_SHARE_LOGIN_THROW=${error.runtimeType}');
        rethrow;
      }
    });
    final authWatch = Stopwatch()..start();
    while ((!container.read(ministryContextNotifierProvider).isEmpty ||
            container.read(authNotifierProvider).user?.id == null) &&
        authWatch.elapsed < const Duration(seconds: 25)) {
      await tester.pump(const Duration(milliseconds: 100));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    debugPrint(
      'M20_C7A_SHARE_POST_LOGIN state:${container.read(authNotifierProvider).status.name} failure:${container.read(authNotifierProvider).failure?.code ?? 'none'} sdkUid:${auth.currentUser?.uid ?? 'null'} ministry:${container.read(ministryContextNotifierProvider).status.name} route:${container.read(routerProvider).routeInformationProvider.value.uri}',
    );
    debugPrint('M20_C7A_SHARE_AUTH_TRANSITIONS=${authTransitions.join('|')}');
    expect(container.read(authNotifierProvider).isAuthenticated, isTrue);
    expect(container.read(ministryContextNotifierProvider).isEmpty, isTrue);
    expect(container.read(shareIntentRouterProvider).pendingPayload, isNull);
    final importWatch = Stopwatch()..start();
    while (find.byType(SmartChordImportScreen).evaluate().isEmpty &&
        importWatch.elapsed < const Duration(seconds: 15)) {
      await tester.pump(const Duration(milliseconds: 100));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    expect(find.byType(SmartChordImportScreen), findsOneWidget);
    expect(
      auth.currentUser?.uid,
      container.read(authNotifierProvider).user?.id,
    );
    debugPrint(
      'M20_C7A_PENDING_SHARE_NO_MINISTRY=PASS uid:${auth.currentUser!.uid}',
    );

    await tester.pumpWidget(const SizedBox.shrink());
    removeAuthListener();
    container.dispose();
    await tester.runAsync(() async {
      if (auth.currentUser != null) await auth.signOut();
      await app.delete();
    });
  }, timeout: const Timeout(Duration(minutes: 3)));
}
