import { Router } from 'express';
import * as controller from './availability.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import {
  createUnavailabilitySchema,
  updateUnavailabilitySchema,
  listUnavailabilityQuerySchema,
} from './availability.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/my', requireMinistryRole('member'), validate(listUnavailabilityQuerySchema, 'query'), controller.listMyUnavailabilities);
router.post('/my', requireMinistryRole('member'), validate(createUnavailabilitySchema), controller.createMyUnavailability);
router.patch('/my/:id', requireMinistryRole('member'), validate(updateUnavailabilitySchema), controller.updateMyUnavailability);
router.delete('/my/:id', requireMinistryRole('member'), controller.deleteMyUnavailability);

export default router;
