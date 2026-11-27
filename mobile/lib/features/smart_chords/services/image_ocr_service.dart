import 'dart:io';

import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

import '../domain/smart_chord_import.dart';
import 'ocr_layout_reconstructor.dart';

class ImageOcrResult {
  final String text;
  final String? originalText;
  final List<ImportWarning> warnings;

  const ImageOcrResult({
    required this.text,
    this.originalText,
    this.warnings = const [],
  });
}

/// Injectable contract for recognizing a supported image into editable text.
abstract class ImageOcrService {
  factory ImageOcrService() = OnDeviceImageOcrService;

  Future<ImageOcrResult> recognize(List<int> bytes, String filename);
}

class OnDeviceImageOcrService implements ImageOcrService {
  static const int maxBytes = 5 * 1024 * 1024;
  static const int maxPixels = 40 * 1000 * 1000;

  final OcrLayoutReconstructor _layout;

  OnDeviceImageOcrService({OcrLayoutReconstructor? layout})
    : _layout = layout ?? const OcrLayoutReconstructor();

  @override
  Future<ImageOcrResult> recognize(List<int> bytes, String filename) async {
    if (bytes.isEmpty) throw const FormatException('A imagem está vazia.');
    if (bytes.length > maxBytes) {
      throw const FormatException('A imagem excede o limite de 5 MiB.');
    }

    final format = _imageFormat(bytes);
    if (format == null) {
      throw const FormatException(
        'Formato não suportado. Use PNG, JPEG ou WebP.',
      );
    }
    if (bytes.any((byte) => byte < 0 || byte > 255)) {
      throw const FormatException('Os dados da imagem são inválidos.');
    }
    final dimensions = _imageDimensions(bytes, format);
    if (dimensions == null || dimensions.$1 <= 0 || dimensions.$2 <= 0) {
      throw const FormatException('Não foi possível ler a imagem.');
    }
    if (dimensions.$1 * dimensions.$2 > maxPixels) {
      throw const FormatException(
        'A resolução da imagem excede o limite permitido.',
      );
    }

    final directory = await Directory.systemTemp.createTemp('louvaio_ocr_');
    final file = File('${directory.path}/input.$format');
    final recognizer = TextRecognizer(script: TextRecognitionScript.latin);
    try {
      await file.writeAsBytes(bytes, flush: true);
      final result = await recognizer.processImage(
        InputImage.fromFilePath(file.path),
      );
      final geometry = <OcrGeometryLine>[];
      for (
        var blockIndex = 0;
        blockIndex < result.blocks.length;
        blockIndex++
      ) {
        final block = result.blocks[blockIndex];
        for (final line in block.lines) {
          final box = line.boundingBox;
          geometry.add(
            OcrGeometryLine(
              text: line.text,
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              blockId: blockIndex,
              elements: line.elements
                  .map((element) {
                    final elementBox = element.boundingBox;
                    return OcrGeometryElement(
                      text: element.text,
                      left: elementBox.left,
                      width: elementBox.width,
                      symbols: element.symbols
                          .map(
                            (symbol) => OcrGeometrySymbol(
                              text: symbol.text,
                              left: symbol.boundingBox.left,
                              width: symbol.boundingBox.width,
                            ),
                          )
                          .toList(growable: false),
                    );
                  })
                  .toList(growable: false),
            ),
          );
        }
      }
      final text = geometry.isEmpty
          ? result.text
          : _layout.reconstruct(geometry);
      final spacingCorrections = _layout.chordSpacingCorrections(geometry);
      return ImageOcrResult(
        text: text,
        originalText: result.text,
        warnings: [
          if (spacingCorrections.isNotEmpty)
            ImportWarning(
              code: 'OCR_CHORD_SPACING_RESTORED',
              message:
                  'Espaços entre acordes reconstruídos pelas posições dos caracteres: ${spacingCorrections.entries.map((e) => '“${e.key}” → “${e.value}”').join('; ')}. Compare com a imagem e edite se necessário.',
            ),
          ..._ambiguousGlyphWarnings(text),
          if (geometry.any((line) => line.height < 16))
            ImportWarning(
              code: 'OCR_SMALL_TEXT',
              message:
                  'Texto pequeno: ${geometry.where((line) => line.height < 16).take(3).map((line) => line.text).join(' / ')}. Confira estes trechos ou use uma captura com maior resolução.',
            ),
        ],
      );
    } finally {
      try {
        await recognizer.close();
      } finally {
        if (await directory.exists()) await directory.delete(recursive: true);
      }
    }
  }

