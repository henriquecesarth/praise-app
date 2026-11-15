import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/vocal/data/vocal_exercise_repository.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_catalog.dart';
import 'package:louvaio_mobile/features/vocal/domain/vocal_exercise.dart';
import 'package:louvaio_mobile/features/vocal/presentation/vocal_player_screen.dart';

class _MockPreviewAuthRepository extends Mock
    implements AuthRepository, VocalRangePreferenceUpdater {}

class _MockPreviewVocalExerciseRepository extends Mock
    implements VocalExerciseRepository {}

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

  group('VocalExerciseLibrary responsive layout (M21-UX2)', () {
    testWidgets(
      'tablet in landscape renders 2 cards per row without overflow in light and dark themes',
      (tester) async {
        for (final themeMode in [ThemeMode.light, ThemeMode.dark]) {
          await tester.pumpWidget(
            MediaQuery(
              data: const MediaQueryData(size: Size(1024, 768)),
              child: MaterialApp(
                theme: ThemeData.light(useMaterial3: true),
                darkTheme: ThemeData.dark(useMaterial3: true),
                themeMode: themeMode,
                home: const VocalPlayerScreen(),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);

          final card1 = find.byKey(const ValueKey('vocal_exercise_card_vocal-01'));
          final card2 = find.byKey(const ValueKey('vocal_exercise_card_vocal-02'));
          expect(card1, findsOneWidget);
          expect(card2, findsOneWidget);

          final rect1 = tester.getRect(card1);
          final rect2 = tester.getRect(card2);
          // Same row: same top coordinate, card2 to the right of card1
          expect(rect1.top, closeTo(rect2.top, 0.5));
          expect(rect2.left, greaterThan(rect1.right));
        }
      },
    );

    testWidgets(
      'tablet in portrait renders 1 card per row',
      (tester) async {
        await tester.pumpWidget(
          const MediaQuery(
            data: MediaQueryData(size: Size(768, 1024)),
            child: MaterialApp(home: VocalPlayerScreen()),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        final card1 = find.byKey(const ValueKey('vocal_exercise_card_vocal-01'));
        final card2 = find.byKey(const ValueKey('vocal_exercise_card_vocal-02'));
        expect(card1, findsOneWidget);
        expect(card2, findsOneWidget);

        final rect1 = tester.getRect(card1);
        final rect2 = tester.getRect(card2);
        // Stacked vertically: same left coordinate, card2 below card1
        expect(rect1.left, closeTo(rect2.left, 0.5));
        expect(rect2.top, greaterThan(rect1.bottom));
      },
    );

    testWidgets(
      'tablet container width >= 840 renders two-column studio layout without overflow',
      (tester) async {
        tester.view.physicalSize = const Size(1024, 768);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        for (final themeMode in [ThemeMode.light, ThemeMode.dark]) {
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData.light(useMaterial3: true),
              darkTheme: ThemeData.dark(useMaterial3: true),
              themeMode: themeMode,
              home: const VocalPlayerScreen(),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(
            find.byKey(const ValueKey('vocal_tablet_two_column_layout')),
            findsOneWidget,
          );
        }

        tester.view.physicalSize = const Size(768, 1024);
        await tester.pumpWidget(const MaterialApp(home: VocalPlayerScreen()));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(const ValueKey('vocal_tablet_two_column_layout')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'phone in portrait and landscape keeps 1 card per row',
      (tester) async {
        for (final size in [const Size(390, 844), const Size(844, 390)]) {
          await tester.pumpWidget(
            MediaQuery(
              data: MediaQueryData(size: size),
              child: const MaterialApp(home: VocalPlayerScreen()),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);

          final card1 = find.byKey(
            const ValueKey('vocal_exercise_card_vocal-01'),
          );
          final card2 = find.byKey(
            const ValueKey('vocal_exercise_card_vocal-02'),
          );
          expect(card1, findsOneWidget);
          expect(card2, findsOneWidget);

          final rect1 = tester.getRect(card1);
          final rect2 = tester.getRect(card2);
          // Stacked vertically: same left coordinate, card2 below card1
          expect(rect1.left, closeTo(rect2.left, 0.5));
          expect(rect2.top, greaterThan(rect1.bottom));
        }
      },
    );
  });

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

  testWidgets(
    'custom exercise preview keeps Parar prévia active until native position reports completed and manual stop ends preview',
    (tester) async {
      const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
      var nativeState = 'idle';
      var positionPolls = 0;
      var stopCalls = 0;
      var playCalls = 0;

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'playSequence') {
              playCalls++;
              nativeState = 'playing';
              return {'started': true};
            }
            if (call.method == 'position') {
              positionPolls++;
              return {
                'state': nativeState,
                'sessionId': (call.arguments as Map?)?['sessionId'],
                'playedFrames': 4410,
                'totalFrames': 44100,
                'sampleRate': 44100,
              };
            }
            if (call.method == 'stop') {
              stopCalls++;
              nativeState = 'stopped';
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );

      final authRepo = _MockPreviewAuthRepository();
      final vocalRepo = _MockPreviewVocalExerciseRepository();
      when(() => authRepo.authStateChanges())
          .thenAnswer((_) => const Stream.empty());
      when(() => vocalRepo.listCustomExercises())
          .thenAnswer((_) async => const []);

      const user = AuthUser(
        id: 'usr-preview',
        email: 'cantor@louvaio.test',
        name: 'Cantor Preview',
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authRepositoryProvider.overrideWithValue(authRepo),
            vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
            authNotifierProvider.overrideWith((ref) {
              final notifier = AuthNotifier(authRepo);
              notifier.state = const AuthState.authenticated(user);
              return notifier;
            }),
          ],
          child: const MaterialApp(home: VocalPlayerScreen()),
        ),
      );
      await tester.pumpAndSettle();

      final newCustomBtn = find.byKey(const ValueKey('vocal_new_custom_button'));
      await tester.ensureVisible(newCustomBtn);
      await tester.pumpAndSettle();
      await tester.tap(newCustomBtn);
      await tester.pumpAndSettle();

      final previewBtn = find.byKey(const ValueKey('custom_preview_audio_button'));
      await tester.ensureVisible(previewBtn);
      await tester.tap(previewBtn);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 120));

      expect(playCalls, 1);
      expect(
        find.text('Parar prévia'),
        findsOneWidget,
        reason: 'Botão deve permanecer como Parar prévia enquanto áudio nativo está playing',
      );
      expect(find.text('Ouvir prévia'), findsNothing);

      // Complete native playback -> button transitions back to Ouvir prévia
      nativeState = 'completed';
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump();

      expect(find.text('Ouvir prévia'), findsOneWidget);
      expect(find.text('Parar prévia'), findsNothing);

      // Start preview again and tap manual stop before completion
      await tester.tap(previewBtn);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      expect(find.text('Parar prévia'), findsOneWidget);

      final stopCountBeforeTap = stopCalls;
      await tester.tap(previewBtn);
      await tester.pump();
      await tester.pump();

      expect(stopCalls, greaterThan(stopCountBeforeTap));
      expect(find.text('Ouvir prévia'), findsOneWidget);

      final pollsAfterStop = positionPolls;
      await tester.pump(const Duration(milliseconds: 150));
      expect(positionPolls, pollsAfterStop);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    },
  );

  testWidgets(
    'AppLifecycleState.inactive (volume warning/system overlay) keeps playback running while paused stops cleanly',
    (tester) async {
      const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
      final methodLog = <String>[];

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            methodLog.add(call.method);
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
                'playedFrames': 4410,
                'totalFrames': 88200,
                'sampleRate': 44100,
                'state': 'playing',
              };
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );

      await tester.pumpWidget(const MaterialApp(home: VocalPlayerScreen()));
      final startButton = find.byKey(const ValueKey('vocal_start_button'));
      await tester.ensureVisible(startButton);
      await tester.tap(startButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));

      final stopCountBeforeInactive = methodLog.where((m) => m == 'stop').length;

      // Android max-volume confirmation dialog / system overlay triggers inactive
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(
        methodLog.where((m) => m == 'stop').length,
        stopCountBeforeInactive,
        reason: 'Transient inactive state must not interrupt vocal playback',
      );
      expect(
        tester.widget<FilledButton>(startButton).onPressed,
        isNull,
        reason: 'Playback must stay active during inactive overlay',
      );

      // Genuine backgrounding transitions inactive -> hidden -> paused in Flutter's lifecycle state machine
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      await tester.pump();
      expect(
        methodLog.where((m) => m == 'stop').length,
        stopCountBeforeInactive,
        reason: 'Transient hidden transition must wait for paused before stopping',
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(
        methodLog.where((m) => m == 'stop').length,
        greaterThan(stopCountBeforeInactive),
      );

      // SchedulerBinding suspends frame builds while paused; returning to foreground pumps the updated UI
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(tester.widget<FilledButton>(startButton).onPressed, isNotNull);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    },
  );

  testWidgets(
    'internal volume control updates live without interrupting playback and persists locally',
    (tester) async {
      const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
      final calls = <MethodCall>[];
      final prefs = InMemoryPreferencesStorage();

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
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
                'playedFrames': 4410,
                'totalFrames': 88200,
                'sampleRate': 44100,
                'state': 'playing',
              };
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );

      Widget buildApp() => ProviderScope(
        overrides: [preferencesStorageProvider.overrideWithValue(prefs)],
        child: const MaterialApp(home: VocalPlayerScreen()),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();
      expect(find.text('Volume interno: 100%'), findsOneWidget);

      // Start playback -> initial volume sent
      final startButton = find.byKey(const ValueKey('vocal_start_button'));
      await tester.ensureVisible(startButton);
      await tester.tap(startButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));

      final initialPlay = calls.firstWhere((c) => c.method == 'playSequence');
      expect((initialPlay.arguments as Map)['volume'], 1.0);

      final stopCountDuringPlay = calls.where((c) => c.method == 'stop').length;
      final playCountDuringPlay = calls.where((c) => c.method == 'playSequence').length;

      // Change volume while playing via slider callbacks & mute button
      final sliderFinder = find.byKey(const ValueKey('vocal_volume_slider'));
      await tester.ensureVisible(sliderFinder);
      final slider = tester.widget<Slider>(sliderFinder);
      expect(slider.onChanged, isNotNull);
      slider.onChanged!(0.45);
      slider.onChangeEnd?.call(0.45);
      await tester.pump(const Duration(milliseconds: 150));

      expect(find.text('Volume interno: 45%'), findsOneWidget);
      expect(calls.where((c) => c.method == 'stop').length, stopCountDuringPlay);
      expect(calls.where((c) => c.method == 'playSequence').length, playCountDuringPlay);
      final volCalls = calls.where((c) => c.method == 'setVolume').toList();
      expect(volCalls, isNotEmpty);
      expect((volCalls.last.arguments as Map)['volume'], closeTo(0.45, 0.01));

      // Mute & unmute restores previous volume without interrupting playback
      final muteButton = find.byKey(const ValueKey('vocal_volume_mute_button'));
      await tester.ensureVisible(muteButton);
      await tester.tap(muteButton);
      await tester.pump();
      expect(find.text('Volume interno: 0%'), findsOneWidget);
      await tester.tap(muteButton);
      await tester.pump();
      expect(find.text('Volume interno: 45%'), findsOneWidget);
      expect(calls.where((c) => c.method == 'stop').length, stopCountDuringPlay);

      // Rebuild screen -> persisted 45% is restored and passed to next playSequence
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(find.text('Volume interno: 45%'), findsOneWidget);
      await tester.ensureVisible(startButton);
      await tester.tap(startButton);
      await tester.pump();
      final nextPlay = calls.lastWhere((c) => c.method == 'playSequence');
      expect((nextPlay.arguments as Map)['volume'], closeTo(0.45, 0.01));

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    },
  );

  testWidgets(
    'vocal player renders without horizontal overflow on narrow phones, scaled text, landscape, tablet, and light/dark themes',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.view.devicePixelRatio = 1.0;

      final authRepo = _MockPreviewAuthRepository();
      final vocalRepo = _MockPreviewVocalExerciseRepository();
      when(() => authRepo.authStateChanges())
          .thenAnswer((_) => const Stream.empty());
      when(() => vocalRepo.listCustomExercises()).thenAnswer(
        (_) async => const [
          VocalExercise(
            id: 'custom-1',
            title: 'Meu exercício personalizado longo para validar responsividade',
            description: 'Descrição estendida do exercício vocal personalizado',
            notes: [60, 62, 64, 65, 67],
            noteDurations: [1, 1, 1, 1, 2],
            minTranspose: -6,
            maxTranspose: 6,
            isCustom: true,
            category: MelodicCategory.ascendente,
          ),
        ],
      );
      const user = AuthUser(
        id: 'usr-resp',
        email: 'resp@louvaio.test',
        name: 'Cantor Responsivo',
      );

      final scenarios = <({
        Size size,
        double scale,
        ThemeMode theme,
        bool keyboard,
        double imeBottom,
        bool startPlayback,
      })>[
        (size: const Size(360, 740), scale: 1.0, theme: ThemeMode.light, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(360, 740), scale: 1.3, theme: ThemeMode.dark, keyboard: false, imeBottom: 0, startPlayback: true),
        (size: const Size(360, 740), scale: 1.5, theme: ThemeMode.light, keyboard: true, imeBottom: 0, startPlayback: true),
        (size: const Size(393, 852), scale: 1.0, theme: ThemeMode.dark, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(393, 852), scale: 1.3, theme: ThemeMode.light, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(393, 852), scale: 1.5, theme: ThemeMode.dark, keyboard: true, imeBottom: 0, startPlayback: false),
        (size: const Size(740, 360), scale: 1.0, theme: ThemeMode.light, keyboard: false, imeBottom: 260, startPlayback: false),
        (size: const Size(740, 360), scale: 1.0, theme: ThemeMode.light, keyboard: false, imeBottom: 320, startPlayback: false),
        (size: const Size(768, 1024), scale: 1.0, theme: ThemeMode.light, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(768, 1024), scale: 1.3, theme: ThemeMode.dark, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(768, 1024), scale: 1.5, theme: ThemeMode.light, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(1024, 768), scale: 1.0, theme: ThemeMode.light, keyboard: true, imeBottom: 0, startPlayback: true),
        (size: const Size(1024, 768), scale: 1.3, theme: ThemeMode.dark, keyboard: false, imeBottom: 0, startPlayback: false),
        (size: const Size(1024, 768), scale: 1.5, theme: ThemeMode.light, keyboard: false, imeBottom: 0, startPlayback: false),
      ];

      const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            final args = call.arguments as Map?;
            if (call.method == 'playSequence') {
              return {
                'sessionId': args?['sessionId'],
                'sampleRate': 44100,
                'totalFrames': 441000,
              };
            }
            if (call.method == 'position') {
              return {
                'sessionId': args?['sessionId'],
                'playedFrames': 0,
                'totalFrames': 441000,
                'sampleRate': 44100,
                'state': 'playing',
              };
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );

      for (final s in scenarios) {
        tester.view.physicalSize = s.size;
        await tester.pumpWidget(
          ProviderScope(
            key: ValueKey(
              'resp_scope_${s.size.width}x${s.size.height}_${s.scale}_${s.theme.name}_${s.imeBottom}',
            ),
            overrides: [
              authRepositoryProvider.overrideWithValue(authRepo),
              vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
              authNotifierProvider.overrideWith((ref) {
                final notifier = AuthNotifier(authRepo);
                notifier.state = const AuthState.authenticated(user);
                return notifier;
              }),
            ],
            child: MaterialApp(
              theme: ThemeData.light(useMaterial3: true),
              darkTheme: ThemeData.dark(useMaterial3: true),
              themeMode: s.theme,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(s.scale),
                  viewInsets: EdgeInsets.only(bottom: s.imeBottom),
                ),
                child: child!,
              ),
              home: const VocalPlayerScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          tester.takeException(),
          isNull,
          reason:
              'Zero overflow expected for size=${s.size}, scale=${s.scale}, theme=${s.theme}, ime=${s.imeBottom}',
        );
        final barRect = tester.getRect(
          find.byKey(const ValueKey('vocal_bottom_playback_bar')),
        );
        expect(
          barRect.bottom,
          lessThanOrEqualTo(s.size.height - s.imeBottom + 0.5),
          reason: 'Footer must remain above IME inset (${s.imeBottom}) on ${s.size}',
        );
        expect(find.byKey(const ValueKey('vocal_start_button')), findsOneWidget);
        expect(find.byKey(const ValueKey('vocal_volume_slider')), findsOneWidget);
        if (s.imeBottom == 0) {
          expect(
            find.byKey(const ValueKey('vocal_new_custom_button')),
            findsOneWidget,
          );
        }
        if (s.size.width >= 840) {
          expect(
            find.byKey(const ValueKey('vocal_tablet_two_column_layout')),
            findsOneWidget,
          );
        }

        if (s.startPlayback) {
          await tester.tap(find.byKey(const ValueKey('vocal_start_button')));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 20));
          expect(tester.takeException(), isNull);
          expect(find.text('Bloqueado durante execução'), findsWidgets);
        }

        if (s.keyboard) {
          final toggleKeyboard = find.byKey(
            const ValueKey('vocal_toggle_keyboard_button'),
          );
          await tester.ensureVisible(toggleKeyboard);
          await tester.tap(toggleKeyboard);
          await tester.pumpAndSettle();
          expect(
            tester.takeException(),
            isNull,
            reason:
                'Zero overflow with PianoKeyboard open for size=${s.size}, scale=${s.scale}',
          );
          expect(
            find.byKey(const ValueKey('vocal_piano_keyboard')),
            findsOneWidget,
          );
        }
      }

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    },
  );

  group('VocalPlayerScreen R2.1 UX refactor', () {
    testWidgets(
      'monitor shows only single active note without sequence chips and updates through Pronto, Tocando, Pausa, and Concluído',
      (tester) async {
        const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
        var playedFrames = 0;
        var nativeState = 'playing';

        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
              final args = call.arguments as Map?;
              if (call.method == 'playSequence') {
                return {
                  'sessionId': args?['sessionId'],
                  'sampleRate': 44100,
                  'totalFrames': 441000,
                };
              }
              if (call.method == 'position') {
                return {
                  'sessionId': args?['sessionId'],
                  'playedFrames': playedFrames,
                  'totalFrames': 441000,
                  'sampleRate': 44100,
                  'state': nativeState,
                };
              }
              return null;
            });
        addTearDown(
          () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(channel, null),
        );

        final authRepo = _MockPreviewAuthRepository();
        final vocalRepo = _MockPreviewVocalExerciseRepository();
        when(() => authRepo.authStateChanges())
            .thenAnswer((_) => const Stream.empty());
        when(() => vocalRepo.listCustomExercises()).thenAnswer((_) async => []);
        when(
          () => authRepo.updateVocalRangePreference(
            minMidi: any(named: 'minMidi'),
            maxMidi: any(named: 'maxMidi'),
          ),
        ).thenAnswer((_) async => (52, 74));
        const baseUser = AuthUser(
          id: 'usr-comp',
          email: 'comp@louvaio.test',
          name: 'Cantor',
        );
        late AuthNotifier authNotifier;

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authRepositoryProvider.overrideWithValue(authRepo),
              vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
              authNotifierProvider.overrideWith((ref) {
                authNotifier = AuthNotifier(authRepo);
                authNotifier.state = const AuthState.authenticated(baseUser);
                return authNotifier;
              }),
            ],
            child: const MaterialApp(home: VocalPlayerScreen()),
          ),
        );
        await tester.pumpAndSettle();

        final monitorCard = find.byKey(const ValueKey('vocal_monitor_card'));
        expect(monitorCard, findsOneWidget);

        // No sequence Chips rendered anywhere inside monitor
        expect(
          find.descendant(of: monitorCard, matching: find.byType(Chip)),
          findsNothing,
        );
        expect(find.textContaining('(1.0t)'), findsNothing);
        expect(find.textContaining('(2.0t)'), findsNothing);

        // Initial Pronto indicator + single centered prompt
        expect(find.text('Pronto'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Pronto para iniciar',
        );

        // Start playback -> Tocando & first note (vocal-01 starts at Dó3 = 48 in default Dó3..Dó6 range)
        await tester.tap(find.byKey(const ValueKey('vocal_start_button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 20));

        expect(find.text('Tocando'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Dó3',
        );
        // Other notes of sequence must not be displayed alongside active note
        expect(
          find.descendant(of: monitorCard, matching: find.text('Ré3')),
          findsNothing,
        );
        expect(
          find.descendant(of: monitorCard, matching: find.text('Mi3')),
          findsNothing,
        );

        // Advance playedFrames to 2nd note at 80 BPM (1 beat = 0.75s = 33075 frames -> 44100 frames is Ré3)
        playedFrames = 44100;
        await tester.pump(const Duration(milliseconds: 60));
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Ré3',
        );
        expect(
          find.descendant(of: monitorCard, matching: find.text('Dó3')),
          findsNothing,
        );

        // Advance playedFrames to 3rd note (70000 frames -> ~1.58s -> Mi3)
        playedFrames = 70000;
        await tester.pump(const Duration(milliseconds: 60));
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Mi3',
        );

        // Pause updates monitor indicator to Pausa while preserving current note
        await tester.tap(
          find.byKey(const ValueKey('vocal_pause_resume_button')),
        );
        await tester.pump();
        expect(find.text('Pausa'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Mi3',
        );

        // Resume and naturally complete -> Concluído
        await tester.tap(
          find.byKey(const ValueKey('vocal_pause_resume_button')),
        );
        await tester.pump();
        nativeState = 'completed';
        await tester.pump(const Duration(milliseconds: 60));

        expect(find.text('Concluído'), findsOneWidget);
        expect(find.text('Exercício concluído'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Exercício concluído',
        );

        // Changing practice config clears completion state back to Pronto
        final bpm60 = find.byKey(const ValueKey('vocal_bpm_preset_60'));
        await tester.ensureVisible(bpm60);
        await tester.tap(bpm60);
        await tester.pump();
        expect(find.text('Pronto'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Pronto para iniciar',
        );

        // Same-user profile range sync also clears completion state
        nativeState = 'playing';
        playedFrames = 0;
        await tester.tap(find.byKey(const ValueKey('vocal_start_button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 20));
        nativeState = 'completed';
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.text('Concluído'), findsOneWidget);

        authNotifier.state = const AuthState.authenticated(
          AuthUser(
            id: 'usr-comp',
            email: 'comp@louvaio.test',
            name: 'Cantor',
            vocalMinMidi: 50,
            vocalMaxMidi: 72,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Pronto'), findsOneWidget);

        // Server-clamped vocal range confirmation on save also clears completion state
        nativeState = 'playing';
        playedFrames = 0;
        await tester.tap(find.byKey(const ValueKey('vocal_start_button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 20));
        nativeState = 'completed';
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.text('Concluído'), findsOneWidget);

        final saveRangeBtn = find.byKey(
          const ValueKey('vocal_save_range_button'),
        );
        await tester.ensureVisible(saveRangeBtn);
        await tester.pumpAndSettle();
        await tester.tap(saveRangeBtn);
        await tester.pumpAndSettle();
        expect(find.text('Pronto'), findsOneWidget);

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      },
    );

    testWidgets(
      'fixed footer bar stays accessible immediately and during scroll, respects bottom SafeArea & keyboard inset, and avoids duplicate volume cards',
      (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        tester.view.devicePixelRatio = 1.0;
        tester.view.physicalSize = const Size(393, 852);

        final authRepo = _MockPreviewAuthRepository();
        final vocalRepo = _MockPreviewVocalExerciseRepository();
        when(() => authRepo.authStateChanges())
            .thenAnswer((_) => const Stream.empty());
        when(() => vocalRepo.listCustomExercises()).thenAnswer((_) async => []);
        when(
          () => authRepo.updateVocalRangePreference(
            minMidi: any(named: 'minMidi'),
            maxMidi: any(named: 'maxMidi'),
          ),
        ).thenAnswer(
          (inv) async => (
            inv.namedArguments[#minMidi] as int,
            inv.namedArguments[#maxMidi] as int,
          ),
        );
        const user = AuthUser(
          id: 'usr-fixed',
          email: 'fixed@louvaio.test',
          name: 'Cantor Rodape',
        );

        Widget buildWithInsets({
          double bottomPadding = 48,
          double bottomInset = 0,
        }) {
          return ProviderScope(
            overrides: [
              authRepositoryProvider.overrideWithValue(authRepo),
              vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
              authNotifierProvider.overrideWith((ref) {
                final notifier = AuthNotifier(authRepo);
                notifier.state = const AuthState.authenticated(user);
                return notifier;
              }),
            ],
            child: MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  padding: EdgeInsets.only(bottom: bottomPadding),
                  viewInsets: EdgeInsets.only(bottom: bottomInset),
                ),
                child: child!,
              ),
              home: const VocalPlayerScreen(),
            ),
          );
        }

        await tester.pumpWidget(buildWithInsets(bottomPadding: 48));
        await tester.pumpAndSettle();

        // Legacy standalone volume card removed -> only single footer volume & transport controls
        expect(find.byKey(const ValueKey('vocal_volume_card')), findsNothing);
        expect(find.byKey(const ValueKey('vocal_volume_slider')), findsOneWidget);
        expect(find.byKey(const ValueKey('vocal_start_button')), findsOneWidget);

        final barFinder = find.byKey(const ValueKey('vocal_bottom_playback_bar'));
        final startFinder = find.byKey(const ValueKey('vocal_start_button'));
        final sliderFinder = find.byKey(const ValueKey('vocal_volume_slider'));

        // Immediately visible & above 48dp Android nav bar BEFORE any scrolling
        final initialBarRect = tester.getRect(barFinder);
        final initialStartRect = tester.getRect(startFinder);
        final initialSliderRect = tester.getRect(sliderFinder);
        expect(initialStartRect.bottom, lessThanOrEqualTo(852.0 - 48.0));
        expect(initialSliderRect.bottom, lessThanOrEqualTo(852.0 - 48.0));
        expect(initialStartRect.top, greaterThanOrEqualTo(initialBarRect.top));

        // Scroll body down -> footer stays pinned and last controls + save button stay unobscured above bar
        final scrollableFinder = find.byKey(
          const ValueKey('vocal_main_scroll_view'),
        );
        await tester.drag(scrollableFinder, const Offset(0, -1200));
        await tester.pumpAndSettle();

        final scrolledBarRect = tester.getRect(barFinder);
        expect(scrolledBarRect.top, closeTo(initialBarRect.top, 0.5));

        final descTile = find.byKey(
          const ValueKey('vocal_progression_descending'),
        );
        await tester.ensureVisible(descTile);
        await tester.pumpAndSettle();
        final descRect = tester.getRect(descTile);
        expect(descRect.bottom, lessThanOrEqualTo(scrolledBarRect.top + 0.5));
        await tester.tap(descTile);
        await tester.pumpAndSettle();

        final saveRangeBtn = find.byKey(
          const ValueKey('vocal_save_range_button'),
        );
        await tester.ensureVisible(saveRangeBtn);
        await tester.pumpAndSettle();
        final saveRect = tester.getRect(saveRangeBtn);
        expect(saveRect.bottom, lessThanOrEqualTo(scrolledBarRect.top + 0.5));
        await tester.tap(saveRangeBtn);
        await tester.pumpAndSettle();

        verify(
          () => authRepo.updateVocalRangePreference(
            minMidi: any(named: 'minMidi'),
            maxMidi: any(named: 'maxMidi'),
          ),
        ).called(1);

        // With virtual keyboard open (viewInsets.bottom = 260), bar lifts above keyboard cleanly
        await tester.pumpWidget(
          buildWithInsets(bottomPadding: 0, bottomInset: 260),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
          tester.getRect(startFinder).bottom,
          lessThanOrEqualTo(852.0 - 260.0),
        );

        // Returning from keyboard and opening/closing bottom sheet keeps footer accessible
        await tester.pumpWidget(buildWithInsets(bottomPadding: 48, bottomInset: 0));
        await tester.pumpAndSettle();
        final newCustomBtn = find.byKey(
          const ValueKey('vocal_new_custom_button'),
        );
        await tester.ensureVisible(newCustomBtn);
        await tester.tap(newCustomBtn);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cancelar'));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('vocal_bottom_playback_bar')), findsOneWidget);
        expect(tester.getRect(startFinder).bottom, lessThanOrEqualTo(852.0 - 48.0));

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      },
    );

    testWidgets(
      'optional PianoKeyboard stays synchronized with active note updates on narrow 360dp 1.5x phone',
      (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        tester.view.devicePixelRatio = 1.0;
        tester.view.physicalSize = const Size(360, 740);

        const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
        var playedFrames = 0;

        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
              final args = call.arguments as Map?;
              if (call.method == 'playSequence') {
                return {
                  'sessionId': args?['sessionId'],
                  'sampleRate': 44100,
                  'totalFrames': 441000,
                };
              }
              if (call.method == 'position') {
                return {
                  'sessionId': args?['sessionId'],
                  'playedFrames': playedFrames,
                  'totalFrames': 441000,
                  'sampleRate': 44100,
                  'state': 'playing',
                };
              }
              return null;
            });
        addTearDown(
          () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(channel, null),
        );

        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: const TextScaler.linear(1.5),
              ),
              child: child!,
            ),
            home: const VocalPlayerScreen(),
          ),
        );
        await tester.pumpAndSettle();

        final toggleBtn = find.byKey(
          const ValueKey('vocal_toggle_keyboard_button'),
        );
        await tester.ensureVisible(toggleBtn);
        await tester.tap(toggleBtn);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(const ValueKey('vocal_piano_keyboard')),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const ValueKey('vocal_start_button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 20));
        expect(find.text('Tocando: Dó3'), findsOneWidget);

        // Advance playback to Ré3 (MIDI 50) -> PianoKeyboard active badge + Semantics sync cleanly
        playedFrames = 44100;
        await tester.pump(const Duration(milliseconds: 60));
        expect(find.text('Tocando: Ré3'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('vocal_active_note_value')),
              )
              .data,
          'Ré3',
        );
        expect(find.byKey(const ValueKey('piano_key_50')), findsOneWidget);

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      },
    );

    testWidgets(
      'stale delayed position poll cannot revert resume back to pause and debounced volume never leaks across account switch',
      (tester) async {
        const channel = MethodChannel('com.louvaio.mobile/vocal_audio');
        final delayedPositionCompleter = Completer<Map<String, Object?>>();
        var holdNextPoll = false;
        var nativeState = 'playing';

        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
              final args = call.arguments as Map?;
              if (call.method == 'playSequence') {
                return {
                  'sessionId': args?['sessionId'],
                  'sampleRate': 44100,
                  'totalFrames': 441000,
                };
              }
              if (call.method == 'pause') {
                nativeState = 'paused';
              }
              if (call.method == 'resume') {
                nativeState = 'playing';
              }
              if (call.method == 'position') {
                if (holdNextPoll && !delayedPositionCompleter.isCompleted) {
                  return delayedPositionCompleter.future;
                }
                return {
                  'sessionId': args?['sessionId'],
                  'playedFrames': 0,
                  'totalFrames': 441000,
                  'sampleRate': 44100,
                  'state': nativeState,
                };
              }
              return null;
            });
        addTearDown(
          () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(channel, null),
        );

        final prefs = InMemoryPreferencesStorage();
        final authRepo = _MockPreviewAuthRepository();
        final vocalRepo = _MockPreviewVocalExerciseRepository();
        when(() => authRepo.authStateChanges())
            .thenAnswer((_) => const Stream.empty());
        when(() => vocalRepo.listCustomExercises()).thenAnswer((_) async => []);
        const userA = AuthUser(id: 'usr-a', email: 'a@louvaio.test', name: 'A');
        const userB = AuthUser(id: 'usr-b', email: 'b@louvaio.test', name: 'B');
        late AuthNotifier authNotifier;

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              preferencesStorageProvider.overrideWithValue(prefs),
              authRepositoryProvider.overrideWithValue(authRepo),
              vocalExerciseRepositoryProvider.overrideWithValue(vocalRepo),
              authNotifierProvider.overrideWith((ref) {
                authNotifier = AuthNotifier(authRepo);
                authNotifier.state = const AuthState.authenticated(userA);
                return authNotifier;
              }),
            ],
            child: const MaterialApp(home: VocalPlayerScreen()),
          ),
        );
        await tester.pumpAndSettle();

        // Start playback -> trigger a poll whose response arrives LATE reporting 'paused'
        await tester.tap(find.byKey(const ValueKey('vocal_start_button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 20));

        holdNextPoll = true;
        await tester.pump(const Duration(milliseconds: 55));

        // User pauses and resumes BEFORE delayed poll completes
        await tester.tap(find.byKey(const ValueKey('vocal_pause_resume_button')));
        await tester.pump();
        expect(find.text('Pausa'), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('vocal_pause_resume_button')));
        await tester.pump();
        expect(find.text('Tocando'), findsOneWidget);

        // Now stale delayed 'paused' poll resolves -> must be ignored!
        delayedPositionCompleter.complete({
          'sessionId': 1,
          'playedFrames': 0,
          'totalFrames': 441000,
          'sampleRate': 44100,
          'state': 'paused',
        });
        await tester.pump();
        expect(find.text('Tocando'), findsOneWidget);
        expect(find.text('Pausa'), findsNothing);

        // Trigger debounced slider write on userA then switch account to userB within 120ms
        final slider = tester.widget<Slider>(
          find.byKey(const ValueKey('vocal_volume_slider')),
        );
        slider.onChanged!(0.35);
        await tester.pump();
        expect(find.text('Volume interno: 35%'), findsOneWidget);

        authNotifier.state = const AuthState.authenticated(userB);
        await tester.pumpAndSettle();
        await tester.pump(const Duration(milliseconds: 200));

        expect(prefs.getVocalPlayerVolume(userId: 'usr-b'), isNull);
        expect(find.text('Volume interno: 100%'), findsOneWidget);

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      },
    );
  });
}
