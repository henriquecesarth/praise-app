import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';

void main() {
  test('shared URL acquisition contract preserves draft and request content', () {
    final contractFile =
        File('../fixtures/smart-chords/url-acquisition-contract.json');
    expect(contractFile.existsSync(), isTrue);
    final contract =
        jsonDecode(contractFile.readAsStringSync()) as Map<String, dynamic>;
    final expectedDraft =
        Map<String, dynamic>.from(contract['expected_draft'] as Map);
    final draft = SmartChordImportDraft.fromMap(expectedDraft);
    final musicalHtml = contract['musical_html'] as String;

    expect(contract['url'], expectedDraft['source_url']);
    expect(musicalHtml, contains('Tom: Bb'));
    expect(musicalHtml, contains('Bb     Eb/G\nLuz no mar'));
    expect(musicalHtml, contains('e|--0h2-12/14--|'));
    expect(draft.originalKey, 'Bb');
    expect(draft.toMap()['content'], expectedDraft['content']);
    expect(draft.content, contains('[Bb]Luz no [Eb/G]mar'));

    final tabRows = draft.content
        .split('\n')
        .where((line) => RegExp(r'^\s*[eBGDAE]\|').hasMatch(line))
        .toList();
    expect(tabRows, hasLength(6));
    expect(tabRows.first, 'e|--0h2-12/14--|');

    final requestPayload = SmartChord(
      id: 'draft',
      userId: 'test-user',
      title: draft.title,
      originalKey: draft.originalKey!,
      content: draft.content,
      createdAt: '',
      updatedAt: '',
      artistName: draft.artistName,
      sourceUrl: draft.sourceUrl,
      displayedKey: draft.displayedKey,
      capo: draft.capo,
    ).toRequestPayload();
    expect(requestPayload['original_key'], 'Bb');
    expect(requestPayload['content'], expectedDraft['content']);
    expect(requestPayload['content'], draft.content);
  });
}
