import 'package:flutter/material.dart';
import '../../domain/smart_chord_parser.dart';
import 'chord_tap_target.dart';

/// A single scrollable musical row shared by readers and previews.
class MusicalProgressionLine extends StatelessWidget {
  final String line;
  final int semitones;
  final double fontSize;
  final String fontFamily;
  final List<String>? fontFamilyFallback;
  final ValueChanged<String>? onChordTap;
  /// Called right before [onChordTap].
  final ValueChanged<ChordNeighbours>? onChordNeighbours;

  const MusicalProgressionLine({
    super.key,
    required this.line,
    this.semitones = 0,
    this.fontSize = 14,
    this.fontFamily = 'monospace',
    this.fontFamilyFallback,
    this.onChordTap,
    this.onChordNeighbours,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SmartChordParser.progressionTokens(line, semitones) ?? [];
    final rowStyle = TextStyle(
      fontFamily: 'monospace',
      fontFamilyFallback: fontFamilyFallback,
      fontSize: fontSize,
      height: 1.4,
    );

    InlineSpan buildSpan(MusicalProgressionToken token) {
      final style = TextStyle(
        color: token.isChord || token.text == '%'
            ? theme.colorScheme.primary
            : token.isAnnotation
                ? theme.colorScheme.primary
                : token.isDelimiter
                    ? theme.colorScheme.onSurfaceVariant
                    : theme.colorScheme.onSurface,
        fontWeight: token.isChord || token.isDelimiter || token.isAnnotation
            ? FontWeight.bold
            : FontWeight.normal,
        fontSize: token.isAnnotation ? fontSize * 0.85 : fontSize,
        fontStyle: FontStyle.normal,
      );
      if (!token.isChord || onChordTap == null) {
        return TextSpan(text: token.text, style: style);
      }
      // A widget span so the chord can take focus and carry its own label.
      return WidgetSpan(
        alignment: PlaceholderAlignment.baseline,
        baseline: TextBaseline.alphabetic,
        child: ChordTapTarget(
          chord: token.text,
          onActivate: () {
            final chords = tokens.where((item) => item.isChord).toList();
            onChordNeighbours?.call(lineNeighbours(
              [for (final item in chords) item.text],
              chords.indexWhere((item) => identical(item, token)),
            ));
            onChordTap!(token.text);
          },
          child: Text(
            token.text,
            style: rowStyle.merge(style),
            softWrap: false,
            // The enclosing paragraph already scales its widget spans.
            textScaler: TextScaler.noScaling,
          ),
        ),
      );
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Text.rich(
        TextSpan(children: tokens.map(buildSpan).toList()),
        softWrap: false,
        style: rowStyle,
      ),
    );
  }
}
