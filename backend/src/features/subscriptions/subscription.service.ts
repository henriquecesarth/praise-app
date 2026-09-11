import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { BillingRepository } from '../../repositories/BillingRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import {
  PLANS_CATALOG,
  DEFAULT_PLAN_ID,
  DEFAULT_GRACE_PERIOD_DAYS,
  getPlanDefinition,
  getIncludedWhatsAppConnections,
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
import { OrganizationWhatsAppCapacity, BillingAccessMode } from '../organizations/organization.types';
import {
  CustomerFacingPendingTransitionDto,
  BillingSubscriptionRecord,
} from '../billing/billing.types';
import {
  mapToCustomerFacingTransition,
  resolveCustomerPaymentStatus,
  resolveCustomerGraceReason,
} from '../billing/customer-transition-summary.mapper';
import { AppError } from '../../middleware/error-handler';
import { getBillingDate, normalizeToBillingDate } from '../../utils/billing-date';
import { config } from '../../config/unifiedConfig';

/**
 * Correlaciona deterministicamente a fatura exata da obrigação de renovação corrente inadimplente (Phase 4A.6B).
 * Retorna null em caso de ambiguidade, ausência de evidência ou obrigações não correlatas (fail-closed).
 */
export function resolveCurrentRenewalRecoveryInvoice(
  transactions: any[],
  context: {
    ministryId: string;
    billingSub: BillingSubscriptionRecord | null;
    subscription: MinistrySubscriptionRecord;
    activeTransitionResult?: any;
    timeZone?: string;
  }
): string | null {
  const { ministryId, billingSub, subscription, timeZone = config.billingTimezone || 'America/Sao_Paulo' } = context;

  // 1. Assinatura de faturamento corrente é obrigatória com identificador canônico no provedor
  if (!billingSub || !billingSub.provider_subscription_id || typeof billingSub.provider_subscription_id !== 'string') {
    return null;
  }
  const targetProviderSubId = billingSub.provider_subscription_id.trim();
  if (!targetProviderSubId) {
    return null;
  }

  // 2. Determinar a data exata da fronteira de renovação corrente (current renewal boundary)
  // Fontes autorizadas: billingSub.current_period_end_billing_date, billingSub.effective_billing_date,
  // billingSub.current_period_end, subscription.current_period_end.
  // PROIBIDO: grace_period_expires_billing_date, grace_period_expires_at, current_period_start,
  // current_period_start_billing_date, created_at, requested_at, etc.
  const boundaryDates = new Set<string>();

  const addBoundaryDate = (raw: string | null | undefined) => {
    const norm = normalizeToBillingDate(raw, timeZone);
    if (norm) {
      boundaryDates.add(norm);
    }
  };

  addBoundaryDate(billingSub.current_period_end_billing_date);
  addBoundaryDate(billingSub.effective_billing_date);
  addBoundaryDate(billingSub.current_period_end);
  addBoundaryDate(subscription.current_period_end);

  // Se nenhuma fronteira pode ser identificada ou se há divergência material entre fontes canônicas -> Fail closed
  if (boundaryDates.size !== 1) {
    return null;
  }
  const expectedRenewalBillingDate = Array.from(boundaryDates)[0];

  // 3. Filtrar candidatos positivamente comprovados como a obrigação de renovação corrente
  const eligibleCandidates = (transactions || []).filter((tx: any) => {
    // 3.1 Tenant e provedor
    if (tx.ministry_id && tx.ministry_id !== ministryId) return false;
    if (billingSub.provider && tx.provider && tx.provider !== billingSub.provider) return false;

    // 3.2 Assinatura corrente do provedor (identidade exata obrigatória)
    if (!tx.provider_subscription_id || tx.provider_subscription_id !== targetProviderSubId) {
      return false;
    }

    // 3.3 Propósito financeiro POSITIVO: deve ser obrigatoriamente 'recurring_payment'
    if (tx.transaction_type !== 'recurring_payment') {
      return false;
    }

    // 3.4 Defesa em profundidade contra ajustes e pontuais
    if (
      tx.quote_id ||
      tx.attempt_id
    ) {
      return false;
    }

    // 3.5 Status financeiramente recuperável
    if (tx.status !== 'overdue' && tx.status !== 'pending') {
      return false;
    }

    // 3.6 Deve possuir URL de fatura não-vazia
    if (!tx.invoice_url || typeof tx.invoice_url !== 'string' || !tx.invoice_url.trim()) {
      return false;
    }

    // 3.7 Data de vencimento (due_date) obrigatória e correspondência exata com o renewal boundary
    if (!tx.due_date) {
      return false;
    }
    const txDueDate = normalizeToBillingDate(tx.due_date, timeZone);
    if (!txDueDate || txDueDate !== expectedRenewalBillingDate) {
      return false;
    }

    return true;
  });

  // 4. Exatamente um candidato deve satisfazer todos os predicados
  if (eligibleCandidates.length === 1) {
    return eligibleCandidates[0].invoice_url;
  }

  // 0 candidatos ou múltiplos candidatos para o mesmo ciclo -> Fail closed
  return null;
}

