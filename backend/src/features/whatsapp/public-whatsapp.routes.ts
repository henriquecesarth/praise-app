import { Router } from 'express';
import { PublicWhatsAppController } from './public-whatsapp.controller';

const router = Router();
const controller = new PublicWhatsAppController();

router.get('/zernio/callback', controller.handleZernioCallback);

export default router;
