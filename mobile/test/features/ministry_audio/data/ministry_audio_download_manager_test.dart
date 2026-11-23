import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart'
    show IncrementalSha256;
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_storage_info.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_transport.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';

const _frames = 10; // 44 + 10 * 4 = 84 bytes per synthetic WAV
const _rate = 8000;
const _size = 44 + _frames * 4;

List<int> payloadOf(String stem, {int salt = 0}) {
  final index = stemIds.indexOf(stem);
  return List<int>.generate(_size, (i) => (i * 7 + index * 31 + salt) & 0xFF);
}

String shaOf(String stem, {int salt = 0}) =>
    IncrementalSha256.computeHex(payloadOf(stem, salt: salt));

Map<String, dynamic> manifestFor({String version = 'v1', int salt = 0}) =>
    manifestJson(
      stems: [
        for (final s in stemIds)
          stemJson(s,
              sampleRate: _rate,
              frames: _frames,
              override: {'sha256': shaOf(s, salt: salt)}),
      ],
      override: {'recordingVersion': version},
    );

MinistryAudioPlayback playbackOf({
  bool legacy = false,
  int expiresAt = 4000000000000,
  String version = 'v1',
  int salt = 0,
}) {
  final base = legacy ? legacyPlaybackJson() : directPlaybackJson();
  final json = {...base, 'manifest': manifestFor(version: version, salt: salt),
    'expiresAt': expiresAt};
  return MinistryAudioPlayback.fromJson(json);
}

class FakeRepository implements MinistryAudioRepository {
  FakeRepository(this.queue);
  final List<MinistryAudioPlayback> queue;
  int calls = 0;

  @override
  Future<MinistryAudioPlayback> getPlayback({
    required String ministryId,
    required String recordingId,
    CancelToken? cancelToken,
  }) async {
    final i = calls < queue.length ? calls : queue.length - 1;
    calls++;
    return queue[i];
  }

  @override
  Future<MinistryAudioPage> listRecordings({
    required String ministryId,
    String query = '',
    int? limit,
    String? cursor,
    CancelToken? cancelToken,
  }) =>
      throw UnimplementedError();
}

typedef Behavior = Stream<List<int>> Function(
    MinistryStemId stem, int attempt, MinistryAudioTransferTarget target);

class FakeTransport implements MinistryAudioStemTransport {
  FakeTransport({Behavior? behavior, this.contentLengthOf}) {
    this.behavior = behavior ?? ((s, a, t) => Stream.value(payloadOf(s.name)));
  }
  late Behavior behavior;
  int Function(MinistryStemId stem)? contentLengthOf;
  final Map<MinistryStemId, int> opens = {};
  final List<MinistryAudioTransfer> modes = [];

  @override
  Future<MinistryAudioStemResponse> open(
    MinistryAudioTransferTarget target, {
    required String ministryId,
    required CancelToken cancelToken,
  }) async {
    final attempt = (opens[target.id] ?? 0) + 1;
    opens[target.id] = attempt;
    modes.add(target.transfer);
    return MinistryAudioStemResponse(
      body: behavior(target.id, attempt, target),
      contentLength: contentLengthOf?.call(target.id),
    );
  }
}

class FakeStorage implements MinistryAudioStorageInfoSource {
  FakeStorage(this.filesDir, {this.available = 1 << 30});
  final String filesDir;
  int available;
  int queries = 0;

  @override
  Future<MinistryAudioStorageStatus> query() async {
    queries++;
    return MinistryAudioStorageStatus(
        filesDirPath: filesDir, availableBytes: available, totalBytes: 1 << 40);
  }
}

class FlakyOps extends MinistryAudioFileOps {
  FlakyOps({this.failSinkOnOpen, this.failPromote = false});
  final int? failSinkOnOpen; // 1-based sink open index to fail
  bool failPromote;
  int opens = 0;

  @override
  Future<IOSink> openSink(File file) async {
    opens++;
    if (failSinkOnOpen == opens) {
      throw const FileSystemException('disk full');
    }
    return super.openSink(file);
  }

  @override
  Future<void> renameDirectory(Directory dir, String to) async {
    if (failPromote && dir.path.contains('.part')) {
      throw const FileSystemException('rename failed');
    }
    await super.renameDirectory(dir, to);
  }
}

Matcher _code(String code) =>
    isA<AppFailure>().having((f) => f.code, 'code', code);

