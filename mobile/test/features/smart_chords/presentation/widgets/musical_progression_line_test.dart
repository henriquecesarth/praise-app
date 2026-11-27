import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_lyric_line.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_tap_target.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/musical_progression_line.dart';

void main() {
  for (final font in ['monospace', 'Arial']) {
    testWidgets('one scrollable musical row on a narrow screen using $font', (tester) async {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SizedBox(width: 120,
        child: MusicalProgressionLine(line: 'Intro: (riff viol) [ ||: A | A7M | D | % :|| ]',
          semitones: 2, fontFamily: font, fontSize: 16),
      )))));
      final textFinder = find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text));
      final text = tester.widget<Text>(textFinder);
      expect(text.textSpan!.toPlainText(), 'Intro: (riff viol)  ||: B | B7M | E | % :|| ');
      expect(text.softWrap, isFalse);
      expect(text.style!.fontFamily, 'monospace');
      final spans = (text.textSpan! as TextSpan).children!.cast<TextSpan>();
      expect(spans.where((span) => span.style!.fontWeight == FontWeight.bold).map((s) => s.text), contains('B'));
      final scroll = tester.state<ScrollableState>(find.descendant(
        of: find.byType(MusicalProgressionLine), matching: find.byType(Scrollable)));
      expect(scroll.position.maxScrollExtent, greaterThan(0));
      expect(tester.getSize(textFinder).height, lessThan(32));
      await tester.drag(find.byType(MusicalProgressionLine), const Offset(-150, 0));
      await tester.pumpAndSettle();
      expect(scroll.position.pixels, greaterThan(0));
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('reports the transposed neighbours of the tapped chord', (tester) async {
    ChordNeighbours? progression;
    ChordNeighbours? lyric;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Column(children: [
      MusicalProgressionLine(
        line: '[ Bb | Bb/A | Gm ]',
        semitones: 2,
        onChordTap: (_) {},
        onChordNeighbours: (value) => progression = value,
      ),
      ChordLyricLine(
        line: '[Bb]Um [Bb/A]dois [Gm]tres',
        semitones: 2,
        fontSize: 14,
        fontFamily: 'Arial',
        fontFamilyFallback: const [],
        monospace: false,
        onChordTap: (_) {},
        onChordNeighbours: (value) => lyric = value,
      ),
    ]))));

    final targets = tester.widgetList<ChordTapTarget>(find.byType(ChordTapTarget)).toList();
    expect(targets, hasLength(6));
    targets[1].onActivate();
    targets[3].onActivate();

    expect(progression, (previous: 'C', next: 'Am'));
    expect(lyric, (previous: null, next: 'C/B'));
    targets[4].onActivate();
    expect(lyric, (previous: 'C', next: 'Am'));
  });

  group('MusicalProgressionLine onChordTap', () {
    testWidgets('keeps a single paragraph with one tappable widget per transposed chord', (tester) async {
      String? tappedChord;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: MusicalProgressionLine(
            line: 'Intro: [ A | Bm | D ]',
            semitones: 2,
            onChordTap: (chord) => tappedChord = chord,
          ),
        ),
      ));

      final paragraph = tester.widget<Text>(find.byWidgetPredicate(
          (w) => w is Text && w.textSpan != null));
      // Each chord is a widget placeholder inside the same row.
      expect(paragraph.textSpan!.toPlainText(), 'Intro:  ￼ | ￼ | ￼ ');

      await tester.tap(find.text('B'));
      expect(tappedChord, 'B');
      await tester.tap(find.text('C#m'));
      expect(tappedChord, 'C#m');
    });

    testWidgets('uses the new chord and callback after an update', (tester) async {
      final taps = <String>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: MusicalProgressionLine(
            line: 'Intro: [ C | G ]',
            semitones: 0,
            onChordTap: (chord) => taps.add('old:$chord'),
          ),
        ),
      ));

      await tester.tap(find.text('C'));
      expect(taps, ['old:C']);

      // Update widget with new semitones and callback
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: MusicalProgressionLine(
            line: 'Intro: [ C | G ]',
            semitones: 2,
            onChordTap: (chord) => taps.add('new:$chord'),
          ),
        ),
      ));

      await tester.tap(find.text('D'));
      expect(taps, ['old:C', 'new:D']);

      // Unmount
      await tester.pumpWidget(const SizedBox.shrink());
      expect(tester.takeException(), isNull);
    });
  });
}
