import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_form_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_reader_screen.dart';
import 'package:louvaio_mobile/main_preview.dart';

void main() {
  Widget createPreviewAppHarness() {
    final initialSong = buildInitialMockSong();
    final authRepo = PreviewAuthRepository(initialUser: mockUser);
    final ministryRepo = PreviewMinistryRepository(ministry: mockMinistry);
    final repertoireRepo = PreviewRepertoireRepository(
      initialSong: initialSong,
      artists: mockArtists,
      classifications: mockClassifications,
    );
    final chordRepo = PreviewSmartChordRepository(initialChord: mockChord);
    final linkRepo = PreviewSmartChordLinkRepository(
      initialLink: mockRepertoireLink,
      chord: mockChord,
    );
    final inMemoryPrefs = InMemoryPreferencesStorage();

    return ProviderScope(
      overrides: [
        preferencesStorageProvider.overrideWithValue(inMemoryPrefs),
        authRepositoryProvider.overrideWithValue(authRepo),
        authNotifierProvider.overrideWith(
          (ref) => AuthNotifier(authRepo)
            ..state = const AuthState.authenticated(mockUser),
        ),
        ministryRepositoryProvider.overrideWithValue(ministryRepo),
        ministryContextNotifierProvider.overrideWith(
          (ref) => MinistryContextNotifier(
            repository: ministryRepo,
            preferencesStorage: inMemoryPrefs,
          )..state = const MinistryContextState(
              status: MinistryBootstrapStatus.ready,
              availableMinistries: [mockMinistry],
              selectedMinistry: mockMinistry,
            ),
        ),
        repertoireRepositoryProvider.overrideWithValue(repertoireRepo),
        smartChordRepositoryProvider.overrideWithValue(chordRepo),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
        chordFontPreferenceProvider.overrideWith((ref) {
          final auth = ref.watch(authNotifierProvider);
          return auth.chordFontFamily;
        }),
      ],
      child: const SafeVisualPreviewApp(),
    );
  }

  group('Safe Visual Preview (R3-B Offline Harness)', () {
    testWidgets('renders preview hub with security badges and scenarios',
        (tester) async {
      await tester.pumpWidget(createPreviewAppHarness());
      await tester.pumpAndSettle();

      expect(find.text('LouvAIO • R3-B'), findsOneWidget);
      expect(find.text('Safe Visual Preview (Offline)'), findsOneWidget);
      expect(find.text('SAFE MOCK'), findsOneWidget);
      expect(find.text('Modo de Visualização Isolado'), findsOneWidget);

      expect(find.text('1. Detalhes de Música (Versões & BPM)'), findsOneWidget);
      expect(find.text('2. Edição de Música (Gerenciador de Versões & BPM)'),
          findsOneWidget);
      expect(find.text('3. Nova Música em Branco (Criação do Zero)'),
          findsOneWidget);
      expect(find.text('4. Leitor de Cifras Inteligentes (Smart Chords)'),
          findsOneWidget);
    });

    testWidgets('Scenario 1 opens SongDetailView with versions and BPM',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(createPreviewAppHarness());
      await tester.pumpAndSettle();

      await tester.tap(find.text('1. Detalhes de Música (Versões & BPM)'));
      await tester.pumpAndSettle();

      expect(find.byType(SongDetailView), findsOneWidget);
      expect(find.text('Grande é o Senhor'), findsWidgets);
      expect(find.text('Adhemar de Campos'), findsWidgets);

      // Verify versions and BPM are displayed
      expect(find.text('Original / Tom G'), findsOneWidget);
      expect(find.text('Versão Acústica'), findsOneWidget);
      expect(find.text('Versão Rápida / Medley'), findsOneWidget);
      expect(find.text('110 BPM'), findsOneWidget);

      // Pop back to Hub
      final backButton = find.byType(BackButton);
      if (backButton.evaluate().isNotEmpty) {
        await tester.tap(backButton);
        await tester.pumpAndSettle();
        expect(find.byType(SafeVisualPreviewHubScreen), findsOneWidget);
      }
    });

    testWidgets('Scenario 2 opens SongFormScreen in edit mode with versions',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(createPreviewAppHarness());
      await tester.pumpAndSettle();

      await tester.tap(find.text('2. Edição de Música (Gerenciador de Versões & BPM)'));
      await tester.pumpAndSettle();

      expect(find.byType(SongFormScreen), findsOneWidget);
      expect(find.text('Editar Música'), findsOneWidget);
      expect(find.text('Versões da Música'), findsOneWidget);

      // Pop back
      final backButton = find.byType(BackButton);
      if (backButton.evaluate().isNotEmpty) {
        await tester.tap(backButton);
        await tester.pumpAndSettle();
      }
    });

    testWidgets('Scenario 4 opens SmartChordReaderScreen with universal chord fonts',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(createPreviewAppHarness());
      await tester.pumpAndSettle();

      await tester.tap(find.text('4. Leitor de Cifras Inteligentes (Smart Chords)'));
      await tester.pumpAndSettle();

      expect(find.byType(SmartChordReaderScreen), findsOneWidget);
      expect(find.text('Quão Grande É o Meu Deus'), findsOneWidget);
      expect(find.text('Soraya Moraes'), findsOneWidget);
    });
  });
}
