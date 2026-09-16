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
}
