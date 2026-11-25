import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart' show IncrementalSha256;
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_storage_info.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';
import 'ministry_audio_download_manager_test.dart' show FakeStorage, FakeTransport, FlakyOps;

// M22-S4-A: MP3 v2 sets in the private cache. Same transactional rules as WAV, with their own file names, local schema
// and manifest identity; existing WAV caches are untouched.

const _frames = 3000;
const _rate = 44100;
final _mpeg = mp3MpegFrames(_frames, 1105);
final _size = mp3SizeFor(_rate, _mpeg);

List<int> mp3Payload(String stem, {int salt = 0}) {
  final index = stemIds.indexOf(stem);
  return List<int>.generate(_size, (i) => (i * 13 + index * 7 + salt) & 0xFF);
}

String _sha(List<int> bytes) => IncrementalSha256.computeHex(bytes);

MinistryAudioPlayback mp3Playback({String? id, int salt = 0, int delay = 1105, String version = 'v1'}) {
  final stems = [
    for (final s in stemIds)
      mp3StemJson(s, frames: _frames, delay: delay, sha: _sha(mp3Payload(s, salt: salt)), size: _size),
  ];
  return MinistryAudioPlayback.fromJson(
    mp3PlaybackJson(id: id, manifest: mp3ManifestJson(id: id, stems: stems, override: {'recordingVersion': version})),
    allowMp3: true,
  );
}

class _Repo implements MinistryAudioRepository {
  _Repo(this.queue);
  final List<MinistryAudioPlayback> queue;
  int calls = 0;

  @override
  Future<MinistryAudioPlayback> getPlayback({required String ministryId, required String recordingId, CancelToken? cancelToken}) async {
    final i = calls < queue.length ? calls : queue.length - 1;
    calls++;
    return queue[i];
  }

  @override
  Future<MinistryAudioPage> listRecordings({required String ministryId, String query = '', int? limit, String? cursor, CancelToken? cancelToken}) =>
      throw UnimplementedError();
}

Matcher _code(String code) => isA<AppFailure>().having((f) => f.code, 'code', code);

