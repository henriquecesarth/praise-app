import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/audio/rehearsal_package_validator.dart'
    show IncrementalSha256;
import '../../../core/errors/app_failure.dart';
import '../domain/ministry_audio_models.dart';
import 'ministry_audio_repository.dart';
import 'ministry_audio_storage_info.dart';
import 'ministry_audio_transport.dart';

// The cache shares this library's process-wide gate and local validation
// (private by design), so it lives in the same library.
part 'ministry_audio_cache.dart';

/// Immutable identity of the context a download belongs to.
///
/// Compared with `==` at every checkpoint: user, session generation, ministry
/// and the ministry-context epoch (generation stamp). Any difference means the
/// work is stale (logout, account switch, A -> B -> A, notifier rebuild).
final class MinistryAudioDownloadContext {
  const MinistryAudioDownloadContext({
    required this.userId,
    required this.sessionGeneration,
    required this.ministryId,
    required this.epoch,
  });

  final String userId;
  final int sessionGeneration;
  final String ministryId;
  final Object? epoch;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MinistryAudioDownloadContext &&
          userId == other.userId &&
          sessionGeneration == other.sessionGeneration &&
          ministryId == other.ministryId &&
          epoch == other.epoch;

  @override
  int get hashCode => Object.hash(userId, sessionGeneration, ministryId, epoch);
}

typedef MinistryAudioDownloadContextProvider = MinistryAudioDownloadContext?
    Function();

/// Verified local copy of one recording. Existence of these files does NOT
/// authorize playback: the next module must revalidate access online.
final class MinistryAudioLocalRecording {
  const MinistryAudioLocalRecording({
    required this.recordingId,
    required this.recordingVersion,
    required this.directoryPath,
    required this.stemPaths,
  });

  final String recordingId;
  final String recordingVersion;
  final String directoryPath;
  final Map<MinistryStemId, String> stemPaths;
}

/// File-system operations, injectable so tests can force failures.
class MinistryAudioFileOps {
  const MinistryAudioFileOps();

  Future<IOSink> openSink(File file) async => file.openWrite();
  Future<void> renameFile(File file, String to) async {
    await file.rename(to);
  }

  Future<void> renameDirectory(Directory dir, String to) async {
    await dir.rename(to);
  }

  /// Reads used by validation/recovery. They must THROW on failure (a missing
  /// file raises [PathNotFoundException]; any other [FileSystemException] is an
  /// access/I/O error): `File.exists()` swallows errors and cannot tell an
  /// absent file from an unreadable one.
  Future<String> readString(File file) => file.readAsString();
  Future<int> length(File file) => file.length();
  Stream<List<int>> openRead(File file) => file.openRead();
}

enum _CheckStatus { valid, invalid, unreadable }

/// Outcome of validating a recording directory. `unreadable` (I/O error) is
/// distinct from `invalid` (definitively not a complete, intact recording) so
/// that a transient read error never leads to deleting a possibly good copy.
final class _Check {
  const _Check(
    this.status, [
    this.recording,
    this.manifestDigest,
    this.totalBytes = 0,
  ]);

  final _CheckStatus status;
  final MinistryAudioLocalRecording? recording;

  /// Identity of the LOCAL manifest (see [_digestOfParts]); only for `valid`.
  final String? manifestDigest;

  /// Sum of the six stem sizes declared by the local manifest.
  final int totalBytes;
}

abstract final class MinistryAudioDownloadCodes {
  static const String insufficientSpace = 'AUDIO_STORAGE_INSUFFICIENT';
  static const String writeFailed = 'AUDIO_STORAGE_WRITE_FAILED';
  static const String sizeMismatch = 'AUDIO_SIZE_MISMATCH';
  static const String integrityFailed = 'AUDIO_INTEGRITY_FAILED';
  static const String manifestChanged = 'AUDIO_MANIFEST_CHANGED';
  static const String renewalLimit = 'AUDIO_RENEWAL_LIMIT';
  static const String promotionFailed = 'AUDIO_PROMOTION_FAILED';
  static const String busy = 'AUDIO_DOWNLOAD_BUSY';
}

