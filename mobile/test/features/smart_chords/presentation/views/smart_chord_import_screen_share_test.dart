import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/shared_import_payload.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/cifraclub_capture_screen.dart';

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword(
          {required String email, required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp(
          {required String name,
          required String email,
          required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<List<Ministry>> getMyMinistries() async => [];
}

class _FakePreferencesStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}
  @override
  String? getSelectedMinistryId() => null;
  @override
  String? getThemeMode() => null;
  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}
  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

class FakeAuthNotifier extends AuthNotifier {
  FakeAuthNotifier([
    AuthState initialState = const AuthState.authenticated(
      AuthUser(id: 'user-a', email: 'user.a@test.com', name: 'User A'),
    ),
  ]) : super(_FakeAuthRepo()) {
    state = initialState;
  }

  void setUser(AuthUser? user) {
    if (user != null) {
      state = AuthState.authenticated(user);
    } else {
      state = const AuthState.unauthenticated();
    }
  }
}

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier([
    MinistryContextState initialState = const MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(
        id: 'min-a',
        name: 'Ministry Alpha',
        slug: 'ministry-alpha',
        role: 'admin',
      ),
      availableMinistries: [
        Ministry(
          id: 'min-a',
          name: 'Ministry Alpha',
          slug: 'ministry-alpha',
          role: 'admin',
        ),
      ],
    ),
  ]) : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = initialState;
  }

  void setMinistry(Ministry? ministry) {
    state = state.copyWith(
      status: ministry != null
          ? MinistryBootstrapStatus.ready
          : MinistryBootstrapStatus.empty,
      selectedMinistry: ministry,
    );
  }
}

