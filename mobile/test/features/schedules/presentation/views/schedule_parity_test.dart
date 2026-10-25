import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_detail_view.dart';
import 'package:louvaio_mobile/features/schedules/presentation/views/schedule_chat_view.dart';
import 'schedule_detail_view_test.dart' show FakeDetailScheduleRepo, FakeMinistryContextNotifier, TestAuthNotifier;

class RouteObserverSpy extends NavigatorObserver {
  Route<dynamic>? last;
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) { last = route; }
}
class DelayedChatRepo extends FakeDetailScheduleRepo {
  final pending = Completer<List<ScheduleComment>>();
  @override
  Future<List<ScheduleComment>> getComments(String ministryId, String scheduleId) => pending.future;
}

class DelayedPostingRepo extends FakeDetailScheduleRepo {
  final sent = Completer<ScheduleComment>();
  @override
  Future<ScheduleComment> postComment(String ministryId, String scheduleId, String content) => sent.future;
}

void main() {
  late FakeDetailScheduleRepo repo;
  late TestAuthNotifier auth;
  late FakeMinistryContextNotifier ministry;
  setUp(() {
    repo = FakeDetailScheduleRepo();
    auth = TestAuthNotifier();
    ministry = FakeMinistryContextNotifier();
  });

  Widget subject(Widget home, {double scale = 1, double keyboard = 0, NavigatorObserver? observer}) => ProviderScope(
    overrides: [scheduleRepositoryProvider.overrideWithValue(repo),
      authNotifierProvider.overrideWith((ref) => auth),
      ministryContextNotifierProvider.overrideWith((ref) => ministry)],
    child: MaterialApp(navigatorObservers: [if (observer != null) observer],
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale),
          padding: const EdgeInsets.only(bottom: 24), viewPadding: const EdgeInsets.only(bottom: 24),
          viewInsets: EdgeInsets.only(bottom: keyboard)), child: child!),
      home: home));

  const detail = ScheduleDetailView(ministryId: 'min_1', scheduleId: 's');
  const chat = ScheduleChatView(ministryId: 'min_1', scheduleId: 's', userId: 'user_1');
  ScheduleDetail schedule(String? palette) => ScheduleDetail(id: 's', ministryId: 'min_1',
    title: 'Culto', date: '2099-01-01', colorPalette: palette,
    songs: const [ScheduleSong(id: 'oceanos', title: 'Oceanos')],
    timeline: const [ScheduleTimelineItem(id: 'slot', title: 'Música 1', type: 'Música')],
    clothingPieces: const [ScheduleClothingPiece(name: 'Camisa', colors: ['#fff', '#7C3AED', 'invalid'])]);

  testWidgets('palette swatch uses stored color, light borders, invalid/missing values are safe', (tester) async {
    for (final palette in ['#7C3AED', '#FFFFFF', '#invalid', null]) {
      auth = TestAuthNotifier();
      ministry = FakeMinistryContextNotifier();
      repo.detail = schedule(palette);
      await tester.pumpWidget(subject(detail));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Vestimenta').last);
      await tester.pumpAndSettle();
      if (palette == '#7C3AED' || palette == '#FFFFFF') {
        final swatch = tester.widget<Container>(find.byKey(const ValueKey('schedule_palette_swatch')));
        final decoration = swatch.decoration! as BoxDecoration;
        expect(decoration.color, parseScheduleColor(palette));
        expect(decoration.border, isNotNull);
        expect(find.text(palette!), findsNothing);
        expect(find.text('Cor da equipe'), findsOneWidget);
      } else {
        expect(find.byKey(const ValueKey('schedule_palette_swatch')), findsNothing);
        expect(find.text('Cor da equipe não definida'), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('legacy slot resolves without writes and navigation uses the corresponding song ID', (tester) async {
    repo.detail = schedule('#7C3AED');
    final observer = RouteObserverSpy();
    await tester.pumpWidget(subject(detail, observer: observer));
    await tester.pumpAndSettle();
    expect(repo.detail!.timeline.first.title, 'Música 1');
    expect(find.text('Oceanos'), findsNWidgets(2));
    final target = find.byKey(const ValueKey('timeline_item_slot'));
    await tester.ensureVisible(target);
    await tester.tap(target);
    final route = observer.last! as MaterialPageRoute<void>;
    final destination = route.builder(tester.element(detailFinder())) as SongDetailView;
    expect(destination.songId, 'oceanos');
    expect(destination.ministryId, 'min_1');
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('chat bubbles use user ID, input clears only on success and refreshes persisted messages', (tester) async {
    repo.comments = const [
      ScheduleComment(id: 'other', scheduleId: 's', ministryId: 'min_1', userId: 'other', userName: 'Membro Teste', content: 'Outra pessoa', createdAt: '2026-01-01T10:00:00Z'),
      ScheduleComment(id: 'mine', scheduleId: 's', ministryId: 'min_1', userId: 'user_1', userName: 'Eu', content: 'Minha mensagem', createdAt: '2026-01-01T11:00:00Z'),
    ];
    await tester.pumpWidget(subject(chat));
    await tester.pumpAndSettle();
    expect(tester.widget<Align>(find.byKey(const ValueKey('chat_message_other'))).alignment, Alignment.centerLeft);
    expect(tester.widget<Align>(find.byKey(const ValueKey('chat_message_mine'))).alignment, Alignment.centerRight);
    final input = find.byKey(const ValueKey('schedule_chat_input'));
    await tester.enterText(input, 'Mensagem');
    await tester.pump();
    repo.commentPostError = const AppFailure(message: 'Falha temporária');
    await tester.tap(find.byTooltip('Enviar comentário'));
    await tester.pumpAndSettle();
    expect(find.text('Falha temporária'), findsOneWidget);
    expect(tester.widget<TextField>(input).controller!.text, 'Mensagem');
    final readsBefore = repo.commentReads;
    repo.commentPostError = null;
    await tester.tap(find.byTooltip('Enviar comentário'));
    await tester.pumpAndSettle();
    expect(repo.lastPostedComment, 'Mensagem');
    expect(repo.commentPosts, 2);
    expect(repo.commentReads, greaterThan(readsBefore));
    expect(tester.widget<TextField>(input).controller!.text, isEmpty);
    expect(find.byKey(const ValueKey('chat_message_comment_new')), findsOneWidget);
  });

  testWidgets('refresh is disabled during send so a successful response is not invalidated', (tester) async {
    final pending = DelayedPostingRepo(); repo = pending;
    await tester.pumpWidget(subject(chat));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('schedule_chat_input')), 'Enviando');
    await tester.pump();
    await tester.tap(find.byTooltip('Enviar comentário'));
    await tester.pump();
    expect(tester.widget<IconButton>(find.byTooltip('Atualizar conversa')).onPressed, isNull);
    const message = ScheduleComment(id: 'sent', scheduleId: 's', ministryId: 'min_1',
      userId: 'user_1', userName: 'Eu', content: 'Enviando', createdAt: '2026-01-01T10:00:00Z');
    pending.comments = [message];
    pending.sent.complete(message);
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byKey(const ValueKey('schedule_chat_input'))).controller!.text, isEmpty);
    expect(find.byKey(const ValueKey('chat_message_sent')), findsOneWidget);
    expect(pending.commentReads, 2);
  });

  testWidgets('chat load failure retries to empty state and whitespace never posts', (tester) async {
    repo.commentLoadError = const AppFailure(message: 'Falha ao carregar conversa');
    await tester.pumpWidget(subject(chat));
    await tester.pumpAndSettle();
    expect(find.text('Falha ao carregar conversa'), findsOneWidget);
    repo.commentLoadError = null;
    await tester.tap(find.text('Tentar novamente'));
    await tester.pumpAndSettle();
    expect(find.text('Falha ao carregar conversa'), findsNothing);
    expect(find.text('Nenhum comentário ainda. Seja o primeiro!'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('schedule_chat_input')), '   ');
    await tester.pump();
    expect(tester.widget<IconButton>(find.byTooltip('Enviar comentário')).onPressed, isNull);
    expect(repo.commentPosts, 0);
    expect(repo.commentReads, 2);
  });

  for (final changeUser in [true, false]) {
    testWidgets('chat hides messages and ignores pending response on ${changeUser ? 'user' : 'tenant'} switch', (tester) async {
      final delayed = DelayedChatRepo(); repo = delayed;
      await tester.pumpWidget(subject(chat));
      await tester.pump();
      if (changeUser) { auth.changeUser(); }
      else { ministry.switchMinistry(const Ministry(id: 'min_other', name: 'Other', role: 'member')); }
      await tester.pump();
      delayed.pending.complete(const [ScheduleComment(id: 'late', scheduleId: 's', ministryId: 'min_1', userId: 'user_1', userName: 'Old', content: 'Private old message', createdAt: '')]);
      await tester.pumpAndSettle();
      expect(find.text('Private old message'), findsNothing);
      expect(find.byKey(const ValueKey('schedule_chat_input')), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('chat composer remains above keyboard and safe area on narrow screens', (tester) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final keyboard in [0.0, 250.0]) {
      await tester.pumpWidget(subject(chat, scale: 1.3, keyboard: keyboard));
      await tester.pumpAndSettle();
      expect(MediaQuery.textScalerOf(tester.element(find.byType(ScheduleChatView))).scale(10), 13);
      final bottom = tester.getBottomLeft(find.byKey(const ValueKey('schedule_chat_composer'))).dy;
      expect(bottom, lessThanOrEqualTo(740 - (keyboard == 0 ? 24 : keyboard)));
      expect(tester.takeException(), isNull);
    }
  });
}
Finder detailFinder() => find.byType(ScheduleDetailView);
