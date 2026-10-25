import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/musical_progression_line.dart';
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
  int updateFontCallCount = 0;
  String? lastUpdatedFont;
  Exception? updateFontErrorToThrow;
  Completer<void>? updateFontCompleter;

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
  Future<void> updateChordFontPreference(String fontFamily) async {
    updateFontCallCount++;
    lastUpdatedFont = fontFamily;
    if (updateFontCompleter != null) await updateFontCompleter!.future;
    if (updateFontErrorToThrow != null) throw updateFontErrorToThrow!;
    final currentUser = state.user;
    if (currentUser != null) {
      state = state.copyWith(
        user: currentUser.copyWith(chordFontFamily: fontFamily),
      );
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
    String? chordFontOverride,
  }) {
    return ProviderScope(
      overrides: [
        smartChordRepositoryProvider.overrideWithValue(repo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
        if (chordFontOverride != null)
          chordFontPreferenceProvider.overrideWithValue(chordFontOverride),
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

  group('ChordFontFamilyResolver', () {
    test('resolves canonical fonts with appropriate platform fallbacks', () {
      final monospace = ChordFontFamilyResolver.resolve('monospace');
      expect(monospace.fontFamily, 'monospace');
      expect(monospace.fallback, isEmpty);
      expect(monospace.isMonospace, isTrue);

      final courier = ChordFontFamilyResolver.resolve('Courier New');
      expect(courier.fontFamily, 'Courier New');
      expect(courier.fallback, ['monospace']);
      expect(courier.isMonospace, isTrue);

      final georgia = ChordFontFamilyResolver.resolve('Georgia');
      expect(georgia.fontFamily, 'Georgia');
      expect(georgia.fallback, ['serif']);
      expect(georgia.isMonospace, isFalse);

      final times = ChordFontFamilyResolver.resolve('Times New Roman');
      expect(times.fontFamily, 'Times New Roman');
      expect(times.fallback, ['serif']);
      expect(times.isMonospace, isFalse);

      final arial = ChordFontFamilyResolver.resolve('Arial');
      expect(arial.fontFamily, 'Arial');
      expect(arial.fallback, ['sans-serif']);
      expect(arial.isMonospace, isFalse);

      final verdana = ChordFontFamilyResolver.resolve('Verdana');
      expect(verdana.fontFamily, 'Verdana');
      expect(verdana.fallback, ['sans-serif']);
      expect(verdana.isMonospace, isFalse);
    });

    test('falls back safely to monospace for null or unknown fonts', () {
      final nullFont = ChordFontFamilyResolver.resolve(null);
      expect(nullFont.fontFamily, 'monospace');
      expect(nullFont.isMonospace, isTrue);

      final unknown = ChordFontFamilyResolver.resolve('Papyrus');
      expect(unknown.fontFamily, 'monospace');
      expect(unknown.isMonospace, isTrue);
    });
  });

  group('SmartChordReaderScreen font preferences & rendering', () {
    testWidgets('renders monospace by default with SelectableText space-padded lines', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      // In monospace mode, SelectableText widgets are used
      final selectableTexts = tester.widgetList<SelectableText>(find.byType(SelectableText));
      expect(selectableTexts, isNotEmpty);
      final firstSelectable = selectableTexts.first;
      expect(firstSelectable.style?.fontFamily, 'monospace');
    });

    testWidgets('renders proportional font (Georgia) with anchored Column segments and serif fallback', (tester) async {
      await tester.pumpWidget(buildApp(
        chordId: 'sc-1',
        initialChord: sampleChord,
        chordFontOverride: 'Georgia',
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      // Proportional mode renders with Wrap containing anchored Columns
      expect(find.byType(Wrap), findsWidgets);

      // Verify Georgia font and serif fallback on rendered text
      final textWidgets = tester.widgetList<Text>(find.byType(Text));
      final chordTexts = textWidgets.where((t) => t.style?.fontFamily == 'Georgia').toList();
      expect(chordTexts, isNotEmpty);
      expect(chordTexts.first.style?.fontFamilyFallback, ['serif']);

      // Chords C and G are rendered
      expect(find.text('C'), findsWidgets);
      expect(find.text('G'), findsWidgets);
      expect(find.text('Tu '), findsOneWidget);
      expect(find.text('és '), findsOneWidget);
      expect(find.text('Deus'), findsOneWidget);
    });

    testWidgets('transposition works accurately with proportional font', (tester) async {
      await tester.pumpWidget(buildApp(
        chordId: 'sc-1',
        initialChord: sampleChord,
        chordFontOverride: 'Georgia',
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      expect(find.text('C'), findsWidgets);
      expect(find.text('G'), findsWidgets);

      // Transpose +2 semitones: C -> D, G -> A
      await tester.tap(find.byTooltip('Meio tom acima (+1)'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Meio tom acima (+1)'));
      await tester.pumpAndSettle();

      expect(find.text('Tom: D'), findsOneWidget);
      expect(find.text('D'), findsWidgets);
      expect(find.text('A'), findsWidgets);
      expect(find.text('Tu '), findsOneWidget);
      expect(find.text('és '), findsOneWidget);
      expect(find.text('Deus'), findsOneWidget);
    });

    testWidgets('font size stepper scales proportional font text widgets', (tester) async {
      await tester.pumpWidget(buildApp(
        chordId: 'sc-1',
        initialChord: sampleChord,
        chordFontOverride: 'Arial',
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      // Find initial font size
      final initialTexts = tester.widgetList<Text>(find.byType(Text)).where((t) => t.style?.fontFamily == 'Arial');
      final initialSize = initialTexts.first.style?.fontSize;
      expect(initialSize, 15.0);

      // Tap increase font size button
      await tester.tap(find.byTooltip('Aumentar fonte'));
      await tester.pumpAndSettle();

      final increasedTexts = tester.widgetList<Text>(find.byType(Text)).where((t) => t.style?.fontFamily == 'Arial');
      expect(increasedTexts.first.style?.fontSize, 16.0);
    });

    testWidgets('reactively switches rendering from monospace to proportional on preference change', (tester) async {
      // Start with user having monospace preference
      authNotifier.setUser(const AuthUser(
        id: 'user-a',
        email: 'user.a@test.com',
        name: 'User A',
        chordFontFamily: 'monospace',
      ));

      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      // Initially monospace: SelectableText is used, no Wrap
      expect(find.byType(Wrap), findsNothing);

      // Update user preference reactively to Georgia
      authNotifier.setUser(const AuthUser(
        id: 'user-a',
        email: 'user.a@test.com',
        name: 'User A',
        chordFontFamily: 'Georgia',
      ));
      await tester.pumpAndSettle();

      // Rebuilt reactively into proportional Wrap
      expect(find.byType(Wrap), findsWidgets);
      final georgiaTexts = tester.widgetList<Text>(find.byType(Text)).where((t) => t.style?.fontFamily == 'Georgia');
      expect(georgiaTexts, isNotEmpty);
    });
  });

  group('SmartChordReaderScreen font selector', () {
    testWidgets('displays font selector button and opens menu with 6 canonical options and fallback labels', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      final fontSelectorButton = find.byTooltip('Fonte das cifras');
      expect(fontSelectorButton, findsOneWidget);

      await tester.tap(fontSelectorButton);
      await tester.pumpAndSettle();

      final menuItems = tester.widgetList<CheckedPopupMenuItem<String>>(
        find.byType(CheckedPopupMenuItem<String>),
      ).toList();

      expect(menuItems.length, 6);
      expect(menuItems.map((m) => m.value).toList(), [
        'monospace',
        'Arial',
        'Times New Roman',
        'Georgia',
        'Verdana',
        'Courier New',
      ]);

      // Initially monospace is checked
      final monospaceItem = menuItems.firstWhere((m) => m.value == 'monospace');
      expect(monospaceItem.checked, isTrue);

      final arialItem = menuItems.firstWhere((m) => m.value == 'Arial');
      expect(arialItem.checked, isFalse);

      // Fallback descriptions
      expect(find.text('Substituto: sans-serif'), findsNWidgets(2)); // Arial and Verdana
      expect(find.text('Substituto: serif'), findsNWidgets(2)); // Times New Roman and Georgia
      expect(find.text('Substituto: monospace'), findsOneWidget); // Courier New
    });

    testWidgets('selecting a new font calls updateChordFontPreference and updates reader appearance', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Fonte das cifras'));
      await tester.pumpAndSettle();

      // Select Georgia
      await tester.tap(find.text('Georgia'), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(authNotifier.updateFontCallCount, 1);
      expect(authNotifier.lastUpdatedFont, 'Georgia');

      // Reader now renders in Georgia proportional mode
      expect(find.byType(Wrap), findsWidgets);
      final georgiaTexts = tester.widgetList<Text>(find.byType(Text)).where((t) => t.style?.fontFamily == 'Georgia');
      expect(georgiaTexts, isNotEmpty);

      // Reopening menu shows Georgia as checked
      await tester.tap(find.byTooltip('Fonte das cifras'));
      await tester.pumpAndSettle();

      final menuItems = tester.widgetList<CheckedPopupMenuItem<String>>(
        find.byType(CheckedPopupMenuItem<String>),
      ).toList();
      final georgiaItem = menuItems.firstWhere((m) => m.value == 'Georgia');
      expect(georgiaItem.checked, isTrue);
      final monospaceItem = menuItems.firstWhere((m) => m.value == 'monospace');
      expect(monospaceItem.checked, isFalse);
    });

    testWidgets('selecting the current active font is a no-op and does not call update', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Fonte das cifras'));
      await tester.pumpAndSettle();

      // Tap monospace (already selected)
      await tester.tap(find.text('monospace'), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(authNotifier.updateFontCallCount, 0);
      expect(authNotifier.lastUpdatedFont, isNull);
    });

    testWidgets('displays error snackbar and retains font when update fails', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      authNotifier.updateFontErrorToThrow = Exception('Network error');

      await tester.tap(find.byTooltip('Fonte das cifras'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Arial'), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(authNotifier.updateFontCallCount, 1);
      expect(find.text('Erro ao salvar preferência de fonte.'), findsOneWidget);

      // Reader remains in monospace mode and does not switch to Arial
      final arialTexts = tester.widgetList<Text>(find.byType(Text)).where((t) => t.style?.fontFamily == 'Arial');
      expect(arialTexts, isEmpty);
      final selectables = tester.widgetList<SelectableText>(find.byType(SelectableText));
      expect(selectables, isNotEmpty);
      expect(selectables.first.style?.fontFamily, 'monospace');
      expect(authNotifier.state.chordFontFamily, 'monospace');
    });

    testWidgets('shows loading indicator while saving and disables selector', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      authNotifier.updateFontCompleter = Completer<void>();

      await tester.tap(find.byTooltip('Fonte das cifras'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Verdana'), warnIfMissed: false);
      await tester.pump(); // Start save async, before completion

      // CircularProgressIndicator should be visible in the button
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // PopupMenuButton is disabled while saving
      final popupButton = tester.widget<PopupMenuButton<String>>(find.byType(PopupMenuButton<String>));
      expect(popupButton.enabled, isFalse);

      // Complete async save
      authNotifier.updateFontCompleter!.complete();
      await tester.pumpAndSettle();

      // Spinner disappears, button is re-enabled, font is updated
      expect(find.byType(CircularProgressIndicator), findsNothing);
      final reenabledButton = tester.widget<PopupMenuButton<String>>(find.byType(PopupMenuButton<String>));
      expect(reenabledButton.enabled, isTrue);
      expect(authNotifier.lastUpdatedFont, 'Verdana');
    });

    testWidgets('fences stale save completion after user logs out or switches', (tester) async {
      await tester.pumpWidget(buildApp(chordId: 'sc-1', initialChord: sampleChord));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();

      authNotifier.updateFontCompleter = Completer<void>();

      await tester.tap(find.byTooltip('Fonte das cifras'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Courier New'), warnIfMissed: false);
      await tester.pump();

      // Screen is saving
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // User logs out while save is in flight
      await authNotifier.logout();
      await tester.pumpAndSettle();

      // Screen was dismissed because user logged out
      expect(find.text('Abrir Reader'), findsOneWidget);

      // Now complete the stale save
      authNotifier.updateFontCompleter!.complete();
      await tester.pumpAndSettle();

      // No uncaught errors or snackbars
      expect(find.byType(SnackBar), findsNothing);
    });
  });
  for (final font in ['monospace', 'Arial']) {
    testWidgets('saved canonical progression uses inline renderer in $font mode', (tester) async {
      final chord = sampleChord.copyWith(content: 'Intro: (riff viol) [ ||: A | D | % :|| ]');
      repo.chord = chord;
      await tester.pumpWidget(buildApp(chordId: chord.id, initialChord: chord, chordFontOverride: font));
      await tester.tap(find.text('Abrir Reader'));
      await tester.pumpAndSettle();
      expect(find.byType(MusicalProgressionLine), findsOneWidget);
      final line = tester.widget<MusicalProgressionLine>(find.byType(MusicalProgressionLine));
      expect(line.fontFamily, font);
      final text = tester.widget<Text>(find.descendant(of: find.byType(MusicalProgressionLine), matching: find.byType(Text)));
      expect(text.textSpan!.toPlainText(), 'Intro: (riff viol)  ||: A | D | % :|| ');
      expect(tester.takeException(), isNull);
    });
  }

}
