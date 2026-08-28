import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { AppError } from './error-handler';
import { SubscriptionService } from '../features/subscriptions/subscription.service';
import { MinistrySubscriptionStatusSummary } from '../features/subscriptions/subscription.types';

declare global {
  namespace Express {
    interface Request {
      subscriptionSummary?: MinistrySubscriptionStatusSummary;
    }
  }
}

export interface OperationalAccessOptions {
  /**
   * Se true, a operação é explicitamente classificada como ação de remediação
   * (ex.: exclusão de membros para reduzir uso, exclusão de músicas, saída do ministério ou exclusão do próprio ministério).
   * Em `restricted_over_limit`, apenas leituras (GET) e operações com `isRemediation: true` são permitidas.
   */
  isRemediation?: boolean;
}

const subscriptionService = new SubscriptionService();

/**
 * Cria o middleware de enforcement operacional com opções semânticas.
 */
export function createOperationalAccessMiddleware(options: OperationalAccessOptions = {}) {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const rawMinistryId =
        req.params.ministryId ||
        req.params.groupId ||
        req.body?.ministryId ||
        req.body?.ministry_id;

      if (!rawMinistryId) {
        return next();
      }

      const ministryId = Array.isArray(rawMinistryId) ? rawMinistryId[0] : String(rawMinistryId);
      const summary = await subscriptionService.getSubscriptionSummary(ministryId);
      req.subscriptionSummary = summary;

      const { accessMode, administrativelySuspended } = summary.subscription;

      // 1. Suspensão administrativa da plataforma (SUSPENDED)
      // Bloqueia todas as mutações e rotas operacionais.
      if (administrativelySuspended || accessMode === 'suspended') {
        const isStatusInspection =
          req.method === 'GET' &&
          (req.path.endsWith('/subscription') || req.path.endsWith('/my-ministries'));

        if (!isStatusInspection) {
          throw new AppError(
            403,
            'Acesso bloqueado. Este ministério foi administrativamente suspenso pela plataforma. Entre em contato com o suporte.',
            {
              code: 'SUBSCRIPTION_SUSPENDED',
              accessMode: 'suspended',
              ministryId,
            }
          );
        }
        return next();
      }

      // 2. Modo restrito por excesso de uso (RESTRICTED_OVER_LIMIT)
      if (accessMode === 'restricted_over_limit') {
        // Leituras puras (GET) são sempre permitidas (consulta, cifras, exportações, visualização)
        if (req.method === 'GET') {
          return next();
        }

        // Mutações são permitidas APENAS se explicitamente classificadas como remediação
        if (options.isRemediation === true) {
          return next();
        }

        // Qualquer outra mutação operacional (POST, PUT, PATCH ou DELETE não-remediativo) é bloqueada
        throw new AppError(
          403,
          'Operação bloqueada. Este ministério excedeu a quota do plano e o período de carência expirou. Remova recursos excedentes para recuperar a conformidade ou regularize seu plano.',
          {
            code: 'SUBSCRIPTION_RESTRICTED',
            accessMode: 'restricted_over_limit',
            overLimitDetails: summary.overLimitDetails,
            quotas: summary.quotas,
            usage: summary.usage,
            ministryId,
          }
        );
      }

      // 3. Modos `normal` e `grace`: execução operacional permitida
      // (Quotas quantitativas específicas para criação de membros e músicas são validadas na transação)
      return next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware padrão de enforcement operacional (bloqueia mutações em restricted_over_limit).
 */
export const enforceOperationalAccess = Object.assign(
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    return createOperationalAccessMiddleware({ isRemediation: false })(req, res, next);
  },
  {
    remediation: createOperationalAccessMiddleware({ isRemediation: true }),
    strict: createOperationalAccessMiddleware({ isRemediation: false }),
  }
);
