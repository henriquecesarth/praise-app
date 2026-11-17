import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/domain/rehearsal_package_models.dart';

/// Factory used to open an [IOSink] for a validated internal target file.
///
/// Exposed for dependency injection in tests (for example, simulating `ENOSPC`
/// mid-extraction).
typedef RehearsalSinkFactory = Future<IOSink> Function(File targetFile);

/// Optional hook invoked right before atomically renaming `index.json.tmp`
/// onto `index.json`, allowing fault-injection tests to simulate a crash or I/O
/// failure mid-commit.
typedef RehearsalBeforeIndexCommitHook = Future<void> Function(
  File tmpIndexFile,
  File targetIndexFile,
);

/// Account-scoped transactional manager for local `.louvaio-rehearsal.zip`
/// packages inside app-private storage.
///
/// Architectural guarantees:
/// - **Account isolation**: all state lives under
///   `<filesDir>/rehearsal_packages/accounts/<accountNamespaceHash>/`.
///   Independent of `ministryId`; switching ministries never hides or deletes
///   personal local packages.
/// - **Path isolation**: ZIP entry paths are never mapped directly to the local
///   filesystem. Only fixed canonical internal filenames (`manifest.json`,
///   `stem_<id>.<ext>`, `original.<ext>`) are created inside `packages/<uuid>/`.
/// - **Operational atomicity**: staging runs inside `staging/<txId>.part/`,
///   and commits/replacements use directory renames plus `index.json.tmp` ->
///   `index.json` atomic rename on the same private filesystem. Note: directory
///   rename on the same filesystem provides operational atomicity across app
///   crashes, which is distinct from unverified hardware power-loss `fsync`
///   durability of parent directory entries on arbitrary Android filesystems.
final class RehearsalPackageManager {
  RehearsalPackageManager({
    required RehearsalPackageSafPort safPort,
    RehearsalSinkFactory? sinkFactory,
    DateTime Function()? clock,
    String Function()? transactionIdGenerator,
    @visibleForTesting
    RehearsalBeforeIndexCommitHook? debugBeforeIndexCommit,
  }) : _safPort = safPort,
       _sinkFactory = sinkFactory ?? _defaultSinkFactory,
       _clock = clock ?? (() => DateTime.now().toUtc()),
       _txIdGenerator = transactionIdGenerator,
       _debugBeforeIndexCommit = debugBeforeIndexCommit;

  static const String stagedArchiveFileName = 'package.louvaio-rehearsal.zip';
  static const String manifestFileName = 'manifest.json';
  static const String stagingJournalFileName = 'staging.journal.json';
  static const String indexFileName = 'index.json';
  static const String indexTmpFileName = 'index.json.tmp';

