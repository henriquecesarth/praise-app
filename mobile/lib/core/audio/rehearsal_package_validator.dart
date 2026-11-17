/// Local-first validator for `.louvaio-rehearsal.zip` (T7).
///
/// Pure Dart + `dart:io` implementation without network, persistence, or
/// external archive dependencies.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

/// Normative v1 limits for `.louvaio-rehearsal.zip`.
abstract final class RehearsalLimitsV1 {
  static const String format = 'louvaio-rehearsal';
  static const int formatVersion = 1;
  static const int maxCompressedBytes = 2147483648; // 2 GiB
  static const int maxExtractedBytes = 4294967296; // 4 GiB
  static const int maxEntries = 32;
  static const int maxManifestBytes = 262144; // 256 KiB
  static const int maxPathDepth = 3;
  static const int maxCompressionRatio = 100;
  static const int maxDurationSeconds = 1800;
  static const int maxDurationFrames = 79380000; // 1800 * 44100
  static const int minFreeSpaceReserveBytes = 268435456; // 256 MiB
  static const double minFreeSpaceReserveRatio = 0.1;
  static const int defaultMaxChunkBytes = 65536; // 64 KiB
  static const int defaultMaxMemoryBudgetBytes = 67108864; // 64 MiB
  static const int sampleRate = 44100;
  static const int channels = 2;
  static const int audioInspectionWindowBytes = 4096;
  static const int minPracticeLoopFrames = 4410; // 100 ms at 44100 Hz

  static const List<String> requiredStemIds = [
    'vocals',
    'drums',
    'bass',
    'other',
  ];

  static const Set<String> supportedFeatures = {
    'stems-4',
    'timeline-v1',
    'alignment-v1',
    'practice-v1',
    'original-optional',
  };

  static const Set<String> forbiddenAuthorityFields = {
    'ministryId',
    'groupId',
    'songId',
    'versionId',
    'userId',
    'accountId',
    'uid',
    'email',
    'authToken',
    'accessToken',
    'bearer',
    'role',
    'permissions',
  };
}

/// Validation outcome states aligned with the shared T7 corpus.
enum RehearsalValidationStatus {
  valid('valid'),
  incomplete('incomplete'),
  unsupported('unsupported'),
  corrupted('corrupted'),
  insufficientSpace('insufficientSpace'),
  conflict('conflict'),
  cancelled('cancelled');

  const RehearsalValidationStatus(this.wireName);
  final String wireName;
}

/// Bounded random-access byte source for incremental ZIP validation.
abstract interface class RehearsalByteSource {
  int get byteLength;
  Future<Uint8List> readSlice(int offset, int length);
}

/// In-memory byte source backed by a [Uint8List].
final class MemoryRehearsalByteSource implements RehearsalByteSource {
  MemoryRehearsalByteSource(this._bytes);

  final Uint8List _bytes;

  @override
  int get byteLength => _bytes.length;

  @override
  Future<Uint8List> readSlice(int offset, int length) async {
    if (offset < 0 || length < 0 || offset + length > _bytes.length) {
      throw RangeError(
        'Slice [$offset, ${offset + length}) out of bounds (length: ${_bytes.length})',
      );
    }
    if (length == 0) {
      return Uint8List(0);
    }
    return Uint8List.sublistView(_bytes, offset, offset + length);
  }
}

/// File-backed byte source reading strictly bounded slices <= 64 KiB via [RandomAccessFile].
final class FileRehearsalByteSource implements RehearsalByteSource {
  FileRehearsalByteSource(
    this._file, {
    int maxSliceBytes = RehearsalLimitsV1.defaultMaxChunkBytes,
  }) : _maxSliceBytes = math.min(
         math.max(1, maxSliceBytes),
         RehearsalLimitsV1.defaultMaxChunkBytes,
       ),
       _byteLength = _file.lengthSync();

  final File _file;
  final int _maxSliceBytes;
  final int _byteLength;
  RandomAccessFile? _openHandle;
  Future<void> _ioChain = Future<void>.value();

  @override
  int get byteLength => _byteLength;

  Future<void> open() async {
    _openHandle ??= await _file.open(mode: FileMode.read);
  }

  Future<void> close() async {
    final handle = _openHandle;
    _openHandle = null;
    if (handle != null) {
      await handle.close();
    }
  }

  @override
  Future<Uint8List> readSlice(int offset, int length) {
    if (length > _maxSliceBytes) {
      throw ArgumentError.value(
        length,
        'length',
        'Slice length exceeds $_maxSliceBytes bytes',
      );
    }
    if (offset < 0 || length < 0 || offset + length > _byteLength) {
      throw RangeError(
        'Slice [$offset, ${offset + length}) out of bounds (length: $_byteLength)',
      );
    }
    if (length == 0) {
      return Future<Uint8List>.value(Uint8List(0));
    }

    final completer = Completer<Uint8List>();
    _ioChain = _ioChain.then((_) async {
      final existing = _openHandle;
      final handle = existing ?? await _file.open(mode: FileMode.read);
      try {
        await handle.setPosition(offset);
        final data = await handle.read(length);
        completer.complete(data);
      } catch (e, st) {
        completer.completeError(e, st);
      } finally {
        if (existing == null) {
          await handle.close();
        }
      }
    });
    return completer.future;
  }
}

/// Cooperative cancellation token checked before and during streaming reads.
final class RehearsalCancellationToken {
  bool _cancelled = false;

  bool get isCancelled => _cancelled;

  void cancel() {
    _cancelled = true;
  }
}

/// Known locally staged/committed package used for idempotency and conflict detection.
final class ExistingRehearsalPackage {
  const ExistingRehearsalPackage({
    required this.packageId,
    required this.compositeSha256,
    this.manifestSha256,
  });

  final String packageId;
  final String compositeSha256;
  final String? manifestSha256;
}

/// Optional validation constraints and local catalog state.
final class RehearsalValidationOptions {
  const RehearsalValidationOptions({
    this.existingPackages = const [],
    this.availableStorageBytes,
    this.includeSourceCopy = false,
    this.maxChunkBytes = RehearsalLimitsV1.defaultMaxChunkBytes,
    this.maxMemoryBudgetBytes = RehearsalLimitsV1.defaultMaxMemoryBudgetBytes,
    this.cancellationToken,
    this.onProgress,
  });

  final List<ExistingRehearsalPackage> existingPackages;
  final int? availableStorageBytes;
  final bool includeSourceCopy;
  final int maxChunkBytes;
  final int maxMemoryBudgetBytes;
  final RehearsalCancellationToken? cancellationToken;
  final void Function(int processedBytes, int totalBytes)? onProgress;
}

/// Verified binary audio metadata extracted during header/tail inspection.
final class VerifiedAudioInfo {
  const VerifiedAudioInfo({
    required this.container,
    required this.codec,
    required this.sampleRate,
    required this.channels,
    this.bitsPerSample,
    required this.decodedFrames,
  });

  final String container;
  final String codec;
  final int sampleRate;
  final int channels;
  final int? bitsPerSample;
  final int decodedFrames;

  Map<String, Object?> toJson() => {
    'container': container,
    'codec': codec,
    'sampleRate': sampleRate,
    'channels': channels,
    if (bitsPerSample != null) 'bitsPerSample': bitsPerSample,
    'decodedFrames': decodedFrames,
  };
}

/// Verified ZIP entry summary produced during incremental validation.
final class VerifiedRehearsalEntry {
  const VerifiedRehearsalEntry({
    required this.path,
    required this.role,
    required this.stemId,
    required this.compressionMethod,
    required this.crc32,
    required this.sha256,
    required this.compressedBytes,
    required this.uncompressedBytes,
    this.audioInfo,
  });

  final String path;
  final String role;
  final String? stemId;
  final int compressionMethod;
  final int crc32;
  final String sha256;
  final int compressedBytes;
  final int uncompressedBytes;
  final VerifiedAudioInfo? audioInfo;

  Map<String, Object?> toJson() => {
    'role': role,
    if (stemId != null) 'stemId': stemId,
    'path': path,
    'compressionMethod': compressionMethod,
    'compressedBytes': compressedBytes,
    'uncompressedBytes': uncompressedBytes,
    'crc32': crc32,
    'sha256': sha256,
    if (audioInfo != null) 'audioInfo': audioInfo!.toJson(),
  };
}

/// Cryptographic identity derived from verified manifest and media entries.
final class RehearsalPackageIdentity {
  const RehearsalPackageIdentity({
    required this.packageId,
    required this.revision,
    required this.manifestSha256,
    required this.compositeSha256,
  });

  final String packageId;
  final int revision;
  final String manifestSha256;
  final String? compositeSha256;

  Map<String, Object?> toJson() => {
    'packageId': packageId,
    'revision': revision,
    'manifestSha256': manifestSha256,
    'compositeSha256': compositeSha256,
  };
}

/// Compact summary of validated v1 manifest metadata.
final class RehearsalManifestSummary {
  const RehearsalManifestSummary({
    required this.packageId,
    required this.revision,
    required this.createdAt,
    required this.displayName,
    required this.format,
    required this.formatVersion,
    required this.requiredFeatures,
    required this.sampleRate,
    required this.channels,
    required this.totalFrames,
    required this.durationSeconds,
    required this.includesOriginal,
    required this.stemIds,
  });

  final String packageId;
  final int revision;
  final String createdAt;
  final String displayName;
  final String format;
  final int formatVersion;
  final List<String> requiredFeatures;
  final int sampleRate;
  final int channels;
  final int totalFrames;
  final double durationSeconds;
  final bool includesOriginal;
  final List<String> stemIds;

  Map<String, Object?> toJson() => {
    'packageId': packageId,
    'revision': revision,
    'createdAt': createdAt,
    'displayName': displayName,
    'format': format,
    'formatVersion': formatVersion,
    'requiredFeatures': requiredFeatures,
    'sampleRate': sampleRate,
    'channels': channels,
    'totalFrames': totalFrames,
    'durationSeconds': durationSeconds,
    'includesOriginal': includesOriginal,
    'stemIds': stemIds,
  };
}

/// Resource consumption and storage reservation metrics recorded during validation.
final class RehearsalValidationBudget {
  const RehearsalValidationBudget({
    required this.compressedBytes,
    required this.declaredExtractedBytes,
    required this.actualExtractedBytes,
    required this.entryCount,
    required this.requiredFreeStorageBytes,
    required this.availableStorageBytes,
    required this.maxChunkBytes,
    required this.maxMemoryBudgetBytes,
    required this.peakWorkingMemoryBytes,
    required this.maxObservedSingleReadBytes,
  });

  final int compressedBytes;
  final int declaredExtractedBytes;
  final int actualExtractedBytes;
  final int entryCount;
  final int requiredFreeStorageBytes;
  final int? availableStorageBytes;
  final int maxChunkBytes;
  final int maxMemoryBudgetBytes;
  final int peakWorkingMemoryBytes;
  final int maxObservedSingleReadBytes;

  Map<String, Object?> toJson() => {
    'compressedBytes': compressedBytes,
    'declaredExtractedBytes': declaredExtractedBytes,
    'actualExtractedBytes': actualExtractedBytes,
    'entryCount': entryCount,
    'requiredFreeStorageBytes': requiredFreeStorageBytes,
    'availableStorageBytes': availableStorageBytes,
    'maxChunkBytes': maxChunkBytes,
    'maxMemoryBudgetBytes': maxMemoryBudgetBytes,
    'peakWorkingMemoryBytes': peakWorkingMemoryBytes,
    'maxObservedSingleReadBytes': maxObservedSingleReadBytes,
  };
}

/// Complete T7 validation result matching the TypeScript JSON contract.
final class RehearsalValidationResult {
  const RehearsalValidationResult({
    required this.status,
    required this.errorCode,
    required this.errorMessage,
    required this.idempotencyDisposition,
    required this.packageIdentity,
    required this.manifestSummary,
    required this.budget,
    required this.verifiedEntries,
  });

  final RehearsalValidationStatus status;
  final String? errorCode;
  final String? errorMessage;
  final String idempotencyDisposition;
  final RehearsalPackageIdentity? packageIdentity;
  final RehearsalManifestSummary? manifestSummary;
  final RehearsalValidationBudget budget;
  final List<VerifiedRehearsalEntry> verifiedEntries;

  String get format => RehearsalLimitsV1.format;
  int get formatVersion => RehearsalLimitsV1.formatVersion;
  bool get readyForPublication => status == RehearsalValidationStatus.valid;
  String get publicationState =>
      status == RehearsalValidationStatus.valid ? 'staged_validated' : 'rejected';
  bool get songVersionBindingAuthorized => false;

  Map<String, Object?> toJson() => {
    'format': format,
    'formatVersion': formatVersion,
    'status': status.wireName,
    'errorCode': errorCode,
    'errorMessage': errorMessage,
    'readyForPublication': readyForPublication,
    'publicationState': publicationState,
    'songVersionBindingAuthorized': songVersionBindingAuthorized,
    'idempotencyDisposition': idempotencyDisposition,
    'packageIdentity': packageIdentity?.toJson(),
    'manifestSummary': manifestSummary?.toJson(),
    'budget': budget.toJson(),
    'verifiedEntries': verifiedEntries.map((e) => e.toJson()).toList(),
  };
}

/// Incremental IEEE 802.3 CRC-32 calculator operating in O(1) memory.
final class IncrementalCrc32 {
  static final Uint32List _table = _buildTable();

  static Uint32List _buildTable() {
    final table = Uint32List(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) != 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  }

  int _crc = 0xFFFFFFFF;

  void update(List<int> bytes, [int start = 0, int? end]) {
    final limit = end ?? bytes.length;
    var crc = _crc;
    for (var i = start; i < limit; i++) {
      crc = _table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    _crc = crc;
  }

  int finalize() => (_crc ^ 0xFFFFFFFF) & 0xFFFFFFFF;

  static int compute(List<int> bytes) {
    final crc = IncrementalCrc32();
    crc.update(bytes);
    return crc.finalize();
  }
}

/// Incremental FIPS 180-4 SHA-256 state machine operating on 64-byte blocks in O(1) RAM.
final class IncrementalSha256 {
  static const List<int> _initialH = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];

  static const List<int> _k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  final Uint32List _h = Uint32List.fromList(_initialH);
  final Uint8List _block = Uint8List(64);
  final Uint32List _w = Uint32List(64);
  int _blockOffset = 0;
  int _totalBytes = 0;

  static int _rotr(int x, int n) =>
      ((x >>> n) | (x << (32 - n))) & 0xFFFFFFFF;

  void update(List<int> data, [int start = 0, int? end]) {
    var pos = start;
    final limit = end ?? data.length;
    final len = limit - start;
    if (len <= 0) return;
    _totalBytes += len;

    if (_blockOffset > 0) {
      final take = math.min(64 - _blockOffset, limit - pos);
      _block.setRange(_blockOffset, _blockOffset + take, data, pos);
      _blockOffset += take;
      pos += take;
      if (_blockOffset == 64) {
        _compress(_block, 0);
        _blockOffset = 0;
      }
    }

    while (pos + 64 <= limit) {
      _compress(data, pos);
      pos += 64;
    }

    if (pos < limit) {
      final rem = limit - pos;
      _block.setRange(0, rem, data, pos);
      _blockOffset = rem;
    }
  }

  void _compress(List<int> src, int offset) {
    final w = _w;
    for (var i = 0; i < 16; i++) {
      final j = offset + i * 4;
      w[i] =
          ((src[j] & 0xFF) << 24) |
          ((src[j + 1] & 0xFF) << 16) |
          ((src[j + 2] & 0xFF) << 8) |
          (src[j + 3] & 0xFF);
    }
    for (var i = 16; i < 64; i++) {
      final s0 =
          _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      final s1 =
          _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF;
    }

    var a = _h[0];
    var b = _h[1];
    var c = _h[2];
    var d = _h[3];
    var e = _h[4];
    var f = _h[5];
    var g = _h[6];
    var h = _h[7];

    for (var i = 0; i < 64; i++) {
      final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      final ch = (e & f) ^ ((~e) & g);
      final temp1 = (h + s1 + ch + _k[i] + w[i]) & 0xFFFFFFFF;
      final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      final maj = (a & b) ^ (a & c) ^ (b & c);
      final temp2 = (s0 + maj) & 0xFFFFFFFF;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & 0xFFFFFFFF;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & 0xFFFFFFFF;
    }

    _h[0] = (_h[0] + a) & 0xFFFFFFFF;
    _h[1] = (_h[1] + b) & 0xFFFFFFFF;
    _h[2] = (_h[2] + c) & 0xFFFFFFFF;
    _h[3] = (_h[3] + d) & 0xFFFFFFFF;
    _h[4] = (_h[4] + e) & 0xFFFFFFFF;
    _h[5] = (_h[5] + f) & 0xFFFFFFFF;
    _h[6] = (_h[6] + g) & 0xFFFFFFFF;
    _h[7] = (_h[7] + h) & 0xFFFFFFFF;
  }

  String digestHex() {
    final totalBitsHigh = (_totalBytes >>> 29) & 0xFFFFFFFF;
    final totalBitsLow = (_totalBytes << 3) & 0xFFFFFFFF;

    _block[_blockOffset++] = 0x80;
    if (_blockOffset > 56) {
      _block.fillRange(_blockOffset, 64, 0);
      _compress(_block, 0);
      _blockOffset = 0;
    }
    _block.fillRange(_blockOffset, 56, 0);

    _block[56] = (totalBitsHigh >>> 24) & 0xFF;
    _block[57] = (totalBitsHigh >>> 16) & 0xFF;
    _block[58] = (totalBitsHigh >>> 8) & 0xFF;
    _block[59] = totalBitsHigh & 0xFF;
    _block[60] = (totalBitsLow >>> 24) & 0xFF;
    _block[61] = (totalBitsLow >>> 16) & 0xFF;
    _block[62] = (totalBitsLow >>> 8) & 0xFF;
    _block[63] = totalBitsLow & 0xFF;
    _compress(_block, 0);

    final out = StringBuffer();
    for (var i = 0; i < 8; i++) {
      out.write(_h[i].toRadixString(16).padLeft(8, '0'));
    }
    return out.toString();
  }

  static String computeHex(List<int> bytes) {
    final sha = IncrementalSha256();
    sha.update(bytes);
    return sha.digestHex();
  }
}

const Set<String> _nestedArchiveExtensions = {
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
};

