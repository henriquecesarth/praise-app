import { Router } from 'express';
import * as controller from './role.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { createRoleSchema, updateRoleSchema } from './role.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', requireMinistryRole('member'), controller.getRoles);
router.get('/:roleId', requireMinistryRole('member'), controller.getRoleById);
router.post('/', requireMinistryRole('admin'), validate(createRoleSchema), controller.createRole);
router.put('/:roleId', requireMinistryRole('admin'), validate(updateRoleSchema), controller.updateRole);
router.delete('/:roleId', requireMinistryRole('admin'), controller.deleteRole);

export default router;
