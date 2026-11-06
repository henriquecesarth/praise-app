import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/cifraclub_capture_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_reader_screen.dart';

// Real Android + real public URL + real local Auth/Firestore emulators.
// No repository, auth, parser, capture or musical-content mocks/fixtures.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  testWidgets('M20-C1 real paste, native share, explicit save and reopen', (
    tester,
  ) async {
    const base = 'http://127.0.0.1:3107/api/v1';
    const url = 'https://www.cifraclub.com.br/projeto-sola/glorificar/';
    late ProviderContainer container;
    late FirebaseAuth auth;
    final navigator = GlobalKey<NavigatorState>();
    await tester.runAsync(() async {
      final firebase = await Firebase.initializeApp(
        name: 'm20-c1-emulator',
        options: const FirebaseOptions(
          apiKey: 'local-only-emulator-key',
          appId: '1:123456789:android:0123456789abcdef',
          messagingSenderId: '123456789',
          projectId: 'demo-m20-c1',
        ),
      );
      auth = FirebaseAuth.instanceFor(app: firebase);
      await auth.useAuthEmulator(
        '127.0.0.1',
        9099,
        automaticHostMapping: false,
      );
      final email =
          'm20-c1-${DateTime.now().millisecondsSinceEpoch}@example.test';
      const password = 'M20c1_local_only_34!';
      await Dio().post(
        '$base/auth/signup',
        data: {'email': email, 'password': password, 'name': 'M20 C1 local'},
      );
      await auth.signInWithEmailAndPassword(email: email, password: password);
      final preferences = SharedPreferencesStorage(
        await SharedPreferences.getInstance(),
      );
      container = ProviderContainer(
        overrides: [
          cifraClubDirectImportEnabledProvider.overrideWithValue(true),
          rootNavigatorKeyProvider.overrideWithValue(navigator),
          firebaseAuthProvider.overrideWithValue(auth),
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(env: AppEnv.development, apiBaseUrl: base),
          ),
          appLoggerProvider.overrideWithValue(const AppLogger(isDebug: false)),
          preferencesStorageProvider.overrideWithValue(preferences),
        ],
      );
      final watch = Stopwatch()..start();
      while (!container.read(authNotifierProvider).isAuthenticated &&
          watch.elapsed.inSeconds < 20) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      if (!container.read(authNotifierProvider).isAuthenticated) {
        throw StateError('Local emulator auth bootstrap failed');
      }
      await container
          .read(ministryContextNotifierProvider.notifier)
          .bootstrap(userId: auth.currentUser!.uid);
    });
    final share = container.read(shareIntentRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          navigatorKey: navigator,
          home: Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => navigator.currentState!.push<SmartChord>(
                  MaterialPageRoute(
                    builder: (_) => const SmartChordImportScreen(),
                  ),
                ),
                child: const Text('Importar Cifra'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));
    share.initialize();

    Future<void> waitFor(
      bool Function() predicate,
      String label, {
      int seconds = 65,
    }) async {
      final watch = Stopwatch()..start();
      while (!predicate() && watch.elapsed.inSeconds < seconds) {
        final current = container.read(smartChordImportNotifierProvider);
        if (current.errorMessage != null) {
          throw StateError('Import failed: ${current.errorMessage}');
        }
        await tester.pump(const Duration(milliseconds: 100));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      expect(predicate(), isTrue, reason: label);
    }

    final evidence = <String, Object?>{
      'source_url': url,
      'storage': 'real local Firestore emulator',
      'auth': 'real local Firebase Auth emulator',
    };
    Future<void> verifyAndSave(String mode) async {
      await waitFor(
        () =>
            container
                    .read(smartChordImportNotifierProvider)
                    .draft
                    ?.requiresManualPaste ==
                false &&
            container
                    .read(smartChordImportNotifierProvider)
                    .draft
                    ?.content
                    .isNotEmpty ==
                true,
        '$mode preview',
      );
      final draft = container.read(smartChordImportNotifierProvider).draft!;
      expect(draft.title, 'Glorificar');
      expect(draft.artistName, 'Projeto Sola');
      expect(draft.originalKey, 'Bb');
      expect(draft.content.contains('Eb/G'), isTrue);
      expect(draft.content.contains('Ab/Bb'), isTrue);
      expect(draft.content.toLowerCase().contains('intro'), isTrue);
      expect(draft.content.toLowerCase().contains('interl'), isTrue);
      final tabs = draft.content
          .split('\n')
          .where((line) => RegExp(r'^\s*[eBGDAE]\|').hasMatch(line))
          .toList();
      expect(tabs.length, 24);
      expect(
        container.read(smartChordImportNotifierProvider).savedChord,
        isNull,
      );
      final title = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Título da Cifra *',
      );
      await tester.ensureVisible(title);
      await tester.enterText(title, 'Glorificar (revisão)');
      await tester.enterText(title, 'Glorificar');
      final save = find.text('Salvar Cifra Pessoal');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await waitFor(
        () =>
            container.read(smartChordImportNotifierProvider).savedChord != null,
        '$mode explicit save',
      );
      final saved = container
          .read(smartChordImportNotifierProvider)
          .savedChord!;
      final reopened = await tester.runAsync(
        () => container
            .read(smartChordRepositoryProvider)
            .getSmartChordById(saved.id),
      );
      expect(
        reopened!.content == draft.content,
        isTrue,
        reason: 'Reopened content must match exactly; musical text redacted',
      );
      expect(reopened.originalKey, 'Bb');
      await waitFor(
        () => find.byType(SmartChordImportScreen).evaluate().isEmpty,
        '$mode import closes',
      );
      navigator.currentState!.push(
        MaterialPageRoute(
          builder: (_) => SmartChordReaderScreen(chordId: saved.id),
        ),
      );
      await waitFor(
        () =>
            find.byType(SmartChordReaderScreen).evaluate().isNotEmpty &&
            find.text('Glorificar').evaluate().isNotEmpty,
        '$mode reader reopened',
      );
      evidence[mode] = {
        'preview': true,
        'editable': true,
        'explicit_save': true,
        'reopened_exact': true,
        'key': 'Bb',
        'tab_rows': tabs.length,
      };
      navigator.currentState!.pop();
      await tester.pump(const Duration(milliseconds: 400));
    }

    try {
      await tester.tap(find.text('Importar Cifra'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('Link / URL'));
      await tester.pump(const Duration(milliseconds: 300));
      await Clipboard.setData(const ClipboardData(text: url));
      await tester.tap(find.text('Colar Link'));
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Continuar com o link'));
      await verifyAndSave('url_paste');
      debugPrint('M20_C1_READY_FOR_ANDROID_SHARE');
      // Host now sends a real ACTION_SEND through adb; no injected Dart payload.
      await waitFor(
        () => find.byType(SmartChordImportScreen).evaluate().isNotEmpty,
        'real Android ACTION_SEND',
        seconds: 90,
      );
      await verifyAndSave('android_share');
      evidence['verdict'] = 'PASS';
      binding.reportData = evidence;
      debugPrint('M20_C1_ANDROID_E2E=${jsonEncode(evidence)}');
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      await auth.signOut();
    }
  }, timeout: const Timeout(Duration(minutes: 6)));
}
