import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/liturgies/data/liturgy_repository.dart';
import 'package:louvaio_mobile/features/liturgies/domain/liturgy.dart';

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
  late HttpLiturgyRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpLiturgyRepository(apiClient: apiClient);
  });

  group('HttpLiturgyRepository', () {
    test('listLiturgies calls GET /ministries/:id/liturgies and maps list', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/liturgies'));
        expect(opts.method, equals('GET'));
        return jsonOk('''[
          {
            "id": "lit-1",
            "group_id": "min-1",
            "title": "Culto Domingo",
            "date": "2026-10-11",
            "description": "Culto matutino",
            "item_count": 2,
            "song_count": 1
          }
        ]''');
      });

      final result = await repository.listLiturgies('min-1');
      expect(result.length, equals(1));
      expect(result.first.id, equals('lit-1'));
      expect(result.first.title, equals('Culto Domingo'));
      expect(result.first.itemCount, equals(2));
      expect(result.first.songCount, equals(1));
    });

    test('getLiturgyById calls GET /ministries/:id/liturgies/:lid and maps details and items', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/liturgies/lit-1'));
        return jsonOk('''{
          "id": "lit-1",
          "group_id": "min-1",
          "title": "Culto Noturno",
          "date": "2026-10-18",
          "items": [
            {
              "id": "item-1",
              "liturgy_id": "lit-1",
              "type": "song",
              "title": "Aclame ao Senhor",
              "song_id": "song-100",
              "position": 0,
              "song": {
                "id": "song-100",
                "ministry_id": "min-1",
                "title": "Aclame ao Senhor",
                "original_key": "A"
              }
            }
          ]
        }''');
      });

      final result = await repository.getLiturgyById('min-1', 'lit-1');
      expect(result.id, equals('lit-1'));
      expect(result.items.length, equals(1));
      expect(result.items.first.type, equals(LiturgyItemType.song));
      expect(result.items.first.songId, equals('song-100'));
      expect(result.items.first.song?.originalKey, equals('A'));
    });

    test('createLiturgy posts payload to /ministries/:id/liturgies', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/liturgies'));
        expect(opts.method, equals('POST'));
        final data = opts.data as Map<String, dynamic>;
        expect(data['title'], equals('Novo Roteiro'));
        expect(data['date'], equals('2026-10-25'));
        return jsonOk('''{
          "id": "lit-new",
          "group_id": "min-1",
          "title": "Novo Roteiro",
          "date": "2026-10-25"
        }''');
      });

      final result = await repository.createLiturgy(
        'min-1',
        title: 'Novo Roteiro',
        date: '2026-10-25',
      );
      expect(result.id, equals('lit-new'));
      expect(result.title, equals('Novo Roteiro'));
    });

    test('updateLiturgy puts payload to /ministries/:id/liturgies/:lid', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/liturgies/lit-1'));
        expect(opts.method, equals('PUT'));
        final data = opts.data as Map<String, dynamic>;
        expect(data['title'], equals('Título Atualizado'));
        return jsonOk('''{
          "id": "lit-1",
          "group_id": "min-1",
          "title": "Título Atualizado",
          "date": "2026-10-25"
        }''');
      });

      final result = await repository.updateLiturgy(
        'min-1',
        'lit-1',
        title: 'Título Atualizado',
      );
      expect(result.title, equals('Título Atualizado'));
    });

    test('deleteLiturgy calls DELETE /ministries/:id/liturgies/:lid', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/ministries/min-1/liturgies/lit-1'));
        expect(opts.method, equals('DELETE'));
        return jsonOk('{"success": true}');
      });

      await repository.deleteLiturgy('min-1', 'lit-1');
    });

    test('maps 404 response to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(404, '{"error": {"message": "Liturgia não encontrada."}}');
      });

      expect(
        () => repository.getLiturgyById('min-1', 'lit-nonexistent'),
        throwsA(isA<AppFailure>().having((f) => f.statusCode, 'statusCode', equals(404))),
      );
    });
  });
}
