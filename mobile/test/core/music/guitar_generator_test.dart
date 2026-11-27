import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/music/guitar_generator.dart';
import 'package:louvaio_mobile/core/music/guitar_voicings.dart';
import 'package:louvaio_mobile/core/music/guitar_voicings_catalog_v2.g.dart';
import 'package:louvaio_mobile/core/music/theory.dart';

Map<String, dynamic> _read(String name) {
  var file = File('../shared/fixtures/$name');
  if (!file.existsSync()) file = File('shared/fixtures/$name');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

Map<String, Object?> _shape(GuitarVoicing v) => {
  'frets': v.strings
      .map((s) => s.fret == null ? 'x' : s.fret!.toRadixString(36))
      .join(),
  'fingers': v.strings.map((s) => s.finger ?? 0).join(),
  'barres': [
    for (final b in v.barres)
      '${b.fret}:${b.fromStringNumber}-${b.toStringNumber}:${b.finger}',
  ],
  'omits': v.omits,
  'baseFret': v.baseFret,
  'notes': v.soundingNotes,
};

GuitarVoicingValidationResult _validate(String text, String symbol) {
  final chord = parseChord(symbol) as Parsed<ChordNormalized>;
  return validateGuitarVoicing(expandShape(decodeShape(text), chord, 0));
}

void main() {
  group('guitar generator and catalog v2', () {
    final cases = (_read('guitar-generator-v1.json')['cases'] as List)
        .cast<Map<String, dynamic>>();

    for (final vector in cases) {
      final chord = vector['chord'] as String;
      test('$chord matches the shared corpus', () {
        expect(
          generateGuitarVoicings(chord).map(_shape).toList(),
          vector['generated'],
        );
        final result = findGuitarVoicings(chord);
        expect(result.voicings.map(_shape).toList(), vector['found']);
        expect(result.bassClassification?.name, vector['bassClassification']);
        expect(result.reason, vector['reason']);
      });
    }

    test('embeds the same catalog as the shared JSON', () {
      final chords = _read('guitar-voicings-v2.json')['chords'] as Map;
      expect(kGuitarCatalogV2Shapes, chords);
    });

    test('keeps every catalog shape valid and round-trips the encoding', () {
      final failures = <String>[];
      for (final entry in kGuitarCatalogV2Shapes.entries) {
        for (final text in entry.value) {
          if (!_validate(text, entry.key).valid ||
              encodeShape(decodeShape(text)) != text) {
            failures.add('${entry.key} $text');
          }
        }
      }
      expect(failures, isEmpty);
    });

    test('accepts only a declared perfect fifth omission', () {
      List<String> codes(String text, String symbol) =>
          _validate(text, symbol).issues.map((i) => i.code).toList();
      expect(codes('x3231x 032410 gen', 'C7'), contains('missingChordTone'));
      expect(_validate('x3231x 032410 o5 gen', 'C7').valid, isTrue);
      expect(codes('x32010 032010 o5 gen', 'C7M'), contains('invalidOmission'));
      expect(codes('x32x10 032010 o5 gen', 'C'), contains('missingChordTone'));
    });
  });
}
