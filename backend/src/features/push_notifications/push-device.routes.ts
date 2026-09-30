import { Router } from 'express';
import { pushDeviceController } from './push-device.controller';
import { validate } from '../../middleware/validate';
import { registerPushDeviceSchema, unregisterPushDeviceSchema } from './push-notifications.types';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.post(
  '/',
  authenticate,
  validate(registerPushDeviceSchema),
  pushDeviceController.registerDevice
);

router.delete(
  '/',
  authenticate,
  validate(unregisterPushDeviceSchema),
  pushDeviceController.unregisterDevice
);

export default router;
