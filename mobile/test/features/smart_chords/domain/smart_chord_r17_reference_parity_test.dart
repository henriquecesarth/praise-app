import 'package:flutter_test/flutter_test.dart';
import '../../../support/music_theory_corpus.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

class _ReferenceCase {
  final String id;
  final String source;
  final String expectedPlusTwo;
  final bool unicode;

  const _ReferenceCase({
    required this.id,
    required this.source,
    required this.expectedPlusTwo,
    this.unicode = false,
  });
}

final _referenceCases = (loadMusicTheoryCorpus()['legacyNotation'] as List)
    .cast<Map<String, dynamic>>()
    .map(
      (row) => _ReferenceCase(
        id: row['id'] as String,
        source: row['source'] as String,
        expectedPlusTwo: row['expectedPlusTwo'] as String,
        unicode: row['unicode'] as bool? ?? false,
      ),
    )
    .toList();

void main() {
  group('Smart Chords R17 34-case Web reference parity', () {
    for (final refCase in _referenceCases) {
      test(
        '${refCase.id}: 0 semitones is byte-for-byte identity and +2 matches expectedPlusTwo',
        () {
          expect(
            SmartChordParser.transposeSmartChord(refCase.source, 0),
            refCase.source,
          );
          expect(
            SmartChordParser.transposeSmartChord(refCase.source, 2),
            refCase.expectedPlusTwo,
          );
        },
      );
    }

    test('extracts semantic musical instructions ({{...}} and {{^...}})', () {
      const sample =
          '{{^Entrada: baixo}}\n| C | G {{Dinâmica: suave}} |\n{{Execução: arpejo}}';
      final instructions = SmartChordParser.extractMusicalInstructions(sample);
      expect(instructions, hasLength(3));
      expect(instructions[0].kind, AnnotationKind.entry);
      expect(instructions[0].displayText, 'baixo');
      expect(instructions[0].placement, AnnotationPlacement.aboveNextChord);

      expect(instructions[1].kind, AnnotationKind.dynamics);
      expect(instructions[1].displayText, 'suave');
      expect(instructions[1].placement, AnnotationPlacement.inline);

      expect(instructions[2].kind, AnnotationKind.technique);
      expect(instructions[2].displayText, 'arpejo');
      expect(instructions[2].placement, AnnotationPlacement.line);
    });
  });
}
