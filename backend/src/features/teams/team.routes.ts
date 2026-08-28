import { Router } from 'express';
import * as controller from './team.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
import { validate } from '../../middleware/validate';
import { createTeamSchema, updateTeamSchema } from './team.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', requireMinistryRole('member'), controller.getTeams);
router.get('/:teamId', requireMinistryRole('member'), controller.getTeamById);
router.post('/', requireMinistryRole('admin'), enforceOperationalAccess, validate(createTeamSchema), controller.createTeam);
router.put('/:teamId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateTeamSchema), controller.updateTeam);
router.delete('/:teamId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteTeam);

export default router;
