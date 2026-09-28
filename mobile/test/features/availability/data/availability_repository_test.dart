import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';

class MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) _handler;
  MockAdapter(this._handler);

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<List<int>>? requestStream, Future<void>? cancelFuture) {
    return _handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonOk(String body) => ResponseBody.fromString(
      body,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

ResponseBody jsonCreated(String body) => ResponseBody.fromString(
      body,
      201,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

ResponseBody noContent() => ResponseBody.fromString(
      '',
      204,
      headers: {},
    );

ResponseBody jsonError(int status, String body) => ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

void main() {
  late ApiClient apiClient;
  late HttpAvailabilityRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpAvailabilityRepository(apiClient: apiClient);
  });

  group('AvailabilityRepository', () {
    test(
        'listMyAvailabilities sends correct path, query params and parses response',
        () async {
      RequestOptions? recordedOptions;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        recordedOptions = options;
        return jsonOk('''{
          "data": [
            {
              "id": "avail_1",
              "ministryId": "min_1",
              "memberId": "mem_1",
              "startDate": "2026-10-04",
              "endDate": "2026-10-04",
              "startTime": "19:00",
              "endTime": "22:00",
              "allDay": false,
              "startsAt": "2026-10-04T19:00:00",
              "endsAt": "2026-10-04T22:00:00",
              "reason": "Compromisso",
              "createdAt": "2026-09-28T00:00:00.000Z",
              "updatedAt": "2026-09-28T00:00:00.000Z"
            }
          ],
          "nextCursor": "cursor_tok_123"
        }''');
      });

      final res = await repository.listMyAvailabilities('min_1',
          limit: 20, cursor: 'cursor_prev');

      expect(recordedOptions?.path, '/ministries/min_1/availability/my');
      expect(recordedOptions?.queryParameters['limit'], 20);
      expect(recordedOptions?.queryParameters['cursor'], 'cursor_prev');
      expect(res.data.length, 1);
      expect(res.data.first.id, 'avail_1');
      expect(res.nextCursor, 'cursor_tok_123');
    });

    test('listMyAvailabilities throws AppFailure on 403 MINISTRY_ACCESS_DENIED',
        () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(403, '''{
          "error": {
            "message": "Acesso negado. Você não é integrante deste ministério.",
            "details": { "code": "MINISTRY_ACCESS_DENIED" }
          }
        }''');
      });

      expect(
        () => repository.listMyAvailabilities('min_other'),
        throwsA(isA<AppFailure>()
            .having((e) => e.statusCode, 'statusCode', 403)
            .having((e) => e.code, 'code', 'MINISTRY_ACCESS_DENIED')),
      );
    });

    test(
        'listMyAvailabilities throws AppFailure on 403 CROSS_CONTEXT_CURSOR_REJECTED',
        () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(403, '''{
          "error": {
            "message": "Acesso negado: cursor pertence a outro contexto.",
            "details": { "code": "CROSS_CONTEXT_CURSOR_REJECTED" }
          }
        }''');
      });

      expect(
        () =>
            repository.listMyAvailabilities('min_1', cursor: 'foreign_cursor'),
        throwsA(isA<AppFailure>()
            .having((e) => e.statusCode, 'statusCode', 403)
            .having((e) => e.code, 'code', 'CROSS_CONTEXT_CURSOR_REJECTED')),
      );
    });

    test('createMyAvailability sends POST body and returns MemberAvailability',
        () async {
      RequestOptions? recordedOptions;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        recordedOptions = options;
        return jsonCreated('''{
          "id": "new_avail_1",
          "ministryId": "min_1",
          "memberId": "mem_1",
          "startDate": "2026-10-10",
          "endDate": "2026-10-12",
          "startTime": null,
          "endTime": null,
          "allDay": true,
          "startsAt": "2026-10-10T00:00:00",
          "endsAt": "2026-10-13T00:00:00",
          "reason": "Viagem",
          "createdAt": "2026-09-28T10:00:00.000Z",
          "updatedAt": "2026-09-28T10:00:00.000Z"
        }''');
      });

      const payload = CreateAvailabilityPayload(
        startDate: '2026-10-10',
        endDate: '2026-10-12',
        allDay: true,
        reason: 'Viagem',
      );

      final result = await repository.createMyAvailability('min_1', payload);

      expect(recordedOptions?.method, 'POST');
      expect(recordedOptions?.path, '/ministries/min_1/availability/my');
      expect(result.id, 'new_avail_1');
      expect(result.allDay, isTrue);
    });

    test('createMyAvailability throws AppFailure on 400 validation error',
        () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(400, '''{
          "error": {
            "message": "A data final não pode ser anterior à data inicial."
          }
        }''');
      });

      const payload = CreateAvailabilityPayload(
        startDate: '2026-10-10',
        endDate: '2026-10-05',
        allDay: true,
      );

      expect(
        () => repository.createMyAvailability('min_1', payload),
        throwsA(
            isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 400)),
      );
    });

    test(
        'updateMyAvailability sends PATCH and returns updated MemberAvailability',
        () async {
      RequestOptions? recordedOptions;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        recordedOptions = options;
        return jsonOk('''{
          "id": "avail_1",
          "ministryId": "min_1",
          "memberId": "mem_1",
          "startDate": "2026-10-04",
          "endDate": "2026-10-04",
          "startTime": null,
          "endTime": null,
          "allDay": true,
          "startsAt": "2026-10-04T00:00:00",
          "endsAt": "2026-10-05T00:00:00",
          "reason": "Atualizado",
          "createdAt": "2026-09-28T00:00:00.000Z",
          "updatedAt": "2026-09-28T01:00:00.000Z"
        }''');
      });

      const payload = UpdateAvailabilityPayload(
        allDay: true,
        reason: 'Atualizado',
      );

      final result =
          await repository.updateMyAvailability('min_1', 'avail_1', payload);

      expect(recordedOptions?.method, 'PATCH');
      expect(
          recordedOptions?.path, '/ministries/min_1/availability/my/avail_1');
      expect(result.allDay, isTrue);
      expect(result.reason, 'Atualizado');
    });

    test(
        'updateMyAvailability throws 404 AppFailure when item not owned or not found',
        () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(404, '''{
          "error": { "message": "Indisponibilidade não encontrada." }
        }''');
      });

      const payload = UpdateAvailabilityPayload(reason: 'Tentativa');

      expect(
        () => repository.updateMyAvailability('min_1', 'avail_other', payload),
        throwsA(
            isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 404)),
      );
    });

    test('deleteMyAvailability sends DELETE and succeeds on 204', () async {
      RequestOptions? recordedOptions;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        recordedOptions = options;
        return noContent();
      });

      await repository.deleteMyAvailability('min_1', 'avail_del');

      expect(recordedOptions?.method, 'DELETE');
      expect(
          recordedOptions?.path, '/ministries/min_1/availability/my/avail_del');
    });

    test('deleteMyAvailability throws 404 AppFailure when item not found',
        () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(404, '''{
          "error": { "message": "Indisponibilidade não encontrada." }
        }''');
      });

      expect(
        () => repository.deleteMyAvailability('min_1', 'avail_not_found'),
        throwsA(
            isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 404)),
      );
    });
  });
}
