// M22-D-E2 — guided LISTENING session for a human operator on the physical
// tablet (same local scenario as E1). It drives the real mixer through a fixed,
// announced sequence and prints `E2_LISTEN <n> <cue>` with the expected sound,
// so the operator can confirm what was audible. This test only drives the UI:
// it can NOT prove that sound came out of the speaker/headphones.
//
// Tones (artificial sine waves, amplitude 0.25 FS): vocals 440 Hz, drums 220 Hz,
// bass 110 Hz, guitar 330 Hz, piano 523 Hz, other 660 Hz. Duration 4 s each, so
// the sequence seeks back to the start before every cue.
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/controllers/ministry_audio_playback_controller.dart';

const _backendPort = int.fromEnvironment('E1_BACKEND_PORT', defaultValue: 3107);
const _authPort = int.fromEnvironment('E1_AUTH_PORT', defaultValue: 9098);
const _memberEmail = String.fromEnvironment('E1_MEMBER_EMAIL');
const _password = String.fromEnvironment('E1_PASSWORD');
const _ministryA = String.fromEnvironment('E1_MIN_A');
const _recordingA = String.fromEnvironment('E1_REC_A');
const _stems = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
const _hz = {'vocals': 440, 'drums': 220, 'bass': 110, 'guitar': 330, 'piano': 523, 'other': 660};

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('M22-E2 guided listening session', (tester) async {
    expect(_memberEmail.isNotEmpty && _ministryA.isNotEmpty && _recordingA.isNotEmpty, isTrue,
        reason: 'E1_* dart-defines are required');
    final app = await Firebase.initializeApp(
      name: 'm22-e2-listen',
      options: const FirebaseOptions(
        apiKey: 'local-only-emulator-key',
        appId: '1:123456789:android:0123456789abcdef',
        messagingSenderId: '123456789',
        projectId: 'demo-louvaio',
      ),
    );
    final firebaseAuth = FirebaseAuth.instanceFor(app: app);
    await firebaseAuth.useAuthEmulator('127.0.0.1', _authPort, automaticHostMapping: false);
    await firebaseAuth.signOut();
    final container = ProviderContainer(overrides: [
      appEnvironmentProvider.overrideWithValue(const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://127.0.0.1:$_backendPort/api/v1',
      )),
      firebaseAuthProvider.overrideWithValue(firebaseAuth),
      preferencesStorageProvider.overrideWithValue(InMemoryPreferencesStorage()),
      ministryAudioLibraryEnabledProvider.overrideWithValue(true),
    ]);
    addTearDown(container.dispose);
    // Keep Dio referenced for parity with the other scenario tests.
    expect(Dio, isNotNull);

    Future<void> until(String what, bool Function() cond,
        {Duration timeout = const Duration(seconds: 45)}) async {
      final end = DateTime.now().add(timeout);
      while (!cond()) {
        if (DateTime.now().isAfter(end)) throw StateError('timeout waiting for $what');
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    Future<void> hold(int ms) async {
      final end = DateTime.now().add(Duration(milliseconds: ms));
      while (DateTime.now().isBefore(end)) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    MinistryAudioPlaybackState ps() => container.read(ministryAudioPlaybackControllerProvider);
    MinistryAudioPlaybackController pc() =>
        container.read(ministryAudioPlaybackControllerProvider.notifier);
    Future<void> tapKey(String key) async {
      await tester.tap(find.byKey(ValueKey(key)));
      await tester.pump(const Duration(milliseconds: 150));
    }

    var cue = 0;
    Future<void> say(String text) async {
      cue++;
      // ignore: avoid_print
      print('E2_LISTEN $cue $text');
    }

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const LouvAioApp(),
    ));
    await tester.pump(const Duration(seconds: 2));
    await until('login form', () => find.text('Entrar').evaluate().isNotEmpty);
    await tester.enterText(find.widgetWithText(TextFormField, 'E-mail'), _memberEmail);
    await tester.enterText(find.widgetWithText(TextFormField, 'Senha'), _password);
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Entrar').first);
    await until('authenticated', () => container.read(authNotifierProvider).isAuthenticated);
    await until('ministry list', () => find.text('Ministério E1 A').evaluate().isNotEmpty);
    await tester.tap(find.text('Ministério E1 A'));
    await until('ministry ready', () {
      final s = container.read(ministryContextNotifierProvider);
      return s.isReady && s.selectedMinistry?.id == _ministryA;
    });
    await until('shell', () => find.text('Repertório').evaluate().isNotEmpty);
    await tester.tap(find.text('Repertório'));
    await tester.pump(const Duration(milliseconds: 500));
    await until('library entry',
        () => find.byKey(const ValueKey('open_ministry_audio_library')).evaluate().isNotEmpty);
    await tapKey('open_ministry_audio_library');
    await until('recording listed',
        () => find.byKey(const ValueKey('audio_recording_$_recordingA')).evaluate().isNotEmpty);
    await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
    await until('mixer ready', () => ps().phase == MinistryAudioPlaybackPhase.ready,
        timeout: const Duration(seconds: 90));

    // Headroom for the operator to raise the media volume and put the device in position.
    await say('GET READY: set media volume to a comfortable level. Starting in 12 s.');
    await hold(12000);

    Future<void> restart() async {
      await pc().seek(0);
      await hold(300);
    }

    await tapKey('mixer_play');
    await until('playing', () => ps().phase == MinistryAudioPlaybackPhase.playing);

    await say('FULL MIX (6 stacked tones: 110/220/330/440/523/660 Hz) for ~2 s');
    await hold(2200);

    for (final stem in _stems) {
      await restart();
      await tapKey('solo_$stem');
      await say('SOLO $stem: ONLY a ${_hz[stem]} Hz tone for ~2 s');
      await hold(2200);
      await tapKey('solo_$stem');
    }

    await restart();
    await tapKey('mute_drums');
    await say('MUTE drums: full mix WITHOUT the 220 Hz tone for ~2 s');
    await hold(2200);
    await tapKey('mute_drums');

    await restart();
    await say('MUTE then UNMUTE vocals quickly: 440 Hz disappears, then returns');
    await tapKey('mute_vocals');
    await hold(1000);
    await tapKey('mute_vocals');
    await hold(1000);

    await restart();
    await tester.drag(find.byKey(const ValueKey('gain_bass')), const Offset(-200, 0));
    await tester.pump(const Duration(milliseconds: 300));
    // The tones last 4 s and a natural end closes the session by design, so cues that also drag a slider
    // (extra ~0.6 s of overhead) are shorter to stay inside the track.
    await say('INDIVIDUAL volume: bass (110 Hz) pulled DOWN, clearly quieter for ~2 s');
    await hold(2200);

    await restart();
    await tester.drag(find.byKey(const ValueKey('mixer_master')), const Offset(-200, 0));
    await tester.pump(const Duration(milliseconds: 300));
    await say('MASTER volume pulled DOWN: whole mix clearly quieter for ~2 s');
    await hold(2200);

    await restart();
    await say('PAUSE in 1 s: silence for 2 s, then RESUME (no pitch/alignment glitch)');
    await hold(1000);
    await tapKey('mixer_pause');
    await hold(2000);
    await tapKey('mixer_resume');
    await hold(1500);

    await say('SEEK to the middle: all tones continue together (no solo tone leading)');
    await pc().seek((ps().durationFrames * 0.5).round());
    await hold(1500);

    await say('STOP: sound must cease IMMEDIATELY and stay silent for 3 s');
    await tapKey('mixer_stop');
    await hold(3000);

    await tapKey('mixer_play');
    await until('playing for logout', () => ps().phase == MinistryAudioPlaybackPhase.playing);
    await say('LOGOUT while playing: sound must stop at once and stay silent for 4 s');
    await hold(800);
    await container.read(authNotifierProvider.notifier).logout();
    await hold(4000);
    await say('END. Reply with what you heard for each cue (heard / not heard / glitch).');
  });
}