const Map<int, String> _unicodeDecompLower = {
  // U+00C0..U+00FF
  0x00C0: 'a\u0300', 0x00C1: 'a\u0301', 0x00C2: 'a\u0302', 0x00C3: 'a\u0303',
  0x00C4: 'a\u0308', 0x00C5: 'a\u030A', 0x00C6: '\u00E6', 0x00C7: 'c\u0327',
  0x00C8: 'e\u0300', 0x00C9: 'e\u0301', 0x00CA: 'e\u0302', 0x00CB: 'e\u0308',
  0x00CC: 'i\u0300', 0x00CD: 'i\u0301', 0x00CE: 'i\u0302', 0x00CF: 'i\u0308',
  0x00D0: '\u00F0', 0x00D1: 'n\u0303', 0x00D2: 'o\u0300', 0x00D3: 'o\u0301',
  0x00D4: 'o\u0302', 0x00D5: 'o\u0303', 0x00D6: 'o\u0308', 0x00D8: '\u00F8',
  0x00D9: 'u\u0300', 0x00DA: 'u\u0301', 0x00DB: 'u\u0302', 0x00DC: 'u\u0308',
  0x00DD: 'y\u0301', 0x00DE: '\u00FE',
  0x00E0: 'a\u0300', 0x00E1: 'a\u0301', 0x00E2: 'a\u0302', 0x00E3: 'a\u0303',
  0x00E4: 'a\u0308', 0x00E5: 'a\u030A', 0x00E7: 'c\u0327',
  0x00E8: 'e\u0300', 0x00E9: 'e\u0301', 0x00EA: 'e\u0302', 0x00EB: 'e\u0308',
  0x00EC: 'i\u0300', 0x00ED: 'i\u0301', 0x00EE: 'i\u0302', 0x00EF: 'i\u0308',
  0x00F1: 'n\u0303', 0x00F2: 'o\u0300', 0x00F3: 'o\u0301',
  0x00F4: 'o\u0302', 0x00F5: 'o\u0303', 0x00F6: 'o\u0308',
  0x00F9: 'u\u0300', 0x00FA: 'u\u0301', 0x00FB: 'u\u0302', 0x00FC: 'u\u0308',
  0x00FD: 'y\u0301', 0x00FF: 'y\u0308',
  // U+0100..U+017F
  0x0100: 'a\u0304', 0x0101: 'a\u0304', 0x0102: 'a\u0306', 0x0103: 'a\u0306',
  0x0104: 'a\u0328', 0x0105: 'a\u0328', 0x0106: 'c\u0301', 0x0107: 'c\u0301',
  0x0108: 'c\u0302', 0x0109: 'c\u0302', 0x010A: 'c\u0307', 0x010B: 'c\u0307',
  0x010C: 'c\u030C', 0x010D: 'c\u030C', 0x010E: 'd\u030C', 0x010F: 'd\u030C',
  0x0110: '\u0111', 0x0111: '\u0111',
  0x0112: 'e\u0304', 0x0113: 'e\u0304', 0x0114: 'e\u0306', 0x0115: 'e\u0306',
  0x0116: 'e\u0307', 0x0117: 'e\u0307', 0x0118: 'e\u0328', 0x0119: 'e\u0328',
  0x011A: 'e\u030C', 0x011B: 'e\u030C', 0x011C: 'g\u0302', 0x011D: 'g\u0302',
  0x011E: 'g\u0306', 0x011F: 'g\u0306', 0x0120: 'g\u0307', 0x0121: 'g\u0307',
  0x0122: 'g\u0327', 0x0123: 'g\u0327', 0x0124: 'h\u0302', 0x0125: 'h\u0302',
  0x0126: '\u0127', 0x0127: '\u0127',
  0x0128: 'i\u0303', 0x0129: 'i\u0303', 0x012A: 'i\u0304', 0x012B: 'i\u0304',
  0x012C: 'i\u0306', 0x012D: 'i\u0306', 0x012E: 'i\u0328', 0x012F: 'i\u0328',
  0x0130: 'i\u0307',
  0x0134: 'j\u0302', 0x0135: 'j\u0302', 0x0136: 'k\u0327', 0x0137: 'k\u0327',
  0x0139: 'l\u0301', 0x013A: 'l\u0301', 0x013B: 'l\u0327', 0x013C: 'l\u0327',
  0x013D: 'l\u030C', 0x013E: 'l\u030C', 0x013F: '\u0140', 0x0141: '\u0142',
  0x0143: 'n\u0301', 0x0144: 'n\u0301', 0x0145: 'n\u0327', 0x0146: 'n\u0327',
  0x0147: 'n\u030C', 0x0148: 'n\u030C',
  0x014C: 'o\u0304', 0x014D: 'o\u0304', 0x014E: 'o\u0306', 0x014F: 'o\u0306',
  0x0150: 'o\u030B', 0x0151: 'o\u030B', 0x0152: '\u0153',
  0x0154: 'r\u0301', 0x0155: 'r\u0301', 0x0156: 'r\u0327', 0x0157: 'r\u0327',
  0x0158: 'r\u030C', 0x0159: 'r\u030C', 0x015A: 's\u0301', 0x015B: 's\u0301',
  0x015C: 's\u0302', 0x015D: 's\u0302', 0x015E: 's\u0327', 0x015F: 's\u0327',
  0x0160: 's\u030C', 0x0161: 's\u030C', 0x0162: 't\u0327', 0x0163: 't\u0327',
  0x0164: 't\u030C', 0x0165: 't\u030C', 0x0166: '\u0167',
  0x0168: 'u\u0303', 0x0169: 'u\u0303', 0x016A: 'u\u0304', 0x016B: 'u\u0304',
  0x016C: 'u\u0306', 0x016D: 'u\u0306', 0x016E: 'u\u030A', 0x016F: 'u\u030A',
  0x0170: 'u\u030B', 0x0171: 'u\u030B', 0x0172: 'u\u0328', 0x0173: 'u\u0328',
  0x0174: 'w\u0302', 0x0175: 'w\u0302', 0x0176: 'y\u0302', 0x0177: 'y\u0302',
  0x0178: 'y\u0308', 0x0179: 'z\u0301', 0x017A: 'z\u0301',
  0x017B: 'z\u0307', 0x017C: 'z\u0307', 0x017D: 'z\u030C', 0x017E: 'z\u030C',
  // U+0180..U+024F (Latin Extended-B)
  0x01A0: 'o\u031B', 0x01A1: 'o\u031B', 0x01AF: 'u\u031B', 0x01B0: 'u\u031B',
  0x01CD: 'a\u030C', 0x01CE: 'a\u030C', 0x01CF: 'i\u030C', 0x01D0: 'i\u030C',
  0x01D1: 'o\u030C', 0x01D2: 'o\u030C', 0x01D3: 'u\u030C', 0x01D4: 'u\u030C',
  0x01D5: 'u\u0308\u0304', 0x01D6: 'u\u0308\u0304',
  0x01D7: 'u\u0308\u0301', 0x01D8: 'u\u0308\u0301',
  0x01D9: 'u\u0308\u030C', 0x01DA: 'u\u0308\u030C',
  0x01DB: 'u\u0308\u0300', 0x01DC: 'u\u0308\u0300',
  0x01DE: 'a\u0308\u0304', 0x01DF: 'a\u0308\u0304',
  0x01E0: 'a\u0307\u0304', 0x01E1: 'a\u0307\u0304',
  0x01E2: '\u00E6\u0304', 0x01E3: '\u00E6\u0304',
  0x01E6: 'g\u030C', 0x01E7: 'g\u030C', 0x01E8: 'k\u030C', 0x01E9: 'k\u030C',
  0x01EA: 'o\u0328', 0x01EB: 'o\u0328',
  0x01EC: 'o\u0328\u0304', 0x01ED: 'o\u0328\u0304',
  0x01EE: '\u0292\u030C', 0x01EF: '\u0292\u030C', 0x01F0: 'j\u030C',
  0x01F4: 'g\u0301', 0x01F5: 'g\u0301', 0x01F8: 'n\u0300', 0x01F9: 'n\u0300',
  0x01FA: 'a\u030A\u0301', 0x01FB: 'a\u030A\u0301',
  0x01FC: '\u00E6\u0301', 0x01FD: '\u00E6\u0301',
  0x01FE: '\u00F8\u0301', 0x01FF: '\u00F8\u0301',
  0x0200: 'a\u030F', 0x0201: 'a\u030F', 0x0202: 'a\u0311', 0x0203: 'a\u0311',
  0x0204: 'e\u030F', 0x0205: 'e\u030F', 0x0206: 'e\u0311', 0x0207: 'e\u0311',
  0x0208: 'i\u030F', 0x0209: 'i\u030F', 0x020A: 'i\u0311', 0x020B: 'i\u0311',
  0x020C: 'o\u030F', 0x020D: 'o\u030F', 0x020E: 'o\u0311', 0x020F: 'o\u0311',
  0x0210: 'r\u030F', 0x0211: 'r\u030F', 0x0212: 'r\u0311', 0x0213: 'r\u0311',
  0x0214: 'u\u030F', 0x0215: 'u\u030F', 0x0216: 'u\u0311', 0x0217: 'u\u0311',
  0x0218: 's\u0326', 0x0219: 's\u0326', 0x021A: 't\u0326', 0x021B: 't\u0326',
  0x021E: 'h\u030C', 0x021F: 'h\u030C', 0x0226: 'a\u0307', 0x0227: 'a\u0307',
  0x0228: 'e\u0327', 0x0229: 'e\u0327',
  0x022A: 'o\u0308\u0304', 0x022B: 'o\u0308\u0304',
  0x022C: 'o\u0303\u0304', 0x022D: 'o\u0303\u0304',
  0x022E: 'o\u0307', 0x022F: 'o\u0307',
  0x0230: 'o\u0307\u0304', 0x0231: 'o\u0307\u0304',
  0x0232: 'y\u0304', 0x0233: 'y\u0304',
  // U+0340..U+0344 (Combining Diacritical Marks canonical decompositions)
  0x0340: '\u0300', 0x0341: '\u0301', 0x0343: '\u0313', 0x0344: '\u0308\u0301',
  // U+0370..U+03FF (Greek and Coptic)
  0x0374: '\u02B9', 0x037E: ';', 0x0385: '\u00A8\u0301', 0x0386: '\u03B1\u0301',
  0x0387: '\u00B7', 0x0388: '\u03B5\u0301', 0x0389: '\u03B7\u0301', 0x038A: '\u03B9\u0301',
  0x038C: '\u03BF\u0301', 0x038E: '\u03C5\u0301', 0x038F: '\u03C9\u0301',
  0x0390: '\u03B9\u0308\u0301',
  0x03AA: '\u03B9\u0308', 0x03AB: '\u03C5\u0308', 0x03AC: '\u03B1\u0301', 0x03AD: '\u03B5\u0301',
  0x03AE: '\u03B7\u0301', 0x03AF: '\u03B9\u0301', 0x03B0: '\u03C5\u0308\u0301',
  0x03CA: '\u03B9\u0308', 0x03CB: '\u03C5\u0308', 0x03CC: '\u03BF\u0301',
  0x03CD: '\u03C5\u0301', 0x03CE: '\u03C9\u0301',
  0x03D3: '\u03D2\u0301', 0x03D4: '\u03D2\u0308',
  // U+0400..U+04FF (Cyrillic)
  0x0400: '\u0435\u0300', 0x0401: '\u0435\u0308', 0x0403: '\u0433\u0301', 0x0407: '\u0456\u0308',
  0x040C: '\u043A\u0301', 0x040D: '\u0438\u0300', 0x040E: '\u0443\u0306', 0x0419: '\u0438\u0306',
  0x0439: '\u0438\u0306', 0x0450: '\u0435\u0300', 0x0451: '\u0435\u0308', 0x0453: '\u0433\u0301',
  0x0457: '\u0456\u0308', 0x045C: '\u043A\u0301', 0x045D: '\u0438\u0300', 0x045E: '\u0443\u0306',
  0x0476: '\u0475\u030F', 0x0477: '\u0475\u030F', 0x04C1: '\u0436\u0306', 0x04C2: '\u0436\u0306',
  0x04D0: '\u0430\u0306', 0x04D1: '\u0430\u0306', 0x04D2: '\u0430\u0308', 0x04D3: '\u0430\u0308',
  0x04D6: '\u0435\u0306', 0x04D7: '\u0435\u0306', 0x04DA: '\u04D9\u0308', 0x04DB: '\u04D9\u0308',
  0x04DC: '\u0436\u0308', 0x04DD: '\u0436\u0308', 0x04DE: '\u0437\u0308', 0x04DF: '\u0437\u0308',
  0x04E2: '\u0438\u0304', 0x04E3: '\u0438\u0304', 0x04E4: '\u0438\u0308', 0x04E5: '\u0438\u0308',
  0x04E6: '\u043E\u0308', 0x04E7: '\u043E\u0308', 0x04EA: '\u04E9\u0308', 0x04EB: '\u04E9\u0308',
  0x04EC: '\u044D\u0308', 0x04ED: '\u044D\u0308', 0x04EE: '\u0443\u0304', 0x04EF: '\u0443\u0304',
  0x04F0: '\u0443\u0308', 0x04F1: '\u0443\u0308', 0x04F2: '\u0443\u030B', 0x04F3: '\u0443\u030B',
  0x04F4: '\u0447\u0308', 0x04F5: '\u0447\u0308', 0x04F8: '\u044B\u0308', 0x04F9: '\u044B\u0308',
  // U+1E00..U+1EFF (Latin Extended Additional)
  0x1E00: 'a\u0325', 0x1E01: 'a\u0325', 0x1E02: 'b\u0307', 0x1E03: 'b\u0307',
  0x1E04: 'b\u0323', 0x1E05: 'b\u0323', 0x1E06: 'b\u0331', 0x1E07: 'b\u0331',
  0x1E08: 'c\u0327\u0301', 0x1E09: 'c\u0327\u0301',
  0x1E0A: 'd\u0307', 0x1E0B: 'd\u0307', 0x1E0C: 'd\u0323', 0x1E0D: 'd\u0323',
  0x1E0E: 'd\u0331', 0x1E0F: 'd\u0331', 0x1E10: 'd\u0327', 0x1E11: 'd\u0327',
  0x1E12: 'd\u032D', 0x1E13: 'd\u032D',
  0x1E14: 'e\u0304\u0300', 0x1E15: 'e\u0304\u0300',
  0x1E16: 'e\u0304\u0301', 0x1E17: 'e\u0304\u0301',
  0x1E18: 'e\u032D', 0x1E19: 'e\u032D', 0x1E1A: 'e\u0330', 0x1E1B: 'e\u0330',
  0x1E1C: 'e\u0327\u0306', 0x1E1D: 'e\u0327\u0306',
  0x1E1E: 'f\u0307', 0x1E1F: 'f\u0307', 0x1E20: 'g\u0304', 0x1E21: 'g\u0304',
  0x1E22: 'h\u0307', 0x1E23: 'h\u0307', 0x1E24: 'h\u0323', 0x1E25: 'h\u0323',
  0x1E26: 'h\u0308', 0x1E27: 'h\u0308', 0x1E28: 'h\u0327', 0x1E29: 'h\u0327',
  0x1E2A: 'h\u032E', 0x1E2B: 'h\u032E', 0x1E2C: 'i\u0330', 0x1E2D: 'i\u0330',
  0x1E2E: 'i\u0308\u0301', 0x1E2F: 'i\u0308\u0301',
  0x1E30: 'k\u0301', 0x1E31: 'k\u0301', 0x1E32: 'k\u0323', 0x1E33: 'k\u0323',
  0x1E34: 'k\u0331', 0x1E35: 'k\u0331', 0x1E36: 'l\u0323', 0x1E37: 'l\u0323',
  0x1E38: 'l\u0323\u0304', 0x1E39: 'l\u0323\u0304',
  0x1E3A: 'l\u0331', 0x1E3B: 'l\u0331', 0x1E3C: 'l\u032D', 0x1E3D: 'l\u032D',
  0x1E3E: 'm\u0301', 0x1E3F: 'm\u0301', 0x1E40: 'm\u0307', 0x1E41: 'm\u0307',
  0x1E42: 'm\u0323', 0x1E43: 'm\u0323', 0x1E44: 'n\u0307', 0x1E45: 'n\u0307',
  0x1E46: 'n\u0323', 0x1E47: 'n\u0323', 0x1E48: 'n\u0331', 0x1E49: 'n\u0331',
  0x1E4A: 'n\u032D', 0x1E4B: 'n\u032D',
  0x1E4C: 'o\u0303\u0301', 0x1E4D: 'o\u0303\u0301',
  0x1E4E: 'o\u0303\u0308', 0x1E4F: 'o\u0303\u0308',
  0x1E50: 'o\u0304\u0300', 0x1E51: 'o\u0304\u0300',
  0x1E52: 'o\u0304\u0301', 0x1E53: 'o\u0304\u0301',
  0x1E54: 'p\u0301', 0x1E55: 'p\u0301', 0x1E56: 'p\u0307', 0x1E57: 'p\u0307',
  0x1E58: 'r\u0307', 0x1E59: 'r\u0307', 0x1E5A: 'r\u0323', 0x1E5B: 'r\u0323',
  0x1E5C: 'r\u0323\u0304', 0x1E5D: 'r\u0323\u0304',
  0x1E5E: 'r\u0331', 0x1E5F: 'r\u0331', 0x1E60: 's\u0307', 0x1E61: 's\u0307',
  0x1E62: 's\u0323', 0x1E63: 's\u0323',
  0x1E64: 's\u0301\u0307', 0x1E65: 's\u0301\u0307',
  0x1E66: 's\u030C\u0307', 0x1E67: 's\u030C\u0307',
  0x1E68: 's\u0323\u0307', 0x1E69: 's\u0323\u0307',
  0x1E6A: 't\u0307', 0x1E6B: 't\u0307', 0x1E6C: 't\u0323', 0x1E6D: 't\u0323',
  0x1E6E: 't\u0331', 0x1E6F: 't\u0331', 0x1E70: 't\u032D', 0x1E71: 't\u032D',
  0x1E72: 'u\u0324', 0x1E73: 'u\u0324', 0x1E74: 'u\u0330', 0x1E75: 'u\u0330',
  0x1E76: 'u\u032D', 0x1E77: 'u\u032D',
  0x1E78: 'u\u0303\u0301', 0x1E79: 'u\u0303\u0301',
  0x1E7A: 'u\u0304\u0308', 0x1E7B: 'u\u0304\u0308',
  0x1E7C: 'v\u0303', 0x1E7D: 'v\u0303', 0x1E7E: 'v\u0323', 0x1E7F: 'v\u0323',
  0x1E80: 'w\u0300', 0x1E81: 'w\u0300', 0x1E82: 'w\u0301', 0x1E83: 'w\u0301',
  0x1E84: 'w\u0308', 0x1E85: 'w\u0308', 0x1E86: 'w\u0307', 0x1E87: 'w\u0307',
  0x1E88: 'w\u0323', 0x1E89: 'w\u0323', 0x1E8A: 'x\u0307', 0x1E8B: 'x\u0307',
  0x1E8C: 'x\u0308', 0x1E8D: 'x\u0308', 0x1E8E: 'y\u0307', 0x1E8F: 'y\u0307',
  0x1E90: 'z\u0302', 0x1E91: 'z\u0302', 0x1E92: 'z\u0323', 0x1E93: 'z\u0323',
  0x1E94: 'z\u0331', 0x1E95: 'z\u0331', 0x1E96: 'h\u0331', 0x1E97: 't\u0308',
  0x1E98: 'w\u030A', 0x1E99: 'y\u030A', 0x1E9B: '\u017F\u0307',
  0x1EA0: 'a\u0323', 0x1EA1: 'a\u0323', 0x1EA2: 'a\u0309', 0x1EA3: 'a\u0309',
  0x1EA4: 'a\u0302\u0301', 0x1EA5: 'a\u0302\u0301',
  0x1EA6: 'a\u0302\u0300', 0x1EA7: 'a\u0302\u0300',
  0x1EA8: 'a\u0302\u0309', 0x1EA9: 'a\u0302\u0309',
  0x1EAA: 'a\u0302\u0303', 0x1EAB: 'a\u0302\u0303',
  0x1EAC: 'a\u0323\u0302', 0x1EAD: 'a\u0323\u0302',
  0x1EAE: 'a\u0306\u0301', 0x1EAF: 'a\u0306\u0301',
  0x1EB0: 'a\u0306\u0300', 0x1EB1: 'a\u0306\u0300',
  0x1EB2: 'a\u0306\u0309', 0x1EB3: 'a\u0306\u0309',
  0x1EB4: 'a\u0306\u0303', 0x1EB5: 'a\u0306\u0303',
  0x1EB6: 'a\u0323\u0306', 0x1EB7: 'a\u0323\u0306',
  0x1EB8: 'e\u0323', 0x1EB9: 'e\u0323', 0x1EBA: 'e\u0309', 0x1EBB: 'e\u0309',
  0x1EBC: 'e\u0303', 0x1EBD: 'e\u0303',
  0x1EBE: 'e\u0302\u0301', 0x1EBF: 'e\u0302\u0301',
  0x1EC0: 'e\u0302\u0300', 0x1EC1: 'e\u0302\u0300',
  0x1EC2: 'e\u0302\u0309', 0x1EC3: 'e\u0302\u0309',
  0x1EC4: 'e\u0302\u0303', 0x1EC5: 'e\u0302\u0303',
  0x1EC6: 'e\u0323\u0302', 0x1EC7: 'e\u0323\u0302',
  0x1EC8: 'i\u0309', 0x1EC9: 'i\u0309', 0x1ECA: 'i\u0323', 0x1ECB: 'i\u0323',
  0x1ECC: 'o\u0323', 0x1ECD: 'o\u0323', 0x1ECE: 'o\u0309', 0x1ECF: 'o\u0309',
  0x1ED0: 'o\u0302\u0301', 0x1ED1: 'o\u0302\u0301',
  0x1ED2: 'o\u0302\u0300', 0x1ED3: 'o\u0302\u0300',
  0x1ED4: 'o\u0302\u0309', 0x1ED5: 'o\u0302\u0309',
  0x1ED6: 'o\u0302\u0303', 0x1ED7: 'o\u0302\u0303',
  0x1ED8: 'o\u0323\u0302', 0x1ED9: 'o\u0323\u0302',
  0x1EDA: 'o\u031B\u0301', 0x1EDB: 'o\u031B\u0301',
  0x1EDC: 'o\u031B\u0300', 0x1EDD: 'o\u031B\u0300',
  0x1EDE: 'o\u031B\u0309', 0x1EDF: 'o\u031B\u0309',
  0x1EE0: 'o\u031B\u0303', 0x1EE1: 'o\u031B\u0303',
  0x1EE2: 'o\u031B\u0323', 0x1EE3: 'o\u031B\u0323',
  0x1EE4: 'u\u0323', 0x1EE5: 'u\u0323', 0x1EE6: 'u\u0309', 0x1EE7: 'u\u0309',
  0x1EE8: 'u\u031B\u0301', 0x1EE9: 'u\u031B\u0301',
  0x1EEA: 'u\u031B\u0300', 0x1EEB: 'u\u031B\u0300',
  0x1EEC: 'u\u031B\u0309', 0x1EED: 'u\u031B\u0309',
  0x1EEE: 'u\u031B\u0303', 0x1EEF: 'u\u031B\u0303',
  0x1EF0: 'u\u031B\u0323', 0x1EF1: 'u\u031B\u0323',
  0x1EF2: 'y\u0300', 0x1EF3: 'y\u0300', 0x1EF4: 'y\u0323', 0x1EF5: 'y\u0323',
  0x1EF6: 'y\u0309', 0x1EF7: 'y\u0309', 0x1EF8: 'y\u0303', 0x1EF9: 'y\u0303',
  // U+1F00..U+1FFF (Greek Extended)
  0x1F00: '\u03B1\u0313', 0x1F01: '\u03B1\u0314',
  0x1F02: '\u03B1\u0313\u0300', 0x1F03: '\u03B1\u0314\u0300',
  0x1F04: '\u03B1\u0313\u0301', 0x1F05: '\u03B1\u0314\u0301',
  0x1F06: '\u03B1\u0313\u0342', 0x1F07: '\u03B1\u0314\u0342',
  0x1F08: '\u03B1\u0313', 0x1F09: '\u03B1\u0314',
  0x1F0A: '\u03B1\u0313\u0300', 0x1F0B: '\u03B1\u0314\u0300',
  0x1F0C: '\u03B1\u0313\u0301', 0x1F0D: '\u03B1\u0314\u0301',
  0x1F0E: '\u03B1\u0313\u0342', 0x1F0F: '\u03B1\u0314\u0342',
  0x1F10: '\u03B5\u0313', 0x1F11: '\u03B5\u0314',
  0x1F12: '\u03B5\u0313\u0300', 0x1F13: '\u03B5\u0314\u0300',
  0x1F14: '\u03B5\u0313\u0301', 0x1F15: '\u03B5\u0314\u0301',
  0x1F18: '\u03B5\u0313', 0x1F19: '\u03B5\u0314',
  0x1F1A: '\u03B5\u0313\u0300', 0x1F1B: '\u03B5\u0314\u0300',
  0x1F1C: '\u03B5\u0313\u0301', 0x1F1D: '\u03B5\u0314\u0301',
  0x1F20: '\u03B7\u0313', 0x1F21: '\u03B7\u0314',
  0x1F22: '\u03B7\u0313\u0300', 0x1F23: '\u03B7\u0314\u0300',
  0x1F24: '\u03B7\u0313\u0301', 0x1F25: '\u03B7\u0314\u0301',
  0x1F26: '\u03B7\u0313\u0342', 0x1F27: '\u03B7\u0314\u0342',
  0x1F28: '\u03B7\u0313', 0x1F29: '\u03B7\u0314',
  0x1F2A: '\u03B7\u0313\u0300', 0x1F2B: '\u03B7\u0314\u0300',
  0x1F2C: '\u03B7\u0313\u0301', 0x1F2D: '\u03B7\u0314\u0301',
  0x1F2E: '\u03B7\u0313\u0342', 0x1F2F: '\u03B7\u0314\u0342',
  0x1F30: '\u03B9\u0313', 0x1F31: '\u03B9\u0314',
  0x1F32: '\u03B9\u0313\u0300', 0x1F33: '\u03B9\u0314\u0300',
  0x1F34: '\u03B9\u0313\u0301', 0x1F35: '\u03B9\u0314\u0301',
  0x1F36: '\u03B9\u0313\u0342', 0x1F37: '\u03B9\u0314\u0342',
  0x1F38: '\u03B9\u0313', 0x1F39: '\u03B9\u0314',
  0x1F3A: '\u03B9\u0313\u0300', 0x1F3B: '\u03B9\u0314\u0300',
  0x1F3C: '\u03B9\u0313\u0301', 0x1F3D: '\u03B9\u0314\u0301',
  0x1F3E: '\u03B9\u0313\u0342', 0x1F3F: '\u03B9\u0314\u0342',
  0x1F40: '\u03BF\u0313', 0x1F41: '\u03BF\u0314',
  0x1F42: '\u03BF\u0313\u0300', 0x1F43: '\u03BF\u0314\u0300',
  0x1F44: '\u03BF\u0313\u0301', 0x1F45: '\u03BF\u0314\u0301',
  0x1F48: '\u03BF\u0313', 0x1F49: '\u03BF\u0314',
  0x1F4A: '\u03BF\u0313\u0300', 0x1F4B: '\u03BF\u0314\u0300',
  0x1F4C: '\u03BF\u0313\u0301', 0x1F4D: '\u03BF\u0314\u0301',
  0x1F50: '\u03C5\u0313', 0x1F51: '\u03C5\u0314',
  0x1F52: '\u03C5\u0313\u0300', 0x1F53: '\u03C5\u0314\u0300',
  0x1F54: '\u03C5\u0313\u0301', 0x1F55: '\u03C5\u0314\u0301',
  0x1F56: '\u03C5\u0313\u0342', 0x1F57: '\u03C5\u0314\u0342',
  0x1F59: '\u03C5\u0314', 0x1F5B: '\u03C5\u0314\u0300',
  0x1F5D: '\u03C5\u0314\u0301', 0x1F5F: '\u03C5\u0314\u0342',
  0x1F60: '\u03C9\u0313', 0x1F61: '\u03C9\u0314',
  0x1F62: '\u03C9\u0313\u0300', 0x1F63: '\u03C9\u0314\u0300',
  0x1F64: '\u03C9\u0313\u0301', 0x1F65: '\u03C9\u0314\u0301',
  0x1F66: '\u03C9\u0313\u0342', 0x1F67: '\u03C9\u0314\u0342',
  0x1F68: '\u03C9\u0313', 0x1F69: '\u03C9\u0314',
  0x1F6A: '\u03C9\u0313\u0300', 0x1F6B: '\u03C9\u0314\u0300',
  0x1F6C: '\u03C9\u0313\u0301', 0x1F6D: '\u03C9\u0314\u0301',
  0x1F6E: '\u03C9\u0313\u0342', 0x1F6F: '\u03C9\u0314\u0342',
  0x1F70: '\u03B1\u0300', 0x1F71: '\u03B1\u0301', 0x1F72: '\u03B5\u0300', 0x1F73: '\u03B5\u0301',
  0x1F74: '\u03B7\u0300', 0x1F75: '\u03B7\u0301', 0x1F76: '\u03B9\u0300', 0x1F77: '\u03B9\u0301',
  0x1F78: '\u03BF\u0300', 0x1F79: '\u03BF\u0301', 0x1F7A: '\u03C5\u0300', 0x1F7B: '\u03C5\u0301',
  0x1F7C: '\u03C9\u0300', 0x1F7D: '\u03C9\u0301',
  0x1F80: '\u03B1\u0313\u0345', 0x1F81: '\u03B1\u0314\u0345',
  0x1F82: '\u03B1\u0313\u0300\u0345', 0x1F83: '\u03B1\u0314\u0300\u0345',
  0x1F84: '\u03B1\u0313\u0301\u0345', 0x1F85: '\u03B1\u0314\u0301\u0345',
  0x1F86: '\u03B1\u0313\u0342\u0345', 0x1F87: '\u03B1\u0314\u0342\u0345',
  0x1F88: '\u03B1\u0313\u0345', 0x1F89: '\u03B1\u0314\u0345',
  0x1F8A: '\u03B1\u0313\u0300\u0345', 0x1F8B: '\u03B1\u0314\u0300\u0345',
  0x1F8C: '\u03B1\u0313\u0301\u0345', 0x1F8D: '\u03B1\u0314\u0301\u0345',
  0x1F8E: '\u03B1\u0313\u0342\u0345', 0x1F8F: '\u03B1\u0314\u0342\u0345',
  0x1F90: '\u03B7\u0313\u0345', 0x1F91: '\u03B7\u0314\u0345',
  0x1F92: '\u03B7\u0313\u0300\u0345', 0x1F93: '\u03B7\u0314\u0300\u0345',
  0x1F94: '\u03B7\u0313\u0301\u0345', 0x1F95: '\u03B7\u0314\u0301\u0345',
  0x1F96: '\u03B7\u0313\u0342\u0345', 0x1F97: '\u03B7\u0314\u0342\u0345',
  0x1F98: '\u03B7\u0313\u0345', 0x1F99: '\u03B7\u0314\u0345',
  0x1F9A: '\u03B7\u0313\u0300\u0345', 0x1F9B: '\u03B7\u0314\u0300\u0345',
  0x1F9C: '\u03B7\u0313\u0301\u0345', 0x1F9D: '\u03B7\u0314\u0301\u0345',
  0x1F9E: '\u03B7\u0313\u0342\u0345', 0x1F9F: '\u03B7\u0314\u0342\u0345',
  0x1FA0: '\u03C9\u0313\u0345', 0x1FA1: '\u03C9\u0314\u0345',
  0x1FA2: '\u03C9\u0313\u0300\u0345', 0x1FA3: '\u03C9\u0314\u0300\u0345',
  0x1FA4: '\u03C9\u0313\u0301\u0345', 0x1FA5: '\u03C9\u0314\u0301\u0345',
  0x1FA6: '\u03C9\u0313\u0342\u0345', 0x1FA7: '\u03C9\u0314\u0342\u0345',
  0x1FA8: '\u03C9\u0313\u0345', 0x1FA9: '\u03C9\u0314\u0345',
  0x1FAA: '\u03C9\u0313\u0300\u0345', 0x1FAB: '\u03C9\u0314\u0300\u0345',
  0x1FAC: '\u03C9\u0313\u0301\u0345', 0x1FAD: '\u03C9\u0314\u0301\u0345',
  0x1FAE: '\u03C9\u0313\u0342\u0345', 0x1FAF: '\u03C9\u0314\u0342\u0345',
  0x1FB0: '\u03B1\u0306', 0x1FB1: '\u03B1\u0304',
  0x1FB2: '\u03B1\u0300\u0345', 0x1FB3: '\u03B1\u0345', 0x1FB4: '\u03B1\u0301\u0345',
  0x1FB6: '\u03B1\u0342', 0x1FB7: '\u03B1\u0342\u0345',
  0x1FB8: '\u03B1\u0306', 0x1FB9: '\u03B1\u0304',
  0x1FBA: '\u03B1\u0300', 0x1FBB: '\u03B1\u0301', 0x1FBC: '\u03B1\u0345',
  0x1FBE: '\u03B9', 0x1FC1: '\u00A8\u0342',
  0x1FC2: '\u03B7\u0300\u0345', 0x1FC3: '\u03B7\u0345', 0x1FC4: '\u03B7\u0301\u0345',
  0x1FC6: '\u03B7\u0342', 0x1FC7: '\u03B7\u0342\u0345',
  0x1FC8: '\u03B5\u0300', 0x1FC9: '\u03B5\u0301',
  0x1FCA: '\u03B7\u0300', 0x1FCB: '\u03B7\u0301', 0x1FCC: '\u03B7\u0345',
  0x1FCD: '\u1FBF\u0300', 0x1FCE: '\u1FBF\u0301', 0x1FCF: '\u1FBF\u0342',
  0x1FD0: '\u03B9\u0306', 0x1FD1: '\u03B9\u0304',
  0x1FD2: '\u03B9\u0308\u0300', 0x1FD3: '\u03B9\u0308\u0301',
  0x1FD6: '\u03B9\u0342', 0x1FD7: '\u03B9\u0308\u0342',
  0x1FD8: '\u03B9\u0306', 0x1FD9: '\u03B9\u0304',
  0x1FDA: '\u03B9\u0300', 0x1FDB: '\u03B9\u0301',
  0x1FDD: '\u1FFE\u0300', 0x1FDE: '\u1FFE\u0301', 0x1FDF: '\u1FFE\u0342',
  0x1FE0: '\u03C5\u0306', 0x1FE1: '\u03C5\u0304',
  0x1FE2: '\u03C5\u0308\u0300', 0x1FE3: '\u03C5\u0308\u0301',
  0x1FE4: '\u03C1\u0313', 0x1FE5: '\u03C1\u0314',
  0x1FE6: '\u03C5\u0342', 0x1FE7: '\u03C5\u0308\u0342',
  0x1FE8: '\u03C5\u0306', 0x1FE9: '\u03C5\u0304',
  0x1FEA: '\u03C5\u0300', 0x1FEB: '\u03C5\u0301', 0x1FEC: '\u03C1\u0314',
  0x1FED: '\u00A8\u0300', 0x1FEE: '\u00A8\u0301', 0x1FEF: '`',
  0x1FF2: '\u03C9\u0300\u0345', 0x1FF3: '\u03C9\u0345', 0x1FF4: '\u03C9\u0301\u0345',
  0x1FF6: '\u03C9\u0342', 0x1FF7: '\u03C9\u0342\u0345',
  0x1FF8: '\u03BF\u0300', 0x1FF9: '\u03BF\u0301',
  0x1FFA: '\u03C9\u0300', 0x1FFB: '\u03C9\u0301', 0x1FFC: '\u03C9\u0345',
  0x1FFD: '\u00B4',
};

