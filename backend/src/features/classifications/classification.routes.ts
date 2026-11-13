import { Router } from 'express';
import * as controller from './classification.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
import { validate } from '../../middleware/validate';
import { createClassificationSchema, updateClassificationSchema } from './classification.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', requireMinistryRole('member'), controller.getClassifications);
router.get('/:classificationId', requireMinistryRole('member'), controller.getClassificationById);
router.post('/', requireMinistryRole('admin'), enforceOperationalAccess, validate(createClassificationSchema), controller.createClassification);
router.put('/:classificationId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateClassificationSchema), controller.updateClassification);
router.delete('/:classificationId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteClassification);

export default router;
