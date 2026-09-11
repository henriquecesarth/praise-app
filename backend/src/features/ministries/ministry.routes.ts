import { Router } from 'express';
import * as controller from './ministry.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
import { validate } from '../../middleware/validate';
import {
  createMinistrySchema,
  updateMinistrySchema,
  createInviteCodeSchema,
  joinMinistrySchema,
  updateMemberRoleSchema,
  addMemberManuallySchema,
} from './ministry.types';
import { OrganizationController } from '../organizations/organization.controller';
import { WhatsAppController } from '../whatsapp/whatsapp.controller';

const router = Router();
const orgController = new OrganizationController();
const whatsappController = new WhatsAppController();

router.use(authenticate);

// Ministry CRUD
router.get('/my-ministries', controller.getUserMinistries);
router.post('/', validate(createMinistrySchema), controller.createMinistry);
router.post('/join', validate(joinMinistrySchema), controller.joinMinistryByCode);
router.get('/:ministryId', requireMinistryRole('member'), controller.getMinistryById);
router.put('/:ministryId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateMinistrySchema), controller.updateMinistry);
router.delete('/:ministryId', requireMinistryRole('admin'), enforceOperationalAccess.remediation, controller.deleteMinistry);

// Leave ministry (any member)
router.delete('/:ministryId/leave', requireMinistryRole('member'), enforceOperationalAccess.remediation, controller.leaveMinistry);

// Organization management (Phase 7B)
router.get('/:ministryId/organization', requireMinistryRole('member'), orgController.getMinistryOrganization);
router.post('/:ministryId/organization/provision', requireMinistryRole('admin'), orgController.provisionForMinistry);

// WhatsApp status (Phase 7C)
router.get('/:ministryId/whatsapp/status', requireMinistryRole('member'), whatsappController.getMinistryWhatsAppStatus);

// Invites
router.post(
  '/:ministryId/invites',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  validate(createInviteCodeSchema),
  controller.createInviteCode
);

// Members
router.get('/:ministryId/members', requireMinistryRole('member'), controller.getMinistryMembers);
router.post(
  '/:ministryId/members',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  validate(addMemberManuallySchema),
  controller.addMemberManually
);
router.patch(
  '/:ministryId/members/:memberId',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  validate(updateMemberRoleSchema),
  controller.updateMemberRole
);
router.delete('/:ministryId/members/:memberId', requireMinistryRole('admin'), enforceOperationalAccess.remediation, controller.removeMember);

export default router;
