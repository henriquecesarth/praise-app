import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
          const tierType = Text;
          final tiers = find.descendant(of: fragments[i], matching: find.byType(tierType));
          expect(tiers, findsNWidgets(2));
          final expected = SmartChordParser.transposeChord(chords[i], offset);
          if (monospace) {
            expect(tester.widget<Text>(tiers.at(0)).data, expected);
            expect(tester.widget<Text>(tiers.at(1)).data, lyrics[i]);
          } else {
            expect(tester.widget<Text>(tiers.at(0)).data, expected);
            expect(tester.widget<Text>(tiers.at(1)).data, lyrics[i]);
          }
          Rect chordRect;
          if (monospace) {
            final paragraph = tester.renderObject<RenderParagraph>(find.descendant(
              of: tiers.at(0), matching: find.byType(RichText)));
            final box = paragraph.getBoxesForSelection(TextSelection(baseOffset: 0, extentOffset: expected.length)).first;
            chordRect = Rect.fromLTWH(paragraph.localToGlobal(Offset(box.left, box.top)).dx,
              paragraph.localToGlobal(Offset(box.left, box.top)).dy, box.right - box.left, box.bottom - box.top);
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
          final row = find.descendant(of: find.byKey(const ValueKey('reader-word-0')),
            matching: find.byType(Row));
          final overflow = (tester.getSize(row).width - 180).clamp(0.0, double.infinity);
          expect(scroll.position.maxScrollExtent, closeTo(overflow, 0.1));
          expect(tester.getTopLeft(find.byKey(const ValueKey('reader-word-1'))).dy,
            greaterThan(tester.getTopLeft(find.byKey(const ValueKey('reader-word-0'))).dy));
        }
        expect(tester.takeException(), isNull);
      });
    }
  }

  for (final font in ['monospace', 'Courier New']) {
    testWidgets('$font reproduces legacy fixed-width SelectableText wrapping', (tester) async {
      const text = 'Espírito,';
      final style = TextStyle(fontFamily: font, fontSize: 18, height: 1.3,
        fontFamilyFallback: font == 'Courier New' ? ['monospace'] : []);
      final painter = TextPainter(text: TextSpan(text: text, style: style),
        textDirection: TextDirection.ltr)..layout();
      final oldWidth = painter.width.ceilToDouble() + 1;
      painter.dispose();
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(
        child: DefaultTextStyle(style: const TextStyle(letterSpacing: 1.8),
          child: SizedBox(width: oldWidth, child: SelectableText(text, style: style)))))));
      final editable = tester.state<EditableTextState>(find.byType(EditableText)).renderEditable;
      final boxes = editable.getBoxesForSelection(const TextSelection(baseOffset: 0, extentOffset: text.length));
      expect(boxes.map((box) => box.top).toSet().length, greaterThan(1));
      expect(tester.takeException(), isNull);
    });
  }

  for (final font in ['monospace', 'Courier New']) {
    for (final viewport in [320.0, 360.0, 393.0]) {
      for (final scale in [1.0, 1.3]) {
        for (final offset in [-1, 2]) {
          testWidgets('$font words and glyph geometry at $viewport / $scale / $offset', (tester) async {
            const input = '[C]Es[Am]pírito, [F]enche a minha [G]vida. '
              '[C][G#m7(b5)/F#]extraordinária[A7M/9]mente'
              'inconstitucionalissimamenteacentuação';
            await tester.pumpWidget(MaterialApp(home: Scaffold(body: SizedBox(width: viewport,
              child: MediaQuery(data: MediaQueryData(textScaler: TextScaler.linear(scale)),
                // Exercise inherited typography absent from the old standalone painter.
                child: DefaultTextStyle(style: const TextStyle(letterSpacing: 1.8),
                  child: ChordLyricLine(line: input, semitones: offset, fontSize: 18,
                    fontFamily: font, fontFamilyFallback: font == 'Courier New' ? ['monospace'] : [],
                    monospace: true)))))));
            final fragments = find.byWidgetPredicate((widget) => widget is Column &&
              widget.key.toString().contains('reader-fragment-'));
            final chordBounds = <Rect>[];
            final lyricTexts = <String>[];
            for (var i = 0; i < fragments.evaluate().length; i++) {
              final fragment = find.byKey(ValueKey('reader-fragment-$i'));
              final tiers = find.descendant(of: fragment, matching: find.byType(Text));
              final fragmentRect = tester.getRect(fragment);
              final rects = <Rect>[];
              for (var tier = 0; tier < 2; tier++) {
                final text = tester.widget<Text>(tiers.at(tier));
                final paragraph = tester.renderObject<RenderParagraph>(find.descendant(
                  of: tiers.at(tier), matching: find.byType(RichText)));
                final boxes = paragraph.getBoxesForSelection(TextSelection(
                  baseOffset: 0, extentOffset: text.data!.length));
                expect(boxes, isNotEmpty);
                expect(boxes.map((box) => box.top).toSet(), hasLength(1), reason: text.data);
                final bounds = boxes.map((box) => Rect.fromLTRB(box.left, box.top, box.right, box.bottom))
                  .reduce((a, b) => a.expandToInclude(b));
                final global = bounds.shift(paragraph.localToGlobal(Offset.zero));
                expect(global.left, greaterThanOrEqualTo(fragmentRect.left - 1));
                expect(global.right, lessThanOrEqualTo(fragmentRect.right + 1));
                expect(global.bottom, lessThanOrEqualTo(fragmentRect.bottom + 1));
                expect(paragraph.size.height, lessThan(18 * scale * 1.6));
                rects.add(global);
                if (tier == 1) lyricTexts.add(text.data!);
              }
              expect(tester.getRect(tiers.first).left, tester.getRect(tiers.last).left);
              expect(rects.last.top, greaterThanOrEqualTo(rects.first.bottom));
              chordBounds.add(rects.first);
            }
            expect(lyricTexts.where((text) => text != ' ').join(),
              'Espírito, enche a minha vida. extraordináriamenteinconstitucionalissimamenteacentuação');
            expect(tester.getTopLeft(find.byKey(const ValueKey('reader-fragment-0'))).dy,
              tester.getTopLeft(find.byKey(const ValueKey('reader-fragment-1'))).dy);
            for (var i = 1; i < chordBounds.length; i++) {
              if ((chordBounds[i].top - chordBounds[i - 1].top).abs() < 1) {
                expect(chordBounds[i].left - chordBounds[i - 1].right, greaterThanOrEqualTo(6));
              }
            }
            expect(tester.getTopLeft(find.byKey(const ValueKey('reader-word-5'))).dy,
              greaterThan(tester.getTopLeft(find.byKey(const ValueKey('reader-word-0'))).dy));
            final scrolls = tester.stateList<ScrollableState>(find.byType(Scrollable)).toList();
            final overflow = scrolls.lastWhere((state) => state.position.maxScrollExtent > 0);
            final lastTier = find.descendant(of: fragments.last, matching: find.byType(Text)).last;
            final before = tester.getRect(lastTier).right;
            await tester.drag(find.byKey(const ValueKey('reader-word-5')), Offset(-viewport, 0));
            await tester.pumpAndSettle();
            expect(overflow.position.pixels, greaterThan(0));
            overflow.position.jumpTo(overflow.position.maxScrollExtent);
            await tester.pumpAndSettle();
            expect(tester.getRect(lastTier).right, lessThan(before));
            expect(tester.getRect(lastTier).right, lessThanOrEqualTo(viewport + 1));
            final region = tester.state<SelectableRegionState>(find.byType(SelectableRegion));
            region.selectAll(SelectionChangedCause.keyboard);
            await tester.pump();
            final paragraph = tester.renderObject<RenderParagraph>(find.descendant(
              of: lastTier, matching: find.byType(RichText)));
            expect(paragraph.selections, contains(TextSelection(
              baseOffset: 0, extentOffset: tester.widget<Text>(lastTier).data!.length)));
            expect(tester.takeException(), isNull);
          });
        }
      }
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
