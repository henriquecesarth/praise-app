import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';

import '../ministry_audio_fixtures.dart';

void expectInvalid(void Function() body, {String? code}) {
  expect(
    body,
    throwsA(
      isA<AppFailure>().having(
        (f) => f.code,
        'code',
        code ?? MinistryAudioContract.invalidCode,
      ),
    ),
  );
}

void main() {
  group('MinistryAudioManifest (WAV v1)', () {
    test('accepts a valid manifest and orders stems canonically', () {
      final shuffled = [for (final s in stemIds.reversed) stemJson(s)];
      final m = MinistryAudioManifest.fromJson(manifestJson(stems: shuffled));
      expect(m.recordingId, recordingId);
      expect(m.stems.map((s) => s.id.name).toList(), stemIds);
      expect(m.sampleRate, 44100);
      expect(m.frames, 88200);
      expect(m.durationSeconds, 2.0);
      expect(() => m.stems.add(m.stems.first), throwsUnsupportedError);
    });

    test('rejects missing stems', () {
      expectInvalid(() => MinistryAudioManifest.fromJson(manifestJson(
          stems: [for (final s in stemIds.take(5)) stemJson(s)])));
    });

    test('rejects duplicated stems even with six entries', () {
      final stems = [for (final s in stemIds.take(5)) stemJson(s), stemJson('vocals')];
      expectInvalid(
          () => MinistryAudioManifest.fromJson(manifestJson(stems: stems)));
    });

    test('rejects non-canonical stem id', () {
      final stems = [for (final s in stemIds.take(5)) stemJson(s), stemJson('strings')];
      expectInvalid(
          () => MinistryAudioManifest.fromJson(manifestJson(stems: stems)));
    });

    test('rejects stems with different frames or sample rate', () {
      final frames = [
        for (final s in stemIds.take(5)) stemJson(s),
        stemJson('other', frames: 44100),
      ];
      expectInvalid(
          () => MinistryAudioManifest.fromJson(manifestJson(stems: frames)));
      final rates = [
        for (final s in stemIds.take(5)) stemJson(s),
        stemJson('other', sampleRate: 48000),
      ];
      expectInvalid(
          () => MinistryAudioManifest.fromJson(manifestJson(stems: rates)));
    });

    final badStems = <String, Map<String, dynamic>>{
      'size inconsistent with frames': {'sizeBytes': 44 + 88200 * 4 + 1},
      'duration inconsistent with frames': {'durationSeconds': 2.5},
      'zero frames': {'frames': 0},
      'negative frames': {'frames': -1},
      'float frames': {'frames': 88200.0},
      'mono': {'channels': 1},
      'sample rate below 8 kHz': {'sampleRate': 7999},
      'sample rate above 48 kHz': {'sampleRate': 48001},
      'uppercase sha256': {'sha256': 'C' * 64},
      'short sha256': {'sha256': 'c' * 63},
      'non-hex sha256': {'sha256': 'g' * 64},
      'unknown field': {'extra': true},
      'unknown codec': {'codec': 'flac'},
      'duration over 300 s': {
        'durationSeconds': 301.0,
        'frames': 301 * 44100,
        'sizeBytes': 44 + 301 * 44100 * 4,
      },
    };
    badStems.forEach((name, override) {
      test('rejects stem: $name', () {
        final stems = [
          for (final s in stemIds.take(5)) stemJson(s),
          stemJson('other', override: override),
        ];
        expectInvalid(
            () => MinistryAudioManifest.fromJson(manifestJson(stems: stems)));
      });
    });

    test('rejects malformed recording id, model and unknown manifest keys', () {
      expectInvalid(() => MinistryAudioManifest.fromJson(
          manifestJson(override: {'recordingId': 'ABC'})));
      expectInvalid(() => MinistryAudioManifest.fromJson(
          manifestJson(override: {'model': {'id': '', 'version': '1'}})));
      expectInvalid(() => MinistryAudioManifest.fromJson(
          manifestJson(override: {'extra': 1})));
      expectInvalid(() => MinistryAudioManifest.fromJson('not a map'));
    });

    test('rejects MP3 stems with the unsupported-codec code', () {
      final stems = [
        for (final s in stemIds.take(5)) stemJson(s),
        stemJson('other', override: {'codec': 'mp3_cbr256'}),
      ];
      expectInvalid(
        () => MinistryAudioManifest.fromJson(manifestJson(stems: stems)),
        code: MinistryAudioContract.unsupportedCodecCode,
      );
    });

    test('rejects schema v2 and unknown schema versions', () {
      expectInvalid(
        () => MinistryAudioManifest.fromJson(
            manifestJson(override: {'schemaVersion': 2})),
        code: MinistryAudioContract.unsupportedSchemaCode,
      );
      expectInvalid(
        () => MinistryAudioManifest.fromJson(
            manifestJson(override: {'schemaVersion': 3})),
        code: MinistryAudioContract.unsupportedSchemaCode,
      );
      final noVersion = manifestJson()..remove('schemaVersion');
      expectInvalid(() => MinistryAudioManifest.fromJson(noVersion),
          code: MinistryAudioContract.unsupportedSchemaCode);
    });
  });

  group('MinistryAudioPlayback', () {
    test('parses direct mode with headers and redacts toString', () {
      final p = MinistryAudioPlayback.fromJson(directPlaybackJson());
      expect(p.transfer, MinistryAudioTransfer.direct);
      expect(p.tracks.map((t) => t.id.name).toList(), stemIds);
      expect(p.tracks.first.headers['x-amz-test'], 'token-vocals');
      expect(p.tracks.first.url, contains('SECRETvocals'));
      expect(p.toString(), isNot(contains('SECRET')));
      expect(p.tracks.first.toString(), isNot(contains('SECRET')));
      expect(p.tracks.first.toString(), isNot(contains('r2.example')));
      expect(p.isExpired(1900000000001), isTrue);
      expect(p.isExpired(1), isFalse);
    });

    test('parses legacy mode (no transfer field)', () {
      final p = MinistryAudioPlayback.fromJson(legacyPlaybackJson());
      expect(p.transfer, MinistryAudioTransfer.legacy);
      expect(p.tracks.first.headers, isEmpty);
      expect(p.tracks.first.url, startsWith('/$recordingId/stems/vocals?ticket='));
    });

    test('rejects invalid transfer, missing/duplicate tracks and bad URLs', () {
      expectInvalid(() => MinistryAudioPlayback.fromJson(
          {...directPlaybackJson(), 'transfer': 'stream'}));
      final missing = directPlaybackJson();
      (missing['tracks'] as List).removeLast();
      expectInvalid(() => MinistryAudioPlayback.fromJson(missing));
      final dup = directPlaybackJson();
      (dup['tracks'] as List)[5] = (dup['tracks'] as List)[0];
      expectInvalid(() => MinistryAudioPlayback.fromJson(dup));
      final relDirect = directPlaybackJson();
      ((relDirect['tracks'] as List)[0] as Map)['url'] = '/relative';
      expectInvalid(() => MinistryAudioPlayback.fromJson(relDirect));
      final creds = directPlaybackJson();
      ((creds['tracks'] as List)[0] as Map)['url'] = 'https://u:p@host.test/x';
      expectInvalid(() => MinistryAudioPlayback.fromJson(creds));
      final scheme = directPlaybackJson();
      ((scheme['tracks'] as List)[0] as Map)['url'] = 'file:///etc/passwd';
      expectInvalid(() => MinistryAudioPlayback.fromJson(scheme));
      final wrongStem = legacyPlaybackJson();
      ((wrongStem['tracks'] as List)[0] as Map)['url'] =
          '/$recordingId/stems/drums?ticket=1.x';
      expectInvalid(() => MinistryAudioPlayback.fromJson(wrongStem));
      final otherRec = legacyPlaybackJson();
      ((otherRec['tracks'] as List)[0] as Map)['url'] =
          '/$otherRecordingId/stems/vocals?ticket=1.x';
      expectInvalid(() => MinistryAudioPlayback.fromJson(otherRec));
      final badHeaders = directPlaybackJson();
      ((badHeaders['tracks'] as List)[0] as Map)['headers'] = {'a': 1};
      expectInvalid(() => MinistryAudioPlayback.fromJson(badHeaders));
      expectInvalid(() => MinistryAudioPlayback.fromJson(
          {...directPlaybackJson(), 'expiresAt': 0}));
      expectInvalid(() => MinistryAudioPlayback.fromJson(
          {...directPlaybackJson(), 'extra': 1}));
    });

    test('propagates MP3 / v2 rejection from the manifest', () {
      final v2 = directPlaybackJson();
      (v2['manifest'] as Map)['schemaVersion'] = 2;
      expectInvalid(() => MinistryAudioPlayback.fromJson(v2),
          code: MinistryAudioContract.unsupportedSchemaCode);
    });
  });

  group('MinistryAudioPage', () {
    test('parses items and cursor', () {
      final page = MinistryAudioPage.fromJson({
        'items': [recordingJson(), recordingJson(id: otherRecordingId)],
        'nextCursor': 'abc_DEF-123',
      });
      expect(page.items.length, 2);
      expect(page.hasMore, isTrue);
      expect(page.items.first.status, MinistryAudioStatus.published);
      final last = MinistryAudioPage.fromJson({'items': [], 'nextCursor': null});
      expect(last.hasMore, isFalse);
    });

    test('rejects bad cursor, item shape and unknown status', () {
      expectInvalid(() =>
          MinistryAudioPage.fromJson({'items': [], 'nextCursor': 'a b!'}));
      expectInvalid(() => MinistryAudioPage.fromJson({'items': 'x'}));
      expectInvalid(() => MinistryAudioPage.fromJson({
            'items': [
              {...recordingJson(), 'status': 'draft'}
            ],
            'nextCursor': null,
          }));
      expectInvalid(() => MinistryAudioPage.fromJson({
            'items': [
              {...recordingJson(), 'id': 'short'}
            ],
            'nextCursor': null,
          }));
    });
  });
}
