import { Router } from 'express';
import { AccountDeletionController } from './account-deletion.controller';
import { authenticate, requireRecentFirebaseAuth } from '../../middleware/auth';

const router = Router();
const controller = new AccountDeletionController();

router.get('/preflight', authenticate, controller.getPreflight);
router.post('/', requireRecentFirebaseAuth, controller.deleteAccount);
router.get('/status', authenticate, controller.getStatus);
router.post('/internal/reconcile/:userId', controller.reconcileAccount);

export default router;