  static final RegExp _uuidPattern = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  );
  static final RegExp _sha256Pattern = RegExp(r'^[0-9a-f]{64}$');
  static final RegExp _txIdPattern = RegExp(r'^[a-zA-Z0-9_-]{4,64}$');

  static const Set<String> _allowedStemContainers = {
    'wav',
    'flac',
    'ogg',
    'm4a',
  };
  static const Set<String> _allowedOriginalContainers = {
    'wav',
    'flac',
    'ogg',
    'm4a',
    'mp3',
  };

  final RehearsalPackageSafPort _safPort;
  final RehearsalSinkFactory _sinkFactory;
  final DateTime Function() _clock;
  final String Function()? _txIdGenerator;
  final RehearsalBeforeIndexCommitHook? _debugBeforeIndexCommit;

  int _sessionGeneration = 0;
  int _txCounter = 0;
  final Set<RehearsalCancellationToken> _activeTokens = {};
  final Set<FileRehearsalByteSource> _openByteSources = {};
  final Map<String, _PendingConflictEntry> _pendingConflicts = {};
  final Set<String> _activeStagingTxIds = {};

  static Future<IOSink> _defaultSinkFactory(File targetFile) async {
    return targetFile.openWrite();
  }

  /// Derives the deterministic per-user filesystem namespace hash.
  static String computeAccountNamespaceHash(String userId) {
    final normalized = userId.trim();
    if (normalized.isEmpty) {
      throw ArgumentError.value(userId, 'userId', 'userId must not be empty');
    }
    return IncrementalSha256.computeHex(
      utf8.encode('louvaio-rehearsal-ns-v1:$normalized'),
    );
  }

  /// Strictly maps a validated ZIP entry to a canonical app-private filename.
  ///
  /// Never trusts or uses `entry.path` as a filesystem target.
  static String resolveInternalFileName(VerifiedRehearsalEntry entry) {
    if (entry.role == 'manifest') {
      return manifestFileName;
    }
    if (entry.role == 'stem') {
      final stemId = entry.stemId;
      final container = entry.audioInfo?.container.toLowerCase();
      if (stemId == null ||
          !RehearsalLimitsV1.requiredStemIds.contains(stemId) ||
          container == null ||
          !_allowedStemContainers.contains(container)) {
        throw FormatException(
          'Invalid stem mapping: stemId=$stemId container=$container',
        );
      }
      return 'stem_$stemId.$container';
    }
    if (entry.role == 'original') {
      final container = entry.audioInfo?.container.toLowerCase();
      if (container == null || !_allowedOriginalContainers.contains(container)) {
        throw FormatException('Invalid original container: $container');
      }
      return 'original.$container';
    }
    throw FormatException('Unsupported rehearsal entry role: ${entry.role}');
  }

  /// Invalidates the current authenticated session in memory.
  ///
  /// Cancels active cancellation tokens, requests native SAF cancellation,
  /// closes open random-access byte sources, clears in-memory pending conflicts,
  /// and increments [_sessionGeneration] so in-flight callbacks/commits are
  /// dropped. Never deletes persisted packages on disk.
  void invalidateSession() {
    _sessionGeneration++;
    _pendingConflicts.clear();
    _activeStagingTxIds.clear();
    for (final token in List<RehearsalCancellationToken>.from(_activeTokens)) {
      token.cancel();
    }
    for (final source in List<FileRehearsalByteSource>.from(_openByteSources)) {
      unawaited(source.close().catchError((_) {}));
    }
    unawaited(_safPort.cancelOperation().catchError((_) => false));
  }

  /// Requests cooperative cancellation of any currently active operation.
  Future<void> cancelActiveOperation() async {
    for (final token in List<RehearsalCancellationToken>.from(_activeTokens)) {
      token.cancel();
    }
    await _safPort.cancelOperation().catchError((_) => false);
  }

  /// Recovers orphaned staging directories, temporary index files, and
  /// interrupted replacement `.backup.part` directories, and reconciles on-disk
  /// completeness for every indexed package.
  Future<int> recoverOrphanedTransactions({
    required String userId,
    Set<String> preserveStagingTransactionIds = const {},
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      throw StateError('UNAUTHENTICATED: userId must not be empty');
    }

    final storage = await _safPort.getStorageInfo();
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    return _recoverOrphanedTransactionsWithStorage(
      filesDirPath: storage.filesDirPath,
      accountHash: accountHash,
      preserveStagingTransactionIds: preserveStagingTransactionIds,
    );
  }

  Future<int> _recoverOrphanedTransactionsWithStorage({
    required String filesDirPath,
    required String accountHash,
    Set<String> preserveStagingTransactionIds = const {},
  }) async {
    final accountDir = _accountDir(filesDirPath, accountHash);
    if (!accountDir.existsSync()) {
      return 0;
    }

    var recoveredCount = 0;

    // 1. Remove leftover index.json.tmp.
    final tmpIndex = File('${accountDir.path}/$indexTmpFileName');
    if (tmpIndex.existsSync()) {
      _deleteFileQuietly(tmpIndex);
      recoveredCount++;
    }

    // 2. Clean orphaned staging entries (except active in-session conflict tx).
    final stagingDir = Directory('${accountDir.path}/staging');
    if (stagingDir.existsSync()) {
      for (final entity in stagingDir.listSync(followLinks: false)) {
        final name = _baseName(entity.path);
        if (entity is Directory && name.endsWith('.part')) {
          final txId = name.substring(0, name.length - 5);
          if (preserveStagingTransactionIds.contains(txId)) {
            continue;
          }
          _deleteDirectoryQuietly(entity);
          recoveredCount++;
        } else {
          if (entity is Directory) {
            _deleteDirectoryQuietly(entity);
          } else if (entity is File) {
            _deleteFileQuietly(entity);
          }
          recoveredCount++;
        }
      }
    }

    // 3. Recover or clean *.backup.part directories inside packages/.
    final records = _readIndexRecords(accountDir, accountHash);
    final indexedById = {for (final r in records) r.packageId: r};
    String? tryHashSmallFile(File f) {
      if (!f.existsSync()) return null;
      if (f.lengthSync() > RehearsalLimitsV1.maxManifestBytes) return null;
      return IncrementalSha256.computeHex(f.readAsBytesSync());
    }

    final packagesDir = Directory('${accountDir.path}/packages');
    if (packagesDir.existsSync()) {
      for (final entity in packagesDir.listSync(followLinks: false)) {
        final name = _baseName(entity.path);
        if (entity is Directory && name.endsWith('.backup.part')) {
          final pkgId = name.substring(0, name.length - '.backup.part'.length);
          if (!_uuidPattern.hasMatch(pkgId)) {
            _deleteDirectoryQuietly(entity);
            recoveredCount++;
            continue;
          }
          final baseDir = Directory('${packagesDir.path}/$pkgId');
          final record = indexedById[pkgId];
          if (!baseDir.existsSync()) {
            entity.renameSync(baseDir.path);
            recoveredCount++;
          } else if (record != null) {
            final expectedHash = record.manifestSha256.toLowerCase();
            final baseHash = tryHashSmallFile(
              File('${baseDir.path}/$manifestFileName'),
            );
            final backupHash = tryHashSmallFile(
              File('${entity.path}/$manifestFileName'),
            );
            if (baseHash != expectedHash && backupHash == expectedHash) {
              // OS crash occurred between directory swap and index.json rename:
              // restore the indexed backup directory.
              _deleteDirectoryQuietly(baseDir);
              entity.renameSync(baseDir.path);
              recoveredCount++;
            } else {
              // Safe to delete stale .backup.part.
              _deleteDirectoryQuietly(entity);
              recoveredCount++;
            }
          } else {
            // Unindexed base dir alongside backup: restore backup safely.
            _deleteDirectoryQuietly(baseDir);
            entity.renameSync(baseDir.path);
            recoveredCount++;
          }
        }
      }
    }

    // 4. Verify on-disk completeness for every indexed record.
    var indexDirty = false;
    final updatedRecords = <LocalRehearsalPackageRecord>[];
    for (final record in records) {
      final reconciled = _reconcileOnDiskCompleteness(accountDir, record);
      if (!identical(reconciled, record)) {
        indexDirty = true;
      }
      updatedRecords.add(reconciled);
    }

    if (indexDirty) {
      await _writeIndexAtomically(accountDir, accountHash, updatedRecords);
    }

    return recoveredCount;
  }

  /// Loads the account-scoped local rehearsal package library after running
  /// startup/pre-operation crash recovery and completeness reconciliation.
  Future<RehearsalLibrarySnapshot> loadLibrary({
    required String userId,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      throw StateError('UNAUTHENTICATED: userId must not be empty');
    }

    final storage = await _safPort.getStorageInfo();
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    final activeTxIds = _activePendingTxIdsForAccount(accountHash);
    final recovered = await _recoverOrphanedTransactionsWithStorage(
      filesDirPath: storage.filesDirPath,
      accountHash: accountHash,
      preserveStagingTransactionIds: activeTxIds,
    );

    final accountDir = _accountDir(storage.filesDirPath, accountHash);
    final records = _readIndexRecords(accountDir, accountHash)
      ..sort((a, b) {
        final cmp = b.importedAt.compareTo(a.importedAt);
        return cmp != 0 ? cmp : a.packageId.compareTo(b.packageId);
      });

    final occupiedBytes = _computeAccountPackagesBytes(accountDir);
    final corruptedOrIncompleteCount = records
        .where((r) => r.integrityState != RehearsalPackageIntegrityState.verified)
        .length;

    return RehearsalLibrarySnapshot(
      packages: List<LocalRehearsalPackageRecord>.unmodifiable(records),
      storageSummary: RehearsalStorageSummary(
        accountNamespaceHash: accountHash,
        filesDirPath: storage.filesDirPath,
        availableBytes: storage.availableBytes,
        totalBytes: storage.totalBytes,
        occupiedByAccountBytes: occupiedBytes,
        requiredReserveBytes: RehearsalLimitsV1.minFreeSpaceReserveBytes,
        packageCount: records.length,
      ),
      recoveredOrphanedCount: recovered,
      corruptedOrIncompleteCount: corruptedOrIncompleteCount,
    );
  }

  /// Returns metadata for a single package inside the authenticated user's
  /// account namespace, or `null` if it does not exist.
  Future<LocalRehearsalPackageRecord?> getPackageDetails({
    required String userId,
    required String packageId,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      throw StateError('UNAUTHENTICATED: userId must not be empty');
    }
    final normalizedPkgId = packageId.trim().toLowerCase();
    if (!_uuidPattern.hasMatch(normalizedPkgId)) {
      return null;
    }

    final storage = await _safPort.getStorageInfo();
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    final accountDir = _accountDir(storage.filesDirPath, accountHash);
    final records = _readIndexRecords(accountDir, accountHash);
    for (final record in records) {
      if (record.packageId == normalizedPkgId) {
        return _reconcileOnDiskCompleteness(accountDir, record);
      }
    }
    return null;
  }

  /// Imports a `.louvaio-rehearsal.zip` package selected via native SAF.
  Future<RehearsalOperationOutcome> importFromSaf({
    required String userId,
    void Function(RehearsalOperationProgress)? onProgress,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para importar pacotes de ensaio locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }

    final generation = _sessionGeneration;
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    final txId = _nextTransactionId();
    final token = RehearsalCancellationToken();
    _activeTokens.add(token);

    Directory? txDir;
    StreamSubscription<SafProgressEvent>? progressSub;

    void emit(
      RehearsalOperationPhase phase,
      String label, {
      int bytesProcessed = 0,
      int? totalBytes,
      String? detail,
    }) {
      if (generation != _sessionGeneration || onProgress == null) return;
      onProgress(
        RehearsalOperationProgress(
          operationId: txId,
          phase: phase,
          phaseLabel: label,
          bytesProcessed: bytesProcessed,
          totalBytes: totalBytes,
          detailMessage: detail,
        ),
      );
    }

    try {
      emit(
        RehearsalOperationPhase.preflight,
        'Verificando armazenamento disponível',
      );

      late final SafStorageInfo storage;
      try {
        storage = await _safPort.getStorageInfo();
      } on SafChannelException catch (ex) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Armazenamento indisponível',
          message: ex.message,
          errorCode: ex.code,
        );
      }

      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }

      final accountDir = _accountDir(storage.filesDirPath, accountHash);
      final recoveredCount = await _recoverOrphanedTransactionsWithStorage(
        filesDirPath: storage.filesDirPath,
        accountHash: accountHash,
        preserveStagingTransactionIds: _activePendingTxIdsForAccount(accountHash),
      );

      if (storage.availableBytes < RehearsalLimitsV1.minFreeSpaceReserveBytes) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.insufficientSpace,
          title: 'Espaço livre insuficiente',
          message:
              'É necessário manter pelo menos 256 MiB livres no dispositivo para iniciar a importação com segurança.',
          errorCode: 'INSUFFICIENT_STORAGE',
          recoveredOrphanedCount: recoveredCount,
        );
      }

      _activeStagingTxIds.add(txId);
      txDir = _createStagingDir(accountDir, txId);
      _writeStagingJournal(
        txDir,
        txId: txId,
        phase: 'staging_copy',
        accountNamespaceHash: accountHash,
      );

      final stageZipFile = File('${txDir.path}/$stagedArchiveFileName');
      emit(
        RehearsalOperationPhase.picking,
        'Selecionando pacote de ensaio no dispositivo',
      );

      progressSub = _safPort.progressStream
          .where((e) => e.operationId == txId)
          .listen((event) {
            if (generation != _sessionGeneration) return;
            emit(
              RehearsalOperationPhase.stagingCopy,
              'Copiando pacote para área temporária segura',
              bytesProcessed: event.bytesProcessed,
              totalBytes: event.totalBytes,
            );
          });

      final safResult = await _safPort.pickAndStagePackage(
        operationId: txId,
        targetStageFilePath: stageZipFile.path,
        maxBytes: RehearsalLimitsV1.maxCompressedBytes,
        requiredReserveBytes: RehearsalLimitsV1.minFreeSpaceReserveBytes,
      );

      // Allow any already-queued broadcast stream microtasks to flush before cancelling.
      await Future<void>.delayed(Duration.zero);
      await progressSub.cancel();
      progressSub = null;

      if (_isSessionStaleOrCancelled(generation, token)) {
        _deleteDirectoryQuietly(txDir);
        return _sessionOrCancelledOutcome(
          generation,
          recoveredOrphanedCount: recoveredCount,
        );
      }

      if (safResult.status == SafStageStatus.cancelled) {
        _deleteDirectoryQuietly(txDir);
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.cancelled,
          title: 'Importação cancelada',
          message: 'A seleção do arquivo foi cancelada.',
          errorCode: 'OPERATION_CANCELLED',
          recoveredOrphanedCount: recoveredCount,
        );
      }

      if (safResult.status != SafStageStatus.staged) {
        _deleteDirectoryQuietly(txDir);
        return _mapSafStageError(
          safResult,
          recoveredOrphanedCount: recoveredCount,
        );
      }

      final stagedPath = safResult.stagedFilePath ?? stageZipFile.path;
      final stagedFile = File(stagedPath);
      if (!stagedFile.existsSync() || stagedFile.lengthSync() <= 0) {
        _deleteDirectoryQuietly(txDir);
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Arquivo vazio ou ilegível',
          message: 'O arquivo selecionado está vazio ou não pôde ser copiado.',
          errorCode: 'EMPTY_OR_CORRUPTED',
          recoveredOrphanedCount: recoveredCount,
        );
      }

      final copiedBytes = safResult.bytesCopied ?? stagedFile.lengthSync();
      emit(
        RehearsalOperationPhase.stagingCopy,
        'Copiando pacote para área temporária segura',
        bytesProcessed: copiedBytes,
        totalBytes: copiedBytes,
      );

      return await _validateAndPublishStagedZip(
        userId: normalizedUserId,
        accountHash: accountHash,
        accountDir: accountDir,
        txId: txId,
        txDir: txDir,
        stagedZipFile: stagedFile,
        generation: generation,
        token: token,
        allowReplacePackageId: null,
        recoveredOrphanedCount: recoveredCount,
        onProgress: onProgress,
      );
    } catch (error) {
      if (txDir != null) {
        _deleteDirectoryQuietly(txDir);
      }
      if (_isEnospc(error)) {
        return const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.insufficientSpace,
          title: 'Espaço esgotado',
          message:
              'O armazenamento interno ficou sem espaço durante a importação. Nenhum arquivo anterior foi alterado.',
          errorCode: 'ENOSPC',
        );
      }
      return RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Falha ao importar pacote',
        message: 'Não foi possível concluir a importação: $error',
        errorCode: 'IMPORT_FAILED',
      );
    } finally {
      _activeStagingTxIds.remove(txId);
      await progressSub?.cancel();
      _activeTokens.remove(token);
    }
  }

  /// Imports a pre-staged `.louvaio-rehearsal.zip` archive by copying it into a
  /// fresh transaction directory (without mutating [stagedArchiveFile]) and
  /// executing the shared validation + atomic extraction pipeline.
  Future<RehearsalOperationOutcome> importStagedArchive({
    required String userId,
    required File stagedArchiveFile,
    void Function(RehearsalOperationProgress)? onProgress,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para importar pacotes de ensaio locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }
    if (!stagedArchiveFile.existsSync()) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Arquivo indisponível',
        message: 'O arquivo de origem não foi encontrado.',
        errorCode: 'SOURCE_UNAVAILABLE',
      );
    }

    final generation = _sessionGeneration;
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    final txId = _nextTransactionId();
    final token = RehearsalCancellationToken();
    _activeTokens.add(token);

    Directory? txDir;
    try {
      final storage = await _safPort.getStorageInfo();
      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }

      final accountDir = _accountDir(storage.filesDirPath, accountHash);
      final recoveredCount = await _recoverOrphanedTransactionsWithStorage(
        filesDirPath: storage.filesDirPath,
        accountHash: accountHash,
        preserveStagingTransactionIds: _activePendingTxIdsForAccount(accountHash),
      );

      if (storage.availableBytes < RehearsalLimitsV1.minFreeSpaceReserveBytes) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.insufficientSpace,
          title: 'Espaço livre insuficiente',
          message:
              'É necessário manter pelo menos 256 MiB livres no dispositivo para importar o pacote.',
          errorCode: 'INSUFFICIENT_STORAGE',
          recoveredOrphanedCount: recoveredCount,
        );
      }

      final sourceLength = stagedArchiveFile.lengthSync();
      if (sourceLength > RehearsalLimitsV1.maxCompressedBytes) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.incompatible,
          title: 'Pacote excede o limite permitido',
          message: 'O arquivo excede o limite máximo de 2 GiB.',
          errorCode: 'PACKAGE_TOO_LARGE',
          recoveredOrphanedCount: recoveredCount,
        );
      }

      _activeStagingTxIds.add(txId);
      txDir = _createStagingDir(accountDir, txId);
      _writeStagingJournal(
        txDir,
        txId: txId,
        phase: 'staging_copy',
        accountNamespaceHash: accountHash,
      );

      final stagedCopy = File('${txDir.path}/$stagedArchiveFileName');
      await _copyFileBounded(
        source: stagedArchiveFile,
        target: stagedCopy,
        token: token,
      );

      if (_isSessionStaleOrCancelled(generation, token)) {
        _deleteDirectoryQuietly(txDir);
        return _sessionOrCancelledOutcome(
          generation,
          recoveredOrphanedCount: recoveredCount,
        );
      }

      return await _validateAndPublishStagedZip(
        userId: normalizedUserId,
        accountHash: accountHash,
        accountDir: accountDir,
        txId: txId,
        txDir: txDir,
        stagedZipFile: stagedCopy,
        generation: generation,
        token: token,
        allowReplacePackageId: null,
        recoveredOrphanedCount: recoveredCount,
        onProgress: onProgress,
      );
    } catch (error) {
      if (txDir != null) {
        _deleteDirectoryQuietly(txDir);
      }
      if (_isEnospc(error)) {
        return const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.insufficientSpace,
          title: 'Espaço esgotado',
          message:
              'O armazenamento interno ficou sem espaço durante a importação.',
          errorCode: 'ENOSPC',
        );
      }
      return RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Falha ao importar pacote',
        message: 'Não foi possível concluir a importação: $error',
        errorCode: 'IMPORT_FAILED',
      );
    } finally {
      _activeStagingTxIds.remove(txId);
      _activeTokens.remove(token);
    }
  }

  /// Confirms replacement of an existing package after an earlier `conflict`
  /// outcome in the same active session.
  Future<RehearsalOperationOutcome> confirmConflictReplace({
    required String userId,
    required String pendingTransactionId,
    void Function(RehearsalOperationProgress)? onProgress,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para substituir o pacote local.',
        errorCode: 'UNAUTHENTICATED',
      );
    }

    final pending = _pendingConflicts.remove(pendingTransactionId);
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    if (pending == null ||
        pending.accountNamespaceHash != accountHash ||
        pending.sessionGeneration != _sessionGeneration ||
        !pending.stagedZipFile.existsSync()) {
      if (pending != null) {
        _deleteDirectoryQuietly(pending.txDir);
      }
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Substituição expirada',
        message:
            'Os dados temporários da substituição não estão mais disponíveis. Selecione o arquivo novamente.',
        errorCode: 'PENDING_CONFLICT_EXPIRED',
      );
    }

    final generation = _sessionGeneration;
    final token = RehearsalCancellationToken();
    _activeTokens.add(token);
    _activeStagingTxIds.add(pending.txId);

    try {
      final storage = await _safPort.getStorageInfo();
      if (_isSessionStaleOrCancelled(generation, token)) {
        _deleteDirectoryQuietly(pending.txDir);
        return _sessionOrCancelledOutcome(generation);
      }

      final accountDir = _accountDir(storage.filesDirPath, accountHash);
      return await _validateAndPublishStagedZip(
        userId: normalizedUserId,
        accountHash: accountHash,
        accountDir: accountDir,
        txId: pending.txId,
        txDir: pending.txDir,
        stagedZipFile: pending.stagedZipFile,
        generation: generation,
        token: token,
        allowReplacePackageId: pending.packageId,
        recoveredOrphanedCount: 0,
        onProgress: onProgress,
      );
    } finally {
      _activeStagingTxIds.remove(pending.txId);
      _activeTokens.remove(token);
    }
  }

  /// Discards a pending conflict staging transaction without modifying the
  /// existing committed package.
  Future<void> discardPendingConflict({
    required String userId,
    required String pendingTransactionId,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      throw StateError('UNAUTHENTICATED: userId must not be empty');
    }

    final pending = _pendingConflicts.remove(pendingTransactionId);
    if (pending != null) {
      _deleteDirectoryQuietly(pending.txDir);
    }

    if (_txIdPattern.hasMatch(pendingTransactionId)) {
      final storage = await _safPort.getStorageInfo();
      final accountHash = computeAccountNamespaceHash(normalizedUserId);
      final accountDir = _accountDir(storage.filesDirPath, accountHash);
      final txDir = Directory(
        '${accountDir.path}/staging/$pendingTransactionId.part',
      );
      _deleteDirectoryQuietly(txDir);
    }
  }

  /// Revalidates all extracted files on disk and the archived `.louvaio-rehearsal.zip`
  /// for [packageId], updating `integrityState` and `lastValidatedAt` in `index.json`.
  Future<RehearsalOperationOutcome> revalidatePackage({
    required String userId,
    required String packageId,
    void Function(RehearsalOperationProgress)? onProgress,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para revalidar pacotes locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }

    final normalizedPkgId = packageId.trim().toLowerCase();
    if (!_uuidPattern.hasMatch(normalizedPkgId)) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Pacote inválido',
        message: 'Identificador de pacote inválido.',
        errorCode: 'INVALID_PACKAGE_ID',
      );
    }

    final generation = _sessionGeneration;
    final opId = _nextTransactionId();
    final token = RehearsalCancellationToken();
    _activeTokens.add(token);

    void emit(int bytesProcessed, int? totalBytes, [String? detail]) {
      if (generation != _sessionGeneration || onProgress == null) return;
      onProgress(
        RehearsalOperationProgress(
          operationId: opId,
          phase: RehearsalOperationPhase.revalidating,
          phaseLabel: 'Revalidando integridade do pacote local',
          bytesProcessed: bytesProcessed,
          totalBytes: totalBytes,
          detailMessage: detail,
        ),
      );
    }

    try {
      final storage = await _safPort.getStorageInfo();
      final accountHash = computeAccountNamespaceHash(normalizedUserId);
      final accountDir = _accountDir(storage.filesDirPath, accountHash);
      final records = _readIndexRecords(accountDir, accountHash);
      final idx = records.indexWhere((r) => r.packageId == normalizedPkgId);
      if (idx == -1) {
        return const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Pacote não encontrado',
          message: 'O pacote solicitado não existe nesta conta.',
          errorCode: 'PACKAGE_NOT_FOUND',
        );
      }

      final record = records[idx];
      final verified = await _performFullDiskRevalidation(
        accountDir: accountDir,
        record: record,
        token: token,
        onProgress: emit,
      );

      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }

      records[idx] = verified.updatedRecord;
      await _writeIndexAtomically(accountDir, accountHash, records);

      if (verified.updatedRecord.integrityState !=
          RehearsalPackageIntegrityState.verified) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Integridade comprometida',
          message:
              verified.updatedRecord.integrityMessage ??
              'Foram detectados arquivos corrompidos ou ausentes neste pacote.',
          errorCode: verified.updatedRecord.integrityCode,
          record: verified.updatedRecord,
        );
      }

      return RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.revalidated,
        title: 'Pacote íntegro',
        message:
            'Todos os arquivos e assinaturas de "${verified.updatedRecord.displayName}" foram verificados.',
        record: verified.updatedRecord,
      );
    } on FileSystemException {
      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }
      rethrow;
    } finally {
      _activeTokens.remove(token);
    }
  }

  /// Updates the user-defined local [customLabel] (1..120 chars after trim) in
  /// `index.json` without modifying package hashes or audio files on disk.
  Future<RehearsalOperationOutcome> renamePackageLabel({
    required String userId,
    required String packageId,
    required String newLabel,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para renomear pacotes locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }

    final normalizedPkgId = packageId.trim().toLowerCase();
    if (!_uuidPattern.hasMatch(normalizedPkgId)) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Pacote inválido',
        message: 'Identificador de pacote inválido.',
        errorCode: 'INVALID_PACKAGE_ID',
      );
    }

    final trimmed = newLabel.trim();
    if (trimmed.isEmpty || trimmed.length > 120) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Rótulo inválido',
        message: 'O rótulo local deve ter entre 1 e 120 caracteres.',
        errorCode: 'INVALID_LABEL',
      );
    }

    final generation = _sessionGeneration;
    final storage = await _safPort.getStorageInfo();
    if (generation != _sessionGeneration) {
      return _sessionOrCancelledOutcome(generation);
    }

    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    final accountDir = _accountDir(storage.filesDirPath, accountHash);
    final records = _readIndexRecords(accountDir, accountHash);
    final idx = records.indexWhere((r) => r.packageId == normalizedPkgId);
    if (idx == -1) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Pacote não encontrado',
        message: 'O pacote solicitado não existe nesta conta.',
        errorCode: 'PACKAGE_NOT_FOUND',
      );
    }

    final updated = records[idx].copyWith(customLabel: trimmed);
    records[idx] = updated;
    await _writeIndexAtomically(accountDir, accountHash, records);

    return RehearsalOperationOutcome(
      category: RehearsalUserOutcomeCategory.renamed,
      title: 'Rótulo atualizado',
      message: 'Nome local atualizado para "${updated.displayName}".',
      record: updated,
    );
  }

  /// Validates local integrity and exports `package.louvaio-rehearsal.zip` via SAF.
  ///
  /// Refuses export if the package is `corrupted`, `incomplete`, or `missingFiles`.
  Future<RehearsalOperationOutcome> exportPackage({
    required String userId,
    required String packageId,
    void Function(RehearsalOperationProgress)? onProgress,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para exportar pacotes locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }

    final normalizedPkgId = packageId.trim().toLowerCase();
    if (!_uuidPattern.hasMatch(normalizedPkgId)) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Pacote inválido',
        message: 'Identificador de pacote inválido.',
        errorCode: 'INVALID_PACKAGE_ID',
      );
    }

    final generation = _sessionGeneration;
    final opId = _nextTransactionId();
    final token = RehearsalCancellationToken();
    _activeTokens.add(token);
    StreamSubscription<SafProgressEvent>? progressSub;

    try {
      final storage = await _safPort.getStorageInfo();
      final accountHash = computeAccountNamespaceHash(normalizedUserId);
      final accountDir = _accountDir(storage.filesDirPath, accountHash);
      final records = _readIndexRecords(accountDir, accountHash);
      final idx = records.indexWhere((r) => r.packageId == normalizedPkgId);
      if (idx == -1) {
        return const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Pacote não encontrado',
          message: 'O pacote solicitado não existe nesta conta.',
          errorCode: 'PACKAGE_NOT_FOUND',
        );
      }

      final record = records[idx];
      if (record.integrityState == RehearsalPackageIntegrityState.corrupted ||
          record.integrityState == RehearsalPackageIntegrityState.incomplete ||
          record.integrityState == RehearsalPackageIntegrityState.missingFiles) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Exportação bloqueada',
          message:
              'Este pacote está ${record.integrityState.name} e não pode ser exportado com segurança.',
          errorCode: record.integrityCode ?? 'INTEGRITY_CHECK_FAILED',
          record: record,
        );
      }

      // Re-verify integrity on disk before streaming out to SAF.
      final revalidation = await _performFullDiskRevalidation(
        accountDir: accountDir,
        record: record,
        token: token,
      );
      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }

      records[idx] = revalidation.updatedRecord;
      await _writeIndexAtomically(accountDir, accountHash, records);

      if (revalidation.updatedRecord.integrityState !=
          RehearsalPackageIntegrityState.verified) {
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Exportação bloqueada',
          message:
              revalidation.updatedRecord.integrityMessage ??
              'Integridade do pacote falhou antes da exportação.',
          errorCode: revalidation.updatedRecord.integrityCode,
          record: revalidation.updatedRecord,
        );
      }

      final pkgDir = _packageDir(accountDir, normalizedPkgId);
      final archiveFile = File('${pkgDir.path}/$stagedArchiveFileName');
      final suggestedName =
          '${revalidation.updatedRecord.displayName}.louvaio-rehearsal.zip';

      progressSub = _safPort.progressStream
          .where((e) => e.operationId == opId)
          .listen((event) {
            if (generation != _sessionGeneration || onProgress == null) return;
            onProgress(
              RehearsalOperationProgress(
                operationId: opId,
                phase: RehearsalOperationPhase.exporting,
                phaseLabel: 'Exportando pacote de ensaio',
                bytesProcessed: event.bytesProcessed,
                totalBytes: event.totalBytes,
              ),
            );
          });

      final exportResult = await _safPort.exportPackageToUri(
        operationId: opId,
        sourceFilePath: archiveFile.path,
        suggestedFileName: suggestedName,
      );

      await Future<void>.delayed(Duration.zero);
      await progressSub.cancel();
      progressSub = null;

      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }

      return switch (exportResult.status) {
        SafExportStatus.exported => RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.exported,
          title: 'Pacote exportado',
          message:
              'Uma cópia de "${revalidation.updatedRecord.displayName}" foi salva no destino escolhido.',
          record: revalidation.updatedRecord,
        ),
        SafExportStatus.cancelled => const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.cancelled,
          title: 'Exportação cancelada',
          message: 'A exportação do pacote foi cancelada.',
          errorCode: 'OPERATION_CANCELLED',
        ),
        SafExportStatus.error => RehearsalOperationOutcome(
          category: exportResult.code == 'INSUFFICIENT_STORAGE'
              ? RehearsalUserOutcomeCategory.insufficientSpace
              : RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Falha ao exportar pacote',
          message:
              exportResult.message ??
              'Não foi possível gravar o pacote no destino selecionado.',
          errorCode: exportResult.code ?? 'EXPORT_FAILED',
          record: revalidation.updatedRecord,
        ),
      };
    } on FileSystemException {
      if (_isSessionStaleOrCancelled(generation, token)) {
        return _sessionOrCancelledOutcome(generation);
      }
      rethrow;
    } finally {
      await progressSub?.cancel();
      _activeTokens.remove(token);
    }
  }

  /// Deletes only the app-private copy and metadata record for [packageId],
  /// requiring explicit [confirmedScope] confirmation and never touching any
  /// external user files.
  Future<RehearsalOperationOutcome> deletePackage({
    required String userId,
    required String packageId,
    required bool confirmedScope,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Sessão indisponível',
        message: 'Faça login para remover pacotes locais.',
        errorCode: 'UNAUTHENTICATED',
      );
    }

    if (!confirmedScope) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Confirmação obrigatória',
        message:
            'Confirme a exclusão apenas da cópia local interna do aplicativo antes de prosseguir.',
        errorCode: 'CONFIRMATION_REQUIRED',
      );
    }

    final normalizedPkgId = packageId.trim().toLowerCase();
    if (!_uuidPattern.hasMatch(normalizedPkgId)) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Pacote inválido',
        message: 'Identificador de pacote inválido.',
        errorCode: 'INVALID_PACKAGE_ID',
      );
    }

    final storage = await _safPort.getStorageInfo();
    final accountHash = computeAccountNamespaceHash(normalizedUserId);
    final accountDir = _accountDir(storage.filesDirPath, accountHash);
    final records = _readIndexRecords(accountDir, accountHash);
    final idx = records.indexWhere((r) => r.packageId == normalizedPkgId);
    if (idx == -1) {
      return const RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Pacote não encontrado',
        message: 'O pacote solicitado não existe nesta conta.',
        errorCode: 'PACKAGE_NOT_FOUND',
      );
    }

    final removed = records.removeAt(idx);
    await _writeIndexAtomically(accountDir, accountHash, records);

    final pkgDir = _packageDir(accountDir, normalizedPkgId);
    _deleteDirectoryQuietly(pkgDir);
    final backupDir = Directory(
      '${accountDir.path}/packages/$normalizedPkgId.backup.part',
    );
    _deleteDirectoryQuietly(backupDir);

    return RehearsalOperationOutcome(
      category: RehearsalUserOutcomeCategory.deleted,
      title: 'Cópia local removida',
      message:
          'O pacote "${removed.displayName}" foi removido do armazenamento interno do aplicativo. Arquivos externos permanecem intactos.',
      record: removed,
    );
  }

  // ---------------------------------------------------------------------------
  // Transactional validation + extraction + atomic commit pipeline
  // ---------------------------------------------------------------------------

  Future<RehearsalOperationOutcome> _validateAndPublishStagedZip({
    required String userId,
    required String accountHash,
    required Directory accountDir,
    required String txId,
    required Directory txDir,
    required File stagedZipFile,
    required int generation,
    required RehearsalCancellationToken token,
    required String? allowReplacePackageId,
    required int recoveredOrphanedCount,
    void Function(RehearsalOperationProgress)? onProgress,
  }) async {
    void emit(
      RehearsalOperationPhase phase,
      String label, {
      int bytesProcessed = 0,
      int? totalBytes,
      String? detail,
    }) {
      if (generation != _sessionGeneration || onProgress == null) return;
      onProgress(
        RehearsalOperationProgress(
          operationId: txId,
          phase: phase,
          phaseLabel: label,
          bytesProcessed: bytesProcessed,
          totalBytes: totalBytes,
          detailMessage: detail,
        ),
      );
    }

    FileRehearsalByteSource? byteSource;
    try {
      _writeStagingJournal(
        txDir,
        txId: txId,
        phase: 'validating',
        accountNamespaceHash: accountHash,
      );

      final storage = await _safPort.getStorageInfo();
      if (_isSessionStaleOrCancelled(generation, token)) {
        _deleteDirectoryQuietly(txDir);
        return _sessionOrCancelledOutcome(
          generation,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      final existingRecords = _readIndexRecords(accountDir, accountHash);
      final existingPackagesForValidation = existingRecords
          .where((r) => r.packageId != allowReplacePackageId)
          .map(
            (r) => ExistingRehearsalPackage(
              packageId: r.packageId,
              compositeSha256: r.compositeSha256,
              manifestSha256: r.manifestSha256,
            ),
          )
          .toList(growable: false);

      byteSource = FileRehearsalByteSource(stagedZipFile);
      _openByteSources.add(byteSource);
      await byteSource.open();

      emit(
        RehearsalOperationPhase.validating,
        'Validando estrutura, manifesto e assinaturas do pacote',
        totalBytes: byteSource.byteLength,
      );

      final validation = await validateRehearsalPackage(
        byteSource,
        options: RehearsalValidationOptions(
          availableStorageBytes: storage.availableBytes,
          includeSourceCopy: false,
          existingPackages: existingPackagesForValidation,
          cancellationToken: token,
          onProgress: (processed, total) {
            emit(
              RehearsalOperationPhase.validating,
              'Validando estrutura, manifesto e assinaturas do pacote',
              bytesProcessed: processed,
              totalBytes: total,
            );
          },
        ),
      );

      if (_isSessionStaleOrCancelled(generation, token)) {
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        return _sessionOrCancelledOutcome(
          generation,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      // Conflict detection: hold staging ONLY for current active session.
      if (validation.status == RehearsalValidationStatus.conflict) {
        final identity = validation.packageIdentity!;
        final summary = validation.manifestSummary!;
        final existing = existingRecords.firstWhere(
          (r) => r.packageId == identity.packageId,
        );

        _writeStagingJournal(
          txDir,
          txId: txId,
          phase: 'awaiting_conflict_resolution',
          accountNamespaceHash: accountHash,
          packageId: identity.packageId,
        );

        _pendingConflicts[txId] = _PendingConflictEntry(
          txId: txId,
          userId: userId,
          accountNamespaceHash: accountHash,
          sessionGeneration: generation,
          packageId: identity.packageId,
          stagedZipFile: stagedZipFile,
          txDir: txDir,
        );

        await _closeAndUntrackSource(byteSource);
        byteSource = null;

        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.conflict,
          title: 'Pacote já existente',
          message:
              'Já existe um pacote local com o mesmo identificador, mas conteúdo diferente. Deseja substituir a cópia atual?',
          errorCode: 'PACKAGE_IDENTITY_CONFLICT',
          recoveredOrphanedCount: recoveredOrphanedCount,
          conflict: RehearsalConflictDetails(
            packageId: identity.packageId,
            pendingTransactionId: txId,
            existingRecord: existing,
            incomingDisplayName: summary.displayName,
            incomingRevision: identity.revision,
            incomingCompositeSha256: identity.compositeSha256 ?? '',
          ),
        );
      }

      // Idempotent re-import: same identity and same composite/manifest hashes.
      if (validation.idempotencyDisposition == 'idempotent_noop') {
        final identity = validation.packageIdentity!;
        final existing = existingRecords
            .where((r) => r.packageId == identity.packageId)
            .firstOrNull;
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);

        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.idempotentNoop,
          title: 'Pacote já importado',
          message:
              'Esta versão idêntica do pacote "${existing?.displayName ?? validation.manifestSummary?.displayName ?? identity.packageId}" já está armazenada neste dispositivo.',
          record: existing,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      if (!validation.readyForPublication) {
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        return _mapValidationFailure(
          validation,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      final identity = validation.packageIdentity!;
      final summary = validation.manifestSummary!;
      if (allowReplacePackageId != null &&
          identity.packageId != allowReplacePackageId) {
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        return const RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Identidade divergente',
          message:
              'O pacote em staging não corresponde ao pacote selecionado para substituição.',
          errorCode: 'CONFLICT_PACKAGE_MISMATCH',
        );
      }

      // Explicit peak + reserve storage gate before extraction.
      final archiveBytes = stagedZipFile.lengthSync();
      final declaredExtractedBytes = validation.budget.declaredExtractedBytes;
      final peakBytes = archiveBytes + declaredExtractedBytes;
      final reserveBytes = math.max(
        RehearsalLimitsV1.minFreeSpaceReserveBytes,
        (peakBytes * RehearsalLimitsV1.minFreeSpaceReserveRatio).ceil(),
      );
      if (storage.availableBytes < declaredExtractedBytes + reserveBytes) {
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.insufficientSpace,
          title: 'Espaço insuficiente para extração',
          message:
              'Espaço livre insuficiente para extrair o pacote mantendo a reserva mínima de segurança.',
          errorCode: 'INSUFFICIENT_STORAGE',
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      // Extra T8 manifest cross-check gate before any media extraction sink opens.
      final crossCheck = await _crossCheckManifestBeforeExtraction(
        source: byteSource,
        identity: identity,
        summary: summary,
        token: token,
      );
      if (!crossCheck.isValid) {
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Manifesto inconsistente',
          message:
              crossCheck.errorMessage ??
              'Falha na verificação cruzada do manifesto.',
          errorCode: crossCheck.errorCode ?? 'INVALID_MANIFEST_JSON',
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      // Phase 2: verified extraction into txDir using strictly mapped names.
      _writeStagingJournal(
        txDir,
        txId: txId,
        phase: 'extracting',
        accountNamespaceHash: accountHash,
        packageId: identity.packageId,
      );

      final openedSinks = <IOSink>[];
      late final RehearsalValidationResult extractionResult;
      try {
        extractionResult = await validateAndExtractRehearsalPackage(
          byteSource,
          options: RehearsalValidationOptions(
            availableStorageBytes: storage.availableBytes,
            includeSourceCopy: false,
            existingPackages: existingPackagesForValidation,
            cancellationToken: token,
          ),
          openTargetSink: (entry) async {
            final internalName = resolveInternalFileName(entry);
            final targetFile = File('${txDir.path}/$internalName');
            final sink = await _sinkFactory(targetFile);
            openedSinks.add(sink);
            return sink;
          },
          onExtractProgress: (extracted, total) {
            emit(
              RehearsalOperationPhase.extracting,
              'Extraindo faixas verificadas para área privada',
              bytesProcessed: extracted,
              totalBytes: total,
            );
          },
        );
      } on FileSystemException catch (fsEx) {
        await _closeSinksQuietly(openedSinks);
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        if (_isEnospc(fsEx)) {
          return RehearsalOperationOutcome(
            category: RehearsalUserOutcomeCategory.insufficientSpace,
            title: 'Espaço esgotado durante extração',
            message:
                'Não houve espaço suficiente em disco ao extrair o pacote. Todos os arquivos temporários foram removidos e sua biblioteca anterior permanece intacta.',
            errorCode: 'ENOSPC',
            recoveredOrphanedCount: recoveredOrphanedCount,
          );
        }
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Erro de escrita no armazenamento',
          message:
              'Falha ao gravar arquivos extraídos: ${fsEx.message}. Nenhum dado anterior foi alterado.',
          errorCode: 'EXTRACTION_IO_ERROR',
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      } catch (err) {
        await _closeSinksQuietly(openedSinks);
        await _closeAndUntrackSource(byteSource);
        byteSource = null;
        _deleteDirectoryQuietly(txDir);
        if (_isEnospc(err)) {
          return RehearsalOperationOutcome(
            category: RehearsalUserOutcomeCategory.insufficientSpace,
            title: 'Espaço esgotado durante extração',
            message:
                'Não houve espaço suficiente em disco ao extrair o pacote.',
            errorCode: 'ENOSPC',
            recoveredOrphanedCount: recoveredOrphanedCount,
          );
        }
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.recoverableFailure,
          title: 'Falha durante extração',
          message: 'Erro inesperado durante extração: $err',
          errorCode: 'EXTRACTION_FAILED',
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      await _closeAndUntrackSource(byteSource);
      byteSource = null;

      if (_isSessionStaleOrCancelled(generation, token)) {
        _deleteDirectoryQuietly(txDir);
        return _sessionOrCancelledOutcome(
          generation,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      if (!extractionResult.readyForPublication) {
        _deleteDirectoryQuietly(txDir);
        return _mapValidationFailure(
          extractionResult,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      // Verify every extracted file on disk matches expected length & SHA-256.
      final stemsMap = <String, LocalRehearsalStemMetadata>{};
      LocalRehearsalStemMetadata? originalMeta;
      var verifiedActualExtractedBytes = 0;

      for (final entry in extractionResult.verifiedEntries) {
        final internalName = resolveInternalFileName(entry);
        final fileOnDisk = File('${txDir.path}/$internalName');
        if (!fileOnDisk.existsSync()) {
          _deleteDirectoryQuietly(txDir);
          return RehearsalOperationOutcome(
            category: RehearsalUserOutcomeCategory.corrupted,
            title: 'Extração incompleta',
            message: 'Arquivo extraído ausente após gravação.',
            errorCode: 'EXTRACTED_FILE_MISSING',
            recoveredOrphanedCount: recoveredOrphanedCount,
          );
        }
        final actualSize = fileOnDisk.lengthSync();
        if (actualSize != entry.uncompressedBytes) {
          _deleteDirectoryQuietly(txDir);
          return RehearsalOperationOutcome(
            category: RehearsalUserOutcomeCategory.corrupted,
            title: 'Extração inconsistente',
            message: 'Tamanho gravado em disco diverge do esperado.',
            errorCode: 'EXTRACTED_SIZE_MISMATCH',
            recoveredOrphanedCount: recoveredOrphanedCount,
          );
        }
        final diskSha = await _computeFileSha256Streaming(fileOnDisk, token);
        if (diskSha != entry.sha256) {
          _deleteDirectoryQuietly(txDir);
          return RehearsalOperationOutcome(
            category: RehearsalUserOutcomeCategory.corrupted,
            title: 'Falha de integridade pós-extração',
            message: 'Assinatura SHA-256 em disco diverge do arquivo validado.',
            errorCode: 'EXTRACTED_SHA256_MISMATCH',
            recoveredOrphanedCount: recoveredOrphanedCount,
          );
        }

        verifiedActualExtractedBytes += actualSize;

        if (entry.role == 'stem') {
          final audio = entry.audioInfo!;
          stemsMap[entry.stemId!] = LocalRehearsalStemMetadata(
            id: entry.stemId!,
            internalFileName: internalName,
            container: audio.container,
            codec: audio.codec,
            byteLength: entry.uncompressedBytes,
            sha256: entry.sha256,
            decodedFrames: audio.decodedFrames,
            sampleRate: audio.sampleRate,
            channels: audio.channels,
          );
        } else if (entry.role == 'original') {
          final audio = entry.audioInfo!;
          originalMeta = LocalRehearsalStemMetadata(
            id: 'original',
            internalFileName: internalName,
            container: audio.container,
            codec: audio.codec,
            byteLength: entry.uncompressedBytes,
            sha256: entry.sha256,
            decodedFrames: audio.decodedFrames,
            sampleRate: audio.sampleRate,
            channels: audio.channels,
          );
        }
      }

      if (stemsMap.length != RehearsalLimitsV1.requiredStemIds.length) {
        _deleteDirectoryQuietly(txDir);
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Stems incompletos',
          message: 'Nem todos os 4 stems obrigatórios foram extraídos.',
          errorCode: 'MISSING_REQUIRED_STEM',
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      if (!stagedZipFile.existsSync() ||
          stagedZipFile.lengthSync() != archiveBytes) {
        _deleteDirectoryQuietly(txDir);
        return RehearsalOperationOutcome(
          category: RehearsalUserOutcomeCategory.corrupted,
          title: 'Arquivo de pacote ausente',
          message: 'O arquivo compactado de staging não foi encontrado.',
          errorCode: 'STAGED_ARCHIVE_MISSING',
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      // Remove staging journal before directory commit so published folder is clean.
      _deleteFileQuietly(File('${txDir.path}/$stagingJournalFileName'));

      if (_isSessionStaleOrCancelled(generation, token)) {
        _deleteDirectoryQuietly(txDir);
        return _sessionOrCancelledOutcome(
          generation,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      emit(
        RehearsalOperationPhase.committing,
        'Finalizando gravação atômica na biblioteca local',
        bytesProcessed: verifiedActualExtractedBytes,
        totalBytes: verifiedActualExtractedBytes,
      );

      final nowIso = _clock().toIso8601String();
      final pkgId = identity.packageId;
      final existingRecord = existingRecords
          .where((r) => r.packageId == pkgId)
          .firstOrNull;

      final committedRecord = LocalRehearsalPackageRecord(
        packageId: pkgId,
        accountNamespaceHash: accountHash,
        revision: identity.revision,
        title: summary.displayName,
        customLabel: existingRecord?.customLabel,
        format: summary.format,
        formatVersion: summary.formatVersion,
        createdAt: summary.createdAt,
        importedAt: nowIso,
        lastValidatedAt: nowIso,
        integrityState: RehearsalPackageIntegrityState.verified,
        sampleRate: summary.sampleRate,
        channels: summary.channels,
        totalFrames: summary.totalFrames,
        durationSeconds: summary.durationSeconds,
        archiveBytes: archiveBytes,
        extractedBytes: verifiedActualExtractedBytes,
        totalOccupiedBytes: archiveBytes + verifiedActualExtractedBytes,
        manifestSha256: identity.manifestSha256,
        compositeSha256: identity.compositeSha256 ?? '',
        stems: stemsMap,
        original: originalMeta,
        storageLocationLabel:
            LocalRehearsalPackageRecord.defaultStorageLocationLabel,
        relativeDirectory: 'packages/$pkgId',
        bindingState: RehearsalPackageBindingState.unlinked,
        usageRightsDeclaration: crossCheck.rightsDeclaration!,
      );

      final updatedRecords = [
        ...existingRecords.where((r) => r.packageId != pkgId),
        committedRecord,
      ];

      final commitOutcome = await _atomicDirectoryCommit(
        accountDir: accountDir,
        accountHash: accountHash,
        packageId: pkgId,
        txDir: txDir,
        updatedRecords: updatedRecords,
        allowReplace: allowReplacePackageId == pkgId,
      );

      if (!commitOutcome.success) {
        return RehearsalOperationOutcome(
          category: commitOutcome.isEnospc
              ? RehearsalUserOutcomeCategory.insufficientSpace
              : RehearsalUserOutcomeCategory.recoverableFailure,
          title: commitOutcome.isEnospc
              ? 'Espaço esgotado ao finalizar'
              : 'Falha ao confirmar pacote',
          message: commitOutcome.errorMessage!,
          errorCode: commitOutcome.errorCode,
          recoveredOrphanedCount: recoveredOrphanedCount,
        );
      }

      return RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.imported,
        title: allowReplacePackageId != null
            ? 'Pacote substituído com sucesso'
            : 'Pacote importado com sucesso',
        message:
            'O pacote "${committedRecord.displayName}" está pronto para uso offline neste dispositivo.',
        record: committedRecord,
        recoveredOrphanedCount: recoveredOrphanedCount,
      );
    } finally {
      if (byteSource != null) {
        await _closeAndUntrackSource(byteSource);
      }
    }
  }

  Future<_AtomicCommitResult> _atomicDirectoryCommit({
    required Directory accountDir,
    required String accountHash,
    required String packageId,
    required Directory txDir,
    required List<LocalRehearsalPackageRecord> updatedRecords,
    required bool allowReplace,
  }) async {
    final packagesDir = Directory('${accountDir.path}/packages');
    if (!packagesDir.existsSync()) {
      packagesDir.createSync(recursive: true);
    }

    final targetDir = Directory('${packagesDir.path}/$packageId');
    final backupDir = Directory('${packagesDir.path}/$packageId.backup.part');

    if (targetDir.existsSync()) {
      if (!allowReplace) {
        _deleteDirectoryQuietly(txDir);
        return const _AtomicCommitResult.fail(
          errorCode: 'PACKAGE_IDENTITY_CONFLICT',
          errorMessage: 'Já existe um pacote com este identificador.',
        );
      }

      if (backupDir.existsSync()) {
        _deleteDirectoryQuietly(backupDir);
      }

      var movedOldToBackup = false;
      var movedTxToTarget = false;
      try {
        targetDir.renameSync(backupDir.path);
        movedOldToBackup = true;

        txDir.renameSync(targetDir.path);
        movedTxToTarget = true;

        await _writeIndexAtomically(accountDir, accountHash, updatedRecords);
        _deleteDirectoryQuietly(backupDir);
        return const _AtomicCommitResult.ok();
      } catch (err) {
        if (movedTxToTarget && targetDir.existsSync()) {
          _deleteDirectoryQuietly(targetDir);
        }
        if (movedOldToBackup &&
            backupDir.existsSync() &&
            !targetDir.existsSync()) {
          try {
            backupDir.renameSync(targetDir.path);
          } catch (_) {
            // Left for startup recovery if filesystem refuses immediate rename.
          }
        }
        _deleteDirectoryQuietly(txDir);
        return _AtomicCommitResult.fail(
          errorCode: _isEnospc(err) ? 'ENOSPC' : 'COMMIT_FAILED',
          errorMessage:
              'Falha ao atualizar a biblioteca local: $err. A versão anterior foi preservada.',
          isEnospc: _isEnospc(err),
        );
      }
    }

    var movedTxToTarget = false;
    try {
      txDir.renameSync(targetDir.path);
      movedTxToTarget = true;
      await _writeIndexAtomically(accountDir, accountHash, updatedRecords);
      return const _AtomicCommitResult.ok();
    } catch (err) {
      if (movedTxToTarget && targetDir.existsSync()) {
        _deleteDirectoryQuietly(targetDir);
      }
      _deleteDirectoryQuietly(txDir);
      return _AtomicCommitResult.fail(
        errorCode: _isEnospc(err) ? 'ENOSPC' : 'COMMIT_FAILED',
        errorMessage: 'Falha ao registrar pacote na biblioteca local: $err',
        isEnospc: _isEnospc(err),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Disk completeness, streaming SHA-256, and revalidation helpers
  // ---------------------------------------------------------------------------

  LocalRehearsalPackageRecord _reconcileOnDiskCompleteness(
    Directory accountDir,
    LocalRehearsalPackageRecord record,
  ) {
    final pkgDir = _packageDir(accountDir, record.packageId);
    if (!pkgDir.existsSync()) {
      if (record.integrityState == RehearsalPackageIntegrityState.missingFiles) {
        return record;
      }
      return record.copyWith(
        integrityState: RehearsalPackageIntegrityState.missingFiles,
        integrityCode: 'MISSING_LOCAL_DIRECTORY',
        integrityMessage:
            'Diretório local do pacote não foi encontrado no armazenamento interno.',
      );
    }

    final expectedFiles = <(File, int, String)>[
      (
        File('${pkgDir.path}/$stagedArchiveFileName'),
        record.archiveBytes,
        stagedArchiveFileName,
      ),
      for (final stemId in LocalRehearsalPackageRecord.requiredStemOrder)
        if (record.stems[stemId] != null)
          (
            File('${pkgDir.path}/${record.stems[stemId]!.internalFileName}'),
            record.stems[stemId]!.byteLength,
            record.stems[stemId]!.internalFileName,
          ),
      if (record.original != null)
        (
          File('${pkgDir.path}/${record.original!.internalFileName}'),
          record.original!.byteLength,
          record.original!.internalFileName,
        ),
    ];

    final manifestFile = File('${pkgDir.path}/$manifestFileName');
    if (!manifestFile.existsSync()) {
      if (record.integrityState == RehearsalPackageIntegrityState.missingFiles) {
        return record;
      }
      return record.copyWith(
        integrityState: RehearsalPackageIntegrityState.missingFiles,
        integrityCode: 'MISSING_LOCAL_FILES',
        integrityMessage: 'Arquivo manifesto local ($manifestFileName) ausente.',
      );
    }

    for (final (file, expectedBytes, label) in expectedFiles) {
      if (!file.existsSync()) {
        if (record.integrityState ==
            RehearsalPackageIntegrityState.missingFiles) {
          return record;
        }
        return record.copyWith(
          integrityState: RehearsalPackageIntegrityState.missingFiles,
          integrityCode: 'MISSING_LOCAL_FILES',
          integrityMessage: 'Arquivo local ausente: $label.',
        );
      }
      if (file.lengthSync() != expectedBytes) {
        if (record.integrityState == RehearsalPackageIntegrityState.incomplete) {
          return record;
        }
        return record.copyWith(
          integrityState: RehearsalPackageIntegrityState.incomplete,
          integrityCode: 'LOCAL_FILE_SIZE_MISMATCH',
          integrityMessage:
              'Arquivo local incompleto ou truncado: $label.',
        );
      }
    }

    return record;
  }

  Future<_RevalidationOutcome> _performFullDiskRevalidation({
    required Directory accountDir,
    required LocalRehearsalPackageRecord record,
    required RehearsalCancellationToken token,
    void Function(int bytesProcessed, int? totalBytes, [String? detail])?
    onProgress,
  }) async {
    final nowIso = _clock().toIso8601String();
    final completeness = _reconcileOnDiskCompleteness(accountDir, record);
    if (completeness.integrityState ==
            RehearsalPackageIntegrityState.missingFiles ||
        completeness.integrityState ==
            RehearsalPackageIntegrityState.incomplete) {
      return _RevalidationOutcome(
        completeness.copyWith(lastValidatedAt: nowIso),
      );
    }

    final pkgDir = _packageDir(accountDir, record.packageId);
    final totalBytes = record.totalOccupiedBytes;
    var processed = 0;

    final filesToHash = <(File, String, String)>[
      (
        File('${pkgDir.path}/$manifestFileName'),
        record.manifestSha256,
        manifestFileName,
      ),
      for (final stemId in LocalRehearsalPackageRecord.requiredStemOrder)
        if (record.stems[stemId] != null)
          (
            File('${pkgDir.path}/${record.stems[stemId]!.internalFileName}'),
            record.stems[stemId]!.sha256,
            record.stems[stemId]!.internalFileName,
          ),
      if (record.original != null)
        (
          File('${pkgDir.path}/${record.original!.internalFileName}'),
          record.original!.sha256,
          record.original!.internalFileName,
        ),
    ];

    for (final (file, expectedSha, label) in filesToHash) {
      if (token.isCancelled) {
        return _RevalidationOutcome(record);
      }
      final actualSha = await _computeFileSha256Streaming(file, token);
      processed += file.lengthSync();
      onProgress?.call(processed, totalBytes, label);
      if (actualSha != expectedSha) {
        return _RevalidationOutcome(
          record.copyWith(
            lastValidatedAt: nowIso,
            integrityState: RehearsalPackageIntegrityState.corrupted,
            integrityCode: 'LOCAL_SHA256_MISMATCH',
            integrityMessage:
                'Arquivo local "$label" foi alterado ou corrompido (SHA-256 divergente).',
          ),
        );
      }
    }

    final archiveFile = File('${pkgDir.path}/$stagedArchiveFileName');
    final source = FileRehearsalByteSource(archiveFile);
    _openByteSources.add(source);
    try {
      await source.open();
      final validation = await validateRehearsalPackage(
        source,
        options: RehearsalValidationOptions(
          includeSourceCopy: false,
          cancellationToken: token,
          onProgress: (archiveProcessed, _) {
            onProgress?.call(
              math.min(processed + archiveProcessed, totalBytes),
              totalBytes,
              stagedArchiveFileName,
            );
          },
        ),
      );

      if (token.isCancelled) {
        return _RevalidationOutcome(record);
      }

      if (!validation.readyForPublication ||
          validation.packageIdentity?.compositeSha256 !=
              record.compositeSha256) {
        final nextState =
            validation.status == RehearsalValidationStatus.incomplete
                ? RehearsalPackageIntegrityState.incomplete
                : RehearsalPackageIntegrityState.corrupted;
        return _RevalidationOutcome(
          record.copyWith(
            lastValidatedAt: nowIso,
            integrityState: nextState,
            integrityCode:
                validation.errorCode ?? 'ARCHIVE_REVALIDATION_FAILED',
            integrityMessage:
                validation.errorMessage ??
                'Falha ao revalidar o arquivo compactado do pacote.',
          ),
        );
      }

      return _RevalidationOutcome(
        record.copyWith(
          lastValidatedAt: nowIso,
          integrityState: RehearsalPackageIntegrityState.verified,
          clearIntegrityCode: true,
          clearIntegrityMessage: true,
        ),
      );
    } finally {
      await _closeAndUntrackSource(source);
    }
  }

  /// Bounded manifest cross-check gate before any media extraction sink opens.
  Future<_ManifestCrossCheckResult> _crossCheckManifestBeforeExtraction({
    required FileRehearsalByteSource source,
    required RehearsalPackageIdentity identity,
    required RehearsalManifestSummary summary,
    required RehearsalCancellationToken token,
  }) async {
    try {
      final manifestBytes = await _readBoundedManifestBytesFromZip(
        source: source,
        token: token,
      );
      if (manifestBytes == null) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'MISSING_MANIFEST',
          errorMessage: 'manifest.json não localizado na leitura de verificação.',
        );
      }
      if (manifestBytes.length > RehearsalLimitsV1.maxManifestBytes) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'MANIFEST_TOO_LARGE',
          errorMessage: 'manifest.json excede 256 KiB.',
        );
      }

      final manifestSha = IncrementalSha256.computeHex(manifestBytes);
      if (manifestSha != identity.manifestSha256) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'MANIFEST_SHA256_MISMATCH',
          errorMessage: 'Hash do manifesto diverge da validação inicial.',
        );
      }

      final parsed = jsonDecode(utf8.decode(manifestBytes));
      if (parsed is! Map<String, dynamic>) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'INVALID_MANIFEST_JSON',
          errorMessage: 'manifest.json não é um objeto JSON válido.',
        );
      }

      final pkgId = (parsed['packageId'] as String?)?.toLowerCase();
      final revision = parsed['revision'];
      final timeline = parsed['timeline'];
      final rights = parsed['rights'];

      if (pkgId != identity.packageId || revision != identity.revision) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'MANIFEST_IDENTITY_MISMATCH',
          errorMessage: 'Identidade do manifesto diverge da validação inicial.',
        );
      }

      if (timeline is! Map<String, dynamic> ||
          timeline['sampleRate'] != summary.sampleRate ||
          timeline['channels'] != summary.channels ||
          timeline['totalFrames'] != summary.totalFrames) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'TIMELINE_MISMATCH',
          errorMessage: 'Timeline do manifesto diverge da validação inicial.',
        );
      }

      final declaration =
          rights is Map<String, dynamic> ? rights['declaration'] : null;
      if (declaration is! String || declaration.trim().isEmpty) {
        return const _ManifestCrossCheckResult.fail(
          errorCode: 'INVALID_MANIFEST_JSON',
          errorMessage: 'Declaração de direitos de uso ausente no manifesto.',
        );
      }

      return _ManifestCrossCheckResult.ok(declaration.trim());
    } catch (err) {
      return _ManifestCrossCheckResult.fail(
        errorCode: 'INVALID_MANIFEST_JSON',
        errorMessage: 'Falha ao inspecionar manifesto: $err',
      );
    }
  }

  /// Reads `manifest.json` bytes from [source] using bounded <= 64 KiB slices
  /// and strictly enforcing [RehearsalLimitsV1.maxManifestBytes].
  Future<Uint8List?> _readBoundedManifestBytesFromZip({
    required FileRehearsalByteSource source,
    required RehearsalCancellationToken token,
  }) async {
    final totalLen = source.byteLength;
    if (totalLen < 22) return null;

    final tailLen = math.min(totalLen, 65557);
    final tailOffset = totalLen - tailLen;
    final tail = await _readBoundedSpan(source, tailOffset, tailLen, token);

    var eocdPos = -1;
    for (var i = tail.length - 22; i >= 0; i--) {
      if (tail[i] == 0x50 &&
          tail[i + 1] == 0x4B &&
          tail[i + 2] == 0x05 &&
          tail[i + 3] == 0x06) {
        final commentLen = _u16le(tail, i + 20);
        if (i + 22 + commentLen == tail.length) {
          eocdPos = i;
          break;
        }
      }
    }
    if (eocdPos == -1) return null;

    final cdSize = _u32le(tail, eocdPos + 12);
    final cdOffset = _u32le(tail, eocdPos + 16);
    if (cdOffset + cdSize > totalLen || cdSize <= 0 || cdSize > 1024 * 1024) {
      return null;
    }

    final cdBytes = await _readBoundedSpan(source, cdOffset, cdSize, token);
    var pos = 0;
    while (pos + 46 <= cdBytes.length) {
      if (_u32le(cdBytes, pos) != 0x02014B50) return null;
      final method = _u16le(cdBytes, pos + 10);
      final compSize = _u32le(cdBytes, pos + 20);
      final uncompSize = _u32le(cdBytes, pos + 24);
      final nameLen = _u16le(cdBytes, pos + 28);
      final extraLen = _u16le(cdBytes, pos + 30);
      final commentLen = _u16le(cdBytes, pos + 32);
      final lfhOffset = _u32le(cdBytes, pos + 42);
      if (pos + 46 + nameLen + extraLen + commentLen > cdBytes.length) {
        return null;
      }

      final name = utf8.decode(
        Uint8List.sublistView(cdBytes, pos + 46, pos + 46 + nameLen),
        allowMalformed: false,
      );
      pos += 46 + nameLen + extraLen + commentLen;

      if (name != manifestFileName) continue;
      if (uncompSize > RehearsalLimitsV1.maxManifestBytes) return null;

      final lfh = await _readBoundedSpan(source, lfhOffset, 30, token);
      if (_u32le(lfh, 0) != 0x04034B50) return null;
      final lfhNameLen = _u16le(lfh, 26);
      final lfhExtraLen = _u16le(lfh, 28);
      final dataOffset = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
      if (dataOffset + compSize > totalLen) return null;

      if (method == 0) {
        if (compSize > RehearsalLimitsV1.maxManifestBytes) return null;
        return _readBoundedSpan(source, dataOffset, compSize, token);
      }

      if (method == 8) {
        if (compSize > RehearsalLimitsV1.maxManifestBytes) return null;
        final inflater = RawZLibFilter.inflateFilter(raw: true);
        final out = BytesBuilder(copy: false);
        var off = 0;
        while (off < compSize) {
          if (token.isCancelled) return null;
          final take = math.min(4096, compSize - off);
          final chunk = await source.readSlice(dataOffset + off, take);
          inflater.process(chunk, 0, chunk.length);
          while (true) {
            final part = inflater.processed(flush: false);
            if (part == null) break;
            if (out.length + part.length > RehearsalLimitsV1.maxManifestBytes) {
              return null;
            }
            out.add(part);
          }
          off += chunk.length;
        }
        while (true) {
          final part = inflater.processed(flush: true);
          if (part == null) break;
          if (out.length + part.length > RehearsalLimitsV1.maxManifestBytes) {
            return null;
          }
          out.add(part);
        }
        return out.toBytes();
      }
      return null;
    }
    return null;
  }

  Future<Uint8List> _readBoundedSpan(
    FileRehearsalByteSource source,
    int offset,
    int length,
    RehearsalCancellationToken token,
  ) async {
    final builder = BytesBuilder(copy: false);
    var pos = 0;
    while (pos < length) {
      if (token.isCancelled) {
        throw StateError('Cancelled');
      }
      final take = math.min(
        RehearsalLimitsV1.defaultMaxChunkBytes,
        length - pos,
      );
      final slice = await source.readSlice(offset + pos, take);
      if (slice.length != take) {
        throw StateError('Unexpected EOF');
      }
      builder.add(slice);
      pos += slice.length;
    }
    return builder.toBytes();
  }

  Future<String> _computeFileSha256Streaming(
    File file,
    RehearsalCancellationToken token,
  ) async {
    final sha = IncrementalSha256();
    final handle = await file.open(mode: FileMode.read);
    final buffer = Uint8List(RehearsalLimitsV1.defaultMaxChunkBytes);
    try {
      while (true) {
        if (token.isCancelled) {
          return '';
        }
        final bytesRead = await handle.readInto(buffer);
        if (bytesRead <= 0) break;
        sha.update(buffer, 0, bytesRead);
      }
      return sha.digestHex();
    } finally {
      await handle.close();
    }
  }

  Future<void> _copyFileBounded({
    required File source,
    required File target,
    required RehearsalCancellationToken token,
  }) async {
    final inHandle = await source.open(mode: FileMode.read);
    final sink = await _sinkFactory(target);
    final buffer = Uint8List(RehearsalLimitsV1.defaultMaxChunkBytes);
    var sinkClosed = false;
    try {
      while (true) {
        if (token.isCancelled) {
          break;
        }
        final bytesRead = await inHandle.readInto(buffer);
        if (bytesRead <= 0) break;
        sink.add(buffer.sublist(0, bytesRead));
      }
      await sink.flush();
      await sink.close();
      sinkClosed = true;
    } finally {
      if (!sinkClosed) {
        try {
          await sink.close();
        } catch (_) {}
      }
      await inHandle.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Index & directory helpers
  // ---------------------------------------------------------------------------

  List<LocalRehearsalPackageRecord> _readIndexRecords(
    Directory accountDir,
    String expectedAccountHash,
  ) {
    final indexFile = File('${accountDir.path}/$indexFileName');
    if (!indexFile.existsSync()) {
      return <LocalRehearsalPackageRecord>[];
    }

    try {
      final raw = indexFile.readAsStringSync();
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        return <LocalRehearsalPackageRecord>[];
      }
      final fileHash = decoded['accountNamespaceHash'];
      if (fileHash is String && fileHash != expectedAccountHash) {
        return <LocalRehearsalPackageRecord>[];
      }
      final rawPackages = decoded['packages'];
      if (rawPackages is! List<dynamic>) {
        return <LocalRehearsalPackageRecord>[];
      }
      final out = <LocalRehearsalPackageRecord>[];
      for (final item in rawPackages) {
        if (item is Map<String, dynamic>) {
          final record = LocalRehearsalPackageRecord.fromJson(item);
          if (record.accountNamespaceHash == expectedAccountHash &&
              _uuidPattern.hasMatch(record.packageId)) {
            out.add(record);
          }
        }
      }
      return out;
    } catch (_) {
      return <LocalRehearsalPackageRecord>[];
    }
  }

  Future<void> _writeIndexAtomically(
    Directory accountDir,
    String accountHash,
    List<LocalRehearsalPackageRecord> records,
  ) async {
    if (!accountDir.existsSync()) {
      accountDir.createSync(recursive: true);
    }

    final tmpFile = File('${accountDir.path}/$indexTmpFileName');
    final targetFile = File('${accountDir.path}/$indexFileName');

    final payload = jsonEncode({
      'version': 1,
      'accountNamespaceHash': accountHash,
      'updatedAt': _clock().toIso8601String(),
      'packages': records.map((r) => r.toJson()).toList(growable: false),
    });

    final sink = await _sinkFactory(tmpFile);
    var closed = false;
    try {
      sink.write(payload);
      await sink.flush();
      await sink.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await sink.close();
        } catch (_) {}
      }
    }

    if (_debugBeforeIndexCommit != null) {
      await _debugBeforeIndexCommit(tmpFile, targetFile);
    }

    tmpFile.renameSync(targetFile.path);
  }

  Directory _accountDir(String filesDirPath, String accountHash) {
    if (!_sha256Pattern.hasMatch(accountHash)) {
      throw ArgumentError.value(
        accountHash,
        'accountHash',
        'Invalid account namespace hash',
      );
    }
    return Directory(
      '$filesDirPath/rehearsal_packages/accounts/$accountHash',
    );
  }

  Directory _packageDir(Directory accountDir, String packageId) {
    if (!_uuidPattern.hasMatch(packageId)) {
      throw ArgumentError.value(packageId, 'packageId', 'Invalid package UUID');
    }
    return Directory('${accountDir.path}/packages/$packageId');
  }

  Directory _createStagingDir(Directory accountDir, String txId) {
    if (!_txIdPattern.hasMatch(txId)) {
      throw ArgumentError.value(txId, 'txId', 'Invalid transaction ID');
    }
    final dir = Directory('${accountDir.path}/staging/$txId.part');
    dir.createSync(recursive: true);
    return dir;
  }

  void _writeStagingJournal(
    Directory txDir, {
    required String txId,
    required String phase,
    required String accountNamespaceHash,
    String? packageId,
  }) {
    final journalFile = File('${txDir.path}/$stagingJournalFileName');
    journalFile.writeAsStringSync(
      jsonEncode({
        'txId': txId,
        'phase': phase,
        'startedAt': _clock().toIso8601String(),
        'accountNamespaceHash': accountNamespaceHash,
        if (packageId != null) 'packageId': packageId,
      }),
      flush: true,
    );
  }

  String _nextTransactionId() {
    if (_txIdGenerator != null) {
      final candidate = _txIdGenerator().trim();
      if (_txIdPattern.hasMatch(candidate)) {
        return candidate;
      }
    }
    _txCounter++;
    return 'tx_${_clock().microsecondsSinceEpoch}_$_txCounter';
  }

  Set<String> _activePendingTxIdsForAccount(String accountHash) {
    return {
      ..._pendingConflicts.values
          .where(
            (p) =>
                p.accountNamespaceHash == accountHash &&
                p.sessionGeneration == _sessionGeneration,
          )
          .map((p) => p.txId),
      ..._activeStagingTxIds,
    };
  }

  int _computeAccountPackagesBytes(Directory accountDir) {
    final packagesDir = Directory('${accountDir.path}/packages');
    if (!packagesDir.existsSync()) return 0;
    var sum = 0;
    for (final entity in packagesDir.listSync(
      recursive: true,
      followLinks: false,
    )) {
      if (entity is File) {
        try {
          sum += entity.lengthSync();
        } catch (_) {}
      }
    }
    return sum;
  }

  // ---------------------------------------------------------------------------
  // Error mapping & cleanup helpers
  // ---------------------------------------------------------------------------

  bool _isSessionStaleOrCancelled(
    int capturedGeneration,
    RehearsalCancellationToken token,
  ) =>
      capturedGeneration != _sessionGeneration || token.isCancelled;

  RehearsalOperationOutcome _sessionOrCancelledOutcome(
    int capturedGeneration, {
    int recoveredOrphanedCount = 0,
  }) {
    final sessionChanged = capturedGeneration != _sessionGeneration;
    return RehearsalOperationOutcome(
      category: RehearsalUserOutcomeCategory.cancelled,
      title: sessionChanged ? 'Sessão encerrada' : 'Operação cancelada',
      message: sessionChanged
          ? 'A sessão da conta foi alterada; a operação em andamento foi descartada com segurança.'
          : 'A operação foi cancelada antes da conclusão.',
      errorCode: sessionChanged ? 'SESSION_INVALIDATED' : 'OPERATION_CANCELLED',
      recoveredOrphanedCount: recoveredOrphanedCount,
    );
  }

  RehearsalOperationOutcome _mapSafStageError(
    SafStageResult result, {
    int recoveredOrphanedCount = 0,
  }) {
    final code = result.code ?? 'SAF_STAGE_FAILED';
    return switch (code) {
      'PACKAGE_TOO_LARGE' => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.incompatible,
        title: 'Pacote excede o limite de 2 GiB',
        message:
            result.message ??
            'O arquivo selecionado excede o limite máximo suportado de 2 GiB.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
      'EMPTY_OR_CORRUPTED' => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.corrupted,
        title: 'Arquivo vazio ou corrompido',
        message:
            result.message ??
            'O arquivo selecionado está vazio ou não pôde ser lido.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
      'INSUFFICIENT_STORAGE' => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.insufficientSpace,
        title: 'Espaço insuficiente no dispositivo',
        message:
            result.message ??
            'Não há espaço livre suficiente com a reserva mínima obrigatória.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
      'PERMISSION_DENIED' => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Permissão negada ou revogada',
        message:
            result.message ??
            'O provedor de documentos negou ou revogou o acesso ao arquivo. Selecione-o novamente.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
      'SOURCE_UNAVAILABLE' => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Arquivo indisponível',
        message:
            result.message ??
            'O arquivo selecionado foi movido, removido ou não está mais acessível.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
      'READ_INTERRUPTED' => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Leitura interrompida',
        message:
            result.message ??
            'A leitura do arquivo foi interrompida antes de finalizar. Tente novamente.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
      _ => RehearsalOperationOutcome(
        category: RehearsalUserOutcomeCategory.recoverableFailure,
        title: 'Não foi possível copiar o pacote',
        message:
            result.message ?? 'Falha ao acessar o arquivo via seletor nativo.',
        errorCode: code,
        recoveredOrphanedCount: recoveredOrphanedCount,
      ),
    };
  }

  RehearsalOperationOutcome _mapValidationFailure(
    RehearsalValidationResult validation, {
    int recoveredOrphanedCount = 0,
  }) {
    final code = validation.errorCode;
    final category = switch (validation.status) {
      RehearsalValidationStatus.cancelled =>
        RehearsalUserOutcomeCategory.cancelled,
      RehearsalValidationStatus.insufficientSpace =>
        RehearsalUserOutcomeCategory.insufficientSpace,
      RehearsalValidationStatus.unsupported =>
        RehearsalUserOutcomeCategory.incompatible,
      RehearsalValidationStatus.conflict =>
        RehearsalUserOutcomeCategory.conflict,
      RehearsalValidationStatus.corrupted ||
      RehearsalValidationStatus.incomplete =>
        (code != null && code.startsWith('UNSUPPORTED_'))
            ? RehearsalUserOutcomeCategory.incompatible
            : RehearsalUserOutcomeCategory.corrupted,
      RehearsalValidationStatus.valid =>
        RehearsalUserOutcomeCategory.recoverableFailure,
    };

    final title = switch (category) {
      RehearsalUserOutcomeCategory.cancelled => 'Importação cancelada',
      RehearsalUserOutcomeCategory.insufficientSpace =>
        'Espaço insuficiente para extração',
      RehearsalUserOutcomeCategory.incompatible => 'Pacote incompatível',
      RehearsalUserOutcomeCategory.corrupted => 'Pacote corrompido ou inválido',
      _ => 'Falha na validação',
    };

    return RehearsalOperationOutcome(
      category: category,
      title: title,
      message:
          validation.errorMessage ??
          'O pacote não atende ao contrato técnico de ensaio local.',
      errorCode: code,
      recoveredOrphanedCount: recoveredOrphanedCount,
    );
  }

  Future<void> _closeAndUntrackSource(FileRehearsalByteSource source) async {
    _openByteSources.remove(source);
    try {
      await source.close();
    } catch (_) {}
  }

  Future<void> _closeSinksQuietly(List<IOSink> sinks) async {
    for (final sink in sinks) {
      try {
        await sink.close();
      } catch (_) {}
    }
  }

  void _deleteDirectoryQuietly(Directory dir) {
    try {
      if (dir.existsSync()) {
        dir.deleteSync(recursive: true);
      }
    } catch (_) {}
  }

  void _deleteFileQuietly(File file) {
    try {
      if (file.existsSync()) {
        file.deleteSync();
      }
    } catch (_) {}
  }

  bool _isEnospc(Object error) {
    if (error is FileSystemException) {
      if (error.osError?.errorCode == 28) return true;
      final msg = '${error.message} ${error.osError?.message ?? ''}'.toLowerCase();
      if (msg.contains('no space left') || msg.contains('enospc')) {
        return true;
      }
    }
    final text = error.toString().toLowerCase();
    return text.contains('no space left') || text.contains('enospc');
  }

  static String _baseName(String fullPath) {
    final normalized = fullPath.replaceAll('\\', '/');
    final idx = normalized.lastIndexOf('/');
    return idx == -1 ? normalized : normalized.substring(idx + 1);
  }

  static int _u16le(Uint8List b, int o) => b[o] | (b[o + 1] << 8);

  static int _u32le(Uint8List b, int o) =>
      b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
}

final class _PendingConflictEntry {
  const _PendingConflictEntry({
    required this.txId,
    required this.userId,
    required this.accountNamespaceHash,
    required this.sessionGeneration,
    required this.packageId,
    required this.stagedZipFile,
    required this.txDir,
  });

  final String txId;
  final String userId;
  final String accountNamespaceHash;
  final int sessionGeneration;
  final String packageId;
  final File stagedZipFile;
  final Directory txDir;
}

final class _ManifestCrossCheckResult {
  const _ManifestCrossCheckResult.ok(this.rightsDeclaration)
    : isValid = true,
      errorCode = null,
      errorMessage = null;

  const _ManifestCrossCheckResult.fail({
    required this.errorCode,
    required this.errorMessage,
  }) : isValid = false,
       rightsDeclaration = null;

  final bool isValid;
  final String? rightsDeclaration;
  final String? errorCode;
  final String? errorMessage;
}

final class _RevalidationOutcome {
  const _RevalidationOutcome(this.updatedRecord);
  final LocalRehearsalPackageRecord updatedRecord;
}

final class _AtomicCommitResult {
  const _AtomicCommitResult.ok()
    : success = true,
      errorCode = null,
      errorMessage = null,
      isEnospc = false;

  const _AtomicCommitResult.fail({
    required this.errorCode,
    required this.errorMessage,
    this.isEnospc = false,
  }) : success = false;

  final bool success;
  final String? errorCode;
  final String? errorMessage;
  final bool isEnospc;
}