class FakeSmartChordRepository implements SmartChordRepository {
  SmartChordImportDraft? textDraftResult;
  SmartChordImportDraft? pdfDraftResult;
  int createCalls = 0;
  Completer<SmartChord>? createCompleter;
  List<int>? lastPdfBytes;
  String? lastText;
  String? lastUrl;
  String? lastMusicalHtml;
  List<int>? lastImageBytes;
  SmartChordImportDraft? urlDraftResult;
  SmartChordImportDraft? imageDraftResult;
  Map<String, dynamic>? lastCreatedPayload;

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    lastText = text;
    return textDraftResult ??
        const SmartChordImportDraft(
          title: 'Música Compartilhada',
          artistName: 'Artista Compartilhado',
          originalKey: 'G',
          content: '[G] Acorde e [D] letra',
          warnings: [],
          sourceType: 'text',
        );
  }

  @override
  Future<SmartChordImportDraft> importPdfDraft(
      List<int> bytes, String filename) async {
    lastPdfBytes = bytes;
    return pdfDraftResult ??
        const SmartChordImportDraft(
          title: 'PDF Compartilhado',
          artistName: 'Artista PDF',
          originalKey: 'D',
          content: '[D] Letra do [A] PDF',
          warnings: [],
          sourceType: 'pdf',
        );
  }

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) async {
    lastUrl = url;
    return urlDraftResult ??
        SmartChordImportDraft(
          title: 'Lugar Secreto',
          artistName: 'Gabriela Rocha',
          content: '',
          warnings: const [
            ImportWarning(
              code: 'URL_MANUAL_PASTE_REQUIRED',
              message: 'Cole o conteúdo da cifra para normalizar.',
            )
          ],
          sourceType: 'url',
          requiresManualPaste: true,
          sourceUrl: url,
        );
  }

  @override
  Future<SmartChordImportDraft> importCapturedUrlDraft(String url, String musicalHtml) {
    lastMusicalHtml = musicalHtml;
    return importUrlDraft(url);
  }

  @override
  Future<SmartChordImportDraft> importImageDraft(
    List<int> bytes,
    String filename,
  ) async {
    lastImageBytes = bytes;
    return imageDraftResult ??
        const SmartChordImportDraft(
          title: 'Cifra da Foto',
          artistName: 'Artista da Foto',
          originalKey: 'Bb',
          content: '[Bb] [Eb/G]\nUma palavra inteira',
          originalText: 'Bb Eb/G\nUma palavra inteira',
          warnings: [
            ImportWarning(
              code: 'OCR_REVIEW_REQUIRED',
              message: 'Revise o texto reconhecido.',
            ),
          ],
          sourceType: 'image',
        );
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCalls++;
    lastCreatedPayload = Map<String, dynamic>.from(payload);
    final chord = SmartChord(
      id: 'chord-new-1',
      userId: 'user-a',
      title: payload['title'] as String,
      artistName: payload['artist_name'] as String?,
      originalKey: payload['original_key'] as String? ?? 'C',
      content: payload['content'] as String,
      createdAt: '2026-10-26T12:00:00Z',
      updatedAt: '2026-10-26T12:00:00Z',
    );
    return createCompleter?.future ?? chord;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeRepertoireLinkRepository
    implements SmartChordRepertoireLinkRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late FakeAuthNotifier fakeAuth;
  late FakeMinistryContextNotifier fakeMinistry;
  late FakeSmartChordRepository fakeRepo;
  late FakeRepertoireLinkRepository fakeLinkRepo;
  late CifraClubCaptureLauncher captureLauncher;

  setUp(() {
    fakeAuth = FakeAuthNotifier();
    fakeMinistry = FakeMinistryContextNotifier();
    fakeRepo = FakeSmartChordRepository();
    fakeLinkRepo = FakeRepertoireLinkRepository();
    captureLauncher = (_, __) async => '<pre>test capture</pre>';
  });

  Widget buildTestScreen({SharedImportPayload? initialPayload, bool enableDirectImport = true}) {
    return ProviderScope(
      overrides: [
        if (enableDirectImport)
          cifraClubDirectImportEnabledProvider.overrideWithValue(true),
        cifraClubCaptureLauncherProvider.overrideWithValue(captureLauncher),
        authNotifierProvider.overrideWith((ref) => fakeAuth),
        ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
        smartChordRepositoryProvider.overrideWithValue(fakeRepo),
        smartChordRepertoireLinkRepositoryProvider
            .overrideWithValue(fakeLinkRepo),
      ],
      child: MaterialApp(
        home: SmartChordImportScreen(initialPayload: initialPayload),
      ),
    );
  }

  group('SmartChordImportScreen Share Intent Tests', () {
    testWidgets('experimental capture remains disabled by default', (tester) async {
      captureLauncher = (_, __) async => throw StateError('Unexpected native capture');
      const url = 'https://www.cifraclub.com.br/band/song/';
      await tester.pumpWidget(buildTestScreen(
        initialPayload: const SharedImportPayload.text(url),
        enableDirectImport: false,
      ));
      await tester.pumpAndSettle();
      expect(fakeRepo.lastUrl, url);
      expect(fakeRepo.lastMusicalHtml, isNull);
      expect(fakeRepo.createCalls, 0);
    });
    for (final mode in ['url entry', 'shared URL']) {
      testWidgets('$mode uses captured HTML and opens editable preview without auto-save', (tester) async {
        const url = 'https://www.cifraclub.com.br/band/song/';
        const html = '<h1 class="t1">Capture fixture</h1><div class="cifra_cnt"><pre>C\nFixture</pre></div>';
        String? launchedUrl;
        captureLauncher = (_, value) async { launchedUrl = value; return html; };
        fakeRepo.urlDraftResult = const SmartChordImportDraft(title: 'Captured title', originalKey: 'C',
          content: '[C]Fixture', warnings: [], sourceType: 'url');
        await tester.pumpWidget(buildTestScreen(initialPayload: mode == 'shared URL' ? const SharedImportPayload.text(url) : null));
        await tester.pumpAndSettle();
        if (mode == 'url entry') {
          await tester.tap(find.text('Link / URL')); await tester.pumpAndSettle();
          final field = find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == 'URL da Cifra');
          await tester.enterText(field, url);
          await tester.tap(find.text('Continuar com o link')); await tester.pumpAndSettle();
        }
        expect(launchedUrl, url); expect(fakeRepo.lastUrl, url); expect(fakeRepo.lastMusicalHtml, html);
        expect(find.text('Captured title'), findsOneWidget);
        expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);
        expect(fakeRepo.createCalls, 0);
        expect(find.text('Normalizar texto e continuar'), findsNothing);
      });
    }
    testWidgets('renderer failure retains shared URL and explicit retry opens preview without saving', (tester) async {
      const url = 'https://www.cifraclub.com.br/band/song/';
      var attempts = 0;
      captureLauncher = (_, value) async {
        expect(value, url);
        attempts++;
        if (attempts == 1) {
          throw const AppFailure(
            message: 'O componente de importação não respondeu. Tente novamente.',
            code: 'CIFRACLUB_RENDERER_UNAVAILABLE',
          );
        }
        return '<pre>recovered capture</pre>';
      };
      await tester.pumpWidget(buildTestScreen(
        initialPayload: const SharedImportPayload.text(url),
      ));
      await tester.pumpAndSettle();

      expect(find.text('O componente de importação não respondeu. Tente novamente.'), findsOneWidget);
      final urlField = find.byWidgetPredicate((w) =>
          w is TextField && w.decoration?.labelText == 'URL da Cifra');
      expect(tester.widget<TextField>(urlField).controller!.text, url);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(fakeRepo.lastMusicalHtml, isNull);
      expect(fakeRepo.createCalls, 0);
      expect(attempts, 1);

      await tester.tap(find.text('Continuar com o link'));
      await tester.pumpAndSettle();

      expect(attempts, 2);
      expect(fakeRepo.lastMusicalHtml, '<pre>recovered capture</pre>');
      expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);
      expect(find.text('O componente de importação não respondeu. Tente novamente.'), findsNothing);
      expect(fakeRepo.createCalls, 0);
    });
    testWidgets('capture cancellation keeps hub and skips API/save', (tester) async {
      captureLauncher = (_, __) async => null;
      await tester.pumpWidget(buildTestScreen(initialPayload: const SharedImportPayload.text('https://www.cifraclub.com.br/band/song/')));
      await tester.pumpAndSettle();
      expect(find.byType(SmartChordImportScreen), findsOneWidget);
      expect(fakeRepo.lastMusicalHtml, isNull); expect(fakeRepo.createCalls, 0);
      expect(find.text('Salvar Cifra Pessoal'), findsNothing);
    });
    testWidgets(
        'shared plain text preloads text and auto-extracts preview draft',
        (tester) async {
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload:
              const SharedImportPayload.text('G D Em C\nGraças Te dou'),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      // Verify text extraction was automatically triggered
      expect(fakeRepo.lastText, contains('G D Em C'));
      // Verify preview editor is rendered with draft fields
      expect(find.text('Música Compartilhada'), findsOneWidget);
      expect(find.text('Artista Compartilhado'), findsOneWidget);
      expect(find.text('Título da Cifra *'), findsOneWidget);
      expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);
      // Zero persistence before explicit save
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets(
        'shared digital PDF preloads bytes and auto-extracts preview draft',
        (tester) async {
      final samplePdf =
          Uint8List.fromList([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: SharedImportPayload.pdf(
            pdfBytes: samplePdf,
            pdfFileName: 'avulso.pdf',
          ),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      expect(fakeRepo.lastPdfBytes, equals(samplePdf));
      expect(find.text('PDF Compartilhado'), findsOneWidget);
      expect(find.text('Artista PDF'), findsOneWidget);
      expect(find.text('Título da Cifra *'), findsOneWidget);
      expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets(
        'shared oversized PDF (> 3 MB) shows error without auto-extracting',
        (tester) async {
      final oversizedBytes = Uint8List(3 * 1024 * 1024 + 10);
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: SharedImportPayload.pdf(
            pdfBytes: oversizedBytes,
            pdfFileName: 'grande.pdf',
          ),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      // No extraction call
      expect(fakeRepo.lastPdfBytes, isNull);
      // Error message displayed
      expect(find.text('Arquivo PDF excede o limite máximo permitido de 3 MB.'),
          findsOneWidget);
      expect(find.text('Salvar Cifra Pessoal'), findsNothing);
    });

    testWidgets('shared payload error shows error message in UI',
        (tester) async {
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: const SharedImportPayload.error(
            error: 'FILE_UNAVAILABLE',
            errorMessage: 'Não foi possível ler o arquivo compartilhado.',
          ),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('Não foi possível ler o arquivo compartilhado.'),
          findsWidgets);
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets('cancellation pops without saving to database', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authNotifierProvider.overrideWith((ref) => fakeAuth),
            ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
            smartChordRepositoryProvider.overrideWithValue(fakeRepo),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(fakeLinkRepo),
          ],
          child: MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: ElevatedButton(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const SmartChordImportScreen(
                          initialPayload: SharedImportPayload.text('A B C'),
                        ),
                      ),
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byType(SmartChordImportScreen), findsOneWidget);
      expect(fakeRepo.createCalls, 0);

      // Tap back / cancel button
      final backButton = find.byType(BackButton);
      if (backButton.evaluate().isNotEmpty) {
        await tester.tap(backButton);
      } else {
        Navigator.of(tester.element(find.byType(SmartChordImportScreen))).pop();
      }
      await tester.pumpAndSettle();

      expect(find.byType(SmartChordImportScreen), findsNothing);
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets('user logout during import discards context safely',
        (tester) async {
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: const SharedImportPayload.text('G D Em C'),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.byType(SmartChordImportScreen), findsOneWidget);

      // Simulate user logout
      fakeAuth.setUser(null);
      await tester.pumpAndSettle();

      // State is safely cleared without writes
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets(
        'regression: standard empty import screen without initialPayload works as expected',
        (tester) async {
      await tester.pumpWidget(buildTestScreen(initialPayload: null));
      await tester.pumpAndSettle();

      // Verify normal tabs and empty fields are present
      expect(find.text('Documento PDF'), findsOneWidget);
      expect(find.text('Colar Texto'), findsOneWidget);
      expect(find.text('Analisar e Pré-visualizar PDF'), findsOneWidget);
      expect(fakeRepo.lastText, isNull);
      expect(fakeRepo.lastPdfBytes, isNull);
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets('shared URL auto-detects and triggers URL extraction preview',
        (tester) async {
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: const SharedImportPayload.text(
              'https://www.cifraclub.com.br/gabriela-rocha/lugar-secreto/'),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUrl,
          'https://www.cifraclub.com.br/gabriela-rocha/lugar-secreto/');
      expect(find.text('Lugar Secreto'), findsOneWidget);
      expect(find.text('Gabriela Rocha'), findsOneWidget);
      expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);
    });

    testWidgets(
      'shared Image auto-detects and triggers Image extraction preview',
      (tester) async {
        final imageBytes = Uint8List.fromList([
          0x89,
          0x50,
          0x4E,
          0x47,
          0x0D,
          0x0A,
          0x1A,
          0x0A,
        ]);
        await tester.pumpWidget(
          buildTestScreen(
            initialPayload: SharedImportPayload.image(
              imageBytes: imageBytes,
              imageFileName: 'foto_partitura.png',
            ),
          ),
        );
        await tester.pump();
        await tester.pumpAndSettle();

        expect(fakeRepo.lastImageBytes, imageBytes);
        expect(find.text('Cifra da Foto'), findsOneWidget);
        expect(
          find.textContaining('Revise o texto reconhecido'),
          findsOneWidget,
        );
        expect(find.text('Texto original para conferência'), findsOneWidget);
        expect(find.text('[Bb] [Eb/G]\nUma palavra inteira'), findsOneWidget);
        expect(
          tester
              .widget<ElevatedButton>(
                find.widgetWithText(ElevatedButton, 'Salvar Cifra Pessoal'),
              )
              .onPressed,
          isNotNull,
        );
        expect(fakeRepo.createCalls, 0);
      },
    );

    testWidgets(
        'URL import requiring manual paste displays assisted extraction banner',
        (tester) async {
      fakeRepo.urlDraftResult = const SmartChordImportDraft(
        title: 'Restricted Song',
        artistName: 'Famous Artist',
        originalKey: 'C',
        content: '',
        warnings: [],
        sourceType: 'url',
        requiresManualPaste: true,
      );

      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: const SharedImportPayload.text(
              'https://www.cifraclub.com.br/restricted/'),
        ),
      );
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('Restricted Song'), findsOneWidget);
      expect(find.text('Famous Artist'), findsOneWidget);
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Salvar Cifra Pessoal'),
            )
            .onPressed,
        isNull,
      );
      expect(fakeRepo.createCalls, 0);
      expect(find.textContaining('Abra a origem e copie a cifra'),
          findsOneWidget);
      expect(find.text('Normalizar texto e continuar'), findsOneWidget);
    });

    testWidgets(
        'URL metadata survives pasted text normalization and explicit save',
        (tester) async {
      fakeRepo.urlDraftResult = const SmartChordImportDraft(
        title: 'Metadata title',
        artistName: 'Metadata artist',
        content: '',
        warnings: [
          ImportWarning(
              code: 'URL_MANUAL_PASTE_REQUIRED', message: 'Paste required')
        ],
        sourceType: 'url',
        requiresManualPaste: true,
        sourceUrl: 'https://www.cifraclub.com.br/artist/song/',
      );

      await tester.pumpWidget(buildTestScreen(
        initialPayload: const SharedImportPayload.text(
            'https://www.cifraclub.com.br/artist/song/'),
      ));
      await tester.pump();
      await tester.pumpAndSettle();

      final titleField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Título da Cifra *',
      );
      final artistField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Artista / Banda',
      );
      await tester.enterText(titleField, 'Edited title');
      await tester.enterText(artistField, 'Edited artist');
      final keyField = find.byType(DropdownButton<String>);
      await tester.ensureVisible(keyField);
      tester.widget<DropdownButton<String>>(keyField).onChanged?.call('A');
      await tester.pump();

      final pasteField = find.byWidgetPredicate((widget) =>
          widget is TextField &&
          widget.decoration?.hintText?.startsWith('Cole a cifra copiada') ==
              true);
      await tester.enterText(pasteField, 'G D\nAleluia');
      final normalizeButton = find.text('Normalizar texto e continuar');
      await tester.ensureVisible(normalizeButton);
      await tester.tap(normalizeButton);
      await tester.pumpAndSettle();

      expect(fakeRepo.lastText, 'G D\nAleluia');
      expect(find.text('Edited title'), findsOneWidget);
      expect(find.text('Edited artist'), findsOneWidget);
      expect(
        find.textContaining('Fonte: https://www.cifraclub.com.br/artist/song/'),
        findsOneWidget,
      );
      expect(fakeRepo.createCalls, 0);

      final saveButton =
          find.widgetWithText(ElevatedButton, 'Salvar Cifra Pessoal');
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();
      expect(fakeRepo.lastCreatedPayload?['title'], 'Edited title');
      expect(fakeRepo.lastCreatedPayload?['artist_name'], 'Edited artist');
      expect(fakeRepo.lastCreatedPayload?['original_key'], 'A');
      expect(fakeRepo.lastCreatedPayload?['content'], '[G] Acorde e [D] letra');
      expect(fakeRepo.lastCreatedPayload?['source_url'], 'https://www.cifraclub.com.br/artist/song/');
    });

    testWidgets('late clipboard response does not replace newer URL input',
        (tester) async {
      final clipboard = Completer<Object?>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.getData') return clipboard.future;
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));

      await tester.pumpWidget(buildTestScreen());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Link / URL'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Colar Link'));
      await tester.pump();

      final urlField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'URL da Cifra',
      );
      await tester.enterText(urlField, 'https://edited.example/song');
      clipboard.complete({'text': 'https://clipboard.example/song'});
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(urlField).controller!.text,
          'https://edited.example/song');
    });

    testWidgets('late clipboard response does not replace newer plain text',
        (tester) async {
      final clipboard = Completer<Object?>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.getData') return clipboard.future;
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));

      await tester.pumpWidget(buildTestScreen());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Colar Texto'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Colar'));
      await tester.pump();

      final textField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.hintText?.startsWith('G ') == true,
      );
      await tester.enterText(textField, 'D A\nManual text');
      clipboard.complete({'text': 'G C\nClipboard text'});
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(textField).controller!.text,
          'D A\nManual text');
    });

    testWidgets(
        'late clipboard response does not replace newer manual transcription',
        (tester) async {
      final clipboard = Completer<Object?>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.getData') return clipboard.future;
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));

      fakeRepo.urlDraftResult = const SmartChordImportDraft(
        title: 'Clipboard race',
        content: '',
        warnings: [],
        sourceType: 'url',
        requiresManualPaste: true,
      );
      await tester.pumpWidget(buildTestScreen(
        initialPayload: const SharedImportPayload.text(
            'https://www.cifraclub.com.br/song/'),
      ));
      await tester.pump();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Colar'));
      await tester.pump();

      final pasteField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.hintText?.startsWith('Cole a cifra copiada') ==
                true,
      );
      await tester.enterText(pasteField, 'E B\nManual transcription');
      clipboard.complete({'text': 'G C\nClipboard transcription'});
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(pasteField).controller!.text,
          'E B\nManual transcription');
    });

    testWidgets('fields and workflow stay locked while save is pending',
        (tester) async {
      fakeRepo.createCompleter = Completer<SmartChord>();
      await tester.pumpWidget(buildTestScreen(
        initialPayload: const SharedImportPayload.text('G D\nAleluia'),
      ));
      await tester.pump();
      await tester.pumpAndSettle();
      final saveButton =
          find.widgetWithText(ElevatedButton, 'Salvar Cifra Pessoal');
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pump();

      expect(fakeRepo.createCalls, 1);
      expect(
          tester
              .widget<TextField>(find.byWidgetPredicate((widget) =>
                  widget is TextField &&
                  widget.decoration?.labelText == 'T\u00edtulo da Cifra *'))
              .enabled,
          isFalse);
      expect(
          tester
              .widget<OutlinedButton>(
                  find.widgetWithText(OutlinedButton, 'Voltar / Novo'))
              .onPressed,
          isNull);
      expect(fakeRepo.createCalls, 1);

      final payload = fakeRepo.lastCreatedPayload!;
      fakeRepo.createCompleter!.complete(SmartChord(
        id: 'chord-pending',
        userId: 'user-a',
        title: payload['title'] as String,
        artistName: payload['artist_name'] as String?,
        originalKey: payload['original_key'] as String? ?? 'C',
        content: payload['content'] as String,
        createdAt: '2026-10-26T12:00:00Z',
        updatedAt: '2026-10-26T12:00:00Z',
      ));
      await tester.pumpAndSettle();
      expect(fakeRepo.createCalls, 1);
      expect(find.text('Cifra Salva!'), findsOneWidget);
      await tester.tap(find.text('Agora não'));
      await tester.pumpAndSettle();
      expect(find.byType(SmartChordImportScreen), findsNothing);
    });
  });
}
