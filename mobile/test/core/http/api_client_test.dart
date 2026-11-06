import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';

void main() {
  const testEnvironment = AppEnvironment(
    env: AppEnv.development,
    apiBaseUrl: 'http://10.0.2.2:3000/api/v1',
  );

  final client = ApiClient(
    environment: testEnvironment,
    logger: const AppLogger(isDebug: false),
  );

  group('ApiClient configuration', () {
    test('configures baseUrl and json headers correctly', () {
      expect(client.dio.options.baseUrl, 'http://10.0.2.2:3000/api/v1');
      expect(client.dio.options.headers['Content-Type'], 'application/json');
      expect(client.dio.options.headers['Accept'], 'application/json');
      expect(client.dio.options.connectTimeout, const Duration(seconds: 10));
      expect(client.dio.options.receiveTimeout, const Duration(seconds: 15));
    });
  });

  group('ApiClient.mapDioException', () {
    test('HTML HTTP errors keep status instead of becoming network errors', () {
      for (final status in [401, 403, 404, 500]) {
        final request = RequestOptions(path: '/smart-chords/import/url');
        final failure = client.mapDioException(DioException(
          requestOptions: request,
          response: Response(
              requestOptions: request,
              statusCode: status,
              data: '<html>Access denied</html>'),
        ));
        expect(failure.statusCode, status);
        expect(failure.code, 'HTTP_ERROR');
        expect(failure.message, contains('HTTP $status'));
      }
    });
    test('maps structured backend error response into AppFailure', () {
      final requestOptions = RequestOptions(path: '/api/v1/test');
      final dioException = DioException(
        requestOptions: requestOptions,
        response: Response(
          requestOptions: requestOptions,
          statusCode: 403,
          data: {
            'error': {
              'message': 'Acesso negado para este ministério.',
              'details': {'code': 'FORBIDDEN_MINISTRY'},
            },
          },
        ),
      );

      final failure = client.mapDioException(dioException);

      expect(failure.statusCode, 403);
      expect(failure.message, 'Acesso negado para este ministério.');
      expect(failure.code, 'FORBIDDEN_MINISTRY');
    });

    test('maps transport/network error into network AppFailure', () {
      final requestOptions = RequestOptions(path: '/api/v1/test');
      final dioException = DioException(
        requestOptions: requestOptions,
        type: DioExceptionType.connectionTimeout,
        message: 'Connection timed out',
      );

      final failure = client.mapDioException(dioException);

      expect(failure.code, 'NETWORK_ERROR');
      expect(failure.message, contains('Connection timed out'));
    });
  });
}
