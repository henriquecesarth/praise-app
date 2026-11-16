import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/song_detail_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_detail_controller.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_detail_view.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_repertoire_link_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/song_smart_chords_controller.dart';

class FakeDetailScheduleRepo
    implements ScheduleRepository, ScheduleDeletionCapable {
  ScheduleDetail? detail;
  List<ScheduleComment> comments = [];
  Exception? detailError;
  Exception? confirmError;
  Exception? commentPostError;
  Exception? commentLoadError;
  Exception? deleteError;

  bool? lastConfirmed;
  String? lastPostedComment;
  int deleteCalls = 0;
  int commentReads = 0;
  int commentPosts = 0;

  @override
  Future<void> deleteSchedule(String ministryId, String scheduleId) async {
    deleteCalls++;
    if (deleteError != null) throw deleteError!;
  }

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async => [];

  @override
  Future<ScheduleDetail> getScheduleDetail(
      String ministryId, String scheduleId) async {
    if (detailError != null) throw detailError!;
    return detail!;
  }

  @override
  Future<ScheduleDetail> confirmParticipation(
      String ministryId, String scheduleId, bool confirmed) async {
    lastConfirmed = confirmed;
    if (confirmError != null) throw confirmError!;
    // Return updated schedule
    final updatedParticipants = detail!.participants.map((p) {
      if (p.id == 'p1') {
        return ScheduleParticipant(
          id: p.id,
          name: p.name,
          role: p.role,
          confirmed: confirmed,
        );
      }
      return p;
    }).toList();

    return ScheduleDetail(
      id: detail!.id,
      ministryId: detail!.ministryId,
      title: detail!.title,
      date: detail!.date,
      time: detail!.time,
      durationMinutes: detail!.durationMinutes,
      participants: updatedParticipants,
      songs: detail!.songs,
      timeline: detail!.timeline,
      clothingPieces: detail!.clothingPieces,
      notes: detail!.notes,
    );
  }

  @override
  Future<List<ScheduleComment>> getComments(
      String ministryId, String scheduleId) async {
    commentReads++;
    if (commentLoadError != null) throw commentLoadError!;
    return List.of(comments);
  }

  @override
  Future<ScheduleComment> postComment(
      String ministryId, String scheduleId, String content) async {
    commentPosts++;
    lastPostedComment = content;
    if (commentPostError != null) throw commentPostError!;
    final comment = ScheduleComment(
      id: 'comment_new',
      scheduleId: scheduleId,
      ministryId: ministryId,
      userId: 'user_1',
      userName: 'Membro Teste',
      content: content,
      createdAt: '2026-09-25T14:30:00Z',
    );
    comments = [...comments, comment];
    return comment;
  }

  @override
  Future<ScheduleDetail> createSchedule(
          String ministryId, Map<String, dynamic> data) async =>
      detail!;

  @override
  Future<ScheduleDetail> updateSchedule(String ministryId, String scheduleId,
          Map<String, dynamic> data) async =>
      detail!;

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async => [];

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async => [];
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

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier([MinistryContextState? initialState])
      : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = initialState ??
        const MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          selectedMinistry:
              Ministry(id: 'min_1', name: 'Min 1', role: 'member'),
          availableMinistries: [
            Ministry(id: 'min_1', name: 'Min 1', role: 'member'),
            Ministry(id: 'min_2', name: 'Min 2', role: 'member'),
          ],
        );
  }

  void switchMinistry(Ministry ministry) {
    state = state.copyWith(selectedMinistry: ministry);
  }
}

