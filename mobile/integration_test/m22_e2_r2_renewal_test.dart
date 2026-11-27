// M22-D-E2 (private R2) — signed-URL expiry and renewal on a real device.
//
// Cold cache, real R2. The probe holds ONLY the first stem request for 130 s, longer
// than the 120 s signed-URL lifetime, so R2 itself rejects the expired signature
// (HTTP 403). The app must map that to "expired", ask the backend for fresh targets
// and finish the six downloads, verified and playable. Nothing is mocked: the hold
// is a pause BEFORE the real request; the 403 comes from Cloudflare R2.
//
// Needs `E1_R2=true` and the dart-defines of one seeded set (m22-e2-r2-server.ts).
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

import 'support/m22_r2_transport_probe.dart';

const _backendPort = int.fromEnvironment('E1_BACKEND_PORT', defaultValue: 3107);
const _authPort = int.fromEnvironment('E1_AUTH_PORT', defaultValue: 9098);
const _memberEmail = String.fromEnvironment('E1_MEMBER_EMAIL');
const _password = String.fromEnvironment('E1_PASSWORD');
const _ministryA = String.fromEnvironment('E1_MIN_A');
const _recordingA = String.fromEnvironment('E1_REC_A');
const _stemSha = String.fromEnvironment('E1_STEM_SHA');
const _stemBytes = 44 + 32000 * 4;

final _control = Dio(BaseOptions(
  connectTimeout: const Duration(seconds: 5),
  receiveTimeout: const Duration(seconds: 20),
  validateStatus: (_) => true,
));

Future<Map<String, dynamic>> _stats() async =>
    (await _control.get<Map<String, dynamic>>('http://127.0.0.1:${_backendPort + 1}/')).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('M22-E2 R2 signed URL expiry and renewal', (tester) async {
    expect(_memberEmail.isNotEmpty && _ministryA.isNotEmpty && _recordingA.isNotEmpty, isTrue,
        reason: 'E1_* dart-defines are required');
    final app = await Firebase.initializeApp(
      name: 'm22-e2-r2-renewal',
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

    final probe = R2TransportProbe(holdFirstRequest: const Duration(seconds: 130));
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

    Future<void> until(String what, bool Function() cond,
        {Duration timeout = const Duration(seconds: 45)}) async {
      final end = DateTime.now().add(timeout);
      while (!cond()) {
        if (DateTime.now().isAfter(end)) throw StateError('timeout waiting for $what');
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    MinistryAudioPlaybackState ps() => container.read(ministryAudioPlaybackControllerProvider);

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
    await tester.pump(const Duration(milliseconds: 150));
    await until('recording listed',
        () => find.byKey(const ValueKey('audio_recording_$_recordingA')).evaluate().isNotEmpty);

    final before = await _stats();
    await tester.tap(find.byKey(const ValueKey('audio_recording_$_recordingA')));
    await until('ready after renewal', () => ps().phase == MinistryAudioPlaybackPhase.ready,
        timeout: const Duration(seconds: 300));
    final after = await _stats();

    final statuses = probe.records.map((r) => r.status).toList();
    final rejected = probe.records.where((r) => r.status == 403).length;
    final ok = probe.records.where((r) => r.status == 200).toList();
    final playbackGets = (after['playbackGets'] as int) - (before['playbackGets'] as int);
    final expectedSha = R2TransportProbe.parseExpectedSha(_stemSha);
    final badSha = ok.where((r) => expectedSha[r.stem] != null && expectedSha[r.stem] != r.sha256).length;
    // ignore: avoid_print
    print('E2R2_RENEWAL statuses=$statuses expired403=$rejected ok200=${ok.length} '
        'playbackGets=$playbackGets badSha=$badSha ${probe.summary()}');

    expect(rejected, greaterThanOrEqualTo(1), reason: 'R2 must reject the expired signed URL (HTTP 403)');
    expect(playbackGets, greaterThanOrEqualTo(2), reason: 'initial grant plus at least one renewal');
    expect(ok.map((r) => r.stem).toSet().length, 6, reason: 'six distinct stems downloaded after renewal');
    expect(ok.every((r) => r.bytes == _stemBytes && r.destination == 'r2-https' && !r.hadCredentialHeader), isTrue);
    expect(badSha, 0);
    expect(ps().sampleRate, 8000);
    // ignore: avoid_print
    print('E2R2_RENEWAL_DONE failures=0');
  });
}
