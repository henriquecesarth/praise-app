// Debug-only entry point for real manual/ADB E2E, reusing product components.
// Requires the guarded local backend runner and actual Auth/Firestore emulators.
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/share_intent_router.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/cifraclub_capture_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_reader_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Clipboard.setData(
    const ClipboardData(
      text: 'https://www.cifraclub.com.br/projeto-sola/glorificar/',
    ),
  );
  const base = 'http://127.0.0.1:3107/api/v1';
  final firebase = await Firebase.initializeApp(
    name: 'm20-c1-emulator',
    options: const FirebaseOptions(
      apiKey: 'local-only-emulator-key',
      appId: '1:123456789:android:0123456789abcdef',
      messagingSenderId: '123456789',
      projectId: 'demo-m20-c1',
    ),
  );
  final auth = FirebaseAuth.instanceFor(app: firebase);
  await auth.useAuthEmulator('127.0.0.1', 9099, automaticHostMapping: false);
  final email = 'm20-c1-${DateTime.now().millisecondsSinceEpoch}@example.test';
  const password = 'M20c1_local_only_34!';
  await Dio().post(
    '$base/auth/signup',
    data: {'email': email, 'password': password, 'name': 'M20 C1 local'},
  );
  await auth.signInWithEmailAndPassword(email: email, password: password);
  final navigator = GlobalKey<NavigatorState>();
  final container = ProviderContainer(
    overrides: [
      cifraClubDirectImportEnabledProvider.overrideWithValue(true),
      rootNavigatorKeyProvider.overrideWithValue(navigator),
      firebaseAuthProvider.overrideWithValue(auth),
      appEnvironmentProvider.overrideWithValue(
        const AppEnvironment(env: AppEnv.development, apiBaseUrl: base),
      ),
      appLoggerProvider.overrideWithValue(const AppLogger(isDebug: false)),
      preferencesStorageProvider.overrideWithValue(
        SharedPreferencesStorage(await SharedPreferences.getInstance()),
      ),
    ],
  );
  final watch = Stopwatch()..start();
  while (!container.read(authNotifierProvider).isAuthenticated &&
      watch.elapsed.inSeconds < 20) {
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  if (!container.read(authNotifierProvider).isAuthenticated) {
    throw StateError('Local emulator auth failed');
  }
  await container
      .read(ministryContextNotifierProvider.notifier)
      .bootstrap(userId: auth.currentUser!.uid);
  runApp(
    UncontrolledProviderScope(
      container: container,
      child: _LocalFlow(container: container),
    ),
  );
}

class _LocalFlow extends StatefulWidget {
  final ProviderContainer container;
  const _LocalFlow({required this.container});
  @override
  State<_LocalFlow> createState() => _LocalFlowState();
}

class _LocalFlowState extends State<_LocalFlow> {
  late final GlobalKey<NavigatorState> navigator;
  late final ShareIntentRouter share;
  SmartChord? lastSaved;
  String? previewContent;
  String status = 'Pronto — emuladores locais';
  final results = <String, Object?>{};
  @override
  void initState() {
    super.initState();
    navigator = widget.container.read(rootNavigatorKeyProvider);
    share = widget.container.read(shareIntentRouterProvider);
    widget.container.listen(smartChordImportNotifierProvider, (previous, next) {
      final draft = next.draft;
      if (draft != null &&
          draft.content.isNotEmpty &&
          previous?.draft != draft) {
        previewContent = draft.content;
        final tabs = draft.content
            .split('\n')
            .where((s) => RegExp(r'^\s*[eBGDAE]\|').hasMatch(s))
            .length;
        debugPrint(
          'M20_C1_PREVIEW=${jsonEncode({'title': draft.title, 'artist': draft.artistName, 'key': draft.originalKey, 'tab_rows': tabs, 'manual_paste': draft.requiresManualPaste, 'content_characters': draft.content.length})}',
        );
      }
      if (next.savedChord != null &&
          previous?.savedChord?.id != next.savedChord!.id) {
        lastSaved = next.savedChord;
        debugPrint('M20_C1_EXPLICIT_SAVE=PASS');
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      share.initialize();
      debugPrint('M20_C1_LOCAL_APP_READY');
    });
  }

  Future<void> reopen() async {
    final saved = lastSaved;
    if (saved == null) return;
    final reopened = await widget.container
        .read(smartChordRepositoryProvider)
        .getSmartChordById(saved.id);
    final exact = reopened.content == previewContent;
    results['save_and_reopen'] = {
      'exact': exact,
      'title': reopened.title,
      'key': reopened.originalKey,
      'tab_rows': reopened.content
          .split('\n')
          .where((s) => RegExp(r'^\s*[eBGDAE]\|').hasMatch(s))
          .length,
    };
    debugPrint('M20_C1_REOPEN=${jsonEncode(results['save_and_reopen'])}');
    if (!exact) throw StateError('Stored musical text mismatch (redacted)');
    navigator.currentState!.push(
      MaterialPageRoute(
        builder: (_) => SmartChordReaderScreen(chordId: saved.id),
      ),
    );
  }

  @override
  void dispose() {
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: navigator,
    home: Scaffold(
      appBar: AppBar(title: const Text('M20-C1 — teste local real')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(status),
            TextButton(
              onPressed: () => navigator.currentState!.push<SmartChord>(
                MaterialPageRoute(
                  builder: (_) => const SmartChordImportScreen(),
                ),
              ),
              child: const Text('Importar Cifra'),
            ),
            TextButton(
              onPressed: reopen,
              child: const Text('Reabrir cifra salva'),
            ),
          ],
        ),
      ),
    ),
  );
}
