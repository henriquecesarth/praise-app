import { Router } from 'express';
import * as smartChordController from './smart_chord.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { setSmartChordRepertoireLinkSchema } from './smart_chord.types';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireMinistryRole('member'));

router.get('/:chordId/repertoire-link', smartChordController.getRepertoireLink);
router.put('/:chordId/repertoire-link', validate(setSmartChordRepertoireLinkSchema), smartChordController.setRepertoireLink);
router.delete('/:chordId/repertoire-link', smartChordController.removeRepertoireLink);

export default router;
