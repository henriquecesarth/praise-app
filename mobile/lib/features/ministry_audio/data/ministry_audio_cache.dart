part of 'ministry_audio_download_manager.dart';

abstract final class MinistryAudioCacheCodes {
  static const String quotaExceeded = 'AUDIO_CACHE_QUOTA_EXCEEDED';
  static const String revalidationFailed = 'AUDIO_REVALIDATION_FAILED';
}

enum MinistryAudioCacheIntegrity { verified, unverified }

/// `intact`: complete set whose local manifest and file sizes check out (the
/// only state LRU may evict). `corrupt`: definitively not a complete set.
/// `unreadable`: an I/O error prevented judging it; it is never removed on a
/// guess.
enum MinistryAudioCacheEntryState { intact, corrupt, unreadable }

/// One cached recording as seen by the cache. Derived from the disk on every
/// operation; the persisted index only contributes `lastAccessMillis` and a
/// hint. Never proof of integrity or authorization.
final class MinistryAudioCacheEntry {
  const MinistryAudioCacheEntry({
    required this.recordingId,
    required this.recordingVersion,
    required this.manifestDigest,
    required this.totalBytes,
    required this.lastAccessMillis,
    required this.integrity,
    required this.state,
    this.codec = MinistryAudioCodec.pcm,
  });

  final MinistryAudioCodec codec;
  final String recordingId;
  final String recordingVersion;
  final String manifestDigest;
  final int totalBytes;
  final int lastAccessMillis;
  final MinistryAudioCacheIntegrity integrity;
  final MinistryAudioCacheEntryState state;

  MinistryAudioCacheEntry touched(int now) => MinistryAudioCacheEntry(
        recordingId: recordingId,
        recordingVersion: recordingVersion,
        manifestDigest: manifestDigest,
        totalBytes: totalBytes,
        lastAccessMillis: now,
        integrity: MinistryAudioCacheIntegrity.verified,
        state: MinistryAudioCacheEntryState.intact,
        codec: codec,
      );

  Map<String, Object?> toJson() => {
        'recordingId': recordingId,
        'recordingVersion': recordingVersion,
        'manifestDigest': manifestDigest,
        'totalBytes': totalBytes,
        'lastAccessMillis': lastAccessMillis,
        'integrity': integrity.name,
        // Internal references only (fixed names); never URLs or tokens.
        'files': [
          for (final id in MinistryStemId.values)
            MinistryAudioDownloadManager._stemFileName(id, codec),
        ],
      };
}

/// A locally cached set released after online revalidation and a full
/// integrity check. It is leased (protected from LRU) until [release].
///
/// This is NOT a playback grant: it is valid only for the call that obtained
/// it. Offline playback is not enabled; callers must revalidate every time.
final class MinistryAudioCachedRecording {
  MinistryAudioCachedRecording._(
    this.recording,
    this.fromCache,
    this.revalidatedAtMillis,
    this.sampleRate,
    this.frames,
    this._onRelease,
    this._onDetach,
  );

  final MinistryAudioLocalRecording recording;
  final bool fromCache;
  final int revalidatedAtMillis;

  /// Format declared by the online manifest that was just verified; the native
  /// engine checks the WAV headers against it.
  final int sampleRate;
  final int frames;
  final void Function() _onRelease;
  final void Function() _onDetach;
  bool _released = false;
  bool _detached = false;

  /// Transfers the duty to [release] from the cache to the caller.
  ///
  /// Normally `MinistryAudioCache.dispose()` (logout, ministry switch) drops
  /// every lease it still holds. A player that has the files OPEN in native
  /// code must instead keep the lease (so LRU cannot delete them) until the
  /// native side CONFIRMS it closed them: after this call, `dispose()` no
  /// longer releases this handle and only the owner may. Idempotent.
  void takeOwnership() {
    if (_released || _detached) return;
    _detached = true;
    _onDetach();
  }

  /// Idempotent. Must be called when the caller no longer uses the files.
  void release() {
    if (_released) return;
    _released = true;
    _onRelease();
  }
}

