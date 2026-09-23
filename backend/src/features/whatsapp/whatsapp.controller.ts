import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { AppError } from '../../middleware/error-handler';

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

  disconnectConnection = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const connectionId = getParam(req.params.connectionId);
      const actorUserId = req.user?.id;

      if (!actorUserId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      await this.whatsappService.disconnectConnection(
        organizationId,
        connectionId,
        actorUserId
      );

      res.json({
        success: true,
        connectionId,
        status: 'disconnected',
      });
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

  startOnboarding = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const actorUserId = req.user!.id;

      const result = await this.whatsappService.startOnboarding(
        organizationId,
        actorUserId,
        req.body
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  completeOnboarding = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const actorUserId = req.user!.id;

      const result = await this.whatsappService.completeOnboarding(
        organizationId,
        actorUserId,
        req.body
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
