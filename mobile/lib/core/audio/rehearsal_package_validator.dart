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
  });

  final List<ExistingRehearsalPackage> existingPackages;
  final int? availableStorageBytes;
  final bool includeSourceCopy;
  final int maxChunkBytes;
  final int maxMemoryBudgetBytes;
  final RehearsalCancellationToken? cancellationToken;
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

const Map<int, String> _latinDecompLower = {
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
};

int _combiningClass(int cp) {
  if (cp == 0x0327 || cp == 0x0328) return 202;
  if (cp >= 0x0316 && cp <= 0x0333) return 220;
  if (cp >= 0x0300 && cp <= 0x0314) return 230;
  if (cp >= 0x033D && cp <= 0x0344) return 230;
  if (cp >= 0x0346 && cp <= 0x036F) return 230;
  return 230;
}

/// Normalizes precomposed Latin characters (`U+00C0..U+017F`) and combining
/// marks (`U+0300..U+036F`) + lowercase for collision detection equivalent to
/// JS `normalize('NFC').toLowerCase()`.
String canonicalizeRehearsalPath(String input) {
  final expanded = StringBuffer();
  for (final rune in input.runes) {
    final mapped = _latinDecompLower[rune];
    if (mapped != null) {
      expanded.write(mapped);
    } else if (rune >= 0x41 && rune <= 0x5A) {
      expanded.writeCharCode(rune + 0x20);
    } else {
      expanded.write(String.fromCharCode(rune).toLowerCase());
    }
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

  for (final rune in expanded.toString().runes) {
    if (rune >= 0x0300 && rune <= 0x036F) {
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

  Future<Uint8List> readBounded(int offset, int length) async {
    if (length == 0) return Uint8List(0);
    if (length <= maxChunkBytes) {
      if (token != null && token.isCancelled) {
        throw const _CancelledException();
      }
      final slice = await source.readSlice(offset, length);
      if (token != null && token.isCancelled) {
        throw const _CancelledException();
      }
      if (slice.length > maxObservedSingleReadBytes) {
        maxObservedSingleReadBytes = slice.length;
      }
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
      if (slice.length > maxObservedSingleReadBytes) {
        maxObservedSingleReadBytes = slice.length;
      }
      if (slice.length != take) {
        throw const _TruncatedException();
      }
      out.setRange(pos, pos + take, slice);
      pos += take;
    }
    return out;
  }

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

    // 1. Locate End of Central Directory (EOCD) scanning backwards in <= maxChunkBytes tail slices.
    final maxTailSearch = math.min(compressedBytes, 22 + 65535);
    if (checkMemory(maxTailSearch)) {
      return fail(
        RehearsalValidationStatus.insufficientSpace,
        'MEMORY_BUDGET_EXCEEDED',
        'Working memory exceeds configured budget of $maxMemoryBudgetBytes bytes',
      );
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
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'ZIP End of Central Directory not found',
      );
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
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'Multi-disk ZIP archives are not supported',
      );
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
          return fail(
            RehearsalValidationStatus.corrupted,
            'INVALID_ZIP_ARCHIVE',
            'Multi-disk ZIP64 archives are not supported',
          );
        }
        if (z64Offset < 0 || z64Offset > locOffset || 56 > locOffset - z64Offset) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'TRUNCATED_ARCHIVE',
            'ZIP64 EOCD offset out of bounds',
          );
        }
        final z64Bytes = await readBounded(z64Offset, 56);
        if (_u32le(z64Bytes, 0) != 0x06064B50) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'INVALID_ZIP_ARCHIVE',
            'Invalid ZIP64 EOCD signature',
          );
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
          return fail(
            RehearsalValidationStatus.corrupted,
            'INVALID_ZIP_ARCHIVE',
            'Multi-disk ZIP64 EOCD rejected',
          );
        }
        totalEntries = z64TotalEntries;
        cdSize = z64CdSize;
        cdOffset = z64CdOffset;
        cdLimitOffset = z64Offset;
      } else if (totalEntries == 0xFFFF ||
          cdSize == 0xFFFFFFFF ||
          cdOffset == 0xFFFFFFFF) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'INVALID_ZIP_ARCHIVE',
          'ZIP64 markers present without ZIP64 EOCD locator',
        );
      }
    }

    if (totalEntries == 0) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'EMPTY_ARCHIVE',
        'ZIP archive contains zero entries',
      );
    }

    if (totalEntries > RehearsalLimitsV1.maxEntries) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'ENTRY_COUNT_LIMIT_EXCEEDED',
        'Archive entry count $totalEntries exceeds maximum ${RehearsalLimitsV1.maxEntries}',
      );
    }
    entryCount = totalEntries;

    if (cdOffset < 0 ||
        cdSize < 0 ||
        cdOffset > cdLimitOffset ||
        cdSize > cdLimitOffset - cdOffset) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'TRUNCATED_ARCHIVE',
        'Central Directory bounds exceed archive',
      );
    }

    if (checkMemory(cdSize + maxChunkBytes)) {
      return fail(
        RehearsalValidationStatus.insufficientSpace,
        'MEMORY_BUDGET_EXCEEDED',
        'Central Directory exceeds memory budget of $maxMemoryBudgetBytes bytes',
      );
    }

    if (token != null && token.isCancelled) {
      return fail(
        RehearsalValidationStatus.cancelled,
        'VALIDATION_CANCELLED',
        'Validation cancelled before Central Directory read',
      );
    }

    // 2. Read and parse Central Directory records.
    final cdBytes = await readBounded(cdOffset, cdSize);
    final entries = <_CdEntry>[];
    final seenCanonical = <String>{};
    var cdPos = 0;
    var runningDeclaredBytes = 0;

    for (var i = 0; i < totalEntries; i++) {
      if (cdPos + 46 > cdBytes.length || _u32le(cdBytes, cdPos) != 0x02014B50) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'INVALID_ZIP_ARCHIVE',
          'Malformed Central Directory entry #$i',
        );
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
        return fail(
          RehearsalValidationStatus.corrupted,
          'TRUNCATED_ARCHIVE',
          'Central Directory record #$i truncated',
        );
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
        return fail(
          RehearsalValidationStatus.corrupted,
          'INVALID_ZIP_ARCHIVE',
          'Multi-disk entry rejected',
        );
      }

      // Security check: encryption (bit 0, bit 6, or method 99).
      if ((flags & 0x0001) != 0 || (flags & 0x0040) != 0 || method == 99) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'ENCRYPTED_ENTRY_FORBIDDEN',
          'Encrypted ZIP entries are forbidden',
        );
      }

      String rawName;
      try {
        rawName = utf8.decode(rawNameBytes, allowMalformed: false);
      } on FormatException {
        return fail(
          RehearsalValidationStatus.corrupted,
          'PATH_TRAVERSAL_OR_UNSAFE_PATH',
          'Non-UTF-8 entry name rejected',
        );
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
        return fail(
          RehearsalValidationStatus.corrupted,
          'SPECIAL_FILE_OR_SYMLINK_FORBIDDEN',
          'Directory, symlink, or special file entry forbidden: $rawName',
        );
      }

      final pathError = _validateRelativeEntryPath(rawName);
      if (pathError != null) {
        return fail(pathError.$1, pathError.$2, pathError.$3);
      }

      if (_hasNestedArchiveExtension(rawName)) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'NESTED_ARCHIVE_FORBIDDEN',
          'Nested archive extension forbidden: $rawName',
        );
      }

      final canonical = canonicalizeRehearsalPath(rawName);
      if (!seenCanonical.add(canonical)) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'DUPLICATE_OR_COLLIDING_ENTRY',
          'Duplicate or Unicode/case-colliding ZIP entry: $rawName',
        );
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
      return fail(
        RehearsalValidationStatus.corrupted,
        'INVALID_ZIP_ARCHIVE',
        'Central Directory trailing garbage detected',
      );
    }

    if (runningDeclaredBytes > RehearsalLimitsV1.maxExtractedBytes) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'EXTRACTED_SIZE_LIMIT_EXCEEDED',
        'Declared extracted size $runningDeclaredBytes exceeds limit ${RehearsalLimitsV1.maxExtractedBytes}',
      );
    }

    // Check manifest presence & compression rules & declared bomb ratios before reading entries.
    _CdEntry? manifestEntry;
    for (final entry in entries) {
      if (entry.path == 'manifest.json') {
        manifestEntry = entry;
      }
    }
    if (manifestEntry == null) {
      return fail(
        RehearsalValidationStatus.corrupted,
        'MISSING_MANIFEST',
        'Required root manifest.json is missing',
      );
    }

    for (final entry in entries) {
      final isManifest = entry.path == 'manifest.json';
      if (isManifest) {
        if (entry.compressionMethod != 0 && entry.compressionMethod != 8) {
          return fail(
            RehearsalValidationStatus.unsupported,
            'UNSUPPORTED_COMPRESSION_METHOD',
            'Unsupported compression method ${entry.compressionMethod} for manifest.json',
          );
        }
        if (entry.uncompressedSize > RehearsalLimitsV1.maxManifestBytes) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'MANIFEST_SIZE_LIMIT_EXCEEDED',
            'manifest.json size ${entry.uncompressedSize} exceeds ${RehearsalLimitsV1.maxManifestBytes} bytes',
          );
        }
        if (entry.compressionMethod == 8) {
          if ((entry.compressedSize == 0 && entry.uncompressedSize > 0) ||
              entry.uncompressedSize >
                  entry.compressedSize * RehearsalLimitsV1.maxCompressionRatio) {
            return fail(
              RehearsalValidationStatus.corrupted,
              'ZIP_BOMB_RATIO_EXCEEDED',
              'manifest.json declared compression ratio exceeds ${RehearsalLimitsV1.maxCompressionRatio}:1',
            );
          }
        } else if (entry.compressedSize != entry.uncompressedSize) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'STORE entry manifest.json has mismatched compressed/uncompressed sizes',
          );
        }
      } else {
        if (entry.compressionMethod != 0) {
          return fail(
            RehearsalValidationStatus.unsupported,
            'UNSUPPORTED_COMPRESSION_METHOD',
            'Media/auxiliary entry ${entry.path} must use STORE (0), got ${entry.compressionMethod}',
          );
        }
        if (entry.compressedSize != entry.uncompressedSize) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'STORE entry ${entry.path} has mismatched compressed/uncompressed sizes',
          );
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
        return fail(
          RehearsalValidationStatus.cancelled,
          'VALIDATION_CANCELLED',
          'Validation cancelled during Local File Header verification',
        );
      }

      if (entry.localHeaderOffset < 0 ||
          entry.localHeaderOffset > cdOffset ||
          30 > cdOffset - entry.localHeaderOffset) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'TRUNCATED_ARCHIVE',
          'Local File Header out of bounds for ${entry.path}',
        );
      }

      if (entry.localHeaderOffset < prevDataEnd) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'OVERLAPPING_ZIP_ENTRIES',
          'Overlapping ZIP entries detected near ${entry.path}',
        );
      }

      final lfh = await readBounded(entry.localHeaderOffset, 30);
      if (_u32le(lfh, 0) != 0x04034B50) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'Invalid Local File Header signature for ${entry.path}',
        );
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
        return fail(
          RehearsalValidationStatus.corrupted,
          'HEADER_MISMATCH',
          'LFH/CD flags, method, or filename length mismatch for ${entry.path}',
        );
      }

      final varLen = lfhNameLen + lfhExtraLen;
      if (varLen > cdOffset - (entry.localHeaderOffset + 30)) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'TRUNCATED_ARCHIVE',
          'LFH filename/extra exceeds CD offset for ${entry.path}',
        );
      }
      final dataOffset = entry.localHeaderOffset + 30 + varLen;

      final lfhVarBytes = varLen > 0
          ? await readBounded(entry.localHeaderOffset + 30, varLen)
          : Uint8List(0);
      for (var k = 0; k < lfhNameLen; k++) {
        if (lfhVarBytes[k] != entry.rawNameBytes[k]) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'LFH/CD filename bytes mismatch for ${entry.path}',
          );
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
            return fail(
              RehearsalValidationStatus.corrupted,
              'HEADER_MISMATCH',
              'Missing LFH ZIP64 uncompressedSize extra field for ${entry.path}',
            );
          }
          lfhUncomp = z64Uncomp;
        }
        if (lfhComp == 0xFFFFFFFF) {
          if (z64Comp == null) {
            return fail(
              RehearsalValidationStatus.corrupted,
              'HEADER_MISMATCH',
              'Missing LFH ZIP64 compressedSize extra field for ${entry.path}',
            );
          }
          lfhComp = z64Comp;
        }
      }

      if (!hasDataDescriptor || (lfhCrc != 0 || lfhComp != 0 || lfhUncomp != 0)) {
        if (lfhCrc != entry.crc32 ||
            lfhComp != entry.compressedSize ||
            lfhUncomp != entry.uncompressedSize) {
          return fail(
            RehearsalValidationStatus.corrupted,
            'HEADER_MISMATCH',
            'LFH/CD CRC or size mismatch for ${entry.path}',
          );
        }
      }

      if (entry.compressedSize < 0 ||
          entry.compressedSize > compressedBytes - dataOffset) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'TRUNCATED_ARCHIVE',
          'Entry payload truncated for ${entry.path}',
        );
      }
      if (entry.compressedSize > cdOffset - dataOffset) {
        return fail(
          RehearsalValidationStatus.corrupted,
          'OVERLAPPING_ZIP_ENTRIES',
          'Entry payload overlaps Central Directory for ${entry.path}',
        );
      }
      final dataEnd = dataOffset + entry.compressedSize;

      prevDataEnd = dataEnd;
      resolvedEntries[entry.path] = entry.withDataOffset(dataOffset);
    }

    declaredExtractedBytes = runningDeclaredBytes;
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
