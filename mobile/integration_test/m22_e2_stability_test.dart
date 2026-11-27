// M22-D-E2 — repeated open/play/pause/seek/stop/close/reopen cycles on a real
// Android device against the LOCAL simulators (same scenario as E1:
// `backend/scripts/m22-e1-local-server.ts`). Small synthetic WAVs only; no ONNX.
//
// Prints `E2_CYCLE <i> ...` per cycle and `E2_DONE failures=<n>`. It measures
// state/lease/session/RSS evidence ONLY: it does NOT prove audible output.
import 'dart:io';

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
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/controllers/ministry_audio_playback_controller.dart';

import 'support/m22_r2_transport_probe.dart';

// `--dart-define=E1_R2=true`: private development R2 (see m22_e1_ministry_audio_test.dart).
const _r2 = bool.fromEnvironment('E1_R2');

const _backendPort = int.fromEnvironment('E1_BACKEND_PORT', defaultValue: 3107);
const _authPort = int.fromEnvironment('E1_AUTH_PORT', defaultValue: 9098);
const _memberEmail = String.fromEnvironment('E1_MEMBER_EMAIL');
const _password = String.fromEnvironment('E1_PASSWORD');
const _ministryA = String.fromEnvironment('E1_MIN_A');
const _recordingA = String.fromEnvironment('E1_REC_A');
const _cycles = int.fromEnvironment('E2_CYCLES', defaultValue: 12);

final _control = Dio(BaseOptions(
  connectTimeout: const Duration(seconds: 5),
  receiveTimeout: const Duration(seconds: 20),
  validateStatus: (_) => true,
));

Future<Map<String, dynamic>> _stats() async =>
    (await _control.get<Map<String, dynamic>>('http://127.0.0.1:${_backendPort + 1}/')).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('M22-E2 open/play/seek/stop/close/reopen stability on device', (tester) async {
    expect(_memberEmail.isNotEmpty && _ministryA.isNotEmpty && _recordingA.isNotEmpty, isTrue,
        reason: 'E1_* dart-defines are required');

    final app = await Firebase.initializeApp(
      name: 'm22-e2-local',
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
      if (_r2) probe.override,
      appEnvironmentProvider.overrideWithValue(const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://127.0.0.1:$_backendPort/api/v1',
      )),
      firebaseAuthProvider.overrideWithValue(firebaseAuth),
      preferencesStorageProvider.overrideWithValue(InMemoryPreferencesStorage()),
      ministryAudioLibraryEnabledProvider.overrideWithValue(true),
    ]);
    addTearDown(container.dispose);

    Future<void> until(String what, bool Function() cond,
        {Duration timeout = const Duration(seconds: 45)}) async {
      final end = DateTime.now().add(timeout);
      while (!cond()) {
        if (DateTime.now().isAfter(end)) throw StateError('timeout waiting for $what');
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

    final startStats = await _stats();
    final sessions = <String>{};
    final rss = <int>[];
    var failures = 0;

    for (var i = 1; i <= _cycles; i++) {
      try {
        await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
        await until('ready #$i', () => ps().phase == MinistryAudioPlaybackPhase.ready,
            timeout: const Duration(seconds: 60));
        final sid = ps().sessionId;
        expect(sid, isNotNull);
        expect(sessions.add(sid!), isTrue, reason: 'a new native session id per cycle');
        expect(MinistryAudioCache.debugActiveLeases, 1);

        await tapKey('mixer_play');
        await until('playing #$i', () => ps().phase == MinistryAudioPlaybackPhase.playing);
        final p0 = ps().positionFrames;
        await until('position moves #$i', () => ps().positionFrames > p0 + 1500);
        await tapKey('mixer_pause');
        await until('paused #$i', () => ps().phase == MinistryAudioPlaybackPhase.paused);
        await tapKey('mixer_resume');
        await until('playing again #$i', () => ps().phase == MinistryAudioPlaybackPhase.playing);
        await pc().seek((ps().durationFrames * (i.isEven ? 0.7 : 0.3)).round());
        await tester.pump(const Duration(milliseconds: 600));
        await tapKey('mixer_stop');
        await until('stopped #$i', () =>
            ps().phase != MinistryAudioPlaybackPhase.playing &&
            ps().phase != MinistryAudioPlaybackPhase.paused);
        expect(ps().positionFrames, lessThan(2000));

        container.read(routerProvider).pop();
        await until('lease released #$i', () => MinistryAudioCache.debugActiveLeases == 0,
            timeout: const Duration(seconds: 15));
        await until('idle #$i', () => ps().phase == MinistryAudioPlaybackPhase.idle,
            timeout: const Duration(seconds: 15));
        await until('library visible #$i', () => find
            .byKey(const ValueKey('audio_recording_$_recordingA'))
            .hitTestable()
            .evaluate()
            .isNotEmpty);
        rss.add(ProcessInfo.currentRss);
        // ignore: avoid_print
        print('E2_CYCLE $i PASS session=${sid.substring(0, 8)} rssMB=${(rss.last / 1048576).round()}');
      } catch (error) {
        failures++;
        // ignore: avoid_print
        print('E2_CYCLE $i FAIL ${error.runtimeType} ${error.toString().split('\n').first} '
            'phase=${ps().phase.name} leases=${MinistryAudioCache.debugActiveLeases}');
        break;
      }
    }

    final endStats = await _stats();
    // Local simulator: the backend counts the object GETs. R2: the tablet downloads directly, so the
    // instrumented client transport is the only valid counter (and no download may carry credentials).
    final extraDownloads = _r2
        ? probe.started
        : (endStats['objectGets'] as int) - (startStats['objectGets'] as int);
    if (_r2) {
      // ignore: avoid_print
      print('E2R2_TRANSFERS ${probe.summary()}');
      if (probe.records.any((r) => r.destination != 'r2-https' || r.status != 200 || r.hadCredentialHeader)) failures++;
    }
    final firstDownloads = extraDownloads; // cache is cold on cycle 1 only
    // ignore: avoid_print
    print('E2_METRIC objectGets=$firstDownloads (expected 6: only the cold first open) '
        'playbackGets=${(endStats['playbackGets'] as int) - (startStats['playbackGets'] as int)} '
        'sessions=${sessions.length}/$_cycles');
    if (rss.length >= 4) {
      final growthMb = (rss.last - rss[rss.length ~/ 4]) / 1048576;
      // ignore: avoid_print
      print('E2_METRIC rssFirstQuartileMB=${(rss[rss.length ~/ 4] / 1048576).round()} '
          'rssLastMB=${(rss.last / 1048576).round()} growthMB=${growthMb.toStringAsFixed(1)}');
      if (growthMb > 60) failures++;
    }
    if (firstDownloads != 6) failures++;
    if (sessions.length != _cycles) failures++;
    expect(MinistryAudioCache.debugActiveLeases, 0);
    // ignore: avoid_print
    print('E2_DONE failures=$failures cycles=${sessions.length}');
    expect(failures, 0);
  });
}
