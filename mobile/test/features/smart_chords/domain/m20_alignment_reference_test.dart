import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/data/image_import_draft.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';

void main() {
  test('complete original reference retains chord columns, lyrics and six strings', () {
    final source = File('../fixtures/smart-chords/m20-alignment-reference.txt').readAsStringSync();
    final draft = imageDraftFromRecognizedText(source, 'reference.png');
    expect(draft.originalKey, 'Bb');
    expect(draft.originalText, source);
    final raw = source.split('\n');
    final converted = draft.content.split('\n');
    expect(converted.length, raw.length);
    for (var i = 0; i < raw.length; i++) {
      final tokens = SmartChordParser.progressionTokens(converted[i]);
      if (tokens != null) {
        expect(tokens.map((t) => t.text).join(), raw[i]);
        final rendered = SmartChordParser.renderLine(converted[i], 0);
        expect(rendered.chordLine, isEmpty);
        expect(rendered.lyricsLine, raw[i]);
      }
    }
    final tabs = raw.where(SmartChordParser.isTablatureLine).toList();
    expect(tabs.length, 6);
    final shifted = SmartChordParser.transposeSmartChord(draft.content, 2);
    expect(shifted.split('\n').where(SmartChordParser.isTablatureLine).toList(), tabs);
    expect(shifted, contains('[C]Nossa [F]voz vai [G]florescer'));
    expect(SmartChordParser.progressionTokens('[Bb]Nossa [Eb]voz'), isNull);
    expect(SmartChordParser.parse('[Verso]').single.segments.single.text, '[Verso]');
    expect(imageDraftFromRecognizedText('Bb   F', 'unknown.png').originalKey, isNull);
  });
}
