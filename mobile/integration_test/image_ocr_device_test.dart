import 'dart:typed_data';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:image/image.dart' as img;
import 'package:louvaio_mobile/features/smart_chords/data/image_import_draft.dart';
import 'package:louvaio_mobile/features/smart_chords/services/image_ocr_service.dart';
import 'package:louvaio_mobile/features/smart_chords/services/ocr_layout_reconstructor.dart';
import 'fixtures/webp_sheet.dart';

Future<Uint8List> sheetImage({
  required double fontSize,
  required bool dark,
  int repeats = 1,
  bool compact = false,
  bool dense = false,
}) async {
  const text =
      'Tom:  Bb\nIntro: Bb\nBb  Eb        F     Eb/G     Ab      Db9     F/A     Ab/Bb\n'
      'Em cada canto deste mundo\n[Interlúdio]\nBb  Eb        Gm      Eb\n'
      'Uma palavra inteira\n[Final]\nAb/Bb Eb/Bb Bb';
  // Exact spacing from the user text excerpts, without widening chord gaps.
  const compactText =
      'Tom: Bb\nEb   F   Eb/G  Ab\n'
      '[Interlúdio] Bb  Eb  Gm  Eb\nDb9\nF     Gm   Ab F/A\n'
      '[Final]\nAb/Bb\nEb/Bb  Eb  Dm Cm  Bb\nCmaj7 Dm7\n'
      'Em cada canto deste mundo\nUma palavra inteira';
  final painter = TextPainter(
    text: TextSpan(
      text: List.filled(
        repeats,
        compact
            ? (dense
                  ? compactText.replaceAll(RegExp(r' {2,}'), ' ')
                  : compactText)
            : text,
      ).join('\n\n'),
      style: TextStyle(
        fontSize: fontSize,
        height: 1.5,
        fontFamily: 'monospace',
        color: dark ? Colors.white : Colors.black,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  final width = painter.width.ceil() + 48;
  final height = painter.height.ceil() + 48;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawColor(dark ? Colors.black : Colors.white, BlendMode.src);
  painter.paint(canvas, const Offset(24, 24));
  final picture = recorder.endRecording();
  final image = await picture.toImage(width, height);
  try {
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return bytes!.buffer.asUint8List();
  } finally {
    painter.dispose();
    image.dispose();
    picture.dispose();
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const selected = String.fromEnvironment('OCR_SCENARIO');
  for (final scenario in [
    (dark: true, dense: false, name: 'compact dark'),
    (dark: false, dense: false, name: 'compact light'),
    (dark: true, dense: true, name: 'dense dark'),
  ]) {
    final name = scenario.name;
    if (selected.isNotEmpty && selected != name) continue;
    testWidgets('real bundled ML Kit OCR: $name', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('OCR compacto'))),
      );
      final bytes = await sheetImage(
        fontSize: 28,
        dark: scenario.dark,
        compact: true,
        dense: scenario.dense,
      );
      await File(
        '${Directory.systemTemp.path}/m20-${name.replaceAll(' ', '-')}.png',
      ).writeAsBytes(bytes);
      final result = await OnDeviceImageOcrService(
        layout: const _GeometryEvidence(),
      ).recognize(bytes, 'compact.png');
      final draft = imageDraftFromRecognizedText(
        result.text,
        'compact.png',
        originalText: result.originalText,
        warnings: result.warnings,
      );
      debugPrint('OCR $name RAW: ${result.originalText}');
      debugPrint('OCR $name LAYOUT: ${result.text}');
      debugPrint(
        'OCR $name WARNINGS: ${draft.warnings.map((w) => '${w.code}: ${w.message}').join('\n')}',
      );
      expect(draft.originalKey, 'Bb');
      for (final entry in {
        'Eb': 4,
        'F': 2,
        'Eb/G': 1,
        'Ab': 2,
        'Bb': 2,
        'Gm': 2,
        'Db9': 1,
        'F/A': 1,
        'Ab/Bb': 1,
        'Eb/Bb': 1,
        'Dm': 1,
        'Cm': 1,
        'Cmaj7': 1,
        'Dm7': 1,
      }.entries) {
        expect(
          RegExp(
            RegExp.escape('[${entry.key}]'),
          ).allMatches(draft.content).length,
          entry.value,
          reason: 'Every ${entry.key} occurrence',
        );
      }
      expect(draft.content, contains('Em cada canto deste mundo'));
      expect(draft.content, contains('Uma palavra inteira'));
      expect(draft.content, isNot(contains('[EbF]')));
      expect(draft.content, isNot(contains('[EbGm]')));
    }, timeout: const Timeout(Duration(minutes: 1)));
  }
  for (final scenario in [
    (name: 'small light', size: 16.0, dark: false, repeats: 1),
    (name: 'large dark', size: 28.0, dark: true, repeats: 1),
    (name: 'long light', size: 22.0, dark: false, repeats: 8),
  ]) {
    if (selected.isNotEmpty && selected != scenario.name) continue;
    testWidgets('real bundled ML Kit OCR: ${scenario.name}', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('OCR local'))),
      );
      final bytes = await sheetImage(
        fontSize: scenario.size,
        dark: scenario.dark,
        repeats: scenario.repeats,
      );
      final result = await ImageOcrService().recognize(bytes, 'test.png');
      final draft = imageDraftFromRecognizedText(
        result.text,
        'test.png',
        originalText: result.originalText,
        warnings: result.warnings,
      );
      debugPrint('OCR ${scenario.name}: ${result.text}');
      expect(draft.originalKey, 'Bb');
      for (final chord in [
        'Bb',
        'Eb',
        'F',
        'Eb/G',
        'Ab',
        'Db9',
        'F/A',
        'Ab/Bb',
      ]) {
        expect(draft.content, contains('[$chord]'), reason: chord);
      }
      expect(draft.content, contains('Uma palavra inteira'));
      expect(draft.content, contains('Em cada canto deste mundo'));
      expect(draft.originalText, isNotEmpty);
      expect(draft.requiresManualPaste, isFalse);
    }, timeout: const Timeout(Duration(minutes: 3)));
  }
  for (final format in ['jpg', 'webp']) {
    if (selected.isNotEmpty && selected != format) continue;
    testWidgets('real bundled ML Kit OCR: $format', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('OCR local'))),
      );
      final bytes = format == 'webp'
          ? base64Decode(webpSheetBase64)
          : Uint8List.fromList(
              img.encodeJpg(
                img.decodePng(await sheetImage(fontSize: 28, dark: false))!,
                quality: 95,
              ),
            );
      final result = await ImageOcrService().recognize(bytes, 'test.$format');
      final draft = imageDraftFromRecognizedText(
        result.text,
        'test.$format',
        originalText: result.originalText,
        warnings: result.warnings,
      );
      debugPrint('OCR $format: ${result.text}');
      expect(draft.originalKey, 'Bb');
      for (final chord in [
        'Bb',
        'Eb',
        'F',
        'Eb/G',
        'Ab',
        'Db9',
        'F/A',
        'Ab/Bb',
      ]) {
        expect(draft.content, contains('[$chord]'), reason: chord);
      }
      expect(draft.content, contains('Uma palavra inteira'));
    }, timeout: const Timeout(Duration(minutes: 3)));
  }
}

class _GeometryEvidence extends OcrLayoutReconstructor {
  const _GeometryEvidence();

  @override
  String reconstruct(Iterable<OcrGeometryLine> source) {
    final lines = source.toList();
    for (final line in lines) {
      for (final element in line.elements) {
        if (element.text == 'EbF' || element.text == 'EbGm') {
          debugPrint(
            'MERGED ${element.text} box=${element.left},${element.width}; symbols=${element.symbols.map((s) => '${s.text}:${s.left},${s.width}').join(' ')}',
          );
        }
      }
    }
    return super.reconstruct(lines);
  }
}
