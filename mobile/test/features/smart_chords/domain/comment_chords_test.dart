import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
  group('Comments and Chords Parsing & Rendering Parity', () {
    test('isMusicalChord distinguishes chords from comments in parentheses', () {
      // Chords
      expect(SmartChordParser.isMusicalChord('(G)'), isTrue);
      expect(SmartChordParser.isMusicalChord('(D)'), isTrue);
      expect(SmartChordParser.isMusicalChord('(Am)'), isTrue);
      expect(SmartChordParser.isMusicalChord('Am (G)'), isTrue);

      // Comments / Performance instructions
      expect(SmartChordParser.isMusicalChord('(corte)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(suave)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(2x)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(solo)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(riff)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(Entra banda)'), isFalse);
      expect(SmartChordParser.isMusicalChord('(voz e violao)'), isFalse);
    });

    test('parse extracts comment at end of line onto chord line', () {
      const line = 'Nao quero [Am (G)]dar-Te um dia apenas da se[D]mana (corte)';
      final parsed = SmartChordParser.parse(line).first;
      
      // Should have segments
      final segs = parsed.segments;
      expect(segs.any((s) => s.chord == 'Am (G)'), isTrue);
      
      // The segment with [D] should have chord 'D' and comment '(corte)'
      final dSeg = segs.firstWhere((s) => s.chord == 'D');
      expect(dSeg.comment, '(corte)');
      // The lyrics text should NOT have '(corte)'
      expect(dSeg.text.contains('(corte)'), isFalse);
      expect(segs.map((s) => s.text).join(), contains('mana'));
      expect(segs.map((s) => s.text).join().contains('(corte)'), isFalse);
    });

    test('parse handles explicit bracketed comments [(corte)]', () {
      const line = 'se[D]mana [(corte)]';
      final parsed = SmartChordParser.parse(line).first;
      final segs = parsed.segments;
      expect(segs.any((s) => s.comment == '(corte)'), isTrue);
      expect(segs.map((s) => s.text).join().contains('(corte)'), isFalse);
    });

    test('parse handles chord and comment in same brackets [D (corte)]', () {
      const line = 'se[D (corte)]mana';
      final parsed = SmartChordParser.parse(line).first;
      final dSeg = parsed.segments.firstWhere((s) => s.chord == 'D');
      expect(dSeg.comment, '(corte)');
      expect(dSeg.text.trim(), 'mana');
    });

    test('parse handles {{...}} annotations', () {
      const line = '{{^Entra banda}}\nQue sejas meu uni[G]verso';
      final lines = SmartChordParser.parse(line);
      expect(lines.first.segments.first.comment, '(Entra banda)');
    });

    test('renderLine puts comment on chordLine and lyrics without comment on lyricsLine', () {
      const line = 'Nao quero [Am (G)]dar-Te um dia apenas da se[D]mana (corte)';
      final rendered = SmartChordParser.renderLine(line, 0);
      expect(rendered.chordLine, contains('(corte)'));
      expect(rendered.lyricsLine.contains('(corte)'), isFalse);
      expect(rendered.lyricsLine, contains('semana'));

      // With transposition: chords transpose, comment does NOT
      final transposed = SmartChordParser.renderLine(line, 1);
      expect(transposed.chordLine, contains('A#m (G#)'));
      expect(transposed.chordLine, contains('D#'));
      expect(transposed.chordLine, contains('(corte)'));
      expect(transposed.lyricsLine.contains('(corte)'), isFalse);
    });
  });
}
