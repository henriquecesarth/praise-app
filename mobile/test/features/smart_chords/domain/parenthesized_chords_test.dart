import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
  group('Parenthesized and Alternative Chords', () {
    test('isMusicalChord recognizes parenthesized chords', () {
      expect(SmartChordParser.isMusicalChord('(G)'), isTrue);
      expect(SmartChordParser.isMusicalChord('(Am)'), isTrue);
      expect(SmartChordParser.isMusicalChord('(F#m)'), isTrue);
      expect(SmartChordParser.isMusicalChord('(B♭maj7)'), isTrue);
      expect(SmartChordParser.isMusicalChord('(C/E)'), isTrue);
    });

    test('isMusicalChord recognizes alternative chords with or without space', () {
      expect(SmartChordParser.isMusicalChord('Am(G)'), isTrue);
      expect(SmartChordParser.isMusicalChord('Am (G)'), isTrue);
      expect(SmartChordParser.isMusicalChord('C/E (G)'), isTrue);
      expect(SmartChordParser.isMusicalChord('B♭maj7 (F♯m)'), isTrue);
    });

    test('isMusicalChord rejects non-chord parenthesized text', () {
      expect(SmartChordParser.isMusicalChord('(marca/corte)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(Baixo)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(Dedilhado)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(Fim)'), isFalse);
      expect(SmartChordParser.isMusicalChord('()'), isFalse);
    });

    test('transposeChord transposes parenthesized chords', () {
      expect(SmartChordParser.transposeChord('(G)', 2), '(A)');
      expect(SmartChordParser.transposeChord('(Am)', 2), '(Bm)');
      expect(SmartChordParser.transposeChord('(C/E)', 2), '(D/F#)');
      expect(SmartChordParser.transposeChord('Am (G)', 2), 'Bm (A)');
      expect(SmartChordParser.transposeChord('Am(G)', 2), 'Bm(A)');
    });

    test('renderLine renders parenthesized chords on chord line', () {
      final line = SmartChordParser.renderLine('[C]Amanhece [Am]em [(G)]luz', 0);
      expect(line.chordLine.contains('(G)'), isTrue);
      expect(line.lyricsLine.contains('(G)'), isFalse);

      final line2 = SmartChordParser.renderLine('[C]Amanhece [Am (G)]em luz', 0);
      expect(line2.chordLine.contains('Am (G)'), isTrue);
      expect(line2.lyricsLine.contains('Am (G)'), isFalse);
    });
  });
}
