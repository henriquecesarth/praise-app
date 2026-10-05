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

  group('AvailabilityRepository M12B Consolidated Availability', () {
    test('listConsolidatedAvailability calls GET /ministries/:id/availability with query params', () async {
      RequestOptions? captured;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        captured = options;
        return jsonOk('''
{
  "window": {
    "from": "2026-10-01",
    "to": "2026-10-31"
  },
  "data": [
    {
      "id": "cons_1",
      "ministryId": "min_alpha",
      "memberId": "mem_10",
      "memberName": "Gabriel",
      "startDate": "2026-10-10",
      "endDate": "2026-10-10",
      "allDay": true,
      "startsAt": "2026-10-10T00:00:00",
      "endsAt": "2026-10-11T00:00:00"
    }
  ],
  "nextCursor": "cursor_cons_2"
}
''');
      });

      final result = await repository.listConsolidatedAvailability(
        'min_alpha',
        from: '2026-10-01',
        to: '2026-10-31',
        memberId: 'mem_10',
        limit: 25,
        cursor: 'c_start',
      );

      expect(captured?.method, 'GET');
      expect(captured?.path, '/ministries/min_alpha/availability');
      expect(captured?.queryParameters['from'], '2026-10-01');
      expect(captured?.queryParameters['to'], '2026-10-31');
      expect(captured?.queryParameters['memberId'], 'mem_10');
      expect(captured?.queryParameters['limit'], 25);
      expect(captured?.queryParameters['cursor'], 'c_start');

      expect(result.data.length, 1);
      expect(result.data.first.id, 'cons_1');
      expect(result.data.first.memberName, 'Gabriel');
      expect(result.window?.from, '2026-10-01');
      expect(result.nextCursor, 'cursor_cons_2');
    });

    test('listConsolidatedAvailability throws AppFailure on 403 Forbidden', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(403, '{"error": {"message": "Apenas administradores podem acessar a visão consolidada."}}');
      });

      expect(
        () => repository.listConsolidatedAvailability('min_alpha', from: '2026-10-01', to: '2026-10-10'),
        throwsA(isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 403)),
      );
    });
  });

  group('AvailabilityRepository M12B Manual Member Availability', () {
    test('listManualMemberAvailabilities calls GET /ministries/:id/availability/members/:memberId', () async {
      RequestOptions? captured;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        captured = options;
        return jsonOk('''
{
  "data": [
    {
      "id": "man_avail_1",
      "ministryId": "min_alpha",
      "memberId": "mem_manual_1",
      "startDate": "2026-10-20",
      "endDate": "2026-10-20",
      "allDay": true,
      "startsAt": "2026-10-20T00:00:00",
      "endsAt": "2026-10-21T00:00:00",
      "reason": "Viagem do integrante manual",
      "createdAt": "2026-10-01T00:00:00.000Z",
      "updatedAt": "2026-10-01T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
''');
      });

      final result = await repository.listManualMemberAvailabilities('min_alpha', 'mem_manual_1');

      expect(captured?.method, 'GET');
      expect(captured?.path, '/ministries/min_alpha/availability/members/mem_manual_1');
      expect(result.data.length, 1);
      expect(result.data.first.id, 'man_avail_1');
      expect(result.data.first.reason, 'Viagem do integrante manual');
    });

    test('createManualMemberAvailability preserves actor vs subject separation', () async {
      RequestOptions? captured;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        captured = options;
        return jsonCreated('''
{
  "id": "created_man_1",
  "ministryId": "min_alpha",
  "memberId": "mem_manual_2",
  "startDate": "2026-10-22",
  "endDate": "2026-10-22",
  "allDay": true,
  "startsAt": "2026-10-22T00:00:00",
  "endsAt": "2026-10-23T00:00:00",
  "reason": "Plantão médico",
  "createdAt": "2026-10-05T00:00:00.000Z",
  "updatedAt": "2026-10-05T00:00:00.000Z"
}
''');
      });

      const payload = CreateAvailabilityPayload(
        startDate: '2026-10-22',
        endDate: '2026-10-22',
        allDay: true,
        reason: 'Plantão médico',
      );

      final result = await repository.createManualMemberAvailability(
        'min_alpha',
        'mem_manual_2',
        payload,
      );

      expect(captured?.method, 'POST');
      expect(captured?.path, '/ministries/min_alpha/availability/members/mem_manual_2');
      // Subject is derived strictly from path context, not spoofed in body
      final body = captured?.data as Map<String, dynamic>;
      expect(body.containsKey('actor_id'), isFalse);
      expect(body.containsKey('actorId'), isFalse);
      expect(body.containsKey('user_id'), isFalse);
      expect(body.containsKey('userId'), isFalse);
      expect(body['startDate'], '2026-10-22');
      expect(body['reason'], 'Plantão médico');
      expect(result.id, 'created_man_1');
    });

    test('updateManualMemberAvailability calls PATCH and updates record', () async {
      RequestOptions? captured;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        captured = options;
        return jsonOk('''
{
  "id": "man_avail_edit",
  "ministryId": "min_alpha",
  "memberId": "mem_manual_2",
  "startDate": "2026-10-25",
  "endDate": "2026-10-25",
  "allDay": false,
  "startTime": "08:00",
  "endTime": "12:00",
  "startsAt": "2026-10-25T08:00:00",
  "endsAt": "2026-10-25T12:00:00",
  "reason": "Horário atualizado",
  "createdAt": "2026-10-01T00:00:00.000Z",
  "updatedAt": "2026-10-05T00:00:00.000Z"
}
''');
      });

      const payload = UpdateAvailabilityPayload(
        startDate: '2026-10-25',
        endDate: '2026-10-25',
        allDay: false,
        startTime: '08:00',
        endTime: '12:00',
        reason: 'Horário atualizado',
      );

      final result = await repository.updateManualMemberAvailability(
        'min_alpha',
        'mem_manual_2',
        'man_avail_edit',
        payload,
      );

      expect(captured?.method, 'PATCH');
      expect(captured?.path, '/ministries/min_alpha/availability/members/mem_manual_2/man_avail_edit');
      expect(result.reason, 'Horário atualizado');
      expect(result.startTime, '08:00');
    });

    test('deleteManualMemberAvailability calls DELETE and completes on 204', () async {
      RequestOptions? captured;
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        captured = options;
        return noContent();
      });

      await repository.deleteManualMemberAvailability('min_alpha', 'mem_manual_2', 'man_avail_del');

      expect(captured?.method, 'DELETE');
      expect(captured?.path, '/ministries/min_alpha/availability/members/mem_manual_2/man_avail_del');
    });

    test('throws 404 AppFailure when subject manual member is not found or not manual', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(404, '{"error": {"message": "Membro não encontrado ou não é manual."}}');
      });

      expect(
        () => repository.listManualMemberAvailabilities('min_alpha', 'non_existing_member'),
        throwsA(isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 404)),
      );
    });
  });
}

