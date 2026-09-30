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
import { db } from '../../lib/firebase';
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

    it('generates collision-safe sha256 document IDs avoiding truncation or sanitization collisions', () => {
      const id1 = (repo as any).generateDocId('sched_update_123_userA_' + 'a'.repeat(150) + '_version1');
      const id2 = (repo as any).generateDocId('sched_update_123_userA_' + 'a'.repeat(150) + '_version2');
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^notif_[a-f0-9]{64}$/);
      expect(id2).toMatch(/^notif_[a-f0-9]{64}$/);

      // Special characters do not cause collision
      const idSpecial1 = (repo as any).generateDocId('key:foo/bar@baz');
      const idSpecial2 = (repo as any).generateDocId('key_foo_bar_baz');
      expect(idSpecial1).not.toBe(idSpecial2);
    });

    it('createNotification is atomic and returns isNew: true on first creation, isNew: false on duplicate dedupe_key', async () => {
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

      vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
        const tx = {
          get: vi.fn().mockImplementation((ref: any) => ref.get()),
          set: vi.fn().mockImplementation((ref: any, data: any) => ref.set(data)),
        };
        return callback(tx);
      });

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

    it('concurrent same-event creation produces exactly one isNew: true and one isNew: false', async () => {
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

      let txQueue = Promise.resolve();
      vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
        return new Promise((resolve, reject) => {
          txQueue = txQueue.then(async () => {
            try {
              const tx = {
                get: vi.fn().mockImplementation((ref: any) => ref.get()),
                set: vi.fn().mockImplementation((ref: any, data: any) => ref.set(data)),
              };
              const result = await callback(tx);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      });

      const payload = {
        user_id: 'user_1',
        ministry_id: 'min_1',
        type: 'schedule_assigned' as const,
        resource_id: 'sched_1',
        title: 'Nova escala',
        body: 'Você foi escalado(a)',
        dedupe_key: 'sched_assign_sched_1_user_1_occurrence1',
      };

      const [res1, res2] = await Promise.all([
        repo.createNotification(payload),
        repo.createNotification(payload),
      ]);

      const newCount = [res1.isNew, res2.isNew].filter(Boolean).length;
      expect(newCount).toBe(1);
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

    it('assignment occurrence semantics: reassigning after removal produces new notification, while retry dedupes', async () => {
      const scheduleInitial: any = {
        id: 'sched_100',
        title: 'Culto',
        date: '2026-10-18',
        created_at: '2026-10-01T10:00:00.000Z',
        updated_at: '2026-10-01T10:00:00.000Z',
        participants: [{ id: 'user_p1', assigned_at: '2026-10-01T10:00:00.000Z' }],
      };

      // 1. Initial assignment
      await service.notifyScheduleAssigned('min_1', scheduleInitial, ['user_p1'], 'actor');
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(1);
      const call1Key = mockRepo.createNotification.mock.calls[0][0].dedupe_key;
      expect(call1Key).toBe('sched_assign_sched_100_user_p1_2026-10-01T10:00:00.000Z');

      // 2. Retry of SAME assignment mutation (same occurrence) -> same dedupe key
      await service.notifyScheduleAssigned('min_1', scheduleInitial, ['user_p1'], 'actor');
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(2);
      const call2Key = mockRepo.createNotification.mock.calls[1][0].dedupe_key;
      expect(call2Key).toBe(call1Key);

      // 3. User was removed and later re-assigned in Update 2 at T2
      const scheduleReassigned: any = {
        id: 'sched_100',
        title: 'Culto',
        date: '2026-10-18',
        created_at: '2026-10-01T10:00:00.000Z',
        updated_at: '2026-10-05T15:00:00.000Z',
        participants: [{ id: 'user_p1', assigned_at: '2026-10-05T15:00:00.000Z' }],
      };

      await service.notifyScheduleAssigned('min_1', scheduleReassigned, ['user_p1'], 'actor');
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(3);
      const call3Key = mockRepo.createNotification.mock.calls[2][0].dedupe_key;
      expect(call3Key).toBe('sched_assign_sched_100_user_p1_2026-10-05T15:00:00.000Z');
      expect(call3Key).not.toBe(call1Key);
    });

    it('notifyScheduleUpdated triggers notifications only for material field changes with distinct mutation keys', async () => {
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

      // 2. Material update (time changed) at T1
      const materialUpdated1 = { ...prevSchedule, time: '20:00', updated_at: '2026-10-02T10:00:00Z' };
      await service.notifyScheduleUpdated('min_1', prevSchedule, materialUpdated1, 'user_editor');

      expect(mockRepo.createNotification).toHaveBeenCalledTimes(1);
      const key1 = mockRepo.createNotification.mock.calls[0][0].dedupe_key;
      expect(key1).toBe('sched_update_sched_100_user_p1_2026-10-02T10:00:00Z');

      // 3. Retry of Update 1 produces identical dedupe key
      await service.notifyScheduleUpdated('min_1', prevSchedule, materialUpdated1, 'user_editor');
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(2);
      const key1Retry = mockRepo.createNotification.mock.calls[1][0].dedupe_key;
      expect(key1Retry).toBe(key1);

      // 4. Genuine subsequent update 2 at T2 produces new dedupe key
      const materialUpdated2 = { ...materialUpdated1, time: '21:00', updated_at: '2026-10-03T12:00:00Z' };
      await service.notifyScheduleUpdated('min_1', materialUpdated1, materialUpdated2, 'user_editor');
      expect(mockRepo.createNotification).toHaveBeenCalledTimes(3);
      const key2 = mockRepo.createNotification.mock.calls[2][0].dedupe_key;
      expect(key2).toBe('sched_update_sched_100_user_p1_2026-10-03T12:00:00Z');
      expect(key2).not.toBe(key1);
    });

    it('sanitizeAuthorDisplayName never falls back to email, phone, or raw UID in notification copy', async () => {
      const schedule: any = {
        id: 'sched_100',
        title: 'Culto',
        participants: [{ id: 'user_p1' }],
      };
      const comment: any = { id: 'comm_1' };
      vi.spyOn(service, 'resolveParticipantUserIds').mockResolvedValue(['user_p1']);

      // 1. Author with email fallback
      await service.notifyScheduleComment('min_1', schedule, comment, 'author_id', 'author@louvaio.test');
      expect(mockPushService.sendToUser.mock.calls[0][1].body).toBe('Um integrante comentou na escala "Culto".');

      // 2. Author with raw Firebase UID
      mockPushService.sendToUser.mockClear();
      await service.notifyScheduleComment('min_1', schedule, comment, 'author_id', 'lE4nsN3uC2Za2S68XkKnfy9pw0n1');
      expect(mockPushService.sendToUser.mock.calls[0][1].body).toBe('Um integrante comentou na escala "Culto".');

      // 3. Author with phone number
      mockPushService.sendToUser.mockClear();
      await service.notifyScheduleComment('min_1', schedule, comment, 'author_id', '+5585991234567');
      expect(mockPushService.sendToUser.mock.calls[0][1].body).toBe('Um integrante comentou na escala "Culto".');

      // 4. Author with empty string
      mockPushService.sendToUser.mockClear();
      await service.notifyScheduleComment('min_1', schedule, comment, 'author_id', '');
      expect(mockPushService.sendToUser.mock.calls[0][1].body).toBe('Um integrante comentou na escala "Culto".');

      // 5. Author with valid display name
      mockPushService.sendToUser.mockClear();
      await service.notifyScheduleComment('min_1', schedule, comment, 'author_id', 'Ana Paula');
      expect(mockPushService.sendToUser.mock.calls[0][1].body).toBe('Ana Paula comentou na escala "Culto".');
    });

    it('persisted data contains ONLY routing fields (type, ministryId, resourceId)', async () => {
      const schedule: any = {
        id: 'sched_1',
        title: 'Culto de Adoração',
        date: '2026-10-18',
        participants: [{ id: 'user_p1' }],
      };

      await service.notifyScheduleAssigned('min_1', schedule, ['user_p1'], 'actor');

      const record = mockRepo.createNotification.mock.calls[0][0];
      expect(record.data).toEqual({
        type: 'schedule',
        ministryId: 'min_1',
        resourceId: 'sched_1',
      });
      // Zero redundant titles, dates, comments, emails, or phone numbers
      expect(record.data.scheduleTitle).toBeUndefined();
      expect(record.data.date).toBeUndefined();
      expect(record.data.commentContent).toBeUndefined();
      expect(record.data.email).toBeUndefined();
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