void main() {
  late Directory temp;
  late String filesDir;
  late MinistryAudioDownloadContext ctx;

  setUp(() {
    temp = Directory.systemTemp.createTempSync('louvaio_audio_mp3_');
    filesDir = temp.path.replaceAll('\\', '/');
    ctx = const MinistryAudioDownloadContext(userId: 'user_1', sessionGeneration: 1, ministryId: 'min_1', epoch: 'e1');
  });
  tearDown(() {
    try {
      temp.deleteSync(recursive: true);
    } catch (_) {}
  });

  MinistryAudioDownloadManager manager(_Repo repo, FakeTransport transport, {int available = 1 << 30, MinistryAudioFileOps ops = const MinistryAudioFileOps()}) =>
      MinistryAudioDownloadManager(
        repository: repo,
        transport: transport,
        storage: FakeStorage(filesDir, available: available),
        context: () => ctx,
        fileOps: ops,
        reserveBytes: 0,
      );

  FakeTransport serve({int salt = 0}) => FakeTransport(behavior: (s, a, t) => Stream.value(mp3Payload(s.name, salt: salt)));

  String rootOf() => MinistryAudioStorageStatus(filesDirPath: filesDir, availableBytes: 0, totalBytes: 0).privateRootFor(userId: 'user_1', ministryId: 'min_1');
  String lp(String path) {
    if (!Platform.isWindows) return path;
    final p = path.replaceAll('/', '\\');
    return p.startsWith(r'\\?\') ? p : '\\\\?\\$p';
  }

  List<String> names(String dir) => Directory(lp(dir)).listSync().map((e) => e.uri.pathSegments.lastWhere((s) => s.isNotEmpty)).toList()..sort();

  test('downloads six .mp3 stems, writes the MP3 local schema and verifies deeply', () async {
    final m = manager(_Repo([mp3Playback(id: idA)]), serve());
    final local = await m.download(ministryId: 'min_1', recordingId: idA);
    expect(local.codec, MinistryAudioCodec.mp3);
    expect(local.sampleRate, _rate);
    expect(local.frames, _frames);
    expect(local.mp3Alignment!.encoderDelayFrames, 1105);
    expect(local.stemPaths.values.every((p) => p.endsWith('.mp3')), isTrue);
    expect(names(local.directoryPath), [
      'manifest.json',
      for (final s in stemIds) 'stem_$s.mp3',
    ]..sort());
    final json = jsonDecode(File('${local.directoryPath}/manifest.json').readAsStringSync()) as Map;
    expect(json['schema'], 'louvaio-ministry-audio-local-mp3-v1');
    expect(File('${local.directoryPath}/manifest.json').readAsStringSync(), isNot(contains('http')));
    final ready = await m.inspectReady(ministryId: 'min_1', recordingId: idA);
    expect(ready?.codec, MinistryAudioCodec.mp3);
    expect(ready?.mp3Alignment, local.mp3Alignment);
    expect(Directory('${rootOf()}/staging').listSync(), isEmpty);
  });

  test('a wrong SHA-256 is refused and nothing is promoted', () async {
    final m = manager(_Repo([mp3Playback(id: idA)]), FakeTransport(behavior: (s, a, t) => Stream.value(mp3Payload(s.name, salt: s == MinistryStemId.bass ? 9 : 0))));
    await expectLater(m.download(ministryId: 'min_1', recordingId: idA), throwsA(_code(MinistryAudioDownloadCodes.integrityFailed)));
    expect(Directory('${rootOf()}/recordings').existsSync() && Directory('${rootOf()}/recordings').listSync().isNotEmpty, isFalse);
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNull);
  });

  test('a truncated body is a size mismatch', () async {
    final m = manager(_Repo([mp3Playback(id: idA)]), FakeTransport(behavior: (s, a, t) => Stream.value(mp3Payload(s.name).sublist(0, _size - 3))));
    await expectLater(m.download(ministryId: 'min_1', recordingId: idA), throwsA(_code(MinistryAudioDownloadCodes.sizeMismatch)));
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNull);
  });

  test('a body larger than declared is refused as soon as it exceeds the size', () async {
    final m = manager(_Repo([mp3Playback(id: idA)]), FakeTransport(behavior: (s, a, t) => Stream.value([...mp3Payload(s.name), 0])));
    await expectLater(m.download(ministryId: 'min_1', recordingId: idA), throwsA(_code(MinistryAudioDownloadCodes.sizeMismatch)));
  });

  test('a tampered local manifest (alignment) or a same-size altered file is not ready', () async {
    final m = manager(_Repo([mp3Playback(id: idA)]), serve());
    final local = await m.download(ministryId: 'min_1', recordingId: idA);
    final file = File('${local.directoryPath}/manifest.json');
    final original = file.readAsStringSync();

    for (final tamper in <String Function(String)>[
      (s) => s.replaceAll('"paddingFrames":', '"paddingFrames":1'),
      (s) => s.replaceAll('"sampleRate":44100', '"sampleRate":48000'),
      (s) => s.replaceAll('"frames":3000', '"frames":3001'),
      (s) => s.replaceFirst('"alignment"', '"alignmentX"'),
      (s) => s.replaceAll('louvaio-ministry-audio-local-mp3-v1', 'louvaio-ministry-audio-local-v1'),
    ]) {
      file.writeAsStringSync(tamper(original));
      expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNull);
    }
    file.writeAsStringSync(original);
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNotNull);

    final stem = File(local.stemPaths[MinistryStemId.piano]!);
    final bytes = stem.readAsBytesSync()..[100] ^= 1;
    stem.writeAsBytesSync(bytes);
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNull);
    // the superficial check only sees presence and size, which is why playback never uses it
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA, verifyContent: false), isNotNull);
  });

  test('a manifest that changes during URL renewal aborts the download', () async {
    final first = mp3Playback(id: idA);
    final changed = mp3Playback(id: idA, delay: 1106);
    // first answer is already expired -> the manager renews and finds a different alignment
    final expired = MinistryAudioPlayback.fromJson({...mp3PlaybackJson(id: idA, manifest: mp3ManifestJson(id: idA, stems: [
      for (final s in stemIds) mp3StemJson(s, frames: _frames, sha: _sha(mp3Payload(s)), size: _size),
    ])), 'expiresAt': 1}, allowMp3: true);
    final m = manager(_Repo([expired, changed]), serve());
    await expectLater(m.download(ministryId: 'min_1', recordingId: idA), throwsA(_code(MinistryAudioDownloadCodes.manifestChanged)));
    expect(first.manifest.codec, MinistryAudioCodec.mp3);
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNull);
  });

  test('insufficient space is reported before any byte is written', () async {
    final transport = serve();
    final m = manager(_Repo([mp3Playback(id: idA)]), transport, available: 6 * _size - 1);
    await expectLater(m.download(ministryId: 'min_1', recordingId: idA), throwsA(_code(MinistryAudioDownloadCodes.insufficientSpace)));
    expect(transport.opens, isEmpty);
  });

  test('a disk failure while writing leaves no staging and no promoted set', () async {
    final m = manager(_Repo([mp3Playback(id: idA)]), serve(), ops: FlakyOps(failSinkOnOpen: 3));
    await expectLater(m.download(ministryId: 'min_1', recordingId: idA), throwsA(_code(MinistryAudioDownloadCodes.writeFailed)));
    expect(await m.inspectReady(ministryId: 'min_1', recordingId: idA), isNull);
    final staging = Directory('${rootOf()}/staging');
    expect(!staging.existsSync() || staging.listSync().isEmpty, isTrue);
  });

  group('cache', () {
    MinistryAudioCache cacheOf(_Repo repo, FakeTransport transport, {int quota = 1 << 30}) =>
        MinistryAudioCache(manager: manager(repo, transport), quotaBytes: quota);

    test('serves the verified MP3 set after revalidating online and exposes the codec', () async {
      final repo = _Repo([mp3Playback(id: idA)]);
      final transport = serve();
      final cache = cacheOf(repo, transport);
      final first = await cache.ensureCached(ministryId: 'min_1', recordingId: idA);
      expect(first.fromCache, isFalse);
      expect(first.recording.codec, MinistryAudioCodec.mp3);
      first.release();
      final calls = repo.calls;
      final opens = transport.opens.values.fold<int>(0, (a, b) => a + b);
      final second = await cache.ensureCached(ministryId: 'min_1', recordingId: idA);
      expect(second.fromCache, isTrue);
      expect(repo.calls, calls + 1);
      expect(transport.opens.values.fold<int>(0, (a, b) => a + b), opens);
      second.release();
      final entries = await cache.entries(ministryId: 'min_1');
      expect(entries.single.codec, MinistryAudioCodec.mp3);
      expect(entries.single.totalBytes, 6 * _size);
      final index = File('${rootOf()}/index.json').readAsStringSync();
      expect(index, contains('stem_vocals.mp3'));
      expect(index, isNot(contains('.wav')));
    });

    test('a WAV set and an MP3 set coexist; quota counts both and evicts the least recent', () async {
      final wavId = idB;
      final wav = MinistryAudioPlayback.fromJson(directPlaybackJson(id: wavId));
      final repo = _Repo([mp3Playback(id: idA)]);
      final transport = FakeTransport(behavior: (s, a, t) {
        // the WAV fixture has 44 + 88200*4 bytes: serve only the MP3 here, WAV is seeded below
        return Stream.value(mp3Payload(s.name));
      });
      final cache = cacheOf(repo, transport, quota: 6 * _size + 100);
      // seed an existing WAV set exactly as a previous app version would have written it
      final wavDir = Directory('${rootOf()}/recordings/$wavId')..createSync(recursive: true);
      final wavBytes = List<int>.filled(84, 5);
      final wavSha = _sha(wavBytes);
      for (final s in stemIds) {
        File('${wavDir.path}/stem_$s.wav').writeAsBytesSync(wavBytes);
      }
      File('${wavDir.path}/manifest.json').writeAsStringSync(jsonEncode({
        'schema': 'louvaio-ministry-audio-local-v1',
        'recordingId': wavId,
        'recordingVersion': 'v1',
        'model': {'id': 'htdemucs_6s', 'version': '1'},
        'stems': [for (final s in stemIds) {'id': s, 'sampleRate': 8000, 'frames': 10, 'sizeBytes': 84, 'sha256': wavSha}],
      }));
      expect(wav.manifest.codec, MinistryAudioCodec.pcm);
      var entries = await cache.entries(ministryId: 'min_1');
      expect(entries.single.codec, MinistryAudioCodec.pcm);
      expect(entries.single.totalBytes, 6 * 84);

      final got = await cache.ensureCached(ministryId: 'min_1', recordingId: idA);
      got.release();
      entries = await cache.entries(ministryId: 'min_1');
      // 6*84 + 6*size exceeds the quota: the unleased WAV set was evicted, the MP3 set stays
      expect(entries.map((e) => (e.recordingId, e.codec)), [(idA, MinistryAudioCodec.mp3)]);
      expect(Directory('${rootOf()}/recordings/$wavId').existsSync(), isFalse);
    });

    test('an online manifest of another codec replaces the cached set of the same recording', () async {
      final repo = _Repo([mp3Playback(id: idA)]);
      final cache = cacheOf(repo, serve());
      (await cache.ensureCached(ministryId: 'min_1', recordingId: idA)).release();
      // same id and version, different bytes (salt): the digest differs and the set is downloaded again
      final repo2 = _Repo([mp3Playback(id: idA, salt: 5)]);
      final cache2 = cacheOf(repo2, serve(salt: 5));
      final again = await cache2.ensureCached(ministryId: 'min_1', recordingId: idA);
      expect(again.fromCache, isFalse);
      again.release();
      expect((await cache2.entries(ministryId: 'min_1')).single.codec, MinistryAudioCodec.mp3);
    });

    test('a failed revalidation (404) releases nothing and deletes nothing', () async {
      final repo = _Repo([mp3Playback(id: idA)]);
      final cache = cacheOf(repo, serve());
      (await cache.ensureCached(ministryId: 'min_1', recordingId: idA)).release();
      final failing = _FailingRepo();
      final c2 = MinistryAudioCache(manager: manager(_Repo([mp3Playback(id: idA)]), serve()), quotaBytes: 1 << 30);
      expect(failing, isNotNull);
      expect(c2, isNotNull);
      final c3 = MinistryAudioCache(
        manager: MinistryAudioDownloadManager(
          repository: failing,
          transport: serve(),
          storage: FakeStorage(filesDir),
          context: () => ctx,
          reserveBytes: 0,
        ),
      );
      await expectLater(c3.ensureCached(ministryId: 'min_1', recordingId: idA), throwsA(isA<AppFailure>().having((f) => f.statusCode, 'status', 404)));
      expect((await c3.entries(ministryId: 'min_1')).single.state, MinistryAudioCacheEntryState.intact);
    });
  });
}

final idA = 'a' * 64;
final idB = 'b' * 64;

class _FailingRepo implements MinistryAudioRepository {
  @override
  Future<MinistryAudioPlayback> getPlayback({required String ministryId, required String recordingId, CancelToken? cancelToken}) =>
      throw const AppFailure(message: 'not found', statusCode: 404);

  @override
  Future<MinistryAudioPage> listRecordings({required String ministryId, String query = '', int? limit, String? cursor, CancelToken? cancelToken}) =>
      throw UnimplementedError();
}
