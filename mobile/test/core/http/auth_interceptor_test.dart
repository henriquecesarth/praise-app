import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';

class MockAdapter implements HttpClientAdapter {
  int requestCount = 0;
  final List<ResponseBody Function(RequestOptions options)> handlers;

  MockAdapter(this.handlers);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final index = requestCount++;
    if (index < handlers.length) {
      return handlers[index](options);
    }
    return ResponseBody.fromString('{"ok": true}', 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  group('AuthInterceptor', () {
    late Dio dio;
    bool authFailedCalled = false;
    int tokenFetchCount = 0;
    int forceRefreshTokenCount = 0;

    setUp(() {
      authFailedCalled = false;
      tokenFetchCount = 0;
      forceRefreshTokenCount = 0;
      dio = Dio(BaseOptions(baseUrl: 'https://example.com'));
    });

    test('attaches Authorization Bearer token to protected request', () async {
      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          tokenFetchCount++;
          return 'mock-firebase-token';
        },
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      RequestOptions? capturedOptions;
      dio.httpClientAdapter = MockAdapter([
        (options) {
          capturedOptions = options;
          return ResponseBody.fromString('{"data": 1}', 200);
        }
      ]);
      dio.interceptors.add(interceptor);

      final response = await dio.get<dynamic>('/protected');

      expect(response.statusCode, 200);
      expect(capturedOptions?.headers['Authorization'],
          'Bearer mock-firebase-token');
      expect(tokenFetchCount, 1);
      expect(authFailedCalled, false);
    });

    test(
        'does not attach Authorization to public request with requiresAuth: false',
        () async {
      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          tokenFetchCount++;
          return 'mock-firebase-token';
        },
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      RequestOptions? capturedOptions;
      dio.httpClientAdapter = MockAdapter([
        (options) {
          capturedOptions = options;
          return ResponseBody.fromString('{"data": 1}', 200);
        }
      ]);
      dio.interceptors.add(interceptor);

      final response = await dio.post<dynamic>(
        '/public',
        options: Options(extra: {AuthInterceptor.requiresAuthKey: false}),
      );

      expect(response.statusCode, 200);
      expect(capturedOptions?.headers.containsKey('Authorization'), false);
      expect(tokenFetchCount, 0);
      expect(authFailedCalled, false);
    });

    test(
        'first 401 performs exactly one forced refresh and replays request with refreshed token',
        () async {
      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          if (forceRefresh) {
            forceRefreshTokenCount++;
            return 'refreshed-token';
          }
          tokenFetchCount++;
          return 'stale-token';
        },
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"success": true}', 200);
        },
      ]);
      dio.interceptors.add(interceptor);

      final response = await dio.get<dynamic>('/api/resource');

      expect(response.statusCode, 200);
      expect(observedTokens.length, 2);
      expect(observedTokens[0], 'Bearer stale-token');
      expect(observedTokens[1], 'Bearer refreshed-token');
      expect(forceRefreshTokenCount, 1);
      expect(authFailedCalled, false);
    });

    test(
        'second 401 does not loop, rejects request and triggers onAuthenticationFailed',
        () async {
      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          if (forceRefresh) {
            forceRefreshTokenCount++;
            return 'still-invalid-refreshed-token';
          }
          tokenFetchCount++;
          return 'stale-token';
        },
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString(
              '{"error": "Still Unauthorized"}', 401);
        },
        (options) {
          // Should never reach third attempt
          fail('Should not make a third attempt');
        },
      ]);
      dio.interceptors.add(interceptor);

      await expectLater(
        dio.get<dynamic>('/api/resource'),
        throwsA(isA<DioException>()),
      );

      expect(observedTokens.length, 2);
      expect(forceRefreshTokenCount, 1);
      expect(authFailedCalled, true);
    });

    test('Scenario A: Pre-dispatch account switch rejects request and sends NO request with new account token', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          return 'token_of_${activeSession?.userId}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"ok": true}', 200);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      // Account switches to B BEFORE interceptor dispatch!
      activeSession = const AuthSessionContext(
        userId: 'usr_b',
        sessionGeneration: 2,
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      expect(observedTokens, isEmpty);
      expect(authFailedCalled, false);
    });

    test('Scenario B: Account switch during in-flight 401 prevents retry under new account', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          return 'token_of_${activeSession?.userId}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          // Account switches to B while A's request is in-flight!
          activeSession = const AuthSessionContext(
            userId: 'usr_b',
            sessionGeneration: 2,
          );
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"ok": true}', 200);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      // Only attempt 1 with A's token occurred. Attempt 2 with B's token must NOT occur!
      expect(observedTokens, ['Bearer token_of_usr_a']);
      // New account B must NOT be logged out by A's 401
      expect(authFailedCalled, false);
    });

    test('Scenario C: A remains authenticated, receives 401 -> ordinary refresh and retry still work', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          if (forceRefresh) {
            return 'refreshed_token_of_${activeSession.userId}';
          }
          return 'stale_token_of_${activeSession.userId}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"ok": true}', 200);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      final response = await dio.patch<dynamic>(
        '/auth/me/preferences',
        data: {'chord_font_family': 'Georgia'},
        options: requestOptions,
      );

      expect(response.statusCode, 200);
      expect(observedTokens, [
        'Bearer stale_token_of_usr_a',
        'Bearer refreshed_token_of_usr_a',
      ]);
      expect(authFailedCalled, false);
    });

    test('Scenario D: A logs out while PATCH is pending -> 401 does not substitute credentials or retry', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          return 'token_of_${activeSession?.userId}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          // User logs out while request is pending!
          activeSession = null;
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      expect(observedTokens, ['Bearer token_of_usr_a']);
      expect(authFailedCalled, false);
    });

    test('Scenario E: A logs out and logs back in to same UID -> old session generation 1 cannot replay under generation 2', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          return 'token_gen${activeSession?.sessionGeneration}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          // A logs out and logs back in with generation 2!
          activeSession = const AuthSessionContext(
            userId: 'usr_a',
            sessionGeneration: 2,
          );
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"ok": true}', 200);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      // Only attempt 1 with gen 1 token occurred. Attempt 2 with gen 2 token was prevented!
      expect(observedTokens, ['Bearer token_gen1']);
      expect(authFailedCalled, false);
    });

    test('Scenario F: Account A retry receives 401 after switching to Account B -> must NOT log out Account B', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          if (forceRefresh) {
            return 'refreshed_token_of_${activeSession?.userId}';
          }
          return 'stale_token_of_${activeSession?.userId}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        // 1. Initial request from usr_a returns 401
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        // 2. Retry request from usr_a: while retry is in flight, account switches to usr_b!
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          activeSession = const AuthSessionContext(
            userId: 'usr_b',
            sessionGeneration: 2,
          );
          // usr_a's retry receives 401
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      expect(observedTokens, [
        'Bearer stale_token_of_usr_a',
        'Bearer refreshed_token_of_usr_a',
      ]);
      // Account B must NOT be logged out by Account A's obsolete retry failure!
      expect(authFailedCalled, false);
      expect(activeSession?.userId, 'usr_b');
    });

    test('Scenario G: Account A retry receives 401 after logout and reauth to same UID -> must NOT log out generation 2', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          if (forceRefresh) {
            return 'refreshed_token_gen${activeSession?.sessionGeneration}';
          }
          return 'stale_token_gen${activeSession?.sessionGeneration}';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        // 1. Initial request with gen 1 token returns 401
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        // 2. Retry with gen 1 token: while retry is in flight, user logs out & reauths as gen 2!
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          activeSession = const AuthSessionContext(
            userId: 'usr_a',
            sessionGeneration: 2,
          );
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      expect(observedTokens, [
        'Bearer stale_token_gen1',
        'Bearer refreshed_token_gen1',
      ]);
      // The new generation 2 session must NOT be logged out by gen 1 retry failure!
      expect(authFailedCalled, false);
      expect(activeSession?.sessionGeneration, 2);
    });

    test('Scenario H: Genuine authentication failure of active session triggers onAuthenticationFailed', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      final List<String?> observedTokens = [];

      final interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async {
          if (forceRefresh) {
            return 'refreshed_token';
          }
          return 'stale_token';
        },
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        // 1. Initial request gets 401
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
        // 2. Retry request still gets 401 (session unchanged, credentials genuinely revoked)
        (options) {
          observedTokens.add(options.headers['Authorization'] as String?);
          return ResponseBody.fromString('{"error": "Unauthorized"}', 401);
        },
      ]);
      dio.interceptors.add(interceptor);

      final requestOptions = Options(
        extra: {
          AuthInterceptor.sessionUserIdKey: 'usr_a',
          AuthInterceptor.sessionGenerationKey: 1,
        },
      );

      await expectLater(
        dio.patch<dynamic>('/auth/me/preferences', data: {'chord_font_family': 'Georgia'}, options: requestOptions),
        throwsA(isA<DioException>()),
      );

      expect(observedTokens, [
        'Bearer stale_token',
        'Bearer refreshed_token',
      ]);
      // Genuine failure of active session MUST trigger onAuthenticationFailed!
      expect(authFailedCalled, true);
    });

    test('Scenario I: In-flight session-bound response is rejected if sessionContextProvider is detached on disposal', () async {
      AuthSessionContext? activeSession = const AuthSessionContext(
        userId: 'usr_a',
        sessionGeneration: 1,
      );

      late final AuthInterceptor interceptor;
      interceptor = AuthInterceptor(
        tokenProvider: ({bool forceRefresh = false}) async => 'token_usr_a',
        sessionContextProvider: () => activeSession,
        onAuthenticationFailed: () async => authFailedCalled = true,
        dio: dio,
      );

      dio.httpClientAdapter = MockAdapter([
        (options) {
          // Simulate provider disposal detaching sessionContextProvider while request is in flight
          interceptor.sessionContextProvider = null;
          return ResponseBody.fromString('{"id": "usr_a"}', 200, headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          });
        },
      ]);
      dio.interceptors.add(interceptor);

      await expectLater(
        dio.get<dynamic>('/auth/me'),
        throwsA(
          isA<DioException>().having(
            (e) => e.type,
            'type',
            DioExceptionType.cancel,
          ),
        ),
      );
      expect(authFailedCalled, false);
    });
  });
}