  String? _imageFormat(List<int> bytes) {
    if (bytes.length >= 8 &&
        _matches(bytes, const [137, 80, 78, 71, 13, 10, 26, 10])) {
      return 'png';
    }
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      return 'jpg';
    }
    if (bytes.length >= 12 &&
        String.fromCharCodes(bytes.sublist(0, 4)) == 'RIFF' &&
        String.fromCharCodes(bytes.sublist(8, 12)) == 'WEBP') {
      return 'webp';
    }
    return null;
  }

  bool _matches(List<int> bytes, List<int> signature) {
    for (var i = 0; i < signature.length; i++) {
      if (bytes[i] != signature[i]) return false;
    }
    return true;
  }

  (int, int)? _imageDimensions(List<int> bytes, String format) {
    if (format == 'png' && bytes.length >= 24) {
      return (_uint32be(bytes, 16), _uint32be(bytes, 20));
    }
    if (format == 'webp' && bytes.length >= 25) {
      final chunk = String.fromCharCodes(bytes.sublist(12, 16));
      if (chunk == 'VP8X' && bytes.length >= 30) {
        return (1 + _uint24le(bytes, 24), 1 + _uint24le(bytes, 27));
      }
      if (chunk == 'VP8 ' &&
          bytes.length >= 30 &&
          bytes[23] == 0x9d &&
          bytes[24] == 0x01 &&
          bytes[25] == 0x2a) {
        return (_uint16le(bytes, 26) & 0x3fff, _uint16le(bytes, 28) & 0x3fff);
      }
      if (chunk == 'VP8L' && bytes[20] == 0x2f) {
        final b1 = bytes[21];
        final b2 = bytes[22];
        final b3 = bytes[23];
        final b4 = bytes[24];
        return (
          1 + b1 + ((b2 & 0x3f) << 8),
          1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
        );
      }
    }
    if (format == 'jpg') {
      var offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] != 0xff) return null;
        while (offset < bytes.length && bytes[offset] == 0xff) {
          offset++;
        }
        if (offset >= bytes.length) return null;
        final marker = bytes[offset++];
        if (marker == 0xd9 || marker == 0xda) return null;
        if (marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) return null;
        final segmentLength = _uint16be(bytes, offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length) {
          return null;
        }
        if (_isJpegStartOfFrame(marker)) {
          if (segmentLength < 7) return null;
          return (_uint16be(bytes, offset + 5), _uint16be(bytes, offset + 3));
        }
        offset += segmentLength;
      }
    }
    return null;
  }

  bool _isJpegStartOfFrame(int marker) => const {
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  }.contains(marker);

  int _uint16be(List<int> bytes, int offset) =>
      (bytes[offset] << 8) | bytes[offset + 1];

  int _uint16le(List<int> bytes, int offset) =>
      bytes[offset] | (bytes[offset + 1] << 8);

  int _uint24le(List<int> bytes, int offset) =>
      bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

  int _uint32be(List<int> bytes, int offset) =>
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];

  List<ImportWarning> _ambiguousGlyphWarnings(String text) {
    final tokens = RegExp(
      r'\b(?:[A-G](?:O|0)|[O0][A-G])(?:[#b])?\b',
    ).allMatches(text).map((match) => match.group(0)!).toSet();
    if (tokens.isEmpty) return const [];
    return [
      ImportWarning(
        code: 'OCR_AMBIGUOUS_GLYPH',
        message:
            'Confira possíveis confusões entre O e 0 em: ${tokens.take(5).join(', ')}.',
      ),
    ];
  }
}
