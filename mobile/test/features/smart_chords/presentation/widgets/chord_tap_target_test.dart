import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_tap_target.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_lyric_line.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/musical_progression_line.dart';

// The 44 dp area is not part of the semantic rect (the sheet must not move), so
// androidTapTargetGuideline does not apply; these tests prove the touch area.
void main() {
  final taps = <String>[];

  setUp(taps.clear);

  Widget chord(String name) => ChordTapTarget(
        chord: name,
        onActivate: () => taps.add(name),
        child: SizedBox(width: 10, height: 16, child: Text(name)),
      );

  Future<void> pumpRow(WidgetTester tester, {double gap = 100}) =>
      tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChordHitSlopScope(
            child: Center(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                chord('C'),
                SizedBox(width: gap),
                chord('G'),
              ]),
            ),
          ),
        ),
      ));

  Offset centerOf(WidgetTester tester, String name) =>
      tester.getCenter(find.text(name));

  testWidgets('a direct tap activates the chord exactly once', (tester) async {
    await pumpRow(tester);
    await tester.tap(find.text('C'));
    await tester.pump();
    expect(taps, ['C']);
  });

  testWidgets('a tap 18 dp from the centre activates, one further does not',
      (tester) async {
    await pumpRow(tester);
    await tester.tapAt(centerOf(tester, 'C') + const Offset(0, -18));
    await tester.tapAt(centerOf(tester, 'G') + const Offset(18, 18));
    await tester.pump();
    expect(taps, ['C', 'G']);

    taps.clear();
    await tester.tapAt(centerOf(tester, 'C') + const Offset(0, -30));
    await tester.tapAt(centerOf(tester, 'C') + const Offset(30, 0));
    await tester.pump();
    expect(taps, isEmpty);
  });

  testWidgets('between overlapping areas the closest chord wins',
      (tester) async {
    await pumpRow(tester, gap: 12);
    // Centres are 22 dp apart.
    await tester.tapAt(centerOf(tester, 'C') + const Offset(8, -12));
    await tester.tapAt(centerOf(tester, 'G') + const Offset(-8, -12));
    await tester.pump();
    expect(taps, ['C', 'G']);
  });

  testWidgets('drags and long presses are not taps', (tester) async {
    await pumpRow(tester);
    final start = centerOf(tester, 'C') + const Offset(0, -18);
    await tester.dragFrom(start, const Offset(0, -60));
    await tester.longPressAt(start);
    await tester.pump();
    expect(taps, isEmpty);
  });

  testWidgets('a short scroll beside a chord uses the device slop',
      (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(
            gestureSettings: DeviceGestureSettings(touchSlop: 8)),
        child: Scaffold(
          body: SingleChildScrollView(
            controller: controller,
            child: ChordHitSlopScope(
              child: Column(children: [
                const SizedBox(height: 100),
                chord('C'),
                const SizedBox(height: 1000),
              ]),
            ),
          ),
        ),
      ),
    ));
    final gesture = await tester
        .startGesture(centerOf(tester, 'C') + const Offset(0, 18));
    // 12 dp: past the 8 dp device slop, under the 18 dp default.
    await gesture.moveBy(const Offset(0, -12));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(taps, isEmpty);
  });

  testWidgets('a chord scrolled out of sight cannot be opened', (tester) async {
    final controller = ScrollController(initialScrollOffset: 20);
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ChordHitSlopScope(
          child: Padding(
            padding: const EdgeInsets.all(40),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              controller: controller,
              child: Row(children: [chord('C'), const SizedBox(width: 2000)]),
            ),
          ),
        ),
      ),
    ));
    // 'C' sits just past the left edge of the row; tap in the margin.
    await tester.tapAt(const Offset(32, 48));
    await tester.pump();
    expect(taps, isEmpty);
  });

  testWidgets('the screen reader node is a button named after the chord',
      (tester) async {
    final handle = tester.ensureSemantics();
    await pumpRow(tester);
    expect(
      tester.getSemantics(find.text('C')),
      matchesSemantics(
        label: 'Ver diagrama do acorde C\nC',
        isButton: true,
        isFocusable: true,
        hasTapAction: true,
        hasFocusAction: true,
      ),
    );
    handle.dispose();
  });

  testWidgets('a touch that stops a fling does not open a chord',
      (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          controller: controller,
          child: ChordHitSlopScope(
            child: Column(children: [
              for (var i = 0; i < 100; i++)
                SizedBox(height: 60, child: Center(child: chord('c$i'))),
            ]),
          ),
        ),
      ),
    ));
    await tester.fling(
        find.byType(SingleChildScrollView), const Offset(0, -300), 2000);
    await tester.pump(const Duration(milliseconds: 100));
    expect(controller.position.isScrollingNotifier.value, isTrue);
    // Just beside a chord that is on screen while the sheet is still moving.
    final visible = find.textContaining('c').hitTestable(at: Alignment.center);
    final onScreen = tester
        .widgetList<Text>(find.textContaining('c'))
        .map((text) => tester.getCenter(find.text(text.data!)))
        .firstWhere((center) => center.dy > 100 && center.dy < 500);
    expect(visible, findsNothing); // content ignores touches during a fling
    await tester.tapAt(onScreen + const Offset(15, 0));
    await tester.pumpAndSettle();
    expect(taps, isEmpty);
  });

  testWidgets('keyboard focus reaches each chord and Enter or Space activate',
      (tester) async {
    await pumpRow(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pump();
    expect(taps, ['C', 'G']);
  });

  testWidgets('a hardware keyboard shows a focus ring that takes no space',
      (tester) async {
    FocusManager.instance.highlightStrategy =
        FocusHighlightStrategy.alwaysTraditional;
    addTearDown(() => FocusManager.instance.highlightStrategy =
        FocusHighlightStrategy.automatic);
    await pumpRow(tester);
    bool ringed(String name) => tester
        .widgetList<DecoratedBox>(find.ancestor(
            of: find.text(name), matching: find.byType(DecoratedBox)))
        .any((box) => (box.decoration as BoxDecoration).border != null);
    final before = tester.getRect(find.text('C'));
    expect(ringed('C'), isFalse);

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(ringed('C'), isTrue);
    expect(ringed('G'), isFalse);
    expect(tester.getRect(find.text('C')), before);
  });

  Finder labelled(String name) => find.byWidgetPredicate((w) =>
      w is Semantics && w.properties.label == 'Ver diagrama do acorde $name');

  testWidgets('bar line chords are labelled, focusable and tappable',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: MusicalProgressionLine(
            line: '| C | G | Am |', onChordTap: taps.add),
      ),
    ));
    for (final name in ['C', 'G', 'Am']) {
      expect(labelled(name), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    }
    await tester.tap(find.text('G'));
    expect(taps, ['C', 'G', 'Am', 'G']);
  });

  for (final scale in [1.0, 1.3]) {
    testWidgets('interactive chords do not move the sheet (text ${scale}x)',
        (tester) async {
      Future<(Size, Size, List<Offset>)> measure(
          ValueChanged<String>? onChordTap) async {
        await tester.pumpWidget(MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(scale)),
            child: Scaffold(
              body: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  MusicalProgressionLine(
                      line: '| C | G/B | Am7 |',
                      fontSize: 18,
                      onChordTap: onChordTap),
                  ChordLyricLine(
                      line: '[C]Tu és [G]Deus',
                      semitones: 0,
                      fontSize: 18,
                      fontFamily: 'monospace',
                      fontFamilyFallback: const [],
                      monospace: true,
                      onChordTap: onChordTap),
                ],
              ),
            ),
          ),
        ));
        return (
          tester.getSize(find.byType(MusicalProgressionLine)),
          tester.getSize(find.byType(ChordLyricLine)),
          [
            tester.getTopLeft(find.text('Tu ', findRichText: true)),
            tester.getTopLeft(find.text('Deus', findRichText: true)),
          ],
        );
      }

      final plain = await measure(null);
      final interactive = await measure((_) {});
      // Each chord paragraph rounds its own width, so allow under 1 dp.
      expect(interactive.$1.width, closeTo(plain.$1.width, 1));
      expect(interactive.$1.height, plain.$1.height);
      expect(interactive.$2, plain.$2);
      expect(interactive.$3, plain.$3);
    });
  }
}
