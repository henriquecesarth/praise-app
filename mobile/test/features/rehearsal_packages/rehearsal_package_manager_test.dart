import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_manager.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/domain/rehearsal_package_models.dart';

import '../../support/rehearsal_package_corpus.dart';

final class FakeRehearsalPackageSafPort implements RehearsalPackageSafPort {
  FakeRehearsalPackageSafPort({
    required this.filesDirPath,
    this.availableBytes = 1024 * 1024 * 1024, // 1 GiB
    this.totalBytes = 8 * 1024 * 1024 * 1024, // 8 GiB
  });

  final String filesDirPath;
  int availableBytes;
  int totalBytes;

  final StreamController<SafProgressEvent> _progressController =
      StreamController<SafProgressEvent>.broadcast();

  Uint8List? nextPickArchiveBytes;
  SafStageResult? overridePickResult;
  SafExportResult? overrideExportResult;
  Future<void> Function(String operationId)? onPickStarted;
  Future<void> Function(String sourceFilePath, String suggestedFileName)?
  onExportSuccess;

  int pickCalls = 0;
  int exportCalls = 0;
  int cancelCalls = 0;
  String? lastExportedSourcePath;
  String? lastSuggestedFileName;
  Uint8List? lastExportedBytes;

  @override
  Stream<SafProgressEvent> get progressStream => _progressController.stream;

  void emitProgress(SafProgressEvent event) {
    if (!_progressController.isClosed) {
      _progressController.add(event);
    }
  }

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    return SafStorageInfo(
      filesDirPath: filesDirPath,
      availableBytes: availableBytes,
      totalBytes: totalBytes,
    );
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) async {
    pickCalls++;
    await onPickStarted?.call(operationId);

    if (overridePickResult != null) {
      return overridePickResult!;
    }

    final bytes = nextPickArchiveBytes;
    if (bytes == null) {
      return const SafStageResult(status: SafStageStatus.cancelled);
    }

    if (availableBytes < requiredReserveBytes) {
      return const SafStageResult(
        status: SafStageStatus.error,
        code: 'INSUFFICIENT_STORAGE',
        message: 'Espaço livre insuficiente para iniciar importação segura.',
      );
    }

    if (bytes.length > maxBytes) {
      return const SafStageResult(
        status: SafStageStatus.error,
        code: 'PACKAGE_TOO_LARGE',
        message: 'Fluxo excedeu o limite máximo de 2 GiB.',
      );
    }

    final targetFile = File(targetStageFilePath);
    targetFile.parent.createSync(recursive: true);

    const chunkSize = 16384;
    final raf = targetFile.openSync(mode: FileMode.write);
    var offset = 0;
    try {
      while (offset < bytes.length) {
        final end = (offset + chunkSize).clamp(0, bytes.length);
        raf.writeFromSync(bytes, offset, end);
        offset = end;
        emitProgress(
          SafProgressEvent(
            operationId: operationId,
            phase: 'staging_copy',
            bytesProcessed: offset,
            totalBytes: bytes.length,
          ),
        );
      }
      raf.flushSync();
    } finally {
      raf.closeSync();
    }

    return SafStageResult(
      status: SafStageStatus.staged,
      stagedFilePath: targetFile.path,
      bytesCopied: bytes.length,
      untrustedDisplayName: 'pacote-externo.louvaio-rehearsal.zip',
      untrustedDeclaredSize: bytes.length,
      availableBytesAfter: availableBytes - bytes.length,
    );
  }

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) async {
    exportCalls++;
    lastExportedSourcePath = sourceFilePath;
    lastSuggestedFileName = suggestedFileName;

    if (overrideExportResult != null) {
      return overrideExportResult!;
    }

    final sourceFile = File(sourceFilePath);
    if (!sourceFile.existsSync()) {
      return const SafExportResult(
        status: SafExportStatus.error,
        code: 'SOURCE_NOT_FOUND',
        message: 'Arquivo fonte não encontrado.',
      );
    }

    final bytes = sourceFile.readAsBytesSync();
    lastExportedBytes = bytes;
    emitProgress(
      SafProgressEvent(
        operationId: operationId,
        phase: 'exporting',
        bytesProcessed: bytes.length,
        totalBytes: bytes.length,
      ),
    );
    await onExportSuccess?.call(sourceFilePath, suggestedFileName);
    return SafExportResult(
      status: SafExportStatus.exported,
      bytesWritten: bytes.length,
    );
  }

  @override
  Future<bool> cancelOperation({String? operationId}) async {
    cancelCalls++;
    return true;
  }

  Future<void> dispose() async {
    await _progressController.close();
  }
}

/// Custom [IOSink] wrapper that throws [FileSystemException] (`ENOSPC`) once
/// cumulative writes hit [failAfterBytes], while closing the real delegate
/// cleanly to prevent open handle leaks on Windows/POSIX.
final class _EnospcInjectingSink implements IOSink {
  _EnospcInjectingSink(this._delegate, {required this.failAfterBytes});

  final IOSink _delegate;
  final int failAfterBytes;
  int _written = 0;

  @override
  Encoding get encoding => _delegate.encoding;

  @override
  set encoding(Encoding value) => _delegate.encoding = value;

  @override
  void add(List<int> data) {
    _written += data.length;
    if (_written > failAfterBytes) {
      throw const FileSystemException(
        'No space left on device',
        'simulated',
        OSError('No space left on device', 28),
      );
    }
    _delegate.add(data);
  }

  @override
  void addError(Object error, [StackTrace? stackTrace]) =>
      _delegate.addError(error, stackTrace);

  @override
  Future<dynamic> addStream(Stream<List<int>> stream) async {
    await for (final chunk in stream) {
      add(chunk);
    }
  }

  @override
  Future<dynamic> close() => _delegate.close();

  @override
  Future<dynamic> get done => _delegate.done;

  @override
  Future<dynamic> flush() => _delegate.flush();

  @override
  void write(Object? object) => add(utf8.encode('$object'));

  @override
  void writeAll(Iterable<dynamic> objects, [String separator = '']) {
    write(objects.join(separator));
  }

  @override
  void writeCharCode(int charCode) => add([charCode]);

  @override
  void writeln([Object? object = '']) => write('$object\n');
}

