import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_lyric_line.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/musical_progression_line.dart';

void main() {
  const source = '[G#m7]a[C#m7]mor [A7M/9]e [F#/A#]fé';
  for (final monospace in [false, true]) {
    for (final offset in [-1, 2]) {
      testWidgets('measured chord associations and gaps in $monospace mode at $offset semitones', (tester) async {
        await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SizedBox(width: 180,
          child: MediaQuery(data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
            child: ChordLyricLine(line: source, semitones: offset, fontSize: 18,
              fontFamily: monospace ? 'monospace' : 'Georgia',
              fontFamilyFallback: monospace ? [] : ['serif'], monospace: monospace)),
        )))));
        final fragments = [for (int i = 0; i < 4; i++) find.byKey(ValueKey('reader-fragment-$i'))];
        final chords = ['G#m7', 'C#m7', 'A7M/9', 'F#/A#'];
        final lyrics = ['a', 'mor ', 'e ', 'fé'];
        final chordBounds = <Rect>[];
        for (int i = 0; i < fragments.length; i++) {
          final tierType = monospace ? SelectableText : Text;
          final tiers = find.descendant(of: fragments[i], matching: find.byType(tierType));
          expect(tiers, findsNWidgets(2));
          final expected = SmartChordParser.transposeChord(chords[i], offset);
          if (monospace) {
            expect(tester.widget<SelectableText>(tiers.at(0)).data, expected);
            expect(tester.widget<SelectableText>(tiers.at(1)).data, lyrics[i]);
          } else {
            expect(tester.widget<Text>(tiers.at(0)).data, expected);
            expect(tester.widget<Text>(tiers.at(1)).data, lyrics[i]);
          }
          Rect chordRect;
          if (monospace) {
            final editable = tester.state<EditableTextState>(find.descendant(
              of: tiers.at(0), matching: find.byType(EditableText))).renderEditable;
            final box = editable.getBoxesForSelection(TextSelection(baseOffset: 0, extentOffset: expected.length)).first;
            chordRect = Rect.fromLTWH(editable.localToGlobal(Offset(box.left, box.top)).dx,
              editable.localToGlobal(Offset(box.left, box.top)).dy, box.right - box.left, box.bottom - box.top);
          } else {
            chordRect = tester.getRect(tiers.at(0));
          }
          final lyricRect = tester.getRect(tiers.at(1));
          final fragmentRect = tester.getRect(fragments[i]);
          // Alignment uses layout anchors; glyph boxes include font-specific side bearings.
          expect(tester.getRect(tiers.at(0)).left, closeTo(lyricRect.left, 0.1));
          expect(chordRect.right, lessThanOrEqualTo(fragmentRect.right - 5));
          expect(lyricRect.top, greaterThanOrEqualTo(chordRect.bottom));
          chordBounds.add(chordRect);
        }
        for (int i = 1; i < chordBounds.length; i++) {
          if ((chordBounds[i].top - chordBounds[i - 1].top).abs() < 1) {
            expect(chordBounds[i].left - chordBounds[i - 1].right, greaterThanOrEqualTo(5));
          }
        }
        // The syllables of "amor" cannot wrap independently.
        expect(tester.getTopLeft(fragments[0]).dy, tester.getTopLeft(fragments[1]).dy);
        if (!monospace) {
          expect(tester.getTopLeft(find.byKey(const ValueKey('reader-word-1'))).dy,
            greaterThan(tester.getTopLeft(find.byKey(const ValueKey('reader-word-0'))).dy));
        } else {
          final scroll = tester.state<ScrollableState>(find.descendant(
            of: find.byType(SingleChildScrollView).first, matching: find.byType(Scrollable)).first);
          expect(scroll.position.maxScrollExtent, greaterThan(0));
        }
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('an oversized word scrolls without splitting syllables or overlapping chords', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: SizedBox(width: 90,
      child: ChordLyricLine(line: '[G#m7]a[C#m7]mor', semitones: 0, fontSize: 20,
        fontFamily: 'Georgia', fontFamilyFallback: ['serif'], monospace: false)))));
    final scroll = tester.state<ScrollableState>(find.byType(Scrollable).last);
    expect(scroll.position.maxScrollExtent, greaterThan(0));
    expect(tester.getTopLeft(find.byKey(const ValueKey('reader-fragment-0'))).dy,
      tester.getTopLeft(find.byKey(const ValueKey('reader-fragment-1'))).dy);
    await tester.drag(find.byType(SingleChildScrollView).last, const Offset(-80, 0));
    await tester.pumpAndSettle();
    expect(scroll.position.pixels, greaterThan(0));
    expect(tester.takeException(), isNull);
  });

  for (final line in ['Intro: [ G | D ]', 'Solo: [ Am | D ]', 'Interlúdio: [ ||: G | D | % :|| ]']) {
    testWidgets('$line remains one progression row under transposition', (tester) async {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: SizedBox(width: 120,
        child: MusicalProgressionLine(line: line, semitones: 2)))));
      final text = tester.widget<Text>(find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text)));
      expect(text.textSpan!.toPlainText(), SmartChordParser.progressionTokens(line, 2)!.map((t) => t.text).join());
      expect(text.softWrap, isFalse);
      expect(text.textSpan!.toPlainText(), isNot(contains('[')));
      expect(tester.getSize(find.byType(Text)).height, lessThan(30));
      expect(tester.takeException(), isNull);
    });
  }
}
