import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_providers.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_reader_screen.dart';

class FakeSmartChordRepo implements SmartChordRepository {
  SmartChord? chord;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async => [];

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    if (chord != null) return chord!;
    throw Exception('Not found');
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async =>
      SmartChord.fromJson(payload);

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async =>
      SmartChord.fromJson(payload);

  @override
  Future<void> deleteSmartChord(String id) async {}
}

void main() {
  late FakeSmartChordRepo repo;

  setUp(() {
    repo = FakeSmartChordRepo();
  });

  Widget createWidget(String chordId, {SmartChord? initialChord}) {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        home: SmartChordReaderScreen(
          chordId: chordId,
          initialChord: initialChord,
        ),
      ),
    );
  }

  testWidgets('displays chord, renders lyrics and responds to transposition steppers', (tester) async {
    const chord = SmartChord(
      id: 'sc-1',
      userId: 'u-1',
      title: 'Oceanos',
      originalKey: 'C',
      content: '[C]Tu és [G]Deus',
      artistName: 'Hillsong',
      createdAt: '',
      updatedAt: '',
    );
    repo.chord = chord;

    await tester.pumpWidget(createWidget('sc-1', initialChord: chord));
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Hillsong'), findsOneWidget);
    expect(find.text('Tom: C'), findsOneWidget);

    // Tap +1 semitone
    await tester.tap(find.byTooltip('Meio tom acima (+1)'));
    await tester.pumpAndSettle();

    expect(find.text('Tom: C#'), findsOneWidget);
    expect(find.text('(+1)'), findsOneWidget);

    // Tap Original button to reset
    await tester.tap(find.text('Original'));
    await tester.pumpAndSettle();

    expect(find.text('Tom: C'), findsOneWidget);
  });
}
