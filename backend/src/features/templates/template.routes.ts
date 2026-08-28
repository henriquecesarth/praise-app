import { Router } from 'express';
import * as controller from './template.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
import { validate } from '../../middleware/validate';
import { createTemplateSchema, updateTemplateSchema } from './template.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', requireMinistryRole('member'), controller.getTemplates);
router.get('/:templateId', requireMinistryRole('member'), controller.getTemplateById);
router.post('/', requireMinistryRole('admin'), enforceOperationalAccess, validate(createTemplateSchema), controller.createTemplate);
router.put('/:templateId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateTemplateSchema), controller.updateTemplate);
router.delete('/:templateId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteTemplate);

export default router;