/// Downloads the six WAV v1 stems of a recording into app-private storage and
/// promotes them transactionally.
///
/// Layout under the ministry root (see [MinistryAudioStorageStatus]):
/// `staging/<tx>.part/` (work area), `recordings/<recordingId>/` (promoted,
/// verified), `trash/<tx>/` (replaced copy, deleted after promotion).
/// Only `recordings/<recordingId>/` is ever "ready", and it only appears via a
/// single directory rename after all six stems are complete and verified, so an
/// interrupted run can never look ready. Nothing outside the ministry root is
/// touched, and no server value is used as a local path.
///
/// Stems are streamed to `*.part` files with a hard byte cap and incremental
/// SHA-256 (O(1) RAM per chunk). Partial stems are never resumed: they are
/// discarded and restarted. No HTTP Range is used.
final class MinistryAudioDownloadManager {
  MinistryAudioDownloadManager({
    required MinistryAudioRepository repository,
    required MinistryAudioStemTransport transport,
    required MinistryAudioStorageInfoSource storage,
    required MinistryAudioDownloadContextProvider context,
    MinistryAudioFileOps fileOps = const MinistryAudioFileOps(),
    int Function()? nowMillis,
    int reserveBytes = 256 * 1024 * 1024,
    int expirySkewMillis = 20 * 1000,
    int maxRenewals = 3,
    int flushThresholdBytes = 1024 * 1024,
    String Function()? transactionId,
  })  : _repository = repository,
        _transport = transport,
        _storage = storage,
        _context = context,
        _ops = fileOps,
        _now = nowMillis ?? (() => DateTime.now().millisecondsSinceEpoch),
        _reserveBytes = reserveBytes,
        _expirySkewMillis = expirySkewMillis,
        _maxRenewals = maxRenewals,
        _flushThreshold = flushThresholdBytes,
        _txId = transactionId;

  final MinistryAudioRepository _repository;
  final MinistryAudioStemTransport _transport;
  final MinistryAudioStorageInfoSource _storage;
  final MinistryAudioDownloadContextProvider _context;
  final MinistryAudioFileOps _ops;
  final int Function() _now;
  final int _reserveBytes;
  final int _expirySkewMillis;
  final int _maxRenewals;
  final int _flushThreshold;
  final String Function()? _txId;

  static final RegExp _txPattern = RegExp(r'^[A-Za-z0-9_-]{4,64}$');
  int _txCounter = 0;
  bool _disposed = false;
  final Set<CancelToken> _tokens = {};

  /// Process-wide gate: every library operation (download, inspect, recovery)
  /// runs one at a time, across managers, users and ministries. This keeps one
  /// operation from deleting another's staging/backup, prevents two versions of
  /// a recording from being promoted at once, and makes the free-space check
  /// race-free. It is an in-process guarantee only: crash safety never depends
  /// on it (see [_recover], which works purely from the on-disk state).
  static Future<void> _gateTail = Future<void>.value();

  static Future<T> _serialized<T>(Future<T> Function() action) {
    final previous = _gateTail;
    final done = Completer<void>();
    _gateTail = done.future;
    return previous.then((_) => action()).whenComplete(done.complete);
  }

  /// Cancels any running download; later calls fail closed.
  void dispose() {
    _disposed = true;
    cancel();
  }

  /// Cancels queued and running downloads of this manager (each run cleans its
  /// own staging).
  void cancel() {
    for (final token in List<CancelToken>.of(_tokens)) {
      if (!token.isCancelled) token.cancel('cancelled');
    }
  }

  // ---------------------------------------------------------------- public

  Future<MinistryAudioLocalRecording> download({
    required String ministryId,
    required String recordingId,
  }) async {
    final token = CancelToken();
    _tokens.add(token);
    try {
      final captured = _context();
      if (captured == null || captured.ministryId != ministryId || _disposed) {
        throw _contextChanged();
      }
      if (!MinistryAudioContract.recordingIdPattern.hasMatch(recordingId)) {
        throw const AppFailure(
          message: 'Identificador de gravação inválido.',
          statusCode: 400,
          code: MinistryAudioContract.invalidCode,
        );
      }
      return await _serialized(
        () => _downloadLocked(ministryId, recordingId, captured, token),
      );
    } finally {
      _tokens.remove(token);
    }
  }

