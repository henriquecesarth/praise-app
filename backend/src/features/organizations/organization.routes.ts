import { Router } from 'express';
import { OrganizationController } from './organization.controller';
import { WhatsAppController } from '../whatsapp/whatsapp.controller';
import { authenticate } from '../../middleware/auth';
import { requireOrganizationRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { addOrganizationMemberSchema } from './organization.types';
import {
  updateWhatsAppConnectionSchema,
  listWhatsAppConnectionsQuerySchema,
  startWhatsAppOnboardingSchema,
  completeWhatsAppOnboardingSchema,
} from '../whatsapp/whatsapp.types';

const router = Router();
const controller = new OrganizationController();
const whatsappController = new WhatsAppController();

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

// WhatsApp Connections (Phase 7C)
router.get(
  '/:organizationId/whatsapp/connections',
  requireOrganizationRole('admin'),
  validate(listWhatsAppConnectionsQuerySchema, 'query'),
  whatsappController.listConnections
);
router.patch(
  '/:organizationId/whatsapp/connections/:connectionId',
  requireOrganizationRole('admin'),
  validate(updateWhatsAppConnectionSchema),
  whatsappController.updateConnection
);

// WhatsApp Onboarding (Phase 7D1)
router.post(
  '/:organizationId/whatsapp/onboarding/start',
  requireOrganizationRole('admin'),
  validate(startWhatsAppOnboardingSchema),
  whatsappController.startOnboarding
);
router.post(
  '/:organizationId/whatsapp/onboarding/complete',
  requireOrganizationRole('admin'),
  validate(completeWhatsAppOnboardingSchema),
  whatsappController.completeOnboarding
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
