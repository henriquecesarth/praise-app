import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/shared_import_payload.dart';

void main() {
  group('SharedImportPayload Unit Tests', () {
    test('text payload factory creates valid text payload', () {
      const payload = SharedImportPayload.text('G D Em C');
      expect(payload.type, SharedImportType.text);
      expect(payload.isText, isTrue);
      expect(payload.isPdf, isFalse);
      expect(payload.hasError, isFalse);
      expect(payload.text, 'G D Em C');
      expect(payload.pdfBytes, isNull);
    });

    test('pdf payload factory creates valid pdf payload', () {
      final bytes = Uint8List.fromList([0x25, 0x50, 0x44, 0x46, 0x2D]);
      final payload = SharedImportPayload.pdf(
        pdfBytes: bytes,
        pdfFileName: 'hino.pdf',
      );
      expect(payload.type, SharedImportType.pdf);
      expect(payload.isPdf, isTrue);
      expect(payload.isText, isFalse);
      expect(payload.hasError, isFalse);
      expect(payload.pdfBytes, bytes);
      expect(payload.pdfFileName, 'hino.pdf');
    });

    test('error payload factory creates valid error payload', () {
      const payload = SharedImportPayload.error(
        error: 'FILE_TOO_LARGE',
        errorMessage: 'Arquivo PDF excede 3 MB',
        pdfFileName: 'grande.pdf',
      );
      expect(payload.type, SharedImportType.error);
      expect(payload.hasError, isTrue);
      expect(payload.error, 'FILE_TOO_LARGE');
      expect(payload.errorMessage, 'Arquivo PDF excede 3 MB');
      expect(payload.pdfFileName, 'grande.pdf');
    });

    test('unsupported payload factory creates valid unsupported payload', () {
      const payload = SharedImportPayload.unsupported(
        error: 'UNSUPPORTED_TYPE',
        errorMessage: 'Tipo de arquivo não suportado.',
      );
      expect(payload.type, SharedImportType.unsupported);
      expect(payload.hasError, isTrue);
      expect(payload.error, 'UNSUPPORTED_TYPE');
    });

    test('fromMap parses valid text map correctly', () async {
      final map = {
        'type': 'text',
        'text': 'A9 | D9',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.isText, isTrue);
      expect(payload.text, 'A9 | D9');
    });

    test('fromMap parses text with error correctly', () async {
      final map = {
        'type': 'text',
        'error': 'EMPTY_TEXT',
        'errorMessage': 'Texto vazio',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.hasError, isTrue);
      expect(payload.error, 'EMPTY_TEXT');
    });

    test('fromMap parses pdf bytes map correctly', () async {
      final bytes = [0x25, 0x50, 0x44, 0x46, 0x2D];
      final map = {
        'type': 'pdf',
        'bytes': bytes,
        'fileName': 'partitura.pdf',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.isPdf, isTrue);
      expect(payload.pdfFileName, 'partitura.pdf');
      expect(payload.pdfBytes, Uint8List.fromList(bytes));
    });

    test('fromMap parses pdf filePath, reads bytes and cleans up file', () async {
      final tempDir = await Directory.systemTemp.createTemp('payload_test');
      final tempFile = File('${tempDir.path}/test_chord.pdf');
      final sampleBytes = Uint8List.fromList([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]);
      await tempFile.writeAsBytes(sampleBytes);

      final map = {
        'type': 'pdf',
        'filePath': tempFile.path,
        'fileName': 'test_chord.pdf',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.isPdf, isTrue);
      expect(payload.pdfBytes, sampleBytes);
      expect(payload.pdfFileName, 'test_chord.pdf');

      // Check temporary file cleanup
      expect(await tempFile.exists(), isFalse);
      await tempDir.delete(recursive: true);
    });

    test('fromMap handles missing filePath gracefully', () async {
      final map = {
        'type': 'pdf',
        'filePath': '/non/existent/path/never_there.pdf',
        'fileName': 'missing.pdf',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.hasError, isTrue);
      expect(payload.error, 'FILE_READ_FAILED');
    });

    test('fromMap parses unsupported mime type map', () async {
      final map = {
        'type': 'unsupported',
        'error': 'UNSUPPORTED_TYPE',
        'errorMessage': 'Audio não suportado',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.hasError, isTrue);
      expect(payload.error, 'UNSUPPORTED_TYPE');
      expect(payload.errorMessage, 'Audio não suportado');
    });

    test('fromMap returns null on null map', () async {
      final payload = await SharedImportPayload.fromMap(null);
      expect(payload, isNull);
    });
  });
}
