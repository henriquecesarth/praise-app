import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/push_notifications/data/push_device_repository.dart';
import 'package:mocktail/mocktail.dart';

class MockDio extends Mock implements Dio {}

void main() {
  late MockDio mockDio;
  late ApiClient apiClient;
  late AppLogger logger;
  late HttpPushDeviceRepository repository;

  setUp(() {
    mockDio = MockDio();
    logger = const AppLogger(isDebug: false);
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: logger,
      customDio: mockDio,
    );
    repository = HttpPushDeviceRepository(
      apiClient: apiClient,
      logger: logger,
    );
  });

  group('HttpPushDeviceRepository', () {
    test('registerDevice sends correct payload and returns true on HTTP 200', () async {
      when(() => mockDio.post<Map<String, dynamic>>(
            '/auth/push-devices',
            data: any(named: 'data'),
          )).thenAnswer((_) async => Response(
            statusCode: 200,
            data: {'success': true, 'message': 'Device registered'},
            requestOptions: RequestOptions(path: '/auth/push-devices'),
          ));

      final success = await repository.registerDevice(
        fcmToken: 'token-1234567890abcdef',
        platform: 'android',
        appVersion: '1.1.0',
        deviceModel: 'Pixel 6',
      );

      expect(success, isTrue);
      verify(() => mockDio.post<Map<String, dynamic>>(
            '/auth/push-devices',
            data: {
              'fcm_token': 'token-1234567890abcdef',
              'platform': 'android',
              'app_version': '1.1.0',
              'device_model': 'Pixel 6',
            },
          )).called(1);
    });

    test('registerDevice catches DioException and returns false without rethrowing', () async {
      when(() => mockDio.post<Map<String, dynamic>>(
            '/auth/push-devices',
            data: any(named: 'data'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/auth/push-devices'),
        response: Response(
          statusCode: 500,
          requestOptions: RequestOptions(path: '/auth/push-devices'),
        ),
      ));

      final success = await repository.registerDevice(
        fcmToken: 'token-1234567890abcdef',
        platform: 'android',
      );

      expect(success, isFalse);
    });

    test('unregisterDevice returns true on HTTP 200', () async {
      when(() => mockDio.delete<Map<String, dynamic>>(
            '/auth/push-devices',
            data: any(named: 'data'),
          )).thenAnswer((_) async => Response(
            statusCode: 200,
            data: {'success': true},
            requestOptions: RequestOptions(path: '/auth/push-devices'),
          ));

      final success = await repository.unregisterDevice(
        fcmToken: 'token-to-delete-12345',
      );

      expect(success, isTrue);
      verify(() => mockDio.delete<Map<String, dynamic>>(
            '/auth/push-devices',
            data: {'fcm_token': 'token-to-delete-12345'},
          )).called(1);
    });

    test('unregisterDevice treats 404 response as successful (benign deletion)', () async {
      when(() => mockDio.delete<Map<String, dynamic>>(
            '/auth/push-devices',
            data: any(named: 'data'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/auth/push-devices'),
        response: Response(
          statusCode: 404,
          requestOptions: RequestOptions(path: '/auth/push-devices'),
        ),
      ));

      final success = await repository.unregisterDevice(
        fcmToken: 'token-already-gone-12345',
      );

      expect(success, isTrue);
    });

    test('unregisterDevice returns false on network failure without throwing', () async {
      when(() => mockDio.delete<Map<String, dynamic>>(
            '/auth/push-devices',
            data: any(named: 'data'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/auth/push-devices'),
        message: 'Connection failed',
      ));

      final success = await repository.unregisterDevice(
        fcmToken: 'token-failed-12345',
      );

      expect(success, isFalse);
    });
  });
}
