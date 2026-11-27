// M22-D-E1 — end-to-end homologation of the ministry audio library on a real
// Android device against the LOCAL simulators only.
//
// Backend + synthetic data: `backend/scripts/m22-e1-local-server.ts` (Firebase
// Auth/Firestore EMULATORS + signed-object simulator, projectId `demo-*`).
// The app talks to it through `adb reverse`, so signed URLs keep their original
// 127.0.0.1 origin and `If-Match` header. Firebase is a NAMED app with fake
// `demo-*` options pointed at the Auth Emulator; the flavor used (cifraProbe)
// strips FirebaseInitProvider/Messaging, so no real Firebase project is reachable.
//
// Every step prints `E1_STEP <n> <PASS|FAIL> <name>`; nothing here is a mock of
// the unit under test: real providers, router, screens, Dio transport, cache,
// MethodChannel and native audio engine.
import 'dart:async';

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

// M22-D-E2: `--dart-define=E1_R2=true` runs the SAME 16 steps against the private
// development R2 bucket (`backend/scripts/m22-e2-r2-server.ts`). The tablet then
// downloads straight from R2, so the backend `objectGets` counter is meaningless
// and the instrumented client transport (test-only probe) is the evidence instead.
const _r2 = bool.fromEnvironment('E1_R2');
const _stemSha = String.fromEnvironment('E1_STEM_SHA');
const _stemBytes = 44 + 32000 * 4;

const _backendPort = int.fromEnvironment('E1_BACKEND_PORT', defaultValue: 3107);
const _authPort = int.fromEnvironment('E1_AUTH_PORT', defaultValue: 9098);
const _firestorePort = int.fromEnvironment('E1_FIRESTORE_PORT', defaultValue: 8186);
const _memberEmail = String.fromEnvironment('E1_MEMBER_EMAIL');
const _adminEmail = String.fromEnvironment('E1_ADMIN_EMAIL');
const _password = String.fromEnvironment('E1_PASSWORD');
const _ministryA = String.fromEnvironment('E1_MIN_A');
const _ministryB = String.fromEnvironment('E1_MIN_B');
const _recordingA = String.fromEnvironment('E1_REC_A');
const _recordingB = String.fromEnvironment('E1_REC_B');
const _projectId = 'demo-louvaio';

final _control = Dio(BaseOptions(
  connectTimeout: const Duration(seconds: 5),
  receiveTimeout: const Duration(seconds: 20),
  validateStatus: (_) => true,
));

Future<Map<String, dynamic>> _stats() async {
  final r = await _control.get<Map<String, dynamic>>(
      'http://127.0.0.1:${_backendPort + 1}/');
  return r.data!;
}

