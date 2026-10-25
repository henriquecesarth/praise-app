import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/musical_progression_line.dart';
import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword({required String email, required String password}) => throw UnimplementedError();
  @override
  Future<AuthUser> signUp({required String name, required String email, required String password}) => throw UnimplementedError();
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

  @override
  Future<void> logout() async {
    state = const AuthState.unauthenticated();
  }
}

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier([
    MinistryContextState initialState = const MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(id: 'min-alpha', name: 'Alpha', role: 'admin'),
    ),
  ]) : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = initialState;
  }

  void setMinistry(Ministry? ministry) {
    state = state.copyWith(selectedMinistry: ministry, clearSelectedMinistry: ministry == null);
  }
}

class _FakeSmartChordRepo implements SmartChordRepository {
  SmartChordImportDraft? draftToReturn;
  Map<String, dynamic>? lastCreatedPayload;
  Exception? extractionError;
  Completer<void>? extractionCompleter;
  Completer<void>? createCompleter;
  int createCount = 0;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async => [];

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async => throw UnimplementedError();

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCount++;
    if (createCompleter != null) await createCompleter!.future;
    lastCreatedPayload = payload;
    return SmartChord(
      id: 'sc-created-1',
      userId: 'user-1',
      title: payload['title'] as String,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async => throw UnimplementedError();

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    if (extractionCompleter != null) await extractionCompleter!.future;
    if (extractionError != null) throw extractionError!;
    return draftToReturn ??
        const SmartChordImportDraft(
          title: 'PDF Cifra',
          artistName: 'Héber',
          originalKey: 'A',
          content: '[A]Certeza',
          warnings: [],
          sourceType: 'pdf',
        );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    if (extractionCompleter != null) await extractionCompleter!.future;
    if (extractionError != null) throw extractionError!;
    return draftToReturn ??
        const SmartChordImportDraft(
          title: 'Texto Cifra',
          artistName: 'Artista',
          originalKey: 'D',
          content: '[D]Graça',
          warnings: [ImportWarning(code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Aviso alinhamento')],
          sourceType: 'text',
        );
  }
}

class _FakeLinkRepo implements SmartChordRepertoireLinkRepository {
  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({required String ministryId, required String chordId}) async =>
      const SmartChordRepertoireLink.unlinked();

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async =>
      SmartChordRepertoireLink(
        link: SmartChordSongLink(
          id: 'link-1',
          userId: 'user-1',
          smartChordId: chordId,
          songId: songId,
          ministryId: ministryId,
        ),
        song: SmartChordSongSummary(
          id: songId,
          title: 'Song',
        ),
      );

  @override
  Future<void> removeRepertoireLink({required String ministryId, required String chordId}) async {}

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({required String ministryId, required String songId}) async => [];
}

void main() {
  group('SmartChordImportScreen Widget Tests', () {
    late _FakeSmartChordRepo repo;
    late _FakeLinkRepo linkRepo;
    late FakeAuthNotifier auth;
    late FakeMinistryContextNotifier ministry;

    setUp(() {
      repo = _FakeSmartChordRepo();
      linkRepo = _FakeLinkRepo();
      auth = FakeAuthNotifier();
      ministry = FakeMinistryContextNotifier(const MinistryContextState(
        status: MinistryBootstrapStatus.empty,
      ));
    });

    Widget createTestWidget({bool navigation = false}) {
      return ProviderScope(
        overrides: [
          authNotifierProvider.overrideWith((ref) => auth),
          ministryContextNotifierProvider.overrideWith((ref) => ministry),
          smartChordRepositoryProvider.overrideWithValue(repo),
          smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
        ],
        child: MaterialApp(
          home: navigation ? Builder(builder: (context) => Scaffold(
            body: TextButton(onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<SmartChord>(builder: (_) => const SmartChordImportScreen())),
              child: const Text('Abrir importação')),
          )) : const SmartChordImportScreen(),
        ),
      );
    }

    testWidgets('renders input mode with PDF and Text tabs', (tester) async {
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      expect(find.text('Importar Cifra'), findsOneWidget);
      expect(find.text('Documento PDF'), findsOneWidget);
      expect(find.text('Colar Texto'), findsOneWidget);

      // Default PDF tab view
      expect(find.text('Toque para selecionar um arquivo PDF'), findsOneWidget);
      expect(find.text('Analisar e Pré-visualizar PDF'), findsOneWidget);

      // Switch to text tab
      await tester.tap(find.text('Colar Texto'));
      await tester.pumpAndSettle();

      expect(find.text('Cole a cifra (acordes acima da letra ou em colchetes):'), findsOneWidget);
      expect(find.text('Analisar e Pré-visualizar Texto'), findsOneWidget);
    });

    testWidgets('extracts plain-text input and displays draft preview with warnings and editor', (tester) async {
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      // Switch to text tab
      await tester.tap(find.text('Colar Texto'));
      await tester.pumpAndSettle();

      // Enter text
      final textField = find.byType(TextField);
      await tester.enterText(textField, 'D      A\nGraça Te dou');

      // Click Analisar
      await tester.tap(find.text('Analisar e Pré-visualizar Texto'));
      await tester.pumpAndSettle();

      // Verify preview editor
      expect(find.text('Texto Cifra'), findsOneWidget);
      expect(find.text('Artista'), findsOneWidget);
      expect(find.text('• Aviso alinhamento'), findsOneWidget);
      expect(find.text('Salvar Cifra Pessoal'), findsOneWidget);

      // Toggle to rendered preview mode
      await tester.tap(find.text('Pré-visualização'));
      await tester.pumpAndSettle();

      expect(find.text('Graça'), findsOneWidget);

      // Save chord
      await tester.tap(find.text('Salvar Cifra Pessoal'));
      await tester.pumpAndSettle();

      expect(repo.lastCreatedPayload, isNotNull);
      expect(repo.lastCreatedPayload!['title'], equals('Texto Cifra'));
    });

    Future<void> extractText(WidgetTester tester) async {
      await tester.tap(find.text('Colar Texto'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'G\nLetra');
      await tester.tap(find.text('Analisar e Pré-visualizar Texto'));
    }

    testWidgets('failed text extraction is visible, preserves input and retry clears error', (tester) async {
      repo.extractionError = const AppFailure(message: 'Texto inválido. Revise a cifra.', statusCode: 400);
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();
      await extractText(tester);
      await tester.pumpAndSettle();
      expect(find.text('Texto inválido. Revise a cifra.'), findsOneWidget);
      expect(find.text('G\nLetra'), findsOneWidget);
      repo.extractionError = null;
      await tester.tap(find.text('Analisar e Pré-visualizar Texto'));
      await tester.pumpAndSettle();
      expect(find.text('Texto inválido. Revise a cifra.'), findsNothing);
      expect(find.text('Texto Cifra'), findsOneWidget);
    });

    for (final message in ['PDF inválido.', 'Arquivo PDF excede o limite máximo permitido de 3 MB.',
        'O PDF possui 11 páginas (máximo permitido: 10).']) {
      testWidgets('PDF extraction error without draft is visible: $message', (tester) async {
        repo.extractionError = AppFailure(message: message, statusCode: 400);
        await tester.pumpWidget(createTestWidget());
        await tester.pumpAndSettle();
        final container = ProviderScope.containerOf(tester.element(find.byType(SmartChordImportScreen)));
        await container.read(smartChordImportNotifierProvider.notifier).importPdf([1], 'invalid.pdf');
        await tester.pumpAndSettle();
        expect(find.text(message), findsOneWidget);
        expect(find.text('Salvar Cifra Pessoal'), findsNothing);
      });
    }

    testWidgets('cancel during extraction and reopen is clean without widget exceptions', (tester) async {
      repo.extractionCompleter = Completer<void>();
      await tester.pumpWidget(createTestWidget(navigation: true));
      await tester.tap(find.text('Abrir importação'));
      await tester.pumpAndSettle();
      await extractText(tester);
      await tester.pump();
      await tester.pageBack();
      await tester.pumpAndSettle();
      repo.extractionCompleter!.complete();
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Abrir importação'));
      await tester.pumpAndSettle();
      expect(find.text('Toque para selecionar um arquivo PDF'), findsOneWidget);
      expect(find.text('Texto Cifra'), findsNothing);
      expect(find.text('Salvar Cifra Pessoal'), findsNothing);
    });

    for (final change in ['user', 'ministry']) {
      testWidgets('$change switch discards pending extraction', (tester) async {
        repo.extractionCompleter = Completer<void>();
        await tester.pumpWidget(createTestWidget(navigation: true));
        await tester.tap(find.text('Abrir importação'));
        await tester.pumpAndSettle();
        await extractText(tester);
        await tester.pump();
        if (change == 'user') {
          auth.setUser(const AuthUser(id: 'user-b', email: 'b@test.com', name: 'B'));
        } else {
          ministry.setMinistry(const Ministry(id: 'min-b', name: 'Beta', role: 'member'));
        }
        await tester.pumpAndSettle();
        repo.extractionCompleter!.complete();
        await tester.pumpAndSettle();
        expect(find.text('Abrir importação'), findsOneWidget);
        expect(find.text('Texto Cifra'), findsNothing);
        expect(tester.takeException(), isNull);
      });

      testWidgets('$change switch during save suppresses navigation and linking after remote success', (tester) async {
        repo.createCompleter = Completer<void>();
        await tester.pumpWidget(createTestWidget(navigation: true));
        await tester.tap(find.text('Abrir importação'));
        await tester.pumpAndSettle();
        await extractText(tester);
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Salvar Cifra Pessoal'));
        await tester.tap(find.text('Salvar Cifra Pessoal'));
        await tester.pump();
        if (change == 'user') {
          auth.setUser(const AuthUser(id: 'user-b', email: 'b@test.com', name: 'B'));
        } else {
          ministry.setMinistry(const Ministry(id: 'min-b', name: 'Beta', role: 'member'));
        }
        await tester.pumpAndSettle();
        repo.createCompleter!.complete();
        await tester.pumpAndSettle();
        expect(repo.createCount, 1);
        expect(repo.lastCreatedPayload, isNotNull); // already-sent write can complete
        expect(find.text('Cifra Salva!'), findsNothing);
        expect(find.text('Vincular ao Repertório'), findsNothing);
        expect(find.text('Abrir importação'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('network and session errors use readable messages without internal details', (tester) async {
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(SmartChordImportScreen)));
      repo.extractionError = const AppFailure(message: 'internal transport detail', code: 'NETWORK_ERROR');
      await container.read(smartChordImportNotifierProvider.notifier).importPdf([1], 'file.pdf');
      await tester.pumpAndSettle();
      expect(find.text('Falha de conexão. Verifique sua internet e tente novamente.'), findsOneWidget);
      expect(find.text('internal transport detail'), findsNothing);
      repo.extractionError = const AppFailure(message: 'internal token detail', statusCode: 401);
      await container.read(smartChordImportNotifierProvider.notifier).importPdf([1], 'file.pdf');
      await tester.pumpAndSettle();
      expect(find.text('Sessão expirada ou alterada. Faça login novamente.'), findsOneWidget);
      expect(find.text('internal token detail'), findsNothing);
      repo.extractionError = null;
      await container.read(smartChordImportNotifierProvider.notifier).importPdf([1], 'file.pdf');
      await tester.pumpAndSettle();
      expect(find.text('Sessão expirada ou alterada. Faça login novamente.'), findsNothing);
    });

    testWidgets('save and reopen starts clean and does not create twice', (tester) async {
      await tester.pumpWidget(createTestWidget(navigation: true));
      await tester.tap(find.text('Abrir importação'));
      await tester.pumpAndSettle();
      await extractText(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Salvar Cifra Pessoal'));
      await tester.tap(find.text('Salvar Cifra Pessoal'));
      await tester.pumpAndSettle();
      expect(repo.createCount, 1);
      await tester.tap(find.text('Abrir importação'));
      await tester.pumpAndSettle();
      expect(find.text('Toque para selecionar um arquivo PDF'), findsOneWidget);
      expect(find.text('Texto Cifra'), findsNothing);
      expect(repo.createCount, 1);
    });

    testWidgets('abandoned preview is cleared on cancel and fresh entry', (tester) async {
      await tester.pumpWidget(createTestWidget(navigation: true));
      await tester.tap(find.text('Abrir importação'));
      await tester.pumpAndSettle();
      await extractText(tester);
      await tester.pumpAndSettle();
      expect(find.text('Texto Cifra'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Abrir importação'));
      await tester.pumpAndSettle();
      expect(find.text('Toque para selecionar um arquivo PDF'), findsOneWidget);
      expect(find.text('Texto Cifra'), findsNothing);
      expect(repo.createCount, 0);
    });

    testWidgets('import preview retains section annotation and progression together', (tester) async {
      repo.draftToReturn = const SmartChordImportDraft(title: 'Intro',
        content: 'Intro: (riff viol) [ ||: A | D | % :|| ]', warnings: [], sourceType: 'text');
      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();
      await extractText(tester);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pré-visualização'));
      await tester.pumpAndSettle();
      expect(find.byType(MusicalProgressionLine), findsOneWidget);
      final text = tester.widget<Text>(find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text)));
      expect(text.textSpan!.toPlainText(), 'Intro: (riff viol)  ||: A | D | % :|| ');
      expect(repo.createCount, 0);
    });
  });
}
