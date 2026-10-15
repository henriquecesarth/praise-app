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
  group('HttpMinistryRepository Onboarding & Invites', () {
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

    group('createMinistry', () {
      test('POST /ministries with name returns created Ministry on 201 Created', () async {
        RequestOptions? capturedOptions;
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          capturedOptions = options;
          return ResponseBody.fromString(
            '{"id": "min_new_1", "name": "Ministério Novo", "role": "admin", "owner_user_id": "usr_creator"}',
            201,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        final ministry = await repository.createMinistry(name: 'Ministério Novo');

        expect(capturedOptions?.method, 'POST');
        expect(capturedOptions?.path, '/ministries');
        expect(capturedOptions?.data, {'name': 'Ministério Novo'});
        expect(ministry.id, 'min_new_1');
        expect(ministry.name, 'Ministério Novo');
        expect(ministry.role, 'admin');
        expect(ministry.isAdmin, isTrue);
        expect(ministry.ownerUserId, 'usr_creator');
      });

      test('createMinistry unwraps nested { data: {...} } response if returned', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString(
            '{"data": {"id": "min_wrapped_1", "name": "Ministério Wrapped", "role": "admin"}}',
            201,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        final ministry = await repository.createMinistry(name: 'Ministério Wrapped');

        expect(ministry.id, 'min_wrapped_1');
        expect(ministry.name, 'Ministério Wrapped');
      });

      test('createMinistry maps 400 Bad Request with PT-BR message', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString(
            '{"error": {"message": "Nome do ministério é obrigatório"}}',
            400,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        expect(
          () => repository.createMinistry(name: '   '),
          throwsA(isA<AppFailure>().having(
            (e) => e.message,
            'message',
            contains('Nome do ministério'),
          )),
        );
      });
    });

    group('joinMinistryByCode', () {
      test('POST /ministries/join with uppercase code returns JoinMinistryResult on 200 OK', () async {
        RequestOptions? capturedOptions;
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          capturedOptions = options;
          return ResponseBody.fromString(
            '{"message": "Sucesso", "ministry": {"id": "min_target", "name": "Ministério Graça", "role": "member"}, "role": "member"}',
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        final result = await repository.joinMinistryByCode(code: 'pr-abcd12');

        expect(capturedOptions?.method, 'POST');
        expect(capturedOptions?.path, '/ministries/join');
        expect(capturedOptions?.data, {'code': 'PR-ABCD12'});
        expect(result.ministry.id, 'min_target');
        expect(result.ministry.name, 'Ministério Graça');
        expect(result.role, 'member');
        expect(result.message, 'Sucesso');
      });

      test('joinMinistryByCode maps 404 to invalid/expired code message', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString(
            '{"error": {"message": "Código de convite não encontrado. Verifique o código e tente novamente."}}',
            404,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        expect(
          () => repository.joinMinistryByCode(code: 'PR-EXPIRED'),
          throwsA(isA<AppFailure>().having(
            (e) => e.message,
            'message',
            contains('não encontrado'),
          )),
        );
      });
    });

    group('createInviteCode', () {
      test('POST /ministries/:id/invites returns MinistryInvite on 201 Created', () async {
        RequestOptions? capturedOptions;
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          capturedOptions = options;
          return ResponseBody.fromString(
            '{"code": "PR-INVITE", "expires_at": "2026-10-22T14:00:00.000Z"}',
            201,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        final invite = await repository.createInviteCode('min_alpha', expiresInDays: 7);

        expect(capturedOptions?.method, 'POST');
        expect(capturedOptions?.path, '/ministries/min_alpha/invites');
        expect(capturedOptions?.data, {'expiresInDays': 7});
        expect(invite.code, 'PR-INVITE');
        expect(invite.expiresAt, isNotNull);
      });

      test('createInviteCode maps 403 Forbidden to permission error', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString(
            '{"error": {"message": "Somente administradores podem gerar códigos de convite."}}',
            403,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        expect(
          () => repository.createInviteCode('min_alpha'),
          throwsA(isA<AppFailure>().having(
            (e) => e.statusCode,
            'statusCode',
            403,
          )),
        );
      });
    });
  });
}