import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_storage_info.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';
import 'ministry_audio_download_manager_test.dart'
    show FakeRepository, FakeStorage, FakeTransport, payloadOf, playbackOf;

/// Renames fail once for the given directory-name fragment (simulates a crash
/// or I/O failure in the middle of a recovery step).
class _FailOnceRename extends MinistryAudioFileOps {
  _FailOnceRename(this.fragment);
  final String fragment;
  bool failed = false;

  @override
  Future<void> renameDirectory(Directory dir, String to) async {
    if (!failed && dir.path.contains(fragment)) {
      failed = true;
      throw const FileSystemException('simulated crash during recovery');
    }
    await super.renameDirectory(dir, to);
  }
}

String _norm(String p) => p.replaceAll('\\', '/');

/// Simulates an access/I-O error (not "file not found") on matching paths.
class _DenyRead extends MinistryAudioFileOps {
  _DenyRead(this.fragment, {this.onlyStems = false});
  final String fragment;
  final bool onlyStems;
  int hits = 0;

  bool _deny(File f) {
    final p = _norm(f.path);
    if (!p.contains(fragment)) return false;
    if (onlyStems && !p.endsWith('.wav')) return false;
    hits++;
    return true;
  }

  FileSystemException get _err => const FileSystemException(
      'denied', 'x', OSError('Permission denied', 13));

  @override
  Future<String> readString(File file) =>
      _deny(file) ? Future.error(_err) : super.readString(file);

  @override
  Future<int> length(File file) =>
      _deny(file) ? Future.error(_err) : super.length(file);
}

/// Fires [onRead] when the first file is opened for hashing.
class _HookRead extends MinistryAudioFileOps {
  _HookRead(this.onRead);
  final void Function() onRead;
  bool fired = false;

  @override
  Stream<List<int>> openRead(File file) {
    if (!fired) {
      fired = true;
      onRead();
    }
    return super.openRead(file);
  }
}

Matcher _code(String code) =>
    isA<AppFailure>().having((f) => f.code, 'code', code);

