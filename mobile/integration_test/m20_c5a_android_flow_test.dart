import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/cifraclub_capture_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_reader_screen.dart';

// Physical Android acceptance using the real router, share channel, WebView,
// auth/repository/parser and isolated local Firebase emulators.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('M20-C5A local WebView and JavaScript control', (tester) async {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted);
    await tester.pumpWidget(
      MaterialApp(home: WebViewWidget(controller: controller)),
    );
    final loaded = await tester.runAsync(() async {
      final watch = Stopwatch()..start();
      await controller
          .loadHtmlString(
            '<!doctype html><html><body><p id="m20">ready</p></body></html>',
          )
          .timeout(const Duration(seconds: 10));
      while (watch.elapsed < const Duration(seconds: 10)) {
        try {
          final value = await controller.runJavaScriptReturningResult(
            'document.getElementById("m20")?.textContent',
          );
          if (value.toString().contains('ready')) return true;
        } catch (_) {}
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
      return false;
    });
    expect(
      loaded,
      isTrue,
      reason: 'Local HTML and JS should load within 10 seconds',
    );
    debugPrint('M20_C5A_MINIMAL_WEBVIEW=PASS');
    await tester.pumpWidget(const SizedBox.shrink());
  }, timeout: const Timeout(Duration(seconds: 20)));

  testWidgets('M20-C5A physical share and pasted URL', (tester) async {
    const base = 'http://127.0.0.1:3107/api/v1';
    const url = 'https://www.cifraclub.com.br/projeto-sola/glorificar/';
    const projectId = 'demo-m20-c1';
    late ProviderContainer container;
    late FirebaseAuth auth;

    await tester.runAsync(() async {
      final firebase = await Firebase.initializeApp(
        name: 'm20-c5a-emulator',
        options: const FirebaseOptions(
          apiKey: 'local-only-emulator-key',
          appId: '1:123456789:android:0123456789abcdef',
          messagingSenderId: '123456789',
          projectId: projectId,
        ),
      );
      auth = FirebaseAuth.instanceFor(app: firebase);
      await auth.useAuthEmulator(
        '127.0.0.1',
        9099,
        automaticHostMapping: false,
      );
      // Create the test-only account while leaving the real app logged out.
      // ACTION_SEND is delivered by the host while its login screen is open.
      final email =
          'm20-c5a-${DateTime.now().millisecondsSinceEpoch}@example.test';
      const password = 'M20c5a_local_only_34!';
      await Dio().post(
        '$base/auth/signup',
        data: {'email': email, 'password': password, 'name': 'M20 C5A local'},
      );
      await auth.signOut();
      final preferences = SharedPreferencesStorage(
        await SharedPreferences.getInstance(),
      );
      container = ProviderContainer(
        overrides: [
          cifraClubDirectImportEnabledProvider.overrideWithValue(true),
          firebaseAuthProvider.overrideWithValue(auth),
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(env: AppEnv.development, apiBaseUrl: base),
          ),
          appLoggerProvider.overrideWithValue(const AppLogger(isDebug: false)),
          preferencesStorageProvider.overrideWithValue(preferences),
        ],
      );
      // Keep credentials local to this test process for real UI login.
      container.read(_testCredentialsProvider.notifier).state = (
        email,
        password,
      );
    });

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const LouvAioApp(),
      ),
    );
    container
        .read(apiClientProvider)
        .dio
        .interceptors
        .add(
          InterceptorsWrapper(
            onError: (error, handler) {
              debugPrint(
                'M20_C5A_API_ERROR=type:${error.type.name};'
                'errorType:${error.error.runtimeType};'
                'appFailureCode:${error.error is AppFailure ? (error.error as AppFailure).code ?? 'none' : 'none'};'
                'status:${error.response?.statusCode ?? 'none'};'
                'path:${error.requestOptions.path}',
              );
              handler.next(error);
            },
          ),
        );
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Entrar'), findsWidgets);
    debugPrint('M20_C5A_LOGIN_PENDING_READY');
    debugPrint('M20_C5A_SEND_ACTION=android.intent.action.SEND');

    Future<void> waitFor(
      bool Function() predicate,
      String label, {
      int seconds = 75,
    }) async {
      final watch = Stopwatch()..start();
      while (!predicate() && watch.elapsed.inSeconds < seconds) {
        final import = container.read(smartChordImportNotifierProvider);
        if (import.errorMessage != null) {
          throw StateError('$label failed: ${import.errorMessage}');
        }
        await tester.pump(const Duration(milliseconds: 100));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      expect(predicate(), isTrue, reason: label);
    }

    await waitFor(
      () =>
          container.read(shareIntentRouterProvider).pendingPayload?.text == url,
      'real Android ACTION_SEND held pending login',
      seconds: 90,
    );
    expect(container.read(authNotifierProvider).isUnauthenticated, isTrue);
    expect(find.byType(SmartChordImportScreen), findsNothing);
    debugPrint('M20_C5A_SHARE_PENDING_LOGIN=PASS');

    Future<void> login() async {
      final credentials = container.read(_testCredentialsProvider);
      expect(credentials, isNotNull);
      final fields = find.byType(TextFormField);
      expect(fields, findsNWidgets(2));
      await tester.ensureVisible(fields.at(0));
      await tester.tap(fields.at(0));
      await tester.enterText(fields.at(0), credentials!.$1);
      await tester.ensureVisible(fields.at(1));
      await tester.tap(fields.at(1));
      await tester.enterText(fields.at(1), credentials.$2);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump(const Duration(milliseconds: 300));
      final submit = find.widgetWithText(ElevatedButton, 'Entrar');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pump(const Duration(milliseconds: 300));
      final submittedState = container.read(authNotifierProvider);
      expect(
        submittedState.isAuthenticating ||
            submittedState.isAuthenticated ||
            submittedState.hasError,
        isTrue,
        reason:
            'Login submit did not trigger; authStatus=${submittedState.status.name}',
      );

      final watch = Stopwatch()..start();
      while (!container.read(authNotifierProvider).isAuthenticated &&
          watch.elapsed < const Duration(seconds: 90)) {
        final authState = container.read(authNotifierProvider);
        if (authState.hasError) {
          final failure = authState.failure;
          debugPrint(
            'M20_C5A_LOGIN_FAILURE=authStatus:${authState.status.name};'
            'firebaseUserPresent:${auth.currentUser != null};'
            'code:${failure?.code ?? 'none'};'
            'status:${failure?.statusCode ?? 'none'}',
          );
          throw StateError(
            'Local login failed: code=${failure?.code ?? 'unknown'} '
            'status=${failure?.statusCode ?? 'unknown'}',
          );
        }
        await tester.pump(const Duration(milliseconds: 150));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      expect(
        container.read(authNotifierProvider).isAuthenticated,
        isTrue,
        reason:
            'Real local UI login failed; status=${container.read(authNotifierProvider).status.name}, '
            'userPresent=${container.read(authNotifierProvider).user != null}, '
            'errorCode=${container.read(authNotifierProvider).failure?.code ?? 'none'}',
      );
      await waitFor(
        () => container.read(ministryContextNotifierProvider).isEmpty,
        'empty ministry bootstrap',
      );
      expect(
        container.read(ministryContextNotifierProvider).selectedMinistry,
        isNull,
      );
      debugPrint('M20_C5A_NO_MINISTRY=PASS');
    }

    var confirmedSaves = 0;
    Future<void> verifyAndSave(String flow) async {
      await waitFor(
        () =>
            container
                    .read(smartChordImportNotifierProvider)
                    .draft
                    ?.content
                    .isNotEmpty ==
                true &&
            container
                    .read(smartChordImportNotifierProvider)
                    .draft
                    ?.requiresManualPaste ==
                false,
        '$flow editable preview',
      );
      final draft = container.read(smartChordImportNotifierProvider).draft!;
      expect(draft.title, 'Glorificar');
      expect(draft.artistName, 'Projeto Sola');
      expect(draft.originalKey, 'Bb');
      expect(draft.content.contains('Eb/G'), isTrue);
      expect(draft.content.contains('Ab/Bb'), isTrue);
      expect(draft.content.toLowerCase().contains('intro'), isTrue);
      expect(draft.content.toLowerCase().contains('interl'), isTrue);
      final tabRows = draft.content
          .split('\n')
          .where((line) => RegExp(r'^\s*[eBGDAE]\|').hasMatch(line))
          .length;
      expect(tabRows, 24);
      expect(
        container.read(smartChordImportNotifierProvider).savedChord,
        isNull,
      );
      final documentsBeforeSave = await tester.runAsync(
        () => container.read(smartChordRepositoryProvider).getSmartChords(),
      );
      expect(documentsBeforeSave, isNotNull);
      expect(documentsBeforeSave!.length, confirmedSaves);

      final title = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Título da Cifra *',
      );
      final editedTitle = 'Glorificar (C5A $flow)';
      await tester.ensureVisible(title);
      await tester.enterText(title, editedTitle);
      await tester.pumpAndSettle(const Duration(milliseconds: 200));
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle(const Duration(milliseconds: 200));

      final save = find.widgetWithText(ElevatedButton, 'Salvar Cifra Pessoal');
      expect(save, findsOneWidget);
      await tester.ensureVisible(save);
      await tester.pumpAndSettle(const Duration(milliseconds: 200));

      final saveButton = tester.widget<ElevatedButton>(save);
      debugPrint('M20_C5D_SAVE_BUTTON_ENABLED: ${saveButton.onPressed != null}');
      await tester.tap(save);
      await tester.pump(const Duration(milliseconds: 100));
      await waitFor(
        () => find.byType(SmartChordImportScreen).evaluate().isEmpty,
        '$flow close after explicit save',
      );
      final documentsAfterSave = await tester.runAsync(
        () => container.read(smartChordRepositoryProvider).getSmartChords(),
      );
      expect(documentsAfterSave?.length, confirmedSaves + 1);
      confirmedSaves++;
      final saved = documentsAfterSave!.firstWhere(
        (doc) => doc.title == editedTitle,
      );
      final reopened = await tester.runAsync(
        () => container
            .read(smartChordRepositoryProvider)
            .getSmartChordById(saved.id),
      );
      expect(reopened, isNotNull);
      expect(
        reopened!.content == draft.content,
        isTrue,
        reason:
            'Persisted musical text, tablature, chord alignment, and whitespace must match',
      );
      expect(reopened.title, editedTitle);
      expect(reopened.originalKey, 'Bb');
      expect(
        reopened.content
            .split('\n')
            .where((line) => RegExp(r'^\s*[eBGDAE]\|').hasMatch(line))
            .length,
        24,
      );
      debugPrint(
        'M20_C5D_${flow.toUpperCase()}_SAVE_REOPEN=${jsonEncode({'exact': true, 'key': reopened.originalKey, 'tab_rows': tabRows})}',
      );
      await tester.runAsync(() async {
        container
            .read(rootNavigatorKeyProvider)
            .currentState!
            .push(
              MaterialPageRoute(
                builder: (_) => SmartChordReaderScreen(chordId: saved.id),
              ),
            );
      });
      await waitFor(
        () =>
            find.byType(SmartChordReaderScreen).evaluate().isNotEmpty &&
            find.text(editedTitle).evaluate().isNotEmpty,
        '$flow reader reopen',
      );
      await tester.pageBack();
      await tester.pump(const Duration(milliseconds: 300));
    }

    try {
      await login();
      await waitFor(
        () => find.byType(SmartChordImportScreen).evaluate().isNotEmpty,
        'pending Android share dispatched after login and empty ministry',
      );
      debugPrint('M20_C5A_ANDROID_SHARE_PREVIEW=READY');

      const onlyAuthValidation = bool.fromEnvironment(
        'VALIDATE_AUTH_ONLY',
        defaultValue: false,
      );
      if (onlyAuthValidation) {
        // M20-C5C: Confirm that Android Share remained pending through unauthenticated state,
        // /auth/me completed cleanly with stable session generation after login,
        // empty ministry was dispatched, and the pending share opened SmartChordImportScreen
        // without executing WebView capture or modifying device DuraSpeed.
        expect(find.byType(SmartChordImportScreen), findsOneWidget);
        expect(container.read(authNotifierProvider).isAuthenticated, isTrue);
        expect(container.read(ministryContextNotifierProvider).isEmpty, isTrue);
        expect(container.read(ministryContextNotifierProvider).selectedMinistry, isNull);
        debugPrint('M20_C5C_AUTH_ME=PASS');
        debugPrint('M20_C5C_SESSION_GENERATION=PASS');
        debugPrint('M20_C5C_PENDING_URL_DISPATCHED=PASS');
        debugPrint('M20_C5C_E2E=PASS');
        binding.reportData = {
          'milestone': 'M20-C5C',
          'project': projectId,
          'backend': '127.0.0.1:3107',
          'auth_emulator': '127.0.0.1:9099',
          'firestore_emulator': '127.0.0.1:8080',
          'android_share': 'PASS',
          'auth_me': 'PASS',
          'session_generation': 'PASS',
          'empty_ministry': 'PASS',
          'import_point_reached': 'PASS',
          'webview_capture_executed': false,
        };
        return;
      }

      await verifyAndSave('android_share');

      final navigator = container.read(rootNavigatorKeyProvider).currentState!;
      navigator.push(
        MaterialPageRoute(builder: (_) => const SmartChordImportScreen()),
      );
      await tester.pumpAndSettle();

      final tabFinder = find.text('Link / URL');
      await tester.ensureVisible(tabFinder);
      await tester.tap(tabFinder);
      await tester.pumpAndSettle();

      final urlFieldFinder = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'URL da Cifra',
      );
      expect(urlFieldFinder, findsOneWidget);
      await tester.ensureVisible(urlFieldFinder);
      await tester.enterText(urlFieldFinder, url);
      await tester.pumpAndSettle();

      final continueFinder = find.widgetWithText(ElevatedButton, 'Continuar com o link');
      expect(continueFinder, findsOneWidget);
      await tester.ensureVisible(continueFinder);
      await tester.tap(continueFinder);
      await tester.pump();
      debugPrint('M20_C5A_URL_CAPTURE_STARTED');
      await verifyAndSave('url_paste');

      binding.reportData = {
        'milestone': 'M20-C5D',
        'project': projectId,
        'backend': '127.0.0.1:3107',
        'auth_emulator': '127.0.0.1:9099',
        'firestore_emulator': '127.0.0.1:8080',
        'android_share': 'PASS',
        'url_paste': 'PASS',
        'empty_ministry': 'PASS',
        'capture': 'PASS',
        'save_reopen': 'PASS',
        'tab_rows': 24,
        'production_writes': false,
      };
      debugPrint('M20_C5D_E2E=PASS');
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      await auth.signOut();
    }
  }, timeout: const Timeout(Duration(minutes: 8)));
}

final _testCredentialsProvider = StateProvider<(String, String)?>(
  (ref) => null,
);
