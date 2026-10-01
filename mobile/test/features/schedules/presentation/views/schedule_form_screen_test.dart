import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
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
}

class _FakeMinistryRepo implements MinistryRepository {
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

class _FakeScheduleRepo implements ScheduleRepository {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];
  ScheduleDetail? detailToReturn;
  Map<String, dynamic>? lastCreatedData;
  Map<String, dynamic>? lastUpdatedData;

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

  group('ScheduleFormScreen Presentation', () {
    testWidgets('renders create form with default values', (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Nova Escala'), findsOneWidget);
      expect(find.text('Culto'), findsOneWidget);
      expect(find.text('Informações do Evento'), findsOneWidget);
      expect(find.text('Exigir confirmação de presença'), findsOneWidget);
      expect(find.text('Integrantes (0)'), findsOneWidget);
      expect(find.text('Nenhum integrante adicionado à escala.'), findsOneWidget);
      expect(find.text('Criar Escala'), findsOneWidget);
    });

    testWidgets('renders edit form with initial schedule data', (tester) async {
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
          ScheduleParticipant(id: 'm1', userId: 'u1', name: 'Alice Silva', role: 'Vocal'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initial));
      await tester.pumpAndSettle();

      expect(find.text('Editar Escala'), findsOneWidget);
      expect(find.text('Vigília Especial'), findsOneWidget);
      expect(find.text('Integrantes (1)'), findsOneWidget);
      expect(find.text('Alice Silva'), findsOneWidget);
      expect(find.text('Vocal'), findsOneWidget);
      expect(find.text('Salvar Alterações'), findsOneWidget);
    });

    testWidgets('adding participant via member picker adds member to schedule',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
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
      expect(find.text('Integrantes (1)'), findsOneWidget);
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
          ScheduleParticipant(id: 'm1', userId: 'u1', name: 'Alice Silva', role: 'Vocal'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initial));
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

    testWidgets('renders content sections: songs, timeline, clothing, and palette',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Músicas (0)'), findsOneWidget);
      expect(find.text('Nenhuma música adicionada à escala.'), findsOneWidget);
      expect(find.text('Roteiro (0)'), findsOneWidget);
      expect(find.text('Nenhum momento adicionado ao roteiro.'), findsOneWidget);
      expect(find.text('Vestimenta & Cores'), findsOneWidget);
      expect(find.text('Paleta de Cores / Tema'), findsOneWidget);
      expect(find.text('Tons Terrosos'), findsOneWidget);
    });

    testWidgets('adding song via song picker sheet adds song to schedule',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('add_song_button')));
      await tester.pumpAndSettle();

      expect(find.text('Selecionar Música do Repertório'), findsOneWidget);
      expect(find.text('Porque Ele Vive'), findsOneWidget);

      await tester.tap(find.text('Porque Ele Vive'));
      await tester.pumpAndSettle();

      expect(find.text('Músicas (1)'), findsOneWidget);
      expect(find.text('Porque Ele Vive'), findsOneWidget);
      expect(find.text('Tom: G'), findsOneWidget);
    });

    testWidgets('adding timeline moment via timeline dialog adds item to schedule',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
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

      expect(find.text('Roteiro (1)'), findsOneWidget);
      expect(find.text('Louvor de Abertura'), findsOneWidget);
      expect(find.text('19:15'), findsOneWidget);
    });

    testWidgets('adding clothing piece and selecting palette preset',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
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

    testWidgets('save button submits songs, timeline, clothing, and palette',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Add song
      await tester.tap(find.byKey(const ValueKey('add_song_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Porque Ele Vive'));
      await tester.pumpAndSettle();

      // Add timeline
      await tester.tap(find.byKey(const ValueKey('add_timeline_button')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.widgetWithText(TextField, 'Título do momento *'),
          'Boas-vindas');
      await tester.tap(find.text('Salvar'));
      await tester.pumpAndSettle();

      // Add clothing piece
      await tester.tap(find.byKey(const ValueKey('add_clothing_button')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.widgetWithText(TextField, 'Descrição da peça *'),
          'Camisa Preta');
      await tester.tap(find.byKey(const ValueKey('confirm_add_clothing_button')));
      await tester.pumpAndSettle();

      // Set palette
      await tester.tap(find.text('Preto e Branco'));
      await tester.pumpAndSettle();

      // Submit
      await tester.tap(find.text('Criar Escala'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastCreatedData, isNotNull);
      final data = fakeRepo.lastCreatedData!;
      expect(data['colorPalette'], equals('Preto e Branco'));
      expect((data['songs'] as List).length, equals(1));
      expect((data['timeline'] as List).length, equals(1));
      expect((data['clothingPieces'] as List).length, equals(1));
    });
  });
}
