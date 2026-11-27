import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/image_import_draft.dart';

void main() {
  test('compact ambiguous tokens remain editable without losing any chord', () {
    const source =
        'Tom: Bb\nEbF EbGm Eb/G F/A Ab/Bb Db9 Cmaj7 Dm7\nEm cada canto';
    final draft = imageDraftFromRecognizedText(source, 'compact.png');
    expect(draft.originalText, source);
    expect(draft.content, source);
    final warning = draft.warnings.singleWhere(
      (w) => w.code == 'OCR_MERGED_CHORD_CANDIDATE',
    );
    expect(warning.message, contains('EbF'));
    expect(warning.message, contains('EbGm'));
    final clear = imageDraftFromRecognizedText(
      'Eb F Eb Gm Eb/G F/A Ab/Bb Db9 Cmaj7 Dm7\nEm cada canto',
      'clear.png',
    );
    expect(
      clear.content,
      '[Eb] [F] [Eb] [Gm] [Eb/G] [F/A] [Ab/Bb] [Db9] [Cmaj7] [Dm7]\nEm cada canto',
    );
  });
  test('exact user Bb sheet retains every word, chord and repetition', () {
    final source = File(
      '../fixtures/smart-chords/m20-user-bb.txt',
    ).readAsStringSync();
    final draft = imageDraftFromRecognizedText(source, 'minha-cifra.png');
    expect(draft.originalKey, 'Bb');
    expect(draft.originalText, source);
    expect(draft.requiresManualPaste, isFalse);
    String plain(String value) => value
        .replaceAll(RegExp(r'[\u200B\uFEFF\[\]]'), '')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n');
    expect(plain(draft.content), plain(source));
    for (final chord in [
      'Bb',
      'Eb',
      'F',
      'Eb/G',
      'Ab',
      'Db9',
      'F/A',
      'Ab/Bb',
      'Eb/Bb',
      'Gm',
      'Dm',
      'Cm',
    ]) {
      final sourceWithoutKey = source.replaceFirst(RegExp(r'^Tom:.*\n'), '');
      final occurrences = RegExp(
        '(?<![A-Za-z0-9/#])${RegExp.escape(chord)}(?![A-Za-z0-9/#])',
      ).allMatches(sourceWithoutKey).length;
      expect(
        RegExp(RegExp.escape('[$chord]')).allMatches(draft.content).length,
        occurrences,
        reason: 'Every $chord occurrence must remain transposable',
      );
    }
    expect(draft.content, contains('[Interlúdio]'));
    expect(draft.content, contains('[Final]'));
    expect(draft.content, contains('Intro: [Bb]'));
    expect(draft.content, contains('([Bb])'));
    expect(draft.content, contains('Glo__ri__fi____car'));
    expect(
      draft.warnings.map((w) => w.code),
      contains('CHORD_ALIGNMENT_UNCERTAIN'),
    );
  });

  test('explicit original key has priority over displayed key and capo', () {
    final draft = imageDraftFromRecognizedText(
      'Tom: G\nTom original: Bb\nCapotraste: 3ª casa\nBb Eb/G\nUma palavra inteira',
      'sheet.jpg',
    );
    expect(draft.originalKey, 'Bb');
    expect(draft.displayedKey, 'G');
    expect(draft.capo, 3);
    expect(draft.content, contains('Uma palavra inteira'));
  });

  test('first chord and conflicting labels never confirm a key', () {
    final noLabel = imageDraftFromRecognizedText(
      'Bb Eb F\nUma canção',
      'sheet.webp',
    );
    expect(noLabel.originalKey, isNull);
    expect(noLabel.warnings.map((w) => w.code), contains('KEY_NOT_IDENTIFIED'));
    final conflict = imageDraftFromRecognizedText(
      'Tom original: Bb\nTom original: G\nBb',
      'sheet.png',
    );
    expect(conflict.originalKey, isNull);
  });

  test('merged OCR chord candidates are preserved and flagged by line', () {
    const row = 'Bb EbF Eb/G Ab Db9 F/A Ab/Bb';
    final draft = imageDraftFromRecognizedText(
      'Tom: Bb\n$row\nEm cada canto deste mundo',
      'sheet.png',
    );
    expect(draft.originalKey, 'Bb');
    expect(draft.content, contains(row));
    expect(draft.content, isNot(contains('[EbF]')));
    expect(draft.originalText, contains(row));
    final warning = draft.warnings.singleWhere(
      (item) => item.code == 'OCR_MERGED_CHORD_CANDIDATE',
    );
    expect(warning.message, contains('Linha 2'));
    expect(warning.message, contains('“EbF” pode ser “Eb” + “F”'));
    expect(warning.message, contains('corrija este trecho antes de salvar'));
  });

  test(
    'empty OCR is an actionable failure, never an empty successful draft',
    () {
      expect(
        () => imageDraftFromRecognizedText('  ', 'sheet.png'),
        throwsA(isA<AppFailure>()),
      );
    },
  );
}