  Future<MinistryAudioLocalRecording> _downloadLocked(
    String ministryId,
    String recordingId,
    MinistryAudioDownloadContext captured,
    CancelToken token, {
    MinistryAudioStorageStatus? knownStatus,
    MinistryAudioPlayback? knownPlayback,
    Future<int> Function(Directory root, int neededBytes, int availableBytes)?
        makeRoom,
  }) async {
    String? stagingPath;
    var promoted = false;
    try {
      _assertCurrent(captured, token); // may have waited in the gate queue
      final status = knownStatus ?? await _storage.query();
      _assertCurrent(captured, token);
      final root = Directory(
        status.privateRootFor(userId: captured.userId, ministryId: ministryId),
      );
      await _recover(root);
      _assertCurrent(captured, token);

      var playback = knownPlayback ??
          await _repository.getPlayback(
            ministryId: ministryId,
            recordingId: recordingId,
          );
      _assertCurrent(captured, token);
      final baseline = playback.manifest;

      final needed =
          baseline.stems.fold<int>(0, (sum, s) => sum + s.sizeBytes);
      var available = status.availableBytes;
      if (makeRoom != null) {
        // Cache hook: enforce quota / evict LRU sets; returns bytes freed.
        available += await makeRoom(root, needed, available);
        _assertCurrent(captured, token);
      }
      if (available < needed + _reserveBytes) {
        throw const AppFailure(
          message: 'Espaço insuficiente para baixar a gravação.',
          code: MinistryAudioDownloadCodes.insufficientSpace,
        );
      }

      final tx = _newTx();
      final staging = Directory('${root.path}/staging/$tx.part');
      stagingPath = staging.path;
      await staging.create(recursive: true);

      var renewals = 0;
      Future<void> renew() async {
        if (renewals >= _maxRenewals) {
          throw const AppFailure(
            message: 'Limite de renovações da autorização de download atingido.',
            code: MinistryAudioDownloadCodes.renewalLimit,
          );
        }
        renewals++;
        _assertCurrent(captured, token);
        final fresh = await _repository.getPlayback(
          ministryId: ministryId,
          recordingId: recordingId,
        );
        _assertCurrent(captured, token);
        if (!_sameManifest(baseline, fresh.manifest)) {
          throw const AppFailure(
            message: 'A gravação mudou durante o download.',
            code: MinistryAudioDownloadCodes.manifestChanged,
          );
        }
        playback = fresh;
      }

      for (final stem in baseline.stems) {
        var done = false;
        while (!done) {
          if (playback.isExpired(_now() + _expirySkewMillis)) await renew();
          final target =
              playback.tracks.firstWhere((t) => t.id == stem.id);
          try {
            await _downloadStem(
              stem: stem,
              target: target,
              ministryId: ministryId,
              staging: staging,
              captured: captured,
              token: token,
            );
            done = true;
          } on AppFailure catch (e) {
            if (e.code != MinistryAudioTransferCodes.expired) rethrow;
            await renew(); // partial stem already discarded; restart it
          }
        }
      }

      _assertCurrent(captured, token);
      await _writeLocalManifest(staging, baseline);
      _assertCurrent(captured, token);
      final result = await _promote(
        root: root,
        staging: staging,
        tx: tx,
        manifest: baseline,
        captured: captured,
        token: token,
      );
      promoted = true;
      return result;
    } on AppFailure {
      rethrow;
    } on FileSystemException {
      throw const AppFailure(
        message: 'Falha ao gravar o áudio no armazenamento do aparelho.',
        code: MinistryAudioDownloadCodes.writeFailed,
      );
    } finally {
      if (!promoted && stagingPath != null) {
        await _deleteQuietly(Directory(stagingPath));
      }
    }
  }

