import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
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
