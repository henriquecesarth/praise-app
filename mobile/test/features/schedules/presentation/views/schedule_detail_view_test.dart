import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/theme/app_theme.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
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

  Widget createSubject({
    String role = 'member',
    List<SongSummary> repertoireSongs = const [],
    ThemeData? theme,
    Key? appKey,
  }) {
    final repRepo = _FakeNavRepertoireRepo(const {}, listItems: repertoireSongs);
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
        repertoireRepositoryProvider.overrideWithValue(repRepo),
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
      child: MaterialApp(
        key: appKey,
        theme: theme ?? AppTheme.darkTheme,
        home: const ScheduleDetailView(
          ministryId: 'min_1',
          scheduleId: 'sch_1',
        ),
      ),
    );
  }

  group('ScheduleDetailView Presentation', () {
    testWidgets('renders summary header and all 4 tabs with live counters cleanly',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // App bar centered title & hero summary header
      expect(find.text('Escala'), findsOneWidget);
      expect(find.text('Culto de Domingo Especial'), findsOneWidget);
      expect(find.textContaining('Quinta-feira, 1 de outubro de 2099'), findsOneWidget);
      expect(find.text('19:30'), findsWidgets);
      expect(find.text('2h'), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_detail_relative_badge')), findsOneWidget);

      // 4 segmented tabs & counters
      expect(find.byKey(const ValueKey('schedule_detail_hero')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_detail_accent_bar')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_detail_tab_bar')), findsOneWidget);
      expect(find.text('Detalhes'), findsOneWidget);
      expect(find.text('Músicas'), findsOneWidget);
      expect(find.text('Participantes'), findsOneWidget);
      expect(find.text('Roteiro'), findsWidgets);
      expect(find.text('1/2'), findsOneWidget);

      // Comments FAB shows real count
      expect(find.byKey(const ValueKey('open_schedule_chat')), findsOneWidget);
      expect(find.text('Comentários (1)'), findsOneWidget);

      // Default tab (Detalhes): confirmation, confirmed summary, roteiro preview, clothing, notes, history
      expect(find.text('1 de 2'), findsOneWidget);
      expect(find.text('Chegar com 30min de antecedência para aquecimento.'),
          findsOneWidget);
      expect(find.text('Camisa Preta e Calça Jeans Escura'), findsOneWidget);
      expect(find.text('Tons Terrosos'), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_details_history_card')), findsOneWidget);
      expect(find.byType(TextField), findsNothing);

      // Switch to Músicas tab
      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_songs')));
      await tester.pumpAndSettle();
      expect(find.text('1ª'), findsOneWidget);
      expect(find.text('2ª'), findsOneWidget);
      expect(find.text('Bondade de Deus'), findsOneWidget);
      expect(find.text('A Casa É Sua'), findsOneWidget);

      // Switch to Participantes tab
      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_participants')));
      await tester.pumpAndSettle();
      expect(find.text('Henrique Vocal'), findsOneWidget);
      expect(find.text('Ana Teclado'), findsOneWidget);

      // Switch to Roteiro tab
      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_order')));
      await tester.pumpAndSettle();
      expect(find.text('Abertura e Oração'), findsOneWidget);
      expect(find.text('Louvor Congregacional'), findsOneWidget);
    });

    testWidgets('empty sections show explicit empty states across tabs', (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      fakeRepo.detail = const ScheduleDetail(
        id: 'sch_1',
        ministryId: 'min_1',
        title: 'Escala Vazia',
        date: '2099-10-01',
      );
      fakeRepo.comments = const [];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Comentários (0)'), findsOneWidget);
      expect(find.text('0 de 0'), findsOneWidget);
      expect(find.text('Nenhum momento no roteiro desta escala.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_songs')));
      await tester.pumpAndSettle();
      expect(find.text('Nenhuma música escalada para esta escala.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_participants')));
      await tester.pumpAndSettle();
      expect(find.text('Nenhum participante escalado nesta escala.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_order')));
      await tester.pumpAndSettle();
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
          repertoireRepositoryProvider.overrideWithValue(
            _FakeNavRepertoireRepo(const {}),
          ),
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

      await tester.tap(find.byKey(const ValueKey('schedule_detail_actions_menu')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('menu_share_schedule')), findsOneWidget);
      expect(find.byKey(const ValueKey('edit_schedule_button')), findsNothing);
      expect(find.byKey(const ValueKey('delete_schedule_button')), findsNothing);
    });

    testWidgets(
        'admin sees edit schedule button and clicking opens ScheduleFormScreen',
        (tester) async {
      await tester.pumpWidget(createSubject(role: 'admin'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('schedule_detail_actions_menu')));
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

      await tester.tap(find.byKey(const ValueKey('schedule_detail_actions_menu')));
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

    testWidgets('displays confirmed card, song key badge, and timeline type labels',
        (tester) async {
      tester.view.physicalSize = const Size(1024, 2048);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('schedule_details_confirmed_card')), findsOneWidget);
      expect(find.text('1 de 2'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_songs')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('detail_song_key_s1')), findsOneWidget);
      expect(find.text('Tom: G'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_order')));
      await tester.pumpAndSettle();
      expect(find.text('Oração'), findsOneWidget);
      expect(find.text('Louvor'), findsOneWidget);
    });

    testWidgets(
        'renders schedule detail without overflow across 320dp, 360dp, 393dp, tablet portrait, dark theme and 1.3x text scale',
        (tester) async {
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final viewports = <({Size size, double scale, ThemeData theme})>[
        (size: const Size(320, 680), scale: 1.3, theme: AppTheme.darkTheme),
        (size: const Size(360, 740), scale: 1.0, theme: AppTheme.darkTheme),
        (size: const Size(393, 851), scale: 1.0, theme: AppTheme.darkTheme),
        (size: const Size(768, 1024), scale: 1.0, theme: AppTheme.lightTheme),
      ];

      for (final vp in viewports) {
        tester.view.physicalSize = vp.size;
        tester.view.devicePixelRatio = 1.0;

        await tester.pumpWidget(
          MediaQuery(
            data: MediaQueryData(
              size: vp.size,
              padding: const EdgeInsets.only(bottom: 24),
              viewPadding: const EdgeInsets.only(bottom: 24),
              textScaler: TextScaler.linear(vp.scale),
            ),
            child: createSubject(
              role: 'admin',
              theme: vp.theme,
              appKey: ValueKey('${vp.size}_${vp.scale}_${vp.theme.brightness}'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'No overflow on Detalhes at ${vp.size}');
        expect(
          tester
              .getBottomRight(find.byKey(const ValueKey('open_schedule_chat')))
              .dy,
          lessThanOrEqualTo(vp.size.height - 24),
        );

        await tester.ensureVisible(find.text('Observações').last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'No overflow scrolling Detalhes at ${vp.size}');

        for (final tabKey in const [
          ValueKey('schedule_detail_tab_songs'),
          ValueKey('schedule_detail_tab_participants'),
          ValueKey('schedule_detail_tab_order'),
        ]) {
          await tester.tap(find.byKey(tabKey));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull,
              reason: 'No overflow on $tabKey at ${vp.size}');
        }

        // Test Participantes Membros <-> Funções internal toggle on every viewport
        await tester.tap(
            find.byKey(const ValueKey('schedule_detail_tab_participants')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('participants_toggle_roles')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'No overflow on Funções toggle at ${vp.size}');
      }
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

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_songs')));
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
      expect(songView.backLabel, equals('Voltar'));
      expect(songView.scheduleSequence?.items, hasLength(3));
      expect(songView.scheduleSequence?.currentIndex, equals(2));
      expect(find.text('3 de 3'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('2 de 3'), findsOneWidget);
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

      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_order')));
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
      expect(find.text('2 de 2'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('song_detail_sequence_prev_button')),
      );
      await tester.pumpAndSettle();
      expect(find.text('1 de 2'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SongDetailView),
          matching: find.text('Bondade de Deus'),
        ),
        findsWidgets,
      );
    });

    testWidgets(
        'R3 Redesign: renders Detalhes cards (Share, Google Agenda, Confirmados, Roteiro summary, Histórico), Músicas media badges & ordinal positions, and Participantes Membros/Funções toggle',
        (tester) async {
      final inSixDays = DateTime.now().add(const Duration(days: 6));
      final isoInSixDays =
          '${inSixDays.year.toString().padLeft(4, '0')}-${inSixDays.month.toString().padLeft(2, '0')}-${inSixDays.day.toString().padLeft(2, '0')}';

      fakeRepo.detail = ScheduleDetail(
        id: 'sch_1',
        ministryId: 'min_1',
        title: 'Culto de adoração',
        date: isoInSixDays,
        time: '19:30',
        durationMinutes: 120,
        createdAt: '2026-11-10T14:00:00Z',
        updatedAt: '2026-11-12T16:30:00Z',
        participants: const [
          ScheduleParticipant(
            id: 'p1',
            userId: 'user_1',
            name: 'Lucas Silva',
            role: 'Vocalista',
            confirmed: true,
          ),
          ScheduleParticipant(
            id: 'p2',
            name: 'Marina Rocha',
            role: 'Vocalista',
            confirmed: true,
          ),
          ScheduleParticipant(
            id: 'p3',
            name: 'Rafael Lima',
            role: 'Violão',
            confirmed: null,
          ),
          ScheduleParticipant(
            id: 'p4',
            name: 'Pedro Alves',
            role: 'Baixo',
            confirmed: false,
          ),
        ],
        songs: const [
          ScheduleSong(
            id: 's1',
            title: 'Bondade de Deus',
            artist: 'Isaías Saad',
            key: 'G',
            versionName: 'Principal',
            rawJson: {
              'has_lyrics': true,
              'smart_chords_count': 1,
            },
          ),
          ScheduleSong(
            id: 's2',
            title: 'A Casa É Sua',
            artist: 'Casa Worship',
            key: 'D',
          ),
        ],
        timeline: const [
          ScheduleTimelineItem(
            id: 't1',
            title: 'Bondade de Deus',
            time: '19:35',
            type: 'Música',
          ),
          ScheduleTimelineItem(
            id: 't2',
            title: 'Palavra',
            time: '20:10',
            type: 'word',
          ),
        ],
      );

      final enrichedSongs = <SongSummary>[
        const SongSummary(
          id: 's1',
          ministryId: 'min_1',
          title: 'Bondade de Deus',
          classification: SongClassificationRef(
            id: 'c1',
            name: 'Louvor',
            color: '#7CC4A4',
          ),
          youtubeUrl: 'https://youtube.com/watch?v=test1',
          hasYoutube: true,
          audioUrl: 'https://cdn.test/bondade.mp3',
        ),
      ];

      await tester.pumpWidget(createSubject(repertoireSongs: enrichedSongs));
      await tester.pumpAndSettle();

      // Summary header relative badge & Detalhes cards
      expect(find.text('daqui a 6 dias'), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule_share_button')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('schedule_google_calendar_button')),
        findsOneWidget,
      );
      expect(find.text('2 de 4'), findsOneWidget);
      expect(find.textContaining('Escala criada em'), findsOneWidget);
      expect(find.textContaining('Última atualização em'), findsOneWidget);

      // Share button triggers clipboard & SnackBar
      String? copiedText;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') {
          copiedText = (call.arguments as Map)['text'] as String?;
        }
        return null;
      });
      addTearDown(() {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null);
      });

      await tester.ensureVisible(
        find.byKey(const ValueKey('schedule_share_button')),
      );
      await tester.tap(find.byKey(const ValueKey('schedule_share_button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(copiedText, contains('Culto de adoração'));
      expect(copiedText, contains('1ª Bondade de Deus'));
      expect(
        find.text('Resumo da escala copiado para compartilhar.'),
        findsOneWidget,
      );
      await tester.pumpAndSettle();

      // Músicas tab shows ordinals, classification & resource icons
      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_songs')));
      await tester.pumpAndSettle();
      expect(find.text('1ª'), findsOneWidget);
      expect(find.text('2ª'), findsOneWidget);
      expect(find.text('Louvor'), findsOneWidget);
      expect(find.text('Tom: G'), findsOneWidget);
      expect(find.byKey(const ValueKey('detail_song_ind_chord_1')), findsOneWidget);
      expect(find.byKey(const ValueKey('detail_song_ind_lyrics_1')), findsOneWidget);
      expect(find.byKey(const ValueKey('detail_song_ind_audio_1')), findsOneWidget);
      expect(find.byKey(const ValueKey('detail_song_youtube_1')), findsOneWidget);

      // Participantes tab & Membros / Funções internal switch
      await tester.tap(
        find.byKey(const ValueKey('schedule_detail_tab_participants')),
      );
      await tester.pumpAndSettle();
      expect(find.text('2/4'), findsOneWidget);
      expect(find.text('LS'), findsOneWidget);
      expect(find.text('Lucas Silva'), findsOneWidget);
      expect(find.text('Recusado'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('participants_toggle_roles')));
      await tester.pumpAndSettle();
      expect(find.text('Vocalista'), findsOneWidget);
      expect(find.text('Violão'), findsOneWidget);
      expect(find.text('Baixo'), findsOneWidget);

      // Roteiro tab shows Música 1 + Palavra + time
      await tester.tap(find.byKey(const ValueKey('schedule_detail_tab_order')));
      await tester.pumpAndSettle();
      expect(find.text('Música 1'), findsOneWidget);
      expect(find.text('Palavra'), findsWidgets);
      expect(find.text('19:35'), findsOneWidget);
    });
  });
}

class _FakeNavRepertoireRepo implements RepertoireRepository {
  final Map<String, SongDetail> songs;
  final List<SongSummary> listItems;
  _FakeNavRepertoireRepo(this.songs, {this.listItems = const []});

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async =>
      PaginatedSongs(songs: listItems, total: listItems.length);

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
