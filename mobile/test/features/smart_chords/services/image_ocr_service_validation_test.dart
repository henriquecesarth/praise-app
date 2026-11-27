import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/services/image_ocr_service.dart';

void main() {
  final service = OnDeviceImageOcrService();

  test('rejects unsupported, empty, and oversized image data', () async {
    await expectLater(
        service.recognize([], 'empty.png'), throwsFormatException);
    await expectLater(
      service.recognize([1, 2, 3], 'unknown.bin'),
      throwsFormatException,
    );
    await expectLater(
      service.recognize(
        List<int>.filled(OnDeviceImageOcrService.maxBytes + 1, 0),
        'large.png',
      ),
      throwsFormatException,
    );
  });

  test('rejects oversized PNG dimensions before invoking native OCR', () async {
    final pngHeader = Uint8List(24)
      ..setRange(0, 8, const [137, 80, 78, 71, 13, 10, 26, 10]);
    _writeUint32be(pngHeader, 16, OnDeviceImageOcrService.maxPixels + 1);
    _writeUint32be(pngHeader, 20, 1);

    await expectLater(
      service.recognize(pngHeader, 'large-dimensions.png'),
      throwsFormatException,
    );
  });
}

void _writeUint32be(Uint8List bytes, int offset, int value) {
  bytes[offset] = (value >> 24) & 0xff;
  bytes[offset + 1] = (value >> 16) & 0xff;
  bytes[offset + 2] = (value >> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
