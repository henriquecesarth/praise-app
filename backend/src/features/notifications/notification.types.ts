import { z } from 'zod';
import { AppError } from '../../middleware/error-handler';

export type UserNotificationType =
  | 'schedule_assigned'
  | 'schedule_updated'
  | 'schedule_comment'
  | 'announcement';

export interface UserNotificationRecord {
  id: string;
  user_id: string;
  ministry_id: string;
  type: UserNotificationType;
  resource_id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  dedupe_key: string;
  created_at: string;
  read_at: string | null;
}

export interface NotificationCursorData {
  id: string;
  c: string; // created_at
  u: string; // user_id
}

export function encodeNotificationCursor(data: NotificationCursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeNotificationCursor(
  token: string,
  expectedUserId: string
): NotificationCursorData {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.c || !parsed.u) {
      throw new Error('Formato de cursor inválido');
    }
    if (parsed.u !== expectedUserId) {
      throw new AppError(403, 'Acesso negado: cursor pertence a outro usuário.', {
        code: 'CROSS_USER_CURSOR_REJECTED',
      });
    }
    return parsed as NotificationCursorData;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Token de cursor inválido.');
  }
}

export const listNotificationsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 20;
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed < 1) return 20;
      return Math.min(parsed, 50);
    }),
  cursor: z.string().trim().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamSchema = z.object({
  notificationId: z.string().trim().min(1, 'ID da notificação é obrigatório'),
});

export type NotificationIdParam = z.infer<typeof notificationIdParamSchema>;
