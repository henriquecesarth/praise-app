import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_catalog.dart';
import 'package:louvaio_mobile/features/vocal/presentation/vocal_player_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('bundled vocal catalog matches the 30 exercise web contract', () {
    expect(vocalExercises, hasLength(30));
    expect(vocalExercises.first.id, 'vocal-01');
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

  testWidgets('bundled catalog exactly matches shared JSON', (tester) async {
    final source =
        jsonDecode(await rootBundle.loadString('assets/vocal-exercises.json'))
            as Map<String, dynamic>;
    expect(source['schemaVersion'], 1);
    expect(source['durationUnit'], 'quarter-note-beats');
    final rows = source['exercises'] as List;
    expect(rows.length, vocalExercises.length);
    for (var i = 0; i < rows.length; i++) {
      final json = rows[i] as Map<String, dynamic>;
      final exercise = vocalExercises[i];
      expect(json['id'], exercise.id);
      expect(json['title'], exercise.title);
      expect(json['description'], exercise.description);
      expect(json['notes'], exercise.notes);
      expect(json['noteDurations'], exercise.noteDurations);
      expect(json['minTranspose'], exercise.minTranspose);
      expect(json['maxTranspose'], exercise.maxTranspose);
    }
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
    'player exposes tempo, bounded transpose, and stops audio on exit',
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
      await tester.drag(find.byType(ListView), const Offset(0, -1600));
      await tester.pumpAndSettle();
      expect(find.byType(FilledButton), findsOneWidget);
      await tester.ensureVisible(find.byType(FilledButton));
      await tester.tap(find.byType(FilledButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));
      expect(calls, contains('playSequence'));
      final pauseButton = find.ancestor(
        of: find.text('Pausar'),
        matching: find.byType(FilledButton),
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
    'player handles sessionId, position updates and audio completion',
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
      await tester.drag(find.byType(ListView), const Offset(0, -1600));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byType(FilledButton));
      await tester.tap(find.byType(FilledButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      final playCall = receivedCalls.firstWhere((c) => c.method == 'playSequence');
      expect(playCall.arguments['sessionId'], isNotNull);
      expect(playCall.arguments['notes'], isNotEmpty);
      expect(playCall.arguments['durations'], isNotEmpty);
      expect(playCall.arguments['bpm'], 80);

      // Verify position polling
      await tester.pump(const Duration(milliseconds: 150));
      expect(receivedCalls.any((c) => c.method == 'position'), isTrue);

      // Verify pause with sessionId
      await tester.ensureVisible(find.text('Pausar'));
      await tester.tap(find.text('Pausar'));
      await tester.pump();
      final pauseCall = receivedCalls.firstWhere((c) => c.method == 'pause');
      expect(pauseCall.arguments['sessionId'], playCall.arguments['sessionId']);

      // Verify resume with sessionId
      await tester.ensureVisible(find.text('Retomar'));
      await tester.tap(find.text('Retomar'));
      await tester.pump();
      final resumeCall = receivedCalls.firstWhere((c) => c.method == 'resume');
      expect(resumeCall.arguments['sessionId'], playCall.arguments['sessionId']);

      // Simulate audio engine completing playback
      simulateCompleted = true;
      await tester.pump(const Duration(milliseconds: 150));

      // Audio stopped and state reset
      expect(find.text('Iniciar exercício'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    },
  );
}
