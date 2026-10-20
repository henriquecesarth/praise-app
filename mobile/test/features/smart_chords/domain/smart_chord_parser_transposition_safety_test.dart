import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
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
