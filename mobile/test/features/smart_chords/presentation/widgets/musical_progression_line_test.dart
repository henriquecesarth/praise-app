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
}
