// M22-D-E2 (private R2): TEST-ONLY evidence of the stem downloads the tablet makes
// DIRECTLY to Cloudflare R2. The backend never sees those GETs, so its counters
// are not evidence here. The probe replaces ONLY the isolated "direct" Dio of the
// real `DioMinistryAudioTransport` (same options, no other interceptor) and adds
// an interceptor that records, per request: destination class, scheme, stem id,
// HTTP status, bytes actually streamed, SHA-256 of those bytes and whether any
// Authorization/Cookie header was present. It NEVER stores URLs, query strings,
// signatures or header values. Production code is unchanged; nothing is mocked:
// the real HTTPS transfer, policy, cache and verification still run.
import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart'
    show IncrementalSha256;
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_transfer_policy.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_transport.dart';

final RegExp _r2Host = RegExp(r'^[a-z0-9-]{1,64}\.r2\.cloudflarestorage\.com$');

final class R2TransferRecord {
  R2TransferRecord({
    required this.destination,
    required this.scheme,
    required this.stem,
    required this.hadCredentialHeader,
  });

  /// `r2-https`, `loopback` or `other` (never the host itself).
  final String destination;
  final String scheme;
  final String stem;
  final bool hadCredentialHeader;
  final int startedMs = DateTime.now().millisecondsSinceEpoch;
  int finishedMs = 0;
  int status = 0;
  int bytes = 0;
  String sha256 = '';
  bool finished = false;
}

final class R2TransportProbe {
  R2TransportProbe({this.holdFirstRequest = Duration.zero});

  /// Delays ONLY the first outgoing request (renewal scenario). The signed URL
  /// then really expires at R2 (HTTP 403) before the request is sent.
  final Duration holdFirstRequest;
  final List<R2TransferRecord> records = <R2TransferRecord>[];
  bool _held = false;

  int get started => records.length;

