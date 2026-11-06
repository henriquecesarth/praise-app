import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_form_screen.dart';

class _FakeAvailabilityRepo implements AvailabilityRepository {
  int checkCalls = 0;
  bool shouldThrow = false;
  Set<String> conflictingIds = {'m1'};

  @override
  Future<ScheduleConflictCheckResponse> checkScheduleConflicts(
    String ministryId,
    CheckScheduleConflictsPayload payload,
  ) async {
    checkCalls++;
    if (shouldThrow) {
      throw const AppFailure(
        message: 'Falha temporária ao verificar disponibilidade.',
      );
    }

    return ScheduleConflictCheckResponse(
      scheduleWindow: ScheduleCivilWindow(
        startsAt: '${payload.date}T${payload.time}:00',
        endsAt: '${payload.date}T21:00:00',
        durationMinutes: payload.durationMinutes ?? 120,
      ),
      conflicts: payload.participantIds.map((id) {
        final isConflict = conflictingIds.contains(id);
        return ParticipantConflictResult(
          participantId: id,
          memberId: id,
          hasConflict: isConflict,
          unavailabilities: isConflict
              ? [
                  ParticipantConflictDetail(
                    id: 'u_$id',
                    startsAt: '${payload.date}T19:00:00',
                    endsAt: '${payload.date}T21:00:00',
                    allDay: false,
                  )
                ]
              : [],
        );
      }).toList(),
    );
  }

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(String ministryId,
          {int limit = 50, String? cursor}) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> createMyAvailability(
          String ministryId, CreateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateMyAvailability(String ministryId, String id,
          UpdateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) =>
      throw UnimplementedError();

  @override
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
          String ministryId,
          {required String from,
          required String to,
          String? memberId,
          int limit = 50,
          String? cursor}) =>
      throw UnimplementedError();

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
          String ministryId, String memberId,
          {int limit = 50, String? cursor}) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> createManualMemberAvailability(
          String ministryId,
          String memberId,
          CreateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<MemberAvailability> updateManualMemberAvailability(
          String ministryId,
          String memberId,
          String id,
          UpdateAvailabilityPayload payload) =>
      throw UnimplementedError();

  @override
  Future<void> deleteManualMemberAvailability(
          String ministryId, String memberId, String id) =>
      throw UnimplementedError();
}

class _FakeRepertoireRepo implements RepertoireRepository {
  @override
  Future<PaginatedSongs> listSongs(String ministryId,
          {String? search, String? classificationId, String? cursor, int? page, int? limit}) async =>
      const PaginatedSongs(songs: [], total: 0);

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) =>
      throw UnimplementedError();

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [];

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) =>
      throw UnimplementedError();

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) =>
      throw UnimplementedError();

  @override
  Future<void> deleteSong(String ministryId, String songId) async {}

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [];

  @override
  Future<Artist> createArtist(String ministryId, String name) =>
      throw UnimplementedError();
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

class _FakeScheduleRepo implements ScheduleRepository {
  List<MinistryMember> members = [];
  List<MinistryRole> roles = [];
  int createCalls = 0;
  int updateCalls = 0;

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async =>
      members;

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async => roles;

  @override
  Future<ScheduleDetail> createSchedule(
      String ministryId, Map<String, dynamic> data) async {
    createCalls++;
    return const ScheduleDetail(
      id: 's_new',
      ministryId: 'min_1',
      title: 'Culto',
      date: '2026-10-25',
    );
  }

  @override
  Future<ScheduleDetail> updateSchedule(
      String ministryId, String scheduleId, Map<String, dynamic> data) async {
    updateCalls++;
    return const ScheduleDetail(
      id: 's_updated',
      ministryId: 'min_1',
      title: 'Culto Atualizado',
      date: '2026-10-25',
    );
  }

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

  @override
  Future<ScheduleDetail> getScheduleDetail(
          String ministryId, String scheduleId) async =>
      const ScheduleDetail(id: 's1', ministryId: 'min_1', title: 'Culto', date: '2026-10-25');

  @override
  Future<ScheduleDetail> confirmParticipation(
          String ministryId, String scheduleId, bool confirmed) =>
      throw UnimplementedError();

  @override
  Future<List<ScheduleComment>> getComments(
          String ministryId, String scheduleId) async =>
      [];

  @override
  Future<ScheduleComment> postComment(
          String ministryId, String scheduleId, String content) =>
      throw UnimplementedError();
}