const Set<int> _ccc220BelowMarks = {
  0x0339, 0x033A, 0x033B, 0x033C, 0x0347, 0x0348, 0x0349, 0x034D, 0x034E,
  0x0353, 0x0354, 0x0355, 0x0356, 0x0359, 0x035A, 0x1AB5, 0x1AB6, 0x1AB7,
  0x1AB8, 0x1AB9, 0x1ABA, 0x1ABD, 0x1ABF, 0x1AC0, 0x1AC3, 0x1AC4, 0x1ACA,
  0x1ADD, 0x1AE6, 0x1DC2, 0x1DCA, 0x1DCF, 0x1DF9, 0x1DFD, 0x1DFF, 0x20E8,
  0x20EC, 0x20ED, 0x20EE, 0x20EF,
};

bool _isCombiningMark(int cp) {
  if (cp >= 0x0300 && cp <= 0x036F) return cp != 0x034F;
  if (cp >= 0x1AB0 && cp <= 0x1AFF) return true;
  if (cp >= 0x1DC0 && cp <= 0x1DFF) return true;
  if (cp >= 0x20D0 && cp <= 0x20FF) {
    return (cp < 0x20DD || cp > 0x20E0) && (cp < 0x20E2 || cp > 0x20E4);
  }
  if (cp >= 0xFE20 && cp <= 0xFE2F) return true;
  return false;
}

int _combiningClass(int cp) {
  if ((cp >= 0x0334 && cp <= 0x0338) ||
      cp == 0x20D2 ||
      cp == 0x20D3 ||
      (cp >= 0x20D8 && cp <= 0x20DA) ||
      cp == 0x20E5 ||
      cp == 0x20E6 ||
      cp == 0x20EA ||
      cp == 0x20EB) {
    return 1;
  }
  if (cp == 0x0321 ||
      cp == 0x0322 ||
      cp == 0x0327 ||
      cp == 0x0328 ||
      cp == 0x1DD0) {
    return 202;
  }
  if (cp == 0x1DCE) return 214;
  if (cp == 0x031B) return 216;
  if (cp == 0x1DFA) return 218;
  if ((cp >= 0x0316 && cp <= 0x0319) ||
      (cp >= 0x031C && cp <= 0x0320) ||
      (cp >= 0x0323 && cp <= 0x0326) ||
      (cp >= 0x0329 && cp <= 0x0333) ||
      (cp >= 0xFE27 && cp <= 0xFE2D) ||
      _ccc220BelowMarks.contains(cp)) {
    return 220;
  }
  if (cp == 0x1DF7 || cp == 0x1DF8) return 228;
  if (cp == 0x0315 || cp == 0x031A || cp == 0x0358 || cp == 0x1DF6) {
    return 232;
  }
  if (cp == 0x035C || cp == 0x035F || cp == 0x0362 || cp == 0x1DFC) {
    return 233;
  }
  if (cp == 0x035D ||
      cp == 0x035E ||
      cp == 0x0360 ||
      cp == 0x0361 ||
      cp == 0x1AEB ||
      cp == 0x1DCD) {
    return 234;
  }
  if (cp == 0x0345) return 240;
  return 230;
}

/// Normalizes precomposed Latin (`U+00C0..U+024F`, `U+1E00..U+1EFF`),
/// Greek (`U+0370..U+03FF`, `U+1F00..U+1FFF`), Cyrillic (`U+0400..U+04FF`),
/// algorithmic Hangul syllables (`U+AC00..U+D7A3`), and Unicode combining
/// marks (`U+0300..U+036F`, `U+1AB0..U+1AFF`, `U+1DC0..U+1DFF`,
/// `U+20D0..U+20FF`, `U+FE20..U+FE2F`) + lowercase for collision detection.
String canonicalizeRehearsalPath(String input) {
  var current = input;
  for (var pass = 0; pass < 8; pass++) {
    final expanded = StringBuffer();
    var changed = false;
    for (final rune in current.runes) {
      if (rune >= 0xAC00 && rune <= 0xD7A3) {
        final sIndex = rune - 0xAC00;
        final l = 0x1100 + (sIndex ~/ 588);
        final v = 0x1161 + ((sIndex % 588) ~/ 28);
        final t = sIndex % 28;
        expanded.writeCharCode(l);
        expanded.writeCharCode(v);
        if (t != 0) {
          expanded.writeCharCode(0x11A7 + t);
        }
        changed = true;
      } else {
        final mapped = _unicodeDecompLower[rune];
        if (mapped != null) {
          expanded.write(mapped);
          if (mapped.runes.length != 1 || mapped.runes.first != rune) {
            changed = true;
          }
        } else if (rune >= 0x41 && rune <= 0x5A) {
          expanded.writeCharCode(rune + 0x20);
          changed = true;
        } else {
          final lower = String.fromCharCode(rune).toLowerCase();
          expanded.write(lower);
          if (lower.runes.length != 1 || lower.runes.first != rune) {
            changed = true;
          }
        }
      }
    }
    current = expanded.toString();
    if (!changed) break;
  }

  final out = StringBuffer();
  final marks = <int>[];
  void flushMarks() {
    if (marks.isEmpty) return;
    if (marks.length > 1) {
      marks.sort((a, b) {
        final ca = _combiningClass(a);
        final cb = _combiningClass(b);
        return ca != cb ? ca.compareTo(cb) : a.compareTo(b);
      });
    }
    for (final m in marks) {
      out.writeCharCode(m);
    }
    marks.clear();
  }

  for (final rune in current.runes) {
    if (_isCombiningMark(rune)) {
      marks.add(rune);
    } else {
      flushMarks();
      out.writeCharCode(rune);
    }
  }
  flushMarks();
  return out.toString();
}

bool _hasControlOrBidiChars(String value) {
  for (final rune in value.runes) {
    if (rune <= 0x1F || rune == 0x7F) return true;
    if ((rune >= 0x202A && rune <= 0x202E) ||
        (rune >= 0x2066 && rune <= 0x2069) ||
        rune == 0x200E ||
        rune == 0x200F ||
        rune == 0x061C) {
      return true;
    }
  }
  return false;
}

