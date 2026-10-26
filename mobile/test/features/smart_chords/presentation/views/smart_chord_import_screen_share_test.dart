import 'dart:typed_data';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
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
      status: ministry != null ? MinistryBootstrapStatus.ready : MinistryBootstrapStatus.empty,
      selectedMinistry: ministry,
    );
  }
}

class FakeSmartChordRepository implements SmartChordRepository {
  SmartChordImportDraft? textDraftResult;
  SmartChordImportDraft? pdfDraftResult;
  int createCalls = 0;
  List<int>? lastPdfBytes;
  String? lastText;

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
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
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
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCalls++;
    return SmartChord(
      id: 'chord-new-1',
      userId: 'user-a',
      title: payload['title'] as String,
      artistName: payload['artist_name'] as String?,
      originalKey: payload['original_key'] as String? ?? 'C',
      content: payload['content'] as String,
      createdAt: '2026-10-26T12:00:00Z',
      updatedAt: '2026-10-26T12:00:00Z',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeRepertoireLinkRepository implements SmartChordRepertoireLinkRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late FakeAuthNotifier fakeAuth;
  late FakeMinistryContextNotifier fakeMinistry;
  late FakeSmartChordRepository fakeRepo;
  late FakeRepertoireLinkRepository fakeLinkRepo;

  setUp(() {
    fakeAuth = FakeAuthNotifier();
    fakeMinistry = FakeMinistryContextNotifier();
    fakeRepo = FakeSmartChordRepository();
    fakeLinkRepo = FakeRepertoireLinkRepository();
  });

  Widget buildTestScreen({SharedImportPayload? initialPayload}) {
    return ProviderScope(
      overrides: [
        authNotifierProvider.overrideWith((ref) => fakeAuth),
        ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
        smartChordRepositoryProvider.overrideWithValue(fakeRepo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(fakeLinkRepo),
      ],
      child: MaterialApp(
        home: SmartChordImportScreen(initialPayload: initialPayload),
      ),
    );
  }

  group('SmartChordImportScreen Share Intent Tests', () {
    testWidgets('shared plain text preloads text and auto-extracts preview draft',
        (tester) async {
      await tester.pumpWidget(
        buildTestScreen(
          initialPayload: const SharedImportPayload.text('G D Em C\nGraças Te dou'),
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

    testWidgets('shared digital PDF preloads bytes and auto-extracts preview draft',
        (tester) async {
      final samplePdf = Uint8List.fromList([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
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

    testWidgets('shared oversized PDF (> 3 MB) shows error without auto-extracting',
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
      expect(find.text('Arquivo PDF excede o limite máximo permitido de 3 MB.'), findsOneWidget);
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

      expect(find.text('Não foi possível ler o arquivo compartilhado.'), findsWidgets);
      expect(fakeRepo.createCalls, 0);
    });

    testWidgets('cancellation pops without saving to database',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authNotifierProvider.overrideWith((ref) => fakeAuth),
            ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
            smartChordRepositoryProvider.overrideWithValue(fakeRepo),
            smartChordRepertoireLinkRepositoryProvider.overrideWithValue(fakeLinkRepo),
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

    testWidgets('regression: standard empty import screen without initialPayload works as expected',
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
  });
}