class TestAuthRepo implements AuthRepository {
  @override
  Stream<fb.User?> authStateChanges() => const Stream.empty();
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class TestAuthNotifier extends AuthNotifier {
  TestAuthNotifier() : super(TestAuthRepo()) {
    state = const AuthState.authenticated(AuthUser(id: 'user_1', email: 'test@example.com', name: 'Membro Teste'));
  }
  void changeUser() { state = const AuthState.unauthenticated(); }
}

void main() {
  late FakeDetailScheduleRepo fakeRepo;

  setUp(() {
    fakeRepo = FakeDetailScheduleRepo();
    fakeRepo.detail = const ScheduleDetail(
      id: 'sch_1',
      ministryId: 'min_1',
      title: 'Culto de Domingo Especial',
      date: '2099-10-01',
      time: '19:30',
      durationMinutes: 120,
      notes: 'Chegar com 30min de antecedência para aquecimento.',
      participants: [
        ScheduleParticipant(
          id: 'p1',
          userId: 'user_1',
          name: 'Henrique Vocal',
          role: 'Ministro',
          confirmed: null,
        ),
        ScheduleParticipant(
          id: 'p2',
          name: 'Ana Teclado',
          role: 'Tecladista',
          confirmed: true,
        ),
      ],
      songs: [
        ScheduleSong(
          id: 's1',
          title: 'Bondade de Deus',
          artist: 'Isaías Saad',
          key: 'G',
        ),
        ScheduleSong(id: 's2', title: 'A Casa É Sua', artist: 'Casa Worship'),
      ],
      timeline: [
        ScheduleTimelineItem(
            id: 't1',
            title: 'Abertura e Oração',
            time: '19:30',
            type: 'prayer'),
        ScheduleTimelineItem(
            id: 't2',
            title: 'Louvor Congregacional',
            time: '19:40',
            type: 'worship'),
      ],
      clothingPieces: [
        ScheduleClothingPiece(
            description: 'Camisa Preta e Calça Jeans Escura',
            colorHex: '#000000'),
      ],
      colorPalette: 'Tons Terrosos',
    );
    fakeRepo.comments = [
      const ScheduleComment(
        id: 'c1',
        scheduleId: 'sch_1',
        ministryId: 'min_1',
        userId: 'u2',
        userName: 'Ana Teclado',
        content: 'Qual o tom da primeira música?',
        createdAt: '2026-09-24T18:00:00Z',
      ),
    ];
  });

  Widget createSubject({String role = 'member'}) {
    return ProviderScope(
      overrides: [
        authNotifierProvider.overrideWith((ref) => TestAuthNotifier()),
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        scheduleRepositoryProvider.overrideWithValue(fakeRepo),
        scheduleDetailNotifierProvider.overrideWith((ref) {
          return ScheduleDetailNotifier(repository: fakeRepo);
        }),
        commentsNotifierProvider.overrideWith((ref) {
          return CommentsNotifier(repository: fakeRepo);
        }),
        ministryContextNotifierProvider.overrideWith(
          (ref) => FakeMinistryContextNotifier(
            MinistryContextState(
              status: MinistryBootstrapStatus.ready,
              selectedMinistry:
                  Ministry(id: 'min_1', name: 'Min 1', role: role),
              availableMinistries: [
                Ministry(id: 'min_1', name: 'Min 1', role: role),
              ],
            ),
          ),
        ),
      ],
      child: const MaterialApp(
        home: ScheduleDetailView(
          ministryId: 'min_1',
          scheduleId: 'sch_1',
        ),
      ),
    );
  }

  group('ScheduleDetailView Presentation', () {
    testWidgets('renders all schedule detail sections correctly',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Title & Date/time/duration
      expect(find.text('Culto de Domingo Especial'), findsWidgets);
      expect(find.text('01/10/2099'), findsOneWidget);
      expect(find.text('19:30'), findsWidgets);
      expect(find.text('Duração: 2h'), findsOneWidget);

      // Detalhes tab (default): notes, clothing & palette, comments
      expect(find.text('Chegar com 30min de antecedência para aquecimento.'),
          findsOneWidget);
      expect(find.text('Camisa Preta e Calça Jeans Escura'), findsOneWidget);
      expect(find.text('Tons Terrosos'), findsOneWidget);
      expect(find.text('Qual o tom da primeira música?'), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Bondade de Deus'), findsOneWidget);

      // Participantes tab
      expect(find.text('Henrique Vocal'), findsOneWidget);
      expect(find.text('Ana Teclado'), findsOneWidget);

      // Músicas tab
      expect(find.text('Bondade de Deus'), findsOneWidget);
      expect(find.text('A Casa É Sua'), findsOneWidget);

      // Roteiro tab
      expect(find.text('Abertura e Oração'), findsOneWidget);
      expect(find.text('Louvor Congregacional'), findsOneWidget);
    });

    testWidgets('shows hero summary and scrolling sections without inline composer', (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('schedule_detail_hero')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_detail_accent_bar')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_detail_tab_bar')), findsNothing);
      for (final k in ['participantes', 'musicas', 'roteiro', 'vestimenta']) {
        expect(find.byKey(ValueKey('schedule_detail_stat_$k')), findsOneWidget);
      }
      // Tapping a summary stat switches to the matching tab.
      expect(find.text('Bondade de Deus'), findsOneWidget);
      // Composer is only pinned on the Detalhes tab.
      expect(find.byTooltip('Enviar comentário'), findsNothing);
    });