/// Returns `null` when safe, or `(status, errorCode, errorMessage)` on failure.
(RehearsalValidationStatus, String, String)? _validateRelativeEntryPath(
  String path,
) {
  if (path.isEmpty ||
      _hasControlOrBidiChars(path) ||
      path.contains('\\') ||
      path.contains(':') ||
      path.startsWith('/') ||
      path.endsWith('/') ||
      path.contains('//')) {
    return (
      RehearsalValidationStatus.corrupted,
      'PATH_TRAVERSAL_OR_UNSAFE_PATH',
      'Unsafe entry path rejected: $path',
    );
  }

  final segments = path.split('/');
  for (final seg in segments) {
    if (seg.isEmpty ||
        seg == '.' ||
        seg == '..' ||
        seg.trim() != seg ||
        seg.endsWith('.')) {
      return (
        RehearsalValidationStatus.corrupted,
        'PATH_TRAVERSAL_OR_UNSAFE_PATH',
        'Unsafe path segment in entry: $path',
      );
    }
  }

  if (segments.length > RehearsalLimitsV1.maxPathDepth) {
    return (
      RehearsalValidationStatus.corrupted,
      'PATH_DEPTH_EXCEEDED',
      'Entry path exceeds maximum depth of ${RehearsalLimitsV1.maxPathDepth}: $path',
    );
  }

  return null;
}

bool _hasNestedArchiveExtension(String path) {
  final lower = path.toLowerCase();
  for (final ext in _nestedArchiveExtensions) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

bool _hasNestedArchiveMagic(Uint8List head) {
  if (head.length >= 4 &&
      head[0] == 0x50 &&
      head[1] == 0x4B &&
      ((head[2] == 0x03 && head[3] == 0x04) ||
          (head[2] == 0x05 && head[3] == 0x06))) {
    return true;
  }
  if (head.length >= 2 && head[0] == 0x1F && head[1] == 0x8B) {
    return true;
  }
  if (head.length >= 6 &&
      head[0] == 0x37 &&
      head[1] == 0x7A &&
      head[2] == 0xBC &&
      head[3] == 0xAF &&
      head[4] == 0x27 &&
      head[5] == 0x1C) {
    return true;
  }
  return false;
}

const int _maxSafeInt = 0x1FFFFFFFFFFFFF;

int _u16le(Uint8List b, int o) => b[o] | (b[o + 1] << 8);
int _u32le(Uint8List b, int o) =>
    b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
int _u64le(Uint8List b, int o) {
  final lo = _u32le(b, o);
  final hi = _u32le(b, o + 4);
  if (hi > 0x1FFFFF) {
    return _maxSafeInt;
  }
  return (hi << 32) | lo;
}

int _u16be(Uint8List b, int o) => (b[o] << 8) | b[o + 1];
int _u24be(Uint8List b, int o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
int _u32be(Uint8List b, int o) =>
    (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
int _u64be(Uint8List b, int o) {
  final hi = _u32be(b, o);
  final lo = _u32be(b, o + 4);
  if (hi > 0x1FFFFF) {
    return _maxSafeInt;
  }
  return (hi << 32) | lo;
}

bool _asciiEquals(Uint8List b, int offset, String tag) {
  if (offset < 0 || offset + tag.length > b.length) return false;
  for (var i = 0; i < tag.length; i++) {
    if (b[offset + i] != tag.codeUnitAt(i)) return false;
  }
  return true;
}

final class _AudioInspectOutcome {
  const _AudioInspectOutcome.ok(this.info) : error = null;
  const _AudioInspectOutcome.err(this.error) : info = null;
  final VerifiedAudioInfo? info;
  final (RehearsalValidationStatus, String, String)? error;
}

_AudioInspectOutcome _inspectAudioHeaderAndTail({
  required String path,
  required bool isStem,
  required String container,
  required String codec,
  required int? declaredBitsPerSample,
  required int declaredSampleRate,
  required int declaredChannels,
  required int declaredDecodedFrames,
  required int totalBytes,
  required Uint8List head,
  required Uint8List tail,
}) {
  if (container == 'wav') {
    return _inspectWav(
      path: path,
      codec: codec,
      declaredBitsPerSample: declaredBitsPerSample,
      declaredSampleRate: declaredSampleRate,
      declaredChannels: declaredChannels,
      declaredDecodedFrames: declaredDecodedFrames,
      totalBytes: totalBytes,
      head: head,
    );
  }
  if (container == 'flac') {
    return _inspectFlac(
      path: path,
      declaredBitsPerSample: declaredBitsPerSample,
      declaredSampleRate: declaredSampleRate,
      declaredChannels: declaredChannels,
      declaredDecodedFrames: declaredDecodedFrames,
      totalBytes: totalBytes,
      head: head,
    );
  }
  if (container == 'ogg' && codec == 'opus') {
    return _inspectOggOpus(
      path: path,
      declaredSampleRate: declaredSampleRate,
      declaredChannels: declaredChannels,
      declaredDecodedFrames: declaredDecodedFrames,
      head: head,
      tail: tail,
    );
  }
  if (container == 'm4a') {
    return _inspectM4a(
      path: path,
      codec: codec,
      declaredSampleRate: declaredSampleRate,
      declaredChannels: declaredChannels,
      declaredDecodedFrames: declaredDecodedFrames,
      head: head,
      tail: tail,
    );
  }
  if (container == 'mp3' || codec == 'mp3') {
    if (isStem) {
      return _AudioInspectOutcome.err((
        RehearsalValidationStatus.unsupported,
        'UNSUPPORTED_CODEC',
        'MP3 codec is forbidden for stem entry: $path',
      ));
    }
    return _inspectMp3(
      path: path,
      declaredSampleRate: declaredSampleRate,
      declaredChannels: declaredChannels,
      declaredDecodedFrames: declaredDecodedFrames,
      totalBytes: totalBytes,
      head: head,
    );
  }

  return _AudioInspectOutcome.err((
    RehearsalValidationStatus.unsupported,
    'UNSUPPORTED_CODEC',
    'Unsupported audio container/codec ($container/$codec) for $path',
  ));
}

_AudioInspectOutcome _inspectWav({
  required String path,
  required String codec,
  required int? declaredBitsPerSample,
  required int declaredSampleRate,
  required int declaredChannels,
  required int declaredDecodedFrames,
  required int totalBytes,
  required Uint8List head,
}) {
  if (head.length < 44 ||
      !_asciiEquals(head, 0, 'RIFF') ||
      !_asciiEquals(head, 8, 'WAVE')) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid RIFF/WAVE header in $path',
    ));
  }
  final riffSize = _u32le(head, 4);
  if (riffSize < 36 || riffSize + 8 > totalBytes) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid RIFF chunk size in $path',
    ));
  }

  var pos = 12;
  int? audioFormat;
  int? channels;
  int? sampleRate;
  int? bitsPerSample;
  int? blockAlign;
  int? dataOffset;
  int? dataSize;

  while (pos + 8 <= head.length) {
    final chunkSize = _u32le(head, pos + 4);
    if (_asciiEquals(head, pos, 'fmt ')) {
      if (chunkSize < 16 || pos + 8 + 16 > head.length) {
        return _AudioInspectOutcome.err((
          RehearsalValidationStatus.corrupted,
          'CORRUPTED_AUDIO_HEADER',
          'Truncated WAV fmt chunk in $path',
        ));
      }
      audioFormat = _u16le(head, pos + 8);
      channels = _u16le(head, pos + 10);
      sampleRate = _u32le(head, pos + 12);
      blockAlign = _u16le(head, pos + 20);
      bitsPerSample = _u16le(head, pos + 22);
      if (audioFormat == 0xFFFE) {
        if (chunkSize < 40 || pos + 8 + 40 > head.length) {
          return _AudioInspectOutcome.err((
            RehearsalValidationStatus.corrupted,
            'CORRUPTED_AUDIO_HEADER',
            'Truncated extensible WAV fmt chunk in $path',
          ));
        }
        final subFormat = _u32le(head, pos + 32);
        if (subFormat != 1) {
          return _AudioInspectOutcome.err((
            RehearsalValidationStatus.unsupported,
            'UNSUPPORTED_CODEC',
            'Unsupported extensible WAV subformat in $path',
          ));
        }
      } else if (audioFormat != 1) {
        return _AudioInspectOutcome.err((
          RehearsalValidationStatus.unsupported,
          'UNSUPPORTED_CODEC',
          'Unsupported WAV audioFormat=$audioFormat in $path',
        ));
      }
    } else if (_asciiEquals(head, pos, 'data')) {
      dataOffset = pos + 8;
      dataSize = chunkSize;
      break;
    }

    final padded = chunkSize + (chunkSize.isOdd ? 1 : 0);
    pos += 8 + padded;
  }

  if (audioFormat == null ||
      channels == null ||
      sampleRate == null ||
      bitsPerSample == null ||
      blockAlign == null ||
      dataOffset == null ||
      dataSize == null) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Missing fmt or data chunk in WAV $path',
    ));
  }

  final expectedBits = codec == 'pcm_s24le' ? 24 : 16;
  if ((bitsPerSample != 16 && bitsPerSample != 24) ||
      bitsPerSample != expectedBits ||
      (declaredBitsPerSample != null && bitsPerSample != declaredBitsPerSample)) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'WAV bit depth mismatch in $path',
    ));
  }

  if (blockAlign != channels * (bitsPerSample ~/ 8)) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid WAV blockAlign in $path',
    ));
  }

  if (dataOffset + dataSize > totalBytes) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'WAV data chunk exceeds entry bounds in $path',
    ));
  }

  final actualFrames = blockAlign > 0 ? dataSize ~/ blockAlign : 0;
  if (sampleRate != declaredSampleRate ||
      channels != declaredChannels ||
      dataSize % blockAlign != 0 ||
      actualFrames != declaredDecodedFrames) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'WAV timeline mismatch in $path',
    ));
  }

  return _AudioInspectOutcome.ok(
    VerifiedAudioInfo(
      container: 'wav',
      codec: bitsPerSample == 24 ? 'pcm_s24le' : 'pcm_s16le',
      sampleRate: sampleRate,
      channels: channels,
      bitsPerSample: bitsPerSample,
      decodedFrames: actualFrames,
    ),
  );
}

_AudioInspectOutcome _inspectFlac({
  required String path,
  required int? declaredBitsPerSample,
  required int declaredSampleRate,
  required int declaredChannels,
  required int declaredDecodedFrames,
  required int totalBytes,
  required Uint8List head,
}) {
  if (totalBytes <= 42 || head.length < 42 || !_asciiEquals(head, 0, 'fLaC')) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid fLaC signature in $path',
    ));
  }
  final blockType = head[4] & 0x7F;
  final blockLen = _u24be(head, 5);
  if (blockType != 0 || blockLen != 34) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Missing or invalid FLAC STREAMINFO block in $path',
    ));
  }

  final minBlock = _u16be(head, 8);
  final maxBlock = _u16be(head, 10);
  if (minBlock < 16 || maxBlock < minBlock) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid FLAC block sizes in $path',
    ));
  }

  final sampleRate = (head[18] << 12) | (head[19] << 4) | (head[20] >>> 4);
  final channels = ((head[20] >>> 1) & 0x07) + 1;
  final bitsPerSample = (((head[20] & 0x01) << 4) | (head[21] >>> 4)) + 1;
  final totalSamples =
      ((head[21] & 0x0F) << 32) |
      (head[22] << 24) |
      (head[23] << 16) |
      (head[24] << 8) |
      head[25];

  if (bitsPerSample != 16 && bitsPerSample != 24) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.unsupported,
      'UNSUPPORTED_CODEC',
      'Unsupported FLAC bit depth $bitsPerSample in $path',
    ));
  }
  if (declaredBitsPerSample != null && bitsPerSample != declaredBitsPerSample) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'FLAC bit depth mismatch in $path',
    ));
  }

  if (sampleRate != declaredSampleRate ||
      channels != declaredChannels ||
      totalSamples != declaredDecodedFrames) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'FLAC timeline mismatch in $path',
    ));
  }

  return _AudioInspectOutcome.ok(
    VerifiedAudioInfo(
      container: 'flac',
      codec: 'flac',
      sampleRate: sampleRate,
      channels: channels,
      bitsPerSample: bitsPerSample,
      decodedFrames: totalSamples,
    ),
  );
}

_AudioInspectOutcome _inspectOggOpus({
  required String path,
  required int declaredSampleRate,
  required int declaredChannels,
  required int declaredDecodedFrames,
  required Uint8List head,
  required Uint8List tail,
}) {
  if (head.length < 48 ||
      !_asciiEquals(head, 0, 'OggS') ||
      head[4] != 0 ||
      (head[5] & 0x02) == 0) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid Ogg BOS page in $path',
    ));
  }

  final segCount1 = head[26];
  if (27 + segCount1 > head.length) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Truncated Ogg page 1 segment table in $path',
    ));
  }
  var payloadLen1 = 0;
  for (var i = 0; i < segCount1; i++) {
    payloadLen1 += head[27 + i];
  }
  final p1 = 27 + segCount1;
  if (payloadLen1 < 19 ||
      p1 + payloadLen1 > head.length ||
      !_asciiEquals(head, p1, 'OpusHead') ||
      head[p1 + 8] != 1) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid OpusHead packet in $path',
    ));
  }
  final channels = head[p1 + 9];
  final preSkip = _u16le(head, p1 + 10);
  final inputSampleRate = _u32le(head, p1 + 12);

  if (channels != declaredChannels) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'Opus channel count mismatch in $path',
    ));
  }
  if (inputSampleRate != 0 &&
      inputSampleRate != declaredSampleRate &&
      inputSampleRate != 48000) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'Opus inputSampleRate mismatch in $path: $inputSampleRate',
    ));
  }

  final p2Hdr = p1 + payloadLen1;
  if (p2Hdr + 27 > head.length ||
      !_asciiEquals(head, p2Hdr, 'OggS') ||
      head[p2Hdr + 4] != 0) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Missing Ogg OpusTags page in $path',
    ));
  }
  final segCount2 = head[p2Hdr + 26];
  final p2Payload = p2Hdr + 27 + segCount2;
  if (p2Payload + 8 > head.length || !_asciiEquals(head, p2Payload, 'OpusTags')) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid OpusTags packet in $path',
    ));
  }

  // Locate EOS page in tail.
  int? eosGranule;
  for (var off = tail.length - 27; off >= 0; off--) {
    if (tail[off] == 0x4F &&
        _asciiEquals(tail, off, 'OggS') &&
        tail[off + 4] == 0) {
      final segs = tail[off + 26];
      if (off + 27 + segs <= tail.length) {
        var pagePayload = 0;
        for (var i = 0; i < segs; i++) {
          pagePayload += tail[off + 27 + i];
        }
        if (off + 27 + segs + pagePayload <= tail.length &&
            (tail[off + 5] & 0x04) != 0) {
          final gHi = _u32le(tail, off + 10);
          eosGranule = (gHi & 0x80000000) != 0 ? -1 : _u64le(tail, off + 6);
          break;
        }
      }
    }
  }

  if (eosGranule == null || eosGranule < preSkip) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Missing or invalid Ogg Opus EOS granulePosition in $path',
    ));
  }

  final decoded48k = eosGranule - preSkip;
  final expected48k = (declaredDecodedFrames * 48000 / declaredSampleRate).round();
  if ((decoded48k - expected48k).abs() > 960) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'Ogg Opus timeline mismatch in $path',
    ));
  }

  return _AudioInspectOutcome.ok(
    VerifiedAudioInfo(
      container: 'ogg',
      codec: 'opus',
      sampleRate: declaredSampleRate,
      channels: channels,
      decodedFrames: declaredDecodedFrames,
    ),
  );
}

_AudioInspectOutcome _inspectM4a({
  required String path,
  required String codec,
  required int declaredSampleRate,
  required int declaredChannels,
  required int declaredDecodedFrames,
  required Uint8List head,
  required Uint8List tail,
}) {
  if (head.length < 24 || !_asciiEquals(head, 4, 'ftyp')) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid M4A ftyp header in $path',
    ));
  }
  final ftypSize = _u32be(head, 0);
  if (ftypSize < 16 || ftypSize > head.length) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Invalid M4A ftyp box size in $path',
    ));
  }

  int? mdhdTimescale;
  int? mdhdDuration;
  int? mp4aChannels;
  int? mp4aSampleRate;

  void scanBoxes(Uint8List buf, int start, int end) {
    var pos = start;
    while (pos + 8 <= end) {
      var boxSize = _u32be(buf, pos);
      final hdrLen = boxSize == 1 ? 16 : 8;
      if (boxSize == 1) {
        if (pos + 16 > end) break;
        boxSize = _u64be(buf, pos + 8);
      }
      if (boxSize < hdrLen || boxSize > end - pos) break;
      final contentStart = pos + hdrLen;
      final contentEnd = pos + boxSize;

      if (_asciiEquals(buf, pos + 4, 'moov') ||
          _asciiEquals(buf, pos + 4, 'trak') ||
          _asciiEquals(buf, pos + 4, 'mdia') ||
          _asciiEquals(buf, pos + 4, 'minf') ||
          _asciiEquals(buf, pos + 4, 'stbl')) {
        scanBoxes(buf, contentStart, contentEnd);
      } else if (_asciiEquals(buf, pos + 4, 'mdhd') &&
          contentStart + 20 <= contentEnd) {
        final version = buf[contentStart];
        if (version == 0 && contentStart + 20 <= contentEnd) {
          mdhdTimescale = _u32be(buf, contentStart + 12);
          mdhdDuration = _u32be(buf, contentStart + 16);
        } else if (version == 1 && contentStart + 32 <= contentEnd) {
          mdhdTimescale = _u32be(buf, contentStart + 20);
          mdhdDuration = _u64be(buf, contentStart + 24);
        }
      } else if (_asciiEquals(buf, pos + 4, 'stsd') &&
          contentStart + 8 <= contentEnd) {
        scanBoxes(buf, contentStart + 8, contentEnd);
      } else if (_asciiEquals(buf, pos + 4, 'mp4a') &&
          contentStart + 28 <= contentEnd) {
        mp4aChannels = _u16be(buf, contentStart + 16);
        mp4aSampleRate = _u32be(buf, contentStart + 24) >>> 16;
      }

      pos = contentEnd;
    }
  }

  scanBoxes(head, 0, head.length);
  if (mdhdTimescale == null || mp4aChannels == null) {
    for (var i = 0; i + 8 <= tail.length; i++) {
      if (_asciiEquals(tail, i + 4, 'moov')) {
        final moovSize = _u32be(tail, i);
        if (moovSize >= 8 && i + moovSize <= tail.length) {
          scanBoxes(tail, i, i + moovSize);
          break;
        }
      }
    }
  }

  if (mdhdTimescale == null ||
      mdhdTimescale == 0 ||
      mdhdDuration == null ||
      mp4aChannels == null ||
      mp4aSampleRate == null) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Missing moov/mdhd/mp4a atom in M4A $path',
    ));
  }

  final estimatedFrames =
      (mdhdDuration! * declaredSampleRate / mdhdTimescale!).round();
  final frameTolerance = (declaredSampleRate * 0.05).ceil();
  if (mp4aChannels != declaredChannels ||
      mp4aSampleRate != declaredSampleRate ||
      (estimatedFrames - declaredDecodedFrames).abs() > frameTolerance) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'M4A timeline mismatch in $path',
    ));
  }

  return _AudioInspectOutcome.ok(
    VerifiedAudioInfo(
      container: 'm4a',
      codec: codec,
      sampleRate: mp4aSampleRate!,
      channels: mp4aChannels!,
      decodedFrames: declaredDecodedFrames,
    ),
  );
}

