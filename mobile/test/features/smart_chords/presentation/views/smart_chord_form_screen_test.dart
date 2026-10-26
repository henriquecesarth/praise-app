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
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_form_screen.dart';

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

class FakeSmartChordRepo implements SmartChordRepository {
  Map<String, dynamic>? lastCreatedPayload;
  Map<String, dynamic>? lastUpdatedPayload;
  Exception? errorToThrow;
  Completer<void>? createCompleter;
  int createCallCount = 0;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async => [];

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async => throw UnimplementedError();

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCallCount++;
    if (createCompleter != null) await createCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    lastCreatedPayload = payload;
    return SmartChord(
      id: 'sc-created',
      userId: 'user-a',
      title: payload['title'] as String,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      songId: payload['song_id'] as String?,
      artistId: payload['artist_id'] as String?,
      createdAt: '',
      updatedAt: '',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async {
    if (errorToThrow != null) throw errorToThrow!;
    lastUpdatedPayload = payload;
    return SmartChord(
      id: id,
      userId: 'user-a',
      title: payload['title'] as String,
      originalKey: payload['original_key'] as String,
      content: payload['content'] as String,
      songId: payload['song_id'] as String?,
      artistId: payload['artist_id'] as String?,
      createdAt: '',
      updatedAt: '',
    );
  }

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Draft',
      content: '',
      warnings: [],
      sourceType: 'pdf',
    );
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    return const SmartChordImportDraft(
      title: 'Draft',
      content: '',
      warnings: [],
      sourceType: 'text',
    );
  }

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) async {
    return const SmartChordImportDraft(
      title: 'Cifra URL',
      content: '',
      warnings: [],
      sourceType: 'url',
    );
  }

  @override
  Future<SmartChordImportDraft> importImageDraft(List<int> bytes, String filename) async {
    return const SmartChordImportDraft(
      title: 'Cifra Imagem',
      content: '',
      warnings: [],
      sourceType: 'image',
    );
  }
}