  /// Returns the local copy only if it is complete AND intact: manifest, six
  /// files with the exact sizes and (by default) the SHA-256 of every file,
  /// streamed in bounded blocks. A same-size file with altered content is not
  /// ready. Also runs crash recovery first (under the process-wide gate), so a
  /// recording interrupted mid-replacement is restored before it is judged.
  /// Never proves authorization: playback must revalidate access online.
  ///
  /// Limitation: the check compares the files with the local `manifest.json`
  /// that this manager wrote; it detects corruption and accidental changes, not
  /// a deliberate rewrite of both. The online manifest remains the authority.
  ///
  /// `verifyContent: false` is a SUPERFICIAL check (presence and sizes only):
  /// it does not prove integrity and must never be used to authorize playback.
  ///
  /// Returns `null` when there is no valid local copy or when the context
  /// (user, session, ministry, context stamp) or this manager changed at any
  /// point, including while the call waited in the queue: paths of a previous
  /// account or ministry are never handed out.
  Future<MinistryAudioLocalRecording?> inspectReady({
    required String ministryId,
    required String recordingId,
    bool verifyContent = true,
  }) async {
    final captured = _context();
    if (_disposed ||
        captured == null ||
        captured.ministryId != ministryId ||
        !MinistryAudioContract.recordingIdPattern.hasMatch(recordingId)) {
      return null;
    }
    bool stale() => _disposed || _context() != captured;
    return _serialized(() async {
      if (stale()) return null; // waited in the queue: no side effects
      final status = await _storage.query();
      if (stale()) return null;
      final root = Directory(
        status.privateRootFor(userId: captured.userId, ministryId: ministryId),
      );
      await _recover(root);
      if (stale()) return null;
      final result = await _verifyRecording(
        Directory('${root.path}/recordings/$recordingId'),
        expectedRecordingId: recordingId,
        deep: verifyContent,
      );
      return stale() ? null : result;
    });
  }

  // --------------------------------------------------------------- helpers

  static const String _localSchema = 'louvaio-ministry-audio-local-v1';

  static String _stemFileName(MinistryStemId id) => 'stem_${id.name}.wav';

  AppFailure _contextChanged() => const AppFailure(
        message: 'O ministério ou a sessão mudou durante o download.',
        code: HttpMinistryAudioRepository.contextChangedCode,
      );

  void _assertCurrent(MinistryAudioDownloadContext captured, CancelToken token) {
    if (_disposed || token.isCancelled || _context() != captured) {
      if (!token.isCancelled) token.cancel('context changed');
      throw _contextChanged();
    }
  }

  String _newTx() {
    final generated = _txId?.call();
    if (generated != null) {
      if (!_txPattern.hasMatch(generated)) {
        throw ArgumentError.value(generated, 'transactionId');
      }
      return generated;
    }
    _txCounter++;
    return 'tx${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}_$_txCounter';
  }

  bool _sameManifest(MinistryAudioManifest a, MinistryAudioManifest b) {
    if (a.recordingId != b.recordingId ||
        a.recordingVersion != b.recordingVersion ||
        a.model.id != b.model.id ||
        a.model.version != b.model.version ||
        a.stems.length != b.stems.length) {
      return false;
    }
    for (var i = 0; i < a.stems.length; i++) {
      final x = a.stems[i];
      final y = b.stems[i];
      if (x.id != y.id ||
          x.sampleRate != y.sampleRate ||
          x.frames != y.frames ||
          x.sizeBytes != y.sizeBytes ||
          x.sha256 != y.sha256) {
        return false;
      }
    }
    return true;
  }

