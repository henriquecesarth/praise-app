import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';

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

ResponseBody jsonOk(String body, {int status = 200}) => ResponseBody.fromString(
      body,
      status,
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
  late HttpSmartChordRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpSmartChordRepository(apiClient: apiClient);
  });

  group('HttpSmartChordRepository', () {
    test('getSmartChords calls GET /smart-chords with query params', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/smart-chords'));
        expect(opts.method, equals('GET'));
        expect(opts.queryParameters['search'], equals('Oceanos'));
        expect(opts.queryParameters['page'], equals(1));
        expect(opts.queryParameters['limit'], equals(20));
        return jsonOk('''{
          "data": [
            {
              "id": "sc-1",
              "user_id": "u-1",
              "title": "Oceanos",
              "original_key": "D",
              "content": "[D]Tua graça...",
              "created_at": "2026-10-13T00:00:00Z",
              "updated_at": "2026-10-13T00:00:00Z"
            }
          ],
          "pagination": { "page": 1, "limit": 20, "total": 1 }
        }''');
      });

      final list = await repository.getSmartChords(
        search: 'Oceanos',
        page: 1,
        limit: 20,
      );

      expect(list.length, equals(1));
      expect(list.first.id, equals('sc-1'));
      expect(list.first.title, equals('Oceanos'));
    });

    test('getSmartChordsBySong calls GET /smart-chords/song/:songId', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/smart-chords/song/song-123'));
        expect(opts.method, equals('GET'));
        return jsonOk('''{
          "data": [
            {
              "id": "sc-2",
              "user_id": "u-1",
              "song_id": "song-123",
              "title": "Grandes Coisas",
              "original_key": "G",
              "content": "[G]Tu és Deus...",
              "created_at": "2026-10-13T00:00:00Z",
              "updated_at": "2026-10-13T00:00:00Z"
            }
          ]
        }''');
      });

      final list = await repository.getSmartChordsBySong('song-123');

      expect(list.length, equals(1));
      expect(list.first.id, equals('sc-2'));
      expect(list.first.songId, equals('song-123'));
    });

    test('getSmartChordById calls GET /smart-chords/:id', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/smart-chords/sc-1'));
        expect(opts.method, equals('GET'));
        return jsonOk('''{
          "id": "sc-1",
          "user_id": "u-1",
          "title": "Oceanos",
          "original_key": "D",
          "content": "[D]Tua graça...",
          "created_at": "2026-10-13T00:00:00Z",
          "updated_at": "2026-10-13T00:00:00Z"
        }''');
      });

      final chord = await repository.getSmartChordById('sc-1');

      expect(chord.id, equals('sc-1'));
      expect(chord.title, equals('Oceanos'));
      expect(chord.originalKey, equals('D'));
    });

    test('createSmartChord calls POST /smart-chords with payload', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/smart-chords'));
        expect(opts.method, equals('POST'));
        expect(opts.data['title'], equals('Oceanos'));
        return jsonOk('''{
          "id": "sc-created",
          "user_id": "u-1",
          "title": "Oceanos",
          "original_key": "D",
          "content": "[D]Tua graça...",
          "created_at": "2026-10-13T00:00:00Z",
          "updated_at": "2026-10-13T00:00:00Z"
        }''', status: 201);
      });

      final created = await repository.createSmartChord({
        'title': 'Oceanos',
        'original_key': 'D',
        'content': '[D]Tua graça...',
      });

      expect(created.id, equals('sc-created'));
      expect(created.title, equals('Oceanos'));
    });

    test('updateSmartChord calls PUT /smart-chords/:id', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/smart-chords/sc-1'));
        expect(opts.method, equals('PUT'));
        expect(opts.data['title'], equals('Oceanos (Tom E)'));
        return jsonOk('''{
          "id": "sc-1",
          "user_id": "u-1",
          "title": "Oceanos (Tom E)",
          "original_key": "E",
          "content": "[E]Tua graça...",
          "created_at": "2026-10-13T00:00:00Z",
          "updated_at": "2026-10-13T00:05:00Z"
        }''');
      });

      final updated = await repository.updateSmartChord('sc-1', {
        'title': 'Oceanos (Tom E)',
        'original_key': 'E',
        'content': '[E]Tua graça...',
      });

      expect(updated.id, equals('sc-1'));
      expect(updated.title, equals('Oceanos (Tom E)'));
      expect(updated.originalKey, equals('E'));
    });

    test('deleteSmartChord calls DELETE /smart-chords/:id', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(opts.path, equals('/smart-chords/sc-1'));
        expect(opts.method, equals('DELETE'));
        return jsonOk('', status: 204);
      });

      await expectLater(repository.deleteSmartChord('sc-1'), completes);
    });

    test('maps 404 response to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(404, '{"error":{"message":"Cifra não encontrada."}}');
      });

      expect(
        () => repository.getSmartChordById('missing'),
        throwsA(isA<AppFailure>().having((f) => f.statusCode, 'statusCode', 404)),
      );
    });

    test('maps 400 validation error to AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(400, '{"error":{"message":"Música e Artista devem pertencer ao mesmo ministério."}}');
      });

      expect(
        () => repository.createSmartChord({'title': ''}),
        throwsA(isA<AppFailure>().having((f) => f.statusCode, 'statusCode', 400)),
      );
    });
  });
}
