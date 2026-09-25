import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';

class MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) _handler;

  MockAdapter(this._handler);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) {
    return _handler(options);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  group('HttpMinistryRepository', () {
    late ApiClient apiClient;
    late HttpMinistryRepository repository;

    setUp(() {
      apiClient = ApiClient(
        environment: const AppEnvironment(
          env: AppEnv.development,
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
        logger: const AppLogger(isDebug: false),
      );
      repository = HttpMinistryRepository(apiClient: apiClient);
    });

    test('getMyMinistries returns List<Ministry> on 200 OK', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '[{"id": "min_1", "name": "Ministério Central", "role": "admin", "owner_user_id": "usr_1"}, {"id": "min_2", "name": "Ministério Jovens", "role": "member", "owner_user_id": "usr_2"}]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final ministries = await repository.getMyMinistries();

      expect(ministries.length, 2);
      expect(ministries[0].id, 'min_1');
      expect(ministries[0].name, 'Ministério Central');
      expect(ministries[0].role, 'admin');
      expect(ministries[0].isAdmin, isTrue);

      expect(ministries[1].id, 'min_2');
      expect(ministries[1].name, 'Ministério Jovens');
      expect(ministries[1].role, 'member');
      expect(ministries[1].isAdmin, isFalse);
    });

    test('getMyMinistries returns empty list when response is empty', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '[]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final ministries = await repository.getMyMinistries();
      expect(ministries, isEmpty);
    });

    test('getMyMinistries maps 403 error to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '{"error": {"message": "Acesso negado."}}',
          403,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      await expectLater(
        repository.getMyMinistries(),
        throwsA(
          isA<AppFailure>()
              .having((f) => f.statusCode, 'statusCode', 403)
              .having((f) => f.message, 'message', 'Acesso negado.'),
        ),
      );
    });

    test('getMyMinistries maps 500 server error to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '{"error": {"message": "Erro interno no servidor."}}',
          500,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      await expectLater(
        repository.getMyMinistries(),
        throwsA(
          isA<AppFailure>().having((f) => f.statusCode, 'statusCode', 500),
        ),
      );
    });
  });
}
