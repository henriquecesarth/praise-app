import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_manager.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/domain/rehearsal_package_models.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/presentation/controllers/rehearsal_package_controller.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import '../../support/rehearsal_package_corpus.dart';

final class _FakeSafPort implements RehearsalPackageSafPort {
  _FakeSafPort({required this.filesDirPath});

  final String filesDirPath;
  final StreamController<SafProgressEvent> _progressController =
      StreamController<SafProgressEvent>.broadcast();

  Uint8List? nextPickArchiveBytes;

  @override
  Stream<SafProgressEvent> get progressStream => _progressController.stream;

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    return SafStorageInfo(
      filesDirPath: filesDirPath,
      availableBytes: 1024 * 1024 * 1024,
      totalBytes: 8 * 1024 * 1024 * 1024,
    );
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) async {
    final bytes = nextPickArchiveBytes;
    if (bytes == null) {
      return const SafStageResult(status: SafStageStatus.cancelled);
    }
    final targetFile = File(targetStageFilePath);
    targetFile.parent.createSync(recursive: true);
    targetFile.writeAsBytesSync(bytes, flush: true);
    return SafStageResult(
      status: SafStageStatus.staged,
      stagedFilePath: targetFile.path,
      bytesCopied: bytes.length,
    );
  }

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) async {
    return const SafExportResult(status: SafExportStatus.cancelled);
  }

  @override
  Future<bool> cancelOperation({String? operationId}) async => true;

  Future<void> dispose() async {
    await _progressController.close();
  }
}

Uint8List _buildValidPackageZip({
  String packageId = '11111111-1111-4111-8111-111111111111',
  int revision = 1,
  String displayName = 'Santo Pra Sempre - Ensaio',
  int seedOffset = 0,
  bool includeOriginal = true,
}) {
  final baseManifest = Map<String, dynamic>.from(
    loadReferenceManifest(
      includeOriginal
          ? 'valid-with-original-and-practice.manifest.json'
          : 'valid-wav-minimal.manifest.json',
    ),
  );
  baseManifest['packageId'] = packageId;
  baseManifest['revision'] = revision;
  baseManifest['displayName'] = displayName;

  final entries = <SyntheticZipEntry>[];
  final stems = <Map<String, dynamic>>[];

  for (var i = 0; i < 4; i++) {
    final stemId = ['vocals', 'drums', 'bass', 'other'][i];
    final path = 'stems/$stemId.wav';
    final bytes = buildSyntheticWavPcm16(
      seed: 10 + seedOffset + i,
      frames: 4410,
    );
    stems.add({
      'id': stemId,
      'path': path,
      'container': 'wav',
      'codec': 'pcm_s16le',
      'bitsPerSample': 16,
      'byteLength': bytes.length,
      'sha256': IncrementalSha256.computeHex(bytes),
      'sampleRate': 44100,
      'channels': 2,
      'decodedFrames': 4410,
    });
    entries.add(SyntheticZipEntry(path: path, uncompressedData: bytes));
  }
  baseManifest['stems'] = stems;

  if (includeOriginal) {
    const origPath = 'audio/original.wav';
    final origBytes = buildSyntheticWavPcm16(
      seed: 99 + seedOffset,
      frames: 4410,
    );
    final origSha = IncrementalSha256.computeHex(origBytes);
    baseManifest['original'] = {
      'included': true,
      'path': origPath,
      'container': 'wav',
      'codec': 'pcm_s16le',
      'bitsPerSample': 16,
      'byteLength': origBytes.length,
      'sha256': origSha,
      'sampleRate': 44100,
      'channels': 2,
      'decodedFrames': 4410,
    };
    (baseManifest['source'] as Map<String, dynamic>)['sha256'] = origSha;
    entries.add(SyntheticZipEntry(path: origPath, uncompressedData: origBytes));
  } else {
    baseManifest['original'] = {'included': false};
  }

  final manifestBytes = Uint8List.fromList(
    utf8.encode(jsonEncode(baseManifest)),
  );
  return buildSyntheticZip([
    SyntheticZipEntry(path: 'manifest.json', uncompressedData: manifestBytes),
    ...entries,
  ]);
}

