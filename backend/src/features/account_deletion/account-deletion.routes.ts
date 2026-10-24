import { Router } from 'express';
import { AccountDeletionController } from './account-deletion.controller';
import { authenticate, requireRecentFirebaseAuth } from '../../middleware/auth';
import { blockInPreview } from '../../middleware/preview-guard';

const router = Router();
const controller = new AccountDeletionController();

router.get('/preflight', authenticate, controller.getPreflight);
router.post('/', blockInPreview('Exclusão de conta'), requireRecentFirebaseAuth, controller.deleteAccount);
router.get('/status', authenticate, controller.getStatus);
router.post('/internal/reconcile/:userId', blockInPreview('Reconciliação de exclusão de conta'), controller.reconcileAccount);

export default router;
