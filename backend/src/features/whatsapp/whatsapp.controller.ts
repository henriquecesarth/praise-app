import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { WhatsAppConnectionService } from './whatsapp-connection.service';

function getParam(param: string | string[] | undefined): string {
  if (!param) return '';
  return Array.isArray(param) ? param[0] : String(param);
}

export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppConnectionService = new WhatsAppConnectionService()
  ) {}

  listConnections = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const actorUserId = req.user!.id;

      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      const result = await this.whatsappService.listConnections(
        organizationId,
        { limit, cursor },
        actorUserId
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  updateConnection = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const connectionId = getParam(req.params.connectionId);
      const actorUserId = req.user!.id;

      const result = await this.whatsappService.updateConnection(
        organizationId,
        connectionId,
        req.body,
        actorUserId
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getMinistryWhatsAppStatus = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = getParam(req.params.ministryId || req.params.groupId);
      const result = await this.whatsappService.getMinistryWhatsAppStatus(ministryId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