void main() {
  late Directory temp;
  late MinistryAudioDownloadContext ctx;
  MinistryAudioDownloadContext? Function() contextFn = () => null;
  late FakeStorage storage;

  setUp(() {
    temp = Directory.systemTemp.createTempSync('louvaio_audio_test_');
    storage = FakeStorage(temp.path.replaceAll('\\', '/'));
    ctx = const MinistryAudioDownloadContext(
        userId: 'user_1', sessionGeneration: 1, ministryId: 'min_1', epoch: 'e1');
    contextFn = () => ctx;
  });

  tearDown(() {
    try {
      temp.deleteSync(recursive: true);
    } catch (_) {}
  });

  MinistryAudioDownloadManager manager({
    required FakeRepository repo,
    required FakeTransport transport,
    MinistryAudioFileOps ops = const MinistryAudioFileOps(),
    int now = 1000,
    int maxRenewals = 3,
    int reserve = 0,
  }) =>
      MinistryAudioDownloadManager(
        repository: repo,
        transport: transport,
        storage: storage,
        context: () => contextFn(),
        fileOps: ops,
        nowMillis: () => now,
        reserveBytes: reserve,
        maxRenewals: maxRenewals,
        flushThresholdBytes: 16,
      );

  Directory rootOf({String user = 'user_1', String ministry = 'min_1'}) {
    final u = MinistryAudioStorageStatus.namespaceOf(
        MinistryAudioStorageStatus.userNamespaceDomain, user);
    final m = MinistryAudioStorageStatus.namespaceOf(
        MinistryAudioStorageStatus.ministryNamespaceDomain, ministry);
    return Directory(
        '${storage.filesDir}/ministry_audio_library/v1/users/$u/ministries/$m');
  }

  // Windows host only: the layout (two SHA-256 namespaces) exceeds MAX_PATH,
  // which breaks plain directory listing; list through the extended-length
  // prefix. The manager itself is unaffected (and Android has no such limit).
  Directory longPath(Directory d) {
    if (!Platform.isWindows) return d;
    final p = d.path.replaceAll('/', '\\');
    return Directory(p.startsWith(r'\\?\') ? p : '\\\\?\\$p');
  }

  List<String> listing(Directory dir) {
    final d = longPath(dir);
    if (!d.existsSync()) return [];
    return d
        .listSync(recursive: true)
        .whereType<File>()
        .map((f) => f.path.replaceFirst(r'\\?\', '').replaceAll('\\', '/'))
        .toList();
  }

  bool hasPromoted() {
    final d = longPath(Directory('${rootOf().path}/recordings'));
    return d.existsSync() && d.listSync().isNotEmpty;
  }

  Future<MinistryAudioLocalRecording?> ready(MinistryAudioDownloadManager m) =>
      m.inspectReady(ministryId: 'min_1', recordingId: recordingId);

  Future<void> expectNothingPromoted(MinistryAudioDownloadManager m) async {
    expect(await ready(m), isNull);
    expect(hasPromoted(), isFalse);
    expect(listing(Directory('${rootOf().path}/staging')), isEmpty);
  }

  group('successful download', () {
    test('downloads six verified WAVs and promotes them atomically', () async {
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      final result =
          await m.download(ministryId: 'min_1', recordingId: recordingId);

      expect(result.recordingVersion, 'v1');
      expect(result.stemPaths.keys.toSet(), MinistryStemId.values.toSet());
      for (final id in MinistryStemId.values) {
        final bytes = File(result.stemPaths[id]!).readAsBytesSync();
        expect(bytes, payloadOf(id.name));
      }
      final files = listing(Directory(result.directoryPath))
          .map((p) => p.split('/').last)
          .toSet();
      expect(files, {
        'manifest.json',
        for (final s in stemIds) 'stem_$s.wav',
      });
      expect(listing(Directory('${rootOf().path}/staging')), isEmpty);

      final path = result.directoryPath.replaceAll('\\', '/');
      expect(path, contains('/ministry_audio_library/v1/'));
      expect(path, isNot(contains('rehearsal_packages')));
      expect(path, isNot(contains('user_1')));
      expect(path, isNot(contains('min_1')));

      final manifestText = File('${result.directoryPath}/manifest.json')
          .readAsStringSync();
      expect(manifestText, isNot(contains('SECRET')));
      expect(manifestText, isNot(contains('http')));
      expect(jsonDecode(manifestText)['recordingId'], recordingId);

      final inspected = await ready(m);
      expect(inspected, isNotNull);
      expect(inspected!.recordingVersion, 'v1');
    });

    test('works with legacy transfer targets too', () async {
      final transport = FakeTransport();
      final m = manager(
          repo: FakeRepository([playbackOf(legacy: true)]),
          transport: transport);
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(transport.modes.toSet(), {MinistryAudioTransfer.legacy});
      expect(await ready(m), isNotNull);
    });

    test('re-download replaces the previous copy', () async {
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(await ready(m), isNotNull);
      expect(listing(Directory('${rootOf().path}/trash')), isEmpty);
    });

    test('streams in chunks (never needs a whole WAV in one piece)', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            final bytes = payloadOf(s.name);
            for (var i = 0; i < bytes.length; i += 10) {
              yield bytes.sublist(i, i + 10 > bytes.length ? bytes.length : i + 10);
            }
          },
        ),
      );
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(await ready(m), isNotNull);
    });
  });

  group('integrity', () {
    test('wrong SHA-256 fails and nothing becomes ready', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) => Stream.value(
              payloadOf(s.name, salt: s == MinistryStemId.bass ? 1 : 0)),
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.integrityFailed)));
      await expectNothingPromoted(m);
    });

    test('smaller file fails', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) => Stream.value(
              payloadOf(s.name).sublist(0, s == MinistryStemId.drums ? _size - 1 : _size)),
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.sizeMismatch)));
      await expectNothingPromoted(m);
    });

    test('larger file is cut by the hard byte cap', () async {
      var delivered = 0;
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            final bytes = payloadOf(s.name);
            yield bytes;
            if (s == MinistryStemId.vocals) {
              for (var i = 0; i < 1000; i++) {
                delivered++;
                yield [1, 2, 3, 4];
              }
            }
          },
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.sizeMismatch)));
      expect(delivered, lessThan(2)); // aborted on the first excess chunk
      await expectNothingPromoted(m);
    });

    test('declared Content-Length different from the manifest fails early',
        () async {
      final transport = FakeTransport(contentLengthOf: (_) => _size + 5);
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: transport);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.sizeMismatch)));
      await expectNothingPromoted(m);
    });
  });

  group('interruptions and storage', () {
    test('interruption after three stems never looks ready', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            if (s == MinistryStemId.guitar) {
              yield payloadOf(s.name).sublist(0, 20);
              throw AppFailure.network();
            }
            yield payloadOf(s.name);
          },
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code('NETWORK_ERROR')));
      await expectNothingPromoted(m);
    });

    test('write failure is reported and cleaned', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(),
        ops: FlakyOps(failSinkOnOpen: 2),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.writeFailed)));
      await expectNothingPromoted(m);
    });

    test('insufficient space is detected before any transfer', () async {
      storage.available = 100;
      final transport = FakeTransport();
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: transport);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.insufficientSpace)));
      expect(transport.opens, isEmpty);
      await expectNothingPromoted(m);
    });

    test('free-space reserve is enforced', () async {
      storage.available = 6 * _size + 10; // enough for the files, not the reserve
      final m = manager(
          repo: FakeRepository([playbackOf()]),
          transport: FakeTransport(),
          reserve: 1000);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.insufficientSpace)));
    });

    test('unsupported platform fails before any request', () async {
      final repo = FakeRepository([playbackOf()]);
      final m = MinistryAudioDownloadManager(
        repository: repo,
        transport: FakeTransport(),
        storage: _ThrowingStorage(),
        context: () => ctx,
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(SafMinistryAudioStorageInfoSource.unsupportedPlatformCode)));
      expect(repo.calls, 0);
    });
  });

  group('expiry and renewal', () {
    test('expired signature renews playback and restarts only that stem',
        () async {
      final repo = FakeRepository([playbackOf(), playbackOf()]);
      final transport = FakeTransport(
        behavior: (s, a, t) {
          if (s == MinistryStemId.drums && a == 1) {
            throw const AppFailure(
                message: 'x', code: MinistryAudioTransferCodes.expired);
          }
          return Stream.value(payloadOf(s.name));
        },
      );
      final m = manager(repo: repo, transport: transport);
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(repo.calls, 2);
      expect(transport.opens[MinistryStemId.drums], 2);
      expect(transport.opens[MinistryStemId.vocals], 1);
      expect(await ready(m), isNotNull);
    });

    test('already-expired playback is renewed before using any URL', () async {
      final repo = FakeRepository([
        playbackOf(expiresAt: 1000 + 5000), // within the 20 s safety margin
        playbackOf(expiresAt: 4000000000000),
      ]);
      final m = manager(repo: repo, transport: FakeTransport(), now: 1000);
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(repo.calls, 2);
    });

    test('renewal is bounded (no infinite retry)', () async {
      final repo = FakeRepository([playbackOf()]);
      final transport = FakeTransport(
        behavior: (s, a, t) => throw const AppFailure(
            message: 'x', code: MinistryAudioTransferCodes.expired),
      );
      final m = manager(repo: repo, transport: transport, maxRenewals: 2);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.renewalLimit)));
      expect(repo.calls, 3); // initial + 2 renewals
      expect(transport.opens[MinistryStemId.vocals], 3);
      await expectNothingPromoted(m);
    });

    test('manifest that diverges after renewal aborts safely', () async {
      for (final fresh in [
        playbackOf(version: 'v2'),
        playbackOf(salt: 9),
      ]) {
        final repo = FakeRepository([playbackOf(), fresh]);
        final m = manager(
          repo: repo,
          transport: FakeTransport(
            behavior: (s, a, t) {
              if (s == MinistryStemId.bass && a == 1) {
                throw const AppFailure(
                    message: 'x', code: MinistryAudioTransferCodes.expired);
              }
              return Stream.value(payloadOf(s.name));
            },
          ),
        );
        await expectLater(
            m.download(ministryId: 'min_1', recordingId: recordingId),
            throwsA(_code(MinistryAudioDownloadCodes.manifestChanged)));
        await expectNothingPromoted(m);
      }
    });

    test('If-Match rejected (412) is surfaced without retry', () async {
      final transport = FakeTransport(
        behavior: (s, a, t) => throw const AppFailure(
            message: 'x', code: MinistryAudioTransferCodes.preconditionFailed),
      );
      final repo = FakeRepository([playbackOf()]);
      final m = manager(repo: repo, transport: transport);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioTransferCodes.preconditionFailed)));
      expect(transport.opens[MinistryStemId.vocals], 1);
      expect(repo.calls, 1);
      await expectNothingPromoted(m);
    });

    test('blocked redirect is surfaced without retry', () async {
      final transport = FakeTransport(
        behavior: (s, a, t) => throw const AppFailure(
            message: 'x', code: MinistryAudioTransferCodes.redirectBlocked),
      );
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: transport);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioTransferCodes.redirectBlocked)));
      expect(transport.opens[MinistryStemId.vocals], 1);
    });
  });

  group('context isolation', () {
    test('logout during the transfer discards everything', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            yield payloadOf(s.name).sublist(0, 20);
            if (s == MinistryStemId.drums) contextFn = () => null; // logout
            yield payloadOf(s.name).sublist(20);
          },
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      contextFn = () => ctx;
      await expectNothingPromoted(m);
    });

    test('A -> B -> A during the transfer discards everything', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            yield payloadOf(s.name).sublist(0, 20);
            if (s == MinistryStemId.piano) {
              // same user, same ministry id, but the context epoch advanced
              ctx = const MinistryAudioDownloadContext(
                  userId: 'user_1',
                  sessionGeneration: 1,
                  ministryId: 'min_1',
                  epoch: 'e3');
            }
            yield payloadOf(s.name).sublist(20);
          },
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      await expectNothingPromoted(m);
    });

    test('user switch (session generation) discards the work', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            yield payloadOf(s.name);
            ctx = const MinistryAudioDownloadContext(
                userId: 'user_2',
                sessionGeneration: 2,
                ministryId: 'min_1',
                epoch: 'e1');
          },
        ),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      expect(await ready(m), isNull);
    });

    test('context change right before promotion prevents promotion',
        () async {
      // All six stems finish; the context changes while the local manifest is
      // written, i.e. just before promotion.
      final ops = _HookOps(onManifestSink: () {
        ctx = const MinistryAudioDownloadContext(
            userId: 'user_1',
            sessionGeneration: 1,
            ministryId: 'min_1',
            epoch: 'changed');
      });
      final m = manager(
          repo: FakeRepository([playbackOf()]),
          transport: FakeTransport(),
          ops: ops);
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      expect(ops.manifestWritten, isTrue);
      expect(hasPromoted(), isFalse);
      expect(listing(Directory('${rootOf().path}/staging')), isEmpty);
    });

    test('files of another user are never presented to the new context',
        () async {
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      ctx = const MinistryAudioDownloadContext(
          userId: 'user_2', sessionGeneration: 2, ministryId: 'min_1', epoch: 'e1');
      expect(await ready(m), isNull);
      ctx = const MinistryAudioDownloadContext(
          userId: 'user_1', sessionGeneration: 1, ministryId: 'min_2', epoch: 'e1');
      expect(await m.inspectReady(ministryId: 'min_2', recordingId: recordingId),
          isNull);
    });

    test('request for a ministry that is not the active one is refused',
        () async {
      final repo = FakeRepository([playbackOf()]);
      final m = manager(repo: repo, transport: FakeTransport());
      await expectLater(
          m.download(ministryId: 'min_2', recordingId: recordingId),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      expect(repo.calls, 0);
    });

    test('dispose cancels and later calls fail closed', () async {
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      m.dispose();
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
    });
  });

  group('paths and promotion', () {
    test('path-like or malformed ids are rejected', () async {
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      ctx = const MinistryAudioDownloadContext(
          userId: '../evil', sessionGeneration: 1, ministryId: 'min_1', epoch: 'e1');
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code('AUDIO_STORAGE_INVALID_SCOPE')));
      ctx = const MinistryAudioDownloadContext(
          userId: 'user_1', sessionGeneration: 1, ministryId: 'min_1', epoch: 'e1');
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: '../../x'),
          throwsA(_code(MinistryAudioContract.invalidCode)));
      expect(Directory('${storage.filesDir}/ministry_audio_library').existsSync(),
          isFalse);
    });

    test('only fixed internal names are ever written', () async {
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      final r = await m.download(ministryId: 'min_1', recordingId: recordingId);
      for (final p in listing(Directory(r.directoryPath))) {
        expect(p.split('/').last,
            matches(RegExp(r'^(manifest\.json|stem_(vocals|drums|bass|guitar|piano|other)\.wav)$')));
      }
    });

    test('promotion failure leaves nothing ready', () async {
      final m = manager(
        repo: FakeRepository([playbackOf()]),
        transport: FakeTransport(),
        ops: FlakyOps(failPromote: true),
      );
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.promotionFailed)));
      await expectNothingPromoted(m);
    });

    test('promotion failure restores the previous good copy', () async {
      final ops = FlakyOps();
      final m = manager(
          repo: FakeRepository([playbackOf()]),
          transport: FakeTransport(),
          ops: ops);
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      ops.failPromote = true;
      await expectLater(
          m.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code(MinistryAudioDownloadCodes.promotionFailed)));
      final still = await ready(m);
      expect(still, isNotNull);
      expect(File(still!.stemPaths[MinistryStemId.vocals]!).readAsBytesSync(),
          payloadOf('vocals'));
    });

    test('abandoned .part work is recovered, only inside this root', () async {
      final root = rootOf();
      final stale = Directory('${root.path}/staging/old.part')
        ..createSync(recursive: true);
      File('${stale.path}/stem_vocals.wav.part').writeAsBytesSync([1, 2, 3]);
      Directory('${root.path}/trash/older').createSync(recursive: true);
      final other = rootOf(ministry: 'min_other');
      Directory('${other.path}/staging/foreign.part')
          .createSync(recursive: true);
      File('${other.path}/staging/foreign.part/keep.bin')
          .writeAsBytesSync([9]);

      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      await m.download(ministryId: 'min_1', recordingId: recordingId);

      expect(stale.existsSync(), isFalse);
      expect(Directory('${root.path}/trash/older').existsSync(), isFalse);
      expect(File('${other.path}/staging/foreign.part/keep.bin').existsSync(),
          isTrue);
    });

    test('incomplete staging without manifest is never ready', () async {
      final root = rootOf();
      final dir = Directory('${root.path}/recordings/$recordingId')
        ..createSync(recursive: true);
      for (final s in stemIds.take(5)) {
        File('${dir.path}/stem_$s.wav').writeAsBytesSync(payloadOf(s));
      }
      final m = manager(
          repo: FakeRepository([playbackOf()]), transport: FakeTransport());
      expect(await ready(m), isNull); // no manifest.json
    });
  });
}

class _HookOps extends MinistryAudioFileOps {
  _HookOps({required this.onManifestSink});
  final void Function() onManifestSink;
  bool manifestWritten = false;

  @override
  Future<IOSink> openSink(File file) async {
    if (file.path.endsWith('manifest.json')) {
      manifestWritten = true;
      onManifestSink();
    }
    return super.openSink(file);
  }
}

class _ThrowingStorage implements MinistryAudioStorageInfoSource {
  @override
  Future<MinistryAudioStorageStatus> query() async => throw const AppFailure(
        message: 'x',
        code: SafMinistryAudioStorageInfoSource.unsupportedPlatformCode,
      );
}
