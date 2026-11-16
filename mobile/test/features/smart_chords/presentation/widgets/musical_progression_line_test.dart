import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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

  group('MusicalProgressionLine onChordTap and recognizer lifecycle', () {
    testWidgets('attaches recognizer to chord spans and invokes onChordTap without altering single Text invariant', (tester) async {
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

      final textFinder = find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text));
      expect(textFinder, findsOneWidget);

      final text = tester.widget<Text>(textFinder);
      expect(text.textSpan!.toPlainText(), 'Intro:  B | C#m | E ');

      final spans = (text.textSpan! as TextSpan).children!.cast<TextSpan>();
      final chordSpanB = spans.firstWhere((s) => s.text == 'B');
      expect(chordSpanB.recognizer, isNotNull);

      // Simulate tap on chord span recognizer
      (chordSpanB.recognizer as dynamic).onTap();
      expect(tappedChord, 'B');

      final chordSpanCsm = spans.firstWhere((s) => s.text == 'C#m');
      (chordSpanCsm.recognizer as dynamic).onTap();
      expect(tappedChord, 'C#m');
    });

    testWidgets('didUpdateWidget properly recreates recognizers and dispose cleans them up', (tester) async {
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

      var text = tester.widget<Text>(find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text)));
      var spans = (text.textSpan! as TextSpan).children!.cast<TextSpan>();
      (spans.firstWhere((s) => s.text == 'C').recognizer as dynamic).onTap();
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

      text = tester.widget<Text>(find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text)));
      spans = (text.textSpan! as TextSpan).children!.cast<TextSpan>();
      (spans.firstWhere((s) => s.text == 'D').recognizer as dynamic).onTap();
      expect(taps, ['old:C', 'new:D']);

      // Unmount
      await tester.pumpWidget(const SizedBox.shrink());
      expect(tester.takeException(), isNull);
    });
  });
}
