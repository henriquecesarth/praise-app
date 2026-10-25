import 'package:flutter/material.dart';
import '../../domain/smart_chord_parser.dart';

/// A single scrollable musical row shared by readers and previews.
class MusicalProgressionLine extends StatelessWidget {
  final String line;
  final int semitones;
  final double fontSize;
  final String fontFamily;
  final List<String>? fontFamilyFallback;

  const MusicalProgressionLine({
    super.key,
    required this.line,
    this.semitones = 0,
    this.fontSize = 14,
    this.fontFamily = 'monospace',
    this.fontFamilyFallback,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SmartChordParser.progressionTokens(line, semitones) ?? [];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Text.rich(
        TextSpan(children: tokens.map((token) => TextSpan(
          text: token.text,
          style: TextStyle(
            color: token.isChord || token.text == '%' ? theme.colorScheme.primary :
              token.isDelimiter ? theme.colorScheme.onSurfaceVariant : theme.colorScheme.onSurface,
            fontWeight: token.isChord || token.isDelimiter ? FontWeight.bold : FontWeight.normal,
          ),
        )).toList()),
        softWrap: false,
        style: TextStyle(fontFamily: fontFamily, fontFamilyFallback: fontFamilyFallback,
          fontSize: fontSize, height: 1.4),
      ),
    );
  }
}