void main() {
  late FakeSmartChordRepo repo;
  late FakeAuthNotifier authNotifier;
  late FakeMinistryContextNotifier ministryNotifier;

  setUp(() {
    repo = FakeSmartChordRepo();
    authNotifier = FakeAuthNotifier();
    ministryNotifier = FakeMinistryContextNotifier();
  });

  Widget buildApp({
    SmartChord? initialChord,
    String? prefillSongId,
    String? prefillSongTitle,
    String? prefillArtistId,
    String? prefillArtistName,
    String? prefillKey,
  }) {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(repo),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => ElevatedButton(
              onPressed: () {
                Navigator.of(ctx).push(
                  MaterialPageRoute(
                    builder: (_) => SmartChordFormScreen(
                      initialChord: initialChord,
                      prefillSongId: prefillSongId,
                      prefillSongTitle: prefillSongTitle,
                      prefillArtistId: prefillArtistId,
                      prefillArtistName: prefillArtistName,
                      prefillKey: prefillKey,
                    ),
                  ),
                );
              },
              child: const Text('Abrir Form'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('validates required fields on submission', (tester) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    // Tap save without filling fields
    await tester.tap(find.byKey(const ValueKey('smart_chord_save_button')));
    await tester.pumpAndSettle();

    expect(find.text('Título é obrigatório.'), findsOneWidget);
    expect(find.text('Conteúdo da cifra é obrigatório.'), findsOneWidget);
    expect(repo.lastCreatedPayload, isNull);
  });

  testWidgets('fills form and creates smart chord successfully', (tester) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('smart_chord_title_field')), 'Grande é o Senhor');
    await tester.enterText(find.byKey(const ValueKey('smart_chord_content_field')), '[A]Grande é o [D]Senhor');
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('smart_chord_save_button')));
    await tester.pumpAndSettle();

    expect(repo.lastCreatedPayload, isNotNull);
    expect(repo.lastCreatedPayload!['title'], 'Grande é o Senhor');
    expect(repo.lastCreatedPayload!['content'], '[A]Grande é o [D]Senhor');
  });

  testWidgets('quick harmonic field chip inserts chord brackets', (tester) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    // Default key is C, so [C], [Dm], etc. are visible in quick chips
    await tester.tap(find.widgetWithText(ActionChip, 'Dm'));
    await tester.pumpAndSettle();

    final contentField = tester.widget<TextFormField>(find.byKey(const ValueKey('smart_chord_content_field')));
    expect(contentField.controller!.text, contains('[Dm]'));
  });

  // R2-10: Widget privacy test
  testWidgets('User A enters private draft -> auth logout occurs -> route closes immediately and draft is destroyed', (tester) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('smart_chord_title_field')), 'Segredo de Louvor User A');
    await tester.enterText(find.byKey(const ValueKey('smart_chord_content_field')), '[D]Letra Confidencial de User A');
    await tester.pumpAndSettle();

    expect(find.text('Segredo de Louvor User A'), findsOneWidget);

    // Logout occurs / session changes
    authNotifier.logout();
    await tester.pumpAndSettle();

    // Form route is closed and draft is not displayed
    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsNothing);
    expect(find.text('Segredo de Louvor User A'), findsNothing);
    expect(find.text('Abrir Form'), findsOneWidget);
  });

  testWidgets('User A enters private draft -> active user changes to User B -> route closes immediately', (tester) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('smart_chord_title_field')), 'Draft Pessoal');
    await tester.pumpAndSettle();

    // User switches to User B
    authNotifier.setUser(const AuthUser(id: 'user-b', email: 'user.b@test.com', name: 'User B'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsNothing);
    expect(find.text('Draft Pessoal'), findsNothing);
  });

  // R2-11: Tenant-linked form widget test
  testWidgets('Ministry Alpha active with linked song_id -> switch to Beta -> form auto-dismisses', (tester) async {
    await tester.pumpWidget(buildApp(prefillSongId: 'song-alpha-1'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsOneWidget);

    // Switch active ministry to Beta
    ministryNotifier.setMinistry(
      const Ministry(id: 'min-beta', name: 'Beta', role: 'admin'),
    );
    await tester.pumpAndSettle();

    // Ministry-linked form must not silently survive in Beta: it must close
    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsNothing);
    expect(find.text('Abrir Form'), findsOneWidget);
  });

  testWidgets('Unlinked personal Smart Chord form does NOT dismiss on ministry switch', (tester) async {
    await tester.pumpWidget(buildApp(prefillSongId: null, prefillArtistId: null));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsOneWidget);

    // Switch active ministry from Alpha to Beta
    ministryNotifier.setMinistry(
      const Ministry(id: 'min-beta', name: 'Beta', role: 'admin'),
    );
    await tester.pumpAndSettle();

    // Global personal chord without ministry repertoire link stays open
    expect(find.byKey(const ValueKey('smart_chord_save_button')), findsOneWidget);
  });

  // R2-6: Real failure produces error snackbar
  testWidgets('real failure on submission produces user-safe error snackbar', (tester) async {
    repo.errorToThrow = const AppFailure(message: 'Erro no servidor.', statusCode: 500);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('smart_chord_title_field')), 'Música Teste');
    await tester.enterText(find.byKey(const ValueKey('smart_chord_content_field')), '[C]Letra');
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('smart_chord_save_button')));
    await tester.pumpAndSettle();

    expect(find.text('Erro no servidor.'), findsOneWidget);
  });

  // R2-6: Discarded mutation produces NO snackbar
  testWidgets('stale mutation discarded after logout produces NO snackbar and navigates nothing', (tester) async {
    repo.createCompleter = Completer<void>();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('smart_chord_title_field')), 'Cifra Em Voo');
    await tester.enterText(find.byKey(const ValueKey('smart_chord_content_field')), '[G]Letra');
    await tester.pumpAndSettle();

    // Tap save -> request is in flight
    await tester.tap(find.byKey(const ValueKey('smart_chord_save_button')));
    await tester.pump();

    // Logout occurs while request is in flight
    authNotifier.logout();
    await tester.pumpAndSettle();

    // Complete the in-flight request
    repo.createCompleter!.complete();
    await tester.pumpAndSettle();

    // Assert: no snackbar was shown
    expect(find.byType(SnackBar), findsNothing);
  });
  testWidgets('editor preview retains inline section and progression in one widget', (tester) async {
    await tester.pumpWidget(buildApp());
    await tester.tap(find.text('Abrir Form'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('smart_chord_content_field')), 'Solo: [ Am | D ]');
    await tester.tap(find.byTooltip('Visualizar Prévia'));
    await tester.pumpAndSettle();
    expect(find.byType(MusicalProgressionLine), findsOneWidget);
    final text = tester.widget<Text>(find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text)));
    expect(text.textSpan!.toPlainText(), 'Solo:  Am | D ');
    expect(tester.takeException(), isNull);
  });

}
