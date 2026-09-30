import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationRepository } from '../../repositories/NotificationRepository';
import {
  NotificationService,
  hasMaterialScheduleChanges,
  formatDateBr,
} from './notification.service';
import {
  encodeNotificationCursor,
  decodeNotificationCursor,
  UserNotificationRecord,
} from './notification.types';
import { AppError } from '../../middleware/error-handler';
import * as controller from './notification.controller';

describe('Notification Feature Suite (M10B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Helpers & Domain Rules', () => {
    it('formatDateBr formats ISO YYYY-MM-DD into DD/MM/YYYY', () => {
      expect(formatDateBr('2026-10-15')).toBe('15/10/2026');
      expect(formatDateBr('')).toBe('');
    });

    it('hasMaterialScheduleChanges detects title, date, time, and duration changes', () => {
      const base = {
        title: 'Culto de Celebração',
        date: '2026-10-15',
        time: '19:00',
        duration_minutes: 120,
      };

      // No material change
      expect(hasMaterialScheduleChanges(base, { ...base })).toBe(false);

      // Title changed
      expect(hasMaterialScheduleChanges(base, { title: 'Culto Especial' })).toBe(true);

      // Date changed
      expect(hasMaterialScheduleChanges(base, { date: '2026-10-16' })).toBe(true);

      // Time changed
      expect(hasMaterialScheduleChanges(base, { time: '20:00' })).toBe(true);

      // Duration changed (snake_case)
      expect(hasMaterialScheduleChanges(base, { duration_minutes: 90 })).toBe(true);

      // Duration changed (camelCase)
      expect(hasMaterialScheduleChanges(base, { durationMinutes: 90 } as any)).toBe(true);

      // Non-material changes (notes, clothing, color)
      expect(
        hasMaterialScheduleChanges(base, {
          notes: 'Observação nova',
          colorPalette: '#ffffff',
        } as any)
      ).toBe(false);
    });

    it('encode and decode cursor works with user tenant guard', () => {
      const cursor = encodeNotificationCursor({
        id: 'doc_123',
        c: '2026-09-30T10:00:00.000Z',
        u: 'user_alpha',
      });

      const decoded = decodeNotificationCursor(cursor, 'user_alpha');
      expect(decoded.id).toBe('doc_123');
      expect(decoded.c).toBe('2026-09-30T10:00:00.000Z');
      expect(decoded.u).toBe('user_alpha');

      // Cross-user cursor rejection (anti-IDOR)
      expect(() => decodeNotificationCursor(cursor, 'user_other')).toThrow(AppError);
      try {
        decodeNotificationCursor(cursor, 'user_other');
      } catch (e: any) {
        expect(e.statusCode).toBe(403);
        expect(e.details?.code).toBe('CROSS_USER_CURSOR_REJECTED');
      }
    });
  });

  describe('2. NotificationRepository', () => {
    let repo: NotificationRepository;

    beforeEach(() => {
      repo = new NotificationRepository();
    });

    it('createNotification returns isNew: true on first creation, isNew: false on duplicate dedupe_key', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      let docExists = false;
      const storedData: any = {};

      const mockDoc = vi.fn().mockImplementation((docId: string) => ({
        id: docId,
        get: vi.fn().mockImplementation(() =>
          Promise.resolve({
            id: docId,
            exists: docExists,
            data: () => (docExists ? storedData : undefined),
          })
        ),
        set: vi.fn().mockImplementation((data) => {
          docExists = true;
          Object.assign(storedData, data);
          return Promise.resolve();
        }),
      }));

      (repo as any).col = { doc: mockDoc };

      const res1 = await repo.createNotification({
        user_id: 'user_1',
        ministry_id: 'min_1',
        type: 'schedule_assigned',
        resource_id: 'sched_1',
        title: 'Nova escala',
        body: 'Você foi escalado(a)',
        dedupe_key: 'sched_assign_sched_1_user_1',
      });

      expect(res1.isNew).toBe(true);
      expect(res1.notification.user_id).toBe('user_1');
      expect(res1.notification.read_at).toBeNull();

      // Second attempt with same dedupe_key
      const res2 = await repo.createNotification({
        user_id: 'user_1',
        ministry_id: 'min_1',
        type: 'schedule_assigned',
        resource_id: 'sched_1',
        title: 'Nova escala',
        body: 'Você foi escalado(a)',
        dedupe_key: 'sched_assign_sched_1_user_1',
      });

      expect(res2.isNew).toBe(false);
      expect(res2.notification.id).toBe(res1.notification.id);
    });

    it('getNotificationsByUser returns paginated items with nextCursor', async () => {
      const mockDocs = [
        {
          id: 'n1',
          data: () => ({
            id: 'n1',
            user_id: 'user_1',
            title: 'Notif 1',
            created_at: '2026-09-30T12:00:00.000Z',
          }),
        },
        {
          id: 'n2',
          data: () => ({
            id: 'n2',
            user_id: 'user_1',
            title: 'Notif 2',
            created_at: '2026-09-30T11:00:00.000Z',
          }),
        },
        {
          id: 'n3',
          data: () => ({
            id: 'n3',
            user_id: 'user_1',
            title: 'Notif 3',
            created_at: '2026-09-30T10:00:00.000Z',
          }),
        },
      ];

      const queryMock: any = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: mockDocs }),
      };

      (repo as any).col = queryMock;

      // Request limit of 2 items
      const result = await repo.getNotificationsByUser('user_1', { limit: 2 });
      expect(result.items.length).toBe(2);
      expect(result.items[0].id).toBe('n1');
      expect(result.items[1].id).toBe('n2');
      expect(result.nextCursor).toBeDefined();

      const decodedCursor = decodeNotificationCursor(result.nextCursor!, 'user_1');
      expect(decodedCursor.id).toBe('n2');
      expect(decodedCursor.c).toBe('2026-09-30T11:00:00.000Z');
    });

    it('markAsRead fails closed with 404 if notification is missing or belongs to another user', async () => {
      const mockDoc = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'notif_1',
          data: () => ({
            id: 'notif_1',
            user_id: 'user_victim',
            read_at: null,
          }),
        }),
        update: vi.fn().mockResolvedValue(undefined),
      });

      (repo as any).col = { doc: mockDoc };

      // Attempt by another user fails with 404 anti-IDOR
      await expect(repo.markAsRead('notif_1', 'user_attacker')).rejects.toThrow(AppError);
      try {
        await repo.markAsRead('notif_1', 'user_attacker');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
      }

      // Legitimate user succeeds
      const updated = await repo.markAsRead('notif_1', 'user_victim');
      expect(updated.read_at).toBeDefined();
    });
  });

  describe('3. NotificationService Business Triggers', () => {
    let service: NotificationService;
    let mockRepo: any;
    let mockPushService: any;

    beforeEach(() => {
      mockRepo = {
        createNotification: vi.fn().mockImplementation((data) =>
          Promise.resolve({
            notification: { id: 'notif_generated', ...data, read_at: null },
            isNew: true,
          })
        ),
        getNotificationsByUser: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        getUnreadCount: vi.fn().mockResolvedValue(2),
        markAsRead: vi.fn().mockResolvedValue({ id: 'notif_1', read_at: '2026-09-30T12:00:00.000Z' }),
        markAllAsRead: vi.fn().mockResolvedValue({ updatedCount: 3 }),
      };

      mockPushService = {
        sendToUser: vi.fn().mockResolvedValue({
          userId: 'user_1',
          totalDevices: 1,
          successCount: 1,
          failureCount: 0,
          invalidTokensRemoved: 0,
        }),
      };

      service = new NotificationService(mockRepo, mockPushService);
    });

    it('notifyScheduleAssigned dispatches lock-screen safe push and skips actor', async () => {
      const schedule: any = {
        id: 'sched_100',
        title: 'Culto de Domingo',
        date: '2026-10-18',
        time: '19:00',
      };

      await service.notifyScheduleAssigned(
        'min_1',
        schedule,
        ['user_actor', 'user_member_1', 'user_member_2'],
        'user_actor'
      );

      // user_actor is skipped, user_member_1 and user_member_2 receive
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(2);
      expect(mockPushService.sendToUser).toHaveBeenCalledTimes(2);

      const firstCall = mockPushService.sendToUser.mock.calls[0];
      expect(firstCall[0]).toBe('user_member_1');
      expect(firstCall[1].title).toBe('Nova escala: Culto de Domingo');
      expect(firstCall[1].body).toContain('Você foi escalado(a) para Culto de Domingo (18/10/2026 às 19:00).');
      expect(firstCall[1].data.type).toBe('schedule');
      expect(firstCall[1].data.resourceId).toBe('sched_100');
    });

    it('notifyScheduleUpdated triggers notifications only for material field changes', async () => {
      const prevSchedule: any = {
        id: 'sched_100',
        title: 'Culto de Domingo',
        date: '2026-10-18',
        time: '19:00',
        duration_minutes: 120,
        participants: [{ id: 'user_p1' }],
      };

      vi.spyOn(service, 'resolveParticipantUserIds').mockResolvedValue(['user_p1']);

      // 1. Non-material update (no time/date/title/duration change)
      const nonMaterialUpdated = { ...prevSchedule, notes: 'Notas alteradas' };
      await service.notifyScheduleUpdated('min_1', prevSchedule, nonMaterialUpdated, 'user_editor');
      expect(mockRepo.createNotification).not.toHaveBeenCalled();

      // 2. Material update (time changed)
      const materialUpdated = { ...prevSchedule, time: '20:00', updated_at: '2026-09-30T12:00:00Z' };
      await service.notifyScheduleUpdated('min_1', prevSchedule, materialUpdated, 'user_editor');

      expect(mockRepo.createNotification).toHaveBeenCalledTimes(1);
      const callData = mockRepo.createNotification.mock.calls[0][0];
      expect(callData.type).toBe('schedule_updated');
      expect(callData.user_id).toBe('user_p1');
      expect(mockPushService.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('notifyScheduleComment excludes author and maintains privacy (no comment text in push)', async () => {
      const schedule: any = {
        id: 'sched_100',
        title: 'Ensaio Geral',
        participants: [{ id: 'user_p1' }, { id: 'user_comment_author' }],
      };

      const comment: any = {
        id: 'comm_55',
        content: 'Este é um texto confidencial que não pode vazar na tela de bloqueio',
      };

      vi.spyOn(service, 'resolveParticipantUserIds').mockResolvedValue(['user_p1', 'user_comment_author']);

      await service.notifyScheduleComment(
        'min_1',
        schedule,
        comment,
        'user_comment_author',
        'Lucas Silva'
      );

      // Only user_p1 is notified
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(1);
      expect(mockPushService.sendToUser).toHaveBeenCalledTimes(1);

      const pushPayload = mockPushService.sendToUser.mock.calls[0][1];
      expect(pushPayload.title).toBe('Novo comentário na escala');
      expect(pushPayload.body).toBe('Lucas Silva comentou na escala "Ensaio Geral".');
      // Verify raw comment content is NOT included in push
      expect(pushPayload.body).not.toContain(comment.content);
    });

    it('notifyAnnouncementCreated dispatches announcement notification to members excluding author', async () => {
      const announcement: any = {
        id: 'ann_1',
        title: 'Reunião de Líderes na Sexta',
      };

      vi.spyOn(service, 'resolveMinistryMemberUserIds').mockResolvedValue(['member_1', 'member_2']);

      await service.notifyAnnouncementCreated('min_1', announcement, 'author_leader');

      expect(mockRepo.createNotification).toHaveBeenCalledTimes(2);
      expect(mockPushService.sendToUser).toHaveBeenCalledTimes(2);

      const pushPayload = mockPushService.sendToUser.mock.calls[0][1];
      expect(pushPayload.title).toBe('Novo comunicado');
      expect(pushPayload.body).toBe('Reunião de Líderes na Sexta');
      expect(pushPayload.data.type).toBe('announcement');
    });

    it('push failure does not throw or break notification dispatch', async () => {
      mockPushService.sendToUser.mockRejectedValue(new Error('FCM transient network failure'));

      const schedule: any = {
        id: 'sched_100',
        title: 'Culto',
        date: '2026-10-18',
      };

      // Dispatches without throwing
      await expect(
        service.notifyScheduleAssigned('min_1', schedule, ['user_p1'], 'actor')
      ).resolves.not.toThrow();

      // Database record was still created
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Express Controllers & Endpoints', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
      mockReq = {
        user: { id: 'auth_user_1' },
        query: {},
        params: {},
      };
      mockRes = {
        json: vi.fn(),
      };
      mockNext = vi.fn();

      vi.spyOn(NotificationService.prototype, 'listUserNotifications').mockResolvedValue({
        items: [{ id: 'n1', title: 'Test' } as any],
        nextCursor: null,
      });
      vi.spyOn(NotificationService.prototype, 'getUnreadCount').mockResolvedValue(5);
      vi.spyOn(NotificationService.prototype, 'markAsRead').mockResolvedValue({
        id: 'n1',
        read_at: '2026-09-30T12:00:00.000Z',
      } as any);
      vi.spyOn(NotificationService.prototype, 'markAllAsRead').mockResolvedValue({
        updatedCount: 3,
      });
    });

    it('listNotifications returns items and nextCursor for authenticated user', async () => {
      mockReq.query = { limit: 10 };
      await controller.listNotifications(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.any(Array),
          notifications: expect.any(Array),
        })
      );
    });

    it('getUnreadCount returns unreadCount', async () => {
      await controller.getUnreadCount(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadCount: expect.any(Number),
        })
      );
    });

    it('unauthenticated request calls next with AppError 401', async () => {
      mockReq.user = undefined;
      await controller.getUnreadCount(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
        })
      );
    });
  });
});
