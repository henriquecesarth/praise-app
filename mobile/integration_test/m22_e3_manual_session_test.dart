// M22-D-E3 — MANUAL listening/usage session on a real Android device with a REAL song.
//
// Not an automated check. The app is the real one (real providers, router, screens,
// Dio transport, cache, native engine) wired to the Auth/Firestore EMULATORS and the
// PRIVATE development R2 bucket (`backend/scripts/m22-e2-r2-server.ts`, E2R2_PUBLISH=0).
// The test logs in as the authorized MEMBER, selects the ministry, opens the Audio
// Library and then simply keeps the app alive while the OPERATOR uses the mixer by
// hand, for as long as needed (E3_MINUTES, default 60). Nothing here judges sound.
//
// It only prints evidence: `E3_PHASE` on every playback transition (timestamps, so the
// download time can be read), `E3_TICK` every E3_TICK_SECONDS (phase, position, RSS,
// leases, direct-R2 transfer summary from the test-only transport probe).
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/controllers/ministry_audio_playback_controller.dart';

import 'support/m22_r2_transport_probe.dart';

const _backendPort = int.fromEnvironment('E1_BACKEND_PORT', defaultValue: 3107);
const _authPort = int.fromEnvironment('E1_AUTH_PORT', defaultValue: 9098);
const _memberEmail = String.fromEnvironment('E1_MEMBER_EMAIL');
const _password = String.fromEnvironment('E1_PASSWORD');
const _ministryA = String.fromEnvironment('E1_MIN_A');
const _minutes = int.fromEnvironment('E3_MINUTES', defaultValue: 60);
const _tickSeconds = int.fromEnvironment('E3_TICK_SECONDS', defaultValue: 15);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('M22-E3 manual session with a real song', (tester) async {
    expect(_memberEmail.isNotEmpty && _ministryA.isNotEmpty, isTrue,
        reason: 'E1_* dart-defines are required');
    final app = await Firebase.initializeApp(
      name: 'm22-e3-manual',
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

    final probe = R2TransportProbe();
    final container = ProviderContainer(overrides: [
      probe.override,
      appEnvironmentProvider.overrideWithValue(const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://127.0.0.1:$_backendPort/api/v1',
      )),
      firebaseAuthProvider.overrideWithValue(firebaseAuth),
      preferencesStorageProvider.overrideWithValue(InMemoryPreferencesStorage()),
      ministryAudioLibraryEnabledProvider.overrideWithValue(true),
    ]);
    addTearDown(container.dispose);

    final clock = Stopwatch()..start();
    container.listen<MinistryAudioPlaybackState>(
      ministryAudioPlaybackControllerProvider,
      (previous, next) {
        if (previous?.phase != next.phase || previous?.errorCode != next.errorCode) {
          // ignore: avoid_print
          print('E3_PHASE t=${clock.elapsedMilliseconds}ms ${next.phase.name} err=${next.errorCode ?? '-'} '
              'durationFrames=${next.durationFrames} sampleRate=${next.sampleRate}');
        }
      },
    );

    Future<void> until(String what, bool Function() cond,
        {Duration timeout = const Duration(seconds: 60)}) async {
      final end = DateTime.now().add(timeout);
      while (!cond()) {
        if (DateTime.now().isAfter(end)) throw StateError('timeout waiting for $what');
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const LouvAioApp()));
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
    await tester.tap(find.byKey(const ValueKey('open_ministry_audio_library')));
    await tester.pump(const Duration(milliseconds: 300));
    // ignore: avoid_print
    print('E3_READY the app is open on the Audio Library; the operator now has control (up to $_minutes min).');

    final end = DateTime.now().add(const Duration(minutes: _minutes));
    var nextTick = DateTime.now();
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
      if (DateTime.now().isAfter(nextTick)) {
        nextTick = DateTime.now().add(const Duration(seconds: _tickSeconds));
        final s = container.read(ministryAudioPlaybackControllerProvider);
        // ignore: avoid_print
        print('E3_TICK t=${clock.elapsedMilliseconds}ms phase=${s.phase.name} '
            'pos=${s.positionFrames}/${s.durationFrames} '
            'rssMB=${(ProcessInfo.currentRss / 1048576).round()} leases=${MinistryAudioCache.debugActiveLeases} '
            'auth=${container.read(authNotifierProvider).isAuthenticated} ${probe.summary()}');
      }
    }
    // ignore: avoid_print
    print('E3_DONE ${probe.summary()}');
  }, timeout: const Timeout(Duration(minutes: _minutes + 5)));
}
