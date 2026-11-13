import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:flutter/services.dart';
import '../domain/smart_chord.dart';
import '../domain/smart_chord_parser.dart';

/// Configuration describing how a SmartChord sheet is rendered to an A4 PDF.
class SmartChordPdfDocumentOptions {
  final SmartChord chord;
  final int semitones;
  final String currentKey;
  final String chordFont;
  final double fontSizePt;
  final int lineSpacingPx;
  final bool markerEnabled;
  final String markerText;

  const SmartChordPdfDocumentOptions({
    required this.chord,
    required this.semitones,
    required this.currentKey,
    this.chordFont = 'monospace',
    this.fontSizePt = 11.5,
    this.lineSpacingPx = 8,
    this.markerEnabled = false,
    this.markerText = '',
  });
}

enum _PdfFontKey {
  courier('/F1', 'Courier', true),
  courierBold('/F2', 'Courier-Bold', true),
  helvetica('/F3', 'Helvetica', false),
  helveticaBold('/F4', 'Helvetica-Bold', false),
  times('/F5', 'Times-Roman', false),
  timesBold('/F6', 'Times-Bold', false);

  final String resourceName;
  final String baseFont;
  final bool isMonospace;

  const _PdfFontKey(this.resourceName, this.baseFont, this.isMonospace);
}

class _RgbColor {
  final double r;
  final double g;
  final double b;

  const _RgbColor(this.r, this.g, this.b);

  String get fillOp =>
      '${r.toStringAsFixed(3)} ${g.toStringAsFixed(3)} ${b.toStringAsFixed(3)} rg';
  String get strokeOp =>
      '${r.toStringAsFixed(3)} ${g.toStringAsFixed(3)} ${b.toStringAsFixed(3)} RG';
}

/// Pure-Dart multi-page A4 (%PDF-1.4) generator that preserves LouvAIO typography,
/// transposed chords aligned over syllables, tablatures, progressions, annotations,
/// section markers, and page headers/footers without external runtime dependencies.
class SmartChordPdfBuilder {
  static const double pageWidth = 595.28; // A4 portrait width in points
  static const double pageHeight = 841.89; // A4 portrait height in points
  static const double marginX = 42.0;
  static const double marginTop = 44.0;
  static const double marginBottom = 46.0;
  static const double printableWidth = pageWidth - (marginX * 2);

  static const _RgbColor _inkPrimary = _RgbColor(0.094, 0.133, 0.114); // #18221D
  static const _RgbColor _inkGreen = _RgbColor(0.059, 0.165, 0.122); // #0F2A1F
  static const _RgbColor _inkMuted = _RgbColor(0.275, 0.329, 0.306); // #46544E
  static const _RgbColor _chordTerracotta =
      _RgbColor(0.620, 0.267, 0.153); // #9E4427
  static const _RgbColor _badgeBg = _RgbColor(0.910, 0.941, 0.918); // #E8EFEA
  static const _RgbColor _dividerGray =
      _RgbColor(0.840, 0.805, 0.755); // #DCD3C6

  static const Map<int, int> _winAnsiOverrides = {
    0x20AC: 0x80, // €
    0x201A: 0x82, // ‚
    0x0192: 0x83, // ƒ
    0x201E: 0x84, // „
    0x2026: 0x85, // …
    0x2020: 0x86, // †
    0x2021: 0x87, // ‡
    0x02C6: 0x88, // ˆ
    0x2030: 0x89, // ‰
    0x0160: 0x8A, // Š
    0x2039: 0x8B, // ‹
    0x0152: 0x8C, // Œ
    0x017D: 0x8E, // Ž
    0x2018: 0x91, // ‘
    0x2019: 0x92, // ’
    0x201C: 0x93, // “
    0x201D: 0x94, // ”
    0x2022: 0x95, // •
    0x2013: 0x96, // –
    0x2014: 0x97, // —
    0x02DC: 0x98, // ˜
    0x2122: 0x99, // ™
    0x0161: 0x9A, // š
    0x203A: 0x9B, // ›
    0x0153: 0x9C, // œ
    0x017E: 0x9E, // ž
    0x0178: 0x9F, // Ÿ
  };

