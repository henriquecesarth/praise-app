import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/teams/data/team_repository.dart';

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

ResponseBody jsonError(int status, String body) => ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

void main() {
  late ApiClient apiClient;
  late HttpTeamRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpTeamRepository(apiClient: apiClient);
  });

  group('HttpTeamRepository', () {
    test('getTeams calls GET /ministries/:id/teams and maps list', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/teams'));
        expect(opts.method, equals('GET'));
        return jsonOk('''[
          {
            "id": "team-1",
            "ministry_id": "min-1",
            "name": "Banda Principal",
            "description": "Vocal e instrumental",
            "member_ids": ["mem-1", "mem-2"],
            "created_at": "2026-10-10T12:00:00Z"
          }
        ]''');
      });

      final result = await repository.getTeams('min-1');
      expect(result.length, equals(1));
      expect(result.first.id, equals('team-1'));
      expect(result.first.name, equals('Banda Principal'));
      expect(result.first.description, equals('Vocal e instrumental'));
      expect(result.first.memberIds, equals(['mem-1', 'mem-2']));
    });

    test('getTeamById calls GET /ministries/:mid/teams/:tid and maps team',
        () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/teams/team-1'));
        expect(opts.method, equals('GET'));
        return jsonOk('''{
          "id": "team-1",
          "ministry_id": "min-1",
          "name": "Vocalistas",
          "member_ids": ["mem-1"]
        }''');
      });

      final result = await repository.getTeamById('min-1', 'team-1');
      expect(result.id, equals('team-1'));
      expect(result.name, equals('Vocalistas'));
      expect(result.memberIds, equals(['mem-1']));
    });

    test('createTeam sends POST with trimmed payload and memberIds', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/teams'));
        expect(opts.method, equals('POST'));
        expect(opts.data, equals({
          'name': 'Nova Equipe',
          'description': 'Descrição da equipe',
          'memberIds': ['mem-1', 'mem-2'],
        }));
        return jsonOk('''{
          "id": "team-created",
          "ministry_id": "min-1",
          "name": "Nova Equipe",
          "description": "Descrição da equipe",
          "member_ids": ["mem-1", "mem-2"]
        }''');
      });

      final result = await repository.createTeam(
        'min-1',
        name: '  Nova Equipe  ',
        description: '  Descrição da equipe  ',
        memberIds: ['mem-1', 'mem-2'],
      );

      expect(result.id, equals('team-created'));
      expect(result.name, equals('Nova Equipe'));
    });

    test('updateTeam sends PUT with updated fields', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/teams/team-1'));
        expect(opts.method, equals('PUT'));
        expect(opts.data, equals({
          'name': 'Nome Atualizado',
          'memberIds': ['mem-3'],
        }));
        return jsonOk('''{
          "id": "team-1",
          "ministry_id": "min-1",
          "name": "Nome Atualizado",
          "member_ids": ["mem-3"]
        }''');
      });

      final result = await repository.updateTeam(
        'min-1',
        'team-1',
        name: 'Nome Atualizado',
        memberIds: ['mem-3'],
      );

      expect(result.name, equals('Nome Atualizado'));
      expect(result.memberIds, equals(['mem-3']));
    });

    test('deleteTeam sends DELETE /ministries/:mid/teams/:tid', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/teams/team-1'));
        expect(opts.method, equals('DELETE'));
        return jsonOk('{"message":"Equipe excluída com sucesso."}');
      });

      await expectLater(
        repository.deleteTeam('min-1', 'team-1'),
        completes,
      );
    });

    test('maps 404 error correctly to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(
          404,
          '{"error":{"message":"Equipe não encontrada."}}',
        );
      });

      expect(
        () => repository.getTeamById('min-1', 'team-404'),
        throwsA(isA<AppFailure>().having(
          (e) => e.statusCode,
          'statusCode',
          equals(404),
        )),
      );
    });

    test('maps 403 error correctly to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(
          403,
          '{"error":{"message":"Acesso negado."}}',
        );
      });

      expect(
        () => repository.deleteTeam('min-1', 'team-1'),
        throwsA(isA<AppFailure>().having(
          (e) => e.statusCode,
          'statusCode',
          equals(403),
        )),
      );
    });

    test('maps 500 error correctly to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(
          500,
          '{"error":{"message":"Internal server error."}}',
        );
      });

      expect(
        () => repository.getTeams('min-1'),
        throwsA(isA<AppFailure>()),
      );
    });
  });
}
