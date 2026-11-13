import { Router } from 'express';
import * as controller from './availability.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
import { validate } from '../../middleware/validate';
import {
  createUnavailabilitySchema,
  updateUnavailabilitySchema,
  listUnavailabilityQuerySchema,
  checkAvailabilityConflictsSchema,
  listConsolidatedAvailabilityQuerySchema,
} from './availability.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get(
  '/',
  requireMinistryRole('admin'),
  validate(listConsolidatedAvailabilityQuerySchema, 'query'),
  controller.listConsolidatedAvailability
);

router.post(
  '/check-conflicts',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  validate(checkAvailabilityConflictsSchema),
  controller.checkScheduleConflicts
);

router.get('/my', requireMinistryRole('member'), validate(listUnavailabilityQuerySchema, 'query'), controller.listMyUnavailabilities);
router.post('/my', requireMinistryRole('member'), enforceOperationalAccess, validate(createUnavailabilitySchema), controller.createMyUnavailability);
router.patch('/my/:id', requireMinistryRole('member'), enforceOperationalAccess, validate(updateUnavailabilitySchema), controller.updateMyUnavailability);
router.delete('/my/:id', requireMinistryRole('member'), enforceOperationalAccess, controller.deleteMyUnavailability);

// ─── Manual Member Availability (Phase 6D-2) ──────────────────────────────
router.get(
  '/members/:memberId',
  requireMinistryRole('admin'),
  validate(listUnavailabilityQuerySchema, 'query'),
  controller.listManualMemberUnavailabilities
);
router.post(
  '/members/:memberId',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  validate(createUnavailabilitySchema),
  controller.createManualMemberUnavailability
);
router.patch(
  '/members/:memberId/:id',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  validate(updateUnavailabilitySchema),
  controller.updateManualMemberUnavailability
);
router.delete(
  '/members/:memberId/:id',
  requireMinistryRole('admin'),
  enforceOperationalAccess,
  controller.deleteManualMemberUnavailability
);

export default router;
