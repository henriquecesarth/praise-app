import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_transfer_policy.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_transport.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';

class _Adapter implements HttpClientAdapter {
  _Adapter(this.handler);
  final ResponseBody Function(RequestOptions) handler;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<List<int>>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _ok([int length = 4]) => ResponseBody(
      Stream.value(Uint8List.fromList(List.filled(length, 1))),
      200,
      headers: {
        Headers.contentLengthHeader: ['$length'],
      },
    );

final _ticket = '1900000000000.${'A' * 43}';
const _r2 = 'https://acct123.r2.cloudflarestorage.com/bucket/key';

MinistryAudioTransferTarget directTarget(
    {String? url, Map<String, String>? headers}) {
  final json = directPlaybackJson();
  final track = (json['tracks'] as List)[0] as Map;
  track['url'] = url ?? '$_r2?X-Amz-Signature=SECRET';
  track['headers'] = headers ?? {'if-match': '"etag1"'};
  return MinistryAudioPlayback.fromJson(json).tracks.first;
}

MinistryAudioTransferTarget legacyTarget({String? url}) {
  final json = legacyPlaybackJson();
  ((json['tracks'] as List)[0] as Map)['url'] =
      url ?? '/$recordingId/stems/vocals?ticket=$_ticket';
  return MinistryAudioPlayback.fromJson(json).tracks.first;
}

Matcher _code(String code) =>
    isA<AppFailure>().having((f) => f.code, 'code', code);

void main() {
  group('MinistryAudioTransferPolicy', () {
    const prod = MinistryAudioTransferPolicy();
    const dev = MinistryAudioTransferPolicy(allowLocalHttp: true);

    test('accepts only the trusted R2 https origin', () {
      expect(prod.validateDirectUrl('$_r2?sig=1').host,
          'acct123.r2.cloudflarestorage.com');
      for (final bad in [
        'http://acct123.r2.cloudflarestorage.com/x',
        'https://evil.example.com/x',
        'https://r2.cloudflarestorage.com.evil.com/x',
        'https://acct123.r2.cloudflarestorage.com:8443/x',
        'https://user:pw@acct123.r2.cloudflarestorage.com/x',
        'https://acct123.r2.cloudflarestorage.com/x#frag',
        'ftp://acct123.r2.cloudflarestorage.com/x',
        'https://169.254.169.254/x',
      ]) {
        expect(() => prod.validateDirectUrl(bad),
            throwsA(_code(MinistryAudioTransferPolicy.rejectedCode)),
            reason: bad);
      }
    });

    test('loopback http only when explicitly enabled, simulator path only',
        () {
      const sim = 'http://127.0.0.1:3000/api/local/ministry-audio-objects/k?x=1';
      expect(dev.validateDirectUrl(sim).host, '127.0.0.1');
      expect(dev.validateDirectUrl(sim.replaceFirst('127.0.0.1', '10.0.2.2')),
          isA<Uri>());
      expect(() => prod.validateDirectUrl(sim),
          throwsA(_code(MinistryAudioTransferPolicy.rejectedCode)));
      expect(() => dev.validateDirectUrl('http://127.0.0.1:3000/other/path'),
          throwsA(_code(MinistryAudioTransferPolicy.rejectedCode)));
      expect(
          () => dev.validateDirectUrl(
              'http://evil.example.com/api/local/ministry-audio-objects/k'),
          throwsA(_code(MinistryAudioTransferPolicy.rejectedCode)));
    });

    test('forEnvironment enables local http only in development', () {
      const url = 'http://127.0.0.1:3000/api/local/ministry-audio-objects/k';
      for (final env in [AppEnv.staging, AppEnv.production]) {
        final p = MinistryAudioTransferPolicy.forEnvironment(
            AppEnvironment(env: env, apiBaseUrl: 'https://x.test/api/v1'));
        expect(() => p.validateDirectUrl(url), throwsA(isA<AppFailure>()));
      }
      final d = MinistryAudioTransferPolicy.forEnvironment(
          const AppEnvironment(
              env: AppEnv.development, apiBaseUrl: 'http://10.0.2.2:3000/api/v1'));
      expect(d.validateDirectUrl(url), isA<Uri>());
    });

    test('keeps If-Match, rejects Authorization, Cookie and unknown headers',
        () {
      expect(prod.validateHeaders({'If-Match': '"abc"'}), {'if-match': '"abc"'});
      for (final bad in [
        {'Authorization': 'Bearer x'},
        {'cookie': 'a=b'},
        {'x-custom': '1'},
        {'if-match': 'a\r\nHost: evil'},
        {'if-match': ''},
      ]) {
        expect(() => prod.validateHeaders(bad),
            throwsA(_code(MinistryAudioTransferPolicy.headerRejectedCode)),
            reason: '$bad');
      }
    });

    test('resolves only the validated legacy library path', () {
      final r = prod.resolveLegacy(
          ministryId: 'min_1', target: legacyTarget());
      expect(r.path,
          '/ministries/min_1/audio-library/$recordingId/stems/vocals');
      expect(r.ticket, _ticket);
      for (final bad in [
        '/$recordingId/stems/drums?ticket=$_ticket', // wrong stem
        '/$recordingId/stems/vocals?ticket=short',
        '/$recordingId/stems/vocals?ticket=$_ticket&x=1',
        '/$recordingId/stems/vocals/../x?ticket=$_ticket',
        '/${'z' * 64}/stems/vocals?ticket=$_ticket',
      ]) {
        final json = legacyPlaybackJson();
        ((json['tracks'] as List)[0] as Map)['url'] = bad;
        // Some bad shapes are already rejected by the model.
        try {
          final t = MinistryAudioPlayback.fromJson(json).tracks.first;
          expect(() => prod.resolveLegacy(ministryId: 'min_1', target: t),
              throwsA(isA<AppFailure>()),
              reason: bad);
        } on AppFailure {
          // rejected earlier: fine
        }
      }
      expect(
          () => prod.resolveLegacy(
              ministryId: '../x', target: legacyTarget()),
          throwsA(isA<AppFailure>()));
    });
  });

  group('DioMinistryAudioTransport', () {
    late ApiClient apiClient;
    late _Adapter apiAdapter;
    late _Adapter directAdapter;
    late DioMinistryAudioTransport transport;

    void build({ResponseBody Function(RequestOptions)? direct,
        ResponseBody Function(RequestOptions)? api}) {
      apiAdapter = _Adapter(api ?? (_) => _ok());
      directAdapter = _Adapter(direct ?? (_) => _ok());
      apiClient = ApiClient(
        environment: const AppEnvironment(
            env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
        logger: const AppLogger(isDebug: false),
        tokenProvider: ({bool forceRefresh = false}) async => 'FIREBASE_TOKEN',
        sessionContextProvider: () =>
            const AuthSessionContext(userId: 'user_1', sessionGeneration: 1),
      );
      apiClient.dio.httpClientAdapter = apiAdapter;
      transport = DioMinistryAudioTransport(
        apiClient: apiClient,
        policy: const MinistryAudioTransferPolicy(),
        directDio: Dio()..httpClientAdapter = directAdapter,
      );
    }

    setUp(build);

    test('direct: no LouvAIO credentials, only If-Match, no redirects',
        () async {
      final res = await transport.open(directTarget(),
          ministryId: 'min_1', cancelToken: CancelToken());
      expect(res.contentLength, 4);
      expect(await res.body.fold<int>(0, (n, c) => n + c.length), 4);

      expect(apiAdapter.requests, isEmpty); // never via the API client
      final req = directAdapter.requests.single;
      expect(req.method, 'GET');
      expect(req.headers.keys.map((k) => k.toLowerCase()),
          isNot(contains('authorization')));
      expect(req.headers.keys.map((k) => k.toLowerCase()),
          isNot(contains('cookie')));
      expect(req.headers['if-match'], '"etag1"');
      expect(req.followRedirects, isFalse);
      expect(req.maxRedirects, 0);
      expect(req.responseType, ResponseType.stream);
    });

    test('direct: untrusted host or Authorization header never reaches the net',
        () async {
      await expectLater(
          transport.open(directTarget(url: 'https://evil.example.com/x'),
              ministryId: 'min_1', cancelToken: CancelToken()),
          throwsA(_code(MinistryAudioTransferPolicy.rejectedCode)));
      await expectLater(
          transport.open(
              directTarget(headers: {'Authorization': 'Bearer x'}),
              ministryId: 'min_1',
              cancelToken: CancelToken()),
          throwsA(_code(MinistryAudioTransferPolicy.headerRejectedCode)));
      expect(directAdapter.requests, isEmpty);
      expect(apiAdapter.requests, isEmpty);
    });

    test('direct: redirect is blocked (not followed)', () async {
      build(direct: (_) => ResponseBody.fromString('', 302, headers: {
            'location': ['https://evil.example.com/steal'],
          }));
      await expectLater(
          transport.open(directTarget(),
              ministryId: 'min_1', cancelToken: CancelToken()),
          throwsA(_code(MinistryAudioTransferCodes.redirectBlocked)));
      expect(directAdapter.requests.length, 1);
    });

    test('maps 412 (If-Match rejected), 403 (expired) and others', () async {
      for (final entry in {
        412: MinistryAudioTransferCodes.preconditionFailed,
        403: MinistryAudioTransferCodes.expired,
        500: MinistryAudioTransferCodes.failed,
      }.entries) {
        build(direct: (_) => ResponseBody.fromString('x', entry.key));
        await expectLater(
            transport.open(directTarget(),
                ministryId: 'min_1', cancelToken: CancelToken()),
            throwsA(_code(entry.value)));
      }
    });

    test('legacy: authenticated API origin, validated path and ticket',
        () async {
      await transport.open(legacyTarget(),
          ministryId: 'min_1', cancelToken: CancelToken());
      expect(directAdapter.requests, isEmpty);
      final req = apiAdapter.requests.single;
      expect(req.uri.host, 'localhost');
      expect(req.uri.port, 3000);
      expect(req.uri.path,
          '/api/v1/ministries/min_1/audio-library/$recordingId/stems/vocals');
      expect(req.uri.queryParameters, {'ticket': _ticket});
      expect(req.headers['Authorization'], 'Bearer FIREBASE_TOKEN');
      expect(req.followRedirects, isFalse);
    });

    test('legacy: no session fails closed without a request', () async {
      apiClient.sessionContextProvider = () => null;
      await expectLater(
          transport.open(legacyTarget(),
              ministryId: 'min_1', cancelToken: CancelToken()),
          throwsA(isA<AppFailure>()));
      expect(apiAdapter.requests, isEmpty);
    });

    test('failure messages never contain URLs, tickets or signatures',
        () async {
      build(direct: (_) => ResponseBody.fromString('x', 403));
      try {
        await transport.open(directTarget(),
            ministryId: 'min_1', cancelToken: CancelToken());
        fail('expected failure');
      } on AppFailure catch (e) {
        final text = '${e.message} ${e.details} $e';
        expect(text, isNot(contains('SECRET')));
        expect(text, isNot(contains('r2.cloudflarestorage')));
        expect(text, isNot(contains('etag1')));
      }
    });
  });
}