Future<String> _adminIdToken() async {
  final r = await _control.post<Map<String, dynamic>>(
    'http://127.0.0.1:$_authPort/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
    queryParameters: {'key': 'fake-local-key'},
    data: {'email': _adminEmail, 'password': _password, 'returnSecureToken': true},
  );
  return r.data!['idToken'] as String;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('M22-E1 ministry audio library, cache and mixer on device',
      (tester) async {
    expect(_memberEmail.isNotEmpty && _ministryA.isNotEmpty && _recordingA.isNotEmpty,
        isTrue, reason: 'E1_* dart-defines are required');

    final app = await Firebase.initializeApp(
      name: 'm22-e1-local',
      options: const FirebaseOptions(
        apiKey: 'local-only-emulator-key',
        appId: '1:123456789:android:0123456789abcdef',
        messagingSenderId: '123456789',
        projectId: _projectId,
      ),
    );
    final firebaseAuth = FirebaseAuth.instanceFor(app: app);
    await firebaseAuth.useAuthEmulator('127.0.0.1', _authPort,
        automaticHostMapping: false);
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

    // Evidence of every playback transition (phase:error-code), printed on failure.
    final phaseLog = <String>[];
    container.listen<MinistryAudioPlaybackState>(
      ministryAudioPlaybackControllerProvider,
      (previous, next) {
        if (previous?.phase != next.phase || previous?.errorCode != next.errorCode) {
          phaseLog.add('${next.phase.name}:${next.errorCode ?? '-'}');
        }
      },
    );

    var failures = 0;
    var n = 0;
    Future<void> step(String name, Future<void> Function() body) async {
      n++;
      try {
        await body();
        // ignore: avoid_print
        print('E1_STEP $n PASS $name');
      } catch (error) {
        failures++;
        // ignore: avoid_print
        print('E1_STEP $n FAIL $name :: ${error.runtimeType} ${error.toString().split('\n').first}');
        final lib = container.read(ministryAudioLibraryControllerProvider);
        // ignore: avoid_print
        print('E1_DIAG step=$n route=${container.read(routerProvider).routerDelegate.currentConfiguration.uri} '
            'phase=${container.read(ministryAudioPlaybackControllerProvider).phase} libItems=${lib.items.length} libLoading=${lib.isLoading} libErr=${lib.errorMessage != null} '
            'mixerTitle=${find.byKey(const ValueKey('mixer_title')).evaluate().length} '
            'libList=${find.byKey(const ValueKey('audio_library_list')).evaluate().length} '
            'textA=${find.text('Gravação Sintética A').evaluate().length} '
            'textAoffstage=${find.text('Gravação Sintética A', skipOffstage: false).evaluate().length} '
            'login=${find.text('Entrar').evaluate().length} '
            'phases=${phaseLog.length > 14 ? phaseLog.sublist(phaseLog.length - 14) : phaseLog}');
      }
    }

    Future<void> until(String what, bool Function() cond,
        {Duration timeout = const Duration(seconds: 45)}) async {
      final end = DateTime.now().add(timeout);
      while (!cond()) {
        if (DateTime.now().isAfter(end)) throw StateError('timeout waiting for $what');
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    MinistryAudioPlaybackState ps() =>
        container.read(ministryAudioPlaybackControllerProvider);
    MinistryAudioPlaybackController pc() =>
        container.read(ministryAudioPlaybackControllerProvider.notifier);
    int leases() => MinistryAudioCache.debugActiveLeases;
    void snap(String label) {
      // ignore: avoid_print
      print('E1_TRACE $label route=${container.read(routerProvider).routerDelegate.currentConfiguration.uri} '
          'mixerTitle=${find.byKey(const ValueKey('mixer_title')).evaluate().length} '
          'mixerErr=${find.byKey(const ValueKey('mixer_error')).evaluate().length} '
          'libList=${find.byKey(const ValueKey('audio_library_list')).evaluate().length} '
          'phase=${ps().phase.name}');
    }
    Future<void> tapKey(String key) async {
      await tester.tap(find.byKey(ValueKey(key)));
      await tester.pump(const Duration(milliseconds: 150));
    }

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const LouvAioApp(),
    ));
    await tester.pump(const Duration(seconds: 2));

    // ------------------------------------------------------------------ 1-2
    await step('login with the synthetic test account (Auth Emulator)', () async {
      await until('login form', () => find.text('Entrar').evaluate().isNotEmpty);
      await tester.enterText(find.widgetWithText(TextFormField, 'E-mail'), _memberEmail);
      await tester.enterText(find.widgetWithText(TextFormField, 'Senha'), _password);
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Entrar').first);
      await until('authenticated',
          () => container.read(authNotifierProvider).isAuthenticated);
    });

    await step('ministry selection', () async {
      await until('ministry list',
          () => find.text('Ministério E1 A').evaluate().isNotEmpty);
      await tester.tap(find.text('Ministério E1 A'));
      await until('ministry ready', () {
        final s = container.read(ministryContextNotifierProvider);
        return s.isReady && s.selectedMinistry?.id == _ministryA;
      });
    });

    // ------------------------------------------------------------------ 3-4
    await step('open the Audio Library from Repertorio and list the recording', () async {
      await until('shell', () => find.text('Repertório').evaluate().isNotEmpty);
      await tester.tap(find.text('Repertório'));
      await tester.pump(const Duration(milliseconds: 500));
      await until('library entry',
          () => find.byKey(const ValueKey('open_ministry_audio_library')).evaluate().isNotEmpty);
      await tapKey('open_ministry_audio_library');
      await until('recording listed',
          () => find.byKey(const ValueKey('audio_recording_$_recordingA')).evaluate().isNotEmpty);
      expect(find.text('Gravação Sintética A'), findsOneWidget);
      expect(find.text('Ministério: Ministério E1 A'), findsOneWidget);
      expect(find.text('Gravação Sintética B'), findsNothing);
    });

    // ------------------------------------------------------------------ 5-8
    late Map<String, dynamic> before;
    var coldFrom = 0;
    await step('mixer opens: download of six WAVs, cache, native engine READY', () async {
      before = await _stats();
      coldFrom = probe.started;
      await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
      await until('mixer ready',
          () => ps().phase == MinistryAudioPlaybackPhase.ready,
          timeout: const Duration(seconds: 90));
      final after = await _stats();
      if (_r2) {
        // Direct-from-R2 evidence comes from the client transport, never from the backend.
        final problems = probe.verifyColdDownload(
          from: coldFrom,
          expectedBytes: _stemBytes,
          expectedSha: R2TransportProbe.parseExpectedSha(_stemSha),
        );
        // ignore: avoid_print
        print('E2R2_COLD ${probe.summary()} problems=$problems');
        expect(problems, isEmpty, reason: 'six direct HTTPS downloads from R2');
      } else {
        expect((after['objectGets'] as int) - (before['objectGets'] as int), 6,
            reason: 'exactly six signed stem downloads');
      }
      expect(leases(), 1, reason: 'the open session holds the cache lease');
      expect(ps().recordingId, _recordingA);
      expect(ps().sessionId, isNotNull);
      expect(ps().sampleRate, 8000);
      expect(ps().durationFrames, greaterThan(0));
    });

    await step('six channels in order on screen', () async {
      final tops = [
        for (final s in ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'])
          tester.getTopLeft(find.byKey(ValueKey('channel_$s'))),
      ];
      for (var i = 1; i < tops.length; i++) {
        expect(tops[i].dy > tops[i - 1].dy || tops[i].dx > tops[i - 1].dx, isTrue);
      }
    });

    late int tPlayStart;
    await step('play: native clock advances in step with wall time', () async {
      await tapKey('mixer_play');
      await until('playing', () => ps().phase == MinistryAudioPlaybackPhase.playing);
      tPlayStart = DateTime.now().millisecondsSinceEpoch;
      final p0 = ps().positionFrames;
      await until('position moves', () => ps().positionFrames > p0 + 2000);
      await tester.pump(const Duration(seconds: 1));
      final elapsedMs = DateTime.now().millisecondsSinceEpoch - tPlayStart;
      final advanced = ps().positionFrames - p0;
      final expected = elapsedMs * ps().sampleRate / 1000;
      // ignore: avoid_print
      print('E1_METRIC playback advanced=$advanced expected=${expected.round()} frames');
      expect(advanced, inInclusiveRange(expected * 0.6, expected * 1.4));
    });

    await step('gain, mute, solo, master reach the native engine', () async {
      await tapKey('mute_drums');
      await tapKey('solo_piano');
      await tester.drag(find.byKey(const ValueKey('gain_bass')), const Offset(-80, 0));
      await tester.drag(find.byKey(const ValueKey('mixer_master')), const Offset(-60, 0));
      await tester.pump(const Duration(milliseconds: 1500)); // >2 native snapshots
      expect(ps().muted[1], isTrue);
      expect(ps().solo[4], isTrue);
      expect(ps().gains[2], lessThan(1));
      expect(ps().master, lessThan(1));
      expect(ps().phase, MinistryAudioPlaybackPhase.playing);
    });

    await step('pause freezes, resume continues, seek jumps, stop resets', () async {
      await tapKey('mixer_pause');
      await until('paused', () => ps().phase == MinistryAudioPlaybackPhase.paused);
      final frozen = ps().positionFrames;
      await tester.pump(const Duration(seconds: 1));
      expect((ps().positionFrames - frozen).abs(), lessThan(400));
      await tapKey('mixer_resume');
      await until('playing again', () => ps().phase == MinistryAudioPlaybackPhase.playing);
      await pc().seek((ps().durationFrames * 0.6).round());
      await tester.pump(const Duration(milliseconds: 700));
      expect(ps().positionFrames, greaterThan((ps().durationFrames * 0.55).round()));
      await tapKey('mixer_stop');
      await until('stopped', () => ps().phase != MinistryAudioPlaybackPhase.playing &&
          ps().phase != MinistryAudioPlaybackPhase.paused);
      expect(ps().positionFrames, lessThan(2000));
    });

    // ------------------------------------------------------------------ 9-10
    await step('leaving the mixer closes the native session and releases the lease', () async {
      container.read(routerProvider).pop();
      await until('lease released', () => leases() == 0, timeout: const Duration(seconds: 15));
      expect(ps().phase, MinistryAudioPlaybackPhase.idle);
    });

    await step('reopen uses the cache after ONLINE revalidation (no new stem download)', () async {
      final s0 = await _stats();
      final directBefore = probe.started;
      await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
      await until('ready again',
          () => ps().phase == MinistryAudioPlaybackPhase.ready,
          timeout: const Duration(seconds: 60));
      final s1 = await _stats();
      expect((s1['playbackGets'] as int) - (s0['playbackGets'] as int), 1,
          reason: 'online revalidation of the playback grant');
      if (_r2) {
        expect(probe.started - directBefore, 0,
            reason: 'no direct R2 download on reopen: six verified stems come from the private cache');
        // ignore: avoid_print
        print('E2R2_REOPEN ${probe.summary()}');
      } else {
        expect((s1['objectGets'] as int) - (s0['objectGets'] as int), 0,
            reason: 'six verified stems served from the private cache');
      }
    });

    // ------------------------------------------------------------------ 11
    await step('logout during playback stops audio, releases the lease and hides data', () async {
      await tapKey('mixer_play');
      await until('playing', () => ps().phase == MinistryAudioPlaybackPhase.playing);
      await container.read(authNotifierProvider.notifier).logout();
      await until('audio stopped', () =>
          ps().phase != MinistryAudioPlaybackPhase.playing, timeout: const Duration(seconds: 15));
      await until('lease released', () => leases() == 0, timeout: const Duration(seconds: 15));
      await until('login screen', () => find.text('Entrar').evaluate().isNotEmpty);
      // The mixer page may still be animating out; it must be gone shortly after.
      await until('mixer unmounted',
          () => find.byKey(const ValueKey('mixer_title')).evaluate().isEmpty,
          timeout: const Duration(seconds: 5));
      expect(find.text('Gravação Sintética A'), findsNothing);
      expect(ps().recordingId, isNull);
    });

    // ------------------------------------------------------------------ 12
    await step('login again, open A, switch ministry during playback', () async {
      await tester.enterText(find.widgetWithText(TextFormField, 'E-mail'), _memberEmail);
      await tester.enterText(find.widgetWithText(TextFormField, 'Senha'), _password);
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Entrar').first);
      await until('ministry list',
          () => find.text('Ministério E1 A').evaluate().isNotEmpty);
      await tester.tap(find.text('Ministério E1 A'));
      await until('ministry ready',
          () => container.read(ministryContextNotifierProvider).isReady);
      container.read(routerProvider).go('/');
      await tester.pump(const Duration(milliseconds: 500));
      container.read(routerProvider).push('/ministry-audio');
      await until('recording listed',
          () => find.byKey(const ValueKey('audio_recording_$_recordingA')).evaluate().isNotEmpty);
      await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
      await until('ready', () => ps().phase == MinistryAudioPlaybackPhase.ready,
          timeout: const Duration(seconds: 60));
      await tapKey('mixer_play');
      await until('playing', () => ps().phase == MinistryAudioPlaybackPhase.playing);

      final b = container
          .read(ministryContextNotifierProvider)
          .availableMinistries
          .firstWhere((m) => m.id == _ministryB);
      unawaited(container.read(ministryContextNotifierProvider.notifier).selectMinistry(b));
      await tester.pump(const Duration(milliseconds: 50));
      await until('audio stopped on generation bump', () =>
          ps().phase != MinistryAudioPlaybackPhase.playing, timeout: const Duration(seconds: 10));
      await until('lease released', () => leases() == 0, timeout: const Duration(seconds: 15));
      await until('B selected', () =>
          container.read(ministryContextNotifierProvider).selectedMinistry?.id == _ministryB);
      expect(find.byKey(const ValueKey('mixer_error')), findsOneWidget,
          reason: 'the mixer must not keep showing the old recording');
    });

    await step('library of ministry B shows only B (no data of A)', () async {
      snap('13-before-pop');
      container.read(routerProvider).pop();
      snap('13-after-pop');
      await until('B library', () =>
          find.byKey(const ValueKey('audio_recording_$_recordingB')).evaluate().isNotEmpty,
          timeout: const Duration(seconds: 20));
      expect(find.byKey(const ValueKey('audio_recording_$_recordingA')), findsNothing);
      expect(find.text('Ministério: Ministério E1 B'), findsOneWidget);
    });

    // ------------------------------------------------------------------ 13
    await step('archived recording: mixer fails with a clear error, library drops it', () async {
      // Back to A, keep a stale list, then archive as admin (host API).
      final a = container
          .read(ministryContextNotifierProvider)
          .availableMinistries
          .firstWhere((m) => m.id == _ministryA);
      snap('14-before-select-A');
      await container.read(ministryContextNotifierProvider.notifier).selectMinistry(a);
      snap('14-after-select-A');
      await until('A library', () =>
          find.byKey(const ValueKey('audio_recording_$_recordingA')).evaluate().isNotEmpty,
          timeout: const Duration(seconds: 20));
      final admin = await _adminIdToken();
      final archived = await _control.post<dynamic>(
        'http://127.0.0.1:$_backendPort/api/v1/ministries/$_ministryA/audio-library/$_recordingA/archive',
        options: Options(headers: {'authorization': 'Bearer $admin'}),
      );
      expect(archived.statusCode, inInclusiveRange(200, 299));
      snap('14-before-tap-A');
      await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
      await tester.pump(const Duration(milliseconds: 300));
      snap('14-after-tap-A');
      await until('error shown', () =>
          find.byKey(const ValueKey('mixer_error')).evaluate().isNotEmpty,
          timeout: const Duration(seconds: 30));
      expect(ps().phase, MinistryAudioPlaybackPhase.error);
      expect(leases(), 0);
      container.read(routerProvider).pop();
      await until('mixer unmounted after pop',
          () => find.byKey(const ValueKey('mixer_title')).evaluate().isEmpty,
          timeout: const Duration(seconds: 5));
      await until('refresh button tappable',
          () => find.byKey(const ValueKey('audio_library_refresh')).hitTestable().evaluate().isNotEmpty,
          timeout: const Duration(seconds: 5));
      snap('14-after-pop-error');
      // ignore: avoid_print
      print('E1_TRACE refreshBtn=${find.byKey(const ValueKey('audio_library_refresh')).hitTestable().evaluate().length}');
      await tester.tap(find.byKey(const ValueKey('audio_library_refresh')));
      await tester.pump(const Duration(milliseconds: 300));
      snap('14-after-refresh-tap');
      await until('A gone', () =>
          find.byKey(const ValueKey('audio_recording_$_recordingA')).evaluate().isEmpty,
          timeout: const Duration(seconds: 20));
    });

    await step('loss of authorization (membership revoked) blocks the library', () async {
      final b = container
          .read(ministryContextNotifierProvider)
          .availableMinistries
          .firstWhere((m) => m.id == _ministryB);
      await container.read(ministryContextNotifierProvider.notifier).selectMinistry(b);
      await until('B library', () =>
          find.byKey(const ValueKey('audio_recording_$_recordingB')).evaluate().isNotEmpty,
          timeout: const Duration(seconds: 20));
      final uid = firebaseAuth.currentUser!.uid;
      final revoked = await _control.patch<dynamic>(
        'http://127.0.0.1:$_firestorePort/v1/projects/$_projectId/databases/(default)/documents/ministry_members/${_ministryB}_$uid',
        queryParameters: {'updateMask.fieldPaths': 'status'},
        data: {'fields': {'status': {'stringValue': 'removed'}}},
        options: Options(headers: {'authorization': 'Bearer owner'}),
      );
      expect(revoked.statusCode, inInclusiveRange(200, 299));
      await tester.tap(find.byKey(const ValueKey('audio_library_refresh')));
      await until('library blocked', () =>
          find.byKey(const ValueKey('audio_library_error')).evaluate().isNotEmpty ||
          find.byKey(const ValueKey('audio_recording_$_recordingB')).evaluate().isEmpty,
          timeout: const Duration(seconds: 20));
      expect(find.byKey(const ValueKey('audio_recording_$_recordingB')), findsNothing);
    });

    await step('no lease or native session left behind', () async {
      expect(leases(), 0);
      expect(ps().phase, isNot(MinistryAudioPlaybackPhase.playing));
    });

    // ignore: avoid_print
    print('E1_DONE failures=$failures steps=$n');
    if (_r2) {
      // ignore: avoid_print
      print('E2R2_FINAL ${probe.summary()}');
    }
    expect(failures, 0, reason: '$failures E1 step(s) failed; see E1_STEP lines');
  });
}