_AudioInspectOutcome _inspectMp3({
  required String path,
  required int declaredSampleRate,
  required int declaredChannels,
  required int declaredDecodedFrames,
  required int totalBytes,
  required Uint8List head,
}) {
  if (head.length < 4) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Truncated MP3 header in $path',
    ));
  }

  var start = 0;
  if (_asciiEquals(head, 0, 'ID3')) {
    if (head.length < 10 || head[3] == 0xFF || head[4] == 0xFF) {
      return _AudioInspectOutcome.err((
        RehearsalValidationStatus.corrupted,
        'CORRUPTED_AUDIO_HEADER',
        'Truncated ID3v2 header in $path',
      ));
    }
    final tagSize =
        ((head[6] & 0x7F) << 21) |
        ((head[7] & 0x7F) << 14) |
        ((head[8] & 0x7F) << 7) |
        (head[9] & 0x7F);
    final hasFooter = (head[5] & 0x10) != 0;
    start = 10 + tagSize + (hasFooter ? 10 : 0);
    if (start >= totalBytes) {
      return _AudioInspectOutcome.err((
        RehearsalValidationStatus.corrupted,
        'CORRUPTED_AUDIO_HEADER',
        'Invalid ID3v2 size in $path',
      ));
    }
  }

  int? frameSampleRate;
  int? frameChannels;
  if (start + 4 <= head.length) {
    const mpeg1Rates = [44100, 48000, 32000];
    const mpeg2Rates = [22050, 24000, 16000];
    const mpeg25Rates = [11025, 12000, 8000];
    for (var i = start; i + 4 <= head.length; i++) {
      final b0 = head[i];
      final b1 = head[i + 1];
      if (b0 == 0xFF && (b1 & 0xE0) == 0xE0) {
        final version = (b1 >>> 3) & 0x03;
        final layer = (b1 >>> 1) & 0x03;
        final b2 = head[i + 2];
        final b3 = head[i + 3];
        final bitrateIdx = (b2 >>> 4) & 0x0F;
        final srIdx = (b2 >>> 2) & 0x03;
        final channelMode = (b3 >>> 6) & 0x03;
        if (version != 1 &&
            layer == 1 &&
            bitrateIdx >= 1 &&
            bitrateIdx <= 14 &&
            srIdx <= 2) {
          frameSampleRate = version == 3
              ? mpeg1Rates[srIdx]
              : version == 2
              ? mpeg2Rates[srIdx]
              : mpeg25Rates[srIdx];
          frameChannels = channelMode == 3 ? 1 : 2;
          break;
        }
      }
    }
  }

  if (frameSampleRate == null || frameChannels == null) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CORRUPTED_AUDIO_HEADER',
      'Missing valid MPEG Layer III frame sync in $path',
    ));
  }

  if (frameSampleRate != declaredSampleRate ||
      frameChannels != declaredChannels) {
    return _AudioInspectOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'MP3 timeline mismatch in $path',
    ));
  }

  return _AudioInspectOutcome.ok(
    VerifiedAudioInfo(
      container: 'mp3',
      codec: 'mp3',
      sampleRate: frameSampleRate,
      channels: frameChannels,
      decodedFrames: declaredDecodedFrames,
    ),
  );
}

final class _CdEntry {
  const _CdEntry({
    required this.path,
    required this.canonicalPath,
    required this.rawNameBytes,
    required this.flags,
    required this.compressionMethod,
    required this.crc32,
    required this.compressedSize,
    required this.uncompressedSize,
    required this.externalAttr,
    required this.localHeaderOffset,
    required this.dataOffset,
  });

  final String path;
  final String canonicalPath;
  final Uint8List rawNameBytes;
  final int flags;
  final int compressionMethod;
  final int crc32;
  final int compressedSize;
  final int uncompressedSize;
  final int externalAttr;
  final int localHeaderOffset;
  final int dataOffset;

  _CdEntry withDataOffset(int offset) => _CdEntry(
    path: path,
    canonicalPath: canonicalPath,
    rawNameBytes: rawNameBytes,
    flags: flags,
    compressionMethod: compressionMethod,
    crc32: crc32,
    compressedSize: compressedSize,
    uncompressedSize: uncompressedSize,
    externalAttr: externalAttr,
    localHeaderOffset: localHeaderOffset,
    dataOffset: offset,
  );
}

final class _ParsedMediaDecl {
  const _ParsedMediaDecl({
    required this.role,
    required this.stemId,
    required this.path,
    required this.container,
    required this.codec,
    required this.bitsPerSample,
    required this.byteLength,
    required this.sha256,
    required this.sampleRate,
    required this.channels,
    required this.decodedFrames,
  });

  final String role;
  final String? stemId;
  final String path;
  final String container;
  final String codec;
  final int? bitsPerSample;
  final int byteLength;
  final String sha256;
  final int sampleRate;
  final int channels;
  final int decodedFrames;
}

final class _ParsedManifest {
  const _ParsedManifest({
    required this.packageId,
    required this.revision,
    required this.createdAt,
    required this.displayName,
    required this.requiredFeatures,
    required this.sampleRate,
    required this.channels,
    required this.totalFrames,
    required this.stems,
    required this.original,
    required this.hasPractice,
  });

  final String packageId;
  final int revision;
  final String createdAt;
  final String displayName;
  final List<String> requiredFeatures;
  final int sampleRate;
  final int channels;
  final int totalFrames;
  final List<_ParsedMediaDecl> stems;
  final _ParsedMediaDecl? original;
  final bool hasPractice;
}

final class _ZipIndex {
  const _ZipIndex({
    required this.resolvedEntries,
    required this.cdSize,
    required this.declaredExtractedBytes,
  });

  final Map<String, _CdEntry> resolvedEntries;
  final int cdSize;
  final int declaredExtractedBytes;
}

final class _ZipIndexOutcome {
  const _ZipIndexOutcome.ok(this.index) : error = null;
  const _ZipIndexOutcome.err(this.error) : index = null;

  final _ZipIndex? index;
  final (RehearsalValidationStatus, String, String)? error;
}

Future<Uint8List> _readBoundedFromSource({
  required RehearsalByteSource source,
  required int offset,
  required int length,
  required int maxChunkBytes,
  required RehearsalCancellationToken? token,
  void Function(int sliceLength)? onSliceRead,
}) async {
  if (length == 0) return Uint8List(0);
  if (length <= maxChunkBytes) {
    if (token != null && token.isCancelled) {
      throw const _CancelledException();
    }
    final slice = await source.readSlice(offset, length);
    if (token != null && token.isCancelled) {
      throw const _CancelledException();
    }
    onSliceRead?.call(slice.length);
    if (slice.length != length) {
      throw const _TruncatedException();
    }
    return slice;
  }
  final out = Uint8List(length);
  var pos = 0;
  while (pos < length) {
    if (token != null && token.isCancelled) {
      throw const _CancelledException();
    }
    final take = math.min(maxChunkBytes, length - pos);
    final slice = await source.readSlice(offset + pos, take);
    onSliceRead?.call(slice.length);
    if (slice.length != take) {
      throw const _TruncatedException();
    }
    out.setRange(pos, pos + take, slice);
    pos += take;
  }
  return out;
}

Future<_ZipIndexOutcome> _readZipIndex({
  required int compressedBytes,
  required int maxChunkBytes,
  required int maxMemoryBudgetBytes,
  required Future<Uint8List> Function(int offset, int length) readBounded,
  required bool Function(int bytes) checkMemory,
  required RehearsalCancellationToken? token,
  void Function(int count)? onEntryCount,
}) async {
  // 1. Locate End of Central Directory (EOCD) scanning backwards in <= maxChunkBytes tail slices.
  final maxTailSearch = math.min(compressedBytes, 22 + 65535);
  if (checkMemory(maxTailSearch)) {
    return _ZipIndexOutcome.err((
      RehearsalValidationStatus.insufficientSpace,
      'MEMORY_BUDGET_EXCEEDED',
      'Working memory exceeds configured budget of $maxMemoryBudgetBytes bytes',
    ));
  }

  final tailStart = compressedBytes - maxTailSearch;
  final tailBytes = await readBounded(tailStart, maxTailSearch);

  var eocdRelOffset = -1;
  for (var i = tailBytes.length - 22; i >= 0; i--) {
    if (tailBytes[i] == 0x50 &&
        tailBytes[i + 1] == 0x4B &&
        tailBytes[i + 2] == 0x05 &&
        tailBytes[i + 3] == 0x06) {
      final commentLen = _u16le(tailBytes, i + 20);
      if (i + 22 + commentLen == tailBytes.length) {
        eocdRelOffset = i;
        break;
      }
    }
  }

  if (eocdRelOffset < 0) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_ZIP_ARCHIVE',
      'ZIP End of Central Directory not found',
    ));
  }

  final eocdOffset = tailStart + eocdRelOffset;
  final diskNumber = _u16le(tailBytes, eocdRelOffset + 4);
  final cdStartDisk = _u16le(tailBytes, eocdRelOffset + 6);
  final entriesOnDisk = _u16le(tailBytes, eocdRelOffset + 8);
  var totalEntries = _u16le(tailBytes, eocdRelOffset + 10);
  var cdSize = _u32le(tailBytes, eocdRelOffset + 12);
  var cdOffset = _u32le(tailBytes, eocdRelOffset + 16);

  if (diskNumber != 0 ||
      cdStartDisk != 0 ||
      entriesOnDisk != totalEntries) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_ZIP_ARCHIVE',
      'Multi-disk ZIP archives are not supported',
    ));
  }

  // Check optional ZIP64 EOCD Locator immediately before EOCD.
  var cdLimitOffset = eocdOffset;
  if (eocdOffset >= 20) {
    final locOffset = eocdOffset - 20;
    final locBytes = (locOffset >= tailStart)
        ? Uint8List.sublistView(
            tailBytes,
            locOffset - tailStart,
            locOffset - tailStart + 20,
          )
        : await readBounded(locOffset, 20);
    if (_u32le(locBytes, 0) == 0x07064B50) {
      final z64Disk = _u32le(locBytes, 4);
      final z64Offset = _u64le(locBytes, 8);
      final z64TotalDisks = _u32le(locBytes, 16);
      if (z64Disk != 0 || z64TotalDisks > 1) {
        return const _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_ZIP_ARCHIVE',
          'Multi-disk ZIP64 archives are not supported',
        ));
      }
      if (z64Offset < 0 || z64Offset > locOffset || 56 > locOffset - z64Offset) {
        return const _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'TRUNCATED_ARCHIVE',
          'ZIP64 EOCD offset out of bounds',
        ));
      }
      final z64Bytes = await readBounded(z64Offset, 56);
      if (_u32le(z64Bytes, 0) != 0x06064B50) {
        return const _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_ZIP_ARCHIVE',
          'Invalid ZIP64 EOCD signature',
        ));
      }
      final z64DiskNum = _u32le(z64Bytes, 16);
      final z64CdDisk = _u32le(z64Bytes, 20);
      final z64EntriesOnDisk = _u64le(z64Bytes, 24);
      final z64TotalEntries = _u64le(z64Bytes, 32);
      final z64CdSize = _u64le(z64Bytes, 40);
      final z64CdOffset = _u64le(z64Bytes, 48);
      if (z64DiskNum != 0 ||
          z64CdDisk != 0 ||
          z64EntriesOnDisk != z64TotalEntries) {
        return const _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_ZIP_ARCHIVE',
          'Multi-disk ZIP64 EOCD rejected',
        ));
      }
      totalEntries = z64TotalEntries;
      cdSize = z64CdSize;
      cdOffset = z64CdOffset;
      cdLimitOffset = z64Offset;
    } else if (totalEntries == 0xFFFF ||
        cdSize == 0xFFFFFFFF ||
        cdOffset == 0xFFFFFFFF) {
      return const _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'ZIP64 markers present without ZIP64 EOCD locator',
      ));
    }
  }

  if (totalEntries == 0) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'EMPTY_ARCHIVE',
      'ZIP archive contains zero entries',
    ));
  }

  if (totalEntries > RehearsalLimitsV1.maxEntries) {
    return _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'ENTRY_COUNT_LIMIT_EXCEEDED',
      'Archive entry count $totalEntries exceeds maximum ${RehearsalLimitsV1.maxEntries}',
    ));
  }
  onEntryCount?.call(totalEntries);

  if (cdOffset < 0 ||
      cdSize < 0 ||
      cdOffset > cdLimitOffset ||
      cdSize > cdLimitOffset - cdOffset) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'TRUNCATED_ARCHIVE',
      'Central Directory bounds exceed archive',
    ));
  }

  if (checkMemory(cdSize + maxChunkBytes)) {
    return _ZipIndexOutcome.err((
      RehearsalValidationStatus.insufficientSpace,
      'MEMORY_BUDGET_EXCEEDED',
      'Central Directory exceeds memory budget of $maxMemoryBudgetBytes bytes',
    ));
  }

  if (token != null && token.isCancelled) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.cancelled,
      'VALIDATION_CANCELLED',
      'Validation cancelled before Central Directory read',
    ));
  }

  // 2. Read and parse Central Directory records.
  final cdBytes = await readBounded(cdOffset, cdSize);
  final entries = <_CdEntry>[];
  final seenCanonical = <String>{};
  var cdPos = 0;
  var runningDeclaredBytes = 0;

  for (var i = 0; i < totalEntries; i++) {
    if (cdPos + 46 > cdBytes.length || _u32le(cdBytes, cdPos) != 0x02014B50) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'Malformed Central Directory entry #$i',
      ));
    }

    final flags = _u16le(cdBytes, cdPos + 8);
    final method = _u16le(cdBytes, cdPos + 10);
    final crc32 = _u32le(cdBytes, cdPos + 16);
    var compSize = _u32le(cdBytes, cdPos + 20);
    var uncompSize = _u32le(cdBytes, cdPos + 24);
    final nameLen = _u16le(cdBytes, cdPos + 28);
    final extraLen = _u16le(cdBytes, cdPos + 30);
    final commentLen = _u16le(cdBytes, cdPos + 32);
    var diskStart = _u16le(cdBytes, cdPos + 34);
    final externalAttr = _u32le(cdBytes, cdPos + 38);
    var lfhOffset = _u32le(cdBytes, cdPos + 42);

    final recordEnd = cdPos + 46 + nameLen + extraLen + commentLen;
    if (recordEnd > cdBytes.length) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'TRUNCATED_ARCHIVE',
        'Central Directory record #$i truncated',
      ));
    }

    final rawNameBytes = Uint8List.sublistView(
      cdBytes,
      cdPos + 46,
      cdPos + 46 + nameLen,
    );
    final extraBytes = Uint8List.sublistView(
      cdBytes,
      cdPos + 46 + nameLen,
      cdPos + 46 + nameLen + extraLen,
    );

    // Parse ZIP64 extra field (0x0001) if sentinel values exist.
    if (uncompSize == 0xFFFFFFFF ||
        compSize == 0xFFFFFFFF ||
        lfhOffset == 0xFFFFFFFF ||
        diskStart == 0xFFFF) {
      var ep = 0;
      while (ep + 4 <= extraBytes.length) {
        final hid = _u16le(extraBytes, ep);
        final hlen = _u16le(extraBytes, ep + 2);
        if (ep + 4 + hlen > extraBytes.length) break;
        if (hid == 0x0001) {
          var fp = ep + 4;
          if (uncompSize == 0xFFFFFFFF && fp + 8 <= ep + 4 + hlen) {
            uncompSize = _u64le(extraBytes, fp);
            fp += 8;
          }
          if (compSize == 0xFFFFFFFF && fp + 8 <= ep + 4 + hlen) {
            compSize = _u64le(extraBytes, fp);
            fp += 8;
          }
          if (lfhOffset == 0xFFFFFFFF && fp + 8 <= ep + 4 + hlen) {
            lfhOffset = _u64le(extraBytes, fp);
            fp += 8;
          }
          if (diskStart == 0xFFFF && fp + 4 <= ep + 4 + hlen) {
            diskStart = _u32le(extraBytes, fp);
          }
          break;
        }
        ep += 4 + hlen;
      }
    }

    if (diskStart != 0) {
      return const _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'Multi-disk entry rejected',
      ));
    }

    // Security check: encryption (bit 0, bit 6, or method 99).
    if ((flags & 0x0001) != 0 || (flags & 0x0040) != 0 || method == 99) {
      return const _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'ENCRYPTED_ENTRY_FORBIDDEN',
        'Encrypted ZIP entries are forbidden',
      ));
    }

    String rawName;
    try {
      rawName = utf8.decode(rawNameBytes, allowMalformed: false);
    } on FormatException {
      return const _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'PATH_TRAVERSAL_OR_UNSAFE_PATH',
        'Non-UTF-8 entry name rejected',
      ));
    }

    // Security check: directory, symlink, or POSIX special file.
    final posixType = (externalAttr >>> 16) & 0xF000;
    final isPosixSpecialOrSymlink =
        posixType == 0xA000 ||
        posixType == 0x4000 ||
        posixType == 0x1000 ||
        posixType == 0x2000 ||
        posixType == 0x6000 ||
        posixType == 0xC000;
    final isDosDirectory = (externalAttr & 0x10) != 0;
    if (rawName.endsWith('/') ||
        rawName.endsWith('\\') ||
        isDosDirectory ||
        isPosixSpecialOrSymlink) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'SPECIAL_FILE_OR_SYMLINK_FORBIDDEN',
        'Directory, symlink, or special file entry forbidden: $rawName',
      ));
    }

    final pathError = _validateRelativeEntryPath(rawName);
    if (pathError != null) {
      return _ZipIndexOutcome.err(pathError);
    }

    if (_hasNestedArchiveExtension(rawName)) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'NESTED_ARCHIVE_FORBIDDEN',
        'Nested archive extension forbidden: $rawName',
      ));
    }

    final canonical = canonicalizeRehearsalPath(rawName);
    if (!seenCanonical.add(canonical)) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'DUPLICATE_OR_COLLIDING_ENTRY',
        'Duplicate or Unicode/case-colliding ZIP entry: $rawName',
      ));
    }

    entries.add(
      _CdEntry(
        path: rawName,
        canonicalPath: canonical,
        rawNameBytes: rawNameBytes,
        flags: flags,
        compressionMethod: method,
        crc32: crc32,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
        externalAttr: externalAttr,
        localHeaderOffset: lfhOffset,
        dataOffset: 0,
      ),
    );

    runningDeclaredBytes += uncompSize;
    cdPos = recordEnd;
  }

  if (cdPos != cdBytes.length) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_ZIP_ARCHIVE',
      'Central Directory trailing garbage detected',
    ));
  }

  if (runningDeclaredBytes > RehearsalLimitsV1.maxExtractedBytes) {
    return _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'EXTRACTED_SIZE_LIMIT_EXCEEDED',
      'Declared extracted size $runningDeclaredBytes exceeds limit ${RehearsalLimitsV1.maxExtractedBytes}',
    ));
  }

  // Check manifest presence & compression rules & declared bomb ratios before reading entries.
  _CdEntry? manifestEntry;
  for (final entry in entries) {
    if (entry.path == 'manifest.json') {
      manifestEntry = entry;
    }
  }
  if (manifestEntry == null) {
    return const _ZipIndexOutcome.err((
      RehearsalValidationStatus.corrupted,
      'MISSING_MANIFEST',
      'Required root manifest.json is missing',
    ));
  }

  for (final entry in entries) {
    final isManifest = entry.path == 'manifest.json';
    if (isManifest) {
      if (entry.compressionMethod != 0 && entry.compressionMethod != 8) {
        return _ZipIndexOutcome.err((
          RehearsalValidationStatus.unsupported,
          'UNSUPPORTED_COMPRESSION_METHOD',
          'Unsupported compression method ${entry.compressionMethod} for manifest.json',
        ));
      }
      if (entry.uncompressedSize > RehearsalLimitsV1.maxManifestBytes) {
        return _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'MANIFEST_SIZE_LIMIT_EXCEEDED',
          'manifest.json size ${entry.uncompressedSize} exceeds ${RehearsalLimitsV1.maxManifestBytes} bytes',
        ));
      }
      if (entry.compressionMethod == 8) {
        if ((entry.compressedSize == 0 && entry.uncompressedSize > 0) ||
            entry.uncompressedSize >
                entry.compressedSize * RehearsalLimitsV1.maxCompressionRatio) {
          return const _ZipIndexOutcome.err((
            RehearsalValidationStatus.corrupted,
            'ZIP_BOMB_RATIO_EXCEEDED',
            'manifest.json declared compression ratio exceeds ${RehearsalLimitsV1.maxCompressionRatio}:1',
          ));
        }
      } else if (entry.compressedSize != entry.uncompressedSize) {
        return const _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'STORE entry manifest.json has mismatched compressed/uncompressed sizes',
        ));
      }
    } else {
      if (entry.compressionMethod != 0) {
        return _ZipIndexOutcome.err((
          RehearsalValidationStatus.unsupported,
          'UNSUPPORTED_COMPRESSION_METHOD',
          'Media/auxiliary entry ${entry.path} must use STORE (0), got ${entry.compressionMethod}',
        ));
      }
      if (entry.compressedSize != entry.uncompressedSize) {
        return _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'STORE entry ${entry.path} has mismatched compressed/uncompressed sizes',
        ));
      }
    }
  }

  // 3. Verify Local File Headers match CD and no physical ranges overlap.
  final sortedByOffset = List<_CdEntry>.from(entries)
    ..sort((a, b) => a.localHeaderOffset.compareTo(b.localHeaderOffset));

  final resolvedEntries = <String, _CdEntry>{};
  var prevDataEnd = 0;

  for (final entry in sortedByOffset) {
    if (token != null && token.isCancelled) {
      return const _ZipIndexOutcome.err((
        RehearsalValidationStatus.cancelled,
        'VALIDATION_CANCELLED',
        'Validation cancelled during Local File Header verification',
      ));
    }

    if (entry.localHeaderOffset < 0 ||
        entry.localHeaderOffset > cdOffset ||
        30 > cdOffset - entry.localHeaderOffset) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'TRUNCATED_ARCHIVE',
        'Local File Header out of bounds for ${entry.path}',
      ));
    }

    if (entry.localHeaderOffset < prevDataEnd) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'OVERLAPPING_ZIP_ENTRIES',
        'Overlapping ZIP entries detected near ${entry.path}',
      ));
    }

    final lfh = await readBounded(entry.localHeaderOffset, 30);
    if (_u32le(lfh, 0) != 0x04034B50) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'HEADER_MISMATCH',
        'Invalid Local File Header signature for ${entry.path}',
      ));
    }

    final lfhFlags = _u16le(lfh, 6);
    final lfhMethod = _u16le(lfh, 8);
    final lfhCrc = _u32le(lfh, 14);
    var lfhComp = _u32le(lfh, 18);
    var lfhUncomp = _u32le(lfh, 22);
    final lfhNameLen = _u16le(lfh, 26);
    final lfhExtraLen = _u16le(lfh, 28);

    final hasDataDescriptor = (lfhFlags & 0x08) != 0;
    if (lfhFlags != entry.flags ||
        lfhMethod != entry.compressionMethod ||
        lfhNameLen != entry.rawNameBytes.length) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'HEADER_MISMATCH',
        'LFH/CD flags, method, or filename length mismatch for ${entry.path}',
      ));
    }

    final varLen = lfhNameLen + lfhExtraLen;
    if (varLen > cdOffset - (entry.localHeaderOffset + 30)) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'TRUNCATED_ARCHIVE',
        'LFH filename/extra exceeds CD offset for ${entry.path}',
      ));
    }
    final dataOffset = entry.localHeaderOffset + 30 + varLen;

    final lfhVarBytes = varLen > 0
        ? await readBounded(entry.localHeaderOffset + 30, varLen)
        : Uint8List(0);
    for (var k = 0; k < lfhNameLen; k++) {
      if (lfhVarBytes[k] != entry.rawNameBytes[k]) {
        return _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'LFH/CD filename bytes mismatch for ${entry.path}',
        ));
      }
    }

    if (lfhComp == 0xFFFFFFFF || lfhUncomp == 0xFFFFFFFF) {
      final extraBytes = Uint8List.sublistView(lfhVarBytes, lfhNameLen);
      int? z64Uncomp;
      int? z64Comp;
      var ep = 0;
      while (ep + 4 <= extraBytes.length) {
        final hid = _u16le(extraBytes, ep);
        final hlen = _u16le(extraBytes, ep + 2);
        if (ep + 4 + hlen > extraBytes.length) break;
        if (hid == 0x0001) {
          var fp = ep + 4;
          if (lfhUncomp == 0xFFFFFFFF && fp + 8 <= ep + 4 + hlen) {
            z64Uncomp = _u64le(extraBytes, fp);
            fp += 8;
          }
          if (lfhComp == 0xFFFFFFFF && fp + 8 <= ep + 4 + hlen) {
            z64Comp = _u64le(extraBytes, fp);
          }
          break;
        }
        ep += 4 + hlen;
      }
      if (lfhUncomp == 0xFFFFFFFF) {
        if (z64Uncomp == null) {
          return _ZipIndexOutcome.err((
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'Missing LFH ZIP64 uncompressedSize extra field for ${entry.path}',
          ));
        }
        lfhUncomp = z64Uncomp;
      }
      if (lfhComp == 0xFFFFFFFF) {
        if (z64Comp == null) {
          return _ZipIndexOutcome.err((
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'Missing LFH ZIP64 compressedSize extra field for ${entry.path}',
          ));
        }
        lfhComp = z64Comp;
      }
    }

    if (!hasDataDescriptor || (lfhCrc != 0 || lfhComp != 0 || lfhUncomp != 0)) {
      if (lfhCrc != entry.crc32 ||
          lfhComp != entry.compressedSize ||
          lfhUncomp != entry.uncompressedSize) {
        return _ZipIndexOutcome.err((
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'LFH/CD CRC or size mismatch for ${entry.path}',
        ));
      }
    }

    if (entry.compressedSize < 0 ||
        entry.compressedSize > compressedBytes - dataOffset) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'TRUNCATED_ARCHIVE',
        'Entry payload truncated for ${entry.path}',
      ));
    }
    if (entry.compressedSize > cdOffset - dataOffset) {
      return _ZipIndexOutcome.err((
        RehearsalValidationStatus.corrupted,
        'OVERLAPPING_ZIP_ENTRIES',
        'Entry payload overlaps Central Directory for ${entry.path}',
      ));
    }
    final dataEnd = dataOffset + entry.compressedSize;

    prevDataEnd = dataEnd;
    resolvedEntries[entry.path] = entry.withDataOffset(dataOffset);
  }

  return _ZipIndexOutcome.ok(
    _ZipIndex(
      resolvedEntries: resolvedEntries,
      cdSize: cdSize,
      declaredExtractedBytes: runningDeclaredBytes,
    ),
  );
}

