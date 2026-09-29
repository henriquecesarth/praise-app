import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AccountDeletionService } from './account-deletion.service';
import { AppError } from '../../middleware/error-handler';

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
      const result = await this.service.evaluatePreflight(userId, req.user?.email);
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
}