class _FakeMinistryContextNotifier extends MinistryContextNotifier {
  _FakeMinistryContextNotifier()
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

void main() {
  late _FakeScheduleRepo fakeScheduleRepo;
  late _FakeAvailabilityRepo fakeAvailabilityRepo;
  late _FakeRepertoireRepo fakeRepertoireRepo;
  late _FakeMinistryContextNotifier ministryNotifier;

  setUp(() {
    fakeScheduleRepo = _FakeScheduleRepo();
    fakeScheduleRepo.members = [
      const MinistryMember(
          id: 'm1', userId: 'u1', name: 'Alice Silva', email: 'alice@test.com'),
      const MinistryMember(
          id: 'm2', userId: 'u2', name: 'Bob Souza', email: 'bob@test.com'),
    ];
    fakeScheduleRepo.roles = [
      const MinistryRole(id: 'r1', name: 'Vocal'),
      const MinistryRole(id: 'r2', name: 'Bateria'),
    ];

    fakeAvailabilityRepo = _FakeAvailabilityRepo();
    fakeRepertoireRepo = _FakeRepertoireRepo();
    ministryNotifier = _FakeMinistryContextNotifier();
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
        scheduleRepositoryProvider.overrideWithValue(fakeScheduleRepo),
        availabilityRepositoryProvider.overrideWithValue(fakeAvailabilityRepo),
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

  group('ScheduleFormScreen Availability Conflict Widgets', () {
    testWidgets('renders warning banner and tab badge when conflicting participant is present',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      const initialSchedule = ScheduleDetail(
        id: 'sched_1',
        ministryId: 'min_1',
        title: 'Culto de Domingo',
        date: '2026-10-25',
        time: '19:00',
        participants: [
          ScheduleParticipant(id: 'm1', name: 'Alice Silva', role: 'Vocal'),
          ScheduleParticipant(id: 'm2', name: 'Bob Souza', role: 'Bateria'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initialSchedule));
      await tester.pumpAndSettle();

      // Tab conflict badge is visible in TabBar even from Geral tab
      final tabBadgeFinder = find.byKey(const ValueKey('tab_conflict_badge'));
      expect(tabBadgeFinder, findsOneWidget);
      expect(find.descendant(of: tabBadgeFinder, matching: find.text('1')), findsOneWidget);

      // Switch to Integrantes tab to inspect conflict banner and participant badges
      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      // Warning banner is displayed
      final bannerFinder = find.byKey(const ValueKey('schedule_conflict_warning_banner'));
      expect(bannerFinder, findsOneWidget);
      expect(
        find.text('1 integrante escalado está indisponível neste horário.'),
        findsOneWidget,
      );
      expect(
        find.text('Aviso informativo: você ainda pode salvar a escala normalmente.'),
        findsOneWidget,
      );

      // Inline participant conflict badge on m1
      expect(find.byKey(const ValueKey('participant_conflict_badge_m1')), findsOneWidget);
      expect(find.byKey(const ValueKey('participant_conflict_badge_m2')), findsNothing);
    });

    testWidgets('member picker sheet displays conflict badge and remains selectable',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Switch to Integrantes tab
      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      // Open member picker
      final addParticipantBtn = find.byKey(const ValueKey('add_participant_button'));
      expect(addParticipantBtn, findsOneWidget);
      await tester.tap(addParticipantBtn);
      await tester.pumpAndSettle();

      // Alice (m1) has conflict badge in picker sheet
      final m1Badge = find.byKey(const ValueKey('member_picker_conflict_badge_m1'));
      expect(m1Badge, findsOneWidget);
      expect(find.descendant(of: m1Badge, matching: find.text('Indisponível')), findsOneWidget);

      // Bob (m2) has no conflict badge
      expect(find.byKey(const ValueKey('member_picker_conflict_badge_m2')), findsNothing);

      // Alice's row is STILL SELECTABLE (advisory only)
      await tester.tap(find.text('Alice Silva'));
      await tester.pumpAndSettle();

      // Role sheet opens
      expect(find.text('Função para Alice Silva'), findsOneWidget);
      await tester.tap(find.text('Confirmar e Adicionar'));
      await tester.pumpAndSettle();

      // Now Alice is in the schedule and the conflict warning banner is displayed!
      expect(find.byKey(const ValueKey('schedule_conflict_warning_banner')), findsOneWidget);
      expect(find.byKey(const ValueKey('participant_conflict_badge_m1')), findsOneWidget);
    });

    testWidgets('displays error banner and handles retry button',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      fakeAvailabilityRepo.shouldThrow = true;

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Switch to Integrantes tab
      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      // Error banner rendered
      final errorBanner = find.byKey(const ValueKey('schedule_conflict_error_banner'));
      expect(errorBanner, findsOneWidget);
      expect(
        find.text('Não foi possível verificar a disponibilidade dos integrantes.'),
        findsOneWidget,
      );

      // Tap retry button after fixing repository
      fakeAvailabilityRepo.shouldThrow = false;
      final retryBtn = find.byKey(const ValueKey('retry_conflict_check_button'));
      expect(retryBtn, findsOneWidget);
      await tester.tap(retryBtn);
      await tester.pumpAndSettle();

      // Error banner cleared
      expect(find.byKey(const ValueKey('schedule_conflict_error_banner')), findsNothing);
    });

    testWidgets('advisory save: can save schedule normally despite conflict warning',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      const initialSchedule = ScheduleDetail(
        id: 'sched_1',
        ministryId: 'min_1',
        title: 'Culto Especial',
        date: '2026-10-25',
        time: '19:00',
        participants: [
          ScheduleParticipant(id: 'm1', name: 'Alice Silva', role: 'Vocal'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initialSchedule));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      // Conflict warning banner is visible
      expect(find.byKey(const ValueKey('schedule_conflict_warning_banner')), findsOneWidget);

      // Save button in AppBar is enabled
      final saveBtn = find.widgetWithText(TextButton, 'Salvar');
      expect(saveBtn, findsOneWidget);
      await tester.tap(saveBtn);
      await tester.pumpAndSettle();

      expect(fakeScheduleRepo.updateCalls, 1);
    });

    testWidgets('Privacy Invariant: reason or personal notes are NEVER rendered anywhere',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      const initialSchedule = ScheduleDetail(
        id: 'sched_1',
        ministryId: 'min_1',
        title: 'Culto',
        date: '2026-10-25',
        time: '19:00',
        participants: [
          ScheduleParticipant(id: 'm1', name: 'Alice Silva', role: 'Vocal'),
        ],
      );

      await tester.pumpWidget(createSubject(initialSchedule: initialSchedule));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_tab_integrantes')));
      await tester.pumpAndSettle();

      // Verify privacy invariant
      expect(find.textContaining('motivo'), findsNothing);
      expect(find.textContaining('razão'), findsNothing);
      expect(find.textContaining('reason'), findsNothing);
      expect(find.textContaining('médico'), findsNothing);
      expect(find.textContaining('viagem'), findsNothing);
    });
  });
}