  Future<void> _downloadStem({
    required MinistryAudioStem stem,
    required MinistryAudioTransferTarget target,
    required String ministryId,
    required Directory staging,
    required MinistryAudioDownloadContext captured,
    required CancelToken token,
  }) async {
    final name = _stemFileName(stem.id);
    final part = File('${staging.path}/$name.part');
    if (await part.exists()) await part.delete();

    final response = await _transport.open(
      target,
      ministryId: ministryId,
      cancelToken: token,
    );
    _assertCurrent(captured, token);
    final declared = response.contentLength;
    if (declared != null && declared != stem.sizeBytes) {
      throw _sizeMismatch();
    }

    final sink = await _ops.openSink(part);
    var closed = false;
    try {
      final sha = IncrementalSha256();
      var received = 0;
      var pending = 0;
      await for (final chunk in response.body) {
        _assertCurrent(captured, token);
        received += chunk.length;
        if (received > stem.sizeBytes) throw _sizeMismatch();
        sha.update(chunk);
        sink.add(chunk);
        pending += chunk.length;
        if (pending >= _flushThreshold) {
          await sink.flush();
          pending = 0;
        }
      }
      _assertCurrent(captured, token);
      if (received != stem.sizeBytes) throw _sizeMismatch();
      await sink.flush();
      closed = true;
      await sink.close();
      if (sha.digestHex() != stem.sha256) {
        await _deleteFileQuietly(part);
        throw const AppFailure(
          message: 'A integridade do arquivo de áudio não pôde ser confirmada.',
          code: MinistryAudioDownloadCodes.integrityFailed,
        );
      }
      await _ops.renameFile(part, '${staging.path}/$name');
    } on FileSystemException {
      throw const AppFailure(
        message: 'Falha ao gravar o áudio no armazenamento do aparelho.',
        code: MinistryAudioDownloadCodes.writeFailed,
      );
    } finally {
      if (!closed) {
        try {
          await sink.close();
        } catch (_) {}
      }
      if (await part.exists()) await _deleteFileQuietly(part);
    }
  }

  AppFailure _sizeMismatch() => const AppFailure(
        message: 'O tamanho do arquivo de áudio não confere com o manifesto.',
        code: MinistryAudioDownloadCodes.sizeMismatch,
      );

  Future<void> _writeLocalManifest(
    Directory staging,
    MinistryAudioManifest manifest,
  ) async {
    final file = File('${staging.path}/manifest.json');
    final json = jsonEncode({
      'schema': _localSchema,
      'recordingId': manifest.recordingId,
      'recordingVersion': manifest.recordingVersion,
      'model': {'id': manifest.model.id, 'version': manifest.model.version},
      'stems': [
        for (final s in manifest.stems)
          {
            'id': s.id.name,
            'sampleRate': s.sampleRate,
            'frames': s.frames,
            'sizeBytes': s.sizeBytes,
            'sha256': s.sha256,
          },
      ],
    });
    final sink = await _ops.openSink(file);
    try {
      sink.add(utf8.encode(json));
      await sink.flush();
    } finally {
      await sink.close();
    }
  }

  Future<MinistryAudioLocalRecording> _promote({
    required Directory root,
    required Directory staging,
    required String tx,
    required MinistryAudioManifest manifest,
    required MinistryAudioDownloadContext captured,
    required CancelToken token,
  }) async {
    // All six verified files + manifest must be present before promotion.
    for (final id in MinistryStemId.values) {
      if (!await File('${staging.path}/${_stemFileName(id)}').exists()) {
        throw _promotionFailed();
      }
    }
    if (!await File('${staging.path}/manifest.json').exists()) {
      throw _promotionFailed();
    }
    final recordings = Directory('${root.path}/recordings');
    await recordings.create(recursive: true);
    final finalDir = Directory('${recordings.path}/${manifest.recordingId}');
    final trash = Directory('${root.path}/trash/$tx');
    var movedOld = false;
    try {
      _assertCurrent(captured, token);
      if (await finalDir.exists()) {
        await Directory('${root.path}/trash').create(recursive: true);
        await _ops.renameDirectory(finalDir, trash.path);
        movedOld = true;
      }
      _assertCurrent(captured, token);
      await _ops.renameDirectory(staging, finalDir.path);
    } catch (e) {
      if (movedOld && !await finalDir.exists()) {
        try {
          await _ops.renameDirectory(trash, finalDir.path); // restore previous
        } catch (_) {}
      }
      if (e is AppFailure) rethrow;
      throw _promotionFailed();
    }
    await _deleteQuietly(trash);
    return MinistryAudioLocalRecording(
      recordingId: manifest.recordingId,
      recordingVersion: manifest.recordingVersion,
      directoryPath: finalDir.path,
      stemPaths: {
        for (final id in MinistryStemId.values)
          id: '${finalDir.path}/${_stemFileName(id)}',
      },
    );
  }

