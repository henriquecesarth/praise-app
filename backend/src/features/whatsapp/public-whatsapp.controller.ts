import { Request, Response, NextFunction } from 'express';
import { WhatsAppConnectionService } from './whatsapp-connection.service';

export class PublicWhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppConnectionService = new WhatsAppConnectionService()
  ) {}

  handleZernioCallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redirectUrl = await this.whatsappService.handleZernioCallback(
        req.query as Record<string, string | undefined>
      );
      res.redirect(302, redirectUrl);
    } catch (err) {
      next(err);
    }
  };

  handleZernioWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers['x-zernio-signature'] as string | undefined;
      const headerEventId = req.headers['x-zernio-event-id'] as string | undefined;
      const result = await this.whatsappService.handleZernioWebhook({
        rawBody: req.body,
        signature,
        headerEventId,
      });
      res.status(result.statusCode).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}
