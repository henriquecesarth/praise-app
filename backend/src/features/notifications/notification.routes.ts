import { Router } from 'express';
import * as controller from './notification.controller';
import { validate } from '../../middleware/validate';
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notification.types';

const router = Router();

router.get(
  '/',
  validate(listNotificationsQuerySchema, 'query'),
  controller.listNotifications
);

router.get('/unread-count', controller.getUnreadCount);

router.patch('/read-all', controller.markAllAsRead);

router.patch(
  '/:notificationId/read',
  validate(notificationIdParamSchema, 'params'),
  controller.markAsRead
);

export default router;
