import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_form_screen.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/version_editor_sheet.dart';

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

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Ministry>> getMyMinistries() async => [];
}

class FakeAuthNotifier extends AuthNotifier {
  FakeAuthNotifier()
      : super(
          _FakeAuthRepo(),
        ) {
    state = const AuthState.authenticated(
      AuthUser(id: 'admin_user', email: 'admin@test.com', name: 'Admin'),
    );
  }
}

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier()
      : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = const MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(id: 'min_1', name: 'Min 1', role: 'admin'),
      availableMinistries: [
        Ministry(id: 'min_1', name: 'Min 1', role: 'admin'),
      ],
    );
  }
}

class _FakeRepertoireRepo implements RepertoireRepository {
  SongFormData? lastCreatedData;
  SongFormData? lastUpdatedData;

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [
        const Artist(id: 'art_1', ministryId: 'min_1', name: 'Aline Barros'),
      ];

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [
        const Classification(
          id: 'cls_1',
          ministryId: 'min_1',
          name: 'Júbilo',
          color: '#3B82F6',
        ),
      ];

  @override
  Future<SongDetail> createSong(
    String ministryId,
    SongFormData data,
  ) async {
    lastCreatedData = data;
    return SongDetail(
      id: 'created-id-1',
      ministryId: ministryId,
      title: data.title,
      artistId: data.artistId,
      versions: data.versions ?? const [],
    );
  }

