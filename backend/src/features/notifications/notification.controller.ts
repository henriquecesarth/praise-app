import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { NotificationService } from './notification.service';
import { AppError } from '../../middleware/error-handler';

const notificationService = new NotificationService();

export async function listNotifications(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError(401, 'Não autenticado.');
    }

    const limit = (req.query as any)?.limit ?? 20;
    const cursor = (req.query as any)?.cursor;

    const result = await notificationService.listUserNotifications(userId, {
      limit: typeof limit === 'number' ? limit : parseInt(limit, 10) || 20,
      cursor: typeof cursor === 'string' ? cursor : undefined,
    });

    res.json({
      items: result.items,
      nextCursor: result.nextCursor,
      notifications: result.items,
    });
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError(401, 'Não autenticado.');
    }

    const count = await notificationService.getUnreadCount(userId);
    res.json({
      unreadCount: count,
      count,
    });
  } catch (err) {
    next(err);
  }
}

export async function markAsRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError(401, 'Não autenticado.');
    }

    const notificationId = req.params.notificationId as string;
    if (!notificationId) {
      throw new AppError(400, 'ID da notificação é obrigatório.');
    }

    const updated = await notificationService.markAsRead(notificationId, userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function markAllAsRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError(401, 'Não autenticado.');
    }

    const result = await notificationService.markAllAsRead(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