  Dio _newDio() {
    final dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 60),
        followRedirects: false,
        maxRedirects: 0,
        responseType: ResponseType.stream,
        validateStatus: (status) => status == 200,
      ),
    );
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final host = options.uri.host.toLowerCase();
          final destination = options.uri.scheme == 'https' && _r2Host.hasMatch(host)
              ? 'r2-https'
              : (host == '127.0.0.1' || host == 'localhost' ? 'loopback' : 'other');
          final last = options.uri.pathSegments.isEmpty ? '' : options.uri.pathSegments.last;
          final record = R2TransferRecord(
            destination: destination,
            scheme: options.uri.scheme,
            stem: last.endsWith('.wav') ? last.substring(0, last.length - 4) : '?',
            hadCredentialHeader: options.headers.keys.any((k) {
              final name = k.toLowerCase();
              return name == 'authorization' || name == 'cookie';
            }),
          );
          records.add(record);
          options.extra['m22_probe_record'] = records.length - 1;
          if (!_held && holdFirstRequest > Duration.zero) {
            _held = true;
            await Future<void>.delayed(holdFirstRequest);
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          final index = response.requestOptions.extra['m22_probe_record'];
          final body = response.data;
          if (index is int && body is ResponseBody) {
            final record = records[index];
            record.status = response.statusCode ?? 0;
            final sha = IncrementalSha256();
            final counted = body.stream.transform(
              StreamTransformer<Uint8List, Uint8List>.fromHandlers(
                handleData: (chunk, sink) {
                  record.bytes += chunk.length;
                  sha.update(chunk);
                  sink.add(chunk);
                },
                handleDone: (sink) {
                  record.sha256 = sha.digestHex();
                  record.finishedMs = DateTime.now().millisecondsSinceEpoch;
                  record.finished = true;
                  sink.close();
                },
              ),
            );
            response.data = ResponseBody(
              counted,
              body.statusCode,
              headers: body.headers,
              statusMessage: body.statusMessage,
              isRedirect: body.isRedirect,
            );
          }
          handler.next(response);
        },
        onError: (error, handler) {
          final index = error.requestOptions.extra['m22_probe_record'];
          if (index is int) {
            records[index]
              ..status = error.response?.statusCode ?? 0
              ..finished = true;
          }
          handler.next(error);
        },
      ),
    );
    return dio;
  }

  /// Same wiring as `ministryAudioDownloadManagerProvider`, with the probe Dio.
  Override get override => ministryAudioDownloadManagerProvider.overrideWith((ref) {
        final notifier = ref.watch(ministryContextNotifierProvider.notifier);
        final apiClient = ref.watch(apiClientProvider);
        final transport = DioMinistryAudioTransport(
          apiClient: apiClient,
          policy: MinistryAudioTransferPolicy.forEnvironment(
            ref.watch(appEnvironmentProvider),
          ),
          directDio: _newDio(),
        );
        final manager = MinistryAudioDownloadManager(
          repository: ref.watch(ministryAudioRepositoryProvider),
          transport: transport,
          storage: ref.watch(ministryAudioStorageInfoSourceProvider),
          context: () {
            final session = apiClient.sessionContextProvider?.call();
            final stamp = notifier.contextStamp;
            final ministryId = stamp?.ministryId;
            if (session == null || stamp == null || ministryId == null) return null;
            return MinistryAudioDownloadContext(
              userId: session.userId,
              sessionGeneration: session.sessionGeneration,
              ministryId: ministryId,
              epoch: stamp,
            );
          },
        );
        ref.onDispose(() {
          manager.dispose();
          transport.close();
        });
        return manager;
      });

  /// Sanitized one-line summary for the run log (no URL, no header value).
  String summary() {
    final byDest = <String, int>{};
    for (final r in records) {
      byDest[r.destination] = (byDest[r.destination] ?? 0) + 1;
    }
    final statuses = records.map((r) => r.status).toList();
    final bytes = records.fold<int>(0, (sum, r) => sum + r.bytes);
    final creds = records.where((r) => r.hadCredentialHeader).length;
    final done = records.where((r) => r.finishedMs > 0).toList();
    final spanMs = done.isEmpty
        ? 0
        : done.map((r) => r.finishedMs).reduce((a, b) => a > b ? a : b) -
            records.map((r) => r.startedMs).reduce((a, b) => a < b ? a : b);
    return 'spanMs=$spanMs transfers=${records.length} dest=$byDest statuses=$statuses bytes=$bytes credentialHeaders=$creds';
  }

  /// Parses `vocals=<hex>,drums=<hex>,...` (dart-define `E1_STEM_SHA`).
  static Map<String, String> parseExpectedSha(String raw) => {
        for (final part in raw.split(',').where((p) => p.contains('=')))
          part.split('=').first: part.split('=').last,
      };

  /// Evidence of ONE cold download of six stems straight from R2 over HTTPS.
  /// Returns problems (empty when everything holds). [from] = records already
  /// present before the download under test.
  List<String> verifyColdDownload({
    required int from,
    required int expectedBytes,
    required Map<String, String> expectedSha,
  }) {
    final problems = <String>[];
    final fresh = records.skip(from).toList();
    if (fresh.length != 6) problems.add('expected 6 direct downloads, saw ${fresh.length}');
    for (final r in fresh) {
      if (r.destination != 'r2-https' || r.scheme != 'https') problems.add('${r.stem}: destination ${r.destination}/${r.scheme}');
      if (r.status != 200) problems.add('${r.stem}: HTTP ${r.status}');
      if (!r.finished) problems.add('${r.stem}: stream not finished');
      if (r.bytes != expectedBytes) problems.add('${r.stem}: ${r.bytes} bytes, expected $expectedBytes');
      if (r.hadCredentialHeader) problems.add('${r.stem}: credential header sent to R2');
      final sha = expectedSha[r.stem];
      if (sha != null && sha != r.sha256) problems.add('${r.stem}: SHA-256 differs from the seeded one');
    }
    if (fresh.map((r) => r.stem).toSet().length != 6) problems.add('stems are not six distinct objects');
    return problems;
  }
}
