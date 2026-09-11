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

import { OrganizationRepository } from '../repositories/OrganizationRepository';

const organizationRepository = new OrganizationRepository();

export function requireOrganizationRole(
  requiredRole: 'owner' | 'admin' = 'admin',
  orgRepo?: OrganizationRepository
) {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const repo = orgRepo || new OrganizationRepository();
      const userId = req.user?.id;
      const rawOrgId = req.params.organizationId;

      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      if (!rawOrgId) {
        throw new AppError(400, 'ID da organização não informado na requisição.');
      }

      const organizationId = Array.isArray(rawOrgId) ? rawOrgId[0] : String(rawOrgId);
      const member = await repo.getOrganizationMember(organizationId, userId);

      // Anti-IDOR: Se a organização não existir ou o usuário não for integrante, retorna 404 indistinguível
      if (!member) {
        throw new AppError(404, 'Organização não encontrada.');
      }

      // Se a rota exige 'owner', mas o integrante é apenas 'admin', retorna 403
      if (requiredRole === 'owner' && member.role !== 'owner') {
        throw new AppError(403, 'Ação restrita ao proprietário da organização.');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

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
