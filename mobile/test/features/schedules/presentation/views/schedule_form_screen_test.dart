import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/theme/app_theme.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_form_screen.dart';

class _FakeRepertoireRepo implements RepertoireRepository {
  List<SongSummary> songsToReturn = [];

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    final filtered = search != null && search.isNotEmpty
        ? songsToReturn
            .where((s) =>
                s.title.toLowerCase().contains(search.toLowerCase()) ||
                (s.artistName?.toLowerCase().contains(search.toLowerCase()) ??
                    false))
            .toList()
        : songsToReturn;
    return PaginatedSongs(
      songs: filtered,
      total: filtered.length,
    );
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async =>
      [];

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async =>
      SongDetail(id: 'mock-song', ministryId: ministryId, title: data.title);

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async =>
      SongDetail(id: songId, ministryId: ministryId, title: data.title);

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [];

  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      Artist(id: 'mock-artist', ministryId: ministryId, name: name);
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

class _FakeScheduleRepo
    implements ScheduleRepository, ScheduleTemplateCapable {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];
  List<ScheduleTemplate> templates = [];
  Exception? templatesError;
  ScheduleDetail? detailToReturn;
  Map<String, dynamic>? lastCreatedData;
  Map<String, dynamic>? lastUpdatedData;

  @override
  Future<List<ScheduleTemplate>> getScheduleTemplates(
      String ministryId) async {
    if (templatesError != null) throw templatesError!;
    return templates;
  }

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

  @override
  Future<ScheduleDetail> getScheduleDetail(
          String ministryId, String scheduleId) async =>
      detailToReturn ??
      const ScheduleDetail(
        id: 's1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-01',
      );

  @override
  Future<ScheduleDetail> confirmParticipation(
          String ministryId, String scheduleId, bool confirmed) async =>
      detailToReturn!;

  @override
  Future<List<ScheduleComment>> getComments(
          String ministryId, String scheduleId) async =>
      [];

  @override
  Future<ScheduleComment> postComment(
          String ministryId, String scheduleId, String content) async =>
      const ScheduleComment(
        id: 'c1',
        scheduleId: 's1',
        ministryId: 'min_1',
        userId: 'u1',
        userName: 'User',
        content: 'content',
        createdAt: '2026-10-01',
      );

  @override
  Future<ScheduleDetail> createSchedule(
      String ministryId, Map<String, dynamic> data) async {
    lastCreatedData = data;
    return detailToReturn ??
        const ScheduleDetail(
          id: 's_new',
          ministryId: 'min_1',
          title: 'Novo Culto',
          date: '2026-10-01',
        );
  }

  @override
  Future<ScheduleDetail> updateSchedule(
      String ministryId, String scheduleId, Map<String, dynamic> data) async {
    lastUpdatedData = data;
    return detailToReturn ??
        const ScheduleDetail(
          id: 's_updated',
          ministryId: 'min_1',
          title: 'Culto Atualizado',
          date: '2026-10-01',
        );
  }

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async =>
      members;

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async => roles;
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
        Ministry(id: 'min_2', name: 'Min 2', role: 'admin'),
      ],
    );
  }

  void switchMinistry(Ministry ministry) {
    state = state.copyWith(selectedMinistry: ministry);
  }
}

