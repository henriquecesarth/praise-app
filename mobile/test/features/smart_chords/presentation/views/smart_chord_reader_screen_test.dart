import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_reader_screen.dart';

import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';

class _FakeSmartChordLinkRepo implements SmartChordRepertoireLinkRepository {
  SmartChordRepertoireLink linkToReturn = const SmartChordRepertoireLink.unlinked();
  int unlinkCallCount = 0;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    return linkToReturn;
  }

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async {
    return linkToReturn;
  }

  @override
  Future<SmartChordRepertoireLink> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    unlinkCallCount++;
    return const SmartChordRepertoireLink.unlinked();
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async {
    return [];
  }
}

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
  SmartChord? chord;
  Completer<void>? deleteCompleter;
  Exception? deleteErrorToThrow;
  int deleteCallCount = 0;
  String? lastDeletedId;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async => [];

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async => [];

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    if (chord != null) return chord!;
    throw Exception('Not found');
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async =>
      SmartChord.fromJson(payload);

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async =>
      SmartChord.fromJson(payload);

  @override
  Future<void> deleteSmartChord(String id) async {
    deleteCallCount++;
    lastDeletedId = id;
    if (deleteCompleter != null) await deleteCompleter!.future;
    if (deleteErrorToThrow != null) throw deleteErrorToThrow!;
  }

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
}

void main() {
  late FakeSmartChordRepo repo;
  late _FakeSmartChordLinkRepo linkRepo;
  late FakeAuthNotifier authNotifier;
  late FakeMinistryContextNotifier ministryNotifier;

  const sampleChord = SmartChord(
    id: 'sc-1',
    userId: 'user-a',
    title: 'Oceanos',
    originalKey: 'C',
    content: '[C]Tu és [G]Deus',
    artistName: 'Hillsong',
    createdAt: '',
    updatedAt: '',
  );

  setUp(() {
    repo = FakeSmartChordRepo();
    linkRepo = _FakeSmartChordLinkRepo();
    repo.chord = sampleChord;
    authNotifier = FakeAuthNotifier();
    ministryNotifier = FakeMinistryContextNotifier();
  });

  Widget buildApp({
    required String chordId,
    SmartChord? initialChord,
  }) {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(repo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
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
                    builder: (_) => SmartChordReaderScreen(
                      chordId: chordId,
                      initialChord: initialChord,
                    ),
                  ),
                );
              },
              child: const Text('Abrir Reader'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('displays chord, renders lyrics and responds to transposition steppers', (tester) async {
    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);
    expect(find.text('Hillsong'), findsOneWidget);
    expect(find.text('Tom: C'), findsOneWidget);

    // Tap +1 semitone
    await tester.tap(find.byTooltip('Meio tom acima (+1)'));
    await tester.pumpAndSettle();

    expect(find.text('Tom: C#'), findsOneWidget);
    expect(find.text('(+1)'), findsOneWidget);

    // Tap Original button to reset
    await tester.tap(find.text('Original'));
    await tester.pumpAndSettle();

    expect(find.text('Tom: C'), findsOneWidget);
  });

  testWidgets('R2-2 & R2-10: closes immediately when authenticated user logs out or switches', (tester) async {
    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);

    // User A logs out
    authNotifier.logout();
    await tester.pumpAndSettle();

    // Reader route must be dismissed
    expect(find.text('Oceanos'), findsNothing);
    expect(find.text('Abrir Reader'), findsOneWidget);
  });

  testWidgets('R2-4: preserves reader open when active ministry changes', (tester) async {
    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);

    // Active ministry changes from Alpha to Beta
    ministryNotifier.setMinistry(
      const Ministry(id: 'min-beta', name: 'Beta', role: 'admin'),
    );
    await tester.pumpAndSettle();

    // Global personal reader MUST remain open
    expect(find.text('Oceanos'), findsOneWidget);
  });

  testWidgets('R2-7: successful delete displays confirmation dialog, calls delete, shows success snackbar and pops', (tester) async {
    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    expect(find.text('Oceanos'), findsOneWidget);

    // Tap delete icon in AppBar
    await tester.tap(find.byTooltip('Excluir Cifra'));
    await tester.pumpAndSettle();

    // Confirm dialog is shown
    expect(find.text('Excluir Cifra'), findsOneWidget);
    expect(find.text('Deseja realmente excluir a cifra "Oceanos"? Esta ação não pode ser desfeita.'), findsOneWidget);

    // Tap Excluir button in dialog
    await tester.tap(find.widgetWithText(FilledButton, 'Excluir'));
    await tester.pumpAndSettle();

    expect(repo.deleteCallCount, 1);
    expect(repo.lastDeletedId, 'sc-1');
    expect(find.text('Cifra excluída com sucesso.'), findsOneWidget);
    expect(find.text('Oceanos'), findsNothing);
    expect(find.text('Abrir Reader'), findsOneWidget);
  });

  testWidgets('R2-7: failure delete displays error snackbar and does not pop', (tester) async {
    repo.deleteErrorToThrow = const AppFailure(message: 'Erro no servidor.', statusCode: 500);

    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Excluir Cifra'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Excluir'));
    await tester.pumpAndSettle();

    expect(repo.deleteCallCount, 1);
    expect(find.text('Erro no servidor.'), findsOneWidget);
    // Screen remains open
    expect(find.text('Oceanos'), findsOneWidget);
  });

  testWidgets('R2-7: stale delete completing after logout produces no snackbar and no User-B pop', (tester) async {
    repo.deleteCompleter = Completer<void>();

    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    // User A triggers delete
    await tester.tap(find.byTooltip('Excluir Cifra'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Excluir'));
    await tester.pump(); // Start delete, pending in Completer

    expect(repo.deleteCallCount, 1);

    // User A logs out while delete is in flight
    authNotifier.logout();
    await tester.pumpAndSettle();

    // Reader has been dismissed by session listener
    expect(find.text('Oceanos'), findsNothing);

    // Now async delete completes late
    repo.deleteCompleter!.complete();
    await tester.pumpAndSettle();

    // Assert NO success snackbar and NO error snackbar leaked to the screen
    expect(find.text('Cifra excluída com sucesso.'), findsNothing);
    expect(find.text('Erro ao excluir cifra.'), findsNothing);
    expect(find.text('Abrir Reader'), findsOneWidget);
  });

  testWidgets('displays active ministry link banner when chord is linked to song', (tester) async {
    linkRepo.linkToReturn = const SmartChordRepertoireLink(
      link: SmartChordSongLink(
        id: 'u-1_sc-1_min-alpha',
        smartChordId: 'sc-1',
        ministryId: 'min-alpha',
        songId: 'song-oceanos',
        userId: 'u-1',
      ),
      song: SmartChordSongSummary(
        id: 'song-oceanos',
        title: 'Oceanos - Ao Vivo',
        artistName: 'Hillsong United',
      ),
    );

    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    expect(find.text('Vinculada: Oceanos - Ao Vivo'), findsOneWidget);
    expect(find.text('Hillsong United'), findsOneWidget);
  });

  testWidgets('displays unlinked banner with Vincular button when not linked', (tester) async {
    linkRepo.linkToReturn = const SmartChordRepertoireLink.unlinked();

    await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Abrir Reader'));
    await tester.pumpAndSettle();

    expect(find.text('Não vinculada ao repertório ativo'), findsOneWidget);
    expect(find.text('Vincular'), findsOneWidget);
  });
}