const _packageId = '11111111-1111-4111-8111-111111111111';
const _song = SongDetail(
  id: 'song',
  ministryId: 'm',
  title: 'Song',
  versions: [
    SongVersion(id: 'one', name: 'One'),
    SongVersion(id: 'two', name: 'Two'),
  ],
);
const _songWithoutOne = SongDetail(
  id: 'song',
  ministryId: 'm',
  title: 'Song',
  versions: [SongVersion(id: 'two', name: 'Two')],
);

final class _CommitPause {
  _CommitPause({this.fail = false});
  final bool fail;
  final reached = Completer<void>();
  final release = Completer<void>();
  void resume() {
    if (!release.isCompleted) release.complete();
  }
}

final class _Fixture {
  _Fixture() {
    saf = _FakeSafPort(filesDirPath: dir.path);
    manager = RehearsalPackageManager(
      safPort: saf,
      debugBeforeIndexCommit: (tmp, target) async {
        await beforeCommit?.call();
        final pause = _nextPause;
        _nextPause = null;
        if (pause == null) return;
        pause.reached.complete();
        await pause.release.future;
        if (pause.fail) {
          throw const FileSystemException('injected index commit failure');
        }
      },
    );
    notifier = SongVersionAudioBindingsNotifier(
      manager: manager,
      currentUserIdReader: () => userId,
      onlineReader: () => true,
    );
    addTearDown(() async {
      for (final pause in pauses) {
        pause.resume();
      }
      notifier.dispose();
      await saf.dispose();
      dir.deleteSync(recursive: true);
    });
  }
  final dir = Directory.systemTemp.createTempSync(
    'louvaio_binding_concurrency_',
  );
  late final _FakeSafPort saf;
  late final RehearsalPackageManager manager;
  late final SongVersionAudioBindingsNotifier notifier;
  String? userId = 'a';
  Future<void> Function()? beforeCommit;
  _CommitPause? _nextPause;
  final pauses = <_CommitPause>[];
  _CommitPause pauseCommit({bool fail = false}) {
    final pause = _CommitPause(fail: fail);
    pauses.add(pause);
    _nextPause = pause;
    return pause;
  }

  File tmp(String account) => File(
    '${dir.path}/rehearsal_packages/accounts/${RehearsalPackageManager.computeAccountNamespaceHash(account)}/index.json.tmp',
  );
  Future<void> import(String account) async {
    saf.nextPickArchiveBytes = _buildValidPackageZip();
    expect(
      (await manager.importFromSaf(userId: account)).category,
      RehearsalUserOutcomeCategory.imported,
    );
  }

  Future<RehearsalOperationOutcome> bind(
    String version, {
    String account = 'a',
  }) => manager.bindSongVersion(
    userId: account,
    ministryId: 'm',
    song: _song,
    requestedVersionId: version,
    packageId: _packageId,
    songReadVerified: true,
  );
  Future<RehearsalOperationOutcome> bindInNotifier(String version) =>
      notifier.bindPackage(
        ministryId: 'm',
        song: _song,
        requestedVersionId: version,
        packageId: _packageId,
        songReadVerified: true,
      );
  Future<void> load({SongDetail song = _song}) => notifier
      .loadAndReconcileForSong(ministryId: 'm', song: song, silent: true);
}

