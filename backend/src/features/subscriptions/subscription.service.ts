import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import {
  PLANS_CATALOG,
  DEFAULT_PLAN_ID,
  DEFAULT_GRACE_PERIOD_DAYS,
  getPlanDefinition,
  getEffectiveMemberQuota,
  getEffectiveSongQuota,
  isUsageOverLimit,
  resolveAccessMode,
  PlanId,
  EffectiveQuotas,
} from '../../config/plans.config';
import {
  MinistrySubscriptionRecord,
  MinistryUsageRecord,
  MinistrySubscriptionStatusSummary,
} from './subscription.types';
import { AppError } from '../../middleware/error-handler';

export class SubscriptionService {
  constructor(
    private readonly subscriptionRepo: SubscriptionRepository = new SubscriptionRepository()
  ) {}

  /**
   * Retorna o resumo completo de assinatura, quotas e uso para um ministério.
   * Não realiza escritas colaterais no banco de dados em operações GET (leitura pura).
   */
  async getSubscriptionSummary(ministryId: string): Promise<MinistrySubscriptionStatusSummary> {
    const now = new Date();

    // 1. Obter assinatura persistida ou utilizar fallback seguro em memória
    let subscription = await this.subscriptionRepo.getSubscription(ministryId);
    if (!subscription) {
      subscription = {
        id: ministryId,
        ministry_id: ministryId,
        plan_id: DEFAULT_PLAN_ID,
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: now.toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
    }

    // 2. Obter usage materializado ou calcular a partir dos dados reais em memória
    let usage = await this.subscriptionRepo.getUsage(ministryId);
    if (!usage) {
      const realCounts = await this.subscriptionRepo.countRealData(ministryId);
      usage = {
        id: ministryId,
        ministry_id: ministryId,
        members_count: realCounts.realMembersCount,
        songs_count: realCounts.realSongsCount,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
    }

    // 3. Resolver definições e estado de acesso
    const plan = getPlanDefinition(subscription.plan_id);
    const resolvedState = resolveAccessMode(subscription, plan, usage, now);

    return {
      plan,
      subscription: {
        planId: subscription.plan_id,
        memberAddonBlocks: subscription.member_addon_blocks || 0,
        billingStatus: subscription.billing_status,
        administrativelySuspended: Boolean(subscription.administratively_suspended),
        suspendedAt: subscription.suspended_at || null,
        suspensionReason: subscription.suspension_reason || null,
        accessMode: resolvedState.accessMode,
        gracePeriodExpiresAt: subscription.grace_period_expires_at || null,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end || null,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      },
      quotas: resolvedState.effectiveQuotas,
      usage: {
        membersCount: usage.members_count,
        songsCount: usage.songs_count,
      },
      isOverLimit: resolvedState.isOverLimit,
      overLimitDetails: resolvedState.overLimitDetails,
      graceDaysRemaining: resolvedState.graceDaysRemaining,
    };
  }

  /**
   * Primitiva interna de transição de plano (para uso por testes, fixtures e futuros webhooks de pagamento).
   * Não apaga dados em caso de downgrade.
   */
  async changePlan(ministryId: string, targetPlanId: PlanId): Promise<MinistrySubscriptionRecord> {
    if (!(targetPlanId in PLANS_CATALOG)) {
      throw new AppError(400, `Plano inválido: ${targetPlanId}`);
    }

    const { subscription, usage } = await this.subscriptionRepo.ensureSubscriptionAndUsage(ministryId);
    const newPlan = getPlanDefinition(targetPlanId);

    // Ajustar blocos de add-ons se o novo plano tiver teto inferior
    let newAddonBlocks = subscription.member_addon_blocks || 0;
    if (!newPlan.allowMemberAddons || newPlan.maxMemberAddonBlocks === 0) {
      newAddonBlocks = 0;
    } else {
      newAddonBlocks = Math.min(newAddonBlocks, newPlan.maxMemberAddonBlocks);
    }

    const newEffectiveQuotas: EffectiveQuotas = {
      members: getEffectiveMemberQuota(newPlan, newAddonBlocks),
      songs: getEffectiveSongQuota(newPlan),
    };

    const overLimitInfo = isUsageOverLimit(usage, newEffectiveQuotas);
    const now = new Date();
    let graceExpiresAt: string | null = subscription.grace_period_expires_at;

    if (overLimitInfo.isOverLimit) {
      // Se a nova capacidade reduziu e causou over-limit, registra a carência de 7 dias
      graceExpiresAt = new Date(now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    } else {
      // Se está dentro da quota, limpa qualquer carência anterior
      graceExpiresAt = null;
    }

    const updatedSub: MinistrySubscriptionRecord = {
      ...subscription,
      plan_id: targetPlanId,
      member_addon_blocks: newAddonBlocks,
      grace_period_expires_at: graceExpiresAt,
      updated_at: now.toISOString(),
    };

    await this.subscriptionRepo.setSubscription(updatedSub);
    return updatedSub;
  }

  /**
   * Primitiva interna para ajuste de blocos de add-on de membros.
   */
  async changeMemberAddonBlocks(ministryId: string, blocks: number): Promise<MinistrySubscriptionRecord> {
    if (typeof blocks !== 'number' || blocks < 0 || !Number.isInteger(blocks)) {
      throw new AppError(400, 'Quantidade de blocos deve ser um número inteiro maior ou igual a zero.');
    }

    const { subscription, usage } = await this.subscriptionRepo.ensureSubscriptionAndUsage(ministryId);
    const plan = getPlanDefinition(subscription.plan_id);

    if (!plan.allowMemberAddons && blocks > 0) {
      throw new AppError(400, `O plano ${plan.name} não suporta add-ons de membros.`);
    }

    if (blocks > plan.maxMemberAddonBlocks) {
      throw new AppError(
        400,
        `O plano ${plan.name} permite no máximo ${plan.maxMemberAddonBlocks} blocos de add-on (+${plan.maxMemberAddonBlocks * 10} membros).`
      );
    }

    const newEffectiveQuotas: EffectiveQuotas = {
      members: getEffectiveMemberQuota(plan, blocks),
      songs: getEffectiveSongQuota(plan),
    };

    const overLimitInfo = isUsageOverLimit(usage, newEffectiveQuotas);
    const now = new Date();
    let graceExpiresAt: string | null = subscription.grace_period_expires_at;

    if (overLimitInfo.isOverLimit) {
      graceExpiresAt = new Date(now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    } else {
      graceExpiresAt = null;
    }

    const updatedSub: MinistrySubscriptionRecord = {
      ...subscription,
      member_addon_blocks: blocks,
      grace_period_expires_at: graceExpiresAt,
      updated_at: now.toISOString(),
    };

    await this.subscriptionRepo.setSubscription(updatedSub);
    return updatedSub;
  }

  /**
   * Reconcilia os contadores de uso materializado com a realidade dos dados.
   */
  async reconcileUsage(ministryId: string): Promise<MinistryUsageRecord> {
    return await this.subscriptionRepo.reconcileMinistryUsage(ministryId);
  }
}
