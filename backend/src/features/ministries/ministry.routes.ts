import { Router } from 'express';
import * as controller from './ministry.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole, requireActiveSubscription } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import {
  createMinistrySchema,
  updateMinistrySchema,
  createInviteCodeSchema,
  joinMinistrySchema,
  updateMemberRoleSchema,
  addMemberManuallySchema,
} from './ministry.types';

const router = Router();

router.use(authenticate);

// Ministry CRUD
router.get('/my-ministries', controller.getUserMinistries);
router.post('/', validate(createMinistrySchema), controller.createMinistry);
router.post('/join', validate(joinMinistrySchema), controller.joinMinistryByCode);
router.get('/:ministryId', requireMinistryRole('member'), controller.getMinistryById);
router.put('/:ministryId', requireMinistryRole('admin'), validate(updateMinistrySchema), controller.updateMinistry);
router.delete('/:ministryId', requireMinistryRole('admin'), controller.deleteMinistry);

// Leave ministry (any member)
router.delete('/:ministryId/leave', requireMinistryRole('member'), controller.leaveMinistry);

// Invites
router.post(
  '/:ministryId/invites',
  requireMinistryRole('admin'),
  requireActiveSubscription,
  validate(createInviteCodeSchema),
  controller.createInviteCode
);

// Members
router.get('/:ministryId/members', requireMinistryRole('member'), controller.getMinistryMembers);
router.post(
  '/:ministryId/members',
  requireMinistryRole('admin'),
  validate(addMemberManuallySchema),
  controller.addMemberManually
);
router.patch(
  '/:ministryId/members/:memberId',
  requireMinistryRole('admin'),
  validate(updateMemberRoleSchema),
  controller.updateMemberRole
);
router.delete('/:ministryId/members/:memberId', requireMinistryRole('admin'), controller.removeMember);

export default router;
