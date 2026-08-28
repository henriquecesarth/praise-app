import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { AppError } from './error-handler';
import { MinistryRepository } from '../repositories/MinistryRepository';

export type MinistryRole = 'admin' | 'member';
export type GroupRole = MinistryRole;

const ministryRepository = new MinistryRepository();

export function requireMinistryRole(requiredRole: MinistryRole = 'member') {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      const rawMinistryId = req.params.ministryId || req.params.groupId;

      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      if (!rawMinistryId) {
        throw new AppError(400, 'ID do ministério não informado na requisição.');
      }

      const ministryId = Array.isArray(rawMinistryId) ? rawMinistryId[0] : String(rawMinistryId);
      const ministry = await ministryRepository.getMinistryById(ministryId, userId);

      if (requiredRole === 'admin' && ministry.role !== 'admin') {
        throw new AppError(
          403,
          'Ação restrita a administradores do ministério. Seu perfil possui permissão apenas de leitura.'
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireGroupRole = requireMinistryRole;

/**
 * @deprecated Middleware legado substituído por `enforceOperationalAccess` e transações atômicas de quota.
 * Mantido apenas por compatibilidade temporária sem qualquer uso nas rotas ativas.
 */
export async function requireActiveSubscription(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawMinistryId = req.params.ministryId || req.params.groupId;

    if (!rawMinistryId) {
      return next();
    }

    const ministryId = Array.isArray(rawMinistryId) ? rawMinistryId[0] : String(rawMinistryId);

    try {
      const ministry = await ministryRepository.getMinistryById(ministryId, req.user?.id || '');
      const allowedStatuses = ['active', 'trialing'];
      if (!allowedStatuses.includes(ministry.subscription_status)) {
        throw new AppError(
          402,
          'Assinatura do ministério inativa ou pendente de pagamento. Entre em contato com o administrador.'
        );
      }
    } catch (err: any) {
      if (err.statusCode === 402) throw err;
    }

    next();
  } catch (err) {
    next(err);
  }
}