export class SubscriptionService {
  constructor(
    private readonly subscriptionRepo: SubscriptionRepository = new SubscriptionRepository(),
    private readonly billingRepo: BillingRepository = new BillingRepository(),
    private readonly orgRepo: OrganizationRepository = new OrganizationRepository()
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
    // CRÍTICO (Phase 3D.3 Hardening): Se a assinatura possui cancelamento V1 ativo (active_cancellation_transition_id),
    // a flag cancel_at_period_end é meramente informativa para a UI.
    // O entitlement NÃO pode convergir para Free pelo relógio local antes da prova estrita dos safety gates pelo reconciliador.
    // Apenas cancelamentos legados (sem active_cancellation_transition_id) mantêm auto-cutover local pelo relógio.
    const isLegacyPeriodEnded = Boolean(
      subscription.cancel_at_period_end &&
      !subscription.active_cancellation_transition_id &&
      subscription.current_period_end &&
      now > new Date(subscription.current_period_end)
    );

    const effectivePlanId = isLegacyPeriodEnded ? 'free' : subscription.plan_id;
    const plan = getPlanDefinition(effectivePlanId);
    const resolvedState = resolveAccessMode(subscription, plan, usage, now);

    const subscriptionMode: SubscriptionMode = isLegacyPeriodEnded
      ? 'free'
      : (subscription.subscription_mode || (subscription.plan_id === 'free' ? 'free' : 'paid'));

    // 4. Resolver transição pendente ativa e estado de saúde de pagamento (Phase 4A.1 & Phase 4A.6)
    let pendingTransition: CustomerFacingPendingTransitionDto | null = null;
    let billingSub: BillingSubscriptionRecord | null = null;
    let activeTransitionResult: any = null;

    try {
      if (this.billingRepo && typeof this.billingRepo.getActiveTransitionForMinistry === 'function') {
        activeTransitionResult = await this.billingRepo.getActiveTransitionForMinistry(ministryId, 'asaas');
        if (activeTransitionResult?.transition) {
          pendingTransition = mapToCustomerFacingTransition(activeTransitionResult.transition, ministryId);
        }
      }
    } catch (_err) {
      // Fail-closed: se a leitura do slot ou validação falhar, não expõe transição pendente inválida
      pendingTransition = null;
      activeTransitionResult = null;
    }

    try {
      if (this.billingRepo && typeof this.billingRepo.getSubscription === 'function') {
        billingSub = await this.billingRepo.getSubscription(ministryId, 'asaas');
      }
    } catch (_err) {
      billingSub = null;
    }

    // Phase 4A.6: Obter URL de recuperação de cobrança em aberto (se inadimplente)
    let recoveryInvoiceUrl: string | null = null;
    const isPastDue = subscription.billing_status === 'past_due' || billingSub?.status === 'past_due';
    const hasFinancialAttention = Boolean(
      activeTransitionResult?.transition?.financial_attention_required ||
      activeTransitionResult?.transition?.financial_safety_status === 'attention_required'
    );

    if (isPastDue && !hasFinancialAttention) {
      try {
        if (this.billingRepo && typeof this.billingRepo.getTransactions === 'function') {
          const txs = await this.billingRepo.getTransactions(ministryId, 20);
          recoveryInvoiceUrl = resolveCurrentRenewalRecoveryInvoice(txs, {
            ministryId,
            billingSub,
            subscription,
            activeTransitionResult,
            timeZone: config.billingTimezone,
          });
        }
      } catch (_err) {
        recoveryInvoiceUrl = null;
      }
    }

    const paymentStatus = resolveCustomerPaymentStatus(
      billingSub,
      subscriptionMode,
      subscription.grace_period_expires_at || null,
      {
        appBillingStatus: subscription.billing_status,
        recoveryInvoiceUrl,
        financialAttentionRequired: hasFinancialAttention,
      }
    );

    const graceReason = resolveCustomerGraceReason(
      resolvedState.accessMode,
      paymentStatus.state,
      resolvedState.isOverLimit
    );

    return {
      plan,
      subscription: {
        planId: effectivePlanId,
        memberAddonBlocks: isLegacyPeriodEnded ? 0 : (subscription.member_addon_blocks || 0),
        billingStatus: isLegacyPeriodEnded ? 'canceled' : subscription.billing_status,
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
        activeCancellationTransitionId: subscription.active_cancellation_transition_id || null,
      },
      quotas: resolvedState.effectiveQuotas,
      usage: {
        membersCount: usage.members_count,
        songsCount: usage.songs_count,
      },
      isOverLimit: resolvedState.isOverLimit,
      overLimitDetails: resolvedState.overLimitDetails,
      graceDaysRemaining: resolvedState.graceDaysRemaining,
      pendingTransition,
      paymentStatus,
      graceReason,
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
      grace_period_expires_billing_date: null,
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

  /**
   * Avalia a capacidade comercial de conexões WhatsApp para a organização (Phase 7B).
   * Deriva a capacidade da assinatura ativa do ministério âncora de faturamento.
   * Não consulta ou gerencia conexões reais (responsabilidade da Phase 7C).
   */
  async getOrganizationWhatsAppCapacity(organizationId: string): Promise<OrganizationWhatsAppCapacity> {
    const org = await this.orgRepo.getOrganizationById(organizationId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    const summary = await this.getSubscriptionSummary(org.billing_anchor_ministry_id);
    const includedConnections = getIncludedWhatsAppConnections(summary.plan.id);
    const additionalConnections = 0; // Estritamente 0 no runtime da Phase 7B (extensão para Phase 7H)
    const totalAllowedConnections = includedConnections + additionalConnections;

    let billingAccessMode: BillingAccessMode;
    switch (summary.subscription.accessMode) {
      case 'suspended':
      case 'restricted_over_limit':
        billingAccessMode = 'suspended';
        break;
      case 'grace':
        billingAccessMode = 'grace';
        break;
      case 'normal':
        billingAccessMode = 'normal';
        break;
      default:
        billingAccessMode = 'suspended';
        break;
    }

    const enabled = totalAllowedConnections > 0 && billingAccessMode !== 'suspended';

    return {
      organizationId: org.id,
      billingAnchorMinistryId: org.billing_anchor_ministry_id,
      enabled,
      includedConnections,
      additionalConnections,
      totalAllowedConnections,
      billingAccessMode,
    };
  }
}
