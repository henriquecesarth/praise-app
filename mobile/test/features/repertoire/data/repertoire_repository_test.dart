import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';

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
  late HttpRepertoireRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpRepertoireRepository(apiClient: apiClient);
  });

  group('HttpRepertoireRepository', () {
    group('listSongs', () {
      test('sends query parameters and maps PaginatedSongs envelope', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min-alpha/songs'));
          expect(opts.queryParameters['search'], equals('Glória'));
          expect(opts.queryParameters['classification_id'], equals('c-1'));
          expect(opts.queryParameters['cursor'], equals('cur-123'));
          expect(opts.queryParameters['page'], equals('2'));
          expect(opts.queryParameters['limit'], equals('15'));

          return jsonOk(
            '{"data":[{"id":"s1","ministry_id":"min-alpha","title":"Glória no Mais Alto","artist":{"id":"a1","name":"Fernandinho"}}],"total":1,"nextCursor":null,"hasMore":false,"limit":15,"page":2,"totalPages":1}',
          );
        });

        final result = await repository.listSongs(
          'min-alpha',
          search: 'Glória',
          classificationId: 'c-1',
          cursor: 'cur-123',
          page: 2,
          limit: 15,
        );

        expect(result.songs.length, equals(1));
        expect(result.songs.first.id, equals('s1'));
        expect(result.songs.first.title, equals('Glória no Mais Alto'));
        expect(result.songs.first.displayArtist, equals('Fernandinho'));
        expect(result.total, equals(1));
        expect(result.hasMore, isFalse);
      });

      test('maps DioException to AppFailure on network failure', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async {
          return jsonError(
            500,
            '{"error":{"message":"Falha interna do banco de dados."}}',
          );
        });

        expect(
          () => repository.listSongs('min-alpha'),
          throwsA(isA<AppFailure>().having(
            (e) => e.message,
            'message',
            contains('Falha interna'),
          )),
        );
      });
    });

    group('getSongDetail', () {
      test('unwraps { data: song } and maps SongDetail correctly', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min-alpha/songs/song-42'));
          return jsonOk(
            '{"data":{"id":"song-42","ministry_id":"min-alpha","title":"A Bênção","original_key":"B","bpm":70,"lyrics":"O Senhor te abençoe...","chord_sheet_url":"https://cifra.com/123","youtube_url":"https://yt.com/123","audio_url":null,"external_links":{"Drive":"https://drive.com/file"}}}',
          );
        });

        final detail = await repository.getSongDetail('min-alpha', 'song-42');
        expect(detail.id, equals('song-42'));
        expect(detail.title, equals('A Bênção'));
        expect(detail.originalKey, equals('B'));
        expect(detail.hasLyrics, isTrue);
        expect(detail.lyrics, contains('O Senhor te abençoe'));
        expect(detail.hasAnyLinks, isTrue);
        expect(detail.externalLinks['Drive'], equals('https://drive.com/file'));
      });

      test('throws AppFailure 404 on song not found', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async {
          return jsonError(
            404,
            '{"error":{"message":"Música não encontrada."}}',
          );
        });

        expect(
          () => repository.getSongDetail('min-alpha', 'song-missing'),
          throwsA(isA<AppFailure>().having(
            (e) => e.statusCode,
            'statusCode',
            equals(404),
          )),
        );
      });
    });

    group('listClassifications', () {
      test('unwraps { data: [...] } and maps Classification list', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min-alpha/classifications'));
          return jsonOk(
            '{"data":[{"id":"c1","ministry_id":"min-alpha","name":"Louvor","color":"#7C3AED"},{"id":"c2","ministry_id":"min-alpha","name":"Adoração","color":"#06B6D4"}]}',
          );
        });

        final list = await repository.listClassifications('min-alpha');
        expect(list.length, equals(2));
        expect(list[0].id, equals('c1'));
        expect(list[0].name, equals('Louvor'));
        expect(list[1].id, equals('c2'));
        expect(list[1].name, equals('Adoração'));
      });

      test('returns empty list when data is empty array', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async {
          return jsonOk('{"data":[]}');
        });

        final list = await repository.listClassifications('min-alpha');
        expect(list, isEmpty);
      });
    });
  });
}
