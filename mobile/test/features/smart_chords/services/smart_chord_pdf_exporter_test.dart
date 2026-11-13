import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/services/smart_chord_pdf_exporter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  SmartChord buildSampleChord({
    String title = 'Graça Infinita (Versão Culto)',
    String? artistName = 'Ministério LouvAIO',
    String originalKey = 'G',
    int? capo = 2,
    required String content,
  }) {
    return SmartChord(
      id: 'chord-pdf-1',
      userId: 'user-1',
      title: title,
      artistName: artistName,
      originalKey: originalKey,
      capo: capo,
      content: content,
      createdAt: '2026-10-22T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z',
    );
  }

  test('generates structurally valid multi-page A4 %PDF-1.4 with transposed chords, tabs, progressions, annotations, and font selection', () {
    final longVerse = List.generate(
      45,
      (i) => '[G]Linha ${i + 1} [D/F#]adoração com coração e [Em7]graça',
    ).join('\n');

    final content = [
      'Intro:',
      'Intro: (violão leve) [ ||: G | D/F# | Em7 | C9 :|| ]',
      'Sobe a intensidade na entrada da banda',
      'e|---3---2---0-------|',
      'B|---0---3---0---3---|',
      'G|---0---2---0---0---|',
      '[Refrão]',
      '[G]Santo é o [D/F# {dinâmica crescendo}]Senhor, [Em7]digno de [C9]louvor',
      longVerse,
    ].join('\n');

    final chord = buildSampleChord(content: content);

    final bytes = SmartChordPdfBuilder.build(
      SmartChordPdfDocumentOptions(
        chord: chord,
        semitones: 2, // G -> A, D/F# -> E/G#, Em7 -> F#m7, C9 -> D9
        currentKey: 'A',
        chordFont: 'Times New Roman',
        fontSizePt: 11.0,
        lineSpacingPx: 8,
        markerEnabled: true,
        markerText: 'Culto de Domingo',
      ),
    );

    final asciiHeader = latin1.decode(bytes.sublist(0, 8));
    final pdfText = latin1.decode(bytes);

    expect(asciiHeader, startsWith('%PDF-1.4'));
    expect(pdfText, contains('%%EOF'));
    expect(pdfText, contains('xref'));
    expect(pdfText, contains('/MediaBox [0 0 595.28 841.89]'));
    // Multiple pages with Page / Total footer (3 pages for 45+ lines)
    expect(pdfText, contains('/Count 3'));
    expect(pdfText, contains('1 / 3'));
    expect(pdfText, contains('2 / 3'));
    expect(pdfText, contains('3 / 3'));
    // Cross-reference table byte offsets point to real objects
    final startXrefMatch = RegExp(r'startxref\n(\d+)\n%%EOF').firstMatch(pdfText);
    expect(startXrefMatch, isNotNull);
    final xrefPos = int.parse(startXrefMatch!.group(1)!);
    expect(pdfText.substring(xrefPos), startsWith('xref\n'));
    // Transposed chords & progression chords present, original untransposed root progression replaced
    expect(pdfText, contains('(A) Tj'));
    expect(pdfText, contains('(E/G#) Tj'));
    expect(pdfText, contains('(F#m7) Tj'));
    expect(pdfText, contains('(D9) Tj'));
    // Tablature & progression preserved in Courier monospace alongside user's Times font choice
    expect(pdfText, contains('/BaseFont /Courier'));
    expect(pdfText, contains('/BaseFont /Times-Roman'));
    expect(pdfText, contains('(e|---3---2---0-------|) Tj'));
    expect(pdfText, contains('(Intro: \\(viol\\343o leve\\) ) Tj'));
    expect(pdfText, contains('(||:) Tj'));
    expect(pdfText, contains('(:||) Tj'));
    // Custom top marker rendered on page 1
    expect(pdfText, contains('(Culto de Domingo) Tj'));
    expect(pdfText, contains('(Capo: 2\\252 casa) Tj'));
    expect(pdfText, contains('(Tom: A) Tj'));
  });

  test('supports monospace Courier and Helvetica (Arial) font mappings', () {
    final chord = buildSampleChord(content: '[C]Aba [G]Pai');
    final courierPdf = latin1.decode(
      SmartChordPdfBuilder.build(
        SmartChordPdfDocumentOptions(
          chord: chord,
          semitones: 0,
          currentKey: 'C',
          chordFont: 'Courier New',
        ),
      ),
    );
    final arialPdf = latin1.decode(
      SmartChordPdfBuilder.build(
        SmartChordPdfDocumentOptions(
          chord: chord,
          semitones: 0,
          currentKey: 'C',
          chordFont: 'Arial',
        ),
      ),
    );

    expect(courierPdf, contains('/BaseFont /Courier'));
    expect(courierPdf, contains('/F1 '));
    expect(arialPdf, contains('/BaseFont /Helvetica'));
    expect(arialPdf, contains('/F3 '));
  });

  test('SmartChordPdfExporter sanitizes filenames and calls platform MethodChannel for sharePdf and printPdf', () async {
    expect(
      SmartChordPdfExporter.buildPdfFileName('Graça Infinita / Domingo #1'),
      'Graca_Infinita_Domingo_1.pdf',
    );

    const channel = MethodChannel('com.louvaio.mobile/pdf_export_test');
    final recordedCalls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      recordedCalls.add(call);
      return {'status': 'ok'};
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });

    const exporter = SmartChordPdfExporter(channel: channel);
    final bytes = SmartChordPdfBuilder.build(
      SmartChordPdfDocumentOptions(
        chord: buildSampleChord(content: '[G]Glória'),
        semitones: 0,
        currentKey: 'G',
      ),
    );

    await exporter.sharePdf(
      bytes: bytes,
      fileName: 'Glória.pdf',
      title: 'Glória - Tom G',
    );
    await exporter.printPdf(
      bytes: bytes,
      jobName: 'Glória (G)',
    );

    expect(recordedCalls.length, 2);
    expect(recordedCalls[0].method, 'sharePdf');
    expect(recordedCalls[0].arguments['fileName'], 'Glória.pdf');
    expect((recordedCalls[0].arguments['bytes'] as Uint8List).sublist(0, 5), '%PDF-'.codeUnits);
    expect(recordedCalls[1].method, 'printPdf');
    expect(recordedCalls[1].arguments['jobName'], 'Glória (G)');
  });
}