  /// Encodes UTF-16 text into a WinAnsi-escaped PDF literal string `(...)`.
  static String encodePdfTextLiteral(String input) {
    final buffer = StringBuffer('(');
    for (final rune in input.runes) {
      if (rune == 0x0A || rune == 0x0D || rune == 0x09) {
        buffer.write(' ');
        continue;
      }
      int byteVal;
      if (rune >= 0x20 && rune <= 0x7E) {
        byteVal = rune;
      } else if (rune >= 0xA0 && rune <= 0xFF) {
        byteVal = rune;
      } else if (_winAnsiOverrides.containsKey(rune)) {
        byteVal = _winAnsiOverrides[rune]!;
      } else {
        byteVal = 0x3F; // '?' fallback for non-WinAnsi glyphs
      }

      if (byteVal == 0x28 || byteVal == 0x29 || byteVal == 0x5C) {
        buffer.write('\\');
        buffer.writeCharCode(byteVal);
      } else if (byteVal >= 0x80) {
        buffer.write('\\');
        buffer.write(byteVal.toRadixString(8).padLeft(3, '0'));
      } else {
        buffer.writeCharCode(byteVal);
      }
    }
    buffer.write(')');
    return buffer.toString();
  }

  /// Resolves the UI font family to Type1 base-14 regular/bold PDF fonts.
  static ({_PdfFontKey regular, _PdfFontKey bold, bool isMonospace})
      _resolvePdfFonts(String font) {
    switch (font) {
      case 'Arial':
      case 'Verdana':
        return (
          regular: _PdfFontKey.helvetica,
          bold: _PdfFontKey.helveticaBold,
          isMonospace: false,
        );
      case 'Times New Roman':
      case 'Georgia':
        return (
          regular: _PdfFontKey.times,
          bold: _PdfFontKey.timesBold,
          isMonospace: false,
        );
      case 'Courier New':
      case 'monospace':
      default:
        return (
          regular: _PdfFontKey.courier,
          bold: _PdfFontKey.courierBold,
          isMonospace: true,
        );
    }
  }

  /// Estimates glyph advance width in PDF points for layout alignment and wrapping.
  static double _measureWidth(String text, _PdfFontKey font, double sizePt) {
    if (text.isEmpty) return 0.0;
    if (font.isMonospace) {
      return text.runes.length * (0.600 * sizePt);
    }
    var units = 0;
    final boldScale = (font == _PdfFontKey.helveticaBold ||
            font == _PdfFontKey.timesBold)
        ? 1.05
        : 1.0;
    final familyScale = (font == _PdfFontKey.times ||
            font == _PdfFontKey.timesBold)
        ? 0.94
        : 1.0;

    for (final rune in text.runes) {
      if (rune == 0x20) {
        units += 278;
      } else if (rune == 0x69 ||
          rune == 0x6C ||
          rune == 0x6A ||
          rune == 0x49 ||
          rune == 0x2E ||
          rune == 0x2C ||
          rune == 0x3A ||
          rune == 0x3B ||
          rune == 0x21 ||
          rune == 0x27 ||
          rune == 0x7C ||
          rune == 0x66 ||
          rune == 0x74 ||
          rune == 0x72) {
        units += 290;
      } else if (rune == 0x6D ||
          rune == 0x77 ||
          rune == 0x4D ||
          rune == 0x57 ||
          rune == 0x25) {
        units += 780;
      } else if (rune >= 0x41 && rune <= 0x5A) {
        units += 675;
      } else if (rune >= 0xC0 && rune <= 0xDD) {
        units += 675;
      } else if (rune >= 0x30 && rune <= 0x39) {
        units += 556;
      } else {
        units += 530;
      }
    }
    return (units / 1000.0) * sizePt * boldScale * familyScale;
  }

