import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  UserNotificationRecord,
  UserNotificationType,
  encodeNotificationCursor,
  decodeNotificationCursor,
} from '../features/notifications/notification.types';

export class NotificationRepository {
  private readonly col = db.collection('user_notifications');

  /**
   * Generates a deterministic document ID for a deduplication key.
   */
  private generateDocId(dedupeKey: string): string {
    const cleanKey = dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    return `notif_${cleanKey}`;
  }

  /**
   * Persists a notification deterministically.
   * If a notification with the dedupe_key already exists, returns the existing record.
   */
  async createNotification(data: {
    user_id: string;
    ministry_id: string;
    type: UserNotificationType;
    resource_id: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    dedupe_key: string;
    created_at?: string;
  }): Promise<{ notification: UserNotificationRecord; isNew: boolean }> {
    const docId = this.generateDocId(data.dedupe_key);
    const ref = this.col.doc(docId);
    const existing = await ref.get();

    if (existing.exists) {
      return {
        notification: { id: existing.id, ...(existing.data() as any) } as UserNotificationRecord,
        isNew: false,
      };
    }

    const now = data.created_at || new Date().toISOString();
    const record: UserNotificationRecord = {
      id: docId,
      user_id: data.user_id,
      ministry_id: data.ministry_id,
      type: data.type,
      resource_id: data.resource_id,
      title: data.title,
      body: data.body,
      data: data.data || {},
      dedupe_key: data.dedupe_key,
      created_at: now,
      read_at: null,
    };

    await ref.set(record);
    return { notification: record, isNew: true };
  }

  /**
   * Retrieves paginated notifications for an authenticated user, newest first.
   */
  async getNotificationsByUser(
    userId: string,
    options: { limit: number; cursor?: string }
  ): Promise<{ items: UserNotificationRecord[]; nextCursor: string | null }> {
    const fetchLimit = options.limit + 1;

    try {
      let query = this.col
        .where('user_id', '==', userId)
        .orderBy('created_at', 'desc')
        .orderBy(FieldPath.documentId(), 'desc');

      if (options.cursor) {
        const cursorData = decodeNotificationCursor(options.cursor, userId);
        query = query.startAfter(cursorData.c, cursorData.id);
      }

      const snap = await query.limit(fetchLimit).get();
      const docs = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as UserNotificationRecord)
      );

      const hasNext = docs.length > options.limit;
      const items = hasNext ? docs.slice(0, options.limit) : docs;

      let nextCursor: string | null = null;
      if (hasNext && items.length > 0) {
        const last = items[items.length - 1];
        nextCursor = encodeNotificationCursor({
          id: last.id,
          c: last.created_at,
          u: userId,
        });
      }

      return { items, nextCursor };
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Erro na query de notificações do Firestore:', err);
        throw new AppError(
          500,
          'Erro ao consultar notificações. Verifique os índices do banco de dados.',
          { code: 'INDEX_REQUIRED_OR_QUERY_ERROR' }
        );
      }

      // Development / Test fallback when index is missing
      const snap = await this.col.where('user_id', '==', userId).get();
      let all = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as UserNotificationRecord)
      );
      all.sort((a, b) => {
        if (b.created_at !== a.created_at) {
          return b.created_at > a.created_at ? 1 : -1;
        }
        return b.id > a.id ? 1 : -1;
      });

      if (options.cursor) {
        const cursorData = decodeNotificationCursor(options.cursor, userId);
        const idx = all.findIndex(
          (item) => item.created_at === cursorData.c && item.id === cursorData.id
        );
        if (idx !== -1) {
          all = all.slice(idx + 1);
        }
      }

      const hasNext = all.length > options.limit;
      const items = hasNext ? all.slice(0, options.limit) : all;
      let nextCursor: string | null = null;
      if (hasNext && items.length > 0) {
        const last = items[items.length - 1];
        nextCursor = encodeNotificationCursor({
          id: last.id,
          c: last.created_at,
          u: userId,
        });
      }

      return { items, nextCursor };
    }
  }

  /**
   * Counts unread notifications for a user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const snap = await this.col
        .where('user_id', '==', userId)
        .where('read_at', '==', null)
        .count()
        .get();
      return snap.data().count;
    } catch {
      // Fallback if count() aggregation or index fails
      const snap = await this.col
        .where('user_id', '==', userId)
        .where('read_at', '==', null)
        .get();
      return snap.size;
    }
  }

  /**
   * Marks a specific notification as read.
   * Fails closed with 404 if notification doesn't exist or belongs to another user.
   */
  async markAsRead(notificationId: string, userId: string): Promise<UserNotificationRecord> {
    const ref = this.col.doc(notificationId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new AppError(404, 'Notificação não encontrada.');
    }

    const data = snap.data() as UserNotificationRecord;
    if (data.user_id !== userId) {
      throw new AppError(404, 'Notificação não encontrada.');
    }

    if (data.read_at) {
      return { ...data, id: snap.id };
    }

    const now = new Date().toISOString();
    await ref.update({ read_at: now });
    return { ...data, id: snap.id, read_at: now };
  }

  /**
   * Marks all unread notifications for a user as read.
   */
  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    const snap = await this.col
      .where('user_id', '==', userId)
      .where('read_at', '==', null)
      .get();

    if (snap.empty) {
      return { updatedCount: 0 };
    }

    const now = new Date().toISOString();
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, { read_at: now });
    });

    await batch.commit();
    return { updatedCount: snap.size };
  }

  /**
   * Deletes all notifications for a user (used during account deletion).
   */
  async deleteNotificationsByUserId(userId: string): Promise<number> {
    const snap = await this.col.where('user_id', '==', userId).get();
    if (snap.empty) return 0;

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return snap.size;
  }
}
