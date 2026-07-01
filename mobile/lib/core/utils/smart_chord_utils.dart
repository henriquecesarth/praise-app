class ChordSegment {
  final String chord;
  final String text;

  const ChordSegment({required this.chord, required this.text});

  @override
  String toString() => 'ChordSegment(chord: $chord, text: $text)';
}

class SmartChordLine {
  final int line;
  final List<ChordSegment> segments;

  const SmartChordLine({required this.line, required this.segments});

  @override
  String toString() => 'SmartChordLine(line: $line, segments: $segments)';
}

class SmartChordUtils {
  static const List<String> _scale = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
  ];

  static const Map<String, String> _flatMap = {
    'Db': 'C#',
    'Eb': 'D#',
    'Gb': 'F#',
    'Ab': 'G#',
    'Bb': 'A#',
  };

  /// Parses bracket-cifra text into a list of lines with chord-text segments.
  static List<SmartChordLine> parseSmartChord(String text) {
    if (text.isEmpty) return [];
    final lines = text.split('\n');
    final List<SmartChordLine> result = [];
    final chordRegex = RegExp(r'\[(.*?)\]');

    for (int index = 0; index < lines.length; index++) {
      final lineText = lines[index];
      if (lineText.trim().isEmpty) {
        result.add(SmartChordLine(line: index + 1, segments: []));
        continue;
      }

      final List<ChordSegment> segments = [];
      final matches = chordRegex.allMatches(lineText);

      if (matches.isEmpty) {
        segments.add(ChordSegment(chord: '', text: lineText));
      } else {
        int lastPos = 0;
        String currentChord = '';

        for (final match in matches) {
          // Add segment for text preceding this match
          if (match.start > lastPos) {
            final textSegment = lineText.substring(lastPos, match.start);
            segments.add(ChordSegment(chord: currentChord, text: textSegment));
            currentChord = ''; // clear consumed chord
          }
          currentChord = match.group(1) ?? '';
          lastPos = match.end;
        }

        // Add remaining text segment
        if (lastPos < lineText.length) {
          segments.add(ChordSegment(chord: currentChord, text: lineText.substring(lastPos)));
        } else if (currentChord.isNotEmpty) {
          segments.add(ChordSegment(chord: currentChord, text: ''));
        }
      }
      result.add(SmartChordLine(line: index + 1, segments: segments));
    }
    return result;
  }

  /// Transposes a single note by n semitones.
  static String transposeNote(String note, int semitones) {
    String normalized = _flatMap[note] ?? note;
    final index = _scale.indexOf(normalized);
    if (index == -1) return note; // Keep as is if unrecognized
    int newIndex = (index + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    return _scale[newIndex];
  }

  static String _transposeChordSingle(String chord, int semitones) {
    final regex = RegExp(r'^([A-G][#b]?)(.*)$');
    final match = regex.firstMatch(chord);
    if (match == null) return chord;
    final root = match.group(1) ?? '';
    final suffix = match.group(2) ?? '';
    final transposedRoot = transposeNote(root, semitones);
    return transposedRoot + suffix;
  }

  /// Transposes a chord (e.g. C#m7 or C/E) by n semitones.
  static String transposeChord(String chord, int semitones) {
    if (chord.isEmpty) return '';
    if (chord.contains('/')) {
      final parts = chord.split('/');
      return parts.map((part) => _transposeChordSingle(part, semitones)).join('/');
    }
    return _transposeChordSingle(chord, semitones);
  }

  /// Transposes a full bracket markup song by n semitones.
  static String transposeSmartChord(String text, int semitones) {
    final lines = parseSmartChord(text);
    return lines.map((line) {
      if (line.segments.isEmpty) return '';
      return line.segments.map((seg) {
        if (seg.chord.isNotEmpty) {
          final newChord = transposeChord(seg.chord, semitones);
          return '[$newChord]${seg.text}';
        }
        return seg.text;
      }).join('');
    }).join('\n');
  }

  /// Generates a chord line and a lyrics line aligned for monospace display.
  static TransposedLine renderSmartChordLine(String lineText, int semitones) {
    if (lineText.isEmpty) {
      return const TransposedLine(chordLine: '', lyricsLine: '');
    }

    String cleanText = '';
    int cleanIndex = 0;
    final chordRegex = RegExp(r'\[(.*?)\]');
    final matches = chordRegex.allMatches(lineText);
    
    final List<String> chordChars = [];
    int lastPos = 0;

    for (final match in matches) {
      final textBetween = lineText.substring(lastPos, match.start);
      cleanText += textBetween;
      cleanIndex += textBetween.length;

      final originalChord = match.group(1) ?? '';
      final transposedChord = transposeChord(originalChord, semitones);

      // Find first available index to avoid overlapping
      int writeIndex = cleanIndex;
      while (writeIndex < chordChars.length && chordChars[writeIndex] != ' ') {
        writeIndex++;
      }

      // Grow list if needed
      while (chordChars.length < writeIndex + transposedChord.length) {
        chordChars.add(' ');
      }

      // Write chord
      for (int i = 0; i < transposedChord.length; i++) {
        chordChars[writeIndex + i] = transposedChord[i];
      }

      lastPos = match.end;
    }

    // Append remaining text
    final remainingText = lineText.substring(lastPos);
    cleanText += remainingText;

    // Pad chord line to match lyrics line length
    while (chordChars.length < cleanText.length) {
      chordChars.add(' ');
    }

    return TransposedLine(
      chordLine: chordChars.join(''),
      lyricsLine: cleanText,
    );
  }
}

class TransposedLine {
  final String chordLine;
  final String lyricsLine;

  const TransposedLine({required this.chordLine, required this.lyricsLine});
}