  /// Wraps plain text strings to stay safely inside [maxWidth].
  static List<String> _wrapText(
      String text, _PdfFontKey font, double sizePt, double maxWidth) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return const [''];
    if (_measureWidth(trimmed, font, sizePt) <= maxWidth) {
      return [trimmed];
    }
    final words = trimmed.split(RegExp(r'\s+'));
    final lines = <String>[];
    var current = StringBuffer();
    for (final word in words) {
      final candidate =
          current.isEmpty ? word : '${current.toString()} $word';
      if (current.isNotEmpty &&
          _measureWidth(candidate, font, sizePt) > maxWidth) {
        lines.add(current.toString());
        current = StringBuffer(word);
      } else {
        if (current.isNotEmpty) current.write(' ');
        current.write(word);
      }
    }
    if (current.isNotEmpty) lines.add(current.toString());
    return lines;
  }

  static void _drawText(
    StringBuffer stream, {
    required String text,
    required double x,
    required double y,
    required _PdfFontKey font,
    required double sizePt,
    required _RgbColor color,
  }) {
    if (text.isEmpty) return;
    stream.writeln('BT');
    stream.writeln('${font.resourceName} ${sizePt.toStringAsFixed(2)} Tf');
    stream.writeln(color.fillOp);
    stream.writeln('1 0 0 1 ${x.toStringAsFixed(2)} ${y.toStringAsFixed(2)} Tm');
    stream.writeln('${encodePdfTextLiteral(text)} Tj');
    stream.writeln('ET');
  }

  static void _drawHorizontalRule(
    StringBuffer stream, {
    required double x1,
    required double x2,
    required double y,
    _RgbColor color = _dividerGray,
    double width = 0.8,
  }) {
    stream.writeln('q');
    stream.writeln('${width.toStringAsFixed(2)} w');
    stream.writeln(color.strokeOp);
    stream.writeln('${x1.toStringAsFixed(2)} ${y.toStringAsFixed(2)} m');
    stream.writeln('${x2.toStringAsFixed(2)} ${y.toStringAsFixed(2)} l');
    stream.writeln('S');
    stream.writeln('Q');
  }

  static void _drawFilledBox(
    StringBuffer stream, {
    required double x,
    required double y,
    required double width,
    required double height,
    required _RgbColor fill,
    _RgbColor? stroke,
  }) {
    stream.writeln('q');
    stream.writeln(fill.fillOp);
    if (stroke != null) {
      stream.writeln('0.6 w');
      stream.writeln(stroke.strokeOp);
    }
    stream.writeln(
        '${x.toStringAsFixed(2)} ${y.toStringAsFixed(2)} ${width.toStringAsFixed(2)} ${height.toStringAsFixed(2)} re');
    stream.writeln(stroke != null ? 'B' : 'f');
    stream.writeln('Q');
  }

  /// Generates a valid multi-page A4 PDF document for [options].
  static Uint8List build(SmartChordPdfDocumentOptions options) {
    final chord = options.chord;
    final bodySize = options.fontSizePt.clamp(9.0, 18.0);
    final lineGap = (options.lineSpacingPx * 0.45).clamp(2.5, 12.0);
    final chordSize = math.max(8.5, bodySize * 0.96);
    final commentSize = math.max(7.5, bodySize * 0.82);
    final fontPair = _resolvePdfFonts(options.chordFont);
    final headerFont = fontPair.isMonospace
        ? _PdfFontKey.helveticaBold
        : fontPair.bold;
    final headerRegularFont = fontPair.isMonospace
        ? _PdfFontKey.helvetica
        : fontPair.regular;

    final pageStreams = <StringBuffer>[];
    var currentStream = StringBuffer();
    pageStreams.add(currentStream);
    var cursorY = pageHeight - marginTop;

    void startNewPage() {
      currentStream = StringBuffer();
      pageStreams.add(currentStream);
      cursorY = pageHeight - marginTop;
    }

    void ensureSpace(double requiredHeight) {
      if (cursorY - requiredHeight < marginBottom + 16.0) {
        startNewPage();
      }
    }

    // Page 1 Header (Marker badge, Title, Artist, Key, Capo)
    final markerText = options.markerText.trim();
    if (options.markerEnabled && markerText.isNotEmpty) {
      const badgeFontSize = 9.0;
      final badgeTextW =
          _measureWidth(markerText, _PdfFontKey.helveticaBold, badgeFontSize);
      final badgeW = math.min(printableWidth * 0.65, badgeTextW + 16.0);
      const badgeH = 18.0;
      final badgeX = pageWidth - marginX - badgeW;
      final badgeY = cursorY - 12.0;
      _drawFilledBox(
        currentStream,
        x: badgeX,
        y: badgeY,
        width: badgeW,
        height: badgeH,
        fill: _badgeBg,
        stroke: _dividerGray,
      );
      _drawText(
        currentStream,
        text: markerText,
        x: badgeX + 8.0,
        y: badgeY + 5.5,
        font: _PdfFontKey.helveticaBold,
        sizePt: badgeFontSize,
        color: _inkGreen,
      );
      cursorY -= 24.0;
    }

    const titleSize = 17.0;
    final titleLines =
        _wrapText(chord.title, headerFont, titleSize, printableWidth);
    for (final line in titleLines) {
      _drawText(
        currentStream,
        text: line,
        x: marginX,
        y: cursorY,
        font: headerFont,
        sizePt: titleSize,
        color: _inkGreen,
      );
      cursorY -= 20.0;
    }

    final artist = chord.artistName?.trim() ?? '';
    if (artist.isNotEmpty) {
      cursorY += 2.0;
      for (final line in _wrapText(artist, headerRegularFont, 11.0, printableWidth)) {
        _drawText(
          currentStream,
          text: line,
          x: marginX,
          y: cursorY,
          font: headerRegularFont,
          sizePt: 11.0,
          color: _inkMuted,
        );
        cursorY -= 14.0;
      }
    }

    cursorY -= 2.0;
    final keyLabel = 'Tom: ${options.currentKey}';
    _drawText(
      currentStream,
      text: keyLabel,
      x: marginX,
      y: cursorY,
      font: _PdfFontKey.helveticaBold,
      sizePt: 10.5,
      color: _chordTerracotta,
    );
    var metaX = marginX +
        _measureWidth(keyLabel, _PdfFontKey.helveticaBold, 10.5) +
        14.0;
    if (options.semitones != 0) {
      final delta = options.semitones > 0
          ? '(${'+${options.semitones}'})'
          : '(${options.semitones})';
      _drawText(
        currentStream,
        text: delta,
        x: metaX,
        y: cursorY,
        font: _PdfFontKey.helvetica,
        sizePt: 9.5,
        color: _inkMuted,
      );
      metaX += _measureWidth(delta, _PdfFontKey.helvetica, 9.5) + 14.0;
    }
    if (chord.capo != null && chord.capo! > 0) {
      final capoLabel = 'Capo: ${chord.capo}ª casa';
      _drawText(
        currentStream,
        text: capoLabel,
        x: metaX,
        y: cursorY,
        font: _PdfFontKey.helvetica,
        sizePt: 10.0,
        color: _inkMuted,
      );
    }

    cursorY -= 10.0;
    _drawHorizontalRule(
      currentStream,
      x1: marginX,
      x2: pageWidth - marginX,
      y: cursorY,
    );
    cursorY -= 18.0;

    // Render content lines faithfully
    final rawLines = chord.content
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .split('\n');

    for (var i = 0; i < rawLines.length; i++) {
      final line = rawLines[i];
      if (line.trim().isEmpty) {
        cursorY -= (bodySize * 0.72 + lineGap * 0.4);
        if (cursorY < marginBottom + 20.0) {
          startNewPage();
        }
        continue;
      }

      // 1) Tablatures: always render strictly in Courier monospace
      if (SmartChordParser.isTablatureLine(line)) {
        var tabSize = math.min(bodySize, 10.5);
        final rawWidth =
            _measureWidth(line, _PdfFontKey.courier, tabSize);
        if (rawWidth > printableWidth) {
          tabSize = math.max(6.8, tabSize * (printableWidth / rawWidth));
        }
        final tabHeight = tabSize * 1.3 + 2.0;
        ensureSpace(tabHeight);
        _drawText(
          currentStream,
          text: line,
          x: marginX,
          y: cursorY,
          font: _PdfFontKey.courier,
          sizePt: tabSize,
          color: _inkPrimary,
        );
        cursorY -= tabHeight + lineGap * 0.35;
        continue;
      }

      // 2) Musical progression lines: ||: G | D/F# | % :|| + optional aligned lyric
      final progTokens = SmartChordParser.progressionTokens(line, options.semitones);
      if (progTokens != null) {
        final hasPairedAlignedLyric = i + 1 < rawLines.length &&
            rawLines[i + 1].trim().isNotEmpty &&
            SmartChordParser.progressionTokens(rawLines[i + 1]) == null &&
            !SmartChordParser.parse(rawLines[i + 1])
                .first
                .segments
                .any((s) => s.hasChord);

        final progHeight = bodySize * 1.4 + (hasPairedAlignedLyric ? bodySize * 1.45 : 0);
        ensureSpace(progHeight);

        var progSize = bodySize;
        final fullText = progTokens.map((t) => t.text).join();
        final naturalW = _measureWidth(fullText, _PdfFontKey.courier, progSize);
        if (naturalW > printableWidth) {
          progSize = math.max(7.2, progSize * (printableWidth / naturalW));
        }

        var tokenX = marginX;
        for (final token in progTokens) {
          final isChordOrMod = token.isChord || token.text == '%';
          final tokenFont = (isChordOrMod || token.isDelimiter || token.isAnnotation)
              ? _PdfFontKey.courierBold
              : _PdfFontKey.courier;
          final tokenSize = token.isAnnotation ? progSize * 0.85 : progSize;
          final tokenColor = (isChordOrMod || token.isAnnotation)
              ? _chordTerracotta
              : token.isDelimiter
                  ? _inkMuted
                  : _inkPrimary;
          _drawText(
            currentStream,
            text: token.text,
            x: tokenX,
            y: cursorY,
            font: tokenFont,
            sizePt: tokenSize,
            color: tokenColor,
          );
          tokenX += _measureWidth(token.text, tokenFont, tokenSize);
        }
        cursorY -= progSize * 1.38;

        if (hasPairedAlignedLyric) {
          final lyricLine = rawLines[i + 1];
          _drawText(
            currentStream,
            text: lyricLine,
            x: marginX,
            y: cursorY,
            font: _PdfFontKey.courier,
            sizePt: progSize,
            color: _inkPrimary,
          );
          cursorY -= progSize * 1.38;
          i++;
        }
        cursorY -= lineGap * 0.6;
        continue;
      }

      // 3) SmartChord lines with inline bracketed chords / comments / lyrics
      final segments = SmartChordParser.parse(line).first.segments;
      final hasMusicalMarkup =
          segments.any((s) => s.hasChord || s.hasComment);

      if (!hasMusicalMarkup) {
        final trimmed = line.trim();
        final isSectionLabel = RegExp(
                r'^(\[[^\]]+\]|(Intro|Refr[aã]o|Coro|Verso|Estrofe|Ponte|Bridge|Solo|Interl[uú]dio|Final|Outro|Pre-?Refr[aã]o|Turnaround).*?:?)$',
                caseSensitive: false)
            .hasMatch(trimmed);
        final textFont = isSectionLabel ? fontPair.bold : fontPair.regular;
        final textColor = isSectionLabel ? _inkGreen : _inkPrimary;
        final wrapped = _wrapText(line, textFont, bodySize, printableWidth);
        ensureSpace(wrapped.length * (bodySize * 1.35));
        for (final wLine in wrapped) {
          _drawText(
            currentStream,
            text: wLine,
            x: marginX,
            y: cursorY,
            font: textFont,
            sizePt: bodySize,
            color: textColor,
          );
          cursorY -= bodySize * 1.35;
        }
        cursorY -= lineGap * 0.45;
        continue;
      }

      // Group fragments into whole words matching ChordLyricLine behavior
      final words = <List<SmartChordSegment>>[];
      var currentWord = <SmartChordSegment>[];
      for (final seg in segments) {
        final pieces = RegExp(r'\S+\s*|\s+')
            .allMatches(seg.text)
            .map((m) => m.group(0)!)
            .toList();
        if (pieces.isEmpty) pieces.add('');
        for (var p = 0; p < pieces.length; p++) {
          currentWord.add(SmartChordSegment(
            chord: p == 0 ? seg.chord : '',
            comment: p == 0 ? seg.comment : '',
            text: pieces[p],
          ));
          if (RegExp(r'\s$').hasMatch(pieces[p])) {
            words.add(currentWord);
            currentWord = <SmartChordSegment>[];
          }
        }
      }
      if (currentWord.isNotEmpty) words.add(currentWord);

      // Lay out wrapped rows of word fragments inside printableWidth
      final rows = <List<List<SmartChordSegment>>>[];
      var rowWords = <List<SmartChordSegment>>[];
      var rowWidth = 0.0;

      double fragmentWidth(SmartChordSegment frag) {
        final lyricW = _measureWidth(frag.text, fontPair.regular, bodySize);
        var tierW = 0.0;
        if (frag.hasChord) {
          final tChord =
              SmartChordParser.transposeChord(frag.chord, options.semitones);
          tierW += _measureWidth(tChord, fontPair.bold, chordSize);
        }
        if (frag.hasChord && frag.hasComment) {
          tierW += _measureWidth(' ', fontPair.regular, chordSize);
        }
        if (frag.hasComment) {
          tierW += _measureWidth(frag.comment, fontPair.bold, commentSize);
        }
        if (tierW > 0) tierW += 5.5;
        return math.max(lyricW, tierW);
      }

      for (final w in words) {
        final wWidth = w.fold<double>(0.0, (acc, f) => acc + fragmentWidth(f));
        if (rowWords.isNotEmpty && rowWidth + wWidth > printableWidth) {
          rows.add(rowWords);
          rowWords = [w];
          rowWidth = wWidth;
        } else {
          rowWords.add(w);
          rowWidth += wWidth;
        }
      }
      if (rowWords.isNotEmpty) rows.add(rowWords);

      final tierGap = chordSize * 1.18;
      final singleRowHeight = tierGap + bodySize * 1.28 + lineGap * 0.55;
      ensureSpace(rows.length * singleRowHeight);

      for (final rWords in rows) {
        ensureSpace(singleRowHeight);
        var fx = marginX;
        final chordY = cursorY;
        final lyricY = cursorY - tierGap;

        for (final w in rWords) {
          for (final frag in w) {
            final fWidth = fragmentWidth(frag);
            var cx = fx;
            if (frag.hasChord) {
              final tChord = SmartChordParser.transposeChord(
                  frag.chord, options.semitones);
              _drawText(
                currentStream,
                text: tChord,
                x: cx,
                y: chordY,
                font: fontPair.bold,
                sizePt: chordSize,
                color: _chordTerracotta,
              );
              cx += _measureWidth(tChord, fontPair.bold, chordSize);
            }
            if (frag.hasComment) {
              if (frag.hasChord) {
                cx += _measureWidth(' ', fontPair.regular, chordSize);
              }
              _drawText(
                currentStream,
                text: frag.comment,
                x: cx,
                y: chordY,
                font: fontPair.bold,
                sizePt: commentSize,
                color: _chordTerracotta,
              );
            }
            if (frag.text.isNotEmpty) {
              _drawText(
                currentStream,
                text: frag.text,
                x: fx,
                y: lyricY,
                font: fontPair.regular,
                sizePt: bodySize,
                color: _inkPrimary,
              );
            }
            fx += fWidth;
          }
        }
        cursorY -= singleRowHeight;
      }
    }

    // Add consistent page footers ("Página X / Y") across all pages
    final totalPages = pageStreams.length;
    for (var p = 0; p < totalPages; p++) {
      final stream = pageStreams[p];
      const footerRuleY = marginBottom - 10.0;
      const footerTextY = marginBottom - 22.0;
      _drawHorizontalRule(
        stream,
        x1: marginX,
        x2: pageWidth - marginX,
        y: footerRuleY,
        width: 0.5,
      );
      _drawText(
        stream,
        text: 'LouvAIO • Cifras Inteligentes',
        x: marginX,
        y: footerTextY,
        font: _PdfFontKey.helvetica,
        sizePt: 8.5,
        color: _inkMuted,
      );
      final pageNumText = 'Página ${p + 1} / $totalPages';
      final pageNumW =
          _measureWidth(pageNumText, _PdfFontKey.helvetica, 8.5);
      _drawText(
        stream,
        text: pageNumText,
        x: pageWidth - marginX - pageNumW,
        y: footerTextY,
        font: _PdfFontKey.helvetica,
        sizePt: 8.5,
        color: _inkMuted,
      );
    }

    return _assemblePdfDocument(pageStreams);
  }

  static Uint8List _assemblePdfDocument(List<StringBuffer> pageStreams) {
    const fonts = _PdfFontKey.values;
    const firstFontObjId = 3;
    const pagesObjId = 2;
    final firstPageObjId = firstFontObjId + fonts.length; // 9
    final pageCount = pageStreams.length;
    final pageObjIds = List<int>.generate(pageCount, (i) => firstPageObjId + i * 2);
    final totalObjects = firstPageObjId + pageCount * 2 - 1;

    final out = BytesBuilder(copy: false);
    final offsets = List<int>.filled(totalObjects + 1, 0);

    void writeAscii(String s) => out.add(latin1.encode(s));
    void writeBytes(List<int> bytes) => out.add(bytes);

    // Header + binary marker bytes (> 0x80) per PDF specification
    writeAscii('%PDF-1.4\n%');
    writeBytes([0xE2, 0xE3, 0xCF, 0xD3, 0x0A]);

    void writeObject(int id, String body) {
      offsets[id] = out.length;
      writeAscii('$id 0 obj\n$body\nendobj\n');
    }

    // 1: Catalog
    writeObject(1, '<< /Type /Catalog /Pages $pagesObjId 0 R >>');

    // 2: Pages
    final kids = pageObjIds.map((id) => '$id 0 R').join(' ');
    writeObject(
      pagesObjId,
      '<< /Type /Pages /Kids [ $kids ] /Count $pageCount >>',
    );

    // 3..8: Base-14 Type1 fonts with WinAnsiEncoding
    final fontResources = StringBuffer('<< ');
    for (var i = 0; i < fonts.length; i++) {
      final f = fonts[i];
      final objId = firstFontObjId + i;
      writeObject(
        objId,
        '<< /Type /Font /Subtype /Type1 /BaseFont /${f.baseFont} /Encoding /WinAnsiEncoding >>',
      );
      fontResources.write('${f.resourceName} $objId 0 R ');
    }
    fontResources.write('>>');
    final fontResourceDict = fontResources.toString();

    // Pages + Content streams
    for (var i = 0; i < pageCount; i++) {
      final pageObjId = firstPageObjId + i * 2;
      final contentObjId = pageObjId + 1;
      final contentBytes = latin1.encode(pageStreams[i].toString());

      writeObject(
        pageObjId,
        '<< /Type /Page /Parent $pagesObjId 0 R /MediaBox [0 0 ${pageWidth.toStringAsFixed(2)} ${pageHeight.toStringAsFixed(2)}] /Resources << /Font $fontResourceDict >> /Contents $contentObjId 0 R >>',
      );

      offsets[contentObjId] = out.length;
      writeAscii('$contentObjId 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n');
      writeBytes(contentBytes);
      writeAscii('\nendstream\nendobj\n');
    }

    final xrefOffset = out.length;
    writeAscii('xref\n0 ${totalObjects + 1}\n');
    writeAscii('0000000000 65535 f \r\n');
    for (var id = 1; id <= totalObjects; id++) {
      writeAscii('${offsets[id].toString().padLeft(10, '0')} 00000 n \r\n');
    }
    writeAscii(
      'trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n$xrefOffset\n%%EOF\n',
    );

    return out.toBytes();
  }
}

