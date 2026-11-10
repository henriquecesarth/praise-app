import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_catalog.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_exercise.dart';
import 'package:louvaio_mobile/features/vocal/presentation/vocal_player_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('bundled vocal catalog matches the 40 exercise web contract', () {
    expect(vocalExercises, hasLength(40));
    expect(vocalExercises.first.id, 'vocal-01');
    expect(vocalExercises.last.id, 'vocal-40');

    final descendingNew = vocalExercises.sublist(30);
    expect(descendingNew, hasLength(10));
    for (final ex in descendingNew) {
      expect(ex.category, MelodicCategory.descendente);
      expect(ex.noteDurations.last, 2.0);
    }

    for (final exercise in vocalExercises) {
      expect(exercise.notes, isNotEmpty);
      expect(exercise.notes.length, exercise.noteDurations.length);
      expect(exercise.minTranspose, -12);
      expect(exercise.maxTranspose, 12);
      expect(
        exercise.notesAt(exercise.effectiveMaxTranspose).first,
        exercise.notes.first + exercise.effectiveMaxTranspose,
      );
    }
  });

  testWidgets(
    'bundled catalog matches assets/vocal-exercises.json and shared/vocal-exercises.json 1:1',
    (tester) async {
      final assetSource =
          jsonDecode(await rootBundle.loadString('assets/vocal-exercises.json'))
              as Map<String, dynamic>;
      expect(assetSource['schemaVersion'], 1);
      expect(assetSource['durationUnit'], 'quarter-note-beats');
      final rows = assetSource['exercises'] as List;
      expect(rows.length, 40);
      expect(rows.length, vocalExercises.length);

      for (var i = 0; i < rows.length; i++) {
        final json = rows[i] as Map<String, dynamic>;
        final exercise = vocalExercises[i];
        expect(json['id'], exercise.id);
        expect(json['title'], exercise.title);
        expect(json['description'], exercise.description);
        expect(json['notes'], exercise.notes);
        expect(
          (json['noteDurations'] as List)
              .map((e) => (e as num).toDouble())
              .toList(),
          exercise.noteDurations,
        );
        expect(json['minTranspose'], exercise.minTranspose);
        expect(json['maxTranspose'], exercise.maxTranspose);
        expect(json['category'], exercise.category.value);
      }

      final sharedFile = File('../shared/vocal-exercises.json');
      if (sharedFile.existsSync()) {
        final sharedSource =
            jsonDecode(sharedFile.readAsStringSync()) as Map<String, dynamic>;
        expect(sharedSource['exercises'], assetSource['exercises']);
      }
    },
  );

  test('musical note labels and vocal range presets follow MIDI 60 = Dó4', () {
    expect(midiLabel(48), 'Dó3');
    expect(midiLabel(60), 'Dó4');
    expect(midiLabel(62), 'Ré4');
    expect(midiLabel(63), 'Ré♯4');
    expect(midiLabel(67), 'Sol4');
    expect(midiLabel(72), 'Dó5');
    expect(midiLabel(84), 'Dó6');
    expect(midiLabel(88), 'Mi6');

    expect(selectableVocalNotes.first.midi, 48);
    expect(selectableVocalNotes.first.label, 'Dó3');
    expect(selectableVocalNotes.last.midi, 88);
    expect(selectableVocalNotes.last.label, 'Mi6');

    final parsed = noteAndOctaveFromMidi(60);
    expect(parsed.noteName, 'Dó');
    expect(parsed.octave, 4);
    expect(midiFromNoteAndOctave('Dó', 4), 60);
    expect(midiFromNoteAndOctave('Mi', 6), 88);

    // Verify high voice preset (60..88) allows transposing up to Mi6 (88)
    final ex1 = vocalExercises.first; // [60, 62, 64, 62, 60]
    final (minAguda, maxAguda) = ex1.transposeBounds(midiLow: 60, midiHigh: 88);
    expect(minAguda, 0);
    expect(maxAguda, 12);
  });

  test('progression uses semitone steps and one beat rests', () {
    final exercise = vocalExercises.first;
    final up = exercise.progression();
    final down = exercise.progression(ascending: false);
    final (minimum, maximum) = exercise.transposeBounds();
    expect(up.notes.first, exercise.notes.first + minimum);
    expect(
      up.notes[exercise.notes.length + 1],
      exercise.notes.first + minimum + 1,
    );
    expect(up.durations[exercise.notes.length], 1);
    expect(down.notes.first, exercise.notes.first + maximum);
    expect(
      up.notes
          .where((note) => note >= 0)
          .every((note) => note >= 48 && note <= 84),
      isTrue,
    );
  });

  testWidgets(
    'collapsible visual library (M21-UX1) auto-collapses on select and preserves filter state',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: VocalPlayerScreen()));

      // Starts expanded with search input and category chips visible
      expect(
        find.byKey(const ValueKey('vocal_library_search_input')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('vocal_category_filter_descendente')),
        findsOneWidget,
      );

      // Filter by Descendentes (11 total: vocal-25, vocal-31..vocal-40)
      await tester.tap(
        find.byKey(const ValueKey('vocal_category_filter_descendente')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Descendentes (11)'), findsOneWidget);

      // Search for "alternância" (vocal-40)
      await tester.enterText(
        find.byKey(const ValueKey('vocal_library_search_input')),
        'alternância',
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('vocal_exercise_card_vocal-40')),
        findsOneWidget,
      );

      // Select vocal-40 -> library auto-collapses into compact summary
      await tester.tap(
        find.byKey(const ValueKey('vocal_exercise_card_vocal-40')),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('vocal_library_collapsed_summary')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('vocal_library_search_input')),
        findsNothing,
      );
      expect(find.text('Trocar exercício'), findsOneWidget);
      expect(
        find.text('Padrão descendente com alternância de graus'),
        findsWidgets,
      );

      // Reopen via "Trocar exercício" -> search and category filter preserved
      await tester.tap(find.byKey(const ValueKey('vocal_library_expand_button')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('vocal_library_search_input')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('vocal_exercise_card_vocal-40')),
        findsOneWidget,
      );

      // Manual collapse via "Recolher"
      await tester.tap(
        find.byKey(const ValueKey('vocal_library_collapse_button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('vocal_library_collapsed_summary')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'player exposes tempo, musical vocal range, optional piano keyboard, and stops audio on exit',
    (tester) async {
      const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
      final calls = <String>[];
      final playCompletion = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call.method);
            if (call.method == 'playSequence') await playCompletion.future;
            return null;
          });
      await tester.pumpWidget(const MaterialApp(home: VocalPlayerScreen()));
      expect(find.text('Aquecimento vocal'), findsOneWidget);
      expect(find.text('Andamento: 80 BPM'), findsOneWidget);
      expect(find.text('Extensão vocal: Dó3 a Dó6'), findsOneWidget);

      // Optional piano keyboard starts hidden, toggles on tap
      expect(find.byKey(const ValueKey('vocal_piano_keyboard')), findsNothing);
      await tester.ensureVisible(
        find.byKey(const ValueKey('vocal_toggle_keyboard_button')),
      );
      await tester.tap(
        find.byKey(const ValueKey('vocal_toggle_keyboard_button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('vocal_piano_keyboard')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('piano_key_60')), findsOneWidget);

      // Scroll down to start button
      final startButton = find.byKey(const ValueKey('vocal_start_button'));
      await tester.ensureVisible(startButton);
      await tester.tap(startButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));
      expect(calls, contains('playSequence'));

      final pauseButton = find.byKey(
        const ValueKey('vocal_pause_resume_button'),
      );
      expect(tester.widget<FilledButton>(pauseButton).onPressed, isNull);
      playCompletion.complete();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      expect(find.textContaining('Nota atual:'), findsOneWidget);

      await tester.ensureVisible(find.text('Pausar'));
      await tester.tap(find.text('Pausar'));
      await tester.pump();
      expect(calls, contains('pause'));

      await tester.ensureVisible(find.text('Retomar'));
      await tester.tap(find.text('Retomar'));
      await tester.pump();
      expect(calls, contains('resume'));

      await tester.ensureVisible(find.text('Parar'));
      await tester.tap(find.text('Parar'));
      await tester.pump();
      expect(calls, contains('stop'));

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    },
  );

  testWidgets(
    'player handles sessionId, position updates, piano keyboard sync, and audio completion',
    (tester) async {
      const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
      final receivedCalls = <MethodCall>[];
      var simulateCompleted = false;

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            receivedCalls.add(call);
            if (call.method == 'playSequence') {
              final args = call.arguments as Map;
              return {
                'sessionId': args['sessionId'],
                'sampleRate': 44100,
                'totalFrames': 88200,
              };
            }
            if (call.method == 'position') {
              final args = call.arguments as Map;
              return {
                'sessionId': args['sessionId'],
                'playedFrames': simulateCompleted ? 88200 : 44100,
                'totalFrames': 88200,
                'sampleRate': 44100,
                'state': simulateCompleted ? 'completed' : 'playing',
              };
            }
            return null;
          });

      await tester.pumpWidget(const MaterialApp(home: VocalPlayerScreen()));

      // Show optional piano keyboard
      await tester.ensureVisible(
        find.byKey(const ValueKey('vocal_toggle_keyboard_button')),
      );
      await tester.tap(
        find.byKey(const ValueKey('vocal_toggle_keyboard_button')),
      );
      await tester.pumpAndSettle();

      final startButton = find.byKey(const ValueKey('vocal_start_button'));
      await tester.ensureVisible(startButton);
      await tester.tap(startButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      final playCall = receivedCalls.firstWhere(
        (c) => c.method == 'playSequence',
      );
      expect(playCall.arguments['sessionId'], isNotNull);
      expect(playCall.arguments['notes'], isNotEmpty);
      expect(playCall.arguments['durations'], isNotEmpty);
      expect(playCall.arguments['bpm'], 80);

      // Verify position polling & active note on piano keyboard
      await tester.pump(const Duration(milliseconds: 150));
      expect(receivedCalls.any((c) => c.method == 'position'), isTrue);
      expect(find.textContaining('Tocando:'), findsOneWidget);

      // Verify pause with sessionId
      await tester.ensureVisible(find.text('Pausar'));
      await tester.tap(find.text('Pausar'));
      await tester.pump();
      final pauseCall = receivedCalls.firstWhere((c) => c.method == 'pause');
      expect(pauseCall.arguments['sessionId'], playCall.arguments['sessionId']);
      // Active note badge remains highlighted during pause
      expect(find.textContaining('Tocando:'), findsOneWidget);

      // Verify resume with sessionId
      await tester.ensureVisible(find.text('Retomar'));
      await tester.tap(find.text('Retomar'));
      await tester.pump();
      final resumeCall = receivedCalls.firstWhere((c) => c.method == 'resume');
      expect(
        resumeCall.arguments['sessionId'],
        playCall.arguments['sessionId'],
      );

      // Simulate audio engine completing playback
      simulateCompleted = true;
      await tester.pump(const Duration(milliseconds: 150));

      // Audio stopped and state reset
      expect(find.text('Iniciar exercício'), findsOneWidget);
      expect(find.text('Aguardando nota'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    },
  );
}