    testWidgets('empty sections show an explicit empty state', (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      fakeRepo.detail = const ScheduleDetail(
        id: 'sch_1',
        ministryId: 'min_1',
        title: 'Escala Vazia',
        date: '2099-10-01',
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Músicas Escaladas (0)'), findsOneWidget);
      expect(find.textContaining('Participantes'), findsWidgets);
      expect(find.text('Nenhum momento no roteiro desta escala.'), findsOneWidget);
    });

    testWidgets(
        'confirmation action calls server and updates participation state',
        (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Find "Confirmar" button and tap
      final confirmButton = find.text('Confirmar');
      expect(confirmButton, findsOneWidget);

      await tester.ensureVisible(confirmButton);
      await tester.tap(confirmButton);
      await tester.pumpAndSettle();

      expect(fakeRepo.lastConfirmed, isTrue);
    });

    testWidgets('decline action calls server with false', (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      final declineButton = find.text('Não vou');
      expect(declineButton, findsOneWidget);

      await tester.ensureVisible(declineButton);
      await tester.tap(declineButton);
      await tester.pumpAndSettle();

      expect(fakeRepo.lastConfirmed, isFalse);
    });

    testWidgets('confirmation failure displays error alert', (tester) async {
      fakeRepo.confirmError = const AppFailure(
        message: 'Você não está listado como participante desta escala.',
        statusCode: 403,
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Confirmar'));
      await tester.tap(find.text('Confirmar'));
      await tester.pumpAndSettle();

      expect(find.text('Você não está listado como participante desta escala.'),
          findsOneWidget);
    });

    testWidgets('posting a comment submits to backend and renders in list',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('open_schedule_chat')));
      await tester.pumpAndSettle();
      expect(find.text('Chat da Escala'), findsOneWidget);
      final input = find.byType(TextField);
      expect(input, findsOneWidget);

      await tester.enterText(input, 'Tom de Sol Maior!');
      await tester.pump();

      final sendButton = find.byTooltip('Enviar comentário');
      expect(sendButton, findsOneWidget);

      await tester.tap(sendButton);
      await tester.pumpAndSettle();

      expect(fakeRepo.lastPostedComment, equals('Tom de Sol Maior!'));
      expect(find.text('Tom de Sol Maior!'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(ScheduleDetailView), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets(
        'commercial restriction disables comment posting and displays restriction banner',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      fakeRepo.commentPostError = const AppFailure(
        message: 'Acesso suspenso para novas postagens.',
        code: 'SUBSCRIPTION_RESTRICTED',
        statusCode: 403,
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('open_schedule_chat')));
      await tester.pumpAndSettle();
      expect(find.text('Chat da Escala'), findsOneWidget);
      final input = find.byType(TextField);
      await tester.enterText(input, 'Comentário bloqueado');
      await tester.pump();

      await tester.tap(find.byTooltip('Enviar comentário'));
      await tester.pumpAndSettle();

      // Banner appears
      expect(
          find.textContaining(
              'O envio de comentários está temporariamente indisponível'),
          findsOneWidget);
      // Input is disabled
      final textField = tester.widget<TextField>(input);
      expect(textField.enabled, isFalse);
    });

    testWidgets('handles 404 schedule not found by offering back button',
        (tester) async {
      fakeRepo.detailError = const AppFailure(
        message: 'Escala não encontrada.',
        statusCode: 404,
      );

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Escala não encontrada.'), findsOneWidget);
      expect(find.text('Voltar à Lista'), findsOneWidget);
    });

    testWidgets(
        'does not render stale schedule when detailState ministryId does not match',
        (tester) async {
      final subject = ProviderScope(
        overrides: [
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(
              env: AppEnv.development,
              apiBaseUrl: 'http://localhost:3000/api/v1',
            ),
          ),
          scheduleRepositoryProvider.overrideWithValue(fakeRepo),
          scheduleDetailNotifierProvider.overrideWith((ref) {
            final notifier = ScheduleDetailNotifier(repository: fakeRepo);
            // Pre-seed state with a different ministry
            notifier.state = const ScheduleDetailState(
              ministryId: 'min_other',
              scheduleId: 'sch_other',
              schedule: ScheduleDetail(
                id: 'sch_other',
                ministryId: 'min_other',
                title: 'Stale Other Ministry Schedule',
                date: '2099-01-01',
              ),
            );
            return notifier;
          }),
          commentsNotifierProvider.overrideWith((ref) {
            return CommentsNotifier(repository: fakeRepo);
          }),
          ministryContextNotifierProvider
              .overrideWith((ref) => FakeMinistryContextNotifier()),
        ],
        child: const MaterialApp(
          home: ScheduleDetailView(
            ministryId: 'min_1',
            scheduleId: 'sch_1',
          ),
        ),
      );

      await tester.pumpWidget(subject);
      // Stale schedule from min_other must not be shown
      expect(find.text('Stale Other Ministry Schedule'), findsNothing);

      await tester.pumpAndSettle();
      // Fresh schedule from min_1 is rendered
      expect(find.text('Culto de Domingo Especial'), findsWidgets);
    });