/// Quota, LRU and online revalidation on top of [MinistryAudioDownloadManager].
///
/// * The quota applies per account x ministry scope (eviction never crosses
///   those limits), alongside the device-wide free-space reserve.
/// * Every operation runs inside the manager's process-wide gate, so
///   concurrent calls cannot exceed the quota or evict one another's data.
/// * The disk is the authority: the index (`index.json`, written to a temp
///   file and renamed) is rebuilt/reconciled from `recordings/*` each time.
/// * Failing closed: any revalidation failure (no session, 401/403/404, no
///   network, changed manifest, context switch) releases nothing and deletes
///   nothing.
final class MinistryAudioCache {
  MinistryAudioCache({
    required MinistryAudioDownloadManager manager,
    this.quotaBytes = defaultQuotaBytes,
  }) : _m = manager;

  static const int defaultQuotaBytes = 1024 * 1024 * 1024;
  static const String _indexSchema = 'louvaio-ministry-audio-cache-index-v1';
  static const String _indexName = 'index.json';
  static const String _indexTmpName = 'index.json.tmp';

  /// Active leases by `<root>|<recordingId>`; shared across caches in the
  /// process like the gate itself.
  static final Map<String, int> _leases = {};
  static int _discardSeq = 0;

  /// Number of leases currently active in this process (diagnostics/tests).
  @visibleForTesting
  static int get debugActiveLeases => _leases.values.fold(0, (a, b) => a + b);

  final MinistryAudioDownloadManager _m;
  final int quotaBytes;
  final Set<CancelToken> _tokens = {};
  final List<MinistryAudioCachedRecording> _held = [];
  bool _disposed = false;

  /// Cancels running work and drops this cache's leases.
  void dispose() {
    _disposed = true;
    for (final t in List<CancelToken>.of(_tokens)) {
      if (!t.isCancelled) t.cancel('cancelled');
    }
    for (final r in List<MinistryAudioCachedRecording>.of(_held)) {
      r.release();
    }
  }

  // ---------------------------------------------------------------- public

  /// Returns a verified local set for [recordingId], revalidating access
  /// online first and downloading (with quota/LRU) when needed.
  Future<MinistryAudioCachedRecording> ensureCached({
    required String ministryId,
    required String recordingId,
  }) async {
    final token = CancelToken();
    _tokens.add(token);
    try {
      final captured = _m._context();
      if (_disposed ||
          _m._disposed ||
          captured == null ||
          captured.ministryId != ministryId) {
        throw _m._contextChanged();
      }
      if (!MinistryAudioContract.recordingIdPattern.hasMatch(recordingId)) {
        throw const AppFailure(
          message: 'Identificador de gravação inválido.',
          statusCode: 400,
          code: MinistryAudioContract.invalidCode,
        );
      }
      return await MinistryAudioDownloadManager._serialized(
        () => _ensureLocked(ministryId, recordingId, captured, token),
      );
    } on FileSystemException {
      throw const AppFailure(
        message: 'Falha ao acessar o armazenamento do aparelho.',
        code: MinistryAudioDownloadCodes.writeFailed,
      );
    } finally {
      _tokens.remove(token);
    }
  }

  /// Reconciled snapshot of this scope's cache (empty when the context is
  /// stale). Diagnostic only: not proof of integrity or authorization.
  Future<List<MinistryAudioCacheEntry>> entries({
    required String ministryId,
  }) async {
    final captured = _m._context();
    if (_disposed ||
        _m._disposed ||
        captured == null ||
        captured.ministryId != ministryId) {
      return const [];
    }
    bool stale() => _disposed || _m._disposed || _m._context() != captured;
    return MinistryAudioDownloadManager._serialized(() async {
      if (stale()) return const <MinistryAudioCacheEntry>[];
      final status = await _m._storage.query();
      if (stale()) return const <MinistryAudioCacheEntry>[];
      final root = Directory(
        status.privateRootFor(userId: captured.userId, ministryId: ministryId),
      );
      await _m._recover(root);
      if (stale()) return const <MinistryAudioCacheEntry>[];
      final list = await _reconcile(root);
      return stale()
          ? const <MinistryAudioCacheEntry>[]
          : List<MinistryAudioCacheEntry>.unmodifiable(list);
    });
  }