/// Validates a `.louvaio-rehearsal.zip` package incrementally against the T7 v1 contract.
Future<RehearsalValidationResult> validateRehearsalPackage(
  RehearsalByteSource source, {
  RehearsalValidationOptions options = const RehearsalValidationOptions(),
}) async {
  final maxChunkBytes = math.min(
    math.max(1, options.maxChunkBytes),
    RehearsalLimitsV1.defaultMaxChunkBytes,
  );
  final maxMemoryBudgetBytes = math.max(1, options.maxMemoryBudgetBytes);
  final token = options.cancellationToken;

  final compressedBytes = source.byteLength;
  var declaredExtractedBytes = 0;
  var actualExtractedBytes = 0;
  var entryCount = 0;
  var peakWorkingMemoryBytes = 0;
  var maxObservedSingleReadBytes = 0;
  final verifiedEntries = <VerifiedRehearsalEntry>[];
  RehearsalPackageIdentity? packageIdentity;
  RehearsalManifestSummary? manifestSummary;

  int computeRequiredStorage(int extracted) {
    final peak = (options.includeSourceCopy ? compressedBytes : 0) + extracted;
    final reserve = math.max(
      RehearsalLimitsV1.minFreeSpaceReserveBytes,
      (peak * RehearsalLimitsV1.minFreeSpaceReserveRatio).ceil(),
    );
    return peak + reserve;
  }

  RehearsalValidationBudget buildBudget() => RehearsalValidationBudget(
    compressedBytes: compressedBytes,
    declaredExtractedBytes: declaredExtractedBytes,
    actualExtractedBytes: actualExtractedBytes,
    entryCount: entryCount,
    requiredFreeStorageBytes: computeRequiredStorage(
      math.max(declaredExtractedBytes, actualExtractedBytes),
    ),
    availableStorageBytes: options.availableStorageBytes,
    maxChunkBytes: maxChunkBytes,
    maxMemoryBudgetBytes: maxMemoryBudgetBytes,
    peakWorkingMemoryBytes: peakWorkingMemoryBytes,
    maxObservedSingleReadBytes: maxObservedSingleReadBytes,
  );

  RehearsalValidationResult fail(
    RehearsalValidationStatus status,
    String errorCode,
    String errorMessage, {
    String idempotencyDisposition = 'not_applicable',
  }) {
    return RehearsalValidationResult(
      status: status,
      errorCode: errorCode,
      errorMessage: errorMessage,
      idempotencyDisposition: idempotencyDisposition,
      packageIdentity: packageIdentity,
      manifestSummary: manifestSummary,
      budget: buildBudget(),
      verifiedEntries: List<VerifiedRehearsalEntry>.unmodifiable(verifiedEntries),
    );
  }

  bool checkMemory(int currentBytes) {
    if (currentBytes > peakWorkingMemoryBytes) {
      peakWorkingMemoryBytes = currentBytes;
    }
    return peakWorkingMemoryBytes > maxMemoryBudgetBytes;
  }

  Future<Uint8List> readBounded(int offset, int length) => _readBoundedFromSource(
    source: source,
    offset: offset,
    length: length,
    maxChunkBytes: maxChunkBytes,
    token: token,
    onSliceRead: (sliceLen) {
      if (sliceLen > maxObservedSingleReadBytes) {
        maxObservedSingleReadBytes = sliceLen;
      }
    },
  );

  try {
    if (token != null && token.isCancelled) {
      return fail(
        RehearsalValidationStatus.cancelled,
        'VALIDATION_CANCELLED',
        'Validation cancelled before preflight',
      );
    }

    if (compressedBytes == 0) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'EMPTY_ARCHIVE',
        'Archive is empty (0 bytes)',
      );
    }

    if (compressedBytes > RehearsalLimitsV1.maxCompressedBytes) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'ARCHIVE_SIZE_LIMIT_EXCEEDED',
        'Archive exceeds maximum compressed limit of ${RehearsalLimitsV1.maxCompressedBytes} bytes',
      );
    }

    if (compressedBytes < 22) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'Archive smaller than minimum ZIP EOCD record',
      );
    }

    final indexOutcome = await _readZipIndex(
      compressedBytes: compressedBytes,
      maxChunkBytes: maxChunkBytes,
      maxMemoryBudgetBytes: maxMemoryBudgetBytes,
      readBounded: readBounded,
      checkMemory: checkMemory,
      token: token,
      onEntryCount: (count) => entryCount = count,
    );
    if (indexOutcome.error != null) {
      final err = indexOutcome.error!;
      return fail(err.$1, err.$2, err.$3);
    }

    final zipIndex = indexOutcome.index!;
    final cdSize = zipIndex.cdSize;
    final resolvedEntries = zipIndex.resolvedEntries;
    declaredExtractedBytes = zipIndex.declaredExtractedBytes;
    // 4. Preflight storage space check before streaming entries.
    final requiredStorage = computeRequiredStorage(declaredExtractedBytes);
    if (options.availableStorageBytes != null &&
        options.availableStorageBytes! < requiredStorage) {
      return fail(
        RehearsalValidationStatus.insufficientSpace,
        'INSUFFICIENT_STORAGE_SPACE',
        'Available storage ${options.availableStorageBytes} is below required $requiredStorage bytes',
      );
    }

    // 5. Stream & verify manifest.json (STORE or DEFLATE via RawZLibFilter).
    final resolvedManifest = resolvedEntries['manifest.json']!;
    final manifestResult = await _readAndVerifyManifestBytes(
      entry: resolvedManifest,
      readSlice: readBounded,
      maxChunkBytes: maxChunkBytes,
      maxMemoryBudgetBytes: maxMemoryBudgetBytes,
      cdSize: cdSize,
      checkMemory: checkMemory,
      token: token,
      onProgress: options.onProgress == null
          ? null
          : (manifestBytesProcessed) {
              options.onProgress!(
                math.min(manifestBytesProcessed, declaredExtractedBytes),
                declaredExtractedBytes,
              );
            },
    );

    if (manifestResult.error != null) {
      final err = manifestResult.error!;
      return fail(err.$1, err.$2, err.$3);
    }

    final manifestBytes = manifestResult.bytes!;
    final manifestSha256 = manifestResult.sha256!;
    actualExtractedBytes += manifestBytes.length;

    if (actualExtractedBytes > RehearsalLimitsV1.maxExtractedBytes) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'EXTRACTED_SIZE_LIMIT_EXCEEDED',
        'Actual extracted bytes exceeded limit',
      );
    }

    verifiedEntries.add(
      VerifiedRehearsalEntry(
        path: resolvedManifest.path,
        role: 'manifest',
        stemId: null,
        compressionMethod: resolvedManifest.compressionMethod,
        crc32: resolvedManifest.crc32,
        sha256: manifestSha256,
        compressedBytes: resolvedManifest.compressedSize,
        uncompressedBytes: manifestBytes.length,
      ),
    );

    // 6. Decode and validate manifest.json JSON schema & semantics.
    if (manifestBytes.length >= 3 &&
        manifestBytes[0] == 0xEF &&
        manifestBytes[1] == 0xBB &&
        manifestBytes[2] == 0xBF) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.json must be UTF-8 without BOM',
      );
    }

    final Object? decodedJson;
    try {
      final jsonText = utf8.decode(manifestBytes, allowMalformed: false);
      decodedJson = jsonDecode(jsonText);
    } on FormatException {
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.json is not valid UTF-8 JSON',
      );
    }

    if (decodedJson is! Map<String, dynamic>) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.json root must be a JSON object',
      );
    }

    final manifestOutcome = _validateManifestMap(decodedJson);
    if (manifestOutcome.error != null) {
      final err = manifestOutcome.error!;
      return fail(err.$1, err.$2, err.$3);
    }

    final manifest = manifestOutcome.manifest!;
    manifestSummary = RehearsalManifestSummary(
      packageId: manifest.packageId,
      revision: manifest.revision,
      createdAt: manifest.createdAt,
      displayName: manifest.displayName,
      format: RehearsalLimitsV1.format,
      formatVersion: RehearsalLimitsV1.formatVersion,
      requiredFeatures: List<String>.unmodifiable(manifest.requiredFeatures),
      sampleRate: manifest.sampleRate,
      channels: manifest.channels,
      totalFrames: manifest.totalFrames,
      durationSeconds: manifest.totalFrames / manifest.sampleRate,
      includesOriginal: manifest.original != null,
      stemIds: List<String>.unmodifiable(
        manifest.stems.map((s) => s.stemId!),
      ),
    );
    packageIdentity = RehearsalPackageIdentity(
      packageId: manifest.packageId,
      revision: manifest.revision,
      manifestSha256: manifestSha256,
      compositeSha256: null,
    );

    // 7. Cross-check declared entries vs ZIP Central Directory entries.
    final declaredPaths = <String>{'manifest.json'};
    final mediaToVerify = <_ParsedMediaDecl>[];

    for (final stem in manifest.stems) {
      if (declaredPaths.contains(stem.path)) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'DUPLICATE_OR_COLLIDING_ENTRY',
          'Duplicate declared media path in manifest: ${stem.path}',
        );
      }
      if (!resolvedEntries.containsKey(stem.path)) {
        return fail(
          RehearsalValidationStatus.incomplete,
          'MISSING_REQUIRED_STEM',
          'Stem ${stem.stemId} (${stem.path}) declared in manifest is missing in ZIP',
        );
      }
      declaredPaths.add(stem.path);
      mediaToVerify.add(stem);
    }

    if (manifest.original != null) {
      final orig = manifest.original!;
      if (declaredPaths.contains(orig.path)) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'DUPLICATE_OR_COLLIDING_ENTRY',
          'Duplicate declared media path in manifest: ${orig.path}',
        );
      }
      if (!resolvedEntries.containsKey(orig.path)) {
        return fail(
          RehearsalValidationStatus.incomplete,
          'MISSING_ORIGINAL_ENTRY',
          'Original entry ${orig.path} declared in manifest is missing in ZIP',
        );
      }
      declaredPaths.add(orig.path);
      mediaToVerify.add(orig);
    }

    for (final entryPath in resolvedEntries.keys) {
      if (!declaredPaths.contains(entryPath)) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'UNDECLARED_ZIP_ENTRY',
          'ZIP contains entry not declared in manifest: $entryPath',
        );
      }
    }

    // 8. Stream each media entry incrementally: CRC-32, SHA-256, nested magic, audio header/tail.
    for (final media in mediaToVerify) {
      if (token != null && token.isCancelled) {
        return fail(
          RehearsalValidationStatus.cancelled,
          'VALIDATION_CANCELLED',
          'Validation cancelled before verifying ${media.path}',
        );
      }

      if (checkMemory(
        cdSize + maxChunkBytes + (RehearsalLimitsV1.audioInspectionWindowBytes * 2),
      )) {
        return fail(
          RehearsalValidationStatus.insufficientSpace,
          'MEMORY_BUDGET_EXCEEDED',
          'Memory budget exceeded while inspecting ${media.path}',
        );
      }

      final zipEntry = resolvedEntries[media.path]!;
      if (zipEntry.uncompressedSize != media.byteLength) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'Manifest byteLength ${media.byteLength} disagrees with ZIP entry size ${zipEntry.uncompressedSize} for ${media.path}',
        );
      }

      final crc = IncrementalCrc32();
      final sha = IncrementalSha256();
      final headCap = math.min(
        zipEntry.uncompressedSize,
        RehearsalLimitsV1.audioInspectionWindowBytes,
      );
      final tailCap = math.min(
        zipEntry.uncompressedSize,
        RehearsalLimitsV1.audioInspectionWindowBytes,
      );
      final head = Uint8List(headCap);
      var headFilled = 0;
      final tail = Uint8List(tailCap);
      var tailPos = 0;
      var totalProcessed = 0;

      var offset = 0;
      while (offset < zipEntry.compressedSize) {
        if (token != null && token.isCancelled) {
          return fail(
            RehearsalValidationStatus.cancelled,
            'VALIDATION_CANCELLED',
            'Validation cancelled during streaming of ${media.path}',
          );
        }

        final take = math.min(maxChunkBytes, zipEntry.compressedSize - offset);
        final chunk = await readBounded(zipEntry.dataOffset + offset, take);
        if (chunk.length != take) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'TRUNCATED_ARCHIVE',
            'Unexpected EOF reading ${media.path}',
          );
        }

        if (offset == 0 && _hasNestedArchiveMagic(chunk)) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'NESTED_ARCHIVE_FORBIDDEN',
            'Nested archive magic bytes detected inside ${media.path}',
          );
        }

        crc.update(chunk);
        sha.update(chunk);

        if (headFilled < headCap) {
          final copyHead = math.min(headCap - headFilled, chunk.length);
          head.setRange(headFilled, headFilled + copyHead, chunk, 0);
          headFilled += copyHead;
        }

        if (tailCap > 0) {
          if (chunk.length >= tailCap) {
            tail.setRange(
              0,
              tailCap,
              chunk,
              chunk.length - tailCap,
            );
            tailPos = 0;
          } else {
            final firstPart = math.min(chunk.length, tailCap - tailPos);
            tail.setRange(tailPos, tailPos + firstPart, chunk, 0);
            final remaining = chunk.length - firstPart;
            if (remaining > 0) {
              tail.setRange(0, remaining, chunk, firstPart);
            }
            tailPos = (tailPos + chunk.length) % tailCap;
          }
        }

        offset += chunk.length;
        totalProcessed += chunk.length;
        actualExtractedBytes += chunk.length;

        if (actualExtractedBytes > RehearsalLimitsV1.maxExtractedBytes) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'EXTRACTED_SIZE_LIMIT_EXCEEDED',
            'Actual extracted bytes exceeded ${RehearsalLimitsV1.maxExtractedBytes}',
          );
        }

        options.onProgress?.call(
          math.min(actualExtractedBytes, declaredExtractedBytes),
          declaredExtractedBytes,
        );
      }

      if (totalProcessed != zipEntry.uncompressedSize) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'TRUNCATED_ARCHIVE',
          'Size mismatch reading ${media.path}',
        );
      }

      final actualCrc = crc.finalize();
      if (actualCrc != zipEntry.crc32) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'CRC_MISMATCH',
          'CRC-32 mismatch in ${media.path}',
        );
      }

      final actualSha = sha.digestHex();
      if (actualSha != media.sha256) {
        return fail(
          RehearsalValidationStatus.incomplete,
          'SHA256_MISMATCH',
          'SHA-256 mismatch in ${media.path}',
        );
      }

      final orderedTail = Uint8List(tailCap);
      if (tailCap > 0) {
        final firstLen = tailCap - tailPos;
        orderedTail.setRange(0, firstLen, tail, tailPos);
        if (tailPos > 0) {
          orderedTail.setRange(firstLen, tailCap, tail, 0);
        }
      }

      final audioOutcome = _inspectAudioHeaderAndTail(
        path: media.path,
        isStem: media.role == 'stem',
        container: media.container,
        codec: media.codec,
        declaredBitsPerSample: media.bitsPerSample,
        declaredSampleRate: media.sampleRate,
        declaredChannels: media.channels,
        declaredDecodedFrames: media.decodedFrames,
        totalBytes: totalProcessed,
        head: head,
        tail: orderedTail,
      );
      if (audioOutcome.error != null) {
        final err = audioOutcome.error!;
        return fail(err.$1, err.$2, err.$3);
      }

      verifiedEntries.add(
        VerifiedRehearsalEntry(
          path: media.path,
          role: media.role,
          stemId: media.stemId,
          compressionMethod: zipEntry.compressionMethod,
          crc32: actualCrc,
          sha256: actualSha,
          compressedBytes: zipEntry.compressedSize,
          uncompressedBytes: totalProcessed,
          audioInfo: audioOutcome.info,
        ),
      );
    }

    // 9. Compute compositeSha256 and evaluate idempotency/conflict disposition.
    final mediaSorted = verifiedEntries
        .where((e) => e.role != 'manifest')
        .toList()
      ..sort((a, b) => a.path.compareTo(b.path));

    final compositeBuf = StringBuffer('$manifestSha256\n');
    for (final entry in mediaSorted) {
      compositeBuf.write(
        '${entry.role}:${entry.path}:${entry.sha256}:${entry.uncompressedBytes}\n',
      );
    }
    final compositeSha256 = IncrementalSha256.computeHex(
      utf8.encode(compositeBuf.toString()),
    );

    packageIdentity = RehearsalPackageIdentity(
      packageId: manifest.packageId,
      revision: manifest.revision,
      manifestSha256: manifestSha256,
      compositeSha256: compositeSha256,
    );

    for (final existing in options.existingPackages) {
      if (existing.packageId.toLowerCase() == manifest.packageId) {
        final sameComposite =
            existing.compositeSha256.toLowerCase() == compositeSha256;
        final sameManifest =
            existing.manifestSha256 == null ||
            existing.manifestSha256!.toLowerCase() == manifestSha256;
        if (sameComposite && sameManifest) {
          return RehearsalValidationResult(
            status: RehearsalValidationStatus.valid,
            errorCode: null,
            errorMessage: null,
            idempotencyDisposition: 'idempotent_noop',
            packageIdentity: packageIdentity,
            manifestSummary: manifestSummary,
            budget: buildBudget(),
            verifiedEntries: List<VerifiedRehearsalEntry>.unmodifiable(
              verifiedEntries,
            ),
          );
        }
        return fail(
          RehearsalValidationStatus.conflict,
          'PACKAGE_IDENTITY_CONFLICT',
          'Package ${manifest.packageId} already exists with a different content hash',
          idempotencyDisposition: 'conflict_detected',
        );
      }
    }

    return RehearsalValidationResult(
      status: RehearsalValidationStatus.valid,
      errorCode: null,
      errorMessage: null,
      idempotencyDisposition: 'new_package',
      packageIdentity: packageIdentity,
      manifestSummary: manifestSummary,
      budget: buildBudget(),
      verifiedEntries: List<VerifiedRehearsalEntry>.unmodifiable(verifiedEntries),
    );
  } on _CancelledException {
    return fail(
      RehearsalValidationStatus.cancelled,
      'VALIDATION_CANCELLED',
      'Validation cancelled by caller',
    );
  } on _TruncatedException {
    return fail(
      RehearsalValidationStatus.corrupted,
      'TRUNCATED_ARCHIVE',
      'Unexpected end of byte source',
    );
  }
}

