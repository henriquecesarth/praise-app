import { Router } from 'express';
import { InternalWhatsAppController } from './internal-whatsapp.controller';

const router = Router();
const controller = new InternalWhatsAppController();

router.get('/whatsapp/cleanup-jobs/execute', controller.executeCleanupJobs);
router.post('/whatsapp/cleanup-jobs/:jobId/retry', controller.retryCleanupJob);
router.post('/whatsapp/cleanup-jobs/:jobId/abandon', controller.abandonCleanupJob);
router.get('/whatsapp/reconciliation-jobs/execute', controller.executeReconciliationJobs);

export default router;
