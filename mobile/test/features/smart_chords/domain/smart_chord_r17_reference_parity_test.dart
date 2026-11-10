import 'package:flutter_test/flutter_test.dart';
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

const _referenceCases = <_ReferenceCase>[
  _ReferenceCase(
    id: 'simple-four-bars',
    source: '| C | Am | F | G |',
    expectedPlusTwo: '| D | Bm | G | A |',
  ),
  _ReferenceCase(
    id: 'repeat-delimiters',
    source: '||: C | Am | F | G :||',
    expectedPlusTwo: '||: D | Bm | G | A :||',
  ),
  _ReferenceCase(
    id: 'two-chords-per-measure',
    source: '| C Am | F G |',
    expectedPlusTwo: '| D Bm | G A |',
  ),
  _ReferenceCase(
    id: 'optional-chord',
    source: '| C (Am) | F G |',
    expectedPlusTwo: '| D (Bm) | G A |',
  ),
  _ReferenceCase(
    id: 'adjacent-optional-chord',
    source: '| C(Am) | F G |',
    expectedPlusTwo: '| D(Bm) | G A |',
  ),
  _ReferenceCase(
    id: 'three-chords-in-measure',
    source: '| C G/B Am | F G C |',
    expectedPlusTwo: '| D A/C# Bm | G A D |',
  ),
  _ReferenceCase(
    id: 'slash-bass',
    source: '| C/E | F/A | G/B |',
    expectedPlusTwo: '| D/F# | G/B | A/C# |',
  ),
  _ReferenceCase(
    id: 'complex-additions',
    source: '| F9 | Gsus4 G | Am7 |',
    expectedPlusTwo: '| G9 | Asus4 A | Bm7 |',
  ),
  _ReferenceCase(
    id: 'extended-ninth',
    source: '| C7(b9) | F#m7(b5) |',
    expectedPlusTwo: '| D7(b9) | G#m7(b5) |',
  ),
  _ReferenceCase(
    id: 'parenthesized-add',
    source: '| C(add9) | C(add9)/E |',
    expectedPlusTwo: '| D(add9) | D(add9)/F# |',
  ),
  _ReferenceCase(
    id: 'numeric-extension',
    source: '| A7M/9 |',
    expectedPlusTwo: '| B7M/9 |',
  ),
  _ReferenceCase(
    id: 'accidental-ascii',
    source: '| C# | Bb/F |',
    expectedPlusTwo: '| D# | C/G |',
  ),
  _ReferenceCase(
    id: 'repeat-previous-bar',
    source: '| C | % | Am | % |',
    expectedPlusTwo: '| D | % | Bm | % |',
  ),
  _ReferenceCase(
    id: 'no-chord-symbol',
    source: '| C | N.C. | G |',
    expectedPlusTwo: '| D | N.C. | A |',
  ),
  _ReferenceCase(
    id: 'repeat-count',
    source: '||: Am7 | D7/F# | G :|| 2x',
    expectedPlusTwo: '||: Bm7 | E7/G# | A :|| 2x',
  ),
  _ReferenceCase(
    id: 'legacy-bracket-progression',
    source: '[| C | Am | F | G |]',
    expectedPlusTwo: '[| D | Bm | G | A |]',
  ),
  _ReferenceCase(
    id: 'hyphen-not-tablature',
    source: '| C | Am - | F | G |',
    expectedPlusTwo: '| D | Bm - | G | A |',
  ),
  _ReferenceCase(
    id: 'annotation-above',
    source: '{{^Entrada: baixo}}\n| C | Am |',
    expectedPlusTwo: '{{^Entrada: baixo}}\n| D | Bm |',
  ),
  _ReferenceCase(
    id: 'annotation-inline',
    source: '| C {{Só violão}} | Am |',
    expectedPlusTwo: '| D {{Só violão}} | Bm |',
  ),
  _ReferenceCase(
    id: 'annotation-line',
    source: '{{Só violão}}\n| C | G |',
    expectedPlusTwo: '{{Só violão}}\n| D | A |',
  ),
  _ReferenceCase(
    id: 'musical-typed-annotations',
    source: '{{Execução: arpejo}}\n| C | G {{Dinâmica: suave}} |',
    expectedPlusTwo: '{{Execução: arpejo}}\n| D | A {{Dinâmica: suave}} |',
  ),
  _ReferenceCase(
    id: 'chords-over-lyrics',
    source: '| C | Am |\nA vida florescerá',
    expectedPlusTwo: '| D | Bm |\nA vida florescerá',
  ),
  _ReferenceCase(
    id: 'bracket-syllabic',
    source: '[C]Can[Am]ta com alegria',
    expectedPlusTwo: '[D]Can[Bm]ta com alegria',
  ),
  _ReferenceCase(
    id: 'section-and-chords',
    source: '[Verso 1]\n[C]Luz [F]e paz',
    expectedPlusTwo: '[Verso 1]\n[D]Luz [G]e paz',
  ),
  _ReferenceCase(
    id: 'tablature-preserved',
    source: 'e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|',
    expectedPlusTwo: 'e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|',
  ),
  _ReferenceCase(
    id: 'whitespace-blank',
    source: '  {{Só violão}}\n\n\t\n| C  Am | F G |\n',
    expectedPlusTwo: '  {{Só violão}}\n\n\t\n| D  Bm | G A |\n',
  ),
  _ReferenceCase(
    id: 'crlf-and-unicode',
    source: '[Verso]\r\n| C | G |\r\nGlória 🙌\r\n',
    expectedPlusTwo: '[Verso]\r\n| D | A |\r\nGlória 🙌\r\n',
  ),
  _ReferenceCase(
    id: 'unterminated-annotation',
    source: '{{incompleta\n| C | G |',
    expectedPlusTwo: '{{incompleta\n| D | A |',
  ),
  _ReferenceCase(
    id: 'nonchord-parentheses',
    source: '| C (livre) | G |',
    expectedPlusTwo: '| D (livre) | A |',
  ),
  _ReferenceCase(
    id: 'unicode-flat-sharp-natural',
    source: '| B♭maj7 | F♯m | E♮ |',
    expectedPlusTwo: '| Cmaj7 | G♯m | F♯ |',
    unicode: true,
  ),
  _ReferenceCase(
    id: 'unicode-bass',
    source: '| D♭m | F♯/C♯ |',
    expectedPlusTwo: '| E♭m | G♯/D♯ |',
    unicode: true,
  ),
  _ReferenceCase(
    id: 'unicode-lyric-annotation',
    source: '{{Baixo em B♭}}\n| B♭ |',
    expectedPlusTwo: '{{Baixo em B♭}}\n| C |',
    unicode: true,
  ),
  _ReferenceCase(
    id: 'unicode-bracket-chord',
    source: '[B♭]Luz e paz',
    expectedPlusTwo: '[C]Luz e paz',
    unicode: true,
  ),
  _ReferenceCase(
    id: 'unicode-plain-lyric',
    source: 'Em B♭ cantamos',
    expectedPlusTwo: 'Em B♭ cantamos',
    unicode: true,
  ),
];

void main() {
  group('Smart Chords R17 34-case Web reference parity', () {
    for (final refCase in _referenceCases) {
      test('${refCase.id}: 0 semitones is byte-for-byte identity and +2 matches expectedPlusTwo', () {
        expect(
          SmartChordParser.transposeSmartChord(refCase.source, 0),
          refCase.source,
        );
        expect(
          SmartChordParser.transposeSmartChord(refCase.source, 2),
          refCase.expectedPlusTwo,
        );
      });
    }

    test('extracts semantic musical instructions ({{...}} and {{^...}})', () {
      const sample = '{{^Entrada: baixo}}\n| C | G {{Dinâmica: suave}} |\n{{Execução: arpejo}}';
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
