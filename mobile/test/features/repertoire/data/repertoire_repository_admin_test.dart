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

      test('sends multi-version payload and parses multi-version SongDetail preserving all versions and IDs', () async {
        const formData = SongFormData(
          title: 'Ousado Amor',
          versions: [
            SongVersion(
              id: 'v_orig',
              name: 'Original',
              key: 'Bb',
              bpm: 68,
              classificationIds: ['c-1'],
            ),
            SongVersion(
              id: 'v_live',
              name: 'Ao Vivo (Editada)',
              key: 'C',
              bpm: 70,
              classificationIds: ['c-1', 'c-2'],
              notes: 'Subir tom no refrão final',
            ),
          ],
        );

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.method, equals('PUT'));
          expect(opts.path, equals('/ministries/min-1/songs/song-201'));
          final sentVersions = opts.data['versions'] as List?;
          expect(sentVersions, isNotNull);
          expect(sentVersions, hasLength(2));
          expect(sentVersions![0]['id'], equals('v_orig'));
          expect(sentVersions[1]['id'], equals('v_live'));
          expect(sentVersions[1]['name'], equals('Ao Vivo (Editada)'));

          return jsonOk(jsonEncode({
            'data': {
              'id': 'song-201',
              'ministry_id': 'min-1',
              'title': 'Ousado Amor',
              'original_key': 'Bb',
              'bpm': 68,
              'versions': sentVersions,
            }
          }));
        });

        final updated = await repository.updateSong('min-1', 'song-201', formData);
        expect(updated.versions, hasLength(2));
        expect(updated.versions[0].id, equals('v_orig'));
        expect(updated.versions[0].key, equals('Bb'));
        expect(updated.versions[1].id, equals('v_live'));
        expect(updated.versions[1].name, equals('Ao Vivo (Editada)'));
        expect(updated.versions[1].key, equals('C'));
        expect(updated.versions[1].notes, equals('Subir tom no refrão final'));
      });

      test(
          'F01 & F03 Round-Trip (Simulated In-Memory Backend Persistence Double): free-text artist and fractional BPM survive Mobile parse -> secondary version edit -> HTTP PUT -> Backend repository update -> reload',
          () async {
        // Isolated in-memory simulated Backend store mirroring RepertoireRepository.ts
        Map<String, dynamic> inMemorySongDoc = {
          'id': 'song-rt-1',
          'ministry_id': 'min-1',
          'title': 'Canção Roundtrip',
          'artist_id': null,
          'artist': {'id': '', 'name': 'Free Artist'},
          'artist_name': 'Free Artist',
          'original_key': 'E',
          'bpm': 72.5,
          'versions': [
            {
              'id': 'v_1',
              'name': 'Original',
              'key': 'E',
              'bpm': 72.5,
              'classificationIds': ['c-1'],
              'notes': 'Nota v1',
              'links': [
                {'label': 'Vídeo', 'url': 'https://youtube.com/watch?v=1'},
              ],
            },
            {
              'id': 'v_2',
              'name': 'Acústica',
              'key': null,
              'bpm': 68,
              'classificationIds': <String>[],
              'notes': 'Nota v2 antes',
              'links': <Map<String, dynamic>>[],
            },
          ],
        };

        Map<String, dynamic>? capturedPutBody;

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          if (opts.method == 'GET' &&
              opts.path == '/ministries/min-1/songs/song-rt-1') {
            return jsonOk(jsonEncode({'data': inMemorySongDoc}));
          }
          if (opts.method == 'PUT' &&
              opts.path == '/ministries/min-1/songs/song-rt-1') {
            final data = Map<String, dynamic>.from(opts.data as Map);
            capturedPutBody = data;

            // Mirror Backend RepertoireRepository.ts artist handling (lines 624-637)
            final updateData = Map<String, dynamic>.from(inMemorySongDoc)
              ..addAll(data);
            if (data.containsKey('artist_id')) {
              if (data['artist_id'] != null &&
                  data['artist_id'].toString().isNotEmpty) {
                updateData['artist_id'] = data['artist_id'];
              } else {
                updateData['artist'] = null;
                updateData['artist_name'] = null;
                updateData['artist_id'] = null;
              }
            }
            inMemorySongDoc = updateData;
            return jsonOk(jsonEncode({'data': inMemorySongDoc}));
          }
          return jsonError(404, jsonEncode({'error': {'message': 'Not found'}}));
        });

        // 1. Load song through Mobile repository
        final loaded = await repository.getSongDetail('min-1', 'song-rt-1');
        expect(loaded.artistId, isNull);
        expect(loaded.artistName, equals('Free Artist'));
        expect(loaded.bpm, equals(72.5));
        expect(loaded.versions[0].bpm, equals(72.5));

        // 2. Edit secondary version only, preserving omitted artistId when unchanged
        final editedVersions = [
          loaded.versions[0],
          loaded.versions[1].copyWith(notes: 'Nota v2 depois'),
        ];
        final formData = SongFormData(
          title: loaded.title,
          artistId: loaded.artistId ?? songFieldOmitted,
          classificationId: loaded.versions[0].classificationIds.firstOrNull,
          originalKey: loaded.versions[0].key,
          bpm: loaded.versions[0].bpm,
          duration: loaded.versions[0].duration,
          versions: editedVersions,
        );

        // 3. Save through Mobile repository
        final reloaded =
            await repository.updateSong('min-1', 'song-rt-1', formData);

        expect(capturedPutBody, isNotNull);
        expect(capturedPutBody!.containsKey('artist_id'), isFalse);
        expect(capturedPutBody!['bpm'], equals(72.5));
        expect((capturedPutBody!['versions'] as List)[0]['bpm'], equals(72.5));

        // 4. Verify persisted state in simulated Backend double and reloaded SongDetail
        expect(
          inMemorySongDoc['artist'],
          equals({'id': '', 'name': 'Free Artist'}),
        );
        expect(inMemorySongDoc['artist_name'], equals('Free Artist'));
        expect(reloaded.artistName, equals('Free Artist'));
        expect(reloaded.bpm, equals(72.5));
        expect(reloaded.versions[0].bpm, equals(72.5));
        expect(reloaded.versions[1].notes, equals('Nota v2 depois'));
      });

      test(
          'F04 Round-Trip (Simulated In-Memory Backend Persistence Double): textual BPM "Rubato" survives Mobile parse -> version rename -> HTTP PUT -> Backend repository update -> reload',
          () async {
        Map<String, dynamic> inMemorySongDoc = {
          'id': 'song-rubato-1',
          'ministry_id': 'min-1',
          'title': 'Canção Rubato Backend',
          'artist_id': null,
          'artist': {'id': '', 'name': 'Free Artist'},
          'artist_name': 'Free Artist',
          'bpm': 'Rubato',
          'versions': [
            {
              'id': 'v_1',
              'name': 'Original',
              'key': 'E',
              'bpm': 'Rubato',
              'classificationIds': ['c-1'],
              'notes': 'Nota v1',
              'links': <Map<String, dynamic>>[],
            },
            {
              'id': 'v_2',
              'name': 'Live',
              'key': null,
              'bpm': 'Rubato',
              'classificationIds': <String>[],
              'notes': 'Nota v2 antes',
              'links': <Map<String, dynamic>>[],
            },
          ],
        };

        Map<String, dynamic>? capturedPutBody;

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          if (opts.method == 'GET' &&
              opts.path == '/ministries/min-1/songs/song-rubato-1') {
            return jsonOk(jsonEncode({'data': inMemorySongDoc}));
          }
          if (opts.method == 'PUT' &&
              opts.path == '/ministries/min-1/songs/song-rubato-1') {
            final data = Map<String, dynamic>.from(opts.data as Map);
            capturedPutBody = data;

            final updateData = Map<String, dynamic>.from(inMemorySongDoc)
              ..addAll(data);
            inMemorySongDoc = updateData;
            return jsonOk(jsonEncode({'data': inMemorySongDoc}));
          }
          return jsonError(404, jsonEncode({'error': {'message': 'Not found'}}));
        });

        // 1. Load song through Mobile repository
        final loaded = await repository.getSongDetail('min-1', 'song-rubato-1');
        expect(loaded.bpm, equals('Rubato'));
        expect(loaded.versions[0].bpm, equals('Rubato'));
        expect(loaded.versions[1].bpm, equals('Rubato'));

        // 2. Rename secondary version without touching BPM
        final editedVersions = [
          loaded.versions[0],
          loaded.versions[1].copyWith(name: 'Live Renamed'),
        ];
        final formData = SongFormData(
          title: loaded.title,
          artistId: songFieldOmitted,
          classificationId: loaded.versions[0].classificationIds.firstOrNull,
          originalKey: loaded.versions[0].key,
          bpm: loaded.versions[0].bpm,
          duration: loaded.versions[0].duration,
          versions: editedVersions,
        );

        // 3. Save through Mobile repository
        final reloaded =
            await repository.updateSong('min-1', 'song-rubato-1', formData);

        expect(capturedPutBody, isNotNull);
        expect(capturedPutBody!['bpm'], equals('Rubato'));
        expect((capturedPutBody!['versions'] as List)[1]['name'], equals('Live Renamed'));
        expect((capturedPutBody!['versions'] as List)[1]['bpm'], equals('Rubato'));

        // 4. Verify persisted state in double and reloaded SongDetail
        expect(inMemorySongDoc['bpm'], equals('Rubato'));
        expect(reloaded.bpm, equals('Rubato'));
        expect(reloaded.versions[0].bpm, equals('Rubato'));
        expect(reloaded.versions[1].bpm, equals('Rubato'));
        expect(reloaded.versions[1].name, equals('Live Renamed'));
      });

      test(
          'F01 & F03 (R3) Round-Trip: untouched textual BPM with surrounding spaces " Rubato " survives Mobile parse -> version rename -> HTTP PUT -> Backend repository update -> reload byte-for-byte',
          () async {
        Map<String, dynamic> inMemorySongDoc = {
          'id': 'song-rubato-spaces',
          'ministry_id': 'min-1',
          'title': 'Canção Rubato Espaços',
          'artist_id': null,
          'artist': {'id': '', 'name': 'Free Artist'},
          'artist_name': 'Free Artist',
          'bpm': ' Rubato ',
          'versions': [
            {
              'id': 'v_1',
              'name': 'Original',
              'key': 'E',
              'bpm': ' Rubato ',
              'classificationIds': ['c-1'],
              'notes': 'Nota v1',
              'links': <Map<String, dynamic>>[],
            },
            {
              'id': 'v_2',
              'name': 'Live',
              'key': null,
              'bpm': ' Rubato ',
              'classificationIds': <String>[],
              'notes': 'Nota v2 antes',
              'links': <Map<String, dynamic>>[],
            },
          ],
        };

        Map<String, dynamic>? capturedPutBody;

        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          if (opts.method == 'GET' &&
              opts.path == '/ministries/min-1/songs/song-rubato-spaces') {
            return jsonOk(jsonEncode({'data': inMemorySongDoc}));
          }
          if (opts.method == 'PUT' &&
              opts.path == '/ministries/min-1/songs/song-rubato-spaces') {
            final data = Map<String, dynamic>.from(opts.data as Map);
            capturedPutBody = data;

            final updateData = Map<String, dynamic>.from(inMemorySongDoc)
              ..addAll(data);
            inMemorySongDoc = updateData;
            return jsonOk(jsonEncode({'data': inMemorySongDoc}));
          }
          return jsonError(404, jsonEncode({'error': {'message': 'Not found'}}));
        });

        final loaded =
            await repository.getSongDetail('min-1', 'song-rubato-spaces');
        expect(loaded.bpm, equals(' Rubato '));
        expect(loaded.versions[0].bpm, equals(' Rubato '));
        expect(loaded.versions[1].bpm, equals(' Rubato '));

        final editedVersions = [
          loaded.versions[0],
          loaded.versions[1].copyWith(name: 'Live Renamed'),
        ];
        final formData = SongFormData(
          title: loaded.title,
          artistId: songFieldOmitted,
          classificationId: loaded.versions[0].classificationIds.firstOrNull,
          originalKey: loaded.versions[0].key,
          bpm: loaded.versions[0].bpm,
          duration: loaded.versions[0].duration,
          versions: editedVersions,
        );

        final reloaded =
            await repository.updateSong('min-1', 'song-rubato-spaces', formData);

        expect(capturedPutBody, isNotNull);
        expect(capturedPutBody!['bpm'], equals(' Rubato '));
        expect(
            (capturedPutBody!['versions'] as List)[0]['bpm'], equals(' Rubato '));
        expect(
            (capturedPutBody!['versions'] as List)[1]['bpm'], equals(' Rubato '));
        expect(reloaded.bpm, equals(' Rubato '));
        expect(reloaded.versions[0].bpm, equals(' Rubato '));
        expect(reloaded.versions[1].bpm, equals(' Rubato '));
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
