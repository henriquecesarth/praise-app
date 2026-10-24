import express, { Router } from 'express';
import { blockInPreview } from '../../middleware/preview-guard';
import { PublicWhatsAppController } from './public-whatsapp.controller';

const router = Router();
const controller = new PublicWhatsAppController();

router.use(blockInPreview('Webhooks de WhatsApp'));

router.get('/zernio/callback', controller.handleZernioCallback);
router.post(
  '/zernio/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  controller.handleZernioWebhook
);

export default router;
