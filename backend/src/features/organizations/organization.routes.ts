import { Router } from 'express';
import { OrganizationController } from './organization.controller';
import { authenticate } from '../../middleware/auth';
import { requireOrganizationRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { addOrganizationMemberSchema } from './organization.types';

const router = Router();
const controller = new OrganizationController();

router.use(authenticate);

// Organization details
router.get('/:organizationId', requireOrganizationRole('admin'), controller.getOrganizationById);

// Organization members
router.get('/:organizationId/members', requireOrganizationRole('admin'), controller.listOrganizationMembers);
router.post(
  '/:organizationId/members',
  requireOrganizationRole('owner'),
  validate(addOrganizationMemberSchema),
  controller.addOrganizationAdmin
);
router.delete(
  '/:organizationId/members/:userId',
  requireOrganizationRole('owner'),
  controller.removeOrganizationAdmin
);

// Entitlements
router.get(
  '/:organizationId/entitlements/whatsapp',
  requireOrganizationRole('admin'),
  controller.getWhatsAppCapacity
);

// Ministry attach/detach
router.post(
  '/:organizationId/ministries/:ministryId',
  requireOrganizationRole('owner'),
  controller.attachMinistry
);
router.delete(
  '/:organizationId/ministries/:ministryId',
  requireOrganizationRole('owner'),
  controller.detachMinistry
);

export default router;
