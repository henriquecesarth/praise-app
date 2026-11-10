import { Router } from 'express';
import { VocalExerciseController } from './vocal-exercise.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  customVocalExerciseSchema,
  updateCustomVocalExerciseSchema,
} from './vocal-exercise.types';

const router = Router();
const controller = new VocalExerciseController();

router.use(authenticate);

router.get('/custom', controller.list);
router.get('/custom/:id', controller.getById);
router.post('/custom', validate(customVocalExerciseSchema), controller.create);
router.patch('/custom/:id', validate(updateCustomVocalExerciseSchema), controller.update);
router.delete('/custom/:id', controller.delete);

export default router;
