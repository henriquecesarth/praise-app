import { Router } from 'express';
import * as controller from './auth.controller';
import { validate } from '../../middleware/validate';
import { signupSchema, loginSchema } from './auth.types';
import { authenticate } from '../../middleware/auth';

import accountDeletionRoutes from '../account_deletion/account-deletion.routes';

const router = Router();

router.post('/signup', validate(signupSchema), controller.signUp);
router.post('/login', validate(loginSchema), controller.login);
router.get('/me', authenticate, controller.getMe);
router.use('/account-deletion', accountDeletionRoutes);

export default router;
