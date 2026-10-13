/// A segment of lyrics with an optional chord placed immediately before or above it.
class SmartChordSegment {
  final String chord;
  final String text;

  const SmartChordSegment({
    required this.chord,
    required this.text,
  });

  bool get hasChord => chord.trim().isNotEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordSegment &&
          runtimeType == other.runtimeType &&
          chord == other.chord &&
          text == other.text;

  @override
  int get hashCode => Object.hash(chord, text);

  @override
  String toString() => 'SmartChordSegment(chord: "$chord", text: "$text")';
}

/// A parsed line of a smart chord sheet containing an index and a list of segments.
class SmartChordLine {
  final int line;
  final List<SmartChordSegment> segments;

  const SmartChordLine({
    required this.line,
    required this.segments,
  });

  bool get isEmpty =>
      segments.isEmpty ||
      (segments.length == 1 &&
          segments.first.chord.isEmpty &&
          segments.first.text.isEmpty);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordLine &&
          runtimeType == other.runtimeType &&
          line == other.line &&
          _listEquals(segments, other.segments);

  static bool _listEquals(
      List<SmartChordSegment> a, List<SmartChordSegment> b) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(line, Object.hashAll(segments));

  @override
  String toString() => 'SmartChordLine(line: $line, segments: $segments)';
}

/// Rendered line with aligned chord line and lyrics line.
class TransposedLine {
  final String chordLine;
  final String lyricsLine;

  const TransposedLine({
    required this.chordLine,
    required this.lyricsLine,
  });

  bool get hasChords => chordLine.trim().isNotEmpty;
  bool get isEmpty => chordLine.trim().isEmpty && lyricsLine.trim().isEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TransposedLine &&
          runtimeType == other.runtimeType &&
          chordLine == other.chordLine &&
          lyricsLine == other.lyricsLine;

  @override
  int get hashCode => Object.hash(chordLine, lyricsLine);

  @override
  String toString() =>
      'TransposedLine(chords: "$chordLine", lyrics: "$lyricsLine")';
}

/// Line representation used for visual interactive editing.
class VisualLine {
  final String cleanText;
  final Map<int, String> chords;

