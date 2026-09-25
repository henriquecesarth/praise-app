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
  });
}
