import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
  group('SmartChordParser - Parsing', () {
    test('returns empty list for null or empty input', () {
      expect(SmartChordParser.parse(null), isEmpty);
      expect(SmartChordParser.parse(''), isEmpty);
    });

    test('preserves empty lines as empty segments', () {
      final lines = SmartChordParser.parse('Line 1\n\nLine 3');
      expect(lines.length, 3);
      expect(lines[0].line, 1);
      expect(lines[0].segments.first.text, 'Line 1');
      expect(lines[1].line, 2);
      expect(lines[1].segments, isEmpty);
      expect(lines[1].isEmpty, isTrue);
      expect(lines[2].line, 3);
      expect(lines[2].segments.first.text, 'Line 3');
    });

    test('parses lines without chords', () {
      final lines = SmartChordParser.parse('Apenas texto sem acordes');
      expect(lines.length, 1);
      expect(lines.first.segments.length, 1);
      expect(lines.first.segments.first.chord, '');
      expect(lines.first.segments.first.text, 'Apenas texto sem acordes');
      expect(lines.first.segments.first.hasChord, isFalse);
    });

    test('parses chords at start, middle, and end of line', () {
      final lines = SmartChordParser.parse('[G]Amanhã [Am]será outro [D]dia[G]');
      expect(lines.length, 1);
      final segments = lines.first.segments;
      expect(segments.length, 4);

      expect(segments[0].chord, 'G');
      expect(segments[0].text, 'Amanhã ');

      expect(segments[1].chord, 'Am');
      expect(segments[1].text, 'será outro ');

      expect(segments[2].chord, 'D');
      expect(segments[2].text, 'dia');

      expect(segments[3].chord, 'G');
      expect(segments[3].text, '');
    });

    test('handles leading text before first chord', () {
      final lines = SmartChordParser.parse('Intro: [C] [G]');
      final segments = lines.first.segments;
      expect(segments.length, 3);
      expect(segments[0].chord, '');
      expect(segments[0].text, 'Intro: ');
      expect(segments[1].chord, 'C');
      expect(segments[1].text, ' ');
      expect(segments[2].chord, 'G');
      expect(segments[2].text, '');
    });

    test('normalizes Windows CRLF line endings', () {
      final lines = SmartChordParser.parse('[C]Linha 1\r\n[G]Linha 2');
      expect(lines.length, 2);
      expect(lines[0].segments.first.chord, 'C');
      expect(lines[1].segments.first.chord, 'G');
    });
  });

  group('SmartChordParser - Transposition', () {
    test('transposeNote handles chromatic scale up and down', () {
      expect(SmartChordParser.transposeNote('C', 1), 'C#');
      expect(SmartChordParser.transposeNote('C', 2), 'D');
      expect(SmartChordParser.transposeNote('B', 1), 'C');
      expect(SmartChordParser.transposeNote('C', -1), 'B');
      expect(SmartChordParser.transposeNote('C', 12), 'C');
      expect(SmartChordParser.transposeNote('C', -12), 'C');
    });

    test('transposeNote normalizes enharmonic flat notes to sharps', () {
      expect(SmartChordParser.transposeNote('Db', 0), 'C#');
      expect(SmartChordParser.transposeNote('Eb', 0), 'D#');
      expect(SmartChordParser.transposeNote('Gb', 0), 'F#');
      expect(SmartChordParser.transposeNote('Ab', 0), 'G#');
      expect(SmartChordParser.transposeNote('Bb', 0), 'A#');

      expect(SmartChordParser.transposeNote('Db', 2), 'D#');
      expect(SmartChordParser.transposeNote('Bb', 2), 'C');
    });

    test('transposeChord preserves extensions and suffixes', () {
      expect(SmartChordParser.transposeChord('Am', 2), 'Bm');
      expect(SmartChordParser.transposeChord('Cmaj7', 2), 'Dmaj7');
      expect(SmartChordParser.transposeChord('F#m7(b5)', 1), 'Gm7(b5)');
      expect(SmartChordParser.transposeChord('Gsus4', -2), 'Fsus4');
      expect(SmartChordParser.transposeChord('Bdim', 1), 'Cdim');
    });

    test('transposeChord transposes slash chords correctly', () {
      expect(SmartChordParser.transposeChord('C/E', 2), 'D/F#');
      expect(SmartChordParser.transposeChord('G/B', -1), 'F#/A#');
      expect(SmartChordParser.transposeChord('Am7/G', 2), 'Bm7/A');
    });

    test('transposeKey transposes keys with minor suffixes', () {
      expect(SmartChordParser.transposeKey('C', 2), 'D');
      expect(SmartChordParser.transposeKey('Am', 2), 'Bm');
      expect(SmartChordParser.transposeKey('F#m', 1), 'Gm');
      expect(SmartChordParser.transposeKey('Eb', 2), 'F');
      expect(SmartChordParser.transposeKey('G', 0), 'G');
    });

    test('transposeSmartChord transposes entire bracket-format text', () {
      const original = '[C]Tu és [G/B]santo, [Am]Poderoso [F]Deus';
      final transposed = SmartChordParser.transposeSmartChord(original, 2);
      expect(transposed, '[D]Tu és [A/C#]santo, [Bm]Poderoso [G]Deus');
    });

    test('transposeSmartChord returns original text when semitones is 0', () {
      const original = '[C]Tu és [Am]santo';
      expect(SmartChordParser.transposeSmartChord(original, 0), original);
    });
  });

  group('SmartChordParser - Rendering & Visual Alignment', () {
    test('renderLine aligns chords with spaces above lyrics', () {
      final rendered = SmartChordParser.renderLine('[C]Aleluia [G]Amém', 0);
      expect(rendered.chordLine.startsWith('C'), isTrue);
      expect(rendered.lyricsLine, 'Aleluia Amém');
      expect(rendered.hasChords, isTrue);
    });

    test('renderLine transposes chords while maintaining text alignment', () {
      final rendered = SmartChordParser.renderLine('[C]Aleluia [G]Amém', 2);
      expect(rendered.chordLine.startsWith('D'), isTrue);
      expect(rendered.lyricsLine, 'Aleluia Amém');
    });

    test('renderLine returns empty strings for empty input', () {
      final rendered = SmartChordParser.renderLine('', 0);
      expect(rendered.chordLine, '');
      expect(rendered.lyricsLine, '');
      expect(rendered.isEmpty, isTrue);
    });

    test('rawToVisual and visualToRaw roundtrip preserves chord positions', () {
      const raw = '[C]Tu és [Am]Santo';
      final visual = SmartChordParser.rawToVisual(raw);

      expect(visual.cleanText, 'Tu és Santo');
      expect(visual.chords[0], 'C');
      expect(visual.chords[6], 'Am');

      final reconstructed = SmartChordParser.visualToRaw(visual);
      expect(reconstructed, raw);
    });
  });

  group('SmartChordParser - Harmonic Field & Suggestions', () {
    test('getHarmonicFieldChords returns 7 degrees for major key', () {
      final fieldC = SmartChordParser.getHarmonicFieldChords('C');
      expect(fieldC, ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);

      final fieldG = SmartChordParser.getHarmonicFieldChords('G');
      expect(fieldG, ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
    });

    test('getHarmonicFieldChords returns relative degrees for minor key', () {
      final fieldAm = SmartChordParser.getHarmonicFieldChords('Am');
      expect(fieldAm, ['F#m', 'G#dim', 'A', 'Bm', 'C#m', 'D', 'E']);
    });

    test('getSuggestions returns harmonic field when query is empty', () {
      final suggestions = SmartChordParser.getSuggestions('', 'C');
      expect(suggestions, ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    });

    test('getSuggestions returns chord extensions when root note matches', () {
      final suggestions = SmartChordParser.getSuggestions('c', 'C');
      expect(suggestions, contains('Cm'));
      expect(suggestions, contains('C7'));
      expect(suggestions, contains('Cmaj7'));
      expect(suggestions, contains('Csus4'));
      expect(suggestions, contains('Cdim'));
    });
  });
}