/// Two-phase bounded validation and verified entry extraction helper.
///
/// Phase 1 executes [validateRehearsalPackage] completely without calling
/// [openTargetSink]. If `validation.readyForPublication` is `false`, Phase 1's
/// result is returned immediately with zero target writes.
///
/// Phase 2 re-reads the ZIP directory and local file headers in bounded slices
/// (`<= options.maxChunkBytes`), opens one target [IOSink] per entry in
/// `validation.verifiedEntries` via [openTargetSink] (closing it in `finally`),
/// streams decompressed bytes (`STORE` or `DEFLATE` for `manifest.json`) while
/// re-verifying CRC-32, SHA-256, and exact byte length, and flushes/closes each
/// sink.
///
/// Fails closed by returning a rejected [RehearsalValidationResult] on
/// cancellation, archive corruption/mutation, or hash/CRC/size mismatch, and
/// rethrows [FileSystemException] (such as `ENOSPC`) or sink I/O errors so
/// callers can perform atomic staging rollback.
Future<RehearsalValidationResult> validateAndExtractRehearsalPackage(
  RehearsalByteSource source, {
  required RehearsalValidationOptions options,
  required Future<IOSink> Function(VerifiedRehearsalEntry entry) openTargetSink,
  void Function(int extractedBytes, int totalBytes)? onExtractProgress,
}) async {
  // Phase 1: Full validation before any target sink is opened.
  final validation = await validateRehearsalPackage(source, options: options);
  if (!validation.readyForPublication) {
    return validation;
  }

  final maxChunkBytes = math.min(
    math.max(1, options.maxChunkBytes),
    RehearsalLimitsV1.defaultMaxChunkBytes,
  );
  final maxMemoryBudgetBytes = math.max(1, options.maxMemoryBudgetBytes);
  final token = options.cancellationToken;
  final compressedBytes = source.byteLength;
  var peakWorkingMemoryBytes = validation.budget.peakWorkingMemoryBytes;
  var maxObservedSingleReadBytes =
      validation.budget.maxObservedSingleReadBytes;

  final totalExtractBytes = validation.verifiedEntries.fold<int>(
    0,
    (sum, entry) => sum + entry.uncompressedBytes,
  );
  var extractedBytes = 0;

  RehearsalValidationResult failExtraction(
    RehearsalValidationStatus status,
    String errorCode,
    String errorMessage,
  ) {
    return RehearsalValidationResult(
      status: status,
      errorCode: errorCode,
      errorMessage: errorMessage,
      idempotencyDisposition: 'not_applicable',
      packageIdentity: validation.packageIdentity,
      manifestSummary: validation.manifestSummary,
      budget: RehearsalValidationBudget(
        compressedBytes: compressedBytes,
        declaredExtractedBytes: validation.budget.declaredExtractedBytes,
        actualExtractedBytes: extractedBytes,
        entryCount: validation.budget.entryCount,
        requiredFreeStorageBytes: validation.budget.requiredFreeStorageBytes,
        availableStorageBytes: options.availableStorageBytes,
        maxChunkBytes: maxChunkBytes,
        maxMemoryBudgetBytes: maxMemoryBudgetBytes,
        peakWorkingMemoryBytes: peakWorkingMemoryBytes,
        maxObservedSingleReadBytes: maxObservedSingleReadBytes,
      ),
      verifiedEntries: validation.verifiedEntries,
    );
  }

  bool checkMemory(int currentBytes) {
    if (currentBytes > peakWorkingMemoryBytes) {
      peakWorkingMemoryBytes = currentBytes;
    }
    return peakWorkingMemoryBytes > maxMemoryBudgetBytes;
  }

  Future<Uint8List> readBounded(int offset, int length) => _readBoundedFromSource(
    source: source,
    offset: offset,
    length: length,
    maxChunkBytes: maxChunkBytes,
    token: token,
    onSliceRead: (sliceLen) {
      if (sliceLen > maxObservedSingleReadBytes) {
        maxObservedSingleReadBytes = sliceLen;
      }
    },
  );

  try {
    if (token != null && token.isCancelled) {
      return failExtraction(
        RehearsalValidationStatus.cancelled,
        'VALIDATION_CANCELLED',
        'Extraction cancelled before start',
      );
    }

    if (compressedBytes < 22 ||
        compressedBytes > RehearsalLimitsV1.maxCompressedBytes) {
      return failExtraction(
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'Archive size invalid during extraction',
      );
    }

    final indexOutcome = await _readZipIndex(
      compressedBytes: compressedBytes,
      maxChunkBytes: maxChunkBytes,
      maxMemoryBudgetBytes: maxMemoryBudgetBytes,
      readBounded: readBounded,
      checkMemory: checkMemory,
      token: token,
    );
    if (indexOutcome.error != null) {
      final err = indexOutcome.error!;
      return failExtraction(err.$1, err.$2, err.$3);
    }

    final resolvedEntries = indexOutcome.index!.resolvedEntries;

    for (final entry in validation.verifiedEntries) {
      if (token != null && token.isCancelled) {
        return failExtraction(
          RehearsalValidationStatus.cancelled,
          'VALIDATION_CANCELLED',
          'Extraction cancelled before ${entry.path}',
        );
      }

      final zipEntry = resolvedEntries[entry.path];
      if (zipEntry == null ||
          zipEntry.compressionMethod != entry.compressionMethod ||
          zipEntry.crc32 != entry.crc32 ||
          zipEntry.compressedSize != entry.compressedBytes ||
          zipEntry.uncompressedSize != entry.uncompressedBytes) {
        return failExtraction(
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'Archive entry changed or missing during extraction: ${entry.path}',
        );
      }

      final sink = await openTargetSink(entry);
      var closed = false;
      try {
        final crc = IncrementalCrc32();
        final sha = IncrementalSha256();
        var entryWritten = 0;

        void recordAndWriteChunk(List<int> bytes) {
          if (bytes.isEmpty) return;
          entryWritten += bytes.length;
          if (entryWritten > entry.uncompressedBytes) {
            throw _ValidationAbort(
              RehearsalValidationStatus.corrupted,
              'HEADER_MISMATCH',
              'Extracted bytes exceeded declared size for ${entry.path}',
            );
          }
          if (entry.path == 'manifest.json' &&
              entry.compressionMethod == 8 &&
              ((entry.compressedBytes == 0 && entryWritten > 0) ||
                  entryWritten >
                      entry.compressedBytes *
                          RehearsalLimitsV1.maxCompressionRatio ||
                  entryWritten > RehearsalLimitsV1.maxManifestBytes)) {
            throw const _ValidationAbort(
              RehearsalValidationStatus.corrupted,
              'ZIP_BOMB_RATIO_EXCEEDED',
              'manifest.json inflate stream exceeded safety limits during extraction',
            );
          }
          crc.update(bytes);
          sha.update(bytes);
          sink.add(bytes);
          extractedBytes += bytes.length;
          onExtractProgress?.call(extractedBytes, totalExtractBytes);
        }

        if (zipEntry.compressionMethod == 0) {
          var off = 0;
          while (off < zipEntry.compressedSize) {
            if (token != null && token.isCancelled) {
              throw const _CancelledException();
            }
            final take = math.min(maxChunkBytes, zipEntry.compressedSize - off);
            final chunk = await readBounded(zipEntry.dataOffset + off, take);
            recordAndWriteChunk(chunk);
            off += chunk.length;
          }
        } else if (entry.path == 'manifest.json' &&
            zipEntry.compressionMethod == 8) {
          final inflater = RawZLibFilter.inflateFilter(raw: true);
          final deflateSliceBytes = math.min(4096, maxChunkBytes);

          void feedInflate(List<int> input) {
            try {
              inflater.process(input, 0, input.length);
            } on FormatException {
              throw const _ValidationAbort(
                RehearsalValidationStatus.corrupted,
                'INVALID_ZIP_ARCHIVE',
                'Corrupted DEFLATE stream in manifest.json during extraction',
              );
            } on IOException {
              throw const _ValidationAbort(
                RehearsalValidationStatus.corrupted,
                'INVALID_ZIP_ARCHIVE',
                'Corrupted DEFLATE stream in manifest.json during extraction',
              );
            }
          }

          List<int>? pullInflate({required bool flush}) {
            try {
              return inflater.processed(flush: flush);
            } on FormatException {
              throw const _ValidationAbort(
                RehearsalValidationStatus.corrupted,
                'INVALID_ZIP_ARCHIVE',
                'Corrupted DEFLATE stream in manifest.json during extraction',
              );
            } on IOException {
              throw const _ValidationAbort(
                RehearsalValidationStatus.corrupted,
                'INVALID_ZIP_ARCHIVE',
                'Corrupted DEFLATE stream in manifest.json during extraction',
              );
            }
          }

          var off = 0;
          while (off < zipEntry.compressedSize) {
            if (token != null && token.isCancelled) {
              throw const _CancelledException();
            }
            final take = math.min(
              deflateSliceBytes,
              zipEntry.compressedSize - off,
            );
            final chunk = await readBounded(zipEntry.dataOffset + off, take);
            feedInflate(chunk);
            while (true) {
              if (token != null && token.isCancelled) {
                throw const _CancelledException();
              }
              final out = pullInflate(flush: false);
              if (out == null) break;
              recordAndWriteChunk(out);
            }
            off += chunk.length;
          }
          while (true) {
            if (token != null && token.isCancelled) {
              throw const _CancelledException();
            }
            final out = pullInflate(flush: true);
            if (out == null) break;
            recordAndWriteChunk(out);
          }
        } else {
          return failExtraction(
            RehearsalValidationStatus.unsupported,
            'UNSUPPORTED_COMPRESSION_METHOD',
            'Unsupported compression method ${zipEntry.compressionMethod} for ${entry.path}',
          );
        }

        if (entryWritten != entry.uncompressedBytes) {
          return failExtraction(
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'Extracted byte count mismatch for ${entry.path}',
          );
        }
        if (crc.finalize() != entry.crc32) {
          return failExtraction(
            RehearsalValidationStatus.corrupted,
            'CRC_MISMATCH',
            'CRC-32 mismatch extracting ${entry.path}',
          );
        }
        if (sha.digestHex() != entry.sha256) {
          return failExtraction(
            RehearsalValidationStatus.incomplete,
            'SHA256_MISMATCH',
            'SHA-256 mismatch extracting ${entry.path}',
          );
        }

        await sink.flush();
        await sink.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await sink.close();
          } catch (_) {
            // Preserve original exception or fail-closed result.
          }
        }
      }
    }

    return validation;
  } on _ValidationAbort catch (abort) {
    return failExtraction(abort.status, abort.errorCode, abort.errorMessage);
  } on _CancelledException {
    return failExtraction(
      RehearsalValidationStatus.cancelled,
      'VALIDATION_CANCELLED',
      'Extraction cancelled by caller',
    );
  } on _TruncatedException {
    return failExtraction(
      RehearsalValidationStatus.corrupted,
      'TRUNCATED_ARCHIVE',
      'Unexpected end of byte source during extraction',
    );
  }
}

final class _CancelledException implements Exception {
  const _CancelledException();
}

final class _TruncatedException implements Exception {
  const _TruncatedException();
}

final class _ManifestReadOutcome {
  const _ManifestReadOutcome.ok(this.bytes, this.sha256) : error = null;
  const _ManifestReadOutcome.err(this.error) : bytes = null, sha256 = null;

  final Uint8List? bytes;
  final String? sha256;
  final (RehearsalValidationStatus, String, String)? error;
}

Future<_ManifestReadOutcome> _readAndVerifyManifestBytes({
  required _CdEntry entry,
  required Future<Uint8List> Function(int offset, int length) readSlice,
  required int maxChunkBytes,
  required int maxMemoryBudgetBytes,
  required int cdSize,
  required bool Function(int bytes) checkMemory,
  required RehearsalCancellationToken? token,
  void Function(int processedBytes)? onProgress,
}) async {
  if (token != null && token.isCancelled) {
    return const _ManifestReadOutcome.err((
      RehearsalValidationStatus.cancelled,
      'VALIDATION_CANCELLED',
      'Validation cancelled before reading manifest.json',
    ));
  }

  final builder = BytesBuilder(copy: false);
  final crc = IncrementalCrc32();
  final sha = IncrementalSha256();
  var uncompressedTotal = 0;
  var checkedMagic = false;

  void consumeUncompressed(List<int> chunk) {
    if (chunk.isEmpty) return;
    if (!checkedMagic) {
      checkedMagic = true;
      final head = chunk is Uint8List ? chunk : Uint8List.fromList(chunk);
      if (_hasNestedArchiveMagic(head)) {
        throw const _ValidationAbort(
          RehearsalValidationStatus.corrupted,
          'NESTED_ARCHIVE_FORBIDDEN',
          'Nested archive magic bytes detected in manifest.json',
        );
      }
    }
    uncompressedTotal += chunk.length;
    if (entry.compressionMethod == 8 &&
        ((entry.compressedSize == 0 && uncompressedTotal > 0) ||
            uncompressedTotal >
                entry.compressedSize * RehearsalLimitsV1.maxCompressionRatio)) {
      throw const _ValidationAbort(
        RehearsalValidationStatus.corrupted,
        'ZIP_BOMB_RATIO_EXCEEDED',
        'manifest.json inflate stream exceeded ${RehearsalLimitsV1.maxCompressionRatio}:1 ratio',
      );
    }
    if (uncompressedTotal > RehearsalLimitsV1.maxManifestBytes) {
      throw const _ValidationAbort(
        RehearsalValidationStatus.corrupted,
        'MANIFEST_SIZE_LIMIT_EXCEEDED',
        'manifest.json uncompressed stream exceeded ${RehearsalLimitsV1.maxManifestBytes} bytes',
      );
    }
    if (checkMemory(cdSize + maxChunkBytes + uncompressedTotal)) {
      throw _ValidationAbort(
        RehearsalValidationStatus.insufficientSpace,
        'MEMORY_BUDGET_EXCEEDED',
        'Memory budget of $maxMemoryBudgetBytes bytes exceeded reading manifest.json',
      );
    }
    crc.update(chunk);
    sha.update(chunk);
    builder.add(chunk);
    onProgress?.call(uncompressedTotal);
  }

  try {
    if (entry.compressionMethod == 0) {
      if (checkMemory(cdSize + maxChunkBytes + entry.uncompressedSize)) {
        return _ManifestReadOutcome.err((
          RehearsalValidationStatus.insufficientSpace,
          'MEMORY_BUDGET_EXCEEDED',
          'Memory budget of $maxMemoryBudgetBytes bytes exceeded for manifest.json',
        ));
      }
      var off = 0;
      while (off < entry.compressedSize) {
        if (token != null && token.isCancelled) {
          throw const _CancelledException();
        }
        final take = math.min(maxChunkBytes, entry.compressedSize - off);
        final chunk = await readSlice(entry.dataOffset + off, take);
        if (chunk.length != take) throw const _TruncatedException();
        consumeUncompressed(chunk);
        off += chunk.length;
      }
    } else {
      final inflater = RawZLibFilter.inflateFilter(raw: true);
      final deflateSliceBytes = math.min(4096, maxChunkBytes);
      var off = 0;
      while (off < entry.compressedSize) {
        if (token != null && token.isCancelled) {
          throw const _CancelledException();
        }
        final take = math.min(deflateSliceBytes, entry.compressedSize - off);
        final chunk = await readSlice(entry.dataOffset + off, take);
        if (chunk.length != take) throw const _TruncatedException();
        inflater.process(chunk, 0, chunk.length);
        while (true) {
          if (token != null && token.isCancelled) {
            throw const _CancelledException();
          }
          final out = inflater.processed(flush: false);
          if (out == null) break;
          consumeUncompressed(out);
        }
        off += chunk.length;
      }
      while (true) {
        if (token != null && token.isCancelled) {
          throw const _CancelledException();
        }
        final out = inflater.processed(flush: true);
        if (out == null) break;
        consumeUncompressed(out);
      }
    }
  } on _ValidationAbort catch (abort) {
    return _ManifestReadOutcome.err((
      abort.status,
      abort.errorCode,
      abort.errorMessage,
    ));
  } on FormatException {
    return const _ManifestReadOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_ZIP_ARCHIVE',
      'Corrupted DEFLATE stream in manifest.json',
    ));
  } on IOException {
    return const _ManifestReadOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_ZIP_ARCHIVE',
      'Corrupted DEFLATE stream in manifest.json',
    ));
  }

  if (uncompressedTotal != entry.uncompressedSize) {
    return const _ManifestReadOutcome.err((
      RehearsalValidationStatus.corrupted,
      'HEADER_MISMATCH',
      'manifest.json uncompressed stream size disagrees with ZIP header',
    ));
  }

  if (crc.finalize() != entry.crc32) {
    return const _ManifestReadOutcome.err((
      RehearsalValidationStatus.corrupted,
      'CRC_MISMATCH',
      'CRC-32 mismatch in manifest.json',
    ));
  }

  return _ManifestReadOutcome.ok(builder.takeBytes(), sha.digestHex());
}

