import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../domain/smart_chord_parser.dart';

/// Measured syllabic reader layout. No padding is written into musical content.
class ChordLyricLine extends StatelessWidget {
  final String line;
  final int semitones;
  final double fontSize;
  final String fontFamily;
  final List<String> fontFamilyFallback;
  final bool monospace;

  const ChordLyricLine({super.key, required this.line, required this.semitones,
    required this.fontSize, required this.fontFamily,
    required this.fontFamilyFallback, required this.monospace});

  @override
  Widget build(BuildContext context) {
    if (line.trim().isEmpty) return SizedBox(height: fontSize * 0.8);
    if (SmartChordParser.isTablatureLine(line)) {
      return SingleChildScrollView(scrollDirection: Axis.horizontal,
        child: SelectableText(line, style: TextStyle(fontFamily: 'monospace',
          fontSize: fontSize, height: 1.3)));
    }
    final theme = Theme.of(context);
    final lyricStyle = TextStyle(fontFamily: fontFamily, fontFamilyFallback: fontFamilyFallback,
      fontSize: fontSize, color: theme.colorScheme.onSurface, height: 1.3);
    final chordStyle = lyricStyle.copyWith(fontWeight: FontWeight.bold,
      color: theme.colorScheme.primary, height: 1.2);
    final segments = SmartChordParser.parse(line).first.segments;
    if (!segments.any((segment) => segment.hasChord)) {
      return Padding(padding: const EdgeInsets.only(bottom: 6),
        child: SelectableText(line, style: lyricStyle));
    }
    final scale = MediaQuery.textScalerOf(context);
    double width(String value, TextStyle style) {
      final painter = TextPainter(text: TextSpan(text: value, style: style),
        textDirection: Directionality.of(context), textScaler: scale)..layout();
      final measured = painter.width.ceilToDouble();
      painter.dispose();
      return measured;
    }

    // Group all fragments of one word, even when chords split its syllables.
    final words = <List<SmartChordSegment>>[];
    var word = <SmartChordSegment>[];
    for (final segment in segments) {
      final pieces = RegExp(r'\S+\s*|\s+').allMatches(segment.text).map((m) => m.group(0)!).toList();
      if (pieces.isEmpty) pieces.add('');
      for (int i = 0; i < pieces.length; i++) {
        word.add(SmartChordSegment(chord: i == 0 ? segment.chord : '', text: pieces[i]));
        if (RegExp(r'\s$').hasMatch(pieces[i])) {
          words.add(word);
          word = [];
        }
      }
    }
    if (word.isNotEmpty) words.add(word);

    if (monospace) {
      // SelectableText can wrap inside a fixed fragment even in a horizontal
      // scroller. Its inherited style can also differ from the standalone
      // TextPainter measurement (for example Material letter spacing).
      // Let the displayed paragraphs determine their own intrinsic widths,
      // including inherited style, text scaling, locale and platform fallback.
      return LayoutBuilder(builder: (context, constraints) {
        var fragmentIndex = 0;
        return Padding(padding: const EdgeInsets.only(bottom: 10),
          child: SelectionArea(child: Wrap(runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: [
              for (var wordIndex = 0; wordIndex < words.length; wordIndex++)
                IntrinsicWidth(child: ConstrainedBox(
                  key: ValueKey('reader-word-$wordIndex'),
                  constraints: BoxConstraints(maxWidth: constraints.maxWidth),
                  child: SingleChildScrollView(scrollDirection: Axis.horizontal,
                    child: Row(mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        for (final fragment in words[wordIndex])
                          Column(key: ValueKey('reader-fragment-${fragmentIndex++}'),
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Padding(padding: const EdgeInsets.only(right: 7),
                                child: Text(fragment.hasChord
                                  ? SmartChordParser.transposeChord(fragment.chord, semitones) : ' ',
                                  style: chordStyle.copyWith(color: fragment.hasChord
                                    ? chordStyle.color : Colors.transparent), softWrap: false)),
                              Text(fragment.text.isEmpty ? ' ' : fragment.text,
                                style: lyricStyle, softWrap: false),
                            ]),
                      ])),
                )),
            ])));
      });
    }

    return LayoutBuilder(builder: (context, constraints) {
      int fragmentIndex = 0;
      final items = <Widget>[];
      for (int wordIndex = 0; wordIndex < words.length; wordIndex++) {
        final fragments = <Widget>[];
        double wordWidth = 0;
        for (final fragment in words[wordIndex]) {
          final chord = SmartChordParser.transposeChord(fragment.chord, semitones);
          final fragmentWidth = math.max(width(fragment.text, lyricStyle),
            chord.isEmpty ? 0.0 : width(chord, chordStyle) + 6) + 1;
          wordWidth += fragmentWidth;
          Widget tier(String value, TextStyle style) => monospace
            ? SelectableText(value, style: style)
            : Text(value, style: style, softWrap: false);
          fragments.add(SizedBox(width: fragmentWidth,
            child: Column(key: ValueKey('reader-fragment-${fragmentIndex++}'),
              crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min,
              children: [
                tier(chord.isEmpty ? ' ' : chord, chordStyle.copyWith(
                  color: chord.isEmpty ? Colors.transparent : chordStyle.color)),
                tier(fragment.text.isEmpty ? ' ' : fragment.text, lyricStyle),
              ])));
        }
        final row = Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end,
          children: fragments);
        items.add(SizedBox(key: ValueKey('reader-word-$wordIndex'),
          width: !monospace && wordWidth > constraints.maxWidth ? constraints.maxWidth : wordWidth,
          child: !monospace && wordWidth > constraints.maxWidth
            ? SingleChildScrollView(scrollDirection: Axis.horizontal, child: row) : row));
      }
      return Padding(padding: const EdgeInsets.only(bottom: 10), child: monospace
        ? SingleChildScrollView(scrollDirection: Axis.horizontal,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: items))
        : SelectionArea(child: Wrap(runSpacing: 10, crossAxisAlignment: WrapCrossAlignment.end,
            children: items)));
    });
  }
}
