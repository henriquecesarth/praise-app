import { Router } from 'express';
import { blockInPreview } from '../../middleware/preview-guard';
import { InternalWhatsAppController } from './internal-whatsapp.controller';

const router = Router();
const controller = new InternalWhatsAppController();

router.use(blockInPreview('Background jobs de WhatsApp'));

router.get('/whatsapp/cleanup-jobs/execute', controller.executeCleanupJobs);
router.post('/whatsapp/cleanup-jobs/:jobId/retry', controller.retryCleanupJob);
router.post('/whatsapp/cleanup-jobs/:jobId/abandon', controller.abandonCleanupJob);
router.get('/whatsapp/reconciliation-jobs/execute', controller.executeReconciliationJobs);

export default router;
