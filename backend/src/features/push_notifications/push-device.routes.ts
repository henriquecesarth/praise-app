import { Router } from 'express';
import { pushDeviceController } from './push-device.controller';
import { validate } from '../../middleware/validate';
import { registerPushDeviceSchema } from './push-notifications.types';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.post(
  '/',
  authenticate,
  validate(registerPushDeviceSchema),
  pushDeviceController.registerDevice
);

router.delete('/:token', authenticate, pushDeviceController.unregisterDevice);
router.delete('/', authenticate, pushDeviceController.unregisterDevice);

export default router;
