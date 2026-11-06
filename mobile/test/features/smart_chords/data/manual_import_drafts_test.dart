import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/manual_import_drafts.dart';

void main() {
  test('URL assistant derives metadata offline without fetching content', () {
    final draft = manualUrlDraft(
        'https://www.cifraclub.com.br/artista-da-fe/luz-e-amor/?x=1');
    expect(draft.title, 'Luz e Amor');
    expect(draft.artistName, 'Artista da Fe');
    expect(draft.content, isEmpty);
    expect(draft.requiresManualPaste, isTrue);
    expect(draft.sourceType, 'url');
  });
  test(
      'URL rejects unsupported hosts, credentials, custom ports and encoded paths',
      () {
    for (final url in [
      'https://evil.test/a/b',
      'https://cifraclub.com.br.evil.test/a/b',
      'https://user@cifraclub.com.br/a/b',
      'https://cifraclub.com.br:8080/a/b',
      'file://cifraclub.com.br/a/b',
      'https://cifraclub.com.br/a%2fb/c',
      'https://cifraclub.com.br/a/%00',
      'https://cifraclub.com.br/a/%zz'
    ]) {
      expect(() => manualUrlDraft(url), throwsA(isA<AppFailure>()),
          reason: url);
    }
  });
  test('manual image accepts supported signatures and keeps content empty', () {
    for (final bytes in [
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0xff, 0xd8, 0xff],
      [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
    ]) {
      final draft = manualImageDraft(bytes, '../minha-cifra.png');
      expect(draft.title, 'Minha cifra');
      expect(draft.content, isEmpty);
      expect(draft.requiresManualPaste, isTrue);
      expect(draft.warnings.single.code, 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED');
    }
  });
  test('manual image rejects invalid, empty and oversized bytes', () {
    for (final bytes in [
      <int>[],
      [1, 2, 3],
      List.filled(5 * 1024 * 1024 + 1, 0)
    ]) {
      expect(
          () => manualImageDraft(bytes, 'x.png'), throwsA(isA<AppFailure>()));
    }
  });
}
