import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_storage_info.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';
import 'package:dio/dio.dart';

import '../ministry_audio_fixtures.dart';
import 'ministry_audio_download_manager_test.dart'
    show FakeStorage, FakeTransport, FlakyOps, payloadOf, shaOf;

const _recordingBytes = 6 * 84; // six synthetic WAVs of 84 bytes

String idN(int n) => '0123456789abcdef'[n] * 64;

int _salt(String id, int extra) => '0123456789abcdef'.indexOf(id[0]) * 3 + extra;

MinistryAudioPlayback playbackFor(String id, {String version = 'v1', int extra = 0}) {
  final s = _salt(id, extra);
  final json = {
    ...directPlaybackJson(id: id),
    'manifest': manifestJson(
      id: id,
      stems: [
        for (final st in stemIds)
          stemJson(st,
              sampleRate: 8000,
              frames: 10,
              override: {'sha256': shaOf(st, salt: s)}),
      ],
      override: {'recordingVersion': version},
    ),
    'expiresAt': 4000000000000,
    'tracks': [
      for (final st in stemIds)
        {
          'id': st,
          'url': 'https://acct.r2.cloudflarestorage.com/$id/$s/$st?X=SECRET',
          'headers': {'if-match': '"e"'},
        },
    ],
  };
  return MinistryAudioPlayback.fromJson(json);
}

class _Repo implements MinistryAudioRepository {
  final Map<String, MinistryAudioPlayback> byId = {};
  Object? error;
  Future<void>? gate;
  int calls = 0;

