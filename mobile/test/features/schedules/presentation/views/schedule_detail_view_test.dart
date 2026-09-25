import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_detail_controller.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_detail_view.dart';

class FakeDetailScheduleRepo implements ScheduleRepository {
  ScheduleDetail? detail;
  List<ScheduleComment> comments = [];
  Exception? detailError;
  Exception? confirmError;
  Exception? commentPostError;

  bool? lastConfirmed;
  String? lastPostedComment;

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
    return List.of(comments);
  }

  @override
  Future<ScheduleComment> postComment(
      String ministryId, String scheduleId, String content) async {
    lastPostedComment = content;
    if (commentPostError != null) throw commentPostError!;
    return ScheduleComment(
      id: 'comment_new',
      scheduleId: scheduleId,
      ministryId: ministryId,
      userId: 'user_1',
      userName: 'Membro Teste',
      content: content,
      createdAt: '2026-09-25T14:30:00Z',
    );
  }
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
        ScheduleSong(id: 's1', title: 'Bondade de Deus', artist: 'Isaías Saad'),
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

  Widget createSubject() {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        scheduleRepositoryProvider.overrideWithValue(fakeRepo),
        scheduleDetailNotifierProvider.overrideWith((ref) {
          return ScheduleDetailNotifier(repository: fakeRepo);
        }),
        commentsNotifierProvider.overrideWith((ref) {
          return CommentsNotifier(repository: fakeRepo);
        }),
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

      // Notes
      expect(find.text('Chegar com 30min de antecedência para aquecimento.'),
          findsOneWidget);

      // Participants
      expect(find.text('Henrique Vocal'), findsOneWidget);
      expect(find.text('Ana Teclado'),
          findsWidgets); // Appears in participants and comments

      // Songs
      expect(find.text('Bondade de Deus'), findsOneWidget);
      expect(find.text('A Casa É Sua'), findsOneWidget);

      // Timeline
      expect(find.text('Abertura e Oração'), findsOneWidget);
      expect(find.text('Louvor Congregacional'), findsOneWidget);

      // Clothing
      expect(find.text('Camisa Preta e Calça Jeans Escura'), findsOneWidget);

      // Comments
      expect(find.text('Qual o tom da primeira música?'), findsOneWidget);
    });

    testWidgets(
        'confirmation action calls server and updates participation state',
        (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      // Find "Confirmar" button and tap
      final confirmButton = find.text('Confirmar');
      expect(confirmButton, findsOneWidget);

      await tester.tap(confirmButton);
      await tester.pumpAndSettle();

      expect(fakeRepo.lastConfirmed, isTrue);
    });

    testWidgets('decline action calls server with false', (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      final declineButton = find.text('Não vou');
      expect(declineButton, findsOneWidget);

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
  });
}
