import { db } from '../../lib/firebase';
import { NotificationRepository } from '../../repositories/NotificationRepository';
import { PushNotificationService } from '../push_notifications/push-notification.service';
import { ScheduleRecord, ScheduleCommentRecord } from '../../repositories/ScheduleRepository';
import { AnnouncementRecord } from '../../repositories/AnnouncementRepository';
import {
  UserNotificationRecord,
  UserNotificationType,
} from './notification.types';

export const MATERIAL_SCHEDULE_FIELDS = [
  'title',
  'date',
  'time',
  'duration_minutes',
  'durationMinutes',
] as const;

export function hasMaterialScheduleChanges(
  existing: Partial<ScheduleRecord>,
  updated: Partial<ScheduleRecord>
): boolean {
  if (updated.title !== undefined && updated.title !== existing.title) return true;
  if (updated.date !== undefined && updated.date !== existing.date) return true;
  if (updated.time !== undefined && updated.time !== existing.time) return true;

  const existingDuration =
    existing.duration_minutes !== undefined
      ? existing.duration_minutes
      : existing.durationMinutes;
  const updatedDuration =
    updated.duration_minutes !== undefined
      ? updated.duration_minutes
      : updated.durationMinutes;

  if (updatedDuration !== undefined && updatedDuration !== existingDuration) {
    return true;
  }

  return false;
}

