import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/services/ocr_layout_reconstructor.dart';

void main() {
  const reconstructor = OcrLayoutReconstructor();

  test('restored spacing exposes the original token for visible review', () {
    const line = OcrGeometryLine(
      text: 'EbF',
      left: 0,
      top: 0,
      width: 42,
      height: 16,
      elements: [
        OcrGeometryElement(
          text: 'EbF',
          left: 0,
          width: 42,
          symbols: [
            OcrGeometrySymbol(text: 'E', left: 0, width: 10),
            OcrGeometrySymbol(text: 'b', left: 10, width: 10),
            OcrGeometrySymbol(text: 'F', left: 32, width: 10),
          ],
        ),
      ],
    );
    expect(reconstructor.chordSpacingCorrections([line]), {'EbF': 'Eb F'});
    expect(reconstructor.reconstruct([line]), 'Eb F');
    expect(line.text, 'EbF');
  });

  String reconstructToken(String token, {double gap = 12, String? row}) {
    var left = 0.0;
    final symbols = <OcrGeometrySymbol>[];
    for (var i = 0; i < token.length; i++) {
      if (i == 2) left += gap;
      symbols.add(OcrGeometrySymbol(text: token[i], left: left, width: 10));
      left += 10;
    }
    return reconstructor.reconstruct([
      OcrGeometryLine(
        text: row ?? token,
        left: 0,
        top: 0,
        width: left,
        height: 16,
        elements: [
          OcrGeometryElement(
            text: token,
            left: 0,
            width: left,
            symbols: symbols,
          ),
        ],
      ),
    ]);
  }

  test(
    'restores merged chords only with symbol spacing and musical context',
    () {
      expect(reconstructToken('EbF'), 'Eb F');
      expect(reconstructToken('EbGm'), 'Eb Gm');
      expect(reconstructToken('EbF', gap: 1), 'EbF');
      expect(reconstructToken('EbF', row: 'EbF amor'), 'EbF');
      expect(reconstructToken('CADA'), 'CADA');
    },
  );

  test('complete chords win even when internal symbol gaps are large', () {
    for (final chord in ['Eb/G', 'F/A', 'Ab/Bb', 'Db9', 'Cmaj7', 'Dm7']) {
      expect(reconstructToken(chord), chord, reason: chord);
    }
  });

  test('preserves musical tokens and keeps uncertain chord rows separate', () {
    final text = reconstructor.reconstruct(const [
      OcrGeometryLine(text: 'Bb', left: 10, top: 10, width: 20, height: 12),
      OcrGeometryLine(text: 'Eb', left: 10, top: 30, width: 20, height: 12),
      OcrGeometryLine(text: 'F', left: 10, top: 50, width: 10, height: 12),
      OcrGeometryLine(text: 'Eb/G', left: 10, top: 70, width: 35, height: 12),
      OcrGeometryLine(text: 'Ab', left: 10, top: 90, width: 20, height: 12),
      OcrGeometryLine(text: 'Db9', left: 10, top: 110, width: 30, height: 12),
      OcrGeometryLine(text: 'F/A', left: 10, top: 130, width: 25, height: 12),
      OcrGeometryLine(text: 'Ab/Bb', left: 10, top: 150, width: 35, height: 12),
    ]);

    expect(text, 'Bb\nEb\nF\nEb/G\nAb\nDb9\nF/A\nAb/Bb');
  });

  test('preserves parenthesized chords and zero-width characters verbatim', () {
    const invisible = '\u200B';
    final text = reconstructor.reconstruct(const [
      OcrGeometryLine(text: '(Bb)', left: 10, top: 10, width: 28, height: 12),
      OcrGeometryLine(text: '(Eb)', left: 10, top: 30, width: 28, height: 12),
      OcrGeometryLine(
        text: '${invisible}Gm  Eb',
        left: 10,
        top: 50,
        width: 45,
        height: 12,
      ),
    ]);

    expect(text, '(Bb)\n(Eb)\n${invisible}Gm  Eb');
  });

  test('orders boxes into rows and columns without merging lyric rows', () {
    final text = reconstructor.reconstruct(const [
      OcrGeometryLine(
        text: 'right chord',
        left: 100,
        top: 10,
        width: 50,
        height: 12,
      ),
      OcrGeometryLine(
        text: 'left chord',
        left: 10,
        top: 11,
        width: 45,
        height: 11,
      ),
      OcrGeometryLine(text: 'lyric', left: 10, top: 28, width: 30, height: 12),
    ]);

    expect(text, 'left chord        right chord\nlyric');
  });

  test(
    'reads clearly separated columns top to bottom and keeps chord offsets',
    () {
      final text = reconstructor.reconstruct(const [
        OcrGeometryLine(
          text: 'Bb',
          left: 0,
          top: 0,
          width: 20,
          height: 10,
          blockId: 0,
        ),
        OcrGeometryLine(
          text: 'Db9',
          left: 140,
          top: 0,
          width: 30,
          height: 10,
          blockId: 1,
        ),
        OcrGeometryLine(
          text: 'Eb',
          left: 20,
          top: 20,
          width: 20,
          height: 10,
          blockId: 0,
        ),
        OcrGeometryLine(
          text: 'F/A',
          left: 140,
          top: 20,
          width: 30,
          height: 10,
          blockId: 1,
        ),
        OcrGeometryLine(
          text: 'lyric',
          left: 20,
          top: 40,
          width: 40,
          height: 10,
          blockId: 0,
        ),
      ]);

      expect(text.split('\n').take(2).join('\n'), 'Bb\n  Eb');
      expect(text, contains('Db9\nF/A'));
      expect(text, contains('lyric'));
    },
  );

  test(
    'keeps a spanning heading before a clearly separated two-column body',
    () {
      final text = reconstructor.reconstruct(const [
        OcrGeometryLine(
          text: 'Song title',
          left: 0,
          top: 0,
          width: 210,
          height: 12,
        ),
        OcrGeometryLine(
          text: 'Bb',
          left: 0,
          top: 24,
          width: 20,
          height: 10,
          blockId: 0,
        ),
        OcrGeometryLine(
          text: 'Db9',
          left: 150,
          top: 24,
          width: 30,
          height: 10,
          blockId: 1,
        ),
        OcrGeometryLine(
          text: 'Eb',
          left: 0,
          top: 44,
          width: 20,
          height: 10,
          blockId: 0,
        ),
        OcrGeometryLine(
          text: 'F/A',
          left: 150,
          top: 44,
          width: 30,
          height: 10,
          blockId: 1,
        ),
      ]);

      expect(text, 'Song title\nBb\nEb\nDb9\nF/A');
    },
  );

  test('uses element boxes to restore internal chord spacing', () {
    final text = reconstructor.reconstruct(const [
      OcrGeometryLine(
        text: 'Bb Eb/G Ab/Bb',
        left: 10,
        top: 10,
        width: 114,
        height: 12,
        elements: [
          OcrGeometryElement(text: 'Bb', left: 10, width: 15),
          OcrGeometryElement(text: 'Eb/G', left: 43, width: 28),
          OcrGeometryElement(text: 'Ab/Bb', left: 89, width: 35),
        ],
      ),
    ]);

    expect(text, 'Bb   Eb/G   Ab/Bb');
  });

  test(
    'keeps normalized layouts stable across image scale and contrast variants',
    () {
      const lines = [
        OcrGeometryLine(text: 'C', left: 5, top: 5, width: 8, height: 10),
        OcrGeometryLine(text: 'verse', left: 5, top: 22, width: 30, height: 10),
      ];
      final scaled = lines
          .map(
            (line) => OcrGeometryLine(
              text: line.text,
              left: line.left * 4,
              top: line.top * 4,
              width: line.width * 4,
              height: line.height * 4,
            ),
          )
          .toList();

      expect(reconstructor.reconstruct(lines), 'C\nverse');
      // Simulated light/dark images provide the same recognized boxes.
      expect(reconstructor.reconstruct(scaled), 'C\nverse');
    },
  );

  test('handles long pages and empty OCR output', () {
    final longPage = List.generate(
      400,
      (index) => OcrGeometryLine(
        text: index.isEven ? 'Am' : 'A lyric line $index',
        left: 0,
        top: index * 20,
        width: 100,
        height: 12,
      ),
    );

    final output = reconstructor.reconstruct(longPage);
    expect(output.split('\n'), hasLength(400));
    expect(reconstructor.reconstruct(const []), isEmpty);
    expect(
      reconstructor.reconstruct(const [
        OcrGeometryLine(text: '  ', left: 0, top: 0, width: 1, height: 1),
      ]),
      isEmpty,
    );
  });
}
