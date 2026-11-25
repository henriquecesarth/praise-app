import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';

// M22-S4-A: strict, opt-in reading of MP3 v2 manifests. WAV v1 behaviour is covered by ministry_audio_models_test.dart.

Matcher _code(String code) => isA<AppFailure>().having((f) => f.code, 'code', code);
final _invalid = _code(MinistryAudioContract.invalidCode);

MinistryAudioManifest _parse(Map<String, dynamic> json) => MinistryAudioManifest.fromJson(json, allowMp3: true);

Map<String, dynamic> _withStem(String id, Map<String, dynamic> Function(Map<String, dynamic>) change) => mp3ManifestJson(
      stems: [for (final s in stemIds) s == id ? change(mp3StemJson(s)) : mp3StemJson(s)],
    );

void main() {
  test('the experimental flag is off by default and MP3 stays unsupported without opt-in', () {
    expect(MinistryAudioFeatureFlags.experimentalMp3, isFalse);
    expect(() => MinistryAudioManifest.fromJson(mp3ManifestJson()), throwsA(_code(MinistryAudioContract.unsupportedSchemaCode)));
    expect(() => MinistryAudioPlayback.fromJson(mp3PlaybackJson()), throwsA(_code(MinistryAudioContract.unsupportedSchemaCode)));
    // A stem alone, without opt-in, is the unsupported-codec failure it always was.
    expect(() => MinistryAudioStem.fromJson(mp3StemJson('vocals')), throwsA(_code(MinistryAudioContract.unsupportedCodecCode)));
  });

  test('a valid MP3 v2 manifest parses with its alignment, codec and schema', () {
    final m = _parse(mp3ManifestJson());
    expect(m.schemaVersion, 2);
    expect(m.codec, MinistryAudioCodec.mp3);
    expect(m.sampleRate, 44100);
    expect(m.frames, 3000);
    expect(m.stems.map((s) => s.id), MinistryStemId.values);
    final a = m.stems.first.mp3Alignment!;
    expect(a.encoderDelayFrames, 1105);
    expect(a.encoderDelayFrames + m.frames + a.paddingFrames, a.mpegAudioFrames * 1152);
    expect(m.stems.every((s) => s.mp3Alignment == a), isTrue);
  });

  for (final rate in [44100, 48000]) {
    test('sample rate $rate is accepted', () {
      final m = _parse(mp3ManifestJson(stems: [for (final s in stemIds) mp3StemJson(s, sampleRate: rate)]));
      expect(m.sampleRate, rate);
    });
  }

  test('a duration close to the 300 s limit is accepted and one frame above it is refused', () {
    const frames = 44100 * 300;
    final ok = _parse(mp3ManifestJson(stems: [for (final s in stemIds) mp3StemJson(s, frames: frames)]));
    expect(ok.frames, frames);
    expect(
      () => _parse(mp3ManifestJson(stems: [for (final s in stemIds) mp3StemJson(s, frames: frames + 1)])),
      throwsA(_invalid),
    );
    // 48 kHz: 300 s exactly is fine, but the same frame count at 44.1 kHz is longer than 300 s.
    expect(() => _parse(mp3ManifestJson(stems: [for (final s in stemIds) mp3StemJson(s, frames: 48000 * 300)])), throwsA(_invalid));
  });

  group('invalid MP3 stems fail closed', () {
    final cases = <String, Map<String, dynamic> Function(Map<String, dynamic>)>{
      'sample rate 22050': (s) => {...s, 'sampleRate': 22050},
      'mono': (s) => {...s, 'channels': 1},
      'bitrate 128': (s) => {...s, 'bitrateKbps': 128},
      'missing bitrate': (s) => {...s}..remove('bitrateKbps'),
      'unknown field': (s) => {...s, 'extra': 1},
      'missing alignment': (s) => {...s}..remove('alignment'),
      'alignment without Info frame': (s) => {...s, 'alignment': {...(s['alignment'] as Map<String, dynamic>), 'infoFrame': false}},
      'alignment with unknown field': (s) => {...s, 'alignment': {...(s['alignment'] as Map<String, dynamic>), 'x': 1}},
      'delay above the 4-frame bound': (s) => {...s, 'alignment': {...(s['alignment'] as Map<String, dynamic>), 'encoderDelayFrames': 4609}},
      'negative padding': (s) => {...s, 'alignment': {...(s['alignment'] as Map<String, dynamic>), 'paddingFrames': -1}},
      'delay+frames+padding does not match MPEG frames': (s) => {...s, 'alignment': {...(s['alignment'] as Map<String, dynamic>), 'paddingFrames': 7}},
      'size below the CBR bound': (s) => {...s, 'sizeBytes': (s['sizeBytes'] as int) - 4000},
      'size above the CBR bound': (s) => {...s, 'sizeBytes': (s['sizeBytes'] as int) + 5000},
      'duration not matching frames': (s) => {...s, 'durationSeconds': 1.0},
      'bad sha256': (s) => {...s, 'sha256': 'XYZ'},
      'non-integer frames': (s) => {...s, 'frames': 3000.5},
    };
    cases.forEach((name, change) {
      test(name, () => expect(() => _parse(_withStem('bass', change)), throwsA(_invalid)));
    });
  });

  test('mixed codecs, mixed timelines and non-canonical sets are refused', () {
    // WAV stem inside a v2 MP3 manifest
    expect(
      () => _parse(mp3ManifestJson(stems: [for (final s in stemIds) s == 'piano' ? stemJson(s) : mp3StemJson(s)])),
      throwsA(_invalid),
    );
    // MP3 stem inside a v1 manifest is the unsupported codec, even with the opt-in
    expect(
      () => _parse(manifestJson(stems: [for (final s in stemIds) s == 'piano' ? mp3StemJson(s) : stemJson(s)])),
      throwsA(_code(MinistryAudioContract.unsupportedCodecCode)),
    );
    // different sample rate / frames / alignment between stems
    expect(() => _parse(_withStem('drums', (s) => mp3StemJson('drums', sampleRate: 48000))), throwsA(_invalid));
    expect(() => _parse(_withStem('drums', (s) => mp3StemJson('drums', frames: 3001))), throwsA(_invalid));
    expect(() => _parse(_withStem('drums', (s) => mp3StemJson('drums', delay: 1106))), throwsA(_invalid));
    // fewer than six, duplicated
    expect(() => _parse(mp3ManifestJson(stems: [for (final s in stemIds.take(5)) mp3StemJson(s)])), throwsA(_invalid));
    expect(() => _parse(mp3ManifestJson(stems: [for (final _ in stemIds) mp3StemJson('vocals')])), throwsA(_invalid));
  });

  test('a v2 manifest of WAV stems stays unsupported and an unknown schema is refused', () {
    expect(() => _parse(manifestJson(override: {'schemaVersion': 2})), throwsA(_code(MinistryAudioContract.unsupportedSchemaCode)));
    expect(() => _parse(manifestJson(override: {'schemaVersion': 3})), throwsA(_code(MinistryAudioContract.unsupportedSchemaCode)));
  });

  test('WAV v1 still parses as before, with the opt-in on and off', () {
    for (final allow in [false, true]) {
      final m = MinistryAudioManifest.fromJson(manifestJson(), allowMp3: allow);
      expect(m.schemaVersion, 1);
      expect(m.codec, MinistryAudioCodec.pcm);
      expect(m.stems.every((s) => s.mp3Alignment == null), isTrue);
    }
  });

  test('MP3 playback requires direct transfer; a legacy ticket is refused', () {
    expect(MinistryAudioPlayback.fromJson(mp3PlaybackJson(), allowMp3: true).manifest.codec, MinistryAudioCodec.mp3);
    final legacy = {...legacyPlaybackJson(), 'manifest': mp3ManifestJson()};
    expect(() => MinistryAudioPlayback.fromJson(legacy, allowMp3: true), throwsA(_invalid));
  });

  test('codec metadata maps to the stored file extension', () {
    expect(MinistryAudioCodec.pcm.extension, 'wav');
    expect(MinistryAudioCodec.mp3.extension, 'mp3');
    expect(MinistryAudioCodec.mp3.wireName, 'mp3_cbr256');
  });
}
