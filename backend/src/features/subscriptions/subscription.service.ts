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
  BillingInterval,
  QuotaLimit,
} from '../../config/plans.config';
import {
  MinistrySubscriptionRecord,
  MinistryUsageRecord,
  MinistrySubscriptionStatusSummary,
  SubscriptionMode,
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
        subscription_mode: 'free',
        granted_by: null,
        granted_at: null,
        grant_reason: null,
        expires_at: null,
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

    // 3. Resolver término de período cancelado ou cortesia expirada
    const isPeriodEnded = Boolean(
      subscription.cancel_at_period_end &&
      subscription.current_period_end &&
      now > new Date(subscription.current_period_end)
    );

    const effectivePlanId = isPeriodEnded ? 'free' : subscription.plan_id;
    const plan = getPlanDefinition(effectivePlanId);
    const resolvedState = resolveAccessMode(subscription, plan, usage, now);

    const subscriptionMode: SubscriptionMode = isPeriodEnded
      ? 'free'
      : (subscription.subscription_mode || (subscription.plan_id === 'free' ? 'free' : 'paid'));

    return {
      plan,
      subscription: {
        planId: effectivePlanId,
        memberAddonBlocks: isPeriodEnded ? 0 : (subscription.member_addon_blocks || 0),
        billingStatus: isPeriodEnded ? 'canceled' : subscription.billing_status,
        billingInterval: subscription.billing_interval || (
          subscription.current_period_end && subscription.current_period_start
            ? ((new Date(subscription.current_period_end).getTime() - new Date(subscription.current_period_start).getTime()) > 60 * 24 * 60 * 60 * 1000 ? 'annual' : 'monthly')
            : 'monthly'
        ),
        subscriptionMode,
        grantedBy: subscription.granted_by || null,
        grantedAt: subscription.granted_at || null,
        grantReason: subscription.grant_reason || null,
        expiresAt: subscription.expires_at || null,
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
   * Concede manualmente um plano de cortesia (complimentary) a um ministério por autoridade da plataforma.
   * Não interage com o Asaas, não gera faturas fake e concede entitlements oficiais.
   */
  async grantComplimentaryPlan(
    ministryId: string,
    targetPlanId: PlanId,
    grantedBy: string,
    grantReason?: string,
    expiresAt?: string | null
  ): Promise<MinistrySubscriptionRecord> {
    if (!(targetPlanId in PLANS_CATALOG)) {
      throw new AppError(400, `Plano inválido para concessão: ${targetPlanId}`);
    }

    const { subscription, usage } = await this.subscriptionRepo.ensureSubscriptionAndUsage(ministryId);
    const newPlan = getPlanDefinition(targetPlanId);
    const now = new Date();

    const newEffectiveQuotas: EffectiveQuotas = {
      members: getEffectiveMemberQuota(newPlan, 0),
      songs: getEffectiveSongQuota(newPlan),
    };

    const overLimitInfo = isUsageOverLimit(usage, newEffectiveQuotas);
    let graceExpiresAt: string | null = null;
    if (overLimitInfo.isOverLimit) {
      graceExpiresAt = new Date(now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    }

    const updatedSub: MinistrySubscriptionRecord = {
      ...subscription,
      plan_id: targetPlanId,
      member_addon_blocks: 0,
      subscription_mode: 'complimentary',
      billing_status: 'active',
      granted_by: grantedBy,
      granted_at: now.toISOString(),
      grant_reason: grantReason || 'Concessão administrativa LouvAIO',
      expires_at: expiresAt || null,
      grace_period_expires_at: graceExpiresAt,
      cancel_at_period_end: false,
      updated_at: now.toISOString(),
    };

    await this.subscriptionRepo.setSubscription(updatedSub);
    return updatedSub;
  }

  /**
   * Revoga uma concessão de cortesia e retorna o ministério para o plano Free sem deletar dados.
   * Se o uso atual ultrapassar o Free, inicia período de carência (grace) de 7 dias.
   */
  async revokeComplimentaryPlan(
    ministryId: string,
    revokedBy: string
  ): Promise<MinistrySubscriptionRecord> {
    const { subscription, usage } = await this.subscriptionRepo.ensureSubscriptionAndUsage(ministryId);
    const now = new Date();

    const freePlan = PLANS_CATALOG.free;
    const freeQuotas: EffectiveQuotas = {
      members: getEffectiveMemberQuota(freePlan, 0),
      songs: getEffectiveSongQuota(freePlan),
    };

    const overLimitInfo = isUsageOverLimit(usage, freeQuotas);
    let graceExpiresAt: string | null = null;
    if (overLimitInfo.isOverLimit) {
      graceExpiresAt = new Date(now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    }

    const updatedSub: MinistrySubscriptionRecord = {
      ...subscription,
      plan_id: 'free',
      member_addon_blocks: 0,
      subscription_mode: 'free',
      billing_status: 'active',
      granted_by: null,
      granted_at: null,
      grant_reason: `Cortesia revogada por ${revokedBy}`,
      expires_at: null,
      grace_period_expires_at: graceExpiresAt,
      cancel_at_period_end: false,
      updated_at: now.toISOString(),
    };

    await this.subscriptionRepo.setSubscription(updatedSub);
    return updatedSub;
  }

  /**
   * Primitiva interna de transição de plano (para uso por testes, fixtures e webhooks de pagamento).
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
      graceExpiresAt = new Date(now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    } else {
      graceExpiresAt = null;
    }

    const updatedSub: MinistrySubscriptionRecord = {
      ...subscription,
      plan_id: targetPlanId,
      member_addon_blocks: newAddonBlocks,
      subscription_mode: targetPlanId === 'free' ? 'free' : 'paid',
      grace_period_expires_at: graceExpiresAt,
      updated_at: now.toISOString(),
    };

    await this.subscriptionRepo.setSubscription(updatedSub);
    return updatedSub;
  }

  /**
   * Aplica o snapshot de entitlement imutável comprado em uma transição de faturamento.
   * Não recalcula limites a partir do catálogo atual, blindando contra catalog drift.
   */
  async applyLockedEntitlementSnapshot(
    ministryId: string,
    snapshot: {
      plan_id: PlanId;
      addon_blocks: number;
      interval?: BillingInterval;
      effective_member_quota?: QuotaLimit;
      effective_song_quota?: QuotaLimit;
    }
  ): Promise<MinistrySubscriptionRecord> {
    const { subscription, usage } = await this.subscriptionRepo.ensureSubscriptionAndUsage(ministryId);
    const targetPlanId = snapshot.plan_id;
    const planDef = getPlanDefinition(targetPlanId);

    const lockedMemberQuota =
      snapshot.effective_member_quota !== undefined && snapshot.effective_member_quota !== null
        ? snapshot.effective_member_quota
        : getEffectiveMemberQuota(planDef, snapshot.addon_blocks);

    const lockedSongQuota =
      snapshot.effective_song_quota !== undefined && snapshot.effective_song_quota !== null
        ? snapshot.effective_song_quota
        : getEffectiveSongQuota(planDef);

    const effectiveQuotas: EffectiveQuotas = {
      members: lockedMemberQuota,
      songs: lockedSongQuota,
    };

    const overLimitInfo = isUsageOverLimit(usage, effectiveQuotas);
    const now = new Date();
    let graceExpiresAt: string | null = subscription.grace_period_expires_at;

    if (overLimitInfo.isOverLimit) {
      graceExpiresAt = new Date(now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    } else {
      graceExpiresAt = null;
    }

    const updatedSub: MinistrySubscriptionRecord = {
      ...subscription,
      plan_id: targetPlanId,
      member_addon_blocks: snapshot.addon_blocks,
      subscription_mode: targetPlanId === 'free' ? 'free' : 'paid',
      billing_interval: snapshot.interval || subscription.billing_interval,
      locked_member_quota: lockedMemberQuota,
      locked_song_quota: lockedSongQuota,
      entitlement_snapshot: snapshot,
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