Uint8List _buildValidPackageZip({
  String packageId = '11111111-1111-4111-8111-111111111111',
  int revision = 1,
  String displayName = 'Santo Pra Sempre - Ensaio',
  int seedOffset = 0,
  bool includeOriginal = false,
  Map<String, String>? customStemPaths,
  String? customOriginalPath,
  bool useFlac = false,
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

  final stemIds = ['vocals', 'drums', 'bass', 'other'];
  for (var i = 0; i < stemIds.length; i++) {
    final stemId = stemIds[i];
    final path = customStemPaths?[stemId] ??
        (useFlac ? 'stems/$stemId.flac' : 'stems/$stemId.wav');
    final bytes = useFlac
        ? buildSyntheticFlac(seed: 10 + seedOffset + i, totalSamples: 4410)
        : buildSyntheticWavPcm16(seed: 10 + seedOffset + i, frames: 4410);
    stems.add({
      'id': stemId,
      'path': path,
      'container': useFlac ? 'flac' : 'wav',
      'codec': useFlac ? 'flac' : 'pcm_s16le',
      'bitsPerSample': useFlac ? 24 : 16,
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
    final origPath = customOriginalPath ?? 'audio/original.wav';
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

  final manifestBytes = Uint8List.fromList(utf8.encode(jsonEncode(baseManifest)));
  return buildSyntheticZip([
    SyntheticZipEntry(path: 'manifest.json', uncompressedData: manifestBytes),
    ...entries,
  ]);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;
  late FakeRehearsalPackageSafPort safPort;
  late RehearsalPackageManager manager;
  late DateTime currentClock;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('louvaio_rehearsal_mgr_');
    safPort = FakeRehearsalPackageSafPort(filesDirPath: tempDir.path);
    currentClock = DateTime.utc(2026, 11, 17, 15, 0, 0);
    manager = RehearsalPackageManager(
      safPort: safPort,
      clock: () {
        currentClock = currentClock.add(const Duration(seconds: 1));
        return currentClock;
      },
    );
  });

  tearDown(() async {
    await safPort.dispose();
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  group('SAF import, validation, extraction, and metadata isolation', () {
    test('happy path imports package via SAF with optional original and zero audio bytes in index.json', () async {
      final zipBytes = _buildValidPackageZip(
        includeOriginal: true,
        displayName: 'Digno é o Senhor',
      );
      safPort.nextPickArchiveBytes = zipBytes;
      final phases = <RehearsalOperationPhase>[];

      final outcome = await manager.importFromSaf(
        userId: 'user-worship-leader',
        onProgress: (p) => phases.add(p.phase),
      );

      expect(outcome.category, RehearsalUserOutcomeCategory.imported);
      expect(outcome.record, isNotNull);
      final record = outcome.record!;
      expect(record.packageId, '11111111-1111-4111-8111-111111111111');
      expect(record.displayName, 'Digno é o Senhor');
      expect(record.integrityState, RehearsalPackageIntegrityState.verified);
      expect(record.isReadyForLocalUse, isTrue);
      expect(record.bindingState, RehearsalPackageBindingState.unlinked);
      expect(
        record.storageLocationLabel,
        'Armazenamento interno privado do app',
      );
      expect(
        record.stems.keys.toList(),
        ['vocals', 'drums', 'bass', 'other'],
      );
      expect(record.original, isNotNull);
      expect(record.original!.internalFileName, 'original.wav');
      expect(record.usageRightsDeclaration, isNotEmpty);

      expect(phases, contains(RehearsalOperationPhase.picking));
      expect(phases, contains(RehearsalOperationPhase.stagingCopy));
      expect(phases, contains(RehearsalOperationPhase.validating));
      expect(phases, contains(RehearsalOperationPhase.extracting));
      expect(phases, contains(RehearsalOperationPhase.committing));

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-worship-leader',
      );
      final accountDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash',
      );
      final indexFile = File('${accountDir.path}/index.json');
      expect(indexFile.existsSync(), isTrue);

      final indexText = indexFile.readAsStringSync();
      expect(indexText.contains('RIFF'), isFalse);
      expect(indexText.contains('WAVE'), isFalse);
      expect(indexText.contains('fLaC'), isFalse);
      expect(indexText.contains('OggS'), isFalse);
      // Verify index stays compact metadata only (well under single WAV size).
      expect(indexFile.lengthSync(), lessThan(4096));

      // Verify staging is completely cleaned up after commit.
      final stagingDir = Directory('${accountDir.path}/staging');
      expect(
        stagingDir.existsSync() ? stagingDir.listSync().isEmpty : true,
        isTrue,
      );
    });

    test('path isolation never writes ZIP entry paths to packages/<id>/', () async {
      final zipBytes = _buildValidPackageZip(
        includeOriginal: true,
        customStemPaths: const {
          'vocals': 'midia/faixas/voz_canção_1.wav',
          'drums': 'midia/faixas/bateria_principal.wav',
          'bass': 'midia/faixas/baixo_elétrico.wav',
          'other': 'midia/faixas/outros_teclados.wav',
        },
        customOriginalPath: 'originais/sub/guia_principal.wav',
      );
      safPort.nextPickArchiveBytes = zipBytes;

      final outcome = await manager.importFromSaf(userId: 'user-path');
      expect(outcome.category, RehearsalUserOutcomeCategory.imported);

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-path',
      );
      final pkgDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/packages/11111111-1111-4111-8111-111111111111',
      );
      final names = pkgDir
          .listSync(recursive: true)
          .map((e) => e.uri.pathSegments.lastWhere((s) => s.isNotEmpty))
          .toSet();

      expect(
        names,
        equals({
          'manifest.json',
          'stem_vocals.wav',
          'stem_drums.wav',
          'stem_bass.wav',
          'stem_other.wav',
          'original.wav',
          'package.louvaio-rehearsal.zip',
        }),
      );
      expect(names.any((n) => n.contains('midia')), isFalse);
      expect(names.any((n) => n.contains('canção')), isFalse);
      expect(names.any((n) => n.contains('guia_principal')), isFalse);
    });

    test('user cancelling SAF picker cleans staging and returns cancelled', () async {
      safPort.overridePickResult = const SafStageResult(
        status: SafStageStatus.cancelled,
      );

      final outcome = await manager.importFromSaf(userId: 'user-cancel');
      expect(outcome.category, RehearsalUserOutcomeCategory.cancelled);

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-cancel',
      );
      final stagingDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/staging',
      );
      expect(stagingDir.listSync(), isEmpty);
    });

    test('maps SAF errors (SOURCE_UNAVAILABLE, PERMISSION_DENIED, PACKAGE_TOO_LARGE, READ_INTERRUPTED)', () async {
      final cases = <(String, RehearsalUserOutcomeCategory)>[
        ('SOURCE_UNAVAILABLE', RehearsalUserOutcomeCategory.recoverableFailure),
        ('PERMISSION_DENIED', RehearsalUserOutcomeCategory.recoverableFailure),
        ('READ_INTERRUPTED', RehearsalUserOutcomeCategory.recoverableFailure),
        ('PACKAGE_TOO_LARGE', RehearsalUserOutcomeCategory.incompatible),
        ('INSUFFICIENT_STORAGE', RehearsalUserOutcomeCategory.insufficientSpace),
        ('EMPTY_OR_CORRUPTED', RehearsalUserOutcomeCategory.corrupted),
      ];

      for (final (code, expectedCategory) in cases) {
        safPort.overridePickResult = SafStageResult(
          status: SafStageStatus.error,
          code: code,
          message: 'Erro simulado: $code',
        );

        final outcome = await manager.importFromSaf(userId: 'user-saf-err');
        expect(outcome.category, expectedCategory, reason: 'code=$code');
        expect(outcome.errorCode, code);
      }
    });

    test('enforces low free storage threshold (256 MiB reserve and 10% peak)', () async {
      // Pre-SAF: below 256 MiB fails before opening SAF picker.
      safPort.availableBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes - 1;
      safPort.nextPickArchiveBytes = _buildValidPackageZip();

      final preOutcome = await manager.importFromSaf(userId: 'user-space');
      expect(preOutcome.category, RehearsalUserOutcomeCategory.insufficientSpace);
      expect(safPort.pickCalls, 0);

      // Post-SAF: just enough for 256 MiB reserve, NOT enough for extracted + reserve.
      final zipBytes = _buildValidPackageZip();
      safPort.availableBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes + 1024;
      safPort.nextPickArchiveBytes = zipBytes;

      final postOutcome = await manager.importFromSaf(userId: 'user-space');
      expect(postOutcome.category, RehearsalUserOutcomeCategory.insufficientSpace);
      expect(safPort.pickCalls, 1);

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-space',
      );
      final stagingDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/staging',
      );
      expect(stagingDir.listSync(), isEmpty);
    });

    test('simulated ENOSPC mid-extraction cleans staging immediately and preserves existing library', () async {
      // First import a valid package A.
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: '11111111-1111-4111-8111-111111111111',
        displayName: 'Pacote Existente',
      );
      final firstOutcome = await manager.importFromSaf(userId: 'user-enospc');
      expect(firstOutcome.category, RehearsalUserOutcomeCategory.imported);

      // Now simulate ENOSPC during extraction of package B.
      final enospcManager = RehearsalPackageManager(
        safPort: safPort,
        sinkFactory: (targetFile) async {
          final realSink = targetFile.openWrite();
          if (targetFile.path.endsWith('stem_drums.wav')) {
            return _EnospcInjectingSink(realSink, failAfterBytes: 128);
          }
          return realSink;
        },
      );

      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: '22222222-2222-4222-8222-222222222222',
        displayName: 'Pacote Novo Sem Espaço',
        seedOffset: 20,
      );
      final failOutcome = await enospcManager.importFromSaf(
        userId: 'user-enospc',
      );
      expect(failOutcome.category, RehearsalUserOutcomeCategory.insufficientSpace);
      expect(failOutcome.errorCode, 'ENOSPC');

      final snapshot = await manager.loadLibrary(userId: 'user-enospc');
      expect(snapshot.packages.length, 1);
      expect(
        snapshot.packages.single.packageId,
        '11111111-1111-4111-8111-111111111111',
      );
      expect(
        snapshot.packages.single.integrityState,
        RehearsalPackageIntegrityState.verified,
      );

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-enospc',
      );
      final stagingDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/staging',
      );
      expect(stagingDir.listSync(), isEmpty);
    });

    test('rejects adversarial INFO-1 and INFO-2 packages before opening any extraction sink', () async {
      var extractionSinkOpens = 0;
      final guardedManager = RehearsalPackageManager(
        safPort: safPort,
        sinkFactory: (targetFile) async {
          if (!targetFile.path.endsWith('index.json.tmp') &&
              !targetFile.path.endsWith('package.louvaio-rehearsal.zip')) {
            extractionSinkOpens++;
          }
          return targetFile.openWrite();
        },
      );

      final wav = buildSyntheticWavPcm16(seed: 1);
      final baseManifest = Map<String, dynamic>.from(
        loadReferenceManifest('valid-wav-minimal.manifest.json'),
      );
      baseManifest['stems'] = ['vocals', 'drums', 'bass', 'other']
          .map(
            (id) => {
              'id': id,
              'path': 'stems/$id.wav',
              'container': 'wav',
              'codec': 'pcm_s16le',
              'bitsPerSample': 16,
              'byteLength': wav.length,
              'sha256': IncrementalSha256.computeHex(wav),
              'sampleRate': 44100,
              'channels': 2,
              'decodedFrames': 4410,
            },
          )
          .toList();

      // INFO-1: malformed alignment.perStem
      final info1Manifest = Map<String, dynamic>.from(baseManifest);
      info1Manifest['alignment'] = {
        ...Map<String, dynamic>.from(baseManifest['alignment'] as Map),
        'perStem': {'vocals': 'invalid'},
      };
      safPort.nextPickArchiveBytes = buildSyntheticZip([
        SyntheticZipEntry(
          path: 'manifest.json',
          uncompressedData: Uint8List.fromList(
            utf8.encode(jsonEncode(info1Manifest)),
          ),
        ),
        ...['vocals', 'drums', 'bass', 'other'].map(
          (id) => SyntheticZipEntry(path: 'stems/$id.wav', uncompressedData: wav),
        ),
      ]);

      final resInfo1 = await guardedManager.importFromSaf(userId: 'user-adv');
      expect(resInfo1.category, RehearsalUserOutcomeCategory.corrupted);
      expect(resInfo1.errorCode, 'INVALID_MANIFEST_JSON');
      expect(extractionSinkOpens, 0);

      // INFO-2: Unicode canonical collision (Cyrillic й vs и+breve)
      final info2Manifest = Map<String, dynamic>.from(baseManifest);
      final stems = (baseManifest['stems'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      stems[0]['path'] = 'stems/\u0439.wav';
      stems[1]['path'] = 'stems/\u0438\u0306.wav';
      info2Manifest['stems'] = stems;

      safPort.nextPickArchiveBytes = buildSyntheticZip([
        SyntheticZipEntry(
          path: 'manifest.json',
          uncompressedData: Uint8List.fromList(
            utf8.encode(jsonEncode(info2Manifest)),
          ),
        ),
        SyntheticZipEntry(path: 'stems/\u0439.wav', uncompressedData: wav),
        SyntheticZipEntry(path: 'stems/\u0438\u0306.wav', uncompressedData: wav),
        SyntheticZipEntry(path: 'stems/bass.wav', uncompressedData: wav),
        SyntheticZipEntry(path: 'stems/other.wav', uncompressedData: wav),
      ]);

      final resInfo2 = await guardedManager.importFromSaf(userId: 'user-adv');
      expect(resInfo2.category, RehearsalUserOutcomeCategory.corrupted);
      expect(resInfo2.errorCode, 'DUPLICATE_OR_COLLIDING_ENTRY');
      expect(extractionSinkOpens, 0);
    });

    test('cancellation mid-extraction aborts cleanly and removes staging', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip();
      final cancellingManager = RehearsalPackageManager(
        safPort: safPort,
        sinkFactory: (targetFile) async {
          if (targetFile.path.endsWith('stem_drums.wav')) {
            // Trigger cooperative cancellation right as drums extraction begins.
            unawaited(manager.cancelActiveOperation());
          }
          return targetFile.openWrite();
        },
      );

      // Use a manager-bound callback so cancellation targets the active manager.
      late RehearsalPackageManager activeMgr;
      activeMgr = RehearsalPackageManager(
        safPort: safPort,
        sinkFactory: (targetFile) async {
          if (targetFile.path.endsWith('stem_drums.wav')) {
            await activeMgr.cancelActiveOperation();
          }
          return targetFile.openWrite();
        },
      );
      // Dispose unused instance reference cleanly.
      expect(cancellingManager, isNotNull);

      final outcome = await activeMgr.importFromSaf(userId: 'user-cancel-mid');
      expect(outcome.category, RehearsalUserOutcomeCategory.cancelled);

      final snapshot = await activeMgr.loadLibrary(userId: 'user-cancel-mid');
      expect(snapshot.packages, isEmpty);

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-cancel-mid',
      );
      final stagingDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/staging',
      );
      expect(stagingDir.listSync(), isEmpty);
    });
  });

  group('Idempotency, conflict replacement, and atomic rollback', () {
    test('re-importing identical package returns idempotentNoop and cleans staging', () async {
      final zipBytes = _buildValidPackageZip();
      safPort.nextPickArchiveBytes = zipBytes;
      final first = await manager.importFromSaf(userId: 'user-idem');
      expect(first.category, RehearsalUserOutcomeCategory.imported);

      safPort.nextPickArchiveBytes = zipBytes;
      final second = await manager.importFromSaf(userId: 'user-idem');
      expect(second.category, RehearsalUserOutcomeCategory.idempotentNoop);
      expect(second.record?.packageId, first.record?.packageId);

      final snapshot = await manager.loadLibrary(userId: 'user-idem');
      expect(snapshot.packages.length, 1);
    });

    test('conflict detection supports discardPendingConflict and atomic confirmConflictReplace', () async {
      final v1 = _buildValidPackageZip(
        revision: 1,
        displayName: 'Ensaio Rev 1',
        seedOffset: 0,
      );
      safPort.nextPickArchiveBytes = v1;
      final first = await manager.importFromSaf(userId: 'user-conflict');
      expect(first.category, RehearsalUserOutcomeCategory.imported);

      final v2 = _buildValidPackageZip(
        revision: 2,
        displayName: 'Ensaio Rev 2',
        seedOffset: 50,
      );
      safPort.nextPickArchiveBytes = v2;
      final conflict = await manager.importFromSaf(userId: 'user-conflict');
      expect(conflict.category, RehearsalUserOutcomeCategory.conflict);
      expect(conflict.conflict, isNotNull);
      expect(conflict.conflict!.incomingRevision, 2);
      expect(conflict.conflict!.existingRecord.revision, 1);

      // Discard removes pending staging and keeps v1 intact.
      await manager.discardPendingConflict(
        userId: 'user-conflict',
        pendingTransactionId: conflict.conflict!.pendingTransactionId,
      );
      var snapshot = await manager.loadLibrary(userId: 'user-conflict');
      expect(snapshot.packages.single.revision, 1);

      // Import v2 again and confirm replacement.
      safPort.nextPickArchiveBytes = v2;
      final conflict2 = await manager.importFromSaf(userId: 'user-conflict');
      expect(conflict2.category, RehearsalUserOutcomeCategory.conflict);

      final replaced = await manager.confirmConflictReplace(
        userId: 'user-conflict',
        pendingTransactionId: conflict2.conflict!.pendingTransactionId,
      );
      expect(replaced.category, RehearsalUserOutcomeCategory.imported);
      expect(replaced.record?.revision, 2);
      expect(replaced.record?.displayName, 'Ensaio Rev 2');

      snapshot = await manager.loadLibrary(userId: 'user-conflict');
      expect(snapshot.packages.length, 1);
      expect(snapshot.packages.single.revision, 2);

      // Ensure .backup.part was deleted after atomic commit.
      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-conflict',
      );
      final packagesDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/packages',
      );
      expect(
        packagesDir.listSync().any((e) => e.path.endsWith('.backup.part')),
        isFalse,
      );
    });

    test('simulated swap/index failure during confirmConflictReplace restores .backup.part', () async {
      final v1 = _buildValidPackageZip(
        revision: 1,
        displayName: 'Versão Segura v1',
        seedOffset: 1,
      );
      safPort.nextPickArchiveBytes = v1;
      final first = await manager.importFromSaf(userId: 'user-swap-fail');
      expect(first.category, RehearsalUserOutcomeCategory.imported);

      var failNextIndexCommit = false;
      final faultManager = RehearsalPackageManager(
        safPort: safPort,
        debugBeforeIndexCommit: (tmpFile, targetFile) async {
          if (failNextIndexCommit) {
            throw const FileSystemException('Simulated crash before index rename');
          }
        },
      );

      final v2 = _buildValidPackageZip(
        revision: 2,
        displayName: 'Versão Que Falha v2',
        seedOffset: 90,
      );
      safPort.nextPickArchiveBytes = v2;
      final conflict = await faultManager.importFromSaf(
        userId: 'user-swap-fail',
      );
      expect(conflict.category, RehearsalUserOutcomeCategory.conflict);

      failNextIndexCommit = true;
      final replaceOutcome = await faultManager.confirmConflictReplace(
        userId: 'user-swap-fail',
        pendingTransactionId: conflict.conflict!.pendingTransactionId,
      );
      expect(
        replaceOutcome.category,
        RehearsalUserOutcomeCategory.recoverableFailure,
      );

      failNextIndexCommit = false;
      final after = await faultManager.loadLibrary(userId: 'user-swap-fail');
      expect(after.packages.length, 1);
      expect(after.packages.single.revision, 1);
      expect(after.packages.single.displayName, 'Versão Segura v1');

      final reval = await faultManager.revalidatePackage(
        userId: 'user-swap-fail',
        packageId: after.packages.single.packageId,
      );
      expect(reval.category, RehearsalUserOutcomeCategory.revalidated);
      expect(
        reval.record?.integrityState,
        RehearsalPackageIntegrityState.verified,
      );
    });

    test('OS crash before index.json commit (v2 in packages/<id>, v1 in .backup.part, v1 in index.json) restores v1 backup on loadLibrary', () async {
      final v1 = _buildValidPackageZip(
        revision: 1,
        displayName: 'Versão Crash Pré-Index v1',
        seedOffset: 1,
      );
      safPort.nextPickArchiveBytes = v1;
      final first = await manager.importFromSaf(userId: 'user-crash-pre-idx');
      expect(first.category, RehearsalUserOutcomeCategory.imported);
      final v1Record = first.record!;

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-crash-pre-idx',
      );
      final accountDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash',
      );
      final pkgDir = Directory('${accountDir.path}/packages/${v1Record.packageId}');
      final backupDir = Directory(
        '${accountDir.path}/packages/${v1Record.packageId}.backup.part',
      );
      final v2SnapshotDir = Directory('${tempDir.path}/v2_snapshot');

      var captureAndAbort = false;
      final faultManager = RehearsalPackageManager(
        safPort: safPort,
        debugBeforeIndexCommit: (tmpFile, targetFile) async {
          if (captureAndAbort) {
            _copyDirectorySync(pkgDir, v2SnapshotDir);
            throw const FileSystemException('Simulated OS crash before index rename');
          }
        },
      );

      final v2 = _buildValidPackageZip(
        revision: 2,
        displayName: 'Versão Crash Pré-Index v2',
        seedOffset: 90,
      );
      safPort.nextPickArchiveBytes = v2;
      final conflict = await faultManager.importFromSaf(
        userId: 'user-crash-pre-idx',
      );
      expect(conflict.category, RehearsalUserOutcomeCategory.conflict);

      captureAndAbort = true;
      final replaceOutcome = await faultManager.confirmConflictReplace(
        userId: 'user-crash-pre-idx',
        pendingTransactionId: conflict.conflict!.pendingTransactionId,
      );
      expect(
        replaceOutcome.category,
        RehearsalUserOutcomeCategory.recoverableFailure,
      );

      // Reconstruct exact pre-index-rename OS crash state:
      // v1 in packages/<id>.backup.part, v2 in packages/<id>, v1 in index.json.
      pkgDir.renameSync(backupDir.path);
      _copyDirectorySync(v2SnapshotDir, pkgDir);

      final recovered = await manager.loadLibrary(userId: 'user-crash-pre-idx');
      expect(recovered.recoveredOrphanedCount, greaterThanOrEqualTo(1));
      expect(recovered.packages.length, 1);
      final rec = recovered.packages.single;
      expect(rec.revision, 1);
      expect(rec.displayName, 'Versão Crash Pré-Index v1');
      expect(rec.manifestSha256, v1Record.manifestSha256);
      expect(rec.integrityState, RehearsalPackageIntegrityState.verified);
      expect(backupDir.existsSync(), isFalse);

      final reval = await manager.revalidatePackage(
        userId: 'user-crash-pre-idx',
        packageId: rec.packageId,
      );
      expect(reval.category, RehearsalUserOutcomeCategory.revalidated);
      expect(
        reval.record?.integrityState,
        RehearsalPackageIntegrityState.verified,
      );
    });

    test('OS crash right after index.json commit (v2 in packages/<id> and index.json, stale v1 .backup.part) keeps v2 verified and deletes backup', () async {
      final v1 = _buildValidPackageZip(
        revision: 1,
        displayName: 'Versão Crash Pós-Index v1',
        seedOffset: 1,
      );
      safPort.nextPickArchiveBytes = v1;
      final first = await manager.importFromSaf(userId: 'user-crash-post-idx');
      expect(first.category, RehearsalUserOutcomeCategory.imported);
      final pkgId = first.record!.packageId;

      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-crash-post-idx',
      );
      final accountDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash',
      );
      final backupDir = Directory(
        '${accountDir.path}/packages/$pkgId.backup.part',
      );
      final v1BackupSnapshot = Directory('${tempDir.path}/v1_backup_snapshot');

      var snapshotBackupBeforeCommit = false;
      final hookManager = RehearsalPackageManager(
        safPort: safPort,
        debugBeforeIndexCommit: (tmpFile, targetFile) async {
          if (snapshotBackupBeforeCommit && backupDir.existsSync()) {
            _copyDirectorySync(backupDir, v1BackupSnapshot);
          }
        },
      );

      final v2 = _buildValidPackageZip(
        revision: 2,
        displayName: 'Versão Crash Pós-Index v2',
        seedOffset: 90,
      );
      safPort.nextPickArchiveBytes = v2;
      final conflict = await hookManager.importFromSaf(
        userId: 'user-crash-post-idx',
      );
      expect(conflict.category, RehearsalUserOutcomeCategory.conflict);

      snapshotBackupBeforeCommit = true;
      final replaced = await hookManager.confirmConflictReplace(
        userId: 'user-crash-post-idx',
        pendingTransactionId: conflict.conflict!.pendingTransactionId,
      );
      expect(replaced.category, RehearsalUserOutcomeCategory.imported);
      final v2Record = replaced.record!;
      expect(backupDir.existsSync(), isFalse);

      // Simulate OS crash after index.json atomic rename and before backup deletion.
      _copyDirectorySync(v1BackupSnapshot, backupDir);
      expect(backupDir.existsSync(), isTrue);

      final recovered = await manager.loadLibrary(userId: 'user-crash-post-idx');
      expect(recovered.recoveredOrphanedCount, greaterThanOrEqualTo(1));
      expect(recovered.packages.length, 1);
      final rec = recovered.packages.single;
      expect(rec.revision, 2);
      expect(rec.displayName, 'Versão Crash Pós-Index v2');
      expect(rec.manifestSha256, v2Record.manifestSha256);
      expect(rec.integrityState, RehearsalPackageIntegrityState.verified);
      expect(backupDir.existsSync(), isFalse);

      final reval = await manager.revalidatePackage(
        userId: 'user-crash-post-idx',
        packageId: rec.packageId,
      );
      expect(reval.category, RehearsalUserOutcomeCategory.revalidated);
      expect(
        reval.record?.integrityState,
        RehearsalPackageIntegrityState.verified,
      );
    });
  });

  group('Crash recovery, revalidation, export, rename, and delete', () {
    test('startup recovery cleans staging/*.part, index.json.tmp, restores orphan .backup.part, and flags truncated/missing stems', () async {
      final zipBytes = _buildValidPackageZip(useFlac: true);
      safPort.nextPickArchiveBytes = zipBytes;
      final imported = await manager.importFromSaf(userId: 'user-crash');
      expect(imported.category, RehearsalUserOutcomeCategory.imported);

      final pkgId = imported.record!.packageId;
      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-crash',
      );
      final accountDir = Directory(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash',
      );

      // Simulate orphaned staging tx, leftover index.json.tmp, and interrupted backup restore.
      final orphanStaging = Directory('${accountDir.path}/staging/tx_crash.part')
        ..createSync(recursive: true);
      File('${orphanStaging.path}/partial.zip').writeAsBytesSync([1, 2, 3]);
      File('${accountDir.path}/index.json.tmp').writeAsStringSync('{corrupt');

      final pkgDir = Directory('${accountDir.path}/packages/$pkgId');
      final backupDir = Directory(
        '${accountDir.path}/packages/$pkgId.backup.part',
      );
      pkgDir.renameSync(backupDir.path);

      var recoveredSnapshot = await manager.loadLibrary(userId: 'user-crash');
      expect(recoveredSnapshot.recoveredOrphanedCount, greaterThanOrEqualTo(3));
      expect(recoveredSnapshot.packages.single.integrityState,
          RehearsalPackageIntegrityState.verified);
      expect(pkgDir.existsSync(), isTrue);
      expect(backupDir.existsSync(), isFalse);
      expect(File('${accountDir.path}/index.json.tmp').existsSync(), isFalse);

      // Now truncate a stem file on disk and reload -> must mark incomplete (never verified).
      final vocalsFile = File('${pkgDir.path}/stem_vocals.flac');
      vocalsFile.writeAsBytesSync([0x66, 0x4C, 0x61, 0x43]);

      recoveredSnapshot = await manager.loadLibrary(userId: 'user-crash');
      expect(
        recoveredSnapshot.packages.single.integrityState,
        RehearsalPackageIntegrityState.incomplete,
      );
      expect(recoveredSnapshot.packages.single.isReadyForLocalUse, isFalse);
      expect(recoveredSnapshot.corruptedOrIncompleteCount, 1);

      // Delete a stem file on disk -> must mark missingFiles.
      vocalsFile.deleteSync();
      recoveredSnapshot = await manager.loadLibrary(userId: 'user-crash');
      expect(
        recoveredSnapshot.packages.single.integrityState,
        RehearsalPackageIntegrityState.missingFiles,
      );
    });

    test('revalidatePackage detects bit-flip corruption on disk and export refuses corrupted packages', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip();
      final imported = await manager.importFromSaf(userId: 'user-reval');
      final pkgId = imported.record!.packageId;

      // Happy export first.
      final exportOk = await manager.exportPackage(
        userId: 'user-reval',
        packageId: pkgId,
      );
      expect(exportOk.category, RehearsalUserOutcomeCategory.exported);
      expect(safPort.exportCalls, 1);
      expect(safPort.lastExportedBytes, isNotNull);

      // Flip 1 byte in stem_bass.wav without changing file size.
      final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
        'user-reval',
      );
      final bassFile = File(
        '${tempDir.path}/rehearsal_packages/accounts/$accountHash/packages/$pkgId/stem_bass.wav',
      );
      final bytes = bassFile.readAsBytesSync();
      bytes[bytes.length - 1] ^= 0x01;
      bassFile.writeAsBytesSync(bytes, flush: true);

      final reval = await manager.revalidatePackage(
        userId: 'user-reval',
        packageId: pkgId,
      );
      expect(reval.category, RehearsalUserOutcomeCategory.corrupted);
      expect(
        reval.record?.integrityState,
        RehearsalPackageIntegrityState.corrupted,
      );
      expect(reval.errorCode, 'LOCAL_SHA256_MISMATCH');

      // Export must be refused for corrupted package.
      final exportBlocked = await manager.exportPackage(
        userId: 'user-reval',
        packageId: pkgId,
      );
      expect(exportBlocked.category, RehearsalUserOutcomeCategory.corrupted);
      expect(safPort.exportCalls, 1);
    });

    test('renamePackageLabel updates displayName without changing hashes and validates length', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        displayName: 'Título Original',
      );
      final imported = await manager.importFromSaf(userId: 'user-rename');
      final pkg = imported.record!;

      final invalidBlank = await manager.renamePackageLabel(
        userId: 'user-rename',
        packageId: pkg.packageId,
        newLabel: '   ',
      );
      expect(invalidBlank.category, RehearsalUserOutcomeCategory.recoverableFailure);
      expect(invalidBlank.errorCode, 'INVALID_LABEL');

      final invalidTooLong = await manager.renamePackageLabel(
        userId: 'user-rename',
        packageId: pkg.packageId,
        newLabel: 'a' * 121,
      );
      expect(
        invalidTooLong.category,
        RehearsalUserOutcomeCategory.recoverableFailure,
      );

      final renamed = await manager.renamePackageLabel(
        userId: 'user-rename',
        packageId: pkg.packageId,
        newLabel: '  Domingo Manhã - Tom G  ',
      );
      expect(renamed.category, RehearsalUserOutcomeCategory.renamed);
      expect(renamed.record!.displayName, 'Domingo Manhã - Tom G');
      expect(renamed.record!.title, 'Título Original');
      expect(renamed.record!.compositeSha256, pkg.compositeSha256);
      expect(renamed.record!.manifestSha256, pkg.manifestSha256);
    });

    test('deletePackage requires confirmedScope and deletes only managed internal copy', () async {
      final externalSource = File('${tempDir.path}/external_copy.louvaio-rehearsal.zip');
      externalSource.writeAsBytesSync(_buildValidPackageZip());

      final imported = await manager.importStagedArchive(
        userId: 'user-delete',
        stagedArchiveFile: externalSource,
      );
      expect(imported.category, RehearsalUserOutcomeCategory.imported);
      final pkgId = imported.record!.packageId;

      final unconfirmed = await manager.deletePackage(
        userId: 'user-delete',
        packageId: pkgId,
        confirmedScope: false,
      );
      expect(unconfirmed.category, RehearsalUserOutcomeCategory.recoverableFailure);
      expect(unconfirmed.errorCode, 'CONFIRMATION_REQUIRED');

      final deleted = await manager.deletePackage(
        userId: 'user-delete',
        packageId: pkgId,
        confirmedScope: true,
      );
      expect(deleted.category, RehearsalUserOutcomeCategory.deleted);
      expect(externalSource.existsSync(), isTrue);

      final snapshot = await manager.loadLibrary(userId: 'user-delete');
      expect(snapshot.packages, isEmpty);
    });
  });

  group('Account namespace isolation and session invalidation', () {
    test('userA and userB namespaces are isolated and unaffected by ministries', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        displayName: 'Pacote Usuário A',
      );
      final impA = await manager.importFromSaf(userId: 'userA');
      expect(impA.category, RehearsalUserOutcomeCategory.imported);

      final snapB = await manager.loadLibrary(userId: 'userB');
      expect(snapB.packages, isEmpty);

      final snapA = await manager.loadLibrary(userId: 'userA');
      expect(snapA.packages.length, 1);
      expect(snapA.packages.single.displayName, 'Pacote Usuário A');
    });

    test('invalidateSession cancels active operation, drops stale callbacks, and preserves persisted files', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        displayName: 'Pacote Persistido',
      );
      final persisted = await manager.importFromSaf(userId: 'user-sess');
      expect(persisted.category, RehearsalUserOutcomeCategory.imported);

      // Start second import and invalidate session mid-SAF pick.
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        displayName: 'Pacote Interrompido',
        seedOffset: 77,
      );
      final receivedPhases = <RehearsalOperationPhase>[];
      safPort.onPickStarted = (opId) async {
        manager.invalidateSession();
        // Attempt to emit stale progress after invalidation; must be dropped.
        safPort.emitProgress(
          SafProgressEvent(
            operationId: opId,
            phase: 'staging_copy',
            bytesProcessed: 512,
            totalBytes: 1024,
          ),
        );
      };

      final interrupted = await manager.importFromSaf(
        userId: 'user-sess',
        onProgress: (p) => receivedPhases.add(p.phase),
      );

      expect(interrupted.category, RehearsalUserOutcomeCategory.cancelled);
      expect(interrupted.errorCode, 'SESSION_INVALIDATED');
      expect(receivedPhases, isNot(contains(RehearsalOperationPhase.stagingCopy)));
      expect(receivedPhases, isNot(contains(RehearsalOperationPhase.committing)));
      expect(safPort.cancelCalls, greaterThanOrEqualTo(1));

      // Previously persisted package remains intact on disk.
      final snap = await manager.loadLibrary(userId: 'user-sess');
      expect(snap.packages.length, 1);
      expect(
        snap.packages.single.packageId,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      );
    });

    test(
      'concurrent loadLibrary during active in-flight staging does not delete active staging/<txId>.part',
      () async {
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          displayName: 'Pacote Concorrente',
        );
        final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
          'user-concurrent',
        );

        String? observedOpId;
        bool stagingExistedBeforeLoad = false;
        bool stagingExistedAfterLoad = false;
        final pickerReached = Completer<void>();
        final releasePicker = Completer<void>();

        safPort.onPickStarted = (opId) async {
          observedOpId = opId;
          final activeStageDir = Directory(
            '${tempDir.path}/rehearsal_packages/accounts/$accountHash/staging/$opId.part',
          );
          stagingExistedBeforeLoad = activeStageDir.existsSync();
          pickerReached.complete();
          await releasePicker.future;
          stagingExistedAfterLoad = activeStageDir.existsSync();
        };

        final importing = manager.importFromSaf(userId: 'user-concurrent');
        await pickerReached.future;
        var loadCompleted = false;
        final loading = manager.loadLibrary(userId: 'user-concurrent').then((
          snapshot,
        ) {
          loadCompleted = true;
          return snapshot;
        });
        await Future<void>.delayed(Duration.zero);
        expect(loadCompleted, isFalse);
        releasePicker.complete();
        final outcome = await importing;
        final snapshot = await loading;
        expect(observedOpId, isNotNull);
        expect(stagingExistedBeforeLoad, isTrue);
        expect(stagingExistedAfterLoad, isTrue);
        expect(snapshot.recoveredOrphanedCount, 0);
        expect(snapshot.packages.single.packageId, outcome.record?.packageId);
        expect(outcome.category, RehearsalUserOutcomeCategory.imported);
        expect(
          outcome.record?.packageId,
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        );
      },
    );

    test('invalidateSession mid-revalidatePackage returns SESSION_INVALIDATED cleanly without FileSystemException', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        displayName: 'Pacote Revalidação Sessão',
      );
      final imported = await manager.importFromSaf(userId: 'user-reval-sess');
      expect(imported.category, RehearsalUserOutcomeCategory.imported);

      var invalidated = false;
      final outcome = await manager.revalidatePackage(
        userId: 'user-reval-sess',
        packageId: imported.record!.packageId,
        onProgress: (progress) {
          if (!invalidated &&
              progress.detailMessage ==
                  RehearsalPackageManager.stagedArchiveFileName) {
            invalidated = true;
            manager.invalidateSession();
          }
        },
      );

      expect(invalidated, isTrue);
      expect(outcome.category, RehearsalUserOutcomeCategory.cancelled);
      expect(outcome.errorCode, 'SESSION_INVALIDATED');
    });

    test('rejects empty userId cleanly without throwing unhandled errors on outcomes', () async {
      final res = await manager.importFromSaf(userId: '   ');
      expect(res.category, RehearsalUserOutcomeCategory.recoverableFailure);
      expect(res.errorCode, 'UNAUTHENTICATED');

      await expectLater(
        manager.loadLibrary(userId: ''),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('MethodChannelRehearsalPackageSafAdapter', () {
    test('translates method calls, progress events, PlatformException, and MissingPluginException cleanly', () async {
      const channelName = 'com.louvaio.mobile/rehearsal_package_saf_test';
      const channel = MethodChannel(channelName);
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

      final adapter = MethodChannelRehearsalPackageSafAdapter(channel: channel);
      addTearDown(adapter.dispose);

      // MissingPluginException handling when no handler is registered.
      await expectLater(
        adapter.getStorageInfo(),
        throwsA(isA<SafChannelException>()),
      );
      final missingPick = await adapter.pickAndStagePackage(
        operationId: 'op1',
        targetStageFilePath: '/tmp/a.zip',
      );
      expect(missingPick.status, SafStageStatus.error);
      expect(missingPick.code, 'SAF_UNAVAILABLE');
      expect(await adapter.cancelOperation(operationId: 'op1'), isFalse);

      // Mock native handler responses + progress stream emission.
      messenger.setMockMethodCallHandler(channel, (call) async {
        switch (call.method) {
          case 'getStorageInfo':
            return {
              'filesDirPath': '/data/user/0/com.louvaio/files',
              'availableBytes': 500000000,
              'totalBytes': 2000000000,
            };
          case 'pickAndStagePackage':
            return {
              'status': 'staged',
              'stagedFilePath': '/data/user/0/com.louvaio/files/stage.zip',
              'bytesCopied': 1024,
            };
          case 'exportPackageToUri':
            throw PlatformException(
              code: 'PERMISSION_DENIED',
              message: 'Negado pelo provedor',
            );
          case 'cancelOperation':
            return true;
        }
        return null;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

      final info = await adapter.getStorageInfo();
      expect(info.filesDirPath, '/data/user/0/com.louvaio/files');
      expect(info.availableBytes, 500000000);

      final events = <SafProgressEvent>[];
      final sub = adapter.progressStream.listen(events.add);
      addTearDown(sub.cancel);

      const codec = StandardMethodCodec();
      await messenger.handlePlatformMessage(
        channelName,
        codec.encodeMethodCall(
          const MethodCall('onOperationProgress', {
            'operationId': 'op-42',
            'phase': 'staging_copy',
            'bytesProcessed': 2048,
            'totalBytes': 4096,
          }),
        ),
        (_) {},
      );
      await Future<void>.delayed(Duration.zero);
      expect(events.length, 1);
      expect(events.single.operationId, 'op-42');
      expect(events.single.bytesProcessed, 2048);

      final staged = await adapter.pickAndStagePackage(
        operationId: 'op-42',
        targetStageFilePath: '/data/user/0/com.louvaio/files/stage.zip',
      );
      expect(staged.status, SafStageStatus.staged);
      expect(staged.bytesCopied, 1024);

      final exportErr = await adapter.exportPackageToUri(
        operationId: 'op-43',
        sourceFilePath: '/data/user/0/com.louvaio/files/a.zip',
        suggestedFileName: 'a.louvaio-rehearsal.zip',
      );
      expect(exportErr.status, SafExportStatus.error);
      expect(exportErr.code, 'PERMISSION_DENIED');

      expect(await adapter.cancelOperation(operationId: 'op-42'), isTrue);
    });
  });

  group('Unicode security & canonical filename isolation (Missão 2)', () {
    test(
      'rejects uncovered-script manifest vs ZIP NFC divergence fail-closed without extraction',
      () async {
        final vocalBytes = buildSyntheticWavPcm16(seed: 71, frames: 4410);
        final drumsBytes = buildSyntheticWavPcm16(seed: 72, frames: 4410);
        final bassBytes = buildSyntheticWavPcm16(seed: 73, frames: 4410);
        final otherBytes = buildSyntheticWavPcm16(seed: 74, frames: 4410);

        final manifest = Map<String, dynamic>.from(
          loadReferenceManifest('valid-wav-minimal.manifest.json'),
        );
        manifest['packageId'] = 'f1111111-1111-4111-8111-111111111111';
        manifest['stems'] = [
          {
            'id': 'vocals',
            'path': 'stems/\u304C.wav', // Hiragana GA (NFC)
            'container': 'wav',
            'codec': 'pcm_s16le',
            'bitsPerSample': 16,
            'byteLength': vocalBytes.length,
            'sha256': IncrementalSha256.computeHex(vocalBytes),
            'sampleRate': 44100,
            'channels': 2,
            'decodedFrames': 4410,
          },
          {
            'id': 'drums',
            'path': 'stems/\uFB2A.wav', // Hebrew SHIN WITH SHIN DOT (NFC)
            'container': 'wav',
            'codec': 'pcm_s16le',
            'bitsPerSample': 16,
            'byteLength': drumsBytes.length,
            'sha256': IncrementalSha256.computeHex(drumsBytes),
            'sampleRate': 44100,
            'channels': 2,
            'decodedFrames': 4410,
          },
          {
            'id': 'bass',
            'path': 'stems/bass.wav',
            'container': 'wav',
            'codec': 'pcm_s16le',
            'bitsPerSample': 16,
            'byteLength': bassBytes.length,
            'sha256': IncrementalSha256.computeHex(bassBytes),
            'sampleRate': 44100,
            'channels': 2,
            'decodedFrames': 4410,
          },
          {
            'id': 'other',
            'path': 'stems/other.wav',
            'container': 'wav',
            'codec': 'pcm_s16le',
            'bitsPerSample': 16,
            'byteLength': otherBytes.length,
            'sha256': IncrementalSha256.computeHex(otherBytes),
            'sampleRate': 44100,
            'channels': 2,
            'decodedFrames': 4410,
          },
        ];

        final zipBytes = buildSyntheticZip([
          SyntheticZipEntry(
            path: 'manifest.json',
            uncompressedData: Uint8List.fromList(utf8.encode(jsonEncode(manifest))),
          ),
          // ZIP holds NFD sequences instead of NFC declared in manifest.json.
          SyntheticZipEntry(
            path: 'stems/\u304B\u3099.wav',
            uncompressedData: vocalBytes,
          ),
          SyntheticZipEntry(
            path: 'stems/\u05E9\u05C1.wav',
            uncompressedData: drumsBytes,
          ),
          SyntheticZipEntry(path: 'stems/bass.wav', uncompressedData: bassBytes),
          SyntheticZipEntry(path: 'stems/other.wav', uncompressedData: otherBytes),
        ]);

        var sinkOpens = 0;
        final guardedManager = RehearsalPackageManager(
          safPort: safPort,
          sinkFactory: (f) async {
            sinkOpens++;
            return f.openWrite();
          },
        );
        safPort.nextPickArchiveBytes = zipBytes;

        final outcome = await guardedManager.importFromSaf(userId: 'user-unicode');
        expect(outcome.category, RehearsalUserOutcomeCategory.corrupted);
        expect(outcome.errorCode, 'MISSING_REQUIRED_STEM');
        expect(sinkOpens, 0);

        final snapshot = await guardedManager.loadLibrary(userId: 'user-unicode');
        expect(snapshot.packages, isEmpty);
      },
    );

    test(
      'canonical internal filenames prevent overwrite across uncovered Unicode NFC/NFD equivalents and cross-script homoglyphs',
      () async {
        const pkgId = 'f2222222-2222-4222-8222-222222222222';
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgId,
          displayName: 'Homoglyph & Unicode Test',
          seedOffset: 50,
          customStemPaths: {
            'vocals': 'stems/\u304C.wav', // Hiragana GA NFC
            'drums': 'stems/\u304B\u3099.wav', // Hiragana KA + dakuten NFD
            'bass': 'stems/v\u0430cals.wav', // Cyrillic 'a' (U+0430)
            'other': 'stems/vocals.wav', // ASCII Latin 'a' (U+0061)
          },
        );

        final outcome = await manager.importFromSaf(userId: 'user-unicode');
        expect(outcome.category, RehearsalUserOutcomeCategory.imported);
        final record = outcome.record!;
        expect(record.isReadyForLocalUse, isTrue);

        final accountHash = RehearsalPackageManager.computeAccountNamespaceHash(
          'user-unicode',
        );
        final pkgDir = Directory(
          '${tempDir.path}/rehearsal_packages/accounts/$accountHash/packages/$pkgId',
        );
        final diskNames = pkgDir
            .listSync(recursive: true, followLinks: false)
            .whereType<File>()
            .map((f) => f.uri.pathSegments.last)
            .toSet();

        expect(diskNames, {
          'manifest.json',
          'package.louvaio-rehearsal.zip',
          'stem_vocals.wav',
          'stem_drums.wav',
          'stem_bass.wav',
          'stem_other.wav',
        });

        // Confirm all 4 stems kept distinct hashes without overwriting each other.
        final stemHashes = record.stems.values.map((s) => s.sha256).toSet();
        expect(stemHashes.length, 4);

        final reval = await manager.revalidatePackage(
          userId: 'user-unicode',
          packageId: pkgId,
        );
        expect(reval.category, RehearsalUserOutcomeCategory.revalidated);
        expect(reval.record?.integrityState, RehearsalPackageIntegrityState.verified);
      },
    );
  });
}

void _copyDirectorySync(Directory source, Directory destination) {
  if (!destination.existsSync()) {
    destination.createSync(recursive: true);
  }
  for (final entity in source.listSync(followLinks: false)) {
    final name = entity.uri.pathSegments.where((s) => s.isNotEmpty).last;
    if (entity is Directory) {
      _copyDirectorySync(entity, Directory('${destination.path}/$name'));
    } else if (entity is File) {
      entity.copySync('${destination.path}/$name');
    }
  }
}
