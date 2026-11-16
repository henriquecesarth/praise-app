import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import '../../domain/smart_chord_parser.dart';

/// A single scrollable musical row shared by readers and previews.
class MusicalProgressionLine extends StatefulWidget {
  final String line;
  final int semitones;
  final double fontSize;
  final String fontFamily;
  final List<String>? fontFamilyFallback;
  final ValueChanged<String>? onChordTap;

  const MusicalProgressionLine({
    super.key,
    required this.line,
    this.semitones = 0,
    this.fontSize = 14,
    this.fontFamily = 'monospace',
    this.fontFamilyFallback,
    this.onChordTap,
  });

  @override
  State<MusicalProgressionLine> createState() => _MusicalProgressionLineState();
}

class _MusicalProgressionLineState extends State<MusicalProgressionLine> {
  final List<TapGestureRecognizer> _recognizers = [];
  List<MusicalProgressionToken> _tokens = [];

  @override
  void initState() {
    super.initState();
    _rebuildRecognizers();
  }

  @override
  void didUpdateWidget(covariant MusicalProgressionLine oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.line != widget.line ||
        oldWidget.semitones != widget.semitones ||
        oldWidget.onChordTap != widget.onChordTap) {
      _rebuildRecognizers();
    }
  }

  void _rebuildRecognizers() {
    _disposeRecognizers();
    _tokens = SmartChordParser.progressionTokens(widget.line, widget.semitones) ?? [];
    if (widget.onChordTap != null) {
      for (final token in _tokens) {
        if (token.isChord) {
          final chord = token.text;
          _recognizers.add(
            TapGestureRecognizer()..onTap = () => widget.onChordTap!(chord),
          );
        }
      }
    }
  }

  void _disposeRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    var chordIndex = 0;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Text.rich(
        TextSpan(
          children: _tokens.map((token) {
            TapGestureRecognizer? recognizer;
            if (token.isChord && widget.onChordTap != null && chordIndex < _recognizers.length) {
              recognizer = _recognizers[chordIndex++];
            }
            return TextSpan(
              text: token.text,
              recognizer: recognizer,
              style: TextStyle(
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
                fontSize: token.isAnnotation ? widget.fontSize * 0.85 : widget.fontSize,
                fontStyle: FontStyle.normal,
              ),
            );
          }).toList(),
        ),
        softWrap: false,
        style: TextStyle(
          fontFamily: 'monospace',
          fontFamilyFallback: widget.fontFamilyFallback,
          fontSize: widget.fontSize,
          height: 1.4,
        ),
      ),
    );
  }
}
