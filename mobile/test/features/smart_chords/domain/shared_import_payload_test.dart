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

    test('fromMap rejects shared text over 100,000 characters', () async {
      final payload = await SharedImportPayload.fromMap({
        'type': 'text',
        'text': List.filled(SharedImportPayload.maxSharedTextLength + 1, 'x')
            .join(),
      });
      expect(payload?.error, 'TEXT_TOO_LARGE');
      expect(payload?.hasError, isTrue);
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

    test('fromMap parses pdf filePath, reads bytes and cleans up file',
        () async {
      final tempDir = await Directory.systemTemp.createTemp('payload_test');
      final tempFile = File('${tempDir.path}/test_chord.pdf');
      final sampleBytes =
          Uint8List.fromList([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]);
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

    test('image payload factory creates valid image payload', () {
      final bytes = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47]);
      final payload = SharedImportPayload.image(
        imageBytes: bytes,
        imageFileName: 'foto.png',
      );
      expect(payload.type, SharedImportType.image);
      expect(payload.isImage, isTrue);
      expect(payload.isPdf, isFalse);
      expect(payload.isText, isFalse);
      expect(payload.hasError, isFalse);
      expect(payload.imageBytes, bytes);
      expect(payload.imageFileName, 'foto.png');
    });

    test('fromMap parses image filePath, reads bytes and cleans up file',
        () async {
      final tempDir =
          await Directory.systemTemp.createTemp('image_payload_test');
      final tempFile = File('${tempDir.path}/test_chord.png');
      final sampleBytes =
          Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      await tempFile.writeAsBytes(sampleBytes);

      final map = {
        'type': 'image',
        'filePath': tempFile.path,
        'fileName': 'test_chord.png',
      };
      final payload = await SharedImportPayload.fromMap(map);
      expect(payload, isNotNull);
      expect(payload!.isImage, isTrue);
      expect(payload.imageBytes, sampleBytes);
      expect(payload.imageFileName, 'test_chord.png');

      // Check temporary file cleanup
      expect(await tempFile.exists(), isFalse);
      await tempDir.delete(recursive: true);
    });

    test('image format validation accepts PNG, JPEG and WebP signatures only',
        () {
      expect(
          SharedImportPayload.isSupportedImageBytes(
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
          ),
          isTrue);
      expect(SharedImportPayload.isSupportedImageBytes([0xFF, 0xD8, 0xFF]),
          isTrue);
      expect(
          SharedImportPayload.isSupportedImageBytes(
            [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
          ),
          isTrue);
      expect(SharedImportPayload.isSupportedImageBytes([1, 2, 3, 4]), isFalse);
    });

    test('fromMap rejects unsupported image bytes and removes temporary file',
        () async {
      final tempDir =
          await Directory.systemTemp.createTemp('invalid_image_payload_test');
      final tempFile = File('${tempDir.path}/not-image.png');
      await tempFile.writeAsBytes([1, 2, 3, 4]);
      final payload = await SharedImportPayload.fromMap({
        'type': 'image',
        'filePath': tempFile.path,
        'fileName': 'not-image.png',
      });
      expect(payload?.error, 'UNSUPPORTED_IMAGE_FORMAT');
      expect(await tempFile.exists(), isFalse);
      await tempDir.delete(recursive: true);
    });

    test('fromMap returns null on null map', () async {
      final payload = await SharedImportPayload.fromMap(null);
      expect(payload, isNull);
    });
  });
}
