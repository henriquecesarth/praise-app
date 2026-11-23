import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';

class _Adapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) handler;
  final List<RequestOptions> requests = [];

  _Adapter(this.handler);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

void main() {
  const base = 'http://localhost:3000/api/v1';
  late AuthSessionContext? session;
  late String? activeMinistry;
  late ApiClient apiClient;
  late HttpMinistryAudioRepository repository;
  late _Adapter adapter;

  void setUpWith(Future<ResponseBody> Function(RequestOptions) handler) {
    adapter = _Adapter(handler);
    apiClient.dio.httpClientAdapter = adapter;
  }

  setUp(() {
    session = const AuthSessionContext(userId: 'user_1', sessionGeneration: 1);
    activeMinistry = 'min_1';
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: base,
      ),
      logger: const AppLogger(isDebug: false),
      tokenProvider: ({bool forceRefresh = false}) async => 'token',
      sessionContextProvider: () => session,
    );
    repository = HttpMinistryAudioRepository(
      apiClient: apiClient,
      activeMinistryId: () => activeMinistry,
    );
    setUpWith((_) async => _json({'items': [], 'nextCursor': null}));
  });

  Matcher failure(String? code, {int? status}) => isA<AppFailure>()
      .having((f) => f.code, 'code', code)
      .having((f) => f.statusCode, 'status', status ?? anything);

  group('listRecordings', () {
    test('requests the ministry catalog under /api/v1 without duplicating it',
        () async {
      setUpWith((_) async => _json({
            'items': [recordingJson()],
            'nextCursor': 'cur_1',
          }));
      final page = await repository.listRecordings(
        ministryId: 'min_1',
        query: '  graça ',
        limit: 10,
        cursor: 'prev_1',
      );
      expect(page.items.single.id, recordingId);
      expect(page.nextCursor, 'cur_1');

      final req = adapter.requests.single;
      expect(req.method, 'GET');
      expect(req.uri.path, '/api/v1/ministries/min_1/audio-library');
      expect(req.uri.queryParameters,
          {'q': 'graça', 'limit': '10', 'cursor': 'prev_1'});
      expect(req.headers['Authorization'], 'Bearer token');
    });

    test('omits empty query, limit and cursor', () async {
      await repository.listRecordings(ministryId: 'min_1');
      expect(adapter.requests.single.uri.queryParameters, isEmpty);
    });

    test('paginates by following nextCursor until null', () async {
      setUpWith((o) async {
        final cursor = o.uri.queryParameters['cursor'];
        return _json(cursor == null
            ? {'items': [recordingJson()], 'nextCursor': 'p2'}
            : {'items': [recordingJson(id: otherRecordingId)], 'nextCursor': null});
      });
      final first = await repository.listRecordings(ministryId: 'min_1');
      final second = await repository.listRecordings(
          ministryId: 'min_1', cursor: first.nextCursor);
      expect(first.hasMore, isTrue);
      expect(second.hasMore, isFalse);
      expect(second.items.single.id, otherRecordingId);
    });

    test('rejects invalid local arguments before any request', () async {
      await expectLater(
          repository.listRecordings(ministryId: '../x'), throwsA(isA<AppFailure>()));
      await expectLater(
          repository.listRecordings(ministryId: 'min_1', limit: 31),
          throwsA(isA<AppFailure>()));
      await expectLater(
          repository.listRecordings(ministryId: 'min_1', cursor: 'a b'),
          throwsA(isA<AppFailure>()));
      await expectLater(
          repository.listRecordings(ministryId: 'min_1', query: 'x' * 161),
          throwsA(isA<AppFailure>()));
      expect(adapter.requests, isEmpty);
    });

    test('maps HTTP errors with AppFailure', () async {
      for (final status in [401, 403, 404]) {
        setUpWith((_) async => _json({
              'error': {
                'message': 'erro $status',
                'details': {'code': 'CODE_$status'}
              }
            }, status));
        await expectLater(
          repository.listRecordings(ministryId: 'min_1'),
          throwsA(failure(status == 401 ? 'CODE_401' : 'CODE_$status',
              status: status)),
        );
      }
    });

    test('maps non-JSON 404 (library disabled in this environment)', () async {
      setUpWith((_) async => ResponseBody.fromString('<html>nope</html>', 404,
          headers: {
            Headers.contentTypeHeader: ['text/html']
          }));
      await expectLater(repository.listRecordings(ministryId: 'min_1'),
          throwsA(failure('HTTP_ERROR', status: 404)));
    });

    test('rejects invalid response bodies', () async {
      for (final body in <Object>[
        [1, 2],
        {'items': 'x'},
        {'items': [], 'nextCursor': 'bad cursor!'},
      ]) {
        setUpWith((_) async => _json(body));
        await expectLater(repository.listRecordings(ministryId: 'min_1'),
            throwsA(failure(MinistryAudioContract.invalidCode)));
      }
    });
  });

  group('getPlayback', () {
    test('parses direct mode without downloading anything', () async {
      setUpWith((_) async => _json(directPlaybackJson()));
      final p = await repository.getPlayback(
          ministryId: 'min_1', recordingId: recordingId);
      expect(p.transfer, MinistryAudioTransfer.direct);
      final req = adapter.requests.single;
      expect(req.method, 'GET');
      expect(req.uri.path,
          '/api/v1/ministries/min_1/audio-library/$recordingId/playback');
      expect(adapter.requests.any((r) => r.uri.host == 'r2.example.test'), isFalse);
    });

    test('parses legacy mode without resolving ticket URLs', () async {
      setUpWith((_) async => _json(legacyPlaybackJson()));
      final p = await repository.getPlayback(
          ministryId: 'min_1', recordingId: recordingId);
      expect(p.transfer, MinistryAudioTransfer.legacy);
      expect(adapter.requests.length, 1);
      expect(adapter.requests.single.uri.path, isNot(contains('/stems/')));
    });

    test('rejects a playback for a different recording', () async {
      setUpWith((_) async => _json(directPlaybackJson(id: otherRecordingId)));
      await expectLater(
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId),
          throwsA(failure(MinistryAudioContract.invalidCode)));
    });

    test('rejects MP3 and v2 playback', () async {
      final v2 = directPlaybackJson();
      (v2['manifest'] as Map)['schemaVersion'] = 2;
      setUpWith((_) async => _json(v2));
      await expectLater(
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId),
          throwsA(failure(MinistryAudioContract.unsupportedSchemaCode)));

      final mp3 = directPlaybackJson();
      ((mp3['manifest'] as Map)['stems'] as List)[0]['codec'] = 'mp3_cbr256';
      setUpWith((_) async => _json(mp3));
      await expectLater(
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId),
          throwsA(failure(MinistryAudioContract.unsupportedCodecCode)));
    });

    test('maps 401/403/404 and invalid bodies', () async {
      for (final status in [403, 404]) {
        setUpWith((_) async => _json({
              'error': {'message': 'x', 'details': {'code': 'C$status'}}
            }, status));
        await expectLater(
            repository.getPlayback(
                ministryId: 'min_1', recordingId: recordingId),
            throwsA(failure('C$status', status: status)));
      }
      // 401: interceptor retries once with a refreshed token, then fails.
      setUpWith((_) async => _json({
            'error': {'message': 'x', 'details': {'code': 'C401'}}
          }, 401));
      await expectLater(
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId),
          throwsA(failure('C401', status: 401)));

      setUpWith((_) async => _json({'nope': true}));
      await expectLater(
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId),
          throwsA(failure(MinistryAudioContract.invalidCode)));
    });

    test('rejects malformed recording id before any request', () async {
      await expectLater(
          repository.getPlayback(ministryId: 'min_1', recordingId: 'nope'),
          throwsA(isA<AppFailure>()));
      expect(adapter.requests, isEmpty);
    });
  });

  group('context isolation', () {
    test('late success after ministry switch is discarded', () async {
      final gate = Completer<void>();
      setUpWith((_) async {
        await gate.future;
        return _json({'items': [recordingJson()], 'nextCursor': null});
      });
      final pending = repository.listRecordings(ministryId: 'min_1');
      final check = expectLater(pending,
          throwsA(failure(HttpMinistryAudioRepository.contextChangedCode)));
      await Future<void>.delayed(Duration.zero);
      activeMinistry = 'min_2';
      gate.complete();
      await check;
    });

    test('late playback after ministry switch is discarded', () async {
      final gate = Completer<void>();
      setUpWith((_) async {
        await gate.future;
        return _json(directPlaybackJson());
      });
      final pending =
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId);
      final check = expectLater(pending,
          throwsA(failure(HttpMinistryAudioRepository.contextChangedCode)));
      await Future<void>.delayed(Duration.zero);
      activeMinistry = null;
      gate.complete();
      await check;
    });

    test('late error after ministry switch is not shown as current error',
        () async {
      final gate = Completer<void>();
      setUpWith((_) async {
        await gate.future;
        return _json({'error': {'message': 'forbidden'}}, 403);
      });
      final pending = repository.listRecordings(ministryId: 'min_1');
      final check = expectLater(pending,
          throwsA(failure(HttpMinistryAudioRepository.contextChangedCode)));
      await Future<void>.delayed(Duration.zero);
      activeMinistry = 'min_2';
      gate.complete();
      await check;
    });

    test('late response after user switch is discarded', () async {
      final gate = Completer<void>();
      setUpWith((_) async {
        await gate.future;
        return _json({'items': [recordingJson()], 'nextCursor': null});
      });
      final pending = repository.listRecordings(ministryId: 'min_1');
      final check = expectLater(pending, throwsA(isA<AppFailure>()));
      await Future<void>.delayed(Duration.zero);
      session = const AuthSessionContext(userId: 'user_2', sessionGeneration: 2);
      gate.complete();
      await check;
    });

    test('late response after new login of same user (generation) is discarded',
        () async {
      final gate = Completer<void>();
      setUpWith((_) async {
        await gate.future;
        return _json(directPlaybackJson());
      });
      final pending =
          repository.getPlayback(ministryId: 'min_1', recordingId: recordingId);
      final check = expectLater(pending, throwsA(isA<AppFailure>()));
      await Future<void>.delayed(Duration.zero);
      session = const AuthSessionContext(userId: 'user_1', sessionGeneration: 2);
      gate.complete();
      await check;
    });

    test('request for a ministry that is not active never leaves the app',
        () async {
      activeMinistry = 'min_2';
      await expectLater(repository.listRecordings(ministryId: 'min_1'),
          throwsA(failure(HttpMinistryAudioRepository.contextChangedCode)));
      expect(adapter.requests, isEmpty);
    });

    test('no session fails closed without a request', () async {
      session = null;
      await expectLater(repository.listRecordings(ministryId: 'min_1'),
          throwsA(failure('SESSION_CHANGED', status: 401)));
      expect(adapter.requests, isEmpty);
    });

    test('session is bound to the request', () async {
      await repository.listRecordings(ministryId: 'min_1');
      final extra = adapter.requests.single.extra;
      expect(extra[AuthInterceptor.sessionUserIdKey], 'user_1');
      expect(extra[AuthInterceptor.sessionGenerationKey], 1);
    });
  });

  group('read-only guarantee', () {
    test('only GET requests to the audio-library are ever issued', () async {
      setUpWith((o) async => o.uri.path.endsWith('/playback')
          ? _json(directPlaybackJson())
          : _json({'items': [recordingJson()], 'nextCursor': null}));
      await repository.listRecordings(ministryId: 'min_1', query: 'a');
      await repository.getPlayback(ministryId: 'min_1', recordingId: recordingId);
      expect(adapter.requests.length, 2);
      for (final r in adapter.requests) {
        expect(r.method, 'GET');
        expect(r.uri.path, startsWith('/api/v1/ministries/min_1/audio-library'));
        expect(r.uri.path, isNot(contains('/uploads')));
        expect(r.uri.path, isNot(contains('/stems/')));
        expect(r.uri.host, 'localhost');
      }
    });
  });
}
