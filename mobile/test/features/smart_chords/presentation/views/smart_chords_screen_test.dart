import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chords_screen.dart';

class FakeSmartChordRepo implements SmartChordRepository {
  List<SmartChord> chords = [];
  Exception? error;
  int getChordsCallCount = 0;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async {
    getChordsCallCount++;
    if (error != null) throw error!;
    if (search != null && search.isNotEmpty) {
      return chords.where((c) => c.title.toLowerCase().contains(search.toLowerCase())).toList();
    }
    return chords;
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async =>
      chords.firstWhere((c) => c.id == id);

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async =>
      SmartChord.fromJson(payload);

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async =>
      SmartChord.fromJson(payload);

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Draft',
      content: '',
      warnings: [],
      sourceType: 'pdf',
    );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    return const SmartChordImportDraft(
      title: 'Draft',
      content: '',
      warnings: [],
      sourceType: 'text',
    );
  }

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) async {
    return const SmartChordImportDraft(
      title: 'Cifra URL',
      content: '',
      warnings: [],
      sourceType: 'url',
    );
  }

  @override
  Future<SmartChordImportDraft> importImageDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Cifra Imagem',
      content: '',
      warnings: [],
      sourceType: 'image',
    );
  }
}

void main() {
  late FakeSmartChordRepo repo;

  setUp(() {
    repo = FakeSmartChordRepo();
  });

  Widget createWidget() {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(repo),
      ],
      child: const MaterialApp(
        home: SmartChordsScreen(),
      ),
    );
  }

  testWidgets('displays empty state when no chords exist', (tester) async {
    repo.chords = [];
    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    expect(find.text('Sua biblioteca de cifras está vazia'), findsOneWidget);
    expect(find.byKey(const ValueKey('empty_create_smart_chord_button')), findsOneWidget);
    expect(find.byKey(const ValueKey('create_smart_chord_fab')), findsOneWidget);
  });

  testWidgets('displays error state with retry button on failure', (tester) async {
    repo.error = const AppFailure(message: 'Erro ao carregar cifras.', statusCode: 500);
    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    expect(find.text('Erro ao carregar cifras.'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);

    // Tap retry after fixing error
    repo.error = null;
    repo.chords = [
      const SmartChord(
        id: 'c-1',
        userId: 'u-1',
        title: 'Oceanos',
        originalKey: 'D',
        content: '[D]Tua graça',
        createdAt: '',
        updatedAt: '',
      ),
    ];

    await tester.tap(find.text('Tentar novamente'));
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);
  });

  testWidgets('displays populated list of smart chords and filters by search', (tester) async {
    repo.chords = [
      const SmartChord(
        id: 'c-1',
        userId: 'u-1',
        title: 'Oceanos',
        originalKey: 'D',
        content: '[D]Tua graça',
        createdAt: '',
        updatedAt: '',
      ),
      const SmartChord(
        id: 'c-2',
        userId: 'u-1',
        title: 'Lugar Secreto',
        originalKey: 'Em',
        content: '[Em]Tu és tudo',
        createdAt: '',
        updatedAt: '',
      ),
    ];

    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Lugar Secreto'), findsOneWidget);

    // Enter search text
    await tester.enterText(find.byKey(const ValueKey('smart_chords_search_field')), 'Oce');
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Lugar Secreto'), findsNothing);
  });

  testWidgets('R2-15 & R2-16: debounces rapid typing by 300ms and issues single server search', (tester) async {
    repo.chords = [
      const SmartChord(
        id: 'c-1',
        userId: 'u-1',
        title: 'Oceanos',
        originalKey: 'D',
        content: '[D]Tua graça',
        createdAt: '',
        updatedAt: '',
      ),
      const SmartChord(
        id: 'c-2',
        userId: 'u-1',
        title: 'Lugar Secreto',
        originalKey: 'Em',
        content: '[Em]Tu és tudo',
        createdAt: '',
        updatedAt: '',
      ),
    ];

    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    expect(repo.getChordsCallCount, 1);

    // Rapid keystrokes: 'O', 'Oc', 'Oce' within 100ms intervals
    await tester.enterText(find.byKey(const ValueKey('smart_chords_search_field')), 'O');
    await tester.pump(const Duration(milliseconds: 100));
    expect(repo.getChordsCallCount, 1);

    await tester.enterText(find.byKey(const ValueKey('smart_chords_search_field')), 'Oc');
    await tester.pump(const Duration(milliseconds: 100));
    expect(repo.getChordsCallCount, 1);

    await tester.enterText(find.byKey(const ValueKey('smart_chords_search_field')), 'Oce');
    await tester.pump(const Duration(milliseconds: 100));
    expect(repo.getChordsCallCount, 1);

    // Wait until 300ms debounce fires
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pumpAndSettle();

    expect(repo.getChordsCallCount, 2);
    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Lugar Secreto'), findsNothing);
  });

  testWidgets('R2-15: clear search cancels pending timer and resets search immediately', (tester) async {
    repo.chords = [
      const SmartChord(
        id: 'c-1',
        userId: 'u-1',
        title: 'Oceanos',
        originalKey: 'D',
        content: '[D]Tua graça',
        createdAt: '',
        updatedAt: '',
      ),
      const SmartChord(
        id: 'c-2',
        userId: 'u-1',
        title: 'Lugar Secreto',
        originalKey: 'Em',
        content: '[Em]Tu és tudo',
        createdAt: '',
        updatedAt: '',
      ),
    ];

    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    expect(repo.getChordsCallCount, 1);

    // Filter with completed search
    await tester.enterText(find.byKey(const ValueKey('smart_chords_search_field')), 'Oce');
    await tester.pumpAndSettle();
    expect(repo.getChordsCallCount, 2);
    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Lugar Secreto'), findsNothing);

    // Tap clear button in text field
    await tester.tap(find.byIcon(Icons.clear));
    await tester.pumpAndSettle();

    // Call count incremented immediately without 300ms delay and all items restored
    expect(repo.getChordsCallCount, 3);
    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Lugar Secreto'), findsOneWidget);
  });
}