  AppFailure _promotionFailed() => const AppFailure(
        message: 'Não foi possível concluir o download do áudio.',
        code: MinistryAudioDownloadCodes.promotionFailed,
      );

  // -------------------------------------------------------------- recovery

  /// Crash recovery for ONE ministry root, derived purely from the on-disk
  /// state (no journal, no in-memory state). It must run inside the gate.
  ///
  /// * `staging/*` is never ready and never the only copy of anything (a
  ///   promotion is a single atomic rename), so it is discarded.
  /// * `trash/<tx>` holds a replaced recording moved there by a promotion. It
  ///   is self-describing (its own `manifest.json` names the recording), so:
  ///   - final present and intact -> the new version stands; the backup goes;
  ///   - final missing           -> the backup is restored (if intact);
  ///   - final present but damaged and the backup intact -> the damaged final
  ///     is set aside, the backup restored, then the damaged copy deleted.
  ///   A backup is deleted only after the final state is established, and an
  ///   unreadable backup (I/O error) is kept, never deleted on a guess.
  /// Every step is an atomic rename or an idempotent delete, so a crash during
  /// recovery leaves a state that the next recovery resolves the same way.
  Future<void> _recover(Directory root) async {
    final staging = Directory('${root.path}/staging');
    if (await staging.exists()) {
      await for (final e in staging.list(followLinks: false)) {
        if (e is Directory) {
          await _deleteQuietly(e);
        } else if (e is File) {
          await _deleteFileQuietly(e);
        }
      }
    }
    final trash = Directory('${root.path}/trash');
    if (!await trash.exists()) return;
    final entries = await trash.list(followLinks: false).toList();
    for (final entity in entries) {
      if (entity is File) {
        await _deleteFileQuietly(entity);
      } else if (entity is Directory) {
        await _recoverBackup(root, entity);
      }
    }
  }

  static const String _badPrefix = 'bad_';

  Future<void> _recoverBackup(Directory root, Directory backup) async {
    final name = backup.uri.pathSegments.lastWhere((s) => s.isNotEmpty);
    if (name.startsWith(_badPrefix)) {
      await _deleteQuietly(backup); // damaged copy set aside by a recovery
      return;
    }
    final saved = await _check(backup, deep: true);
    if (saved.status == _CheckStatus.unreadable) return; // keep, retry later
    if (saved.status == _CheckStatus.invalid) {
      await _deleteQuietly(backup); // no restorable content
      return;
    }
    final id = saved.recording!.recordingId;
    final recordings = Directory('${root.path}/recordings');
    final finalDir = Directory('${recordings.path}/$id');
    if (!await finalDir.exists()) {
      await recordings.create(recursive: true);
      await _ops.renameDirectory(backup, finalDir.path);
      return;
    }
    final current = await _check(finalDir, expectedRecordingId: id, deep: true);
    switch (current.status) {
      case _CheckStatus.valid:
        await _deleteQuietly(backup);
      case _CheckStatus.unreadable:
        return;
      case _CheckStatus.invalid:
        final aside = Directory('${root.path}/trash/$_badPrefix$name');
        await _ops.renameDirectory(finalDir, aside.path);
        await _ops.renameDirectory(backup, finalDir.path);
        await _deleteQuietly(aside);
    }
  }

  Future<MinistryAudioLocalRecording?> _verifyRecording(
    Directory dir, {
    required String expectedRecordingId,
    required bool deep,
  }) async =>
      (await _check(dir, expectedRecordingId: expectedRecordingId, deep: deep))
          .recording;

