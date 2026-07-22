import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { AppError } from './error-handler';
import { getSupabaseClient } from '../lib/supabase';

export type GroupRole = 'admin' | 'member';

export function requireGroupRole(requiredRole: GroupRole = 'member') {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      const groupId = req.params.groupId || req.params.ministryId;

      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      if (!groupId) {
        throw new AppError(400, 'ID do grupo não informado na requisição.');
      }

      const supabase = getSupabaseClient();

      // Buscar pertencimento e papel do usuário no grupo
      const { data: member, error } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Erro ao verificar permissão do grupo:', error);
      }

      // Se não encontrou registro, verificar se é o dono do grupo
      if (!member) {
        const { data: group } = await supabase
          .from('groups')
          .select('owner_user_id')
          .eq('id', groupId)
          .maybeSingle();

        if (group && group.owner_user_id === userId) {
          // Dono do grupo possui privilégio total de admin
          return next();
        }

        throw new AppError(403, 'Você não possui acesso a este grupo de louvor.');
      }

      // Se exigir admin, member não passa
      if (requiredRole === 'admin' && member.role !== 'admin') {
        throw new AppError(
          403,
          'Ação restrita a administradores do grupo. Seu perfil possui permissão apenas de leitura.'
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function requireActiveSubscription(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = req.params.groupId || req.params.ministryId;

    if (!groupId) {
      return next();
    }

    const supabase = getSupabaseClient();

    const { data: group, error } = await supabase
      .from('groups')
      .select('subscription_status, subscription_expires_at')
      .eq('id', groupId)
      .maybeSingle();

    if (error || !group) {
      return next(); // Se o grupo ainda não existir no DB por migração, prosseguir
    }

    const allowedStatuses = ['active', 'trialing'];
    if (!allowedStatuses.includes(group.subscription_status)) {
      throw new AppError(
        402,
        'Assinatura do grupo inativa ou pendente de pagamento. Entre em contato com o administrador.'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}
