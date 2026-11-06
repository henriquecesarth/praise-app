import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';

File _findMatrixFile() {
  final candidates = [
    File('../backend/src/features/repertoire/__fixtures__/bpm-contract-matrix.json'),
    File('backend/src/features/repertoire/__fixtures__/bpm-contract-matrix.json'),
    File('../../backend/src/features/repertoire/__fixtures__/bpm-contract-matrix.json'),
  ];
  for (final f in candidates) {
    if (f.existsSync()) return f;
  }
  throw StateError('bpm-contract-matrix.json not found in candidate paths');
}

void main() {
  final matrixFile = _findMatrixFile();
  final matrixJson = jsonDecode(matrixFile.readAsStringSync()) as Map<String, dynamic>;
  final cases = (matrixJson['cases'] as List).cast<Map<String, dynamic>>();

  final acceptedCases = cases.where((c) => c['kind'] == 'accepted').toList();
  final rejectedCases = cases.where((c) => c['kind'] == 'rejected').toList();
  final legacyCases = cases.where((c) => c['kind'] == 'legacy').toList();

  group('Mobile BPM Contract Matrix', () {
    group('Accepted Cases', () {
      for (final c in acceptedCases) {
        test('${c['id']}: parsing and unrelated edit wire serialization', () {
          final input = c['input'];
          final expectStored = c['expectStored'];
          final mobileWire = c['mobileWire'] as Map<String, dynamic>?;

          final songJson = {
            'id': 'song-bpm',
            'ministry_id': 'min-alpha',
            'title': 'Contrato BPM',
            'bpm': input,
            'versions': [
              {
                'id': 'v1',
                'name': 'Original',
                'key': 'E',
                'bpm': input,
                'classificationIds': <String>[],
                'links': <dynamic>[],
              },
              {
                'id': 'v2',
                'name': 'Live',
                'key': null,
                'bpm': input,
                'notes': 'nota v2',
                'classificationIds': <String>[],
                'links': <dynamic>[],
              },
              {
                'id': 'v3',
                'name': 'Sibling',
                'key': 'G',
                'bpm': 'Allegro',
                'classificationIds': <String>[],
                'links': <dynamic>[],
              },
            ],
          };

          final detail = SongDetail.fromJson(songJson);
          expect(detail.bpm, equals(expectStored), reason: 'flat bpm');
          expect(detail.versions[0].bpm, equals(expectStored), reason: 'v1 bpm');
          expect(detail.versions[1].bpm, equals(expectStored), reason: 'v2 bpm');
          expect(detail.versions[2].bpm, equals('Allegro'), reason: 'v3 sibling bpm');

          final summary = SongSummary.fromJson(songJson);
          expect(summary.bpm, equals(expectStored), reason: 'summary flat bpm');
          expect(summary.versions[0].bpm, equals(expectStored), reason: 'summary v1 bpm');

          // Unrelated edit: rename secondary version without touching BPM
          final formData = SongFormData(
            title: detail.title,
            bpm: detail.bpm,
            versions: [
              detail.versions[0],
              detail.versions[1].copyWith(name: 'Live Renamed'),
              detail.versions[2],
            ],
          );
          final serialized = formData.toJson();
          final versionsSerialized = serialized['versions'] as List;

          if (mobileWire != null && mobileWire['omit'] == true) {
            expect((versionsSerialized[0] as Map).containsKey('bpm'), isFalse);
            expect((versionsSerialized[1] as Map).containsKey('bpm'), isFalse);
          } else if (mobileWire != null && mobileWire.containsKey('send')) {
            final expectedSend = mobileWire['send'];
            expect((versionsSerialized[0] as Map)['bpm'], equals(expectedSend));
            expect((versionsSerialized[1] as Map)['bpm'], equals(expectedSend));
          }

          // Sibling version preservation
          expect((versionsSerialized[2] as Map)['name'], equals('Sibling'));
          expect((versionsSerialized[2] as Map)['key'], equals('G'));
          expect((versionsSerialized[2] as Map)['bpm'], equals('Allegro'));
        });
      }
    });

    group('Rejected Cases', () {
      for (final c in rejectedCases) {
        test('${c['id']}: rejected as user-entered draft', () {
          final input = c['input'];
          final parsed = parseBpmValue(input, trimString: true);
          expect(parsed, isNull, reason: '$input should be rejected by user-entry validation');
        });
      }
    });

    group('Legacy Cases', () {
      for (final c in legacyCases) {
        test('${c['id']}: stored legacy preservation and unrelated edit wire serialization', () {
          final stored = c['stored'];
          final mobileWire = c['mobileWire'] as Map<String, dynamic>?;

          final songJson = {
            'id': 'song-bpm',
            'ministry_id': 'min-alpha',
            'title': 'Contrato BPM',
            'bpm': stored,
            'versions': [
              {
                'id': 'v1',
                'name': 'Original',
                'key': 'E',
                'bpm': stored,
                'classificationIds': <String>[],
                'links': <dynamic>[],
              },
              {
                'id': 'v2',
                'name': 'Live',
                'key': null,
                'bpm': stored,
                'notes': 'nota v2',
                'classificationIds': <String>[],
                'links': <dynamic>[],
              },
              {
                'id': 'v3',
                'name': 'Sibling',
                'key': 'G',
                'bpm': 'Allegro',
                'classificationIds': <String>[],
                'links': <dynamic>[],
              },
            ],
          };

          final detail = SongDetail.fromJson(songJson);
          expect(detail.bpm, equals(stored), reason: 'legacy flat bpm preserved');
          expect(detail.versions[0].bpm, equals(stored), reason: 'legacy v1 bpm preserved');
          expect(detail.versions[1].bpm, equals(stored), reason: 'legacy v2 bpm preserved');
          expect(detail.versions[2].bpm, equals('Allegro'), reason: 'v3 sibling bpm preserved');

          final summary = SongSummary.fromJson(songJson);
          expect(summary.bpm, equals(stored), reason: 'summary legacy flat bpm preserved');
          expect(summary.versions[0].bpm, equals(stored), reason: 'summary legacy v1 bpm preserved');

          // Unrelated edit: rename secondary version without touching BPM
          final formData = SongFormData(
            title: detail.title,
            bpm: detail.bpm,
            versions: [
              detail.versions[0],
              detail.versions[1].copyWith(name: 'Live Renamed'),
              detail.versions[2],
            ],
          );
          final serialized = formData.toJson();
          final versionsSerialized = serialized['versions'] as List;

          if (mobileWire != null && mobileWire['omit'] == true) {
            expect((versionsSerialized[0] as Map).containsKey('bpm'), isFalse,
                reason: 'legacy out-of-range BPM should be omitted on unrelated edit');
            expect((versionsSerialized[1] as Map).containsKey('bpm'), isFalse,
                reason: 'legacy out-of-range BPM should be omitted on unrelated edit');
          } else if (mobileWire != null && mobileWire.containsKey('send')) {
            final expectedSend = mobileWire['send'];
            expect((versionsSerialized[0] as Map)['bpm'], equals(expectedSend));
            expect((versionsSerialized[1] as Map)['bpm'], equals(expectedSend));
          }

          // Sibling version preservation
          expect((versionsSerialized[2] as Map)['name'], equals('Sibling'));
          expect((versionsSerialized[2] as Map)['key'], equals('G'));
          expect((versionsSerialized[2] as Map)['bpm'], equals('Allegro'));
        });
      }
    });
  });
}