  /// Validates a recording directory against its own `manifest.json`: schema,
  /// exactly six known stems, exact sizes and (when [deep]) the SHA-256 of each
  /// file, read in bounded blocks.
  Future<_Check> _check(
    Directory dir, {
    String? expectedRecordingId,
    required bool deep,
  }) async {
    try {
      final manifestFile = File('${dir.path}/manifest.json');
      final String raw;
      try {
        raw = await _ops.readString(manifestFile);
      } on PathNotFoundException {
        return const _Check(_CheckStatus.invalid); // proven absent
      }
      final json = jsonDecode(raw); // other I/O errors -> unreadable below
      if (json is! Map || json['schema'] != _localSchema) {
        return const _Check(_CheckStatus.invalid);
      }
      final recordingId = json['recordingId'];
      final version = json['recordingVersion'];
      final stems = json['stems'];
      if (recordingId is! String ||
          !MinistryAudioContract.recordingIdPattern.hasMatch(recordingId) ||
          (expectedRecordingId != null && recordingId != expectedRecordingId) ||
          version is! String ||
          stems is! List ||
          stems.length != MinistryStemId.values.length) {
        return const _Check(_CheckStatus.invalid);
      }
      final byId = <String, Map>{};
      for (final s in stems) {
        if (s is! Map || s['id'] is! String || byId.containsKey(s['id'])) {
          return const _Check(_CheckStatus.invalid);
        }
        byId[s['id'] as String] = s;
      }
      final paths = <MinistryStemId, String>{};
      final stemParts = <String>[];
      var total = 0;
      for (final id in MinistryStemId.values) {
        final entry = byId[id.name];
        final size = entry?['sizeBytes'];
        final sha = entry?['sha256'];
        if (size is! int ||
            size <= 0 ||
            sha is! String ||
            !MinistryAudioContract.sha256Pattern.hasMatch(sha)) {
          return const _Check(_CheckStatus.invalid);
        }
        final file = File('${dir.path}/${_stemFileName(id)}');
        final int actual;
        try {
          actual = await _ops.length(file);
        } on PathNotFoundException {
          return const _Check(_CheckStatus.invalid); // proven absent
        }
        if (actual != size) return const _Check(_CheckStatus.invalid);
        if (deep && await _sha256Of(file) != sha) {
          return const _Check(_CheckStatus.invalid);
        }
        paths[id] = file.path;
        total += size;
        stemParts.add(
          '${id.name}:${entry?['sampleRate']}:${entry?['frames']}:$size:$sha',
        );
      }
      final model = json['model'];
      return _Check(
        _CheckStatus.valid,
        MinistryAudioLocalRecording(
          recordingId: recordingId,
          recordingVersion: version,
          directoryPath: dir.path,
          stemPaths: paths,
        ),
        _digestOfParts(
          recordingId: recordingId,
          version: version,
          modelId: model is Map ? '${model['id']}' : '',
          modelVersion: model is Map ? '${model['version']}' : '',
          stemParts: stemParts,
        ),
        total,
      );
    } on FormatException {
      return const _Check(_CheckStatus.invalid);
    } catch (_) {
      return const _Check(_CheckStatus.unreadable);
    }
  }

  /// Identity of a manifest (id, version, model and every stem's rate, frames,
  /// size and SHA-256), the same value whether derived from the online
  /// manifest or from the local `manifest.json`.
  static String _digestOfParts({
    required String recordingId,
    required String version,
    required String modelId,
    required String modelVersion,
    required List<String> stemParts,
  }) =>
      IncrementalSha256.computeHex(utf8.encode(
        'louvaio-ministry-audio-manifest-v1|$recordingId|$version|$modelId|'
        '$modelVersion|${stemParts.join(';')}',
      ));

  static String _digestOfManifest(MinistryAudioManifest m) {
    final parts = <String>[];
    for (final id in MinistryStemId.values) {
      final s = m.stems.firstWhere((x) => x.id == id);
      parts.add('${id.name}:${s.sampleRate}:${s.frames}:${s.sizeBytes}:${s.sha256}');
    }
    return _digestOfParts(
      recordingId: m.recordingId,
      version: m.recordingVersion,
      modelId: m.model.id,
      modelVersion: m.model.version,
      stemParts: parts,
    );
  }

  Future<String> _sha256Of(File file) async {
    final sha = IncrementalSha256();
    await for (final chunk in _ops.openRead(file)) {
      sha.update(chunk);
    }
    return sha.digestHex();
  }

  Future<void> _deleteQuietly(Directory dir) async {
    try {
      if (await dir.exists()) await dir.delete(recursive: true);
    } catch (_) {}
  }

  Future<void> _deleteFileQuietly(File file) async {
    try {
      if (await file.exists()) await file.delete();
    } catch (_) {}
  }
}