  @override
  Future<SongDetail> updateSong(
    String ministryId,
    String songId,
    SongFormData data,
  ) async {
    lastUpdatedData = data;
    return SongDetail(
      id: songId,
      ministryId: ministryId,
      title: data.title,
      artistId: data.artistId,
      versions: data.versions ?? const [],
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _FakeRepertoireRepo fakeRepo;
  late _FakePreferencesStorage fakePrefs;

  setUp(() {
    fakeRepo = _FakeRepertoireRepo();
    fakePrefs = _FakePreferencesStorage();
  });

  Widget buildSubject({SongDetail? initialSong}) {
    return ProviderScope(
      overrides: [
        preferencesStorageProvider.overrideWithValue(fakePrefs),
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        authNotifierProvider.overrideWith((ref) => FakeAuthNotifier()),
        ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier()),
      ],
      child: MaterialApp(
        home: SongFormScreen(
          ministryId: 'min_1',
          initialSong: initialSong,
        ),
      ),
    );
  }

  Widget buildPushableSubject({SongDetail? initialSong}) {
    return ProviderScope(
      overrides: [
        preferencesStorageProvider.overrideWithValue(fakePrefs),
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        authNotifierProvider.overrideWith((ref) => FakeAuthNotifier()),
        ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier()),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => ElevatedButton(
              onPressed: () {
                Navigator.of(ctx).push(
                  MaterialPageRoute(
                    builder: (_) => SongFormScreen(
                      ministryId: 'min_1',
                      initialSong: initialSong,
                    ),
                  ),
                );
              },
              child: const Text('Open Song Form'),
            ),
          ),
        ),
      ),
    );
  }

  group('Compact Mobile Song Forms (R3-C1)', () {
    testWidgets('renders concise main screen with compact version list and general info',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Main screen elements
      expect(find.text('Nova Música'), findsOneWidget);
      expect(find.byKey(const ValueKey('song_title_input')), findsOneWidget);
      expect(find.byKey(const ValueKey('artist_picker_tile')), findsOneWidget);
      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);

      // Compact version list
      expect(find.textContaining('Versões da Música'), findsOneWidget);
      expect(find.byKey(const ValueKey('add_version_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('version_card_0')), findsOneWidget);
      expect(find.text('Padrão'), findsOneWidget);
      expect(find.text('Sem tom'), findsOneWidget);
      expect(find.text('Sem BPM'), findsOneWidget);
      expect(find.text('Sem duração'), findsOneWidget);

      // General info section
      expect(find.text('Informações Gerais'), findsOneWidget);
      expect(find.byKey(const ValueKey('song_lyrics_input')), findsOneWidget);
      expect(find.byKey(const ValueKey('song_notes_input')), findsOneWidget);

      // Version-specific inputs are NOT visible inline on the main screen
      expect(find.byKey(const ValueKey('song_version_name_input')), findsNothing);
      expect(find.byKey(const ValueKey('song_bpm_input')), findsNothing);
      expect(find.byKey(const ValueKey('key_chip_G')), findsNothing);
    });

    testWidgets('canceling version creation in bottom sheet does not add version',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Open version editor via "Nova Versão"
      await tester.tap(find.byKey(const ValueKey('add_version_button')));
      await tester.pumpAndSettle();

      // Sheet is open
      expect(find.byType(VersionEditorSheet), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(VersionEditorSheet),
          matching: find.text('Nova Versão'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('song_version_name_input')), findsOneWidget);

      // Enter draft name
      await tester.enterText(
        find.byKey(const ValueKey('song_version_name_input')),
        'Versão Cancelada',
      );
      await tester.pumpAndSettle();

      // Tap Cancelar
      await tester.tap(find.byKey(const ValueKey('cancel_version_sheet_button')));
      await tester.pumpAndSettle();

      // Sheet closed, version was NOT added
      expect(find.byType(VersionEditorSheet), findsNothing);
      expect(find.byKey(const ValueKey('version_card_1')), findsNothing);
      expect(find.text('Versão Cancelada'), findsNothing);
    });

    testWidgets('canceling version edit in bottom sheet does not change version data',
        (tester) async {
      const existing = SongDetail(
        id: 's-edit-cancel',
        ministryId: 'min_1',
        title: 'Música Antiga',
        versions: [
          SongVersion(
            id: 'v_orig',
            name: 'Original Intocada',
            key: 'G',
            bpm: 120,
            duration: '03:45',
          ),
        ],
      );

      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject(initialSong: existing));
      await tester.pumpAndSettle();

      expect(find.text('Original Intocada'), findsOneWidget);
      expect(find.text('G'), findsOneWidget);
      expect(find.text('120 BPM'), findsOneWidget);

      // Tap to edit version 0
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      // Modify fields
      await tester.enterText(
        find.byKey(const ValueKey('song_version_name_input')),
        'Nome Modificado Descartado',
      );
      await tester.tap(find.byKey(const ValueKey('musical_key_selector_field')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('key_option_D')));
      await tester.pumpAndSettle();

      // Cancel
      await tester.tap(find.byKey(const ValueKey('cancel_version_sheet_button')));
      await tester.pumpAndSettle();

      // Original data is preserved
      expect(find.text('Original Intocada'), findsOneWidget);
      expect(find.text('G'), findsOneWidget);
      expect(find.text('Nome Modificado Descartado'), findsNothing);
    });

    testWidgets('editing version in bottom sheet updates card and saves with song',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Edit version 0
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('song_version_name_input')),
        'Arranjo Especial',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('musical_key_selector_field')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey('key_option_A')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('key_option_A')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '105',
      );
      await tester.enterText(
        find.byKey(const ValueKey('song_duration_input')),
        '05:12',
      );
      await tester.tap(find.byKey(const ValueKey('class_chip_cls_1')));
      await tester.pumpAndSettle();

      // Confirm in sheet
      await tester.tap(find.byKey(const ValueKey('save_version_sheet_button')));
      await tester.pumpAndSettle();

      // Card is updated on main screen
      expect(find.text('Arranjo Especial'), findsOneWidget);
      expect(find.text('A'), findsOneWidget);
      expect(find.text('105 BPM'), findsOneWidget);
      expect(find.text('05:12'), findsOneWidget);

      // Enter title and save
      await tester.enterText(
        find.byKey(const ValueKey('song_title_input')),
        'Cântico da Vitória',
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastCreatedData, isNotNull);
      expect(fakeRepo.lastCreatedData!.title, equals('Cântico da Vitória'));
      expect(fakeRepo.lastCreatedData!.originalKey, equals('A'));
      expect(fakeRepo.lastCreatedData!.bpm, equals(105));
      expect(fakeRepo.lastCreatedData!.duration, equals('05:12'));
      expect(fakeRepo.lastCreatedData!.classificationId, equals('cls_1'));
      expect(fakeRepo.lastCreatedData!.versions, hasLength(1));
      expect(fakeRepo.lastCreatedData!.versions![0].name, equals('Arranjo Especial'));
      expect(fakeRepo.lastCreatedData!.versions![0].classificationIds, equals(['cls_1']));
    });

    testWidgets('adding second version via bottom sheet, duplicating, and deleting',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // 1. Add version 2
      await tester.tap(find.byKey(const ValueKey('add_version_button')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('song_version_name_input')),
        'Versão Acústica',
      );
      await tester.tap(find.byKey(const ValueKey('musical_key_selector_field')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('key_option_E')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('song_bpm_input')),
        '70',
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('save_version_sheet_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('version_card_0')), findsOneWidget);
      expect(find.byKey(const ValueKey('version_card_1')), findsOneWidget);
      expect(find.text('Versão Acústica'), findsOneWidget);
      expect(find.text('E'), findsOneWidget);
      expect(find.text('70 BPM'), findsOneWidget);

      // 2. Duplicate version 1
      await tester.tap(find.byKey(const ValueKey('duplicate_version_button_1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('version_card_2')), findsOneWidget);
      expect(find.text('Versão Acústica (Cópia)'), findsOneWidget);

      // 3. Delete version 2
      await tester.tap(find.byKey(const ValueKey('delete_version_button_2')));
      await tester.pumpAndSettle();

      expect(find.text('Excluir versão'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('confirm_delete_version_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('version_card_2')), findsNothing);
      expect(find.byKey(const ValueKey('version_card_1')), findsOneWidget);
    });

    testWidgets('tapping version card directly opens version editor sheet',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byType(VersionEditorSheet), findsNothing);

      // Tap card body directly
      await tester.tap(find.byKey(const ValueKey('version_card_0')));
      await tester.pumpAndSettle();

      expect(find.byType(VersionEditorSheet), findsOneWidget);
      expect(find.text('Editar Versão'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('cancel_version_sheet_button')));
      await tester.pumpAndSettle();

      expect(find.byType(VersionEditorSheet), findsNothing);
    });

    testWidgets('enforces 20 versions ceiling on creation and duplication with snackbar',
        (tester) async {
      final initialVersions = List.generate(
        20,
        (i) => SongVersion(
          id: 'v_$i',
          name: 'Versão $i',
        ),
      );
      final songWithMaxVersions = SongDetail(
        id: 's-max-ver',
        ministryId: 'min_1',
        title: 'Música 20 Versões',
        versions: initialVersions,
      );

      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject(initialSong: songWithMaxVersions));
      await tester.pumpAndSettle();

      // Attempt to add 21st version via button
      await tester.tap(find.byKey(const ValueKey('add_version_button')));
      await tester.pumpAndSettle();

      expect(find.text('A música pode ter no máximo 20 versões.'), findsOneWidget);
      expect(find.byType(VersionEditorSheet), findsNothing);

      // Attempt to duplicate version 0
      await tester.tap(find.byKey(const ValueKey('duplicate_version_button_0')));
      await tester.pumpAndSettle();

      expect(find.text('A música pode ter no máximo 20 versões.'), findsWidgets);
    });

    testWidgets('discard changes dialog confirms exit or cancels to keep editing',
        (tester) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildPushableSubject());
      await tester.pumpAndSettle();

      // Open form
      await tester.tap(find.text('Open Song Form'));
      await tester.pumpAndSettle();

      expect(find.byType(SongFormScreen), findsOneWidget);

      // Modify title to make form dirty
      await tester.enterText(
        find.byKey(const ValueKey('song_title_input')),
        'Rascunho Não Salvo',
      );
      await tester.pumpAndSettle();

      // Trigger pop
      Navigator.of(tester.element(find.byType(SongFormScreen))).maybePop();
      await tester.pumpAndSettle();

      // Discard dialog is displayed
      expect(find.text('Descartar alterações?'), findsOneWidget);

      // Tap cancel to continue editing
      await tester.tap(find.byKey(const ValueKey('discard_dialog_cancel_button')));
      await tester.pumpAndSettle();

      expect(find.byType(SongFormScreen), findsOneWidget);
      expect(find.text('Rascunho Não Salvo'), findsOneWidget);

      // Trigger pop again and confirm discard
      Navigator.of(tester.element(find.byType(SongFormScreen))).maybePop();
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('discard_dialog_confirm_button')));
      await tester.pumpAndSettle();

      // Form was dismissed
      expect(find.byType(SongFormScreen), findsNothing);
      expect(find.text('Open Song Form'), findsOneWidget);
    });

    testWidgets('preserves free-text artist across version addition and submission',
        (tester) async {
      const initialSong = SongDetail(
        id: 's-freetext',
        ministryId: 'min_1',
        title: 'Música Com Artista Avulso',
        artistName: 'Artista Sem Cadastro',
        versions: [
          SongVersion(id: 'v_1', name: 'Original', key: 'C'),
        ],
      );

      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject(initialSong: initialSong));
      await tester.pumpAndSettle();

      expect(find.text('Artista Sem Cadastro'), findsOneWidget);

      // Open version 0 and modify duration
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('song_duration_input')),
        '04:10',
      );
      await tester.tap(find.byKey(const ValueKey('save_version_sheet_button')));
      await tester.pumpAndSettle();

      // Save form
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedData, isNotNull);
      expect(fakeRepo.lastUpdatedData!.title, equals('Música Com Artista Avulso'));
      expect(fakeRepo.lastUpdatedData!.duration, equals('04:10'));
      // Artist ID must remain omitted to not wipe web free-text artist
      expect(fakeRepo.lastUpdatedData!.toJson().containsKey('artist_id'), isFalse);
    });

    testWidgets(
        'R4-M1: compact tone selector supports minor/enharmonic keys and clearing to Sem tom',
        (tester) async {
      const initialSong = SongDetail(
        id: 's-key-test',
        ministryId: 'min_1',
        title: 'Música Em F#m',
        versions: [
          SongVersion(id: 'v_1', name: 'Original', key: 'F#m'),
        ],
      );

      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(buildSubject(initialSong: initialSong));
      await tester.pumpAndSettle();

      expect(find.text('F#m'), findsOneWidget);

      // Open version editor
      await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
      await tester.pumpAndSettle();

      // Verify compact selector displays F#m and no chip grid exists
      expect(find.byKey(const ValueKey('musical_key_selector_field')), findsOneWidget);
      expect(find.byKey(const ValueKey('key_chip_G')), findsNothing);

      // Open key picker sheet and select Sem tom
      await tester.tap(find.byKey(const ValueKey('musical_key_selector_field')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('key_option_none')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('key_option_none')));
      await tester.pumpAndSettle();

      // Save version sheet
      await tester.tap(find.byKey(const ValueKey('save_version_sheet_button')));
      await tester.pumpAndSettle();

      expect(find.text('Sem tom'), findsOneWidget);
    });

    testWidgets(
        'R4-M1: narrow-screen responsiveness (320px, 360px, 393px + 1.3x text scale + keyboard/safe-area) has zero overflow',
        (tester) async {
      for (final width in [320.0, 360.0, 393.0]) {
        tester.view.physicalSize = Size(width, 740);
        tester.view.devicePixelRatio = 1.0;

        await tester.pumpWidget(
          MediaQuery(
            data: MediaQueryData(
              size: Size(width, 740),
              padding: const EdgeInsets.only(bottom: 48),
              viewPadding: const EdgeInsets.only(bottom: 48),
              viewInsets: EdgeInsets.only(bottom: width == 360.0 ? 220 : 0),
              textScaler: const TextScaler.linear(1.3),
            ),
            child: buildSubject(),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        await tester.tap(find.byKey(const ValueKey('edit_version_button_0')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(const ValueKey('version_editor_footer')), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('cancel_version_sheet_button')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
    });
  });
}
