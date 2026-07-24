import { Router } from 'express';
import * as controller from './schedule.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { createScheduleSchema, updateScheduleSchema, createScheduleCommentSchema } from './schedule.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', requireMinistryRole('member'), controller.listSchedules);
router.get('/:scheduleId', requireMinistryRole('member'), controller.getScheduleById);
router.post('/', requireMinistryRole('admin'), validate(createScheduleSchema), controller.createSchedule);
router.put('/:scheduleId', requireMinistryRole('admin'), validate(updateScheduleSchema), controller.updateSchedule);
router.delete('/:scheduleId', requireMinistryRole('admin'), controller.deleteSchedule);

router.get('/:scheduleId/comments', requireMinistryRole('member'), controller.getScheduleComments);
router.post(
  '/:scheduleId/comments',
  requireMinistryRole('member'),
  validate(createScheduleCommentSchema),
  controller.addScheduleComment
);

export default router;
