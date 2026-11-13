import { Router } from 'express';
import * as controller from './announcement.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
import { validate } from '../../middleware/validate';
import { createAnnouncementSchema, updateAnnouncementSchema } from './announcement.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', requireMinistryRole('member'), controller.getAnnouncements);
router.get('/:announcementId', requireMinistryRole('member'), controller.getAnnouncementById);
router.post('/', requireMinistryRole('admin'), enforceOperationalAccess, validate(createAnnouncementSchema), controller.createAnnouncement);
router.put('/:announcementId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateAnnouncementSchema), controller.updateAnnouncement);
router.delete('/:announcementId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteAnnouncement);

export default router;
