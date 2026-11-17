import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';

/// Loads the shared T7 corpus JSON from repository root or `mobile/` directory.
Map<String, dynamic> loadRehearsalPackageCorpus() {
  for (final path in [
    '../shared/fixtures/rehearsal-package-v1/rehearsal-package-v1-corpus.json',
    'shared/fixtures/rehearsal-package-v1/rehearsal-package-v1-corpus.json',
  ]) {
    final file = File(path);
    if (file.existsSync()) {
      return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  throw StateError(
    'Shared rehearsal-package-v1-corpus.json not found from repository or mobile directory',
  );
}

Map<String, dynamic> loadReferenceManifest(String fileName) {
  for (final prefix in [
    '../shared/fixtures/rehearsal-package-v1/manifests',
    'shared/fixtures/rehearsal-package-v1/manifests',
  ]) {
    final file = File('$prefix/$fileName');
    if (file.existsSync()) {
      return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  throw StateError('Reference manifest $fileName not found');
}

/// Synthesized corpus test vector with deterministic archive bytes and options.
final class SynthesizedCorpusCase {
  const SynthesizedCorpusCase({
    required this.id,
    required this.description,
    required this.bytes,
    required this.options,
    required this.expected,
  });

  final String id;
  final String description;
  final Uint8List bytes;
  final RehearsalValidationOptions options;
  final Map<String, dynamic> expected;
}

/// Mutable ZIP entry recipe used to build deterministic synthetic `.louvaio-rehearsal.zip` fixtures.
final class SyntheticZipEntry {
  SyntheticZipEntry({
    required this.path,
    required this.uncompressedData,
    this.compressionMethod = 0,
    this.flags = 0x0800,
    this.externalAttr = 0,
    this.overrideCrc32,
    this.overrideCompressedData,
    this.overrideDeclaredUncompressedSize,
    this.flipPayloadByte = false,
    this.overlapPreviousByBytes = 0,
  });

  String path;
  Uint8List uncompressedData;
  int compressionMethod;
  int flags;
  int externalAttr;
  int? overrideCrc32;
  Uint8List? overrideCompressedData;
  int? overrideDeclaredUncompressedSize;
  bool flipPayloadByte;
  int overlapPreviousByBytes;
}

void _writeU16le(BytesBuilder b, int v) {
  b.addByte(v & 0xFF);
  b.addByte((v >> 8) & 0xFF);
}

void _writeU32le(BytesBuilder b, int v) {
  b.addByte(v & 0xFF);
  b.addByte((v >> 8) & 0xFF);
  b.addByte((v >> 16) & 0xFF);
  b.addByte((v >> 24) & 0xFF);
}

void _writeU64le(BytesBuilder b, int v) {
  for (var i = 0; i < 8; i++) {
    b.addByte((v >> (i * 8)) & 0xFF);
  }
}

void _writeU16be(BytesBuilder b, int v) {
  b.addByte((v >> 8) & 0xFF);
  b.addByte(v & 0xFF);
}

void _writeU24be(BytesBuilder b, int v) {
  b.addByte((v >> 16) & 0xFF);
  b.addByte((v >> 8) & 0xFF);
  b.addByte(v & 0xFF);
}

void _writeU32be(BytesBuilder b, int v) {
  b.addByte((v >> 24) & 0xFF);
  b.addByte((v >> 16) & 0xFF);
  b.addByte((v >> 8) & 0xFF);
  b.addByte(v & 0xFF);
}

/// Builds a deterministic PCM-16 WAV buffer.
Uint8List buildSyntheticWavPcm16({
  required int seed,
  int sampleRate = 44100,
  int channels = 2,
  int frames = 4410,
}) {
  final dataBytes = frames * channels * 2;
  final out = Uint8List(44 + dataBytes);
  final bd = ByteData.sublistView(out);
  out.setRange(0, 4, ascii.encode('RIFF'));
  bd.setUint32(4, 36 + dataBytes, Endian.little);
  out.setRange(8, 12, ascii.encode('WAVE'));
  out.setRange(12, 16, ascii.encode('fmt '));
  bd.setUint32(16, 16, Endian.little);
  bd.setUint16(20, 1, Endian.little); // PCM
  bd.setUint16(22, channels, Endian.little);
  bd.setUint32(24, sampleRate, Endian.little);
  bd.setUint32(28, sampleRate * channels * 2, Endian.little);
  bd.setUint16(32, channels * 2, Endian.little);
  bd.setUint16(34, 16, Endian.little);
  out.setRange(36, 40, ascii.encode('data'));
  bd.setUint32(40, dataBytes, Endian.little);

  for (var f = 0; f < frames; f++) {
    final sample = ((math.sin((f + seed * 17) * 0.05) * 12000).round()) & 0xFFFF;
    for (var ch = 0; ch < channels; ch++) {
      bd.setInt16(44 + (f * channels + ch) * 2, sample.toSigned(16), Endian.little);
    }
  }
  return out;
}

/// Builds a deterministic FLAC 24-bit file with valid `fLaC` + `STREAMINFO`.
Uint8List buildSyntheticFlac({
  required int seed,
  int sampleRate = 44100,
  int channels = 2,
  int bitsPerSample = 24,
  int totalSamples = 4602,
}) {
  final b = BytesBuilder();
  b.add(ascii.encode('fLaC'));
  // Last metadata block (0x80) | STREAMINFO (0)
  b.addByte(0x80);
  _writeU24be(b, 34);
  _writeU16be(b, 4096); // minBlockSize
  _writeU16be(b, 4096); // maxBlockSize
  _writeU24be(b, 0); // minFrameSize
  _writeU24be(b, 0); // maxFrameSize

  // 20 bits sampleRate | 3 bits (channels-1) | 5 bits (bps-1) | 36 bits totalSamples
  final chMinus1 = (channels - 1) & 0x07;
  final bpsMinus1 = (bitsPerSample - 1) & 0x1F;
  b.addByte((sampleRate >> 12) & 0xFF);
  b.addByte((sampleRate >> 4) & 0xFF);
  b.addByte(((sampleRate & 0x0F) << 4) | (chMinus1 << 1) | ((bpsMinus1 >> 4) & 0x01));
  b.addByte(((bpsMinus1 & 0x0F) << 4) | ((totalSamples >> 32) & 0x0F));
  b.addByte((totalSamples >> 24) & 0xFF);
  b.addByte((totalSamples >> 16) & 0xFF);
  b.addByte((totalSamples >> 8) & 0xFF);
  b.addByte(totalSamples & 0xFF);
  for (var i = 0; i < 16; i++) {
    b.addByte((seed + i) & 0xFF); // MD5 placeholder
  }
  // Minimal deterministic audio frame payload bytes.
  b.add([0xFF, 0xF8, 0x69, 0x10, seed & 0xFF, 0x00, 0x00, 0x00]);
  return b.toBytes();
}

/// Builds a deterministic Ogg Opus file (RFC 7845 BOS `OpusHead`, `OpusTags`, and EOS `granulePosition`).
Uint8List buildSyntheticOggOpus({
  required int seed,
  int channels = 2,
  int preSkip = 312,
  int inputSampleRate = 44100,
  int decodedFrames = 4410,
}) {
  final out = BytesBuilder();

  void writeOggPage({
    required int headerType,
    required int granulePosition,
    required int seq,
    required Uint8List payload,
  }) {
    out.add(ascii.encode('OggS'));
    out.addByte(0); // version
    out.addByte(headerType);
    _writeU64le(out, granulePosition);
    _writeU32le(out, 0x1000 + seed);
    _writeU32le(out, seq);
    _writeU32le(out, 0); // CRC placeholder
    out.addByte(1); // 1 segment
    out.addByte(payload.length);
    out.add(payload);
  }

  final headPayload = BytesBuilder();
  headPayload.add(ascii.encode('OpusHead'));
  headPayload.addByte(1); // version
  headPayload.addByte(channels);
  _writeU16le(headPayload, preSkip);
  _writeU32le(headPayload, inputSampleRate);
  _writeU16le(headPayload, 0); // output gain
  headPayload.addByte(0); // channel mapping family
  writeOggPage(
    headerType: 0x02,
    granulePosition: 0,
    seq: 0,
    payload: headPayload.toBytes(),
  );

  final tagsPayload = BytesBuilder();
  tagsPayload.add(ascii.encode('OpusTags'));
  const vendor = 'louvaio-test';
  _writeU32le(tagsPayload, vendor.length);
  tagsPayload.add(ascii.encode(vendor));
  _writeU32le(tagsPayload, 0); // user comment count
  writeOggPage(
    headerType: 0x00,
    granulePosition: 0,
    seq: 1,
    payload: tagsPayload.toBytes(),
  );

  final eosGranule = preSkip + (decodedFrames * 48000 / inputSampleRate).round();
  writeOggPage(
    headerType: 0x04,
    granulePosition: eosGranule,
    seq: 2,
    payload: Uint8List.fromList([0xF8, 0xFF, 0xFE, seed & 0xFF]),
  );

  return out.toBytes();
}

/// Builds a deterministic M4A AAC-LC ISO BMFF buffer with `ftyp`, `moov/mdhd/mp4a`, and `mdat`.
Uint8List buildSyntheticM4aAac({
  required int seed,
  int sampleRate = 44100,
  int channels = 2,
  int decodedFrames = 4410,
}) {
  Uint8List box(String type, List<int> content) {
    final b = BytesBuilder();
    _writeU32be(b, 8 + content.length);
    b.add(ascii.encode(type));
    b.add(content);
    return b.toBytes();
  }

  final ftypContent = BytesBuilder();
  ftypContent.add(ascii.encode('M4A '));
  _writeU32be(ftypContent, 0);
  ftypContent.add(ascii.encode('M4A '));
  ftypContent.add(ascii.encode('isom'));
  final ftyp = box('ftyp', ftypContent.toBytes());

  final mdhdContent = BytesBuilder();
  mdhdContent.add([0, 0, 0, 0]); // version + flags
  _writeU32be(mdhdContent, 0); // creation
  _writeU32be(mdhdContent, 0); // modification
  _writeU32be(mdhdContent, sampleRate);
  _writeU32be(mdhdContent, decodedFrames);
  _writeU16be(mdhdContent, 0x55C4);
  _writeU16be(mdhdContent, 0);
  final mdhd = box('mdhd', mdhdContent.toBytes());

  final mp4aContent = BytesBuilder();
  mp4aContent.add(Uint8List(6)); // reserved
  _writeU16be(mp4aContent, 1); // data ref index
  mp4aContent.add(Uint8List(8)); // reserved
  _writeU16be(mp4aContent, channels);
  _writeU16be(mp4aContent, 16); // sample size
  mp4aContent.add(Uint8List(4)); // reserved
  _writeU32be(mp4aContent, sampleRate << 16);
  final mp4a = box('mp4a', mp4aContent.toBytes());

  final stsdContent = BytesBuilder();
  stsdContent.add([0, 0, 0, 0]); // version + flags
  _writeU32be(stsdContent, 1); // entry count
  stsdContent.add(mp4a);
  final stsd = box('stsd', stsdContent.toBytes());

  final stbl = box('stbl', stsd);
  final minf = box('minf', stbl);
  final mdia = box('mdia', [...mdhd, ...minf]);
  final trak = box('trak', mdia);
  final moov = box('moov', trak);
  final mdat = box('mdat', [0x21, 0x10, seed & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00]);

  final all = BytesBuilder();
  all.add(ftyp);
  all.add(moov);
  all.add(mdat);
  return all.toBytes();
}

/// Builds a deterministic MP3 buffer with ID3v2 header and MPEG-1 Layer III 44100 Hz stereo frame.
Uint8List buildSyntheticMp3({int seed = 1}) {
  final b = BytesBuilder();
  b.add(ascii.encode('ID3'));
  b.add([3, 0, 0]); // ID3v2.3
  b.add([0, 0, 0, 10]); // 10-byte tag body
  b.add(Uint8List(10));
  // MPEG-1 (11), Layer III (01), no CRC (1) => 0xFF, 0xFB
  // 128 kbps (1001), 44100 Hz (00), no pad (0), priv (0) => 0x90
  // Joint stereo (01) => 0x40
  b.add([0xFF, 0xFB, 0x90, 0x40]);
  final frameBody = Uint8List(413);
  frameBody[0] = seed & 0xFF;
  b.add(frameBody);
  return b.toBytes();
}

/// Serializes [entries] into a deterministic ZIP byte buffer.
Uint8List buildSyntheticZip(
  List<SyntheticZipEntry> entries, {
  int truncateTailBytes = 0,
}) {
  final archive = BytesBuilder();
  final cdRecords = <Uint8List>[];

  for (final entry in entries) {
    final nameBytes = utf8.encode(entry.path);
    final rawData = entry.uncompressedData;
    final crc = entry.overrideCrc32 ?? IncrementalCrc32.compute(rawData);

    final Uint8List compressedPayload;
    if (entry.overrideCompressedData != null) {
      compressedPayload = entry.overrideCompressedData!;
    } else if (entry.compressionMethod == 8) {
      compressedPayload = Uint8List.fromList(
        ZLibEncoder(raw: true).convert(rawData),
      );
    } else {
      compressedPayload = rawData;
    }

    final payloadCopy = Uint8List.fromList(compressedPayload);
    if (entry.flipPayloadByte && payloadCopy.isNotEmpty) {
      payloadCopy[payloadCopy.length - 1] ^= 0xFF;
    }

    final lfhOffset = math.max(0, archive.length - entry.overlapPreviousByBytes);
    final declaredUncompressed =
        entry.overrideDeclaredUncompressedSize ?? rawData.length;

    // Local File Header (LFH).
    final lfh = BytesBuilder();
    _writeU32le(lfh, 0x04034B50);
    _writeU16le(lfh, 20); // version needed
    _writeU16le(lfh, entry.flags);
    _writeU16le(lfh, entry.compressionMethod);
    _writeU16le(lfh, 0); // mod time
    _writeU16le(lfh, 0); // mod date
    _writeU32le(lfh, crc);
    _writeU32le(lfh, payloadCopy.length);
    _writeU32le(lfh, declaredUncompressed);
    _writeU16le(lfh, nameBytes.length);
    _writeU16le(lfh, 0); // extra len
    lfh.add(nameBytes);
    lfh.add(payloadCopy);

    if (entry.overlapPreviousByBytes == 0) {
      archive.add(lfh.toBytes());
    }
    // When overlapPreviousByBytes > 0, we keep the archive bytes intact and point CD at overlapping offset.

    // Central Directory header.
    final cd = BytesBuilder();
    _writeU32le(cd, 0x02014B50);
    _writeU16le(cd, (3 << 8) | 20); // Unix + PKZIP 2.0
    _writeU16le(cd, 20);
    _writeU16le(cd, entry.flags);
    _writeU16le(cd, entry.compressionMethod);
    _writeU16le(cd, 0);
    _writeU16le(cd, 0);
    _writeU32le(cd, crc);
    _writeU32le(cd, payloadCopy.length);
    _writeU32le(cd, declaredUncompressed);
    _writeU16le(cd, nameBytes.length);
    _writeU16le(cd, 0); // extra len
    _writeU16le(cd, 0); // comment len
    _writeU16le(cd, 0); // disk start
    _writeU16le(cd, 0); // internal attr
    _writeU32le(cd, entry.externalAttr);
    _writeU32le(cd, lfhOffset);
    cd.add(nameBytes);
    cdRecords.add(cd.toBytes());
  }

  final cdOffset = archive.length;
  var cdSize = 0;
  for (final rec in cdRecords) {
    archive.add(rec);
    cdSize += rec.length;
  }

  // EOCD.
  final eocd = BytesBuilder();
  _writeU32le(eocd, 0x06054B50);
  _writeU16le(eocd, 0);
  _writeU16le(eocd, 0);
  _writeU16le(eocd, entries.length);
  _writeU16le(eocd, entries.length);
  _writeU32le(eocd, cdSize);
  _writeU32le(eocd, cdOffset);
  _writeU16le(eocd, 0);
  archive.add(eocd.toBytes());

  final all = archive.toBytes();
  if (truncateTailBytes > 0 && truncateTailBytes <= all.length) {
    return Uint8List.sublistView(all, 0, all.length - truncateTailBytes);
  }
  return all;
}

Map<String, dynamic> _deepCopyMap(Map<String, dynamic> src) =>
    jsonDecode(jsonEncode(src)) as Map<String, dynamic>;

Uint8List _hexToBytes(String hex) {
  if (hex.isEmpty) return Uint8List(0);
  final out = Uint8List(hex.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}

/// Builds all deterministic corpus test cases from `rehearsal-package-v1-corpus.json`.
List<SynthesizedCorpusCase> synthesizeAllCorpusCases() {
  final corpus = loadRehearsalPackageCorpus();
  final rawCases = corpus['cases'] as List<dynamic>;
  return rawCases
      .cast<Map<String, dynamic>>()
      .map(synthesizeCorpusCase)
      .toList();
}

/// Builds one deterministic [SynthesizedCorpusCase] from a corpus entry.
SynthesizedCorpusCase synthesizeCorpusCase(Map<String, dynamic> caseDef) {
  final id = caseDef['id'] as String;
  final description = caseDef['description'] as String;
  final recipe = caseDef['recipe'] as Map<String, dynamic>;
  final expected = caseDef['expected'] as Map<String, dynamic>;
  final base = recipe['base'] as String;

  if (base == 'raw_bytes') {
    final hex = recipe['rawBytesHex'] as String;
    return SynthesizedCorpusCase(
      id: id,
      description: description,
      bytes: _hexToBytes(hex),
      options: const RehearsalValidationOptions(),
      expected: expected,
    );
  }

  final manifestCompression =
      (recipe['manifestCompression'] as String?) == 'deflate' ? 8 : 0;
  final mutations = (recipe['mutations'] as Map<String, dynamic>?) ?? const {};
  final rawOpts = (recipe['options'] as Map<String, dynamic>?) ?? const {};

  late Map<String, dynamic> manifest;
  final mediaEntries = <SyntheticZipEntry>[];
  final mediaMetaForComposite = <({String role, String path, Uint8List bytes})>[];

  if (base == 'minimal_wav') {
    manifest = _deepCopyMap(loadReferenceManifest('valid-wav-minimal.manifest.json'));
  } else if (base == 'complete_wav') {
    manifest = _deepCopyMap(
      loadReferenceManifest('valid-with-original-and-practice.manifest.json'),
    );
  } else if (base == 'flac_4stems_trimmed') {
    manifest = _deepCopyMap(loadReferenceManifest('valid-wav-minimal.manifest.json'));
    manifest['alignment'] = {
      'timeOriginFrame': 0,
      'method': 'explicit-trim',
      'initialTrimFrames': 128,
      'trailingTrimFrames': 64,
    };
    final stems = (manifest['stems'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final s in stems) {
      final stemId = s['id'] as String;
      s['path'] = 'stems/$stemId.flac';
      s['container'] = 'flac';
      s['codec'] = 'flac';
      s['bitsPerSample'] = 24;
      s['decodedFrames'] = 4410 + 128 + 64;
    }
  } else if (base == 'opus_4stems') {
    manifest = _deepCopyMap(loadReferenceManifest('valid-wav-minimal.manifest.json'));
    final stems = (manifest['stems'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final s in stems) {
      final stemId = s['id'] as String;
      s['path'] = 'stems/$stemId.ogg';
      s['container'] = 'ogg';
      s['codec'] = 'opus';
      s.remove('bitsPerSample');
    }
  } else if (base == 'm4a_4stems_mp3_original') {
    manifest = _deepCopyMap(
      loadReferenceManifest('valid-with-original-and-practice.manifest.json'),
    );
    manifest['original'] = {
      'included': true,
      'path': 'audio/original.mp3',
      'container': 'mp3',
      'codec': 'mp3',
      'byteLength': 1,
      'sha256': '0' * 64,
      'sampleRate': 44100,
      'channels': 2,
      'decodedFrames': 4410,
    };
    final stems = (manifest['stems'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final s in stems) {
      final stemId = s['id'] as String;
      s['path'] = 'stems/$stemId.m4a';
      s['container'] = 'm4a';
      s['codec'] = 'aac_lc';
      s.remove('bitsPerSample');
    }
  } else {
    throw ArgumentError('Unsupported corpus base: $base');
  }

  // Generate deterministic audio payloads matching manifest declarations.
  final stems = (manifest['stems'] as List<dynamic>).cast<Map<String, dynamic>>();
  for (var i = 0; i < stems.length; i++) {
    final s = stems[i];
    final container = s['container'] as String;
    final decodedFrames = s['decodedFrames'] as int;
    final seed = i + 1;

    late final Uint8List audioBytes;
    if (container == 'wav') {
      audioBytes = buildSyntheticWavPcm16(seed: seed, frames: decodedFrames);
    } else if (container == 'flac') {
      audioBytes = buildSyntheticFlac(
        seed: seed,
        bitsPerSample: (s['bitsPerSample'] as int?) ?? 24,
        totalSamples: decodedFrames,
      );
    } else if (container == 'ogg') {
      audioBytes = buildSyntheticOggOpus(seed: seed, decodedFrames: decodedFrames);
    } else if (container == 'm4a') {
      audioBytes = buildSyntheticM4aAac(seed: seed, decodedFrames: decodedFrames);
    } else {
      audioBytes = buildSyntheticWavPcm16(seed: seed, frames: decodedFrames);
    }

    s['byteLength'] = audioBytes.length;
    s['sha256'] = IncrementalSha256.computeHex(audioBytes);
    final path = s['path'] as String;
    mediaEntries.add(SyntheticZipEntry(path: path, uncompressedData: audioBytes));
    mediaMetaForComposite.add((role: 'stem', path: path, bytes: audioBytes));
  }

  final original = manifest['original'] as Map<String, dynamic>;
  if (original['included'] == true) {
    final container = original['container'] as String;
    final decodedFrames = original['decodedFrames'] as int;
    final origBytes = container == 'mp3'
        ? buildSyntheticMp3(seed: 99)
        : buildSyntheticWavPcm16(seed: 99, frames: decodedFrames);
    final origSha = IncrementalSha256.computeHex(origBytes);
    original['byteLength'] = origBytes.length;
    original['sha256'] = origSha;
    (manifest['source'] as Map<String, dynamic>)['sha256'] = origSha;
    final origPath = original['path'] as String;
    mediaEntries.add(SyntheticZipEntry(path: origPath, uncompressedData: origBytes));
    mediaMetaForComposite.add((role: 'original', path: origPath, bytes: origBytes));
  }

  // Apply mutations.
  if (mutations['dropStemId'] != null) {
    final dropId = mutations['dropStemId'] as String;
    stems.removeWhere((s) {
      if (s['id'] == dropId) {
        mediaEntries.removeWhere((e) => e.path == s['path']);
        return true;
      }
      return false;
    });
  }

  if (mutations['omitZipEntry'] != null) {
    final omitPath = mutations['omitZipEntry'] as String;
    mediaEntries.removeWhere((e) => e.path == omitPath);
  }

  if (mutations['stemSha256Mismatch'] != null) {
    final stemId = mutations['stemSha256Mismatch'] as String;
    for (final s in stems) {
      if (s['id'] == stemId) {
        final cur = s['sha256'] as String;
        s['sha256'] = (cur.startsWith('0') ? '1' : '0') + cur.substring(1);
      }
    }
  }

  if (mutations['timelinePatch'] != null) {
    final patch = mutations['timelinePatch'] as Map<String, dynamic>;
    (manifest['timeline'] as Map<String, dynamic>).addAll(patch);
  }

  if (mutations['alignmentPatch'] != null) {
    final patch = mutations['alignmentPatch'] as Map<String, dynamic>;
    (manifest['alignment'] as Map<String, dynamic>).addAll(patch);
  }

  if (mutations['manifestPatch'] != null) {
    final patch = mutations['manifestPatch'] as Map<String, dynamic>;
    manifest.addAll(patch);
  }

  if (mutations['stemCodecMp3'] != null) {
    final stemId = mutations['stemCodecMp3'] as String;
    for (final s in stems) {
      if (s['id'] == stemId) {
        final oldPath = s['path'] as String;
        const newPath = 'stems/vocals.mp3';
        final mp3Bytes = buildSyntheticMp3(seed: 7);
        s['container'] = 'mp3';
        s['codec'] = 'mp3';
        s['path'] = newPath;
        s.remove('bitsPerSample');
        s['byteLength'] = mp3Bytes.length;
        s['sha256'] = IncrementalSha256.computeHex(mp3Bytes);
        for (final e in mediaEntries) {
          if (e.path == oldPath) {
            e.path = newPath;
            e.uncompressedData = mp3Bytes;
          }
        }
      }
    }
  }

  if (mutations['replaceEntryWithFlacBytesKeepingWavManifest'] != null) {
    final stemId =
        mutations['replaceEntryWithFlacBytesKeepingWavManifest'] as String;
    for (final s in stems) {
      if (s['id'] == stemId) {
        final flacBytes = buildSyntheticFlac(
          seed: 42,
          bitsPerSample: 16,
          totalSamples: s['decodedFrames'] as int,
        );
        s['byteLength'] = flacBytes.length;
        s['sha256'] = IncrementalSha256.computeHex(flacBytes);
        for (final e in mediaEntries) {
          if (e.path == s['path']) {
            e.uncompressedData = flacBytes;
          }
        }
      }
    }
  }

  if (mutations['embedNestedZipMagic'] != null) {
    final stemId = mutations['embedNestedZipMagic'] as String;
    for (final s in stems) {
      if (s['id'] == stemId) {
        final payload = Uint8List.fromList([
          0x50, 0x4B, 0x03, 0x04, ...List<int>.filled(64, 0x41),
        ]);
        s['byteLength'] = payload.length;
        s['sha256'] = IncrementalSha256.computeHex(payload);
        for (final e in mediaEntries) {
          if (e.path == s['path']) {
            e.uncompressedData = payload;
          }
        }
      }
    }
  }

  if (mutations['manifestPaddingBytes'] != null) {
    final padLen = mutations['manifestPaddingBytes'] as int;
    manifest['padding'] = 'p' * padLen;
  }

  final manifestBytes = Uint8List.fromList(utf8.encode(jsonEncode(manifest)));
  final manifestEntry = SyntheticZipEntry(
    path: 'manifest.json',
    uncompressedData: manifestBytes,
    compressionMethod: manifestCompression,
  );

  if (mutations['spoofManifestDeclaredSize'] != null) {
    manifestEntry.overrideDeclaredUncompressedSize =
        mutations['spoofManifestDeclaredSize'] as int;
  }

  if (mutations['deflateBombManifest'] == true) {
    final bombPlain = Uint8List(120000);
    final bombCompressed = Uint8List.fromList(
      ZLibEncoder(raw: true).convert(bombPlain),
    );
    manifestEntry.compressionMethod = 8;
    manifestEntry.overrideCompressedData = bombCompressed;
    manifestEntry.overrideDeclaredUncompressedSize = 1000;
    manifestEntry.overrideCrc32 = IncrementalCrc32.compute(bombPlain);
  }

  final allEntries = <SyntheticZipEntry>[manifestEntry, ...mediaEntries];

  if (mutations['audioCompressionDeflate'] != null) {
    final targetPath = mutations['audioCompressionDeflate'] as String;
    for (final e in allEntries) {
      if (e.path == targetPath) {
        e.compressionMethod = 8;
      }
    }
  }

  if (mutations['flipPayloadByteWithoutUpdatingCrc'] != null) {
    final targetPath =
        mutations['flipPayloadByteWithoutUpdatingCrc'] as String;
    for (final e in allEntries) {
      if (e.path == targetPath) {
        e.flipPayloadByte = true;
      }
    }
  }

  if (mutations['renameZipEntry'] != null) {
    final rename = mutations['renameZipEntry'] as Map<String, dynamic>;
    final from = rename['from'] as String;
    final to = rename['to'] as String;
    for (final e in allEntries) {
      if (e.path == from) {
        e.path = to;
      }
    }
  }

  if (mutations['duplicateZipEntry'] != null) {
    final dup = mutations['duplicateZipEntry'] as Map<String, dynamic>;
    final copyFrom = dup['copyFrom'] as String;
    final newPath = dup['newPath'] as String;
    final sourceEntry = allEntries.firstWhere((e) => e.path == copyFrom);
    allEntries.add(
      SyntheticZipEntry(
        path: newPath,
        uncompressedData: sourceEntry.uncompressedData,
      ),
    );
  }

  if (mutations['addCollidingUnicodePair'] == true) {
    allEntries.add(
      SyntheticZipEntry(
        path: 'extra/can\u00e7\u00e3o.txt',
        uncompressedData: Uint8List.fromList(utf8.encode('nfc')),
      ),
    );
    allEntries.add(
      SyntheticZipEntry(
        path: 'extra/canc\u0327a\u0303o.txt',
        uncompressedData: Uint8List.fromList(utf8.encode('nfd')),
      ),
    );
  }

  if (mutations['setEncryptedFlag'] != null) {
    final targetPath = mutations['setEncryptedFlag'] as String;
    for (final e in allEntries) {
      if (e.path == targetPath) {
        e.flags |= 0x0001;
      }
    }
  }

  if (mutations['setSymlinkAttr'] != null) {
    final targetPath = mutations['setSymlinkAttr'] as String;
    for (final e in allEntries) {
      if (e.path == targetPath) {
        e.externalAttr = 0xA000 << 16;
      }
    }
  }

  if (mutations['addExtraZipEntry'] != null) {
    final extra = mutations['addExtraZipEntry'] as Map<String, dynamic>;
    allEntries.add(
      SyntheticZipEntry(
        path: extra['path'] as String,
        uncompressedData: Uint8List.fromList(utf8.encode(extra['text'] as String)),
      ),
    );
  }

  if (mutations['overlappingEntries'] == true && allEntries.length >= 2) {
    allEntries[1].overlapPreviousByBytes = 10;
  }

  if (mutations['padToEntryCount'] != null) {
    final targetCount = mutations['padToEntryCount'] as int;
    var idx = 0;
    while (allEntries.length < targetCount) {
      allEntries.add(
        SyntheticZipEntry(
          path: 'extra/pad_${idx.toString().padLeft(2, '0')}.txt',
          uncompressedData: Uint8List.fromList(utf8.encode('pad$idx')),
        ),
      );
      idx++;
    }
  }

  final truncateTail = (mutations['truncateTailBytes'] as int?) ?? 0;
  final zipBytes = buildSyntheticZip(allEntries, truncateTailBytes: truncateTail);

  final existingPackages = <ExistingRehearsalPackage>[];
  final existingSeed = mutations['existingPackageSeed'] as String?;
  if (existingSeed != null) {
    final pkgId = (manifest['packageId'] as String).toLowerCase();
    final manifestSha = IncrementalSha256.computeHex(manifestBytes);
    if (existingSeed == 'same_identity_same_hash') {
      final sortedMedia = [...mediaMetaForComposite]
        ..sort((a, b) => a.path.compareTo(b.path));
      final compBuf = StringBuffer('$manifestSha\n');
      for (final m in sortedMedia) {
        final mSha = IncrementalSha256.computeHex(m.bytes);
        compBuf.write('${m.role}:${m.path}:$mSha:${m.bytes.length}\n');
      }
      final compositeSha = IncrementalSha256.computeHex(
        utf8.encode(compBuf.toString()),
      );
      existingPackages.add(
        ExistingRehearsalPackage(
          packageId: pkgId,
          compositeSha256: compositeSha,
          manifestSha256: manifestSha,
        ),
      );
    } else if (existingSeed == 'same_identity_different_hash') {
      existingPackages.add(
        ExistingRehearsalPackage(
          packageId: pkgId,
          compositeSha256: 'f' * 64,
          manifestSha256: 'e' * 64,
        ),
      );
    }
  }

  final options = RehearsalValidationOptions(
    existingPackages: existingPackages,
    availableStorageBytes: rawOpts['availableStorageBytes'] as int?,
  );

  return SynthesizedCorpusCase(
    id: id,
    description: description,
    bytes: zipBytes,
    options: options,
    expected: expected,
  );
}
