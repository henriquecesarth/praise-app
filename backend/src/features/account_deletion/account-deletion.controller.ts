import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AccountDeletionService } from './account-deletion.service';
import { AppError } from '../../middleware/error-handler';
import { config } from '../../config/unifiedConfig';
import { verifyBearerSecret } from '../whatsapp/internal-whatsapp.controller';

export class AccountDeletionController {
  constructor(
    private readonly service: AccountDeletionService = new AccountDeletionService()
  ) {}

  getPreflight = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const result = await this.service.evaluatePreflight(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  deleteAccount = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const result = await this.service.executeDeletion(userId, req.user?.email);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getStatus = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const job = await this.service.getDeletionStatus(userId);
      res.json({ job });
    } catch (err) {
      next(err);
    }
  };

  reconcileAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const cronSecret = process.env.CRON_SECRET || config.cronSecret;

      if (!verifyBearerSecret(authHeader, cronSecret)) {
        throw new AppError(401, 'UNAUTHORIZED: Credencial interna de recuperação inválida ou ausente.', {
          code: 'UNAUTHORIZED',
        });
      }

      const rawUserId = req.params.userId;
      const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
      if (!userId || typeof userId !== 'string') {
        throw new AppError(400, 'userId é obrigatório.');
      }

      const job = await this.service.reconcileJob(userId);
      res.json({ success: true, message: 'Reconciliação executada com sucesso.', job });
    } catch (err) {
      next(err);
    }
  };
}