  // ------------------------------------------------------------- operation

  Future<MinistryAudioCachedRecording> _ensureLocked(
    String ministryId,
    String recordingId,
    MinistryAudioDownloadContext captured,
    CancelToken token,
  ) async {
    void check() {
      if (_disposed && !token.isCancelled) token.cancel('disposed');
      _m._assertCurrent(captured, token);
    }

    check(); // may have waited in the gate queue: no side effects before this
    final status = await _m._storage.query();
    check();
    final root = Directory(
      status.privateRootFor(userId: captured.userId, ministryId: ministryId),
    );
    await _m._recover(root);
    check();

    // Online revalidation: session, ministry access and publication.
    final playback = await _revalidate(ministryId, recordingId);
    check();
    final manifest = playback.manifest;
    if (manifest.recordingId != recordingId) {
      throw const AppFailure(
        message: 'A gravação mudou durante o download.',
        code: MinistryAudioDownloadCodes.manifestChanged,
      );
    }
    final onlineDigest = MinistryAudioDownloadManager._digestOfManifest(manifest);

    var entries = await _reconcile(root);
    check();
    final finalDir = Directory('${root.path}/recordings/$recordingId');
    final existing = _find(entries, recordingId);
    if (existing != null) {
      final c = await _m._check(
        finalDir,
        expectedRecordingId: recordingId,
        deep: true, // full SHA-256 of the six files before releasing
      );
      check();
      if (c.status == _CheckStatus.valid && c.manifestDigest == onlineDigest) {
        final touched = existing.touched(_m._now());
        entries = [
          for (final e in entries) e.recordingId == recordingId ? touched : e,
        ];
        await _saveIndex(root, entries);
        check();
        return _lease(root, c.recording!, true, manifest);
      }
      if (c.status != _CheckStatus.unreadable) {
        // Diverged from the online manifest, corrupt or incomplete: useless.
        await _discard(root, finalDir);
        entries = [
          for (final e in entries)
            if (e.recordingId != recordingId) e,
        ];
        await _saveIndex(root, entries);
        check();
      }
    }

    final stored = await _m._downloadLocked(
      ministryId,
      recordingId,
      captured,
      token,
      knownStatus: status,
      knownPlayback: playback,
      makeRoom: (r, needed, available) =>
          _makeRoom(r, entries, recordingId, needed, available),
    );
    check();
    final after = await _reconcile(root);
    final updated = [
      for (final e in after)
        e.recordingId == recordingId ? e.touched(_m._now()) : e,
    ];
    await _saveIndex(root, updated);
    check();
    return _lease(root, stored, false, manifest);
  }

  Future<MinistryAudioPlayback> _revalidate(
    String ministryId,
    String recordingId,
  ) async {
    try {
      return await _m._repository.getPlayback(
        ministryId: ministryId,
        recordingId: recordingId,
      );
    } on AppFailure {
      rethrow; // 401/403/404/network/context: fail closed, nothing deleted
    } catch (_) {
      throw const AppFailure(
        message: 'Não foi possível confirmar o acesso à gravação.',
        code: MinistryAudioCacheCodes.revalidationFailed,
      );
    }
  }

  // ------------------------------------------------------------------- LRU

  static int _max(int a, int b) => a > b ? a : b;