  @override
  Future<MinistryAudioPlayback> getPlayback({
    required String ministryId,
    required String recordingId,
    CancelToken? cancelToken,
  }) async {
    calls++;
    if (gate != null) await gate;
    if (error != null) throw error!;
    final p = byId[recordingId];
    if (p == null) {
      throw const AppFailure(message: 'Gravação não encontrada.', statusCode: 404);
    }
    return p;
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

class _FailIndexRename extends MinistryAudioFileOps {
  @override
  Future<void> renameFile(File file, String to) async {
    if (to.replaceAll('\\', '/').endsWith('/index.json')) {
      throw const FileSystemException('simulated crash during index update');
    }
    await super.renameFile(file, to);
  }
}

Matcher _code(String code) =>
    isA<AppFailure>().having((f) => f.code, 'code', code);

MinistryAudioDownloadContext mk(String user, String ministry, String epoch) =>
    MinistryAudioDownloadContext(
        userId: user,
        sessionGeneration: 1,
        ministryId: ministry,
        epoch: epoch);

void main() {
  late Directory temp;
  late String filesDir;
  late _Repo repo;
  late FakeTransport transport;
  var now = 1000;
  MinistryAudioDownloadContext? ctx;

  setUp(() {
    temp = Directory.systemTemp.createTempSync('louvaio_audio_cache_');
    filesDir = temp.path.replaceAll('\\', '/');
    now = 1000;
    ctx = mk('user_1', 'min_1', 'e1');
    repo = _Repo();
    for (var i = 0; i < 6; i++) {
      repo.byId[idN(i)] = playbackFor(idN(i));
    }
    transport = FakeTransport(
      behavior: (s, a, t) => Stream.value(payloadOf(s.name,
          salt: int.parse(Uri.parse(t.url).pathSegments[1]))),
    );
  });

  tearDown(() {
    try {
      temp.deleteSync(recursive: true);
    } catch (_) {}
  });

  ({MinistryAudioCache cache, MinistryAudioDownloadManager manager, FakeStorage storage})
      build({
    int quota = 2 * _recordingBytes + 92,
    MinistryAudioDownloadContext? Function()? context,
    MinistryAudioFileOps ops = const MinistryAudioFileOps(),
    int available = 1 << 30,
    int reserve = 0,
  }) {
    final storage = FakeStorage(filesDir, available: available);
    final manager = MinistryAudioDownloadManager(
      repository: repo,
      transport: transport,
      storage: storage,
      context: context ?? () => ctx,
      fileOps: ops,
      nowMillis: () => now,
      reserveBytes: reserve,
    );
    return (
      cache: MinistryAudioCache(manager: manager, quotaBytes: quota),
      manager: manager,
      storage: storage,
    );
  }

  String rootOf({String user = 'user_1', String ministry = 'min_1'}) =>
      MinistryAudioStorageStatus(
              filesDirPath: filesDir, availableBytes: 0, totalBytes: 0)
          .privateRootFor(userId: user, ministryId: ministry);

  String lp(String path) {
    if (!Platform.isWindows) return path;
    final p = path.replaceAll('/', '\\');
    return p.startsWith(r'\\?\') ? p : '\\\\?\\$p';
  }

  bool exists(String rel, {String user = 'user_1', String ministry = 'min_1'}) =>
      FileSystemEntity.typeSync(lp('${rootOf(user: user, ministry: ministry)}/$rel')) !=
      FileSystemEntityType.notFound;

  List<String> listing(String rel) {
    final d = Directory(lp('${rootOf()}/$rel'));
    if (!d.existsSync()) return [];
    return d.listSync().map((e) => e.path).toList();
  }

  Future<MinistryAudioCachedRecording> get(
    MinistryAudioCache c,
    int n, {
    bool release = true,
    String ministry = 'min_1',
  }) async {
    now += 100;
    final r = await c.ensureCached(ministryId: ministry, recordingId: idN(n));
    if (release) r.release();
    return r;
  }

  Future<List<String>> ids(MinistryAudioCache c) async =>
      [for (final e in await c.entries(ministryId: 'min_1')) e.recordingId];

  group('basics', () {
    test('empty cache downloads, verifies and writes a clean index', () async {
      final r = build();
      expect(await r.cache.entries(ministryId: 'min_1'), isEmpty);
      final got = await get(r.cache, 0);
      expect(got.fromCache, isFalse);
      expect(got.recording.stemPaths.length, 6);
      final entries = await r.cache.entries(ministryId: 'min_1');
      expect(entries.single.recordingId, idN(0));
      expect(entries.single.totalBytes, _recordingBytes);
      expect(entries.single.lastAccessMillis, greaterThan(1000));
      expect(entries.single.integrity, MinistryAudioCacheIntegrity.verified);

      final index = File(lp('${rootOf()}/index.json')).readAsStringSync();
      expect(index, isNot(contains('http')));
      expect(index, isNot(contains('SECRET')));
      expect(index, isNot(contains('token')));
      expect(exists('index.json.tmp'), isFalse);
    });

    test('valid hit revalidates online, skips the transfer and touches access',
        () async {
      final r = build();
      await get(r.cache, 0);
      final opens = transport.opens.values.fold<int>(0, (a, b) => a + b);
      final before = (await r.cache.entries(ministryId: 'min_1')).single;
      final calls = repo.calls;
      final hit = await get(r.cache, 0);
      expect(hit.fromCache, isTrue);
      expect(repo.calls, calls + 1); // revalidated, never trusted blindly
      expect(transport.opens.values.fold<int>(0, (a, b) => a + b), opens);
      final after = (await r.cache.entries(ministryId: 'min_1')).single;
      expect(after.lastAccessMillis, greaterThan(before.lastAccessMillis));
    });

    test('diverging online manifest discards the stale copy and re-downloads',
        () async {
      final r = build();
      await get(r.cache, 0);
      repo.byId[idN(0)] = playbackFor(idN(0), version: 'v2', extra: 1);
      final got = await get(r.cache, 0);
      expect(got.fromCache, isFalse);
      expect(got.recording.recordingVersion, 'v2');
      expect((await r.cache.entries(ministryId: 'min_1')).single.recordingVersion,
          'v2');
      expect(listing('trash'), isEmpty);
    });

    test('same-size altered content is not served from cache', () async {
      final r = build();
      final first = await get(r.cache, 0);
      final f = File(first.recording.stemPaths[MinistryStemId.bass]!);
      final bytes = f.readAsBytesSync()..[5] ^= 1;
      f.writeAsBytesSync(bytes);
      final again = await get(r.cache, 0);
      expect(again.fromCache, isFalse); // corrupt -> discarded and refetched
      final healed = File(again.recording.stemPaths[MinistryStemId.bass]!)
          .readAsBytesSync();
      expect(healed, payloadOf('bass', salt: _salt(idN(0), 0)));
    });

    test('truncated / missing file is re-downloaded', () async {
      final r = build();
      final first = await get(r.cache, 0);
      File(first.recording.stemPaths[MinistryStemId.piano]!).deleteSync();
      expect((await get(r.cache, 0)).fromCache, isFalse);
    });
  });

  group('quota and LRU', () {
    test('evicts the least recently used set when the quota is reached',
        () async {
      final r = build();
      await get(r.cache, 0);
      await get(r.cache, 1);
      await get(r.cache, 2);
      expect(await ids(r.cache), [idN(1), idN(2)]);
      expect(exists('recordings/${idN(0)}'), isFalse);
      expect(listing('trash'), isEmpty);
    });

    test('recency counts: a touched set survives', () async {
      final r = build();
      await get(r.cache, 0);
      await get(r.cache, 1);
      await get(r.cache, 0); // hit refreshes A
      await get(r.cache, 2);
      expect(await ids(r.cache), [idN(0), idN(2)]);
    });

    test('leased (in use) sets are protected even when oldest', () async {
      final r = build();
      final a = await get(r.cache, 0, release: false); // in use
      await get(r.cache, 1);
      await get(r.cache, 2);
      expect(await ids(r.cache), [idN(0), idN(2)]);
      a.release();
      await get(r.cache, 3); // A is now the oldest unprotected
      expect(await ids(r.cache), [idN(2), idN(3)]);
    });

    test('nothing evictable: controlled error, nothing deleted', () async {
      final r = build();
      await get(r.cache, 0, release: false);
      await get(r.cache, 1, release: false);
      await expectLater(get(r.cache, 2),
          throwsA(_code(MinistryAudioCacheCodes.quotaExceeded)));
      expect(await ids(r.cache), [idN(0), idN(1)]);
      expect(exists('recordings/${idN(0)}/manifest.json'), isTrue);
      expect(exists('recordings/${idN(1)}/manifest.json'), isTrue);
      expect(listing('staging'), isEmpty);
    });

    test('a set larger than the whole quota is refused up front', () async {
      final r = build(quota: _recordingBytes - 1);
      await expectLater(get(r.cache, 0),
          throwsA(_code(MinistryAudioCacheCodes.quotaExceeded)));
      expect(transport.opens, isEmpty);
    });

    test('free-space pressure also evicts LRU sets (and restores room)',
        () async {
      final r = build(quota: 1 << 30);
      await get(r.cache, 0);
      r.storage.available = 400; // device nearly full
      await get(r.cache, 1);
      expect(await ids(r.cache), [idN(1)]);
    });

    test('insufficient device space with nothing to free is a clean failure',
        () async {
      final r = build(available: 100);
      await expectLater(get(r.cache, 0),
          throwsA(_code(MinistryAudioDownloadCodes.insufficientSpace)));
      expect(await ids(r.cache), isEmpty);
      expect(listing('staging'), isEmpty);
    });

    test('a write failure leaves nothing ready and the cache usable', () async {
      final r = build(ops: FlakyOps(failSinkOnOpen: 1));
      await expectLater(get(r.cache, 0),
          throwsA(_code(MinistryAudioDownloadCodes.writeFailed)));
      expect(await ids(r.cache), isEmpty);
      expect(listing('staging'), isEmpty);
      expect((await get(build().cache, 0)).fromCache, isFalse);
    });

    test('corrupt sets are never evicted as if complete', () async {
      final r = build();
      final b = await get(r.cache, 1);
      await get(r.cache, 0);
      File(b.recording.stemPaths[MinistryStemId.vocals]!).deleteSync();
      // B is corrupt (still counted), A intact -> only A is evictable.
      await get(r.cache, 2);
      expect(exists('recordings/${idN(1)}'), isTrue);
      expect(exists('recordings/${idN(0)}'), isFalse);
      final states = {
        for (final e in await r.cache.entries(ministryId: 'min_1'))
          e.recordingId: e.state,
      };
      expect(states[idN(1)], MinistryAudioCacheEntryState.corrupt);
    });
  });

  group('scope isolation', () {
    test('eviction never touches other users, ministries or rehearsals',
        () async {
      var other = mk('user_2', 'min_1', 'e5');
      final u2 = build(context: () => other);
      await get(u2.cache, 3);
      other = mk('user_2', 'min_1', 'e5');
      final min2 = mk('user_1', 'min_2', 'e6');
      final m2 = build(context: () => min2);
      await get(m2.cache, 4, ministry: 'min_2');
      Directory('$filesDir/rehearsal_packages').createSync(recursive: true);
      File('$filesDir/rehearsal_packages/keep.bin').writeAsBytesSync([1]);

      final r = build();
      await get(r.cache, 0);
      await get(r.cache, 1);
      await get(r.cache, 2); // evicts only inside user_1 / min_1

      expect(exists('recordings/${idN(3)}/manifest.json', user: 'user_2'), isTrue);
      expect(exists('recordings/${idN(4)}/manifest.json', ministry: 'min_2'),
          isTrue);
      expect(File('$filesDir/rehearsal_packages/keep.bin').existsSync(), isTrue);
      // The other scopes' own entries are not visible from this scope.
      expect(await ids(r.cache), [idN(1), idN(2)]);
    });
  });

  group('online revalidation (fail closed)', () {
    test('logout during revalidation releases nothing and deletes nothing',
        () async {
      final r = build();
      await get(r.cache, 0);
      final gate = Completer<void>();
      repo.gate = gate.future;
      final pending = r.cache.ensureCached(ministryId: 'min_1', recordingId: idN(0));
      final check = expectLater(pending,
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      ctx = null; // logout
      gate.complete();
      await check;
      expect(exists('recordings/${idN(0)}/manifest.json'), isTrue);
    });

    test('A -> B -> A during revalidation is discarded', () async {
      final r = build();
      await get(r.cache, 0);
      final gate = Completer<void>();
      repo.gate = gate.future;
      final pending = r.cache.ensureCached(ministryId: 'min_1', recordingId: idN(0));
      final check = expectLater(pending,
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      ctx = mk('user_1', 'min_2', 'e2');
      ctx = mk('user_1', 'min_1', 'e3'); // back to A with a new stamp
      gate.complete();
      await check;
    });

    for (final entry in {
      401: 'sessão expirada',
      403: 'sem acesso',
      404: 'arquivada ou removida',
    }.entries) {
      test('${entry.key} (${entry.value}) blocks a valid local copy', () async {
        final r = build();
        await get(r.cache, 0);
        repo.error = AppFailure(message: 'x', statusCode: entry.key);
        await expectLater(
            get(r.cache, 0),
            throwsA(isA<AppFailure>()
                .having((f) => f.statusCode, 'status', entry.key)));
        // Failing closed never deletes the local set.
        expect(exists('recordings/${idN(0)}/manifest.json'), isTrue);
      });
    }

    test('archived recording (missing online) is not released', () async {
      final r = build();
      await get(r.cache, 0);
      repo.byId.remove(idN(0));
      await expectLater(get(r.cache, 0),
          throwsA(isA<AppFailure>().having((f) => f.statusCode, 's', 404)));
    });

    test('no network: a valid local copy is not released', () async {
      final r = build();
      await get(r.cache, 0);
      repo.error = AppFailure.network();
      await expectLater(get(r.cache, 0), throwsA(isA<AppFailure>()));
      expect(exists('recordings/${idN(0)}/manifest.json'), isTrue);
    });

    test('unexpected errors become a controlled revalidation failure',
        () async {
      final r = build();
      repo.error = StateError('boom');
      await expectLater(get(r.cache, 0),
          throwsA(_code(MinistryAudioCacheCodes.revalidationFailed)));
    });

    test('no session at all fails closed', () async {
      final r = build();
      ctx = null;
      await expectLater(get(r.cache, 0),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      expect(repo.calls, 0);
    });

    test('a disposed cache releases nothing and drops its leases', () async {
      final r = build(quota: _recordingBytes + 10);
      await get(r.cache, 0, release: false);
      r.cache.dispose();
      await expectLater(get(r.cache, 1),
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      // Its lease is gone, so another cache may evict that set.
      final other = build(quota: _recordingBytes + 10);
      await get(other.cache, 1);
      expect(await ids(other.cache), [idN(1)]);
    });
  });

  group('index and crash recovery', () {
    test('missing index is rebuilt from the disk (hit still validated)',
        () async {
      final r = build();
      await get(r.cache, 0);
      File(lp('${rootOf()}/index.json')).deleteSync();
      expect((await get(r.cache, 0)).fromCache, isTrue);
      expect(exists('index.json'), isTrue);
    });

    test('corrupted index never blocks or authorizes anything', () async {
      final r = build();
      await get(r.cache, 0);
      File(lp('${rootOf()}/index.json')).writeAsStringSync('{broken');
      final e = (await r.cache.entries(ministryId: 'min_1')).single;
      expect(e.recordingId, idN(0));
      expect(e.lastAccessMillis, 0); // unknown recency, still listed
      expect((await get(r.cache, 0)).fromCache, isTrue);
    });

    test('stale index: ghosts are ignored, recency of real sets is kept',
        () async {
      final r = build();
      await get(r.cache, 0);
      File(lp('${rootOf()}/index.json')).writeAsStringSync(jsonEncode({
        'schema': 'louvaio-ministry-audio-cache-index-v1',
        'entries': [
          {
            'recordingId': idN(5),
            'lastAccessMillis': 999,
            'integrity': 'verified',
            'manifestDigest': 'x',
            'totalBytes': 504,
          },
          {
            'recordingId': idN(0),
            'lastAccessMillis': 777,
            'integrity': 'verified',
            'manifestDigest': 'wrong',
            'totalBytes': 1,
          },
        ],
      }));
      final list = await r.cache.entries(ministryId: 'min_1');
      expect(list.single.recordingId, idN(0));
      expect(list.single.lastAccessMillis, 777);
      expect(list.single.totalBytes, _recordingBytes); // from disk, not index
      expect(list.single.integrity, MinistryAudioCacheIntegrity.unverified);
    });

    test('crash while updating the index loses no data', () async {
      final bad = build(ops: _FailIndexRename());
      final got = await get(bad.cache, 0);
      expect(got.recording.stemPaths.length, 6);
      expect(exists('index.json'), isFalse);
      expect(exists('index.json.tmp'), isFalse); // cleaned up
      final good = build();
      expect((await get(good.cache, 0)).fromCache, isTrue);
    });

    test('a leftover half-written index temp file is discarded', () async {
      final r = build();
      await get(r.cache, 0);
      File(lp('${rootOf()}/index.json.tmp')).writeAsStringSync('{"sche');
      await r.cache.entries(ministryId: 'min_1');
      expect(exists('index.json.tmp'), isFalse);
      expect(await ids(r.cache), [idN(0)]);
    });

    test('an interrupted replacement is recovered before the cache serves it',
        () async {
      final r = build();
      final a = await get(r.cache, 0);
      Directory(lp('${rootOf()}/trash')).createSync(recursive: true);
      Directory(lp(a.recording.directoryPath))
          .renameSync(lp('${rootOf()}/trash/txold1'));
      final fresh = build(); // new instance, as after an app restart
      final again = await get(fresh.cache, 0);
      expect(again.fromCache, isTrue); // backup restored, not re-downloaded
      expect(listing('trash'), isEmpty);
    });

    test('bad_evict residue is finished by recovery, never restored',
        () async {
      final r = build();
      final a = await get(r.cache, 0);
      Directory(lp('${rootOf()}/trash')).createSync(recursive: true);
      Directory(lp(a.recording.directoryPath))
          .renameSync(lp('${rootOf()}/trash/bad_evict_x'));
      await get(r.cache, 1);
      expect(await ids(r.cache), [idN(1)]);
      expect(listing('trash'), isEmpty);
    });
  });

  group('concurrency', () {
    test('the same recording requested twice is downloaded once', () async {
      final r = build();
      final results = await Future.wait([
        r.cache.ensureCached(ministryId: 'min_1', recordingId: idN(0)),
        r.cache.ensureCached(ministryId: 'min_1', recordingId: idN(0)),
      ]);
      expect(results.map((e) => e.fromCache).toList(), [false, true]);
      expect(transport.opens.values.fold<int>(0, (a, b) => a + b), 6);
      for (final x in results) {
        x.release();
      }
    });

    test('concurrent downloads never exceed the quota', () async {
      final r = build(quota: _recordingBytes + 10);
      final futures = [
        for (final n in [0, 1, 2])
          r.cache
              .ensureCached(ministryId: 'min_1', recordingId: idN(n))
              .then((x) {
            x.release();
            return x;
          }),
      ];
      await Future.wait(futures);
      final entries = await r.cache.entries(ministryId: 'min_1');
      final total = entries.fold<int>(0, (s, e) => s + e.totalBytes);
      expect(total, lessThanOrEqualTo(_recordingBytes + 10));
      expect(entries.length, 1);
      expect(listing('staging'), isEmpty);
      expect(listing('trash'), isEmpty);
    });

    test('a queued request whose context changed is discarded', () async {
      final r = build();
      final gate = Completer<void>();
      repo.gate = gate.future;
      final first = r.cache.ensureCached(ministryId: 'min_1', recordingId: idN(0));
      final queued = r.cache.ensureCached(ministryId: 'min_1', recordingId: idN(1));
      final check = expectLater(queued,
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      ctx = mk('user_2', 'min_1', 'e9');
      gate.complete();
      await expectLater(first,
          throwsA(_code(HttpMinistryAudioRepository.contextChangedCode)));
      await check;
      expect(exists('recordings/${idN(1)}'), isFalse);
    });
  });
}
