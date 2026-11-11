/// A token on one instrumental line. Surrounding labels/annotations stay textual.
class MusicalProgressionToken {
  final String text;
  final bool isChord;
  final bool isDelimiter;
  final bool isAnnotation;
  const MusicalProgressionToken(
    this.text, {
    this.isChord = false,
    this.isDelimiter = false,
    this.isAnnotation = false,
  });
}

enum AnnotationKind { entry, exit, dynamics, technique, note }

enum AnnotationPlacement { line, inline, aboveNextChord }

class MusicalInstruction {
  final int line;
  final int token;
  final String text;
  final String displayText;
  final String sourceRaw;
  final AnnotationKind kind;
  final AnnotationPlacement placement;
  final ({int line, int token})? target;
  final double fontScale;

  const MusicalInstruction({
    required this.line,
    required this.token,
    required this.text,
    required this.displayText,
    required this.sourceRaw,
    required this.kind,
    required this.placement,
    this.target,
    this.fontScale = 0.8,
  });
}

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
      RegExp(r'^([A-G][#b♯♭♮]?)(.*)$', caseSensitive: false);

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
      final matches = isTablatureLine(lineText)
          ? <RegExpMatch>[]
          : _chordRegex.allMatches(lineText).where((m) => isMusicalChord(m.group(1)!)).toList();

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

  static final RegExp rootRegex =
      RegExp(r'^([A-G][#b]?)(.*)$', caseSensitive: false);
  static final RegExp extRegex = RegExp(
    r'^(m|min|maj|M|dim|aug|sus[24]?|add[249]?|[0-9]+|\+|\-|\((b5|#5|b9|#9|9|11|#11|13|b13|5-|5\+|add[249]?)\)|b5|#5|b9|#9|b13|#11|alt|7M|M7)*$',
  );

  static String _normalizeUnicodeAccidentals(String token) {
    return token
        .replaceAll('♭', 'b')
        .replaceAll('♯', '#')
        .replaceAll('♮', '');
  }

  /// Validates whether a token is a legitimate musical chord and not a word or annotation
  /// (e.g. Baixo, Corte, Dedilhado, Fim).
  // Only independently valid chords form a terminal alternative, e.g. Am(G).
  static RegExpMatch? _alternativeChordParts(String token) {
    final match = RegExp(r'^([^()\s]+)\(([^()\s]+)\)$').firstMatch(token);
    return match != null && isMusicalChord(match.group(1)!) &&
        isMusicalChord(match.group(2)!) ? match : null;
  }

  static bool isMusicalChord(String token) {
    if (token.isEmpty) return false;
    final trimmed = _normalizeUnicodeAccidentals(token.trim());
    if (trimmed.isEmpty) return false;
    if (_alternativeChordParts(trimmed) != null) return true;

    final slashParts = trimmed.split('/');
    if (slashParts.length > 2) return false;

    final mainPart = slashParts[0];
    final match = rootRegex.firstMatch(mainPart);
    if (match == null) return false;

    final ext = match.group(2) ?? '';
    if (ext.isNotEmpty && !extRegex.hasMatch(ext)) return false;

    if (slashParts.length == 2) {
      final bassPart = slashParts[1];
      if (bassPart.isEmpty) return false;
      final bassMatch = rootRegex.firstMatch(bassPart);
      final isBassRoot =
          bassMatch != null && extRegex.hasMatch(bassMatch.group(2) ?? '');
      final isNumericExtension = RegExp(r'^[0-9]+$').hasMatch(bassPart);
      if (!isBassRoot && !isNumericExtension) return false;
    }

    return true;
  }

  /// Transposes a single root chord (without slashes), e.g. "C#m7", "Gadd9".
  static String _transposeChordSingle(String chord, int semitones) {
    if (chord.isEmpty) return chord;
    final match = rootRegex.firstMatch(chord);
    if (match == null) return chord;

    final root = match.group(1)!;
    final suffix = match.group(2) ?? '';
    if (suffix.isNotEmpty && !extRegex.hasMatch(suffix)) {
      // Non-chord annotation like Baixo, Corte - preserve as-is
      return chord;
    }
    final newRoot = transposeNote(root, semitones);
    return newRoot + suffix;
  }

  static String _styleUnicodeNote(String note, String original) {
    const sharpToUnicodeFlat = <String, String>{
      'C#': 'D♭',
      'D#': 'E♭',
      'F#': 'G♭',
      'G#': 'A♭',
      'A#': 'B♭',
    };
    final mapped = original.contains('♭')
        ? (sharpToUnicodeFlat[note] ?? note)
        : note;
    return mapped.replaceAll('#', '♯').replaceAll('b', '♭');
  }

  /// Transposes a chord string (e.g. "C#m7", "C/E", "F#m7(b5)", "B♭maj7") by [semitones].
  static String transposeChord(String chord, int semitones) {
    if (chord.isEmpty) return '';
    if (semitones == 0) return chord;
    final alternative = _alternativeChordParts(chord);
    if (alternative != null) {
      return '${transposeChord(alternative.group(1)!, semitones)}'
          '(${transposeChord(alternative.group(2)!, semitones)})';
    }


    if (chord.contains('|') || chord.contains('%')) {
      return progressionTokens('[$chord]', semitones)!
          .map((token) => token.text)
          .join();
    }

    if (RegExp(r'[♭♯♮]').hasMatch(chord)) {
      final normalized = _normalizeUnicodeAccidentals(chord);
      if (!isMusicalChord(normalized)) return chord;
      final transposed = transposeChord(normalized, semitones);
      final target =
          RegExp(r'^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$').firstMatch(transposed);
      final source =
          RegExp(r'^([A-G][#b♯♭♮]?)(.*?)(?:\/([A-G][#b♯♭♮]?))?$').firstMatch(chord);
      if (target == null || source == null) return chord;
      final rootStyled = _styleUnicodeNote(target.group(1)!, source.group(1)!);
      final ext = target.group(2) ?? '';
      final bassStyled = (target.group(3) != null && source.group(3) != null)
          ? '/${_styleUnicodeNote(target.group(3)!, source.group(3)!)}'
          : '';
      return '$rootStyled$ext$bassStyled';
    }

    if (!isMusicalChord(chord)) return chord;

    if (chord.contains('/')) {
      final parts = chord.split('/');
      if (parts.length == 2 && RegExp(r'^[0-9]+$').hasMatch(parts[1])) {
        // Compound extension like A7M/9
        return '${_transposeChordSingle(parts[0], semitones)}/${parts[1]}';
      }
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

  static const List<String> _barlineSymbols = [
    '||:',
    ':||',
    '|:',
    ':|',
    '||',
    '|',
  ];

  static bool isUnbracketedBarProgression(String raw) {
    if (isTablatureLine(raw)) return false;
    var rest = raw.trimLeft();
    while (rest.startsWith('{{')) {
      final close = rest.indexOf('}}', 2);
      if (close < 0) break;
      rest = rest.substring(close + 2).trimLeft();
    }
    return RegExp(r'^(?:\|\|:|\|:|\|)').hasMatch(rest);
  }

  static bool hasBarProgression(String line) => progressionTokens(line) != null;

  static List<MusicalProgressionToken> _tokenizeBarProgression(
    String raw,
    int semitones,
  ) {
    final tokens = <MusicalProgressionToken>[];
    int i = 0;
    while (i < raw.length) {
      if (raw.startsWith('{{', i)) {
        final close = raw.indexOf('}}', i + 2);
        if (close != -1) {
          tokens.add(
            MusicalProgressionToken(
              raw.substring(i, close + 2),
              isAnnotation: true,
            ),
          );
          i = close + 2;
          continue;
        }
      }
      String? matchedBar;
      for (final symbol in _barlineSymbols) {
        if (raw.startsWith(symbol, i)) {
          matchedBar = symbol;
          break;
        }
      }
      if (matchedBar != null) {
        tokens.add(MusicalProgressionToken(matchedBar, isDelimiter: true));
        i += matchedBar.length;
        continue;
      }
      if (RegExp(r'\s').hasMatch(raw[i])) {
        var end = i + 1;
        while (end < raw.length && RegExp(r'\s').hasMatch(raw[end])) {
          end++;
        }
        tokens.add(MusicalProgressionToken(raw.substring(i, end)));
        i = end;
        continue;
      }
      if (raw[i] == '(') {
        final end = raw.indexOf(')', i + 1);
        if (end != -1) {
          final inner = raw.substring(i + 1, end);
          if (isMusicalChord(inner)) {
            tokens.add(
              MusicalProgressionToken(
                '(${transposeChord(inner, semitones)})',
                isChord: true,
              ),
            );
            i = end + 1;
            continue;
          }
        }
      }
      if (raw[i] == '%') {
        tokens.add(const MusicalProgressionToken('%', isDelimiter: true));
        i++;
        continue;
      }
      var end = i + 1;
      while (
          end < raw.length && !RegExp(r'[\s|%\[\]{}]').hasMatch(raw[end])) {
        end++;
      }
      final candidate = raw.substring(i, end);
      if (isMusicalChord(candidate)) {
        tokens.add(
          MusicalProgressionToken(
            transposeChord(candidate, semitones),
            isChord: true,
          ),
        );
        i = end;
        continue;
      }
      final opening = candidate.indexOf('(');
      if (opening > 0 && isMusicalChord(candidate.substring(0, opening))) {
        final prefix = candidate.substring(0, opening);
        tokens.add(
          MusicalProgressionToken(
            transposeChord(prefix, semitones),
            isChord: true,
          ),
        );
        i += opening;
        continue;
      }
      tokens.add(MusicalProgressionToken(candidate));
      i = end;
    }
    return tokens;
  }

  /// Dedicated representation for a progression: never split its label into a lyric row.
  static List<MusicalProgressionToken>? progressionTokens(String line, [int semitones = 0]) {
    if (isTablatureLine(line)) return null;
    if (isUnbracketedBarProgression(line)) {
      return _tokenizeBarProgression(line, semitones);
    }
    // Own-line chords occupy their printed width. Brackets are syntax only;
    // removing the chord width would collapse every subsequent column.
    final row = line.replaceAllMapped(_chordRegex, (m) =>
        isMusicalChord(m.group(1)!) ? m.group(1)! : m.group(0)!);
    final label = RegExp(
      r'^\s*(?:\[[^\]]+\]|(?:Intro|Interlúdio|Interludio|Refrão|Refrao|Final)\s*:)\s*',
      caseSensitive: false,
    ).firstMatch(row);
    final labelText = label?.group(0)?.trim() ?? '';
    final start = labelText.startsWith('[') &&
        isMusicalChord(labelText.substring(1, labelText.length - 1))
        ? 0 : label?.end ?? 0;
    final tail = row.substring(start);
    final rowTokens = RegExp(r'\s+|[|:%]+|[^\s|:%]+').allMatches(tail).toList();
    String chordOf(String value) => value.replaceAll(RegExp(r'^\(|\)$'), '');
    if (rowTokens.any((m) => isMusicalChord(chordOf(m.group(0)!))) &&
        rowTokens.every((m) => isMusicalChord(chordOf(m.group(0)!)) ||
          RegExp(r'^(?:\s+|[|:%]+|\(?\d+[xX]\)?)$').hasMatch(m.group(0)!))) {
      return [
        if (start > 0) MusicalProgressionToken(row.substring(0, start)),
        for (final match in rowTokens)
          MusicalProgressionToken(
            isMusicalChord(chordOf(match.group(0)!))
              ? match.group(0)!.replaceFirst(chordOf(match.group(0)!), transposeChord(chordOf(match.group(0)!), semitones))
              : match.group(0)!,
            isChord: isMusicalChord(chordOf(match.group(0)!)),
          ),
      ];
    }
    final groups = RegExp(r'\[([^\[\]]*)\]').allMatches(line).toList();
    final tokenPattern = RegExp(r'\([^()]*\)|\|\|:|:\|\||\|:|:\||\|\||[|%]|\s+|[^\s|%:]+|:');
    bool isBlock(String inner) => inner.contains('|') || inner.contains('%') ||
        tokenPattern.allMatches(inner).where((m) => isMusicalChord(m.group(0)!)).length >= 2;
    if (!groups.any((group) => isBlock(group.group(1)!))) return null;
    final result = <MusicalProgressionToken>[];
    int end = 0;
    for (final group in groups) {
      if (group.start > end) result.add(MusicalProgressionToken(line.substring(end, group.start)));
      final inner = group.group(1)!;
      if (!isBlock(inner) && !isMusicalChord(inner.trim())) {
        result.add(MusicalProgressionToken(group.group(0)!));
      } else {
        for (final match in tokenPattern.allMatches(inner)) {
          final value = match.group(0)!;
          final chord = isMusicalChord(value);
          result.add(MusicalProgressionToken(chord ? transposeChord(value, semitones) : value,
            isChord: chord, isDelimiter: RegExp(r'^(?:\|\|:|:\|\||\|:|:\||\|\||[|%])$').hasMatch(value)));
        }
      }
      end = group.end;
    }
    if (end < line.length) result.add(MusicalProgressionToken(line.substring(end)));
    return result;
  }

  /// Transposes an entire bracket-format song text by [semitones].
  static String transposeSmartChord(String? smartChordText, int semitones) {
    if (smartChordText == null || smartChordText.isEmpty || semitones == 0) {
      return smartChordText ?? '';
    }

    // Parsing for syllabic layout trims chord payloads. Transform the original
    // bracket spans instead, retaining canonical block padding and authored EOLs.
    return smartChordText.splitMapJoin(RegExp(r'[^\r\n]+'), onMatch: (line) {
      final rawLine = line.group(0)!;
      if (isTablatureLine(rawLine)) return rawLine;
      if (isUnbracketedBarProgression(rawLine)) {
        return _tokenizeBarProgression(rawLine, semitones)
            .map((t) => t.text)
            .join();
      }
      if (!_chordRegex.allMatches(rawLine).any((m) =>
          isMusicalChord(m.group(1)!) ||
          m.group(1)!.contains('|') || m.group(1)!.contains('%') ||
          m.group(1)!.split(RegExp(r'\s+')).where(isMusicalChord).length >= 2)) {
        final row = progressionTokens(rawLine, semitones);
        if (row != null) return row.map((t) => t.text).join();
      }
      return rawLine.replaceAllMapped(_chordRegex, (match) {
        final original = match.group(1)!;
        final trimmed = original.trim();
        final transposed = original.contains('|') || original.contains('%')
            ? transposeChord(original, semitones)
            : trimmed.isEmpty
                ? original
                : original.replaceFirst(trimmed, transposeChord(trimmed, semitones));
        return '[$transposed]';
      });
    });
  }

  static bool isTablatureLine(String line) {
    if (!RegExp(r'^\s*(?:[eEBGDA]\s*)?[|:].*[-─]').hasMatch(line)) {
      return false;
    }
    if (RegExp(r'^\s*[eEBGDA]\s*[|:].*[-─]').hasMatch(line)) {
      return true;
    }
    return RegExp(r'^\s*[|:]\s*(?:[-─]{2,}|\d[-─hHpP/])').hasMatch(line);
  }

  static const Map<String, AnnotationKind> _annotationCategories = {
    'entrada': AnnotationKind.entry,
    'entra': AnnotationKind.entry,
    'entry': AnnotationKind.entry,
    'saida': AnnotationKind.exit,
    'sai': AnnotationKind.exit,
    'exit': AnnotationKind.exit,
    'dinamica': AnnotationKind.dynamics,
    'dynamics': AnnotationKind.dynamics,
    'execucao': AnnotationKind.technique,
    'tecnica': AnnotationKind.technique,
    'technique': AnnotationKind.technique,
    'observacao': AnnotationKind.note,
    'nota': AnnotationKind.note,
    'note': AnnotationKind.note,
  };

  static String _normalizeAccents(String value) {
    return value
        .toLowerCase()
        .replaceAll(RegExp(r'[áàâã]'), 'a')
        .replaceAll(RegExp(r'[éê]'), 'e')
        .replaceAll(RegExp(r'[í]'), 'i')
        .replaceAll(RegExp(r'[óôõ]'), 'o')
        .replaceAll(RegExp(r'[ú]'), 'u')
        .replaceAll('ç', 'c');
  }

  static ({AnnotationKind kind, String displayText}) interpretAnnotation(
    String rawText,
  ) {
    final colon = rawText.indexOf(':');
    if (colon < 0) return (kind: AnnotationKind.note, displayText: rawText);
    final key = _normalizeAccents(rawText.substring(0, colon).trim());
    final category = _annotationCategories[key];
    if (category == null) {
      return (kind: AnnotationKind.note, displayText: rawText);
    }
    return (
      kind: category,
      displayText: rawText.substring(colon + 1).trim(),
    );
  }

  static List<MusicalInstruction> extractMusicalInstructions(String source) {
    final lines = source.split(RegExp(r'\r\n|\n|\r'));
    final instructions = <MusicalInstruction>[];
    for (int l = 0; l < lines.length; l++) {
      final line = lines[l];
      int i = 0;
      int tokenIdx = 0;
      final onlyAnnotations =
          RegExp(r'^\s*(?:\{\{[^}]*\}\}\s*)+$').hasMatch(line);
      while (i < line.length) {
        final start = line.indexOf('{{', i);
        if (start < 0) break;
        final close = line.indexOf('}}', start + 2);
        if (close < 0) break;
        final rawToken = line.substring(start, close + 2);
        final body = line.substring(start + 2, close);
        final above = body.startsWith('^');
        final text = above ? body.substring(1) : body;
        final placement = above
            ? AnnotationPlacement.aboveNextChord
            : (onlyAnnotations
                ? AnnotationPlacement.line
                : AnnotationPlacement.inline);
        final interpreted = interpretAnnotation(text);
        instructions.add(
          MusicalInstruction(
            line: l,
            token: tokenIdx++,
            text: text,
            displayText: interpreted.displayText,
            sourceRaw: rawToken,
            kind: interpreted.kind,
            placement: placement,
          ),
        );
        i = close + 2;
      }
    }
    return instructions;
  }

  /// Renders a single bracket-format line into an aligned chord line and lyrics line.
  static TransposedLine renderLine(String? lineText, int semitones) {
    if (lineText == null || lineText.isEmpty) {
      return const TransposedLine(chordLine: '', lyricsLine: '');
    }

    if (isTablatureLine(lineText)) {
      return TransposedLine(chordLine: '', lyricsLine: lineText);
    }
    final row = progressionTokens(lineText, semitones);
    if (row != null) {
      return TransposedLine(chordLine: '', lyricsLine: row.map((t) => t.text).join());
    }

    final chordChars = <String>[];
    final cleanTextBuffer = StringBuffer();
    int cleanIndex = 0;
    int lastIndex = 0;

    for (final match in _chordRegex.allMatches(lineText).where((m) => isMusicalChord(m.group(1)!))) {
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