  /// Plans first, evicts after: nothing is removed unless enough can be freed.
  Future<int> _makeRoom(
    Directory root,
    List<MinistryAudioCacheEntry> entries,
    String targetId,
    int needed,
    int available,
  ) async {
    if (needed > quotaBytes) throw _quotaExceeded();
    var used = 0;
    for (final e in entries) {
      used += e.totalBytes;
    }
    final quotaDeficit = _max(0, needed - (quotaBytes - used));
    final spaceDeficit = _max(0, needed + _m._reserveBytes - available);
    final deficit = _max(quotaDeficit, spaceDeficit);
    if (deficit <= 0) return 0;

    final candidates = [
      for (final e in entries)
        if (e.state == MinistryAudioCacheEntryState.intact &&
            e.recordingId != targetId &&
            !_isLeased(root, e.recordingId))
          e,
    ]..sort((a, b) {
        final byAccess = a.lastAccessMillis.compareTo(b.lastAccessMillis);
        return byAccess != 0 ? byAccess : a.recordingId.compareTo(b.recordingId);
      });

    final victims = <MinistryAudioCacheEntry>[];
    var plan = 0;
    for (final c in candidates) {
      if (plan >= deficit) break;
      victims.add(c);
      plan += c.totalBytes;
    }
    if (plan < deficit) {
      if (quotaDeficit > 0 && plan < quotaDeficit) throw _quotaExceeded();
      throw const AppFailure(
        message: 'Espaço insuficiente para baixar a gravação.',
        code: MinistryAudioDownloadCodes.insufficientSpace,
      );
    }

    var freed = 0;
    for (final v in victims) {
      await _discard(root, Directory('${root.path}/recordings/${v.recordingId}'));
      entries.removeWhere((e) => e.recordingId == v.recordingId);
      freed += v.totalBytes;
    }
    await _saveIndex(root, entries);
    return freed;
  }

  AppFailure _quotaExceeded() => const AppFailure(
        message: 'A cota da biblioteca de áudio foi atingida.',
        code: MinistryAudioCacheCodes.quotaExceeded,
      );

  /// Moves a recording out of `recordings/` into `trash/bad_evict_*` (atomic)
  /// and deletes it. A crash in between is finished by recovery, which deletes
  /// `bad_*` entries; it can never be mistaken for a restorable backup.
  Future<void> _discard(Directory root, Directory dir) async {
    final trash = Directory('${root.path}/trash');
    await trash.create(recursive: true);
    final aside = '${trash.path}/${MinistryAudioDownloadManager._badPrefix}'
        'evict_${_m._now()}_${_discardSeq++}';
    await _m._ops.renameDirectory(dir, aside);
    await _m._deleteQuietly(Directory(aside));
  }

  // ----------------------------------------------------------------- lease

  bool _isLeased(Directory root, String id) =>
      (_leases['${root.path}|$id'] ?? 0) > 0;

  MinistryAudioCachedRecording _lease(
    Directory root,
    MinistryAudioLocalRecording recording,
    bool fromCache,
    MinistryAudioManifest manifest,
  ) {
    final key = '${root.path}|${recording.recordingId}';
    _leases[key] = (_leases[key] ?? 0) + 1;
    late final MinistryAudioCachedRecording handle;
    handle = MinistryAudioCachedRecording._(
      recording,
      fromCache,
      _m._now(),
      manifest.sampleRate,
      manifest.frames,
      () {
        final n = (_leases[key] ?? 1) - 1;
        if (n <= 0) {
          _leases.remove(key);
        } else {
          _leases[key] = n;
        }
        _held.remove(handle);
      },
      () => _held.remove(handle),
    );
    _held.add(handle);
    return handle;
  }

  // ----------------------------------------------------------------- index

  MinistryAudioCacheEntry? _find(
    List<MinistryAudioCacheEntry> entries,
    String id,
  ) {
    for (final e in entries) {
      if (e.recordingId == id) return e;
    }
    return null;
  }

