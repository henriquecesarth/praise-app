import express, { Router } from 'express';
import { PublicWhatsAppController } from './public-whatsapp.controller';

const router = Router();
const controller = new PublicWhatsAppController();

router.get('/zernio/callback', controller.handleZernioCallback);
router.post(
  '/zernio/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  controller.handleZernioWebhook
);

export default router;
