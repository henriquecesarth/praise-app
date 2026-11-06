import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
  test('canonical and legacy progressions keep their label, delimiters and annotations on one row', () {
    for (final line in ['[ G | D ]', 'Solo: [ Am | D ]', 'Interlúdio: [ ||: G | D | % :|| ]',
      'Intro: (riff viol) [ ||: A | A7M | D | % :|| ]', '[||: A | D :||]']) {
      final tokens = SmartChordParser.progressionTokens(line)!;
      expect(tokens.map((t) => t.text).join(), line.replaceAll(RegExp(r'[\[\]]'), ''));
      expect(tokens.where((t) => t.isChord).length, greaterThanOrEqualTo(2));
    }
    expect(SmartChordParser.progressionTokens('[G]Graças Te dou [D]pelo Teu amor'), isNull);
  });
  test('transposition affects only chords, preserving annotations and original label', () {
    expect(SmartChordParser.progressionTokens('Intro: [ G | D ]', 2)!.map((t) => t.text).join(), 'Intro:  A | E ');
    expect(SmartChordParser.transposeSmartChord('[ A | E | F#m ]', 2), '[ B | F# | G#m ]');
    expect(SmartChordParser.transposeSmartChord('Intro: [ G | (tocar A E juntos) D ]', 2),
      'Intro: [ A | (tocar A E juntos) E ]');
  });
}
