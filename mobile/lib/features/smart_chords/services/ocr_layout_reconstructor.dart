import '../domain/smart_chord_parser.dart';

/// Bounding box and text for one symbol returned by the OCR engine.
class OcrGeometrySymbol {
  final String text;
  final double left;
  final double width;

  const OcrGeometrySymbol({
    required this.text,
    required this.left,
    required this.width,
  });
}

/// Bounding box and text for one element returned by the OCR engine.
class OcrGeometryElement {
  final String text;
  final double left;
  final double width;
  final List<OcrGeometrySymbol> symbols;

  const OcrGeometryElement({
    required this.text,
    required this.left,
    required this.width,
    this.symbols = const [],
  });
}

class OcrGeometryLine {
  final String text;
  final double left;
  final double top;
  final double width;
  final double height;
  final int? blockId;
  final List<OcrGeometryElement> elements;

  const OcrGeometryLine({
    required this.text,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
    this.blockId,
    this.elements = const [],
  });
}

/// Rebuilds reading order while keeping uncertain chord/lyric alignment intact.
class OcrLayoutReconstructor {
  const OcrLayoutReconstructor();

  /// Visible review hints for spaces restored from symbol geometry.
  Map<String, String> chordSpacingCorrections(Iterable<OcrGeometryLine> lines) {
    final corrections = <String, String>{};
    for (final line in lines) {
      for (final element in line.elements) {
        final restored = _restoreChordSpace(element, line);
        if (restored != element.text) corrections[element.text] = restored;
      }
    }
    return corrections;
  }

  String reconstruct(Iterable<OcrGeometryLine> source) {
    final lines =
        source
            .where((line) => line.text.trim().isNotEmpty)
            .toList(growable: false)
          ..sort((a, b) {
            final vertical = a.top.compareTo(b.top);
            return vertical != 0 ? vertical : a.left.compareTo(b.left);
          });
    if (lines.isEmpty) return '';

    final gutter = _clearColumnGutter(lines);
    if (gutter != null) {
      final spanning = lines
          .where(
            (line) => line.left < gutter && line.left + line.width > gutter,
          )
          .toList();
      final leftColumn = lines
          .where((line) => line.left + line.width <= gutter)
          .toList();
      final rightColumn = lines.where((line) => line.left >= gutter).toList();
      final firstBodyTop = [
        ...leftColumn.map((line) => line.top),
        ...rightColumn.map((line) => line.top),
      ].reduce((a, b) => a < b ? a : b);
      if (leftColumn.length >= 2 &&
          rightColumn.length >= 2 &&
          spanning.every((line) => line.top < firstBodyTop)) {
        final heading = spanning.isEmpty
            ? ''
            : '${_reconstructSingleColumn(spanning)}\n';
        return '$heading${_reconstructSingleColumn(leftColumn)}\n${_reconstructSingleColumn(rightColumn)}';
      }
    }
    return _reconstructSingleColumn(lines);
  }

  String _reconstructSingleColumn(List<OcrGeometryLine> lines) {
    if (lines.isEmpty) return '';
    final ordered = List<OcrGeometryLine>.from(lines)
      ..sort((a, b) {
        final vertical = a.top.compareTo(b.top);
        return vertical != 0 ? vertical : a.left.compareTo(b.left);
      });
    final rows = <_Row>[];
    for (final line in ordered) {
      final last = rows.isEmpty ? null : rows.last;
      if (last != null && last.blockId == line.blockId) {
        final overlap = _overlap(
          last.top,
          last.bottom,
          line.top,
          line.top + line.height,
        );
        final minHeight = line.height < last.minHeight
            ? line.height
            : last.minHeight;
        if (minHeight > 0 && overlap / minHeight > 0.35) {
          last.add(line);
          continue;
        }
      }
      rows.add(_Row(line));
    }

    final charWidth = _medianCharWidth(ordered);
    final minLeft = ordered
        .map((line) => line.left)
        .reduce((a, b) => a < b ? a : b);
    return rows
        .map((row) {
          final rowLines = row.lines..sort((a, b) => a.left.compareTo(b.left));
          final output = StringBuffer();
          for (var i = 0; i < rowLines.length; i++) {
            final line = rowLines[i];
            if (i == 0) {
              final indent = ((line.left - minLeft) / charWidth).round().clamp(
                0,
                40,
              );
              output.write(' ' * indent);
            } else {
              final previous = rowLines[i - 1];
              final gap = line.left - (previous.left + previous.width);
              final spaces = (gap / charWidth).round().clamp(1, 8);
              output.write(' ' * spaces);
            }
            output.write(_renderElements(line));
          }
          return output.toString();
        })
        .join('\n');
  }

