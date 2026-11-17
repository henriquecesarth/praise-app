import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';

import '../../support/rehearsal_package_corpus.dart';

final class _SpyRehearsalByteSource implements RehearsalByteSource {
  _SpyRehearsalByteSource(
    this._inner, {
    this.cancelAfterReads,
    this.cancellationToken,
  });

  final RehearsalByteSource _inner;
  final int? cancelAfterReads;
  final RehearsalCancellationToken? cancellationToken;

  int readCount = 0;
  int maxObservedSliceLength = 0;
  int totalBytesRequested = 0;

  @override
  int get byteLength => _inner.byteLength;

  @override
  Future<Uint8List> readSlice(int offset, int length) async {
    readCount++;
    if (length > maxObservedSliceLength) {
      maxObservedSliceLength = length;
    }
    totalBytesRequested += length;
    if (cancelAfterReads != null &&
        cancellationToken != null &&
        readCount >= cancelAfterReads!) {
      cancellationToken!.cancel();
    }
    return _inner.readSlice(offset, length);
  }
}

final class _NoNetworkHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    throw StateError('Network access is forbidden during T7 validation');
  }
}

void main() {
  test('LIMITS_V1 constants match shared corpus limits', () {
    final corpus = loadRehearsalPackageCorpus();
    final limits = corpus['limits'] as Map<String, dynamic>;

    expect(RehearsalLimitsV1.maxCompressedBytes, limits['maxCompressedBytes']);
    expect(RehearsalLimitsV1.maxExtractedBytes, limits['maxExtractedBytes']);
    expect(RehearsalLimitsV1.maxEntries, limits['maxEntries']);
    expect(RehearsalLimitsV1.maxManifestBytes, limits['maxManifestBytes']);
    expect(RehearsalLimitsV1.maxPathDepth, limits['maxPathDepth']);
    expect(
      RehearsalLimitsV1.maxCompressionRatio,
      limits['maxCompressionRatio'],
    );
    expect(RehearsalLimitsV1.maxDurationSeconds, limits['maxDurationSeconds']);
    expect(RehearsalLimitsV1.maxDurationFrames, limits['maxDurationFrames']);
    expect(
      RehearsalLimitsV1.minFreeSpaceReserveBytes,
      limits['minFreeSpaceReserveBytes'],
    );
    expect(
      RehearsalLimitsV1.minFreeSpaceReserveRatio,
      limits['minFreeSpaceReserveRatio'],
    );
    expect(
      RehearsalLimitsV1.defaultMaxChunkBytes,
      limits['defaultMaxChunkBytes'],
    );
    expect(
      RehearsalLimitsV1.defaultMaxMemoryBudgetBytes,
      limits['defaultMaxMemoryBudgetBytes'],
    );
  });

  test('pure Dart IncrementalSha256 and IncrementalCrc32 match known vectors', () {
    expect(
      IncrementalSha256.computeHex(const []),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(
      IncrementalSha256.computeHex(utf8.encode('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    final chunkedSha = IncrementalSha256();
    final msg = utf8.encode(
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    );
    for (var i = 0; i < msg.length; i += 7) {
      final end = (i + 7 > msg.length) ? msg.length : i + 7;
      chunkedSha.update(msg, i, end);
    }
    expect(
      chunkedSha.digestHex(),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );

    expect(
      IncrementalCrc32.compute(utf8.encode('123456789')),
      0xCBF43926,
    );
  });

  group('shared corpus rehearsal-package-v1', () {
    final cases = synthesizeAllCorpusCases();

    test('corpus contains all expected recipes', () {
      expect(cases.length, 44);
    });

    for (final testCase in cases) {
      test('${testCase.id}: ${testCase.description}', () async {
        await HttpOverrides.runWithHttpOverrides(() async {
          final spy = _SpyRehearsalByteSource(
            MemoryRehearsalByteSource(testCase.bytes),
          );
          final result = await validateRehearsalPackage(
            spy,
            options: testCase.options,
          );
          final json = result.toJson();

          expect(json.keys.toSet(), {
            'format',
            'formatVersion',
            'status',
            'errorCode',
            'errorMessage',
            'readyForPublication',
            'publicationState',
            'songVersionBindingAuthorized',
            'idempotencyDisposition',
            'packageIdentity',
            'manifestSummary',
            'budget',
            'verifiedEntries',
          });

          expect(json['format'], 'louvaio-rehearsal');
          expect(json['formatVersion'], 1);
          expect(json['status'], testCase.expected['status']);
          expect(json['errorCode'], testCase.expected['errorCode']);
          expect(
            json['readyForPublication'],
            testCase.expected['readyForPublication'],
          );
          expect(
            json['publicationState'],
            testCase.expected['publicationState'],
          );
          expect(json['songVersionBindingAuthorized'], false);
          expect(
            json['idempotencyDisposition'],
            testCase.expected['idempotencyDisposition'],
          );
          expect(
            (json['verifiedEntries'] as List<dynamic>).length,
            testCase.expected['verifiedEntryCount'],
          );

          // Fail-closed invariant: no invalid state can ever authorize publication.
          if (testCase.expected['status'] != 'valid') {
            expect(json['readyForPublication'], isFalse);
            expect(json['publicationState'], 'rejected');
            expect(json['errorCode'], isNotNull);
          } else {
            expect(json['readyForPublication'], isTrue);
            expect(json['publicationState'], 'staged_validated');
            expect(json['errorCode'], isNull);
            expect(json['packageIdentity'], isNotNull);
            expect(json['manifestSummary'], isNotNull);
            final summary = json['manifestSummary'] as Map<String, dynamic>;
            expect(summary.keys.toSet(), {
              'packageId',
              'revision',
              'createdAt',
              'displayName',
              'format',
              'formatVersion',
              'requiredFeatures',
              'sampleRate',
              'channels',
              'totalFrames',
              'durationSeconds',
              'includesOriginal',
              'stemIds',
            });
          }

          final budget = json['budget'] as Map<String, dynamic>;
          expect(budget.keys.toSet(), {
            'compressedBytes',
            'declaredExtractedBytes',
            'actualExtractedBytes',
            'entryCount',
            'requiredFreeStorageBytes',
            'availableStorageBytes',
            'maxChunkBytes',
            'maxMemoryBudgetBytes',
            'peakWorkingMemoryBytes',
            'maxObservedSingleReadBytes',
          });
          expect(
            budget['maxObservedSingleReadBytes'],
            lessThanOrEqualTo(RehearsalLimitsV1.defaultMaxChunkBytes),
          );

          expect(
            spy.maxObservedSliceLength,
            lessThanOrEqualTo(RehearsalLimitsV1.defaultMaxChunkBytes),
          );
        }, _NoNetworkHttpOverrides());
      });
    }
  });

  test('FileRehearsalByteSource validates temp .louvaio-rehearsal.zip within <= 64 KiB slices', () async {
    final minimalCase = synthesizeAllCorpusCases().firstWhere(
      (c) => c.id == 'valid-wav-minimal',
    );
    final tempDir = Directory.systemTemp.createTempSync('louvaio_t7_test_');
    try {
      final zipFile = File('${tempDir.path}/sample.louvaio-rehearsal.zip');
      zipFile.writeAsBytesSync(minimalCase.bytes);

      final fileSource = FileRehearsalByteSource(zipFile);
      final spy = _SpyRehearsalByteSource(fileSource);

      final result = await validateRehearsalPackage(spy);
      expect(result.status, RehearsalValidationStatus.valid);
      expect(result.readyForPublication, isTrue);
      expect(result.publicationState, 'staged_validated');
      expect(result.songVersionBindingAuthorized, isFalse);
      expect(
        spy.maxObservedSliceLength,
        lessThanOrEqualTo(RehearsalLimitsV1.defaultMaxChunkBytes),
      );

      // Verify FileRehearsalByteSource rejects slices > 64 KiB.
      await expectLater(
        () => fileSource.readSlice(0, RehearsalLimitsV1.defaultMaxChunkBytes + 1),
        throwsArgumentError,
      );
    } finally {
      tempDir.deleteSync(recursive: true);
    }
  });

  test('mid-stream slice budget and cancellation during multi-chunk entry', () async {
    // Build a valid package with 150 KiB WAV stems (> 2 * 64 KiB chunks per stem).
    final manifest = loadReferenceManifest('valid-wav-minimal.manifest.json');
    final stems = (manifest['stems'] as List<dynamic>).cast<Map<String, dynamic>>();
    const largeFrames = 44100; // 44100 * 4 = 176400 bytes + 44 header
    (manifest['timeline'] as Map<String, dynamic>)['totalFrames'] = largeFrames;
    (manifest['source'] as Map<String, dynamic>)['durationFrames'] = largeFrames;

    final entries = <SyntheticZipEntry>[];
    for (var i = 0; i < stems.length; i++) {
      final wav = buildSyntheticWavPcm16(seed: i + 1, frames: largeFrames);
      stems[i]['decodedFrames'] = largeFrames;
      stems[i]['byteLength'] = wav.length;
      stems[i]['sha256'] = IncrementalSha256.computeHex(wav);
      entries.add(
        SyntheticZipEntry(
          path: stems[i]['path'] as String,
          uncompressedData: wav,
        ),
      );
    }
    final manifestBytes = Uint8List.fromList(utf8.encode(jsonEncode(manifest)));
    final zipBytes = buildSyntheticZip([
      SyntheticZipEntry(path: 'manifest.json', uncompressedData: manifestBytes),
      ...entries,
    ]);

    // 1. Verify slice budget <= 16 KiB when maxChunkBytes is 16384.
    final chunkSpy = _SpyRehearsalByteSource(MemoryRehearsalByteSource(zipBytes));
    final okResult = await validateRehearsalPackage(
      chunkSpy,
      options: const RehearsalValidationOptions(maxChunkBytes: 16384),
    );
    expect(okResult.status, RehearsalValidationStatus.valid);
    expect(chunkSpy.maxObservedSliceLength, lessThanOrEqualTo(16384));
    expect(chunkSpy.readCount, greaterThan(10));

    // 2. Verify mid-stream cancellation stops immediately.
    final cancelToken = RehearsalCancellationToken();
    final cancelSpy = _SpyRehearsalByteSource(
      MemoryRehearsalByteSource(zipBytes),
      cancelAfterReads: 6,
      cancellationToken: cancelToken,
    );
    final cancelled = await validateRehearsalPackage(
      cancelSpy,
      options: RehearsalValidationOptions(
        maxChunkBytes: 16384,
        cancellationToken: cancelToken,
      ),
    );
    expect(cancelled.status, RehearsalValidationStatus.cancelled);
    expect(cancelled.errorCode, 'VALIDATION_CANCELLED');
    expect(cancelled.readyForPublication, isFalse);
    expect(cancelled.publicationState, 'rejected');
    expect(cancelled.songVersionBindingAuthorized, isFalse);

    // 3. Verify pre-flight cancellation before any slice read.
    final preCancelledToken = RehearsalCancellationToken()..cancel();
    final preSpy = _SpyRehearsalByteSource(MemoryRehearsalByteSource(zipBytes));
    final preCancelled = await validateRehearsalPackage(
      preSpy,
      options: RehearsalValidationOptions(cancellationToken: preCancelledToken),
    );
    expect(preCancelled.status, RehearsalValidationStatus.cancelled);
    expect(preCancelled.errorCode, 'VALIDATION_CANCELLED');
    expect(preSpy.readCount, 0);
  });

  test('returns insufficientSpace with MEMORY_BUDGET_EXCEEDED when budget is exceeded', () async {
    final minimalCase = synthesizeAllCorpusCases().firstWhere(
      (c) => c.id == 'valid-wav-minimal',
    );
    final result = await validateRehearsalPackage(
      MemoryRehearsalByteSource(minimalCase.bytes),
      options: const RehearsalValidationOptions(maxMemoryBudgetBytes: 512),
    );

    expect(result.status, RehearsalValidationStatus.insufficientSpace);
    expect(result.errorCode, 'MEMORY_BUDGET_EXCEEDED');
    expect(result.readyForPublication, isFalse);
    expect(result.publicationState, 'rejected');
    expect(result.songVersionBindingAuthorized, isFalse);
  });

  test('rejects LFH/CD header mismatch, missing manifest, UTF-8 BOM, POSIX special files, and unsafe paths', () async {
    // 1. Missing manifest.json
    final wav = buildSyntheticWavPcm16(seed: 1);
    final noManifestZip = buildSyntheticZip([
      SyntheticZipEntry(path: 'stems/vocals.wav', uncompressedData: wav),
    ]);
    final noManifestRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(noManifestZip),
    );
    expect(noManifestRes.status, RehearsalValidationStatus.corrupted);
    expect(noManifestRes.errorCode, 'MISSING_MANIFEST');
    expect(noManifestRes.readyForPublication, isFalse);

    // 2. POSIX FIFO special file
    final fifoZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList(utf8.encode('{}')),
      ),
      SyntheticZipEntry(
        path: 'stems/vocals.wav',
        uncompressedData: wav,
        externalAttr: 0x1000 << 16,
      ),
    ]);
    final fifoRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(fifoZip),
    );
    expect(fifoRes.errorCode, 'SPECIAL_FILE_OR_SYMLINK_FORBIDDEN');
    expect(fifoRes.readyForPublication, isFalse);

    // 3. Nested .7z extension and gzip magic
    final gzMagicZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList([0x1F, 0x8B, 0x08, 0x00]),
      ),
    ]);
    final gzRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(gzMagicZip),
    );
    expect(gzRes.errorCode, 'NESTED_ARCHIVE_FORBIDDEN');
    expect(gzRes.readyForPublication, isFalse);

    // 4. Bidi override in path
    final bidiZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList(utf8.encode('{}')),
      ),
      SyntheticZipEntry(
        path: 'stems/voc\u202Eals.wav',
        uncompressedData: wav,
      ),
    ]);
    final bidiRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(bidiZip),
    );
    expect(bidiRes.errorCode, 'PATH_TRAVERSAL_OR_UNSAFE_PATH');
    expect(bidiRes.readyForPublication, isFalse);

    // 5. UTF-8 BOM in manifest.json
    final bomManifestZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList([
          0xEF,
          0xBB,
          0xBF,
          ...utf8.encode('{}'),
        ]),
      ),
    ]);
    final bomRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(bomManifestZip),
    );
    expect(bomRes.errorCode, 'INVALID_MANIFEST_JSON');
    expect(bomRes.readyForPublication, isFalse);

    // 6. LFH/CD header mismatch (corrupt LFH compression method byte)
    final minimalCase = synthesizeAllCorpusCases().firstWhere(
      (c) => c.id == 'valid-wav-minimal',
    );
    final mutatedLfh = Uint8List.fromList(minimalCase.bytes);
    mutatedLfh[8] = 9; // LFH compressionMethod low byte != CD (0)
    final mismatchRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(mutatedLfh),
    );
    expect(mismatchRes.status, RehearsalValidationStatus.corrupted);
    expect(mismatchRes.errorCode, 'HEADER_MISMATCH');
    expect(mismatchRes.readyForPublication, isFalse);

    // 7. Reconciled edge probes: formatVersion 0, mono original WAV, practice.bpm bounds, negative storage
    final wavMono = buildSyntheticWavPcm16(channels: 1, seed: 77);
    final baseMap = Map<String, dynamic>.from(
      loadReferenceManifest('valid-wav-minimal.manifest.json'),
    );
    baseMap['packageId'] = '44444444-4444-4444-8444-444444444444';
    baseMap['displayName'] = 'Reconciled Edge Probes';
    baseMap['stems'] = ['vocals', 'drums', 'bass', 'other']
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

    final v0Zip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList(
          utf8.encode(jsonEncode({...baseMap, 'formatVersion': 0})),
        ),
      ),
      ...['vocals', 'drums', 'bass', 'other'].map(
        (id) => SyntheticZipEntry(path: 'stems/$id.wav', uncompressedData: wav),
      ),
    ]);
    final v0Res = await validateRehearsalPackage(MemoryRehearsalByteSource(v0Zip));
    expect(v0Res.status, RehearsalValidationStatus.corrupted);
    expect(v0Res.errorCode, 'INVALID_MANIFEST_JSON');

    final monoOrigZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList(
          utf8.encode(
            jsonEncode({
              ...baseMap,
              'original': {
                'included': true,
                'path': 'audio/mono.wav',
                'container': 'wav',
                'codec': 'pcm_s16le',
                'bitsPerSample': 16,
                'byteLength': wavMono.length,
                'sha256': IncrementalSha256.computeHex(wavMono),
                'sampleRate': 44100,
                'channels': 1,
                'decodedFrames': 4410,
              },
            }),
          ),
        ),
      ),
      ...['vocals', 'drums', 'bass', 'other'].map(
        (id) => SyntheticZipEntry(path: 'stems/$id.wav', uncompressedData: wav),
      ),
      SyntheticZipEntry(path: 'audio/mono.wav', uncompressedData: wavMono),
    ]);
    final monoRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(monoOrigZip),
    );
    expect(monoRes.status, RehearsalValidationStatus.valid);
    expect(monoRes.readyForPublication, isTrue);

    final badPracticeZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList(
          utf8.encode(
            jsonEncode({
              ...baseMap,
              'practice': {'bpm': 500},
            }),
          ),
        ),
      ),
      ...['vocals', 'drums', 'bass', 'other'].map(
        (id) => SyntheticZipEntry(path: 'stems/$id.wav', uncompressedData: wav),
      ),
    ]);
    final badPracticeRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(badPracticeZip),
    );
    expect(badPracticeRes.status, RehearsalValidationStatus.corrupted);
    expect(badPracticeRes.errorCode, 'INVALID_MANIFEST_JSON');

    // 8. Security review regression probes:
    // (a) LFH 0xFFFFFFFF ZIP64 sentinel without LFH extra field -> HEADER_MISMATCH (HIGH-1)
    final spoofedLfhBytes = Uint8List.fromList(minimalCase.bytes);
    final spoofBd = ByteData.sublistView(spoofedLfhBytes);
    spoofBd.setUint32(18, 0xFFFFFFFF, Endian.little);
    spoofBd.setUint32(22, 0xFFFFFFFF, Endian.little);
    final spoofedLfhRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(spoofedLfhBytes),
    );
    expect(spoofedLfhRes.status, RehearsalValidationStatus.corrupted);
    expect(spoofedLfhRes.errorCode, 'HEADER_MISMATCH');
    expect(spoofedLfhRes.readyForPublication, isFalse);

    // (b) ZIP64 signed 64-bit overflow traps (HIGH-2) -> corrupted, never RangeError
    final z64OverflowBytes = Uint8List.fromList(minimalCase.bytes);
    // Append synthetic ZIP64 EOCD + Locator + EOCD pointing to overflow CD offset/size
    final z64Trap = BytesBuilder()..add(z64OverflowBytes);
    final z64Off = z64Trap.length;
    final z64Eocd = Uint8List(56);
    final z64Bd = ByteData.sublistView(z64Eocd);
    z64Bd.setUint32(0, 0x06064B50, Endian.little);
    z64Bd.setUint64(4, 44, Endian.little);
    z64Bd.setUint64(24, 1, Endian.little);
    z64Bd.setUint64(32, 1, Endian.little);
    z64Bd.setUint64(40, 0x100, Endian.little); // cdSize
    z64Bd.setUint64(48, 0x7FFFFFFFFFFFFFF0, Endian.little); // signed wraparound trap
    z64Trap.add(z64Eocd);
    final loc = Uint8List(20);
    final locBd = ByteData.sublistView(loc);
    locBd.setUint32(0, 0x07064B50, Endian.little);
    locBd.setUint64(8, z64Off, Endian.little);
    locBd.setUint32(16, 1, Endian.little);
    z64Trap.add(loc);
    final eocdTail = Uint8List(22);
    final eocdTailBd = ByteData.sublistView(eocdTail);
    eocdTailBd.setUint32(0, 0x06054B50, Endian.little);
    eocdTailBd.setUint16(8, 0xFFFF, Endian.little);
    eocdTailBd.setUint16(10, 0xFFFF, Endian.little);
    eocdTailBd.setUint32(12, 0xFFFFFFFF, Endian.little);
    eocdTailBd.setUint32(16, 0xFFFFFFFF, Endian.little);
    z64Trap.add(eocdTail);
    final z64OverflowRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(z64Trap.takeBytes()),
    );
    expect(z64OverflowRes.status, RehearsalValidationStatus.corrupted);
    expect(z64OverflowRes.errorCode, 'TRUNCATED_ARCHIVE');
    expect(z64OverflowRes.readyForPublication, isFalse);

    // (c) Short-read byte source returns TRUNCATED_ARCHIVE cleanly (MEDIUM-4)
    final shortSource = _ShortReadByteSource(minimalCase.bytes.length);
    final shortReadRes = await validateRehearsalPackage(shortSource);
    expect(shortReadRes.status, RehearsalValidationStatus.corrupted);
    expect(shortReadRes.errorCode, 'TRUNCATED_ARCHIVE');
    expect(shortReadRes.readyForPublication, isFalse);

    // (d) Duplicate media paths across stems -> DUPLICATE_OR_COLLIDING_ENTRY (LOW-1)
    final dupStemZip = buildSyntheticZip([
      SyntheticZipEntry(
        path: 'manifest.json',
        uncompressedData: Uint8List.fromList(
          utf8.encode(
            jsonEncode({
              ...baseMap,
              'stems': (baseMap['stems'] as List)
                  .cast<Map<String, dynamic>>()
                  .map((s) => s['id'] == 'drums' ? {...s, 'path': 'stems/vocals.wav'} : s)
                  .toList(),
            }),
          ),
        ),
      ),
      ...['vocals', 'drums', 'bass', 'other'].map(
        (id) => SyntheticZipEntry(path: 'stems/$id.wav', uncompressedData: wav),
      ),
    ]);
    final dupStemRes = await validateRehearsalPackage(
      MemoryRehearsalByteSource(dupStemZip),
    );
    expect(dupStemRes.status, RehearsalValidationStatus.corrupted);
    expect(dupStemRes.errorCode, 'DUPLICATE_OR_COLLIDING_ENTRY');
    expect(dupStemRes.readyForPublication, isFalse);
  });
}

final class _ShortReadByteSource implements RehearsalByteSource {
  _ShortReadByteSource(this.byteLength);

  @override
  final int byteLength;

  @override
  Future<Uint8List> readSlice(int offset, int length) async {
    return Uint8List(length > 4 ? length - 1 : 0);
  }
}