export function formatDateBr(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository = new NotificationRepository(),
    private readonly pushService: PushNotificationService = new PushNotificationService()
  ) {}

  async listUserNotifications(
    userId: string,
    options: { limit: number; cursor?: string }
  ): Promise<{ items: UserNotificationRecord[]; nextCursor: string | null }> {
    return this.repo.getNotificationsByUser(userId, options);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.repo.getUnreadCount(userId);
  }

  async markAsRead(notificationId: string, userId: string): Promise<UserNotificationRecord> {
    return this.repo.markAsRead(notificationId, userId);
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    return this.repo.markAllAsRead(userId);
  }

  /**
   * Resolves schedule participants to authenticated user_ids within a ministry.
   */
  async resolveParticipantUserIds(
    ministryId: string,
    participants: Array<{ id: string; name?: string }>
  ): Promise<string[]> {
    if (!participants || participants.length === 0) return [];

    const rawIds = Array.from(
      new Set(
        participants
          .map((p) => (p as any).userId || (p as any).user_id || p.id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    );

    if (rawIds.length === 0) return [];

    try {
      const membersSnap = await db
        .collection('ministry_members')
        .where('ministry_id', '==', ministryId)
        .get();

      const memberDocMap = new Map<string, string>(); // memberDocId -> user_id
      const memberUserSet = new Set<string>(); // set of all member user_ids

      for (const doc of membersSnap.docs) {
        const data = doc.data();
        if (data.user_id) {
          memberDocMap.set(doc.id, data.user_id);
          memberUserSet.add(data.user_id);
        }
      }

      const resolved = new Set<string>();
      for (const id of rawIds) {
        if (memberDocMap.has(id)) {
          resolved.add(memberDocMap.get(id)!);
        } else if (memberUserSet.has(id)) {
          resolved.add(id);
        }
      }

      return Array.from(resolved);
    } catch (err) {
      console.warn('Erro ao resolver participantes da escala para user_ids:', err);
      return [];
    }
  }

  /**
   * Resolves active member user_ids for a ministry.
   */
  async resolveMinistryMemberUserIds(
    ministryId: string,
    excludeUserId?: string
  ): Promise<string[]> {
    try {
      const [membersSnap, minDoc] = await Promise.all([
        db.collection('ministry_members').where('ministry_id', '==', ministryId).get(),
        db.collection('ministries').doc(ministryId).get(),
      ]);

      const userIds = new Set<string>();

      for (const doc of membersSnap.docs) {
        const uid = doc.data()?.user_id;
        if (uid && (!excludeUserId || uid !== excludeUserId)) {
          userIds.add(uid);
        }
      }

      if (minDoc.exists) {
        const ownerId = minDoc.data()?.owner_user_id;
        if (ownerId && (!excludeUserId || ownerId !== excludeUserId)) {
          userIds.add(ownerId);
        }
      }

      return Array.from(userIds);
    } catch (err) {
      console.warn('Erro ao buscar membros do ministério para notificações:', err);
      return [];
    }
  }

  /**
   * Dispatches persistent notification and sends FCM push notification.
   * Never throws or bubbles errors to caller.
   */
  private async dispatchToUser(params: {
    userId: string;
    ministryId: string;
    type: UserNotificationType;
    resourceId: string;
    title: string;
    body: string;
    dedupeKey: string;
    pushType: 'schedule' | 'schedule_comment' | 'announcement';
    data?: Record<string, any>;
  }): Promise<void> {
    try {
      const { notification, isNew } = await this.repo.createNotification({
        user_id: params.userId,
        ministry_id: params.ministryId,
        type: params.type,
        resource_id: params.resourceId,
        title: params.title,
        body: params.body,
        data: params.data,
        dedupe_key: params.dedupeKey,
      });

      // If notification was already created previously by dedupe_key, do not duplicate push
      if (!isNew) {
        return;
      }

      // Best-effort push dispatch
      try {
        await this.pushService.sendToUser(params.userId, {
          title: params.title,
          body: params.body,
          data: {
            type: params.pushType,
            ministryId: params.ministryId,
            resourceId: params.resourceId,
            notificationId: notification.id,
          },
        });
      } catch (pushErr) {
        console.warn(`Falha não-bloqueante no envio de push para ${params.userId}:`, pushErr);
      }
    } catch (err) {
      console.warn(`Falha não-bloqueante ao registrar notificação para ${params.userId}:`, err);
    }
  }

  /**
   * Triggers schedule_assigned notifications for newly assigned participants.
   */
  async notifyScheduleAssigned(
    ministryId: string,
    schedule: ScheduleRecord,
    participantUserIds: string[],
    actorId?: string
  ): Promise<void> {
    const dateFormatted = formatDateBr(schedule.date);
    const timeFormatted = schedule.time ? ` às ${schedule.time}` : '';
    const title = `Nova escala: ${schedule.title}`;
    const body = `Você foi escalado(a) para ${schedule.title} (${dateFormatted}${timeFormatted}).`;

    for (const userId of participantUserIds) {
      if (actorId && userId === actorId) continue;

      const dedupeKey = `sched_assign_${schedule.id}_${userId}`;
      await this.dispatchToUser({
        userId,
        ministryId,
        type: 'schedule_assigned',
        resourceId: schedule.id,
        title,
        body,
        dedupeKey,
        pushType: 'schedule',
        data: {
          scheduleId: schedule.id,
          scheduleTitle: schedule.title,
          date: schedule.date,
        },
      });
    }
  }

  /**
   * Triggers schedule_updated notifications when material fields change.
   * Also identifies newly assigned participants and triggers schedule_assigned for them.
   */
  async notifyScheduleUpdated(
    ministryId: string,
    previousSchedule: ScheduleRecord,
    updatedSchedule: ScheduleRecord,
    actorId?: string
  ): Promise<void> {
    const prevUserIds = await this.resolveParticipantUserIds(
      ministryId,
      previousSchedule.participants || []
    );
    const updatedUserIds = await this.resolveParticipantUserIds(
      ministryId,
      updatedSchedule.participants || []
    );

    // 1. Newly assigned participants get schedule_assigned
    const newUserIds = updatedUserIds.filter((id) => !prevUserIds.includes(id));
    if (newUserIds.length > 0) {
      await this.notifyScheduleAssigned(ministryId, updatedSchedule, newUserIds, actorId);
    }

    // 2. Check material changes for remaining existing participants
    if (hasMaterialScheduleChanges(previousSchedule, updatedSchedule)) {
      const remainingUserIds = updatedUserIds.filter(
        (id) => prevUserIds.includes(id) && (!actorId || id !== actorId)
      );

      const title = `Escala alterada: ${updatedSchedule.title}`;
      const body = `A data ou horário da escala "${updatedSchedule.title}" foi alterada.`;
      const updateTimestamp = updatedSchedule.updated_at || new Date().toISOString();

      for (const userId of remainingUserIds) {
        const dedupeKey = `sched_update_${updatedSchedule.id}_${userId}_${updateTimestamp}`;
        await this.dispatchToUser({
          userId,
          ministryId,
          type: 'schedule_updated',
          resourceId: updatedSchedule.id,
          title,
          body,
          dedupeKey,
          pushType: 'schedule',
          data: {
            scheduleId: updatedSchedule.id,
            scheduleTitle: updatedSchedule.title,
            date: updatedSchedule.date,
          },
        });
      }
    }
  }

  /**
   * Triggers schedule_comment notifications to participants (excluding comment author).
   */
  async notifyScheduleComment(
    ministryId: string,
    schedule: ScheduleRecord,
    comment: ScheduleCommentRecord,
    authorId: string,
    authorName: string
  ): Promise<void> {
    const participantUserIds = await this.resolveParticipantUserIds(
      ministryId,
      schedule.participants || []
    );

    const recipientUserIds = participantUserIds.filter((id) => id !== authorId);
    if (recipientUserIds.length === 0) return;

    const title = 'Novo comentário na escala';
    const body = `${authorName || 'Um participante'} comentou na escala "${schedule.title}".`;

    for (const userId of recipientUserIds) {
      const dedupeKey = `sched_comm_${schedule.id}_${comment.id}_${userId}`;
      await this.dispatchToUser({
        userId,
        ministryId,
        type: 'schedule_comment',
        resourceId: schedule.id,
        title,
        body,
        dedupeKey,
        pushType: 'schedule_comment',
        data: {
          scheduleId: schedule.id,
          scheduleTitle: schedule.title,
          commentId: comment.id,
        },
      });
    }
  }

  /**
   * Triggers announcement notifications to active members (excluding announcement author).
   */
  async notifyAnnouncementCreated(
    ministryId: string,
    announcement: AnnouncementRecord,
    authorId: string
  ): Promise<void> {
    const memberUserIds = await this.resolveMinistryMemberUserIds(ministryId, authorId);
    if (memberUserIds.length === 0) return;

    const title = 'Novo comunicado';
    const body = announcement.title;

    for (const userId of memberUserIds) {
      const dedupeKey = `announcement_${announcement.id}_${userId}`;
      await this.dispatchToUser({
        userId,
        ministryId,
        type: 'announcement',
        resourceId: announcement.id,
        title,
        body,
        dedupeKey,
        pushType: 'announcement',
        data: {
          announcementId: announcement.id,
          announcementTitle: announcement.title,
        },
      });
    }
  }
}
