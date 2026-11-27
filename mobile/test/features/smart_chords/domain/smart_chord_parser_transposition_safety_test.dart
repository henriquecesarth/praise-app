import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
  test('Brazilian notations transpose', () {
    const cases = {
      'C(4)': 'D(4)',
      'C7(4)': 'D7(4)',
      'C7/4(9)': 'D7/4(9)',
      'C7/4/9': 'D7/4/9',
      'D7/4(9)/F#': 'E7/4(9)/G#',
      'A7M/9': 'B7M/9',
      'Gº': 'Aº',
      'G°7': 'A°7',
      'Gø7': 'Aø7',
      'Gm(maj7)': 'Am(maj7)',
      'Cm(M7)': 'Dm(M7)',
      'C(add11)': 'D(add11)',
      'C7(#13)': 'D7(#13)',
      'C7(b11)': 'D7(b11)',
      'C#7#13': 'D#7#13',
    };
    for (final entry in cases.entries) {
      expect(SmartChordParser.isMusicalChord(entry.key), isTrue,
          reason: entry.key);
      expect(SmartChordParser.transposeChord(entry.key, 2), entry.value,
          reason: entry.key);
    }
  });
  test('markers and dates are not chords', () {
    for (final marker in ['A/2', 'D/12/2025']) {
      expect(SmartChordParser.isMusicalChord(marker), isFalse, reason: marker);
      expect(SmartChordParser.transposeChord(marker, 2), marker);
    }
  });
  test('rows without brackets keep the parentheses of a chord', () {
    expect(SmartChordParser.transposeSmartChord('Intro: C7(4) F', 2),
        'Intro: D7(4) G');
    expect(SmartChordParser.transposeSmartChord('(C7(4) F)', 2), '(D7(4) G)');
    expect(SmartChordParser.transposeSmartChord('[C(4)] [G]', 2),
        '[D(4)] [A]');
    final segments = SmartChordParser.parse('G  C(4)').single.segments;
    expect(segments.map((s) => s.comment).join(), isEmpty);
  });
  test('tablet alternatives transpose in progressions and lyric segments', () {
    expect(SmartChordParser.isMusicalChord('Am(G)'), isTrue);
    expect(SmartChordParser.transposeChord('Am(G)', 1), 'A#m(G#)');
    const source = '[||: C | Am(G) | C(add9)/E :|| 2x]';
    expect(SmartChordParser.transposeSmartChord(source, 1),
        '[||: C# | A#m(G#) | C#(add9)/F :|| 2x]');
    expect(SmartChordParser.transposeSmartChord(source, 0), source);
    final segments = SmartChordParser.parse('[C]Amanhece [Am(G)]em luz de[C(add9)/E] ensaio').single.segments;
    expect(segments.map((s) => s.chord).toList(), ['C', 'Am(G)', 'C(add9)/E']);
    expect(segments.map((s) => s.text).join(), 'Amanhece em luz de ensaio');
  });
  test('alternatives preserve instructions, Unicode and TAB and reject text', () {
    for (final text in ['(cresce marcando)', 'Am(cresce marcando)',
      'Am(Dedilhado)', 'Am(G)(C)', 'Am()', 'Baixo', 'Dedilhado', 'e|--0--2--|']) {
      expect(SmartChordParser.isMusicalChord(text), isFalse);
      expect(SmartChordParser.transposeChord(text, 1), text);
    }
    const source = '[Am(G)]letra\n{{^Entrada: baixo}}\n{{Dinamica: suave}}\ne|--0--2--|\nB|--1--3--|\nG|--0--2--|';
    expect(SmartChordParser.transposeSmartChord(source, 1),
      source.replaceFirst('[Am(G)]', '[A#m(G#)]'));
    expect(SmartChordParser.transposeSmartChord(source, 0), source);
    expect(SmartChordParser.transposeChord('A#m(G#)', -1), 'Am(G)');
    expect(SmartChordParser.transposeChord('B\u266dmaj7', 0), 'B\u266dmaj7');
    expect(SmartChordParser.transposeChord('F\u266fm', 1), 'Gm');
    expect(SmartChordParser.transposeChord('E\u266e', 1), 'F');
    expect(SmartChordParser.transposeChord('Am(F\u266fm)', 1), 'A#m(Gm)');
  });
  group('SmartChordParser - Transposition Safety & Musical Token Recognition', () {
    test('isMusicalChord recognizes valid chords and compound slash notations', () {
      expect(SmartChordParser.isMusicalChord('A'), isTrue);
      expect(SmartChordParser.isMusicalChord('A9'), isTrue);
      expect(SmartChordParser.isMusicalChord('A7M/9'), isTrue);
      expect(SmartChordParser.isMusicalChord('D/F#'), isTrue);
      expect(SmartChordParser.isMusicalChord('C#m7'), isTrue);
      expect(SmartChordParser.isMusicalChord('Gadd9'), isTrue);
      expect(SmartChordParser.isMusicalChord('F#m7(b5)'), isTrue);
      expect(SmartChordParser.isMusicalChord('Eb7M'), isTrue);
      expect(SmartChordParser.isMusicalChord('Bb'), isTrue);
    });

    test('isMusicalChord rejects Portuguese annotations and performance instructions', () {
      expect(SmartChordParser.isMusicalChord('Baixo'), isFalse);
      expect(SmartChordParser.isMusicalChord('Corte'), isFalse);
      expect(SmartChordParser.isMusicalChord('Dedilhado'), isFalse);
      expect(SmartChordParser.isMusicalChord('Fim'), isFalse);
      expect(SmartChordParser.isMusicalChord('Intro'), isFalse);
      expect(SmartChordParser.isMusicalChord('Solo'), isFalse);
      expect(SmartChordParser.isMusicalChord('Ponte'), isFalse);
      expect(SmartChordParser.isMusicalChord('Refrão'), isFalse);
      expect(SmartChordParser.isMusicalChord('Todos'), isFalse);
      expect(SmartChordParser.isMusicalChord(''), isFalse);
    });

    test('transposeChord transposes musical chords accurately', () {
      expect(SmartChordParser.transposeChord('G', 2), equals('A'));
      expect(SmartChordParser.transposeChord('D/F#', 2), equals('E/G#'));
      expect(SmartChordParser.transposeChord('A9', 1), equals('A#9'));
      expect(SmartChordParser.transposeChord('A7M/9', 2), equals('B7M/9'));
      expect(SmartChordParser.transposeChord('C#m', -1), equals('Cm'));
    });

    test('transposeChord preserves Portuguese annotations and non-chords without corruption', () {
      expect(SmartChordParser.transposeChord('Baixo', 2), equals('Baixo'));
      expect(SmartChordParser.transposeChord('Corte', 2), equals('Corte'));
      expect(SmartChordParser.transposeChord('Dedilhado', 1), equals('Dedilhado'));
      expect(SmartChordParser.transposeChord('Fim', 3), equals('Fim'));
    });
  });
}
