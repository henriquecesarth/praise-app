import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_form_screen.dart';

class FakeSmartChordRepo implements SmartChordRepository {
  Map<String, dynamic>? lastCreatedPayload;
  Map<String, dynamic>? lastUpdatedPayload;

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
      id: 'sc-created',
      userId: 'u-1',
      title: payload['title'] as String,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      createdAt: '',
      updatedAt: '',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async {
    lastUpdatedPayload = payload;
    return SmartChord(
      id: id,
      userId: 'u-1',
      title: payload['title'] as String,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      createdAt: '',
      updatedAt: '',
    );
  }

  @override
  Future<void> deleteSmartChord(String id) async {}
}

void main() {
  late FakeSmartChordRepo repo;

  setUp(() {
    repo = FakeSmartChordRepo();
  });

  Widget createWidget({SmartChord? initialChord, String? prefillSongTitle, String? prefillKey}) {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        home: SmartChordFormScreen(
          initialChord: initialChord,
          prefillSongTitle: prefillSongTitle,
          prefillKey: prefillKey,
        ),
      ),
    );
  }

  testWidgets('validates required fields on submission', (tester) async {
    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    // Tap save without filling fields
    await tester.tap(find.byKey(const ValueKey('smart_chord_save_button')));
    await tester.pumpAndSettle();

    expect(find.text('Título é obrigatório.'), findsOneWidget);
    expect(find.text('Conteúdo da cifra é obrigatório.'), findsOneWidget);
    expect(repo.lastCreatedPayload, isNull);
  });

  testWidgets('fills form and creates smart chord successfully', (tester) async {
    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('smart_chord_title_field')), 'Grande é o Senhor');
    await tester.enterText(find.byKey(const ValueKey('smart_chord_content_field')), '[A]Grande é o [D]Senhor');
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('smart_chord_save_button')));
    await tester.pumpAndSettle();

    expect(repo.lastCreatedPayload, isNotNull);
    expect(repo.lastCreatedPayload!['title'], 'Grande é o Senhor');
    expect(repo.lastCreatedPayload!['content'], '[A]Grande é o [D]Senhor');
  });

  testWidgets('quick harmonic field chip inserts chord brackets', (tester) async {
    await tester.pumpWidget(createWidget());
    await tester.pumpAndSettle();

    // Default key is C, so [C], [Dm], etc. are visible in quick chips
    await tester.tap(find.widgetWithText(ActionChip, 'Dm'));
    await tester.pumpAndSettle();

    final contentField = tester.widget<TextFormField>(find.byKey(const ValueKey('smart_chord_content_field')));
    expect(contentField.controller!.text, contains('[Dm]'));
  });
}
