import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { SubscriptionService } from './subscription.service';
import { PLANS_CATALOG, MEMBER_ADDON_BLOCK_SIZE, DEFAULT_GRACE_PERIOD_DAYS } from '../../config/plans.config';

export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService = new SubscriptionService()
  ) {}

  /**
   * GET /api/v1/plans
   * Retorna o catálogo público oficial de planos comerciais e parâmetros de add-on.
   */
  getPlans = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plans = Object.values(PLANS_CATALOG).map((p) => ({
        id: p.id,
        name: p.name,
        baseMembers: p.baseMembers,
        baseSongs: p.baseSongs,
        allowMemberAddons: p.allowMemberAddons,
        maxMemberAddonBlocks: p.maxMemberAddonBlocks,
        monthlyPriceCents: p.monthlyPriceCents,
        annualPriceCents: p.annualPriceCents,
        addonBlockMonthlyPriceCents: p.addonBlockMonthlyPriceCents,
        addonBlockAnnualPriceCents: p.addonBlockAnnualPriceCents,
      }));


      res.json({
        plans,
        addonBlockSize: MEMBER_ADDON_BLOCK_SIZE,
        defaultGracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/ministries/:ministryId/subscription
   * Retorna o resumo resolvido de assinatura, quotas e uso para um ministério.
   * Acesso restrito a integrantes do ministério (tenant-scoped).
   */
  getMinistrySubscription = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const rawMinistryId = req.params.ministryId || req.params.groupId;
      const ministryId = Array.isArray(rawMinistryId) ? rawMinistryId[0] : String(rawMinistryId);

      const summary = await this.subscriptionService.getSubscriptionSummary(ministryId);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  };
}

const instance = new SubscriptionController();
export const getPlans = instance.getPlans;
export const getMinistrySubscription = instance.getMinistrySubscription;
