import { Router } from 'express';
import * as smartChordController from './smart_chord.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { setSmartChordRepertoireLinkSchema } from './smart_chord.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get(
  '/:chordId/repertoire-link',
  requireMinistryRole('member'),
  smartChordController.getRepertoireLink
);
router.put(
  '/:chordId/repertoire-link',
  requireMinistryRole('admin'),
  validate(setSmartChordRepertoireLinkSchema),
  smartChordController.setRepertoireLink
);
router.delete(
  '/:chordId/repertoire-link',
  requireMinistryRole('admin'),
  smartChordController.removeRepertoireLink
);

export default router;