    testWidgets('pops detail screen when active ministry changes',
        (tester) async {
      final navKey = GlobalKey<NavigatorState>();
      final ministryNotifier = FakeMinistryContextNotifier();
      final container = ProviderContainer(
        overrides: [
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(
              env: AppEnv.development,
              apiBaseUrl: 'http://localhost:3000/api/v1',
            ),
          ),
          scheduleRepositoryProvider.overrideWithValue(fakeRepo),
          ministryContextNotifierProvider
              .overrideWith((ref) => ministryNotifier),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            navigatorKey: navKey,
            home: const Scaffold(body: Text('Shell Screen')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Push ScheduleDetailView
      navKey.currentState!.push(
        MaterialPageRoute(
          builder: (_) => const ScheduleDetailView(
            ministryId: 'min_1',
            scheduleId: 'sch_1',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Culto de Domingo Especial'), findsWidgets);

      // Now switch active ministry in ministryContextNotifierProvider to min_2
      ministryNotifier.switchMinistry(
        const Ministry(
          id: 'min_2',
          name: 'Ministério 2',
          role: 'member',
        ),
      );

      await tester.pumpAndSettle();

      // Detail screen popped back to Shell Screen
      expect(find.text('Shell Screen'), findsOneWidget);
    });

    testWidgets('ordinary member does not see edit or delete schedule buttons',
        (tester) async {
      await tester.pumpWidget(createSubject(role: 'member'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('edit_schedule_button')), findsNothing);
      expect(find.byKey(const ValueKey('delete_schedule_button')), findsNothing);
    });

    testWidgets(
        'admin sees edit schedule button and clicking opens ScheduleFormScreen',
        (tester) async {
      await tester.pumpWidget(createSubject(role: 'admin'));
      await tester.pumpAndSettle();

      final editBtn = find.byKey(const ValueKey('edit_schedule_button'));
      expect(editBtn, findsOneWidget);

      await tester.tap(editBtn);
      await tester.pumpAndSettle();

      expect(find.text('Editar Escala'), findsOneWidget);
      expect(find.text('Culto de Domingo Especial'), findsWidgets);
    });

    testWidgets(
        'admin sees delete schedule button and confirming deletion calls deleteSchedule',
        (tester) async {
      await tester.pumpWidget(createSubject(role: 'admin'));
      await tester.pumpAndSettle();

      final deleteBtn = find.byKey(const ValueKey('delete_schedule_button'));
      expect(deleteBtn, findsOneWidget);

      await tester.tap(deleteBtn);
      await tester.pumpAndSettle();

      expect(find.text('Excluir escala?'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('confirm_delete_schedule_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.deleteCalls, equals(1));
    });

    testWidgets('displays song key badge, timeline type labels, and stats summary row',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('schedule_detail_stats_row')), findsOneWidget);
      expect(find.byKey(const ValueKey('detail_song_key_s1')), findsOneWidget);
      expect(find.text('Tom: G'), findsOneWidget);
      expect(find.text('Oração'), findsOneWidget);
      expect(find.text('Louvor'), findsOneWidget);
    });

    testWidgets('renders schedule detail without overflow at 320px, 360px, and 393px widths and 1.3x text scale',
        (tester) async {
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
            child: createSubject(role: 'admin'),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'No overflow on ScheduleDetailView at ${width}px');
        expect(MediaQuery.textScalerOf(tester.element(find.byType(ScheduleDetailView))).scale(10),
          width == 320 ? 13 : 10);
        for (final label in ['Roteiro do Culto', 'Vestimenta', 'Observações']) {
          await tester.ensureVisible(find.text(label).last);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'No overflow at $width for $label');
        }
      }

      addTearDown(tester.view.resetPhysicalSize);
    });

    testWidgets(
        'tapping a song in _SongsSection preserves saved sequence, repeated songs and versions on SongDetailView',
        (tester) async {
      fakeRepo.detail = const ScheduleDetail(
        id: 'sch_1',
        ministryId: 'min_1',
        title: 'Culto de Domingo Especial',
        date: '2099-10-01',
        time: '19:30',
        songs: [
          ScheduleSong(
            id: 's1',
            title: 'Bondade de Deus',
            versionId: 'v1',
            versionName: 'Original',
            key: 'G',
          ),
          ScheduleSong(
            id: 's2',
            title: 'A Casa É Sua',
            versionId: 'v_casa',
            versionName: 'Original',
            key: 'C',
          ),
          ScheduleSong(
            id: 's1',
            title: 'Bondade de Deus',
            versionId: 'v2',
            versionName: 'Acústica',
            key: 'A',
          ),
        ],
        timeline: [],
        participants: [],
      );

      final repRepo = _FakeNavRepertoireRepo({
        's1': const SongDetail(
          id: 's1',
          ministryId: 'min_1',
          title: 'Bondade de Deus',
          originalKey: 'G',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'G'),
            SongVersion(id: 'v2', name: 'Acústica', key: 'A'),
          ],
        ),
        's2': const SongDetail(
          id: 's2',
          ministryId: 'min_1',
          title: 'A Casa É Sua',
          originalKey: 'C',
          versions: [SongVersion(id: 'v_casa', name: 'Original', key: 'C')],
        ),
      });
      final linkRepo = _FakeNavLinkRepo();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authNotifierProvider.overrideWith((ref) => TestAuthNotifier()),
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            preferencesStorageProvider
                .overrideWithValue(_FakePreferencesStorage()),
            ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
            scheduleRepositoryProvider.overrideWithValue(fakeRepo),
            scheduleDetailNotifierProvider.overrideWith(
              (ref) => ScheduleDetailNotifier(repository: fakeRepo),
            ),
            commentsNotifierProvider.overrideWith(
              (ref) => CommentsNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(),
            ),
            repertoireRepositoryProvider.overrideWithValue(repRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: repRepo),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
          ],
          child: const MaterialApp(
            home: ScheduleDetailView(
              ministryId: 'min_1',
              scheduleId: 'sch_1',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final thirdRow = find.byKey(const ValueKey('detail_song_row_3'));
      await tester.ensureVisible(thirdRow);
      await tester.pumpAndSettle();
      await tester.tap(thirdRow);
      await tester.pumpAndSettle();

      final songView = tester.widget<SongDetailView>(
        find.byType(SongDetailView),
      );
      expect(songView.songId, equals('s1'));
      expect(songView.initialVersionId, equals('v2'));
      expect(songView.backLabel, equals('Voltar para Escala'));
      expect(songView.scheduleSequence?.items, hasLength(3));
      expect(songView.scheduleSequence?.currentIndex, equals(2));
      expect(find.text('Música 3 de 3'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Música 2 de 3'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SongDetailView),
          matching: find.text('A Casa É Sua'),
        ),
        findsWidgets,
      );

      await tester.tap(
        find.byKey(const ValueKey('song_detail_context_back_button')),
      );
      await tester.pumpAndSettle();
      expect(find.byType(ScheduleDetailView), findsOneWidget);
    });

    testWidgets(
        'tapping a worship song item in _TimelineSection passes matching ScheduleSongSequenceContext',
        (tester) async {
      fakeRepo.detail = const ScheduleDetail(
        id: 'sch_1',
        ministryId: 'min_1',
        title: 'Culto de Domingo Especial',
        date: '2099-10-01',
        time: '19:30',
        songs: [
          ScheduleSong(
            id: 's1',
            title: 'Bondade de Deus',
            versionId: 'v1',
            versionName: 'Original',
            key: 'G',
          ),
          ScheduleSong(
            id: 's2',
            title: 'A Casa É Sua',
            versionId: 'v2',
            versionName: 'Acústica',
            key: 'D',
          ),
        ],
        timeline: [
          ScheduleTimelineItem(
            id: 't_song_1',
            title: 'Bondade de Deus',
            type: 'Música',
          ),
          ScheduleTimelineItem(
            id: 't_song_2',
            title: 'A Casa É Sua',
            type: 'Música',
          ),
        ],
        participants: [],
      );

      final repRepo = _FakeNavRepertoireRepo({
        's1': const SongDetail(
          id: 's1',
          ministryId: 'min_1',
          title: 'Bondade de Deus',
          originalKey: 'G',
          versions: [SongVersion(id: 'v1', name: 'Original', key: 'G')],
        ),
        's2': const SongDetail(
          id: 's2',
          ministryId: 'min_1',
          title: 'A Casa É Sua',
          originalKey: 'D',
          versions: [SongVersion(id: 'v2', name: 'Acústica', key: 'D')],
        ),
      });
      final linkRepo = _FakeNavLinkRepo();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authNotifierProvider.overrideWith((ref) => TestAuthNotifier()),
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            preferencesStorageProvider
                .overrideWithValue(_FakePreferencesStorage()),
            ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
            scheduleRepositoryProvider.overrideWithValue(fakeRepo),
            scheduleDetailNotifierProvider.overrideWith(
              (ref) => ScheduleDetailNotifier(repository: fakeRepo),
            ),
            commentsNotifierProvider.overrideWith(
              (ref) => CommentsNotifier(repository: fakeRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => FakeMinistryContextNotifier(),
            ),
            repertoireRepositoryProvider.overrideWithValue(repRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: repRepo),
            ),
            smartChordRepertoireLinkRepositoryProvider
                .overrideWithValue(linkRepo),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: linkRepo,
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
            ),
          ],
          child: const MaterialApp(
            home: ScheduleDetailView(
              ministryId: 'min_1',
              scheduleId: 'sch_1',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final timelineSong2 = find.byKey(const ValueKey('timeline_item_t_song_2'));
      await tester.ensureVisible(timelineSong2);
      await tester.pumpAndSettle();
      await tester.tap(timelineSong2);
      await tester.pumpAndSettle();

      final songView = tester.widget<SongDetailView>(
        find.byType(SongDetailView),
      );
      expect(songView.songId, equals('s2'));
      expect(songView.initialVersionId, equals('v2'));
      expect(songView.scheduleSequence?.items, hasLength(2));
      expect(songView.scheduleSequence?.currentIndex, equals(1));
      expect(find.text('Música 2 de 2'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Música 1 de 2'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SongDetailView),
          matching: find.text('Bondade de Deus'),
        ),
        findsWidgets,
      );
    });
  });
}

class _FakeNavRepertoireRepo implements RepertoireRepository {
  final Map<String, SongDetail> songs;
  _FakeNavRepertoireRepo(this.songs);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async =>
      songs[songId]!;
}

class _NoopSmartChordRepo implements SmartChordRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeNavLinkRepo implements SmartChordRepertoireLinkRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
    String? versionId,
    String? linkStatus,
  }) async =>
      const [];
}
