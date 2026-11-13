import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_folders_repository.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/repertoire_folder.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_collections_controller.dart';

class _MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) _handler;
  _MockAdapter(this._handler);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      _handler(options);

  @override
  void close({bool force = false}) {}
}

ResponseBody _jsonResponse(int status, String body) => ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

class _FencingFoldersRepo implements RepertoireFoldersRepository {
  Future<List<RepertoireFolder>> Function(String ministryId)? onList;

  @override
  Future<List<RepertoireFolder>> listFolders(String ministryId) =>
      onList != null ? onList!(ministryId) : Future.value([]);

  @override
  Future<RepertoireFolder> getFolder(String ministryId, String folderId) async =>
      RepertoireFolder(id: folderId, ministryId: ministryId, name: 'F');

  @override
  Future<RepertoireFolder> createFolder(
    String ministryId, {
    required String name,
    String? description,
  }) async =>
      RepertoireFolder(id: 'new', ministryId: ministryId, name: name);

  @override
  Future<RepertoireFolder> updateFolder(
    String ministryId,
    String folderId, {
    required String name,
    String? description,
  }) async =>
      RepertoireFolder(id: folderId, ministryId: ministryId, name: name);

  @override
  Future<void> deleteFolder(String ministryId, String folderId) async {}

  @override
  Future<void> addSongToFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {}

  @override
  Future<void> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {}

  @override
  Future<void> deleteArtist(String ministryId, String artistId) async {}
}

class _StubRepertoireRepo implements RepertoireRepository {
  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async =>
      const PaginatedSongs(songs: [], total: 0);

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) =>
      throw UnimplementedError();

  @override
  Future<List<Classification>> listClassifications(String ministryId) async =>
      [];

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) =>
      throw UnimplementedError();

  @override
  Future<SongDetail> updateSong(
    String ministryId,
    String songId,
    SongFormData data,
  ) =>
      throw UnimplementedError();

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async =>
      [];

  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      Artist(id: 'a-new', ministryId: ministryId, name: name);
}

void main() {
  group('HttpRepertoireFoldersRepository', () {
    late ApiClient apiClient;
    late HttpRepertoireFoldersRepository repo;

    setUp(() {
      apiClient = ApiClient(
        environment: const AppEnvironment(
          env: AppEnv.development,
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
        logger: const AppLogger(isDebug: false),
      );
      repo = HttpRepertoireFoldersRepository(apiClient: apiClient);
    });

    test('listFolders and getFolder decode API contracts cleanly', () async {
      apiClient.dio.httpClientAdapter = _MockAdapter((opts) async {
        if (opts.path == '/ministries/min-1/folders' && opts.method == 'GET') {
          return _jsonResponse(
            200,
            '{"data":[{"id":"f1","ministry_id":"min-1","name":"Santa Ceia","description":"Domingo","song_count":2}]}',
          );
        }
        if (opts.path == '/ministries/min-1/folders/f1' && opts.method == 'GET') {
          return _jsonResponse(
            200,
            '{"data":{"id":"f1","ministry_id":"min-1","name":"Santa Ceia","songs":[{"id":"s1","ministry_id":"min-1","title":"Digno é o Cordeiro","original_key":"G"}]}}',
          );
        }
        return _jsonResponse(404, '{"error":{"message":"not found"}}');
      });

      final folders = await repo.listFolders('min-1');
      expect(folders, hasLength(1));
      expect(folders.first.name, 'Santa Ceia');
      expect(folders.first.songCount, 2);

      final detail = await repo.getFolder('min-1', 'f1');
      expect(detail.songs, hasLength(1));
      expect(detail.songs.first.title, 'Digno é o Cordeiro');
    });

    test('createFolder, addSongToFolder, removeSongFromFolder, deleteArtist use canonical paths', () async {
      final calls = <String>[];
      apiClient.dio.httpClientAdapter = _MockAdapter((opts) async {
        calls.add('${opts.method} ${opts.path}');
        if (opts.method == 'POST' && opts.path == '/ministries/min-1/folders') {
          expect(opts.data['name'], 'Jovens');
          return _jsonResponse(
            201,
            '{"data":{"id":"f2","ministry_id":"min-1","name":"Jovens"}}',
          );
        }
        if (opts.method == 'POST' && opts.path == '/ministries/min-1/folders/f2/songs') {
          expect(opts.data['song_id'], 's9');
          return _jsonResponse(201, '{"message":"ok"}');
        }
        return _jsonResponse(204, '');
      });

      final created = await repo.createFolder('min-1', name: 'Jovens');
      expect(created.id, 'f2');
      await repo.addSongToFolder('min-1', 'f2', 's9');
      await repo.removeSongFromFolder('min-1', 'f2', 's9');
      await repo.deleteFolder('min-1', 'f2');
      await repo.deleteArtist('min-1', 'art-1');

      expect(calls, [
        'POST /ministries/min-1/folders',
        'POST /ministries/min-1/folders/f2/songs',
        'DELETE /ministries/min-1/folders/f2/songs/s9',
        'DELETE /ministries/min-1/folders/f2',
        'DELETE /ministries/min-1/artists/art-1',
      ]);
    });
  });

  group('RepertoireFoldersNotifier & RepertoireArtistsNotifier', () {
    test('discards stale ministry folder response after ministry switch', () async {
      final slowA = Completer<List<RepertoireFolder>>();
      final repo = _FencingFoldersRepo()
        ..onList = (minId) => minId == 'min-a'
            ? slowA.future
            : Future.value(const [
                RepertoireFolder(id: 'fb', ministryId: 'min-b', name: 'Pasta B'),
              ]);
      final notifier = RepertoireFoldersNotifier(foldersRepository: repo);

      final reqA = notifier.loadFolders('min-a');
      await notifier.loadFolders('min-b');

      slowA.complete(const [
        RepertoireFolder(id: 'fa', ministryId: 'min-a', name: 'Pasta A'),
      ]);
      await reqA;

      expect(notifier.state.ministryId, 'min-b');
      expect(notifier.state.folders.map((f) => f.id), ['fb']);
    });

    test('artists notifier reset clears prior ministry state cleanly', () async {
      final artistsNotifier = RepertoireArtistsNotifier(
        repertoireRepository: _StubRepertoireRepo(),
      );
      await artistsNotifier.loadArtists('min-a');
      await artistsNotifier.createArtist('min-a', 'Diante do Trono');
      expect(artistsNotifier.state.artists, hasLength(1));

      artistsNotifier.reset();
      expect(artistsNotifier.state.artists, isEmpty);
      expect(artistsNotifier.state.ministryId, isNull);
    });
  });
}