final class _ValidationAbort implements Exception {
  const _ValidationAbort(this.status, this.errorCode, this.errorMessage);
  final RehearsalValidationStatus status;
  final String errorCode;
  final String errorMessage;
}

final class _ManifestValidationOutcome {
  const _ManifestValidationOutcome.ok(this.manifest) : error = null;
  const _ManifestValidationOutcome.err(this.error) : manifest = null;

  final _ParsedManifest? manifest;
  final (RehearsalValidationStatus, String, String)? error;
}

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final RegExp _sha256Pattern = RegExp(r'^[0-9a-f]{64}$');
final RegExp _isoTzPattern = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$',
);

String? _findForbiddenAuthorityField(Object? node) {
  if (node is Map) {
    for (final entry in node.entries) {
      final key = entry.key.toString();
      if (RehearsalLimitsV1.forbiddenAuthorityFields.contains(key)) {
        return key;
      }
      final nested = _findForbiddenAuthorityField(entry.value);
      if (nested != null) return nested;
    }
  } else if (node is List) {
    for (final item in node) {
      final nested = _findForbiddenAuthorityField(item);
      if (nested != null) return nested;
    }
  }
  return null;
}

bool _isSupportedMediaCombo(String container, String codec, {required bool isOriginal}) {
  if (container == 'wav' && (codec == 'pcm_s16le' || codec == 'pcm_s24le')) {
    return true;
  }
  if (container == 'flac' && codec == 'flac') {
    return true;
  }
  if (container == 'ogg' && codec == 'opus') {
    return true;
  }
  if (container == 'm4a' &&
      (codec == 'aac' || codec == 'aac_lc' || codec == 'aac-lc' || codec == 'mp4a')) {
    return true;
  }
  if (isOriginal && container == 'mp3' && codec == 'mp3') {
    return true;
  }
  return false;
}

_ManifestValidationOutcome _validateManifestMap(Map<String, dynamic> map) {
  final forbidden = _findForbiddenAuthorityField(map);
  if (forbidden != null) {
    return _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'FORBIDDEN_AUTHORITY_FIELD',
      'Forbidden authority field "$forbidden" in manifest.json',
    ));
  }

  final format = map['format'];
  if (format is! String) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.format must be a string',
    ));
  }
  if (format != RehearsalLimitsV1.format) {
    return _ManifestValidationOutcome.err((
      RehearsalValidationStatus.unsupported,
      'UNSUPPORTED_FORMAT',
      'Unsupported package format: $format',
    ));
  }

  final formatVersion = map['formatVersion'];
  if (formatVersion is! int || formatVersion < 1) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.formatVersion must be an integer >= 1',
    ));
  }
  if (formatVersion != RehearsalLimitsV1.formatVersion) {
    return _ManifestValidationOutcome.err((
      RehearsalValidationStatus.unsupported,
      'UNSUPPORTED_FORMAT_VERSION',
      'Unsupported formatVersion: $formatVersion',
    ));
  }

  final rawFeatures = map['requiredFeatures'];
  if (rawFeatures is! List || rawFeatures.any((e) => e is! String)) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.requiredFeatures must be a list of strings',
    ));
  }
  final requiredFeatures = rawFeatures.cast<String>();
  for (final feat in requiredFeatures) {
    if (!RehearsalLimitsV1.supportedFeatures.contains(feat)) {
      return _ManifestValidationOutcome.err((
        RehearsalValidationStatus.unsupported,
        'UNSUPPORTED_REQUIRED_FEATURE',
        'Unsupported required feature: $feat',
      ));
    }
  }

  final rawPackageId = map['packageId'];
  if (rawPackageId is! String || !_uuidPattern.hasMatch(rawPackageId)) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.packageId must be a valid UUID',
    ));
  }
  final packageId = rawPackageId.toLowerCase();

  final revision = map['revision'];
  if (revision is! int || revision < 1) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.revision must be an integer >= 1',
    ));
  }

  final createdAt = map['createdAt'];
  if (createdAt is! String ||
      !_isoTzPattern.hasMatch(createdAt) ||
      DateTime.tryParse(createdAt) == null) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.createdAt must be an ISO-8601 timestamp with explicit timezone',
    ));
  }

  final displayName = map['displayName'];
  if (displayName is! String ||
      displayName.trim().isEmpty ||
      displayName.length > 200 ||
      _hasControlOrBidiChars(displayName)) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.displayName must be 1..200 printable characters',
    ));
  }

  // Validate source, provenance, rights.
  final source = map['source'];
  final sanitizedSourceName = source is Map<String, dynamic> ? source['sanitizedFileName'] : null;
  if (source is! Map<String, dynamic> ||
      source['sha256'] is! String ||
      !_sha256Pattern.hasMatch((source['sha256'] as String).toLowerCase()) ||
      sanitizedSourceName is! String ||
      sanitizedSourceName.trim().isEmpty ||
      sanitizedSourceName.contains('/') ||
      sanitizedSourceName.contains('\\') ||
      sanitizedSourceName.contains(':') ||
      sanitizedSourceName.contains('..') ||
      source['durationFrames'] is! int ||
      (source['durationFrames'] as int) < 1 ||
      source['usageRightEvidence'] is! String ||
      (source['usageRightEvidence'] as String).trim().isEmpty) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.source is missing or malformed',
    ));
  }

  final provenance = map['provenance'];
  final licenseRefs = provenance is Map<String, dynamic> ? provenance['licenseReferences'] : null;
  if (provenance is! Map<String, dynamic> ||
      provenance['toolName'] is! String ||
      (provenance['toolName'] as String).trim().isEmpty ||
      provenance['toolVersion'] is! String ||
      (provenance['toolVersion'] as String).trim().isEmpty ||
      provenance['modelName'] is! String ||
      (provenance['modelName'] as String).trim().isEmpty ||
      provenance['checkpointId'] is! String ||
      (provenance['checkpointId'] as String).trim().isEmpty ||
      provenance['checkpointSha256'] is! String ||
      !_sha256Pattern.hasMatch(
        (provenance['checkpointSha256'] as String).toLowerCase(),
      ) ||
      provenance['parameters'] is! Map ||
      licenseRefs is! List ||
      licenseRefs.isEmpty ||
      licenseRefs.any((r) => r is! String || r.trim().isEmpty)) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.provenance is missing or malformed',
    ));
  }

  final rights = map['rights'];
  if (rights is! Map<String, dynamic> ||
      rights['declaration'] is! String ||
      (rights['declaration'] as String).trim().isEmpty ||
      (rights['scope'] != 'personal-local' && rights['scope'] != 'rehearsal-local') ||
      rights['exportAllowed'] is! bool ||
      rights['attributions'] is! List ||
      rights['isLegalProof'] != false ||
      rights['isDrm'] != false) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.rights is malformed or claims legal proof / DRM',
    ));
  }

  // Validate timeline.
  final timeline = map['timeline'];
  if (timeline is! Map<String, dynamic> ||
      timeline['sampleRate'] is! int ||
      timeline['totalFrames'] is! int ||
      timeline['channels'] is! int ||
      timeline['timeOriginFrame'] is! int) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.timeline is missing or malformed',
    ));
  }
  final sampleRate = timeline['sampleRate'] as int;
  final totalFrames = timeline['totalFrames'] as int;
  final channels = timeline['channels'] as int;
  final timeOriginFrame = timeline['timeOriginFrame'] as int;

  if (totalFrames < 1) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.timeline.totalFrames must be >= 1',
    ));
  }

  if (totalFrames > RehearsalLimitsV1.maxDurationFrames) {
    return _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'DURATION_LIMIT_EXCEEDED',
      'Duration $totalFrames frames exceeds limit ${RehearsalLimitsV1.maxDurationFrames}',
    ));
  }

  if (sampleRate != RehearsalLimitsV1.sampleRate ||
      channels != RehearsalLimitsV1.channels ||
      timeOriginFrame != 0) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'manifest.timeline does not match v1 profile (44100 Hz stereo, origin 0)',
    ));
  }

  // Validate alignment.
  final alignment = map['alignment'];
  if (alignment is! Map<String, dynamic> ||
      alignment['method'] is! String ||
      alignment['timeOriginFrame'] is! int ||
      alignment['initialTrimFrames'] is! int ||
      alignment['trailingTrimFrames'] is! int) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.alignment is missing or malformed',
    ));
  }
  if (alignment['method'] != 'explicit-trim' ||
      alignment['timeOriginFrame'] != 0 ||
      (alignment['initialTrimFrames'] as int) < 0 ||
      (alignment['trailingTrimFrames'] as int) < 0) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.incomplete,
      'TIMELINE_MISMATCH',
      'manifest.alignment must use explicit-trim with non-negative trims and origin 0',
    ));
  }
  final defaultTrimInit = alignment['initialTrimFrames'] as int;
  final defaultTrimTrail = alignment['trailingTrimFrames'] as int;
  final perStemAlign = alignment['perStem'];
  if (perStemAlign != null) {
    if (perStemAlign is! Map<String, dynamic>) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.alignment.perStem must be an object',
      ));
    }
    for (final entry in perStemAlign.entries) {
      final key = entry.key;
      final value = entry.value;
      if (!RehearsalLimitsV1.requiredStemIds.contains(key) ||
          value is! Map<String, dynamic>) {
        return _ManifestValidationOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_MANIFEST_JSON',
          'Invalid perStem alignment for $key',
        ));
      }
      for (final subEntry in value.entries) {
        final subKey = subEntry.key;
        final subValue = subEntry.value;
        if (subKey != 'initialTrimFrames' && subKey != 'trailingTrimFrames') {
          return _ManifestValidationOutcome.err((
            RehearsalValidationStatus.corrupted,
            'INVALID_MANIFEST_JSON',
            'Unknown perStem alignment key "$subKey" for $key',
          ));
        }
        if (subValue is! int || subValue < 0) {
          return _ManifestValidationOutcome.err((
            RehearsalValidationStatus.incomplete,
            'TIMELINE_MISMATCH',
            'Invalid $subKey for $key',
          ));
        }
      }
    }
  }

  // Validate practice metadata if present.
  final practice = map['practice'];
  var hasPractice = false;
  if (practice != null) {
    if (practice is! Map<String, dynamic>) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.practice must be an object',
      ));
    }
    hasPractice = true;
    final bpm = practice['bpm'];
    if (bpm != null && (bpm is! num || bpm < 20 || bpm > 300 || !bpm.isFinite)) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.practice.bpm must be between 20 and 300',
      ));
    }
    final ts = practice['timeSignature'];
    if (ts != null) {
      if (ts is! Map<String, dynamic> ||
          ts['numerator'] is! int ||
          (ts['numerator'] as int) < 1 ||
          (ts['numerator'] as int) > 32 ||
          ts['denominator'] is! int ||
          ![2, 4, 8, 16].contains(ts['denominator'])) {
        return const _ManifestValidationOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_MANIFEST_JSON',
          'manifest.practice.timeSignature is invalid',
        ));
      }
    }
    final firstBeat = practice['firstBeatOffsetFrames'];
    if (firstBeat != null &&
        (firstBeat is! int || firstBeat < 0 || firstBeat >= totalFrames)) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.practice.firstBeatOffsetFrames must be in [0, totalFrames)',
      ));
    }
    final loopA = practice['loopAFrame'];
    final loopB = practice['loopBFrame'];
    if ((loopA != null) != (loopB != null)) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.practice loopAFrame and loopBFrame must both be set',
      ));
    }
    if (loopA != null && loopB != null) {
      if (loopA is! int ||
          loopB is! int ||
          loopA < 0 ||
          loopB > totalFrames ||
          loopB <= loopA ||
          (loopB - loopA) < RehearsalLimitsV1.minPracticeLoopFrames) {
        return const _ManifestValidationOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_MANIFEST_JSON',
          'manifest.practice loop range must be >= 100 ms within timeline',
        ));
      }
    }
  }

  // Validate stems (must cover vocals, drums, bass, other).
  final rawStems = map['stems'];
  if (rawStems is! List) {
    return const _ManifestValidationOutcome.err((
      RehearsalValidationStatus.corrupted,
      'INVALID_MANIFEST_JSON',
      'manifest.stems must be an array',
    ));
  }

  final parsedStems = <_ParsedMediaDecl>[];
  final seenStemIds = <String>{};
  for (final item in rawStems) {
    if (item is! Map<String, dynamic>) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'Each stem entry must be an object',
      ));
    }
    final id = item['id'];
    final path = item['path'];
    final container = item['container'];
    final codec = item['codec'];
    final bitsPerSample = item['bitsPerSample'];
    final byteLength = item['byteLength'];
    final sha256 = item['sha256'];
    final stemRate = item['sampleRate'];
    final stemChannels = item['channels'];
    final decodedFrames = item['decodedFrames'];

    if (id is! String ||
        path is! String ||
        container is! String ||
        codec is! String ||
        (bitsPerSample != null && bitsPerSample is! int) ||
        byteLength is! int ||
        byteLength <= 0 ||
        sha256 is! String ||
        !_sha256Pattern.hasMatch(sha256.toLowerCase()) ||
        stemRate is! int ||
        stemChannels is! int ||
        decodedFrames is! int ||
        decodedFrames <= 0) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'Malformed stem descriptor in manifest.json',
      ));
    }

    final normalizedContainer = container.toLowerCase();
    final normalizedCodec = codec.toLowerCase();

    if (!RehearsalLimitsV1.requiredStemIds.contains(id) ||
        !seenStemIds.add(id)) {
      return _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'Invalid or duplicate stem id: $id',
      ));
    }

    final pathErr = _validateRelativeEntryPath(path);
    if (pathErr != null) {
      return _ManifestValidationOutcome.err(pathErr);
    }

    if (normalizedCodec == 'mp3' ||
        normalizedContainer == 'mp3' ||
        !_isSupportedMediaCombo(normalizedContainer, normalizedCodec, isOriginal: false)) {
      return _ManifestValidationOutcome.err((
        RehearsalValidationStatus.unsupported,
        'UNSUPPORTED_CODEC',
        'Unsupported stem codec $normalizedContainer/$normalizedCodec for $id',
      ));
    }

    if (decodedFrames > RehearsalLimitsV1.maxDurationFrames) {
      return _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'DURATION_LIMIT_EXCEEDED',
        'Stem $id duration exceeds limit',
      ));
    }

    var trimInit = defaultTrimInit;
    var trimTrail = defaultTrimTrail;
    if (perStemAlign is Map<String, dynamic> && perStemAlign[id] is Map<String, dynamic>) {
      final stemAlign = perStemAlign[id] as Map<String, dynamic>;
      if (stemAlign['initialTrimFrames'] is int) {
        trimInit = stemAlign['initialTrimFrames'] as int;
      }
      if (stemAlign['trailingTrimFrames'] is int) {
        trimTrail = stemAlign['trailingTrimFrames'] as int;
      }
      if (trimInit < 0 || trimTrail < 0) {
        return const _ManifestValidationOutcome.err((
          RehearsalValidationStatus.incomplete,
          'TIMELINE_MISMATCH',
          'Negative per-stem trim frames',
        ));
      }
    }

    if (stemRate != sampleRate ||
        stemChannels != channels ||
        (decodedFrames - trimInit - trimTrail) != totalFrames) {
      return _ManifestValidationOutcome.err((
        RehearsalValidationStatus.incomplete,
        'TIMELINE_MISMATCH',
        'Stem $id frames/rate/channels do not align with timeline',
      ));
    }

    parsedStems.add(
      _ParsedMediaDecl(
        role: 'stem',
        stemId: id,
        path: path,
        container: normalizedContainer,
        codec: normalizedCodec,
        bitsPerSample: bitsPerSample as int?,
        byteLength: byteLength,
        sha256: sha256.toLowerCase(),
        sampleRate: stemRate,
        channels: stemChannels,
        decodedFrames: decodedFrames,
      ),
    );
  }

  for (final reqId in RehearsalLimitsV1.requiredStemIds) {
    if (!seenStemIds.contains(reqId)) {
      return _ManifestValidationOutcome.err((
        RehearsalValidationStatus.incomplete,
        'MISSING_REQUIRED_STEM',
        'Required stem "$reqId" is missing from manifest',
      ));
    }
  }

  // Validate optional original.
  _ParsedMediaDecl? parsedOriginal;
  final rawOriginal = map['original'];
  if (rawOriginal != null) {
    if (rawOriginal is! Map<String, dynamic> ||
        rawOriginal['included'] is! bool) {
      return const _ManifestValidationOutcome.err((
        RehearsalValidationStatus.corrupted,
        'INVALID_MANIFEST_JSON',
        'manifest.original must be an object with boolean "included"',
      ));
    }
    if (rawOriginal['included'] == true) {
      final path = rawOriginal['path'];
      final container = rawOriginal['container'];
      final codec = rawOriginal['codec'];
      final bitsPerSample = rawOriginal['bitsPerSample'];
      final byteLength = rawOriginal['byteLength'];
      final sha256 = rawOriginal['sha256'];
      final origRate = rawOriginal['sampleRate'];
      final origChannels = rawOriginal['channels'];
      final decodedFrames = rawOriginal['decodedFrames'];

      if (path is! String ||
          container is! String ||
          codec is! String ||
          (bitsPerSample != null && bitsPerSample is! int) ||
          byteLength is! int ||
          byteLength <= 0 ||
          sha256 is! String ||
          !_sha256Pattern.hasMatch(sha256.toLowerCase()) ||
          origRate is! int ||
          origChannels is! int ||
          decodedFrames is! int ||
          decodedFrames <= 0) {
        return const _ManifestValidationOutcome.err((
          RehearsalValidationStatus.corrupted,
          'INVALID_MANIFEST_JSON',
          'Malformed manifest.original descriptor',
        ));
      }

      final normalizedOrigContainer = container.toLowerCase();
      final normalizedOrigCodec = codec.toLowerCase();

      final pathErr = _validateRelativeEntryPath(path);
      if (pathErr != null) {
        return _ManifestValidationOutcome.err(pathErr);
      }

      if (!_isSupportedMediaCombo(normalizedOrigContainer, normalizedOrigCodec, isOriginal: true)) {
        return _ManifestValidationOutcome.err((
          RehearsalValidationStatus.unsupported,
          'UNSUPPORTED_CODEC',
          'Unsupported original codec $normalizedOrigContainer/$normalizedOrigCodec',
        ));
      }

      if (decodedFrames > RehearsalLimitsV1.maxDurationFrames) {
        return const _ManifestValidationOutcome.err((
          RehearsalValidationStatus.corrupted,
          'DURATION_LIMIT_EXCEEDED',
          'Original duration exceeds limit',
        ));
      }

      if (origRate != sampleRate ||
          (origChannels != 1 && origChannels != 2)) {
        return const _ManifestValidationOutcome.err((
          RehearsalValidationStatus.incomplete,
          'TIMELINE_MISMATCH',
          'Original sampleRate/channels/frames mismatch timeline',
        ));
      }

      parsedOriginal = _ParsedMediaDecl(
        role: 'original',
        stemId: null,
        path: path,
        container: normalizedOrigContainer,
        codec: normalizedOrigCodec,
        bitsPerSample: bitsPerSample as int?,
        byteLength: byteLength,
        sha256: sha256.toLowerCase(),
        sampleRate: origRate,
        channels: origChannels,
        decodedFrames: decodedFrames,
      );
    }
  }

  return _ManifestValidationOutcome.ok(
    _ParsedManifest(
      packageId: packageId,
      revision: revision,
      createdAt: createdAt,
      displayName: displayName,
      requiredFeatures: requiredFeatures,
      sampleRate: sampleRate,
      channels: channels,
      totalFrames: totalFrames,
      stems: parsedStems,
      original: parsedOriginal,
      hasPractice: hasPractice,
    ),
  );
}
