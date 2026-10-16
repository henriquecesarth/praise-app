import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';

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
  late HttpSmartChordRepertoireLinkRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpSmartChordRepertoireLinkRepository(apiClient: apiClient);
  });

  group('HttpSmartChordRepertoireLinkRepository', () {
    test('getRepertoireLink calls GET endpoint and parses link & song', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(
          opts.path,
          equals('/ministries/min-1/smart-chords/sc-1/repertoire-link'),
        );
        expect(opts.method, equals('GET'));
        return jsonOk('''{
          "link": {
            "id": "u-1_sc-1_min-1",
            "smart_chord_id": "sc-1",
            "ministry_id": "min-1",
            "song_id": "song-42",
            "user_id": "u-1",
            "created_at": "2026-10-16T12:00:00Z"
          },
          "song": {
            "id": "song-42",
            "title": "Grandes Coisas",
            "artist_name": "Fernandinho"
          }
        }''');
      });

      final result = await repository.getRepertoireLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
      );

      expect(result.link, isNotNull);
      expect(result.link!.id, equals('u-1_sc-1_min-1'));
      expect(result.link!.songId, equals('song-42'));
      expect(result.song, isNotNull);
      expect(result.song!.title, equals('Grandes Coisas'));
      expect(result.song!.artistName, equals('Fernandinho'));
    });

    test('getRepertoireLink parses unlinked response with null link and null song', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(
          opts.path,
          equals('/ministries/min-1/smart-chords/sc-2/repertoire-link'),
        );
        return jsonOk('{"link": null, "song": null}');
      });

      final result = await repository.getRepertoireLink(
        ministryId: 'min-1',
        chordId: 'sc-2',
      );

      expect(result.link, isNull);
      expect(result.song, isNull);
    });

    test('setRepertoireLink calls PUT endpoint with song_id and returns updated link', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(
          opts.path,
          equals('/ministries/min-1/smart-chords/sc-1/repertoire-link'),
        );
        expect(opts.method, equals('PUT'));
        expect(opts.data, equals({'song_id': 'song-99'}));
        return jsonOk('''{
          "link": {
            "id": "u-1_sc-1_min-1",
            "smart_chord_id": "sc-1",
            "ministry_id": "min-1",
            "song_id": "song-99",
            "user_id": "u-1"
          },
          "song": {
            "id": "song-99",
            "title": "Oceanos"
          }
        }''');
      });

      final result = await repository.setRepertoireLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
        songId: 'song-99',
      );

      expect(result.link!.songId, equals('song-99'));
      expect(result.song!.title, equals('Oceanos'));
    });

    test('removeRepertoireLink calls DELETE endpoint and completes', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(
          opts.path,
          equals('/ministries/min-1/smart-chords/sc-1/repertoire-link'),
        );
        expect(opts.method, equals('DELETE'));
        return jsonOk('{"link": null, "song": null}');
      });

      await repository.removeRepertoireLink(
        ministryId: 'min-1',
        chordId: 'sc-1',
      );
    });

    test('getMySmartChordsForSong calls GET endpoint and parses chord list', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        expect(
          opts.path,
          equals('/ministries/min-1/songs/song-42/my-smart-chords'),
        );
        expect(opts.method, equals('GET'));
        return jsonOk('''{
          "data": [
            {
              "id": "sc-1",
              "user_id": "u-1",
              "title": "Grandes Coisas - Tom G",
              "original_key": "G",
              "content": "[G]Tu és...",
              "artist_name": "Fernandinho",
              "created_at": "2026-10-16T10:00:00Z",
              "updated_at": "2026-10-16T10:00:00Z"
            }
          ]
        }''');
      });

      final list = await repository.getMySmartChordsForSong(
        ministryId: 'min-1',
        songId: 'song-42',
      );

      expect(list.length, equals(1));
      expect(list.first.id, equals('sc-1'));
      expect(list.first.title, equals('Grandes Coisas - Tom G'));
      expect(list.first.artistName, equals('Fernandinho'));
    });

    test('propagates AppFailure on 404 not found (cross-tenant anti-IDOR)', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
        return jsonError(404, '{"error": {"message": "Resource not found"}}');
      });

      expect(
        () => repository.getRepertoireLink(
          ministryId: 'foreign-min',
          chordId: 'sc-1',
        ),
        throwsA(isA<AppFailure>()),
      );
    });
  });
}
