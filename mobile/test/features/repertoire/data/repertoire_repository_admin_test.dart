import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';

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

ResponseBody jsonOk(String body, [int status = 200]) => ResponseBody.fromString(
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

  group('HttpRepertoireRepository Admin Operations', () {
    group('createSong', () {
      test('sends POST /ministries/:id/songs and maps created SongDetail', () async {
        const formData = SongFormData(
          title: 'Grande E o Senhor',
          artistId: 'artist-1',
          classificationId: 'class-1',
          originalKey: 'A',
          bpm: 120,
          duration: '04:15',
          lyrics: 'Grande e o Senhor...',
        );

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.method, equals('POST'));
          expect(opts.path, equals('/ministries/min-1/songs'));
          expect(opts.data['title'], equals('Grande E o Senhor'));
          expect(opts.data['artist_id'], equals('artist-1'));

          return jsonOk(jsonEncode({
            'data': {
              'id': 'song-new-1',
              'ministry_id': 'min-1',
              'title': 'Grande E o Senhor',
              'artist_id': 'artist-1',
              'artist_name': 'Adhemar de Campos',
              'classification_id': 'class-1',
              'classification': {
                'id': 'class-1',
                'name': 'Celebracao',
                'color': '#10B981',
              },
              'original_key': 'A',
              'bpm': 120,
              'duration': '04:15',
              'lyrics': 'Grande e o Senhor...',
            }
          }), 201);
        });

        final created = await repository.createSong('min-1', formData);

        expect(created.id, equals('song-new-1'));
        expect(created.title, equals('Grande E o Senhor'));
        expect(created.artistId, equals('artist-1'));
        expect(created.artistName, equals('Adhemar de Campos'));
        expect(created.originalKey, equals('A'));
        expect(created.bpm, equals(120));
      });

      test('maps 403 Forbidden to AppFailure', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          return jsonError(403, jsonEncode({
            'error': {'message': 'Acesso negado: requer perfil admin'}
          }));
        });

        expect(
          () => repository.createSong('min-1', const SongFormData(title: 'X')),
          throwsA(isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 403)),
        );
      });
    });

    group('updateSong', () {
      test('sends PUT /ministries/:id/songs/:songId and maps updated SongDetail', () async {
        const formData = SongFormData(
          title: 'Grande E o Senhor (Atualizado)',
          originalKey: 'B',
        );

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.method, equals('PUT'));
          expect(opts.path, equals('/ministries/min-1/songs/song-123'));
          expect(opts.data['title'], equals('Grande E o Senhor (Atualizado)'));
          expect(opts.data['original_key'], equals('B'));

          return jsonOk(jsonEncode({
            'data': {
              'id': 'song-123',
              'ministry_id': 'min-1',
              'title': 'Grande E o Senhor (Atualizado)',
              'original_key': 'B',
            }
          }));
        });

        final updated = await repository.updateSong('min-1', 'song-123', formData);

        expect(updated.id, equals('song-123'));
        expect(updated.title, equals('Grande E o Senhor (Atualizado)'));
        expect(updated.originalKey, equals('B'));
      });
    });

    group('deleteSong', () {
      test('sends DELETE /ministries/:id/songs/:songId', () async {
        bool deleted = false;

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.method, equals('DELETE'));
          expect(opts.path, equals('/ministries/min-1/songs/song-to-delete'));
          deleted = true;
          return jsonOk(jsonEncode({'success': true}));
        });

        await repository.deleteSong('min-1', 'song-to-delete');
        expect(deleted, isTrue);
      });

      test('maps 404 Not Found to AppFailure', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          return jsonError(404, jsonEncode({
            'error': {'message': 'M�sica n�o encontrada.'}
          }));
        });

        expect(
          () => repository.deleteSong('min-1', 'unknown-song'),
          throwsA(isA<AppFailure>().having((e) => e.statusCode, 'statusCode', 404)),
        );
      });
    });

    group('listArtists', () {
      test('sends GET /ministries/:id/artists and parses list', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.method, equals('GET'));
          expect(opts.path, equals('/ministries/min-1/artists'));
          expect(opts.queryParameters['search'], equals('Rocha'));

          return jsonOk(jsonEncode({
            'data': [
              {
                'id': 'art-1',
                'ministry_id': 'min-1',
                'name': 'Gabriela Rocha',
              }
            ]
          }));
        });

        final artists = await repository.listArtists('min-1', search: 'Rocha');

        expect(artists, hasLength(1));
        expect(artists.first.id, equals('art-1'));
        expect(artists.first.name, equals('Gabriela Rocha'));
      });
    });

    group('createArtist', () {
      test('sends POST /ministries/:id/artists and returns created Artist', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.method, equals('POST'));
          expect(opts.path, equals('/ministries/min-1/artists'));
          expect(opts.data['name'], equals('Novo Artista'));

          return jsonOk(jsonEncode({
            'data': {
              'id': 'art-new',
              'ministry_id': 'min-1',
              'name': 'Novo Artista',
            }
          }), 201);
        });

        final artist = await repository.createArtist('min-1', 'Novo Artista');

        expect(artist.id, equals('art-new'));
        expect(artist.ministryId, equals('min-1'));
        expect(artist.name, equals('Novo Artista'));
      });
    });
  });
}