  double? _clearColumnGutter(List<OcrGeometryLine> lines) {
    if (lines.length < 4) return null;
    final medianLineWidth = _medianLineWidth(lines);
    final bodyLines = lines
        .where((line) => line.width <= medianLineWidth * 2.5)
        .toList();
    if (bodyLines.length < 4) return null;
    final intervals =
        bodyLines
            .where((line) => line.width > 0)
            .map((line) => (line.left, line.left + line.width))
            .toList()
          ..sort((a, b) => a.$1.compareTo(b.$1));
    if (intervals.length < 4) return null;

    final medianCharWidth = _medianCharWidth(bodyLines);
    final clusters = <(double, double, int)>[];
    var clusterLeft = intervals.first.$1;
    var clusterRight = intervals.first.$2;
    var clusterCount = 1;
    for (final interval in intervals.skip(1)) {
      if (interval.$1 <= clusterRight) {
        if (interval.$2 > clusterRight) clusterRight = interval.$2;
        clusterCount++;
      } else {
        clusters.add((clusterLeft, clusterRight, clusterCount));
        clusterLeft = interval.$1;
        clusterRight = interval.$2;
        clusterCount = 1;
      }
    }
    clusters.add((clusterLeft, clusterRight, clusterCount));

    var bestGap = 0.0;
    double? bestGutter;
    var leftCount = clusters.first.$3;
    final totalCount = intervals.length;
    for (var i = 0; i < clusters.length - 1; i++) {
      final gap = clusters[i + 1].$1 - clusters[i].$2;
      final gutter = clusters[i].$2 + gap / 2;
      final rightCount = totalCount - leftCount;
      if (gap > bestGap &&
          gap >= medianCharWidth * 8 &&
          leftCount >= 2 &&
          rightCount >= 2) {
        bestGap = gap;
        bestGutter = gutter;
      }
      leftCount += clusters[i + 1].$3;
    }
    return bestGutter;
  }

  String _renderElements(OcrGeometryLine line) {
    if (line.elements.isEmpty) return line.text;
    final elements =
        line.elements.where((element) => element.text.isNotEmpty).toList()
          ..sort((a, b) => a.left.compareTo(b.left));
    if (elements.isEmpty) return line.text;
    final charWidth = _medianElementCharWidth(elements);
    final output = StringBuffer();
    for (var index = 0; index < elements.length; index++) {
      final element = elements[index];
      if (index > 0) {
        final previous = elements[index - 1];
        final gap = element.left - (previous.left + previous.width);
        final spaces = (gap / charWidth).round().clamp(1, 8);
        output.write(' ' * spaces);
      }
      output.write(_restoreChordSpace(element, line));
    }
    return output.toString();
  }

  String _restoreChordSpace(OcrGeometryElement element, OcrGeometryLine line) {
    final token = element.text;
    // Complete chords (including slash bass and extensions) always win.
    if (SmartChordParser.isMusicalChord(token) || token.length > 24) {
      return token;
    }
    final symbols = element.symbols;
    if (symbols.length < 2 || symbols.map((s) => s.text).join() != token) {
      return token;
    }
    final widths =
        symbols.where((s) => s.width > 0).map((s) => s.width).toList()..sort();
    if (widths.length != symbols.length) return token;
    final minimumGap = widths[widths.length ~/ 2] * 0.8;
    final candidates = <String>[];
    var offset = 0;
    for (var i = 0; i < symbols.length - 1; i++) {
      offset += symbols[i].text.length;
      final left = token.substring(0, offset);
      final right = token.substring(offset);
      if (!RegExp(r'^[A-G]').hasMatch(left) ||
          !RegExp(r'^[A-G]').hasMatch(right)) {
        continue;
      }
      final gap = symbols[i + 1].left - (symbols[i].left + symbols[i].width);
      if (gap >= minimumGap &&
          SmartChordParser.isMusicalChord(left) &&
          SmartChordParser.isMusicalChord(right)) {
        candidates.add('$left $right');
      }
    }
    if (candidates.length != 1) return token;
    // Require a musical row, never infer chords within lyrics.
    final row = line.text.replaceFirst(
      RegExp(r'^\s*(?:\[[^\]]+\]|Intro\s*:)\s*', caseSensitive: false),
      '',
    );
    final tokens = row.split(RegExp(r'[\s|]+')).where((t) => t.isNotEmpty);
    if (tokens.any((t) => t != token && !SmartChordParser.isMusicalChord(t))) {
      return token;
    }
    return candidates.single;
  }

  double _medianElementCharWidth(List<OcrGeometryElement> elements) {
    final widths =
        elements
            .where((element) => element.width > 0)
            .map((element) => element.width / element.text.length)
            .toList()
          ..sort();
    if (widths.isEmpty) return 8;
    final width = widths[widths.length ~/ 2];
    return width <= 0 ? 8 : width;
  }

  double _medianLineWidth(List<OcrGeometryLine> lines) {
    final widths =
        lines.map((line) => line.width).where((width) => width > 0).toList()
          ..sort();
    if (widths.isEmpty) return 0;
    return widths[widths.length ~/ 2];
  }

  double _medianCharWidth(List<OcrGeometryLine> lines) {
    final widths =
        lines
            .where((line) => line.width > 0 && line.text.isNotEmpty)
            .map((line) => line.width / line.text.length)
            .toList()
          ..sort();
    if (widths.isEmpty) return 8;
    final width = widths[widths.length ~/ 2];
    return width <= 0 ? 8 : width;
  }

  double _overlap(double topA, double bottomA, double topB, double bottomB) {
    final top = topA > topB ? topA : topB;
    final bottom = bottomA < bottomB ? bottomA : bottomB;
    return bottom > top ? bottom - top : 0;
  }
}

class _Row {
  final List<OcrGeometryLine> lines;
  final int? blockId;
  double top;
  double bottom;
  double minHeight;

  _Row(OcrGeometryLine line)
    : lines = [line],
      blockId = line.blockId,
      top = line.top,
      bottom = line.top + line.height,
      minHeight = line.height;

  void add(OcrGeometryLine line) {
    lines.add(line);
    if (line.top < top) top = line.top;
    if (line.top + line.height > bottom) bottom = line.top + line.height;
    if (line.height < minHeight) minHeight = line.height;
  }
}