  const VisualLine({
    required this.cleanText,
    required this.chords,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VisualLine &&
          runtimeType == other.runtimeType &&
          cleanText == other.cleanText &&
          _mapEquals(chords, other.chords);

  static bool _mapEquals(Map<int, String> a, Map<int, String> b) {
    if (a.length != b.length) return false;
    for (final entry in a.entries) {
      if (b[entry.key] != entry.value) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(cleanText, Object.hashAll(chords.entries));

  @override
  String toString() => 'VisualLine(cleanText: "$cleanText", chords: $chords)';
}

/// Pure Dart parser, transposition engine and harmonic utility for Smart Chords.
/// Faithful port of web/src/utils/smart_chord.ts with robust edge-case handling.
class SmartChordParser {
  static const List<String> scale = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  static const Map<String, String> flatMap = {
    'Db': 'C#',
    'Eb': 'D#',
    'Gb': 'F#',
    'Ab': 'G#',
    'Bb': 'A#',
  };

  static const List<String> standardKeys = [
    'C',
    'C#',
    'Db',
    'D',
    'Eb',
    'E',
    'F',
    'F#',
    'Gb',
    'G',
    'Ab',
    'A',
    'Bb',
    'B',
    'Cm',
    'C#m',
    'Dm',
    'D#m',
    'Ebm',
    'Em',
    'Fm',
    'F#m',
    'Gm',
    'G#m',
    'Abm',
    'Am',
    'Bbm',
    'Bm',
  ];

  static final RegExp _chordRegex = RegExp(r'\[(.*?)\]');
  static final RegExp _rootSuffixRegex =
      RegExp(r'^([A-G][#b]?)(.*)$', caseSensitive: false);

  /// Parses raw text with bracketed chords (e.g. "Amanhã [G]será outro [Am]dia") into lines and segments.
  static List<SmartChordLine> parse(String? smartChordText) {
    if (smartChordText == null || smartChordText.isEmpty) {
      return const [];
    }

    final normalized =
        smartChordText.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    final lines = normalized.split('\n');
    final result = <SmartChordLine>[];

    for (int index = 0; index < lines.length; index++) {
      final lineText = lines[index];
      if (lineText.trim().isEmpty) {
        result.add(SmartChordLine(line: index + 1, segments: const []));
        continue;
      }

      final segments = <SmartChordSegment>[];
      final matches = _chordRegex.allMatches(lineText).toList();

      if (matches.isEmpty) {
        segments.add(SmartChordSegment(chord: '', text: lineText));
      } else {
        // Initial text before first bracket
        final firstMatch = matches.first;
        if (firstMatch.start > 0) {
          segments.add(SmartChordSegment(
            chord: '',
            text: lineText.substring(0, firstMatch.start),
          ));
        }

        for (int i = 0; i < matches.length; i++) {
          final match = matches[i];
          final rawChord = match.group(1) ?? '';
          final textStart = match.end;
          final textEnd =
              (i + 1 < matches.length) ? matches[i + 1].start : lineText.length;
          final nextText = lineText.substring(textStart, textEnd);

          segments.add(SmartChordSegment(
            chord: rawChord.trim(),
            text: nextText,
          ));
        }
      }

      result.add(SmartChordLine(line: index + 1, segments: segments));
    }

    return result;
  }

  /// Transposes a single musical note (e.g. C, C#, Db) by [semitones].
  static String transposeNote(String note, int semitones) {
    if (note.isEmpty) return note;
    String normalized = note;
    if (flatMap.containsKey(note)) {
      normalized = flatMap[note]!;
    }

    final index = scale.indexOf(normalized);
    if (index == -1) return note;

    var newIndex = (index + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    return scale[newIndex];
  }

  /// Transposes a single root chord (without slashes), e.g. "C#m7", "Gadd9".
  static String _transposeChordSingle(String chord, int semitones) {
    if (chord.isEmpty) return chord;
    final match = _rootSuffixRegex.firstMatch(chord);
    if (match == null) return chord;

    final root = match.group(1)!;
    final suffix = match.group(2) ?? '';
    final newRoot = transposeNote(root, semitones);
    return newRoot + suffix;
  }

  /// Transposes a chord string (e.g. "C#m7", "C/E", "F#m7(b5)") by [semitones].
  static String transposeChord(String chord, int semitones) {
    if (chord.isEmpty) return '';
    if (semitones == 0) return chord;

    if (chord.contains('/')) {
      final parts = chord.split('/');
      return parts
          .map((part) => _transposeChordSingle(part, semitones))
          .join('/');
    }

    return _transposeChordSingle(chord, semitones);
  }

  /// Transposes a musical key (e.g. "G", "Am", "Eb", "F#m") by [semitones].
  static String transposeKey(String key, int semitones) {
    if (key.trim().isEmpty || semitones == 0) return key;
    final trimmed = key.trim();
    final match = _rootSuffixRegex.firstMatch(trimmed);
    if (match == null) return trimmed;

    final root = match.group(1)!;
    final suffix = match.group(2) ?? '';
    return transposeNote(root, semitones) + suffix;
  }

  /// Transposes an entire bracket-format song text by [semitones].
  static String transposeSmartChord(String? smartChordText, int semitones) {
    if (smartChordText == null || smartChordText.isEmpty || semitones == 0) {
      return smartChordText ?? '';
    }

    final lines = parse(smartChordText);
    return lines.map((line) {
      if (line.segments.isEmpty) return '';
      return line.segments.map((seg) {
        if (seg.chord.isNotEmpty) {
          final newChord = transposeChord(seg.chord, semitones);
          return '[$newChord]${seg.text}';
        }
        return seg.text;
      }).join();
    }).join('\n');
  }

  /// Renders a single bracket-format line into an aligned chord line and lyrics line.
  static TransposedLine renderLine(String? lineText, int semitones) {
    if (lineText == null || lineText.isEmpty) {
      return const TransposedLine(chordLine: '', lyricsLine: '');
    }

    final chordChars = <String>[];
    final cleanTextBuffer = StringBuffer();
    int cleanIndex = 0;
    int lastIndex = 0;

    for (final match in _chordRegex.allMatches(lineText)) {
      final textBetween = lineText.substring(lastIndex, match.start);
      cleanTextBuffer.write(textBetween);
      cleanIndex += textBetween.length;

      final originalChord = match.group(1) ?? '';
      final transposedChord = transposeChord(originalChord.trim(), semitones);

      // Find first available index to avoid overlapping
      int writeIndex = cleanIndex;
      while (writeIndex < chordChars.length && chordChars[writeIndex] != ' ') {
        writeIndex++;
      }

      // Pad array with spaces if needed
      while (chordChars.length < writeIndex + transposedChord.length) {
        chordChars.add(' ');
      }

      // Write chord characters
      for (int i = 0; i < transposedChord.length; i++) {
        chordChars[writeIndex + i] = transposedChord[i];
      }

      lastIndex = match.end;
    }

    final remainingText = lineText.substring(lastIndex);
    cleanTextBuffer.write(remainingText);
    final cleanText = cleanTextBuffer.toString();

    while (chordChars.length < cleanText.length) {
      chordChars.add(' ');
    }

    return TransposedLine(
      chordLine: chordChars.join(),
      lyricsLine: cleanText,
    );
  }

  /// Converts a bracket-format line to a [VisualLine] for interactive editing.
  static VisualLine rawToVisual(String rawLine) {
    final cleanTextBuffer = StringBuffer();
    final chords = <int, String>{};
    int currentPos = 0;
    int lastPos = 0;

    for (final match in _chordRegex.allMatches(rawLine)) {
      if (match.start > lastPos) {
        final textSegment = rawLine.substring(lastPos, match.start);
        cleanTextBuffer.write(textSegment);
        currentPos += textSegment.length;
      }
      final chord = match.group(1) ?? '';
      chords[currentPos] = chord.trim();
      lastPos = match.end;
    }

    if (lastPos < rawLine.length) {
      final textSegment = rawLine.substring(lastPos);
      cleanTextBuffer.write(textSegment);
    }

    return VisualLine(
      cleanText: cleanTextBuffer.toString(),
      chords: chords,
    );
  }

  /// Converts a [VisualLine] back into bracketed raw text.
  static String visualToRaw(VisualLine visual) {
    final buffer = StringBuffer();
    final text = visual.cleanText;

    for (int i = 0; i <= text.length; i++) {
      if (visual.chords.containsKey(i)) {
        buffer.write('[${visual.chords[i]}]');
      }
      if (i < text.length) {
        buffer.write(text[i]);
      }
    }

    return buffer.toString();
  }

  /// Returns harmonic field chords for the specified key.
  static List<String> getHarmonicFieldChords(String originalKey) {
    var key = originalKey.trim();
    final isMinor = key.endsWith('m');
    if (isMinor) {
      key = key.substring(0, key.length - 1);
    }

    const majorFields = <String, List<String>>{
      'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'],
      'C#': ['C#', 'D#m', 'E#m', 'F#', 'G#', 'A#m', 'B#dim'],
      'Db': ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'],
      'D': ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'],
      'Eb': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'],
      'E': ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'],
      'F': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'],
      'F#': ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'],
      'Gb': ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm', 'Fdim'],
      'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'],
      'Ab': ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'],
      'A': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'],
      'Bb': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'],
      'B': ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'],
    };

    final field =
        majorFields[key] ?? const ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];

    if (isMinor) {
      return [
        field[5], // VIm
        field[6], // VIIdim
        field[0], // I
        field[1], // IIm
        field[2], // IIIm
        field[3], // IV
        field[4], // V
      ];
    }
    return field;
  }

  /// Returns chord suggestions based on query and original key.
  static List<String> getSuggestions(String query, String originalKey) {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      return getHarmonicFieldChords(originalKey);
    }

    final match = _rootSuffixRegex.firstMatch(trimmed);
    if (match == null) return const [];

    final root = match.group(1)!.toUpperCase();
    const extensions = [
      '',
      'm',
      '7',
      'm7',
      'maj7',
      '9',
      'sus4',
      'dim',
      'm7(b5)',
    ];

    return extensions
        .map((ext) => root + ext)
        .where((s) =>
            s.toLowerCase().startsWith(trimmed.toLowerCase()) &&
            s.toLowerCase() != trimmed.toLowerCase())
        .toList();
  }
}