  /// Rebuilds the entries from `recordings/*` (the authority), taking only
  /// `lastAccessMillis` and a hint from the persisted index.
  Future<List<MinistryAudioCacheEntry>> _reconcile(Directory root) async {
    final prior = await _readIndex(root);
    await _m._deleteFileQuietly(File('${root.path}/$_indexTmpName'));
    final dirs = <Directory>[];
    try {
      await for (final e
          in Directory('${root.path}/recordings').list(followLinks: false)) {
        if (e is Directory) dirs.add(e);
      }
    } on PathNotFoundException {
      return <MinistryAudioCacheEntry>[];
    }
    final out = <MinistryAudioCacheEntry>[];
    for (final d in dirs) {
      final name = d.uri.pathSegments.lastWhere((s) => s.isNotEmpty);
      if (!MinistryAudioContract.recordingIdPattern.hasMatch(name)) continue;
      final p = prior[name];
      final c = await _m._check(d, expectedRecordingId: name, deep: false);
      switch (c.status) {
        case _CheckStatus.valid:
          out.add(MinistryAudioCacheEntry(
            recordingId: name,
            recordingVersion: c.recording!.recordingVersion,
            manifestDigest: c.manifestDigest!,
            totalBytes: c.totalBytes,
            lastAccessMillis: p?.lastAccess ?? 0,
            integrity: p != null &&
                    p.digest == c.manifestDigest &&
                    p.verified
                ? MinistryAudioCacheIntegrity.verified
                : MinistryAudioCacheIntegrity.unverified,
            state: MinistryAudioCacheEntryState.intact,
            codec: c.recording!.codec,
          ));
        case _CheckStatus.invalid:
        case _CheckStatus.unreadable:
          out.add(MinistryAudioCacheEntry(
            recordingId: name,
            recordingVersion: p?.version ?? '',
            manifestDigest: '',
            totalBytes: p?.totalBytes ?? 0,
            lastAccessMillis: p?.lastAccess ?? 0,
            integrity: MinistryAudioCacheIntegrity.unverified,
            state: c.status == _CheckStatus.invalid
                ? MinistryAudioCacheEntryState.corrupt
                : MinistryAudioCacheEntryState.unreadable,
          ));
      }
    }
    out.sort((a, b) => a.recordingId.compareTo(b.recordingId));
    return out;
  }

  Future<Map<String, _PriorEntry>> _readIndex(Directory root) async {
    try {
      final raw =
          await _m._ops.readString(File('${root.path}/$_indexName'));
      final json = jsonDecode(raw);
      if (json is! Map || json['schema'] != _indexSchema) return {};
      final list = json['entries'];
      if (list is! List) return {};
      final out = <String, _PriorEntry>{};
      for (final e in list) {
        if (e is! Map) continue;
        final id = e['recordingId'];
        final last = e['lastAccessMillis'];
        if (id is! String ||
            !MinistryAudioContract.recordingIdPattern.hasMatch(id) ||
            last is! int ||
            last < 0) {
          continue;
        }
        final total = e['totalBytes'];
        out[id] = _PriorEntry(
          lastAccess: last,
          verified: e['integrity'] == MinistryAudioCacheIntegrity.verified.name,
          digest: e['manifestDigest'] is String ? e['manifestDigest'] as String : '',
          version: e['recordingVersion'] is String
              ? e['recordingVersion'] as String
              : '',
          totalBytes: total is int && total >= 0 ? total : 0,
        );
      }
      return out;
    } catch (_) {
      return {}; // missing, unreadable or corrupt: rebuilt from the disk
    }
  }

  /// Temp file + atomic rename. Best effort: the disk is the authority, so a
  /// failed or interrupted write only loses recency hints, never data.
  Future<void> _saveIndex(
    Directory root,
    List<MinistryAudioCacheEntry> entries,
  ) async {
    final tmp = File('${root.path}/$_indexTmpName');
    try {
      await root.create(recursive: true);
      final json = jsonEncode({
        'schema': _indexSchema,
        'entries': [for (final e in entries) e.toJson()],
      });
      final sink = await _m._ops.openSink(tmp);
      try {
        sink.add(utf8.encode(json));
        await sink.flush();
      } finally {
        await sink.close();
      }
      await _m._ops.renameFile(tmp, '${root.path}/$_indexName');
    } on FileSystemException {
      await _m._deleteFileQuietly(tmp);
    }
  }
}

final class _PriorEntry {
  const _PriorEntry({
    required this.lastAccess,
    required this.verified,
    required this.digest,
    required this.version,
    required this.totalBytes,
  });

  final int lastAccess;
  final bool verified;
  final String digest;
  final String version;
  final int totalBytes;
}