void main() {
  late _FakeScheduleRepo fakeRepo;
  late _FakeRepertoireRepo fakeRepertoireRepo;
  late FakeMinistryContextNotifier ministryNotifier;

  setUp(() {
    fakeRepo = _FakeScheduleRepo();
    fakeRepo.members = [
      const MinistryMember(id: 'm1', userId: 'u1', name: 'Alice Silva', email: 'alice@test.com'),
      const MinistryMember(id: 'm2', userId: 'u2', name: 'Bob Souza', email: 'bob@test.com'),
    ];
    fakeRepo.roles = [
      const MinistryRole(id: 'r1', name: 'Vocal'),
      const MinistryRole(id: 'r2', name: 'Bateria'),
    ];
    fakeRepertoireRepo = _FakeRepertoireRepo();
    fakeRepertoireRepo.songsToReturn = [
      const SongSummary(
        id: 'song_1',
        ministryId: 'min_1',
        title: 'Porque Ele Vive',
        artistName: 'Harpa Cristã',
        originalKey: 'G',
      ),
      const SongSummary(
        id: 'song_2',
        ministryId: 'min_1',
        title: 'Vitorioso És',
        artistName: 'Gabriel Guedes',
        originalKey: 'A',
      ),
    ];
    ministryNotifier = FakeMinistryContextNotifier();
  });

  Widget createSubject({ScheduleDetail? initialSchedule}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
        scheduleRepositoryProvider.overrideWithValue(fakeRepo),
        repertoireRepositoryProvider.overrideWithValue(fakeRepertoireRepo),
      ],
      child: MaterialApp(
        home: ScheduleFormScreen(
          ministryId: 'min_1',
          initialSchedule: initialSchedule,
        ),
      ),
    );
  }

  group('ScheduleFormScreen Presentation & 5-Tab Architecture (R4-M1)', () {
    testWidgets('renders create form with 5 tabs and default values on Geral tab',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Nova Escala'), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_form_tab_bar')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_tab_geral')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_tab_integrantes')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_tab_musicas')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_tab_roteiro')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_tab_vestimenta')), findsOneWidget);

      expect(find.text('Culto'), findsOneWidget);
      expect(find.text('Informações do Evento'), findsOneWidget);
      expect(find.text('Exigir confirmação de presença'), findsOneWidget);
      expect(find.text('Visível para a equipe'), findsOneWidget);
      expect(find.text('Criar Escala'), findsOneWidget);

      // Navigate to Integrantes tab
      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();
      expect(find.text('Integrantes (0)'), findsWidgets);
      expect(find.text('Nenhum integrante adicionado à escala.'), findsOneWidget);
    });

    testWidgets('renders edit form with initial schedule data across tabs',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      const initial = ScheduleDetail(
        id: 'sch_99',
        ministryId: 'min_1',
        title: 'Vigília Especial',
        date: '2026-12-31',
        time: '22:00',
        durationMinutes: 180,
        notes: 'Trazer instrumentos acústicos',
        requireConfirmation: true,
        participants: [
          ScheduleParticipant(
              id: 'm1', userId: 'u1', name: 'Alice Silva', role: 'Vocal'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initial));
      await tester.pumpAndSettle();

      expect(find.text('Editar Escala'), findsOneWidget);
      expect(find.text('Vigília Especial'), findsOneWidget);
      expect(find.text('Salvar Alterações'), findsOneWidget);

      // Switch to Integrantes tab
      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      expect(find.text('Integrantes (1)'), findsWidgets);
      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Vocal'), findsOneWidget);
    });

    testWidgets('adding participant via member picker adds member to schedule',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      // Tap "Adicionar" button for participants
      await tester.tap(find.byKey(const ValueKey('add_participant_button')));
      await tester.pumpAndSettle();

      // Member picker sheet is open
      expect(find.text('Selecionar Integrante'), findsOneWidget);
      expect(find.text('Alice Silva'), findsOneWidget);

      // Select Alice
      await tester.tap(find.text('Alice Silva'));
      await tester.pumpAndSettle();

      // Role selection sheet is open
      expect(find.text('Função para Alice Silva'), findsOneWidget);
      expect(find.text('Confirmar e Adicionar'), findsOneWidget);

      // Confirm
      await tester.tap(find.text('Confirmar e Adicionar'));
      await tester.pumpAndSettle();

      // Participant is now in the list
      expect(find.text('Integrantes (1)'), findsWidgets);
      expect(find.text('Alice Silva'), findsOneWidget);
    });

    testWidgets('removing participant removes them from list', (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      const initial = ScheduleDetail(
        id: 'sch_99',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-10',
        participants: [
          ScheduleParticipant(
              id: 'm1', userId: 'u1', name: 'Alice Silva', role: 'Vocal'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initial));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsOneWidget);

      // Tap remove button
      await tester.tap(find.byIcon(Icons.remove_circle_outline));
      await tester.pumpAndSettle();

      expect(find.text('Alice Silva'), findsNothing);
      expect(find.text('Nenhum integrante adicionado à escala.'), findsOneWidget);
    });

    testWidgets('tenant switch pops screen when active ministry changes',
        (tester) async {
      final navKey = GlobalKey<NavigatorState>();
      final container = ProviderContainer(
        overrides: [
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(
              env: AppEnv.development,
              apiBaseUrl: 'http://localhost:3000/api/v1',
            ),
          ),
          preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
          ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
          ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier),
          scheduleRepositoryProvider.overrideWithValue(fakeRepo),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Previous Screen')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => const ScheduleFormScreen(ministryId: 'min_1'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Nova Escala'), findsOneWidget);

      // Ministry switches to min_2
      ministryNotifier.switchMinistry(
        const Ministry(id: 'min_2', name: 'Min 2', role: 'admin'),
      );
      await tester.pumpAndSettle();

      // Screen was popped
      expect(find.text('Previous Screen'), findsOneWidget);
    });

    testWidgets('all 5 tabs are reachable and render their respective content sections',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Tab 2: Músicas
      await tester.tap(find.byKey(const ValueKey('schedule_tab_musicas')));
      await tester.pumpAndSettle();
      expect(find.text('Músicas (0)'), findsWidgets);
      expect(find.text('Nenhuma música adicionada à escala.'), findsOneWidget);

      // Tab 3: Roteiro
      await tester.tap(find.byKey(const ValueKey('schedule_tab_roteiro')));
      await tester.pumpAndSettle();
      expect(find.text('Roteiro (0)'), findsWidgets);
      expect(find.text('Nenhum momento adicionado ao roteiro.'), findsOneWidget);

      // Tab 4: Vestimenta
      await tester.tap(find.byKey(const ValueKey('schedule_tab_vestimenta')));
      await tester.pumpAndSettle();
      expect(find.text('Vestimenta & Cores'), findsOneWidget);
      expect(find.text('Paleta de Cores / Tema'), findsOneWidget);
      expect(find.text('Tons Terrosos'), findsOneWidget);
    });

    testWidgets('adding song via song picker sheet and changing its musical key via compact selector',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_musicas')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('add_song_button')));
      await tester.pumpAndSettle();

      expect(find.text('Selecionar Música do Repertório'), findsOneWidget);
      expect(find.text('Porque Ele Vive'), findsOneWidget);

      await tester.tap(find.text('Porque Ele Vive'));
      await tester.pumpAndSettle();

      expect(find.text('Músicas (1)'), findsWidgets);
      expect(find.text('Porque Ele Vive'), findsOneWidget);
      expect(find.text('Tom: G'), findsOneWidget);

      // Tap song key chip to change key via compact picker sheet
      await tester.tap(find.byKey(const ValueKey('schedule_song_key_chip_0')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('musical_key_picker_sheet')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('key_option_A')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('key_option_A')));
      await tester.pumpAndSettle();

      expect(find.text('Tom: A'), findsOneWidget);
    });

    testWidgets('song picker sheet opens full-height, anchored to the top',
        (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('schedule_tab_musicas')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('add_song_button')));
      await tester.pumpAndSettle();

      final sheet = find.byKey(const ValueKey('song_picker_sheet'));
      expect(sheet, findsOneWidget);
      final rect = tester.getRect(sheet);
      // Occupies (almost) the whole viewport: header sits near the top and
      // the sheet reaches the bottom edge.
      expect(rect.top, lessThan(60));
      expect(rect.bottom, closeTo(800, 1));
      expect(find.text('Selecionar Música do Repertório'), findsOneWidget);
      expect(find.byType(TextField), findsWidgets);
    });

    testWidgets('member picker sheet opens full-height as well',
        (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('add_participant_button')));
      await tester.pumpAndSettle();

      final sheet = find.byKey(const ValueKey('member_picker_sheet'));
      expect(sheet, findsOneWidget);
      expect(tester.getRect(sheet).top, lessThan(60));
    });

    test('dark theme paints sheets, nav bar and system bars with dark surface',
        () {
      final dark = AppTheme.darkTheme;
      expect(dark.bottomSheetTheme.backgroundColor, AppColors.darkSurface);
      expect(dark.bottomSheetTheme.modalBackgroundColor, AppColors.darkSurface);
      expect(dark.bottomSheetTheme.surfaceTintColor, Colors.transparent);
      expect(AppTheme.darkSystemOverlayStyle.systemNavigationBarColor,
          AppColors.darkSurface);
      expect(AppTheme.darkSystemOverlayStyle.systemNavigationBarIconBrightness,
          Brightness.light);
      expect(dark.appBarTheme.systemOverlayStyle,
          AppTheme.darkSystemOverlayStyle);
    });

    testWidgets(
        'submit bar paints the surface color under the bottom system inset',
        (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1.0;
      tester.view.padding = const FakeViewPadding(bottom: 34);
      tester.view.viewPadding = const FakeViewPadding(bottom: 34);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetPadding);
      addTearDown(tester.view.resetViewPadding);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      final bar = tester.getRect(find.byKey(const ValueKey('schedule_submit_bar')));
      // The bar reaches the very bottom edge (inset is inside the bar).
      expect(bar.bottom, closeTo(800, 1));
      final button =
          tester.getRect(find.byKey(const ValueKey('schedule_submit_button')));
      expect(button.bottom, lessThanOrEqualTo(800 - 34));
    });

    testWidgets('adding timeline moment via timeline dialog adds item to schedule',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_roteiro')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('add_timeline_button')));
      await tester.pumpAndSettle();

      expect(find.text('Novo Momento'), findsOneWidget);

      await tester.enterText(
          find.widgetWithText(TextField, 'Título do momento *'),
          'Louvor de Abertura');
      await tester.enterText(
          find.widgetWithText(TextField, 'Horário previsto (opcional)'),
          '19:15');

      await tester.tap(find.text('Salvar'));
      await tester.pumpAndSettle();

      expect(find.text('Roteiro (1)'), findsWidgets);
      expect(find.text('Louvor de Abertura'), findsOneWidget);
      expect(find.text('19:15'), findsOneWidget);
    });

    testWidgets('adding clothing piece and selecting palette preset on Vestimenta tab',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_vestimenta')));
      await tester.pumpAndSettle();

      // Tap preset chip
      await tester.tap(find.text('Tons Terrosos'));
      await tester.pumpAndSettle();

      // Open clothing dialog
      await tester.tap(find.byKey(const ValueKey('add_clothing_button')));
      await tester.pumpAndSettle();

      expect(find.text('Adicionar Peça de Vestimenta'), findsOneWidget);
      await tester.enterText(
          find.widgetWithText(TextField, 'Descrição da peça *'),
          'Camisa Terracota');

      await tester.tap(find.byKey(const ValueKey('confirm_add_clothing_button')));
      await tester.pumpAndSettle();

      expect(find.text('Camisa Terracota'), findsOneWidget);
      expect(find.text('Peças (1)'), findsOneWidget);
    });

    testWidgets('switching tabs preserves unsaved draft state across all 5 tabs and submits complete payload',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Tab 0 (Geral): Enter custom title
      await tester.enterText(
        find.byKey(const ValueKey('schedule_title_input')),
        'Culto de Jovens',
      );
      await tester.pump();

      // Tab 2 (Músicas): Add song
      await tester.tap(find.byKey(const ValueKey('schedule_tab_musicas')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('add_song_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Porque Ele Vive'));
      await tester.pumpAndSettle();

      // Tab 3 (Roteiro): Add timeline
      await tester.tap(find.byKey(const ValueKey('schedule_tab_roteiro')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('add_timeline_button')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.widgetWithText(TextField, 'Título do momento *'),
          'Boas-vindas');
      await tester.tap(find.text('Salvar'));
      await tester.pumpAndSettle();

      // Tab 4 (Vestimenta): Add clothing piece & palette
      await tester.tap(find.byKey(const ValueKey('schedule_tab_vestimenta')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('add_clothing_button')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.widgetWithText(TextField, 'Descrição da peça *'),
          'Camisa Preta');
      await tester.tap(find.byKey(const ValueKey('confirm_add_clothing_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Preto e Branco'));
      await tester.pumpAndSettle();

      // Switch back to Geral tab and verify title was preserved
      await tester.tap(find.byKey(const ValueKey('schedule_tab_geral')));
      await tester.pumpAndSettle();
      expect(find.text('Culto de Jovens'), findsOneWidget);

      // Submit
      await tester.tap(find.text('Criar Escala'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastCreatedData, isNotNull);
      final data = fakeRepo.lastCreatedData!;
      expect(data['title'], equals('Culto de Jovens'));
      expect(data['colorPalette'], equals('Preto e Branco'));
      expect((data['songs'] as List).length, equals(1));
      expect((data['timeline'] as List).length, equals(1));
      expect((data['clothingPieces'] as List).length, equals(1));
    });

    testWidgets('editing one tab preserves preloaded data in all other tabs on save',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      const initial = ScheduleDetail(
        id: 'sch_existing',
        ministryId: 'min_1',
        title: 'Culto Original',
        date: '2026-10-24',
        time: '19:30',
        durationMinutes: 120,
        notes: 'Notas preservadas',
        participants: [
          ScheduleParticipant(
              id: 'm1', userId: 'u1', name: 'Alice Silva', role: 'Vocal'),
        ],
        songs: [
          ScheduleSong(
              id: 'song_1',
              title: 'Porque Ele Vive',
              artist: 'Harpa Cristã',
              key: 'G'),
        ],
        timeline: [
          ScheduleTimelineItem(
              id: 't1', title: 'Oração Inicial', time: '19:30', type: 'prayer'),
        ],
        clothingPieces: [
          ScheduleClothingPiece(
              name: 'Blazer Azul',
              description: 'Blazer Azul',
              colors: ['#2563EB']),
        ],
        colorPalette: 'Tons de Azul',
      );

      await tester.pumpWidget(createSubject(initialSchedule: initial));
      await tester.pumpAndSettle();

      // Modify only the title on Tab 0 (Geral)
      await tester.enterText(
        find.byKey(const ValueKey('schedule_title_input')),
        'Culto Renomeado',
      );
      await tester.pump();

      await tester.tap(find.text('Salvar Alterações'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastUpdatedData, isNotNull);
      final updated = fakeRepo.lastUpdatedData!;
      expect(updated['title'], equals('Culto Renomeado'));
      expect(updated['notes'], equals('Notas preservadas'));
      expect(updated['colorPalette'], equals('Tons de Azul'));
      expect((updated['participants'] as List).length, equals(1));
      expect((updated['songs'] as List).length, equals(1));
      expect((updated['timeline'] as List).length, equals(1));
      expect((updated['clothingPieces'] as List).length, equals(1));
    });

    testWidgets('validation failure on empty title switches back to Geral tab and shows error badge',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Clear title on Geral tab
      await tester.enterText(
        find.byKey(const ValueKey('schedule_title_input')),
        '',
      );
      await tester.pump();

      // Navigate away to Vestimenta tab
      await tester.tap(find.byKey(const ValueKey('schedule_tab_vestimenta')));
      await tester.pumpAndSettle();

      // Attempt to submit from Vestimenta tab
      await tester.tap(find.text('Criar Escala'));
      await tester.pumpAndSettle();

      // Form automatically navigates back to Geral tab and displays validation error
      expect(find.byKey(const ValueKey('schedule_tab_geral_error_badge')), findsOneWidget);
      expect(find.text('O título da escala é obrigatório.'), findsOneWidget);
      expect(fakeRepo.lastCreatedData, isNull);
    });

    testWidgets('renders all 5 tabs and single-line date without overflow on 320px, 360px, 393px widths and 1.3x text scale',
        (tester) async {
      const initial = ScheduleDetail(
        id: 'sch_narrow',
        ministryId: 'min_1',
        title: 'Culto de Domingo',
        date: '2026-10-24',
        time: '19:00',
      );

      for (final width in [320.0, 360.0, 393.0]) {
        tester.view.physicalSize = Size(width, 780);
        tester.view.devicePixelRatio = 1.0;

        await tester.pumpWidget(
          MediaQuery(
            data: MediaQueryData(
              size: Size(width, 780),
              textScaler: width == 320.0
                  ? const TextScaler.linear(1.3)
                  : TextScaler.noScaling,
            ),
            child: createSubject(initialSchedule: initial),
          ),
        );
        await tester.pumpAndSettle();

        final geralTabFinder = find.byKey(const ValueKey('schedule_tab_geral'));
        await tester.ensureVisible(geralTabFinder);
        await tester.tap(geralTabFinder);
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull,
            reason: 'No overflow on Geral tab at ${width}px');

        // Verify date 24/10/2026 is rendered on a single line (maxLines == 1)
        final dateText = tester.widget<Text>(find.text('24/10/2026'));
        expect(dateText.maxLines, equals(1));
        expect(dateText.softWrap, isFalse);

        for (final tabKey in [
          'schedule_tab_integrantes',
          'schedule_tab_musicas',
          'schedule_tab_roteiro',
          'schedule_tab_vestimenta',
        ]) {
          final tabFinder = find.byKey(ValueKey(tabKey));
          await tester.ensureVisible(tabFinder);
          await tester.tap(tabFinder);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull,
              reason: 'No overflow on $tabKey at ${width}px');
        }
      }

      addTearDown(tester.view.resetPhysicalSize);
    });

    testWidgets(
        'Roteiro template selector handles error/retry and applies template mapping selected songs into song slots',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      fakeRepo.templatesError = Exception('Network error');
      fakeRepo.templates = const [
        ScheduleTemplate(
          id: 'tpl_1',
          name: 'Culto Dominical Padrão',
          items: [
            ScheduleTemplateItem(
              id: 'ti_1',
              type: 'event',
              title: 'Boas-vindas e Oração',
              durationSeconds: 300,
              icon: 'Oração',
              order: 0,
            ),
            ScheduleTemplateItem(
              id: 'ti_2',
              type: 'song',
              title: 'Música 1',
              order: 1,
            ),
            ScheduleTemplateItem(
              id: 'ti_3',
              type: 'song',
              title: 'Música 2',
              order: 2,
            ),
          ],
        ),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Add 1 song on Músicas tab so slot 1 gets filled with 'Porque Ele Vive' and slot 2 stays 'Música 2'
      await tester.tap(find.byKey(const ValueKey('schedule_tab_musicas')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('add_song_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Porque Ele Vive'));
      await tester.pumpAndSettle();

      // Switch to Roteiro tab and open Modelos
      await tester.tap(find.byKey(const ValueKey('schedule_tab_roteiro')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('open_templates_button')));
      await tester.pumpAndSettle();

      // Error state is shown first
      expect(
        find.text('Não foi possível carregar os modelos de roteiro.'),
        findsOneWidget,
      );

      // Clear error and tap retry
      fakeRepo.templatesError = null;
      await tester.tap(find.byKey(const ValueKey('retry_load_templates_button')));
      await tester.pumpAndSettle();

      // Template list is shown
      expect(find.text('Culto Dominical Padrão'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('template_option_tpl_1')));
      await tester.pumpAndSettle();

      // Confirm preview view shows mapped song title and event duration
      expect(find.byKey(const ValueKey('apply_template_confirm_view')), findsOneWidget);
      expect(find.text('Boas-vindas e Oração'), findsOneWidget);
      expect(find.text('5min'), findsOneWidget);
      expect(find.text('Porque Ele Vive'), findsOneWidget);
      expect(find.text('Música 2'), findsOneWidget);

      // Apply template onto empty roteiro
      await tester.tap(find.byKey(const ValueKey('apply_template_replace_button')));
      await tester.pumpAndSettle();

      expect(find.text('Roteiro (3)'), findsWidgets);
      expect(find.text('Boas-vindas e Oração'), findsOneWidget);
      expect(find.text('Porque Ele Vive'), findsOneWidget);
      expect(find.text('Música 2'), findsOneWidget);
    });

    testWidgets(
        'Roteiro template selector supports both append and replace when existing timeline items exist',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      fakeRepo.templates = const [
        ScheduleTemplate(
          id: 'tpl_2',
          name: 'Encerramento',
          items: [
            ScheduleTemplateItem(
              id: 'ti_end',
              type: 'event',
              title: 'Bênção Apostólica',
              durationSeconds: 180,
              icon: 'Oração',
              order: 0,
            ),
          ],
        ),
      ];

      const initial = ScheduleDetail(
        id: 'sch_roteiro',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-24',
        timeline: [
          ScheduleTimelineItem(
            id: 'existing_1',
            title: 'Abertura Existente',
            time: '19:00',
            type: 'Evento',
          ),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initial));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_roteiro')));
      await tester.pumpAndSettle();
      expect(find.text('Abertura Existente'), findsOneWidget);

      // 1) Test APPEND mode
      await tester.tap(find.byKey(const ValueKey('open_templates_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('template_option_tpl_2')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('template_existing_items_warning')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('apply_template_append_button')));
      await tester.pumpAndSettle();

      // Both existing and appended items are present
      expect(find.text('Roteiro (2)'), findsWidgets);
      expect(find.text('Abertura Existente'), findsOneWidget);
      expect(find.text('Bênção Apostólica'), findsOneWidget);

      // 2) Test REPLACE mode
      await tester.tap(find.byKey(const ValueKey('open_templates_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('template_option_tpl_2')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('apply_template_replace_button')));
      await tester.pumpAndSettle();

      // Existing items replaced by template item
      expect(find.text('Roteiro (1)'), findsWidgets);
      expect(find.text('Abertura Existente'), findsNothing);
      expect(find.text('Bênção Apostólica'), findsOneWidget);
    });
  });
}