void main() {
  late Directory temp;
  late FakeStorage storage;
  late MinistryAudioDownloadContext ctx;
  var stashCounter = 0;

  setUp(() {
    temp = Directory.systemTemp.createTempSync('louvaio_audio_recovery_');
    storage = FakeStorage(temp.path.replaceAll('\\', '/'));
    ctx = const MinistryAudioDownloadContext(
        userId: 'user_1', sessionGeneration: 1, ministryId: 'min_1', epoch: 'e1');
  });

  tearDown(() {
    try {
      temp.deleteSync(recursive: true);
    } catch (_) {}
  });

  MinistryAudioDownloadManager newManager({
    List<dynamic>? playbacks,
    FakeTransport? transport,
    MinistryAudioFileOps ops = const MinistryAudioFileOps(),
    MinistryAudioDownloadContext? Function()? context,
    String Function()? tx,
  }) =>
      MinistryAudioDownloadManager(
        repository: FakeRepository(
            List.of(playbacks ?? [playbackOf()]).cast<MinistryAudioPlayback>()),
        transport: transport ?? FakeTransport(),
        storage: storage,
        context: context ?? () => ctx,
        fileOps: ops,
        reserveBytes: 0,
        transactionId: tx,
      );

  Directory root({String user = 'user_1', String ministry = 'min_1'}) =>
      Directory(MinistryAudioStorageStatus(
              filesDirPath: storage.filesDir,
              availableBytes: 0,
              totalBytes: 0)
          .privateRootFor(userId: user, ministryId: ministry));

  Directory longPath(Directory d) {
    if (!Platform.isWindows) return d;
    final p = d.path.replaceAll('/', '\\');
    return Directory(p.startsWith(r'\\?\') ? p : '\\\\?\\$p');
  }

  List<String> files(Directory dir) {
    final d = longPath(dir);
    if (!d.existsSync()) return [];
    return d
        .listSync(recursive: true)
        .whereType<File>()
        .map((f) => f.path.replaceFirst(r'\\?\', '').replaceAll('\\', '/'))
        .toList();
  }

  /// Builds a verified recording (via the real manager) and stashes it outside
  /// the ministry root so tests can place it to recreate on-disk crash states.
  Future<Directory> stash({String version = 'v1', int salt = 0}) async {
    final m = newManager(
      playbacks: [playbackOf(version: version, salt: salt)],
      transport: FakeTransport(
        behavior: (s, a, t) => Stream.value(payloadOf(s.name, salt: salt)),
      ),
    );
    final r = await m.download(ministryId: 'min_1', recordingId: recordingId);
    final dest = Directory('${temp.path}/stash_${stashCounter++}');
    Directory(r.directoryPath).renameSync(dest.path);
    return dest;
  }

  void place(Directory stashed, String relative) {
    final dest = Directory('${root().path}/$relative');
    dest.parent.createSync(recursive: true);
    stashed.renameSync(dest.path);
  }

  Future<String?> readyVersion(MinistryAudioDownloadManager m) async =>
      (await m.inspectReady(ministryId: 'min_1', recordingId: recordingId))
          ?.recordingVersion;

  bool exists(String relative) {
    final path = longPath(Directory('${root().path}/$relative')).path;
    return FileSystemEntity.typeSync(path) != FileSystemEntityType.notFound;
  }

  group('crash recovery of a replacement (A replaced by B)', () {
    test('before the old copy is moved: A stays, staging is discarded',
        () async {
      final a = await stash(version: 'A');
      final b = await stash(version: 'B', salt: 5);
      place(a, 'recordings/$recordingId');
      place(b, 'staging/txb.part');

      final m = newManager();
      expect(await readyVersion(m), 'A');
      expect(files(Directory('${root().path}/staging')), isEmpty);
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('after the old copy is moved: A is restored, never deleted', () async {
      final a = await stash(version: 'A');
      final b = await stash(version: 'B', salt: 5);
      place(a, 'trash/txold1'); // moved by the interrupted promotion
      place(b, 'staging/txb.part');
      expect(exists('recordings/$recordingId'), isFalse);

      final fresh = newManager(); // a NEW instance, as after an app restart
      expect(await readyVersion(fresh), 'A');
      expect(exists('recordings/$recordingId'), isTrue);
      expect(files(Directory('${root().path}/trash')), isEmpty);
      expect(files(Directory('${root().path}/staging')), isEmpty);
    });

    test('A survives a following download that fails before promotion',
        () async {
      final a = await stash(version: 'A');
      place(a, 'trash/txold1');

      final failing = newManager(
        transport: FakeTransport(
          behavior: (s, a2, t) async* {
            yield payloadOf(s.name).sublist(0, 10);
            throw AppFailure.network();
          },
        ),
      );
      await expectLater(
          failing.download(ministryId: 'min_1', recordingId: recordingId),
          throwsA(_code('NETWORK_ERROR')));
      expect(await readyVersion(newManager()), 'A');
    });

    test('a later successful download replaces A by B and cleans the backup',
        () async {
      final a = await stash(version: 'A');
      place(a, 'trash/txold1');
      final m = newManager(
          playbacks: [playbackOf(version: 'B', salt: 5)],
          transport: FakeTransport(
            behavior: (s, a2, t) => Stream.value(payloadOf(s.name, salt: 5)),
          ));
      await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(await readyVersion(m), 'B');
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('before promotion: an incomplete .part is never ready', () async {
      final a = await stash(version: 'A');
      place(a, 'recordings/$recordingId');
      final partial = Directory('${root().path}/staging/txc.part')
        ..createSync(recursive: true);
      File('${partial.path}/stem_vocals.wav.part').writeAsBytesSync([1, 2, 3]);
      expect(await readyVersion(newManager()), 'A');
      expect(files(Directory('${root().path}/staging')), isEmpty);
    });

    test('after promotion, before cleanup: B stands and the backup goes',
        () async {
      final a = await stash(version: 'A');
      final b = await stash(version: 'B', salt: 5);
      place(b, 'recordings/$recordingId'); // promotion completed
      place(a, 'trash/txold1'); // cleanup had not run yet
      expect(await readyVersion(newManager()), 'B');
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('valid backup + damaged new final: the backup is restored', () async {
      final a = await stash(version: 'A');
      final b = await stash(version: 'B', salt: 5);
      // Same size, different content: damage one stem of B.
      final victim = File('${b.path}/stem_piano.wav');
      final bytes = victim.readAsBytesSync();
      bytes[3] ^= 0xFF;
      victim.writeAsBytesSync(bytes);
      place(b, 'recordings/$recordingId');
      place(a, 'trash/txold1');

      expect(await readyVersion(newManager()), 'A');
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('invalid (partial) backup with a valid final: B stands', () async {
      final b = await stash(version: 'B', salt: 5);
      place(b, 'recordings/$recordingId');
      final partial = Directory('${root().path}/trash/txpart')
        ..createSync(recursive: true);
      File('${partial.path}/manifest.json').writeAsStringSync('{"broken":');
      expect(await readyVersion(newManager()), 'B');
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('crash DURING recovery loses nothing; the next recovery finishes',
        () async {
      final a = await stash(version: 'A');
      place(a, 'trash/txold1');

      final crashing = newManager(ops: _FailOnceRename('txold1'));
      await expectLater(
          crashing.inspectReady(ministryId: 'min_1', recordingId: recordingId),
          throwsA(isA<FileSystemException>()));
      // Interrupted: A is still intact in trash, nothing was deleted.
      expect(exists('trash/txold1/manifest.json'), isTrue);
      expect(exists('recordings/$recordingId'), isFalse);

      expect(await readyVersion(newManager()), 'A');
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('crash while setting aside a damaged final is also recoverable',
        () async {
      final a = await stash(version: 'A');
      final b = await stash(version: 'B', salt: 5);
      File('${b.path}/stem_other.wav').writeAsBytesSync([0]); // wrong size
      place(b, 'recordings/$recordingId');
      place(a, 'trash/txold1');

      final crashing = newManager(ops: _FailOnceRename(recordingId));
      await expectLater(
          crashing.inspectReady(ministryId: 'min_1', recordingId: recordingId),
          throwsA(isA<FileSystemException>()));
      expect(exists('trash/txold1/manifest.json'), isTrue); // backup untouched

      expect(await readyVersion(newManager()), 'A');
    });

    test('recovery never touches another ministry or user root', () async {
      final a = await stash(version: 'A');
      final foreign = root(ministry: 'min_other');
      Directory('${foreign.path}/trash/txforeign').createSync(recursive: true);
      File('${foreign.path}/trash/txforeign/keep.bin').writeAsBytesSync([7]);
      Directory('${foreign.path}/staging/other.part')
          .createSync(recursive: true);
      place(a, 'trash/txold1');

      expect(await readyVersion(newManager()), 'A');
      expect(File('${foreign.path}/trash/txforeign/keep.bin').existsSync(), isTrue);
      expect(Directory('${foreign.path}/staging/other.part').existsSync(), isTrue);
    });
  });

  group('ready integrity', () {
    test('same size but altered content is not ready', () async {
      final m = newManager();
      final r = await m.download(ministryId: 'min_1', recordingId: recordingId);
      expect(await readyVersion(m), 'v1');

      final victim = File(r.stemPaths[MinistryStemId.bass]!);
      final bytes = victim.readAsBytesSync();
      bytes[10] ^= 0x01;
      victim.writeAsBytesSync(bytes);
      expect(victim.lengthSync(), bytes.length); // size unchanged

      expect(await readyVersion(m), isNull);
      // Documented cheap mode only checks sizes.
      expect(
          await m.inspectReady(
              ministryId: 'min_1',
              recordingId: recordingId,
              verifyContent: false),
          isNotNull);
    });

    test('a missing or truncated file is not ready', () async {
      final m = newManager();
      final r = await m.download(ministryId: 'min_1', recordingId: recordingId);
      File(r.stemPaths[MinistryStemId.guitar]!).deleteSync();
      expect(await readyVersion(m), isNull);
    });
  });

  group('inspectReady context isolation', () {
    MinistryAudioDownloadContext mk(String user, String ministry, String epoch) =>
        MinistryAudioDownloadContext(
            userId: user,
            sessionGeneration: 1,
            ministryId: ministry,
            epoch: epoch);

    /// Holds the process-wide gate with a download blocked on [release].
    Future<MinistryAudioLocalRecording> hold(Completer<void> release) =>
        newManager(
          transport: FakeTransport(
            behavior: (s, a, t) async* {
              await release.future;
              yield payloadOf(s.name);
            },
          ),
        ).download(ministryId: 'min_1', recordingId: recordingId);

    Future<void> seedReady() async {
      await newManager()
          .download(ministryId: 'min_1', recordingId: recordingId);
    }

    test('stable context returns the verified recording', () async {
      await seedReady();
      final r = await newManager()
          .inspectReady(ministryId: 'min_1', recordingId: recordingId);
      expect(r, isNotNull);
      expect(r!.stemPaths.length, 6);
    });

    test('queued inspection is discarded when the user switches', () async {
      await seedReady();
      final release = Completer<void>();
      final held = hold(release);
      var now = mk('user_1', 'min_1', 'e1');
      final queued = newManager(context: () => now)
          .inspectReady(ministryId: 'min_1', recordingId: recordingId);
      now = mk('user_2', 'min_1', 'e7'); // account switch while queued
      release.complete();
      await held;
      expect(await queued, isNull);
    });

    test('queued inspection is discarded on A -> B -> A (new stamp)', () async {
      await seedReady();
      final release = Completer<void>();
      final held = hold(release);
      var now = mk('user_1', 'min_1', 'e1');
      final queued = newManager(context: () => now)
          .inspectReady(ministryId: 'min_1', recordingId: recordingId);
      now = mk('user_1', 'min_2', 'e2');
      now = mk('user_1', 'min_1', 'e3'); // back to A, but a new context stamp
      release.complete();
      await held;
      expect(await queued, isNull);
    });

    test('after dispose it returns null, even before the queue', () async {
      await seedReady();
      final m = newManager();
      m.dispose();
      expect(
          await m.inspectReady(ministryId: 'min_1', recordingId: recordingId),
          isNull);
    });

    test('dispose while queued discards the result', () async {
      await seedReady();
      final release = Completer<void>();
      final held = hold(release);
      final m = newManager();
      final queued =
          m.inspectReady(ministryId: 'min_1', recordingId: recordingId);
      m.dispose();
      release.complete();
      await held;
      expect(await queued, isNull);
    });

    test('context change while hashing returns null', () async {
      await seedReady();
      var now = mk('user_1', 'min_1', 'e1');
      final ops = _HookRead(() => now = mk('user_1', 'min_1', 'e2'));
      final r = await newManager(ops: ops, context: () => now)
          .inspectReady(ministryId: 'min_1', recordingId: recordingId);
      expect(ops.fired, isTrue);
      expect(r, isNull);
    });

    test('no path of another account after logout or switch', () async {
      await seedReady();
      MinistryAudioDownloadContext? now = mk('user_1', 'min_1', 'e1');
      final m = newManager(context: () => now);
      expect(
          await m.inspectReady(ministryId: 'min_1', recordingId: recordingId),
          isNotNull);
      now = null; // logout
      expect(
          await m.inspectReady(ministryId: 'min_1', recordingId: recordingId),
          isNull);
      now = mk('user_2', 'min_1', 'e9'); // other account: own (empty) root
      expect(
          await m.inspectReady(ministryId: 'min_1', recordingId: recordingId),
          isNull);
    });
  });

  group('I/O errors never cost the only backup', () {
    test('unreadable backup is kept, then restored once readable', () async {
      final a = await stash(version: 'A');
      place(a, 'trash/txold1');

      final denied = _DenyRead('trash/txold1');
      expect(
          await newManager(ops: denied)
              .inspectReady(ministryId: 'min_1', recordingId: recordingId),
          isNull);
      expect(denied.hits, greaterThan(0));
      expect(exists('trash/txold1/manifest.json'), isTrue); // not deleted
      expect(exists('recordings/$recordingId'), isFalse);

      expect(await readyVersion(newManager()), 'A'); // idempotent retry
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('unreadable final keeps a valid backup (no guess)', () async {
      final a = await stash(version: 'A');
      final b = await stash(version: 'B', salt: 5);
      place(b, 'recordings/$recordingId');
      place(a, 'trash/txold1');

      final denied = _DenyRead('recordings/$recordingId');
      await newManager(ops: denied)
          .inspectReady(ministryId: 'min_1', recordingId: recordingId);
      expect(exists('trash/txold1/manifest.json'), isTrue); // backup kept
      expect(exists('recordings/$recordingId/manifest.json'), isTrue);

      expect(await readyVersion(newManager()), 'B'); // final readable again
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('unreadable stem file (not "missing") keeps the backup', () async {
      final a = await stash(version: 'A');
      place(a, 'trash/txold1');
      final denied = _DenyRead('trash/txold1', onlyStems: true);
      await newManager(ops: denied)
          .inspectReady(ministryId: 'min_1', recordingId: recordingId);
      expect(denied.hits, greaterThan(0));
      expect(exists('trash/txold1/manifest.json'), isTrue);
      expect(await readyVersion(newManager()), 'A');
    });

    test('a proven-absent manifest in a backup is invalid (removable)',
        () async {
      Directory('${root().path}/trash/txempty').createSync(recursive: true);
      expect(await readyVersion(newManager()), isNull);
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });
  });

  group('concurrency', () {
    test('two downloads of the same recording run one at a time', () async {
      final log = <String>[];
      FakeTransport tagged(String tag) => FakeTransport(
            behavior: (s, a, t) async* {
              log.add('$tag:start:${s.name}');
              await Future<void>.delayed(const Duration(milliseconds: 5));
              yield payloadOf(s.name);
              log.add('$tag:end:${s.name}');
            },
          );
      final one = newManager(transport: tagged('one'));
      final two = newManager(transport: tagged('two'));

      final results = await Future.wait([
        one.download(ministryId: 'min_1', recordingId: recordingId),
        two.download(ministryId: 'min_1', recordingId: recordingId),
      ]);
      expect(results.length, 2);

      final firstTwo = log.indexWhere((e) => e.startsWith('two:'));
      final lastOne = log.lastIndexWhere((e) => e.startsWith('one:'));
      expect(firstTwo, greaterThan(lastOne),
          reason: 'second download must wait for the first: $log');
      expect(await readyVersion(one), 'v1');
      expect(files(Directory('${root().path}/staging')), isEmpty);
      expect(files(Directory('${root().path}/trash')), isEmpty);
    });

    test('operations of different ministries are serialized too', () async {
      final log = <String>[];
      FakeTransport tagged(String tag) => FakeTransport(
            behavior: (s, a, t) async* {
              log.add('$tag:${s.name}');
              await Future<void>.delayed(const Duration(milliseconds: 3));
              yield payloadOf(s.name);
            },
          );
      const other = MinistryAudioDownloadContext(
          userId: 'user_2',
          sessionGeneration: 1,
          ministryId: 'min_2',
          epoch: 'e9');
      final one = newManager(transport: tagged('one'));
      final two = newManager(transport: tagged('two'), context: () => other);
      await Future.wait([
        one.download(ministryId: 'min_1', recordingId: recordingId),
        two.download(ministryId: 'min_2', recordingId: recordingId),
      ]);
      final firstTwo = log.indexWhere((e) => e.startsWith('two:'));
      final lastOne = log.lastIndexWhere((e) => e.startsWith('one:'));
      expect(firstTwo, greaterThan(lastOne), reason: '$log');
    });

    test('a queued download whose context changed while waiting is discarded',
        () async {
      final gate = Completer<void>();
      final slow = newManager(
        transport: FakeTransport(
          behavior: (s, a, t) async* {
            await gate.future;
            yield payloadOf(s.name);
          },
        ),
      );
      var epoch = 'e1';
      final queued = newManager(
        context: () => MinistryAudioDownloadContext(
            userId: 'user_1',
            sessionGeneration: 1,
            ministryId: 'min_1',
            epoch: epoch),
      );
      final first =
          slow.download(ministryId: 'min_1', recordingId: recordingId);
      final second =
          queued.download(ministryId: 'min_1', recordingId: recordingId);
      final check = expectLater(second,
          throwsA(isA<AppFailure>()));
      epoch = 'changed'; // context moves on while the second one is queued
      gate.complete();
      await first;
      await check;
    });

    test('a failure never poisons the queue', () async {
      final bad = newManager(
        transport: FakeTransport(
            behavior: (s, a, t) => throw AppFailure.network()),
      );
      final good = newManager();
      final r1 = bad.download(ministryId: 'min_1', recordingId: recordingId);
      final r2 = good.download(ministryId: 'min_1', recordingId: recordingId);
      await expectLater(r1, throwsA(isA<AppFailure>()));
      expect((await r2).recordingVersion, 'v1');
    });
  });
}