void main() {
  test(
    'reload during binding preserves active index commit and releases busy',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.load();
      final pause = f.pauseCommit();
      final pending = f.bindInNotifier('one');
      await pause.reached.future;
      final reload = f.load();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      final tmpPreserved = f.tmp('a').existsSync();
      pause.resume();
      final outcome = await pending;
      await reload;
      expect(
        tmpPreserved,
        isTrue,
        reason: 'recovery must not delete the active writer temporary index',
      );
      expect(outcome.category, RehearsalUserOutcomeCategory.bound);
      expect(
        (await f.manager.listBindings(userId: 'a')).single.canonicalVersionId,
        'one',
      );
      expect(f.notifier.state.bindings.single.canonicalVersionId, 'one');
      expect(f.notifier.state.isMutating, isFalse);
    },
  );

  test(
    'recursive public transaction calls fail promptly instead of waiting on their own lock',
    () async {
      final f = _Fixture();
      await f.import('a');
      f.beforeCommit = () =>
          expectLater(f.manager.loadLibrary(userId: 'a'), throwsStateError);
      expect(
        (await f.bind('one')).category,
        RehearsalUserOutcomeCategory.bound,
      );
    },
  );

  test(
    'concurrent bindings serialize read modify write without losing either version',
    () async {
      final f = _Fixture();
      await f.import('a');
      final pause = f.pauseCommit();
      final first = f.bind('one');
      await pause.reached.future;
      final second = f.bind('two');
      pause.resume();
      expect((await first).category, RehearsalUserOutcomeCategory.bound);
      expect((await second).category, RehearsalUserOutcomeCategory.bound);
      expect(
        (await f.manager.listBindings(
          userId: 'a',
        )).map((b) => b.canonicalVersionId),
        unorderedEquals(['one', 'two']),
      );
    },
  );

  test(
    'recovery reads rename revalidation and unbind share the account transaction',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.bind('one');
      final pause = f.pauseCommit();
      final binding = f.bind('two');
      await pause.reached.future;
      var recoveryCompleted = false;
      final recovery = f.manager.recoverOrphanedTransactions(userId: 'a').then((
        value,
      ) {
        recoveryCompleted = true;
        return value;
      });
      final library = f.manager.loadLibrary(userId: 'a');
      final details = f.manager.getPackageDetails(
        userId: 'a',
        packageId: _packageId,
      );
      final rename = f.manager.renamePackageLabel(
        userId: 'a',
        packageId: _packageId,
        newLabel: 'Renamed',
      );
      final revalidate = f.manager.revalidatePackage(
        userId: 'a',
        packageId: _packageId,
      );
      final unbind = f.manager.unbindSongVersion(
        userId: 'a',
        ministryId: 'm',
        songId: 'song',
        canonicalVersionId: 'one',
      );
      await Future<void>.delayed(const Duration(milliseconds: 30));
      final completedBeforeRelease = recoveryCompleted;
      final tmpPreserved = f.tmp('a').existsSync();
      pause.resume();
      await Future.wait([
        binding,
        recovery,
        library,
        details,
        rename,
        revalidate,
        unbind,
      ]);
      expect(completedBeforeRelease, isFalse);
      expect(tmpPreserved, isTrue);
      final bindings = await f.manager.listBindings(userId: 'a');
      expect(bindings.single.canonicalVersionId, 'two');
      expect(bindings.single.packageDisplayNameSnapshot, 'Renamed');
    },
  );

  test(
    'cancel before binding commit preserves index and releases notifier busy',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.load();
      final pause = f.pauseCommit();
      final pending = f.bindInNotifier('one');
      await pause.reached.future;
      await f.manager.cancelActiveOperation();
      pause.resume();
      expect((await pending).errorCode, 'OPERATION_CANCELLED');
      expect(await f.manager.listBindings(userId: 'a'), isEmpty);
      expect(f.tmp('a').existsSync(), isFalse);
      expect(f.notifier.state.isMutating, isFalse);
      expect(
        (await f.bindInNotifier('two')).category,
        RehearsalUserOutcomeCategory.bound,
      );
    },
  );

  test(
    'logout cancels active and already queued bindings while another account proceeds',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.import('b');
      await f.load();
      final pause = f.pauseCommit();
      final active = f.bindInNotifier('one');
      await pause.reached.future;
      final queued = f.bind('two');
      f.userId = null;
      f.notifier.reset();
      f.manager.invalidateSession();
      // Account B must not wait for the paused account A writer.
      f.userId = 'b';
      await f.load();
      expect(
        (await f.bindInNotifier('two')).category,
        RehearsalUserOutcomeCategory.bound,
      );
      pause.resume();
      expect((await active).errorCode, 'SESSION_INVALIDATED');
      expect((await queued).errorCode, 'SESSION_INVALIDATED');
      expect(await f.manager.listBindings(userId: 'a'), isEmpty);
      expect(
        (await f.manager.listBindings(userId: 'b')).single.canonicalVersionId,
        'two',
      );
      expect(f.notifier.state.boundUserId, 'b');
      expect(f.notifier.state.bindings.single.canonicalVersionId, 'two');
      expect(f.notifier.state.isMutating, isFalse);
    },
  );

  test(
    'failed binding commit leaves prior index intact and queued recovery succeeds',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.bind('one');
      await f.load();
      final pause = f.pauseCommit(fail: true);
      final pending = f.bindInNotifier('two');
      await pause.reached.future;
      final reload = f.load();
      pause.resume();
      expect((await pending).errorCode, 'BIND_FAILED');
      await reload;
      expect(
        (await f.manager.listBindings(userId: 'a')).single.canonicalVersionId,
        'one',
      );
      expect(f.tmp('a').existsSync(), isFalse);
      expect(f.notifier.state.isMutating, isFalse);
      expect(
        (await f.bindInNotifier('two')).category,
        RehearsalUserOutcomeCategory.bound,
      );
    },
  );

  test(
    'stale mutation finalizer cannot clear a newer account mutation busy flag',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.import('b');
      await f.load();
      final oldPause = f.pauseCommit();
      final old = f.bindInNotifier('one');
      await oldPause.reached.future;
      f.userId = 'b';
      f.notifier.reset();
      f.manager.invalidateSession();
      await f.load();
      final newPause = f.pauseCommit();
      final newer = f.bindInNotifier('two');
      await newPause.reached.future;
      oldPause.resume();
      expect((await old).errorCode, 'SESSION_INVALIDATED');
      expect(f.notifier.state.isMutating, isTrue);
      expect(f.notifier.state.boundUserId, 'b');
      newPause.resume();
      expect((await newer).category, RehearsalUserOutcomeCategory.bound);
      expect(f.notifier.state.isMutating, isFalse);
      expect(f.notifier.state.bindings.single.canonicalVersionId, 'two');
    },
  );

  for (final invalidateSession in [false, true]) {
    test(
      '${invalidateSession ? 'session switch' : 'cancel'} aborts reconcile before commit without changing the persisted binding',
      () async {
        final f = _Fixture();
        await f.import('a');
        await f.bind('one');
        final pause = f.pauseCommit();
        final pending = f.manager.reconcileSongVersionBindings(
          userId: 'a',
          ministryId: 'm',
          song: _songWithoutOne,
        );
        final rejected = expectLater(pending, throwsA(isA<Exception>()));
        await pause.reached.future;
        if (invalidateSession) {
          f.manager.invalidateSession();
        } else {
          await f.manager.cancelActiveOperation();
        }
        pause.resume();
        await rejected;
        final binding = (await f.manager.listBindings(userId: 'a')).single;
        expect(binding.canonicalVersionId, 'one');
        expect(binding.validityState, LocalBindingValidityState.valid);
        expect(f.tmp('a').existsSync(), isFalse);
      },
    );
  }

  test(
    'failure during reconcile keeps persisted binding and loader can recover',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.bind('one');
      await f.load();
      final pause = f.pauseCommit(fail: true);
      final pending = f.load(song: _songWithoutOne);
      await pause.reached.future;
      pause.resume();
      await pending;
      expect(f.notifier.state.isLoading, isFalse);
      expect(f.notifier.state.errorMessage, isNotNull);
      expect(
        (await f.manager.listBindings(userId: 'a')).single.validityState,
        LocalBindingValidityState.valid,
      );
      await f.load();
      expect(
        f.notifier.state.bindings.single.validityState,
        LocalBindingValidityState.valid,
      );
      expect(f.notifier.state.errorMessage, isNull);
    },
  );

  test(
    'stale reconcile callback cannot replace the new account library',
    () async {
      final f = _Fixture();
      await f.import('a');
      await f.import('b');
      await f.bind('one');
      await f.load();
      final pause = f.pauseCommit();
      final oldLoad = f.load(song: _songWithoutOne);
      await pause.reached.future;
      f.userId = 'b';
      f.notifier.reset();
      f.manager.invalidateSession();
      await f.load();
      await f.bindInNotifier('two');
      pause.resume();
      await oldLoad;
      expect(f.notifier.state.boundUserId, 'b');
      expect(f.notifier.state.bindings.single.canonicalVersionId, 'two');
      expect(f.notifier.state.isLoading, isFalse);
      expect(f.notifier.state.errorMessage, isNull);
      expect(
        (await f.manager.listBindings(userId: 'a')).single.validityState,
        LocalBindingValidityState.valid,
      );
    },
  );
}
