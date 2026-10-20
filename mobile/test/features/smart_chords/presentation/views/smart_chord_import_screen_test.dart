import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';

class _FakeSmartChordRepo implements SmartChordRepository {
  SmartChordImportDraft? draftToReturn;
  Map<String, dynamic>? lastCreatedPayload;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async => [];

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async => throw UnimplementedError();

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    lastCreatedPayload = payload;
    return SmartChord(
      id: 'sc-created-1',
      userId: 'user-1',
      title: payload['title'] as String,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async => throw UnimplementedError();

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    return draftToReturn ??
        const SmartChordImportDraft(
          title: 'PDF Cifra',
          artistName: 'Héber',
          originalKey: 'A',
          content: '[A]Certeza',
          warnings: [],
          sourceType: 'pdf',
        );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    return draftToReturn ??
        const SmartChordImportDraft(
          title: 'Texto Cifra',
          artistName: 'Artista',
          originalKey: 'D',
          content: '[D]Graça',
          warnings: [ImportWarning(code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Aviso alinhamento')],
          sourceType: 'text',
        );
  }
}

class _FakeLinkRepo implements SmartChordRepertoireLinkRepository {
  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({required String ministryId, required String chordId}) async =>
      const SmartChordRepertoireLink.unlinked();

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async =>
      SmartChordRepertoireLink(
        link: SmartChordSongLink(
          id: 'link-1',
          userId: 'user-1',
          smartChordId: chordId,
          songId: songId,
          ministryId: ministryId,
        ),
        song: SmartChordSongSummary(
          id: songId,
          title: 'Song',
        ),
      );

  @override
  Future<void> removeRepertoireLink({required String ministryId, required String chordId}) async {}

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({required String ministryId, required String songId}) async => [];
}

void main() {
  group('SmartChordImportScreen Widget Tests', () {
    late _FakeSmartChordRepo repo;
    late _FakeLinkRepo linkRepo;

    setUp(() {
      repo = _FakeSmartChordRepo();
      linkRepo = _FakeLinkRepo();
    });

    Widget createTestWidget() {
      return ProviderScope(
        overrides: [
          smartChordRepositoryProvider.overrideWithValue(repo),
          smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
        ],
        child: const MaterialApp(
          home: SmartChordImportScreen(),
        ),
      );
    }

    testWidgets('renders input mode with PDF and Text tabs', (tester) async {
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      expect(find.text('Importar Cifra'), findsOneWidget);
      expect(find.text('Documento PDF'), findsOneWidget);
      expect(find.text('Colar Texto'), findsOneWidget);

      // Default PDF tab view
      expect(find.text('Toque para selecionar um arquivo PDF'), findsOneWidget);
      expect(find.text('Analisar e Pré-visualizar PDF'), findsOneWidget);

      // Switch to text tab
      await tester.tap(find.text('Colar Texto'));
      await tester.pumpAndSettle();

      expect(find.text('Cole a cifra (acordes acima da letra ou em colchetes):'), findsOneWidget);
      expect(find.text('Analisar e Pré-visualizar Texto'), findsOneWidget);
    });

    testWidgets('extracts plain-text input and displays draft preview with warnings and editor', (tester) async {
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      // Switch to text tab
      await tester.tap(find.text('Colar Texto'));
      await tester.pumpAndSettle();

      // Enter text
      final textField = find.byType(TextField);
      await tester.enterText(textField, 'D      A\nGraça Te dou');

      // Click Analisar
      await tester.tap(find.text('Analisar e Pré-visualizar Texto'));
      await tester.pumpAndSettle();

      // Verify preview editor
      expect(find.text('Texto Cifra'), findsOneWidget);
      expect(find.text('Artista'), findsOneWidget);
      expect(find.text('• Aviso alinhamento'), findsOneWidget);
      expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);

      // Toggle to rendered preview mode
      await tester.tap(find.text('Pré-visualização'));
      await tester.pumpAndSettle();

      expect(find.text('Graça'), findsOneWidget);

      // Save chord
      await tester.tap(find.text('Salvar Cifra Pessoal'));
      await tester.pumpAndSettle();

      expect(repo.lastCreatedPayload, isNotNull);
      expect(repo.lastCreatedPayload!['title'], equals('Texto Cifra'));
    });
  });
}
