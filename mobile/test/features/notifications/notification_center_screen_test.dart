import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/features/notifications/data/notification_repository.dart';
import 'package:louvaio_mobile/features/notifications/domain/user_notification.dart';
import 'package:louvaio_mobile/features/notifications/presentation/controllers/notification_providers.dart';
import 'package:louvaio_mobile/features/notifications/presentation/views/notification_center_screen.dart';

class MockNotificationRepository extends Mock implements NotificationRepository {}

void main() {
  late MockNotificationRepository mockRepo;

  setUp(() {
    mockRepo = MockNotificationRepository();
  });

  Widget createSubject() {
    return ProviderScope(
      overrides: [
        notificationRepositoryProvider.overrideWithValue(mockRepo),
      ],
      child: const MaterialApp(
        home: NotificationCenterScreen(),
      ),
    );
  }

  testWidgets('displays empty state when no notifications exist', (tester) async {
    when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
        .thenAnswer((_) async => const NotificationPageResult(items: []));
    when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 0);

    await tester.pumpWidget(createSubject());
    await tester.pumpAndSettle();

    expect(find.text('Notificações'), findsOneWidget);
    expect(find.text('Nenhuma notificação por aqui ainda.'), findsOneWidget);
  });

  testWidgets('displays notifications in list and allows marking all as read', (tester) async {
    final notif1 = UserNotification(
      id: 'n1',
      userId: 'u1',
      ministryId: 'm1',
      type: UserNotificationType.scheduleAssigned,
      resourceId: 's1',
      title: 'Nova escala: Domingo',
      body: 'Você foi escalado(a)',
      createdAt: DateTime.now(),
    );

    final notif2 = UserNotification(
      id: 'n2',
      userId: 'u1',
      ministryId: 'm1',
      type: UserNotificationType.announcement,
      resourceId: 'a1',
      title: 'Aviso Importante',
      body: 'Ensaio geral confirmado',
      createdAt: DateTime.now(),
    );

    when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
        .thenAnswer((_) async => NotificationPageResult(items: [notif1, notif2]));
    when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 2);
    when(() => mockRepo.markAllAsRead()).thenAnswer((_) async => 2);

    await tester.pumpWidget(createSubject());
    await tester.pumpAndSettle();

    expect(find.text('Nova escala: Domingo'), findsOneWidget);
    expect(find.text('Aviso Importante'), findsOneWidget);
    expect(find.text('Marcar lidas'), findsOneWidget);

    // Tap 'Marcar lidas'
    await tester.tap(find.text('Marcar lidas'));
    await tester.pumpAndSettle();

    verify(() => mockRepo.markAllAsRead()).called(1);
  });

  testWidgets('displays error state with retry button', (tester) async {
    when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
        .thenThrow(Exception('Falha de conexão'));
    when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 0);

    await tester.pumpWidget(createSubject());
    await tester.pumpAndSettle();

    expect(find.text('Não foi possível carregar as notificações.'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);
  });

  testWidgets('displays pagination error and retry button when loadMore fails', (tester) async {
    final notif1 = UserNotification(
      id: 'n1',
      userId: 'u1',
      ministryId: 'm1',
      type: UserNotificationType.scheduleAssigned,
      resourceId: 's1',
      title: 'Notif 1',
      body: 'Corpo 1',
      createdAt: DateTime.now(),
    );
    final notif2 = UserNotification(
      id: 'n2',
      userId: 'u1',
      ministryId: 'm1',
      type: UserNotificationType.scheduleAssigned,
      resourceId: 's2',
      title: 'Notif 2',
      body: 'Corpo 2',
      createdAt: DateTime.now(),
    );

    when(() => mockRepo.getNotifications(limit: any(named: 'limit')))
        .thenAnswer((_) async => NotificationPageResult(
              items: [notif1],
              nextCursor: 'cursor_page_2',
            ));
    when(() => mockRepo.getNotifications(
          limit: any(named: 'limit'),
          cursor: 'cursor_page_2',
        )).thenThrow(Exception('Falha de paginação'));
    when(() => mockRepo.getUnreadCount()).thenAnswer((_) async => 1);

    await tester.pumpWidget(createSubject());
    await tester.pumpAndSettle();

    expect(find.text('Notif 1'), findsOneWidget);
    expect(find.text('Carregar mais antigas'), findsOneWidget);

    // Tap 'Carregar mais antigas'
    await tester.tap(find.text('Carregar mais antigas'));
    await tester.pumpAndSettle();

    // Still shows existing item
    expect(find.text('Notif 1'), findsOneWidget);
    // Shows load more error message and retry button
    expect(find.text('Não foi possível carregar mais notificações.'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);

    // Now set up success for retry
    when(() => mockRepo.getNotifications(
          limit: any(named: 'limit'),
          cursor: 'cursor_page_2',
        )).thenAnswer((_) async => NotificationPageResult(
          items: [notif2],
          nextCursor: null,
        ));

    await tester.tap(find.text('Tentar novamente'));
    await tester.pumpAndSettle();

    expect(find.text('Notif 1'), findsOneWidget);
    expect(find.text('Notif 2'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsNothing);
  });
}