/// Platform service bridging real PDF bytes to native Android Share / Print APIs.
class SmartChordPdfExporter {
  static const MethodChannel _channel =
      MethodChannel('com.louvaio.mobile/pdf_export');

  final MethodChannel channel;

  const SmartChordPdfExporter({this.channel = _channel});

  static String buildPdfFileName(String title) {
    const replacements = {
      'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
      'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
      'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
      'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
      'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
      'ç': 'c',
      'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A',
      'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
      'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
      'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O',
      'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
      'Ç': 'C',
    };
    final normalized = title.split('').map((c) => replacements[c] ?? c).join();
    final safeStem = normalized
        .replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '_')
        .replaceAll(RegExp(r'_+'), '_')
        .replaceAll(RegExp(r'^[_.]+|[_.]+$'), '');
    return '${safeStem.isEmpty ? 'cifra_louvaio' : safeStem}.pdf';
  }

  Future<void> sharePdf({
    required Uint8List bytes,
    required String fileName,
    required String title,
  }) async {
    await channel.invokeMethod<dynamic>('sharePdf', <String, dynamic>{
      'bytes': bytes,
      'fileName': fileName,
      'title': title,
    });
  }

  Future<void> printPdf({
    required Uint8List bytes,
    required String jobName,
  }) async {
    await channel.invokeMethod<dynamic>('printPdf', <String, dynamic>{
      'bytes': bytes,
      'jobName': jobName,
    });
  }
}
