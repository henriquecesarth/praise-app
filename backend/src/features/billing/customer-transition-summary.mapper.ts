import { PlanId, BillingInterval, AccessMode } from '../../config/plans.config';
import {
  BillingTransitionV1Record,
  BillingPlanChangeRecord,
  BillingSubscriptionRecord,
  CustomerFacingTransitionKind,
  CustomerFacingTransitionStatus,
  CustomerFacingTransitionContractSnapshot,
  CustomerFacingPendingTransitionDto,
  CustomerPaymentHealthState,
  CustomerPaymentStatusDto,
  CustomerGraceReason,
  isBillingTransitionV1,
} from './billing.types';
import { SubscriptionMode } from '../subscriptions/subscription.types';

export const PLAN_TIER_ORDER: Record<PlanId, number> = {
  free: 0,
  lite: 1,
  lite_plus: 2,
  essential: 3,
  pro: 4,
  premium: 5,
};

/**
 * Classifica a natureza da transição em um formato legível para o cliente final.
 * Baseia-se exclusivamente nos snapshots imutáveis da transição (source e target).
 */
export function classifyCustomerFacingTransitionKind(
  transition: BillingTransitionV1Record
): CustomerFacingTransitionKind {
  if (
    transition.execution_strategy === 'immediate_initial_purchase' ||
    (transition.source_plan_id === 'free' && transition.target_plan_id !== 'free')
  ) {
    return 'initial_purchase';
  }

  if (
    transition.execution_strategy === 'scheduled_cancel_to_free' ||
    (transition.source_plan_id !== 'free' && transition.target_plan_id === 'free')
  ) {
    return 'cancel_to_free';
  }

  const isPlanChange = transition.source_plan_id !== transition.target_plan_id;
  const isIntervalChange = Boolean(
    transition.source_interval &&
    transition.target_interval &&
    transition.source_interval !== transition.target_interval
  );
  const sourceAddons = Number.isInteger(transition.source_addon_blocks) ? transition.source_addon_blocks : 0;
  const targetAddons = Number.isInteger(transition.target_addon_blocks) ? transition.target_addon_blocks : 0;
  const isAddonChange = sourceAddons !== targetAddons;

  const changesCount = (isPlanChange ? 1 : 0) + (isIntervalChange ? 1 : 0) + (isAddonChange ? 1 : 0);

  if (changesCount > 1) {
    return 'mixed_change';
  }

  if (isPlanChange) {
    const sourceTier = PLAN_TIER_ORDER[transition.source_plan_id] ?? 0;
    const targetTier = PLAN_TIER_ORDER[transition.target_plan_id] ?? 0;
    if (targetTier > sourceTier) {
      return 'plan_upgrade';
    } else if (targetTier < sourceTier) {
      return 'plan_downgrade';
    } else {
      return 'mixed_change';
    }
  }

  if (isIntervalChange) {
    return 'interval_change';
  }

  if (isAddonChange) {
    return targetAddons > sourceAddons ? 'addon_increase' : 'addon_decrease';
  }

  return 'mixed_change';
}

/**
 * Mapeia o status interno da transição V1 para um status customer-facing normalizado.
 * Estados terminais (completed com safe_terminal, canceled, superseded, failed)
 * retornam `null` para que não sejam expostos como transição pendente.
 */
export function mapCustomerFacingTransitionStatus(
  transition: BillingTransitionV1Record
): CustomerFacingTransitionStatus | null {
  // 1. Estados terminais não aparecem como pending
  if (transition.transition_status === 'completed') {
    return null;
  }
  if (
    transition.transition_status === 'canceled' ||
    transition.transition_status === 'superseded' ||
    transition.transition_status === 'failed'
  ) {
    return null;
  }

  // 2. Projeção de atenção financeira (customer-safe, sem expor erro do provedor)
  if (
    transition.financial_attention_required === true ||
    transition.financial_safety_status === 'attention_required' ||
    transition.transition_status === 'financial_attention_required'
  ) {
    return 'attention_required';
  }

  // 3. Estados operacionais vivos
  switch (transition.transition_status) {
    case 'pending_initial_purchase':
    case 'pending_future_authorization':
      return 'awaiting_payment';
    case 'future_target_prepared':
    case 'awaiting_old_inactivation':
      return 'processing';
    case 'scheduled':
      return 'scheduled';
    default:
      return null;
  }
}

/**
 * Mapeia uma transição de faturamento (BillingPlanChangeRecord) para o DTO customer-facing.
 * Aplica isolamento de tenant estrito, validação de integridade e sanitização de dados.
 */
export function mapToCustomerFacingTransition(
  transition: BillingPlanChangeRecord | null | undefined,
  expectedMinistryId: string
): CustomerFacingPendingTransitionDto | null {
  if (!transition || typeof transition !== 'object') {
    return null;
  }

  // Tenant isolation
  if (transition.ministry_id !== expectedMinistryId) {
    return null;
  }

  // Somente V1 é suportado no resumo customer-facing
  if (!isBillingTransitionV1(transition)) {
    return null;
  }

  const v1 = transition as BillingTransitionV1Record;

  // Validação básica de campos obrigatórios
  if (!v1.id || !v1.source_plan_id || !v1.target_plan_id || !v1.transition_status) {
    return null;
  }

  const customerStatus = mapCustomerFacingTransitionStatus(v1);
  if (!customerStatus) {
    return null;
  }

  const kind = classifyCustomerFacingTransitionKind(v1);

  const source: CustomerFacingTransitionContractSnapshot = {
    planId: v1.source_plan_id,
    interval: v1.source_interval || 'monthly',
    addonBlocks: Number.isInteger(v1.source_addon_blocks) ? v1.source_addon_blocks : 0,
  };

  const target: CustomerFacingTransitionContractSnapshot = {
    planId: v1.target_plan_id,
    interval: v1.target_interval || 'monthly',
    addonBlocks: Number.isInteger(v1.target_addon_blocks) ? v1.target_addon_blocks : 0,
  };

  const requestedAt = v1.requested_at || v1.created_at || new Date().toISOString();
  const effectiveAt = v1.effective_at || v1.current_period_end || null;

  return {
    transitionId: v1.transition_id || v1.id,
    kind,
    status: customerStatus,
    requestedAt,
    effectiveAt,
    source,
    target,
  };
}

/**
 * Resolve o estado de saúde do pagamento (delinquência) com base na autoridade canônica (BillingSubscriptionRecord).
 * Planos cortesia (complimentary) e gratuitos (free) nunca fabricam delinquência.
 */
export function resolveCustomerPaymentStatus(
  billingSub: BillingSubscriptionRecord | null,
  subscriptionMode: SubscriptionMode,
  gracePeriodExpiresAt: string | null
): CustomerPaymentStatusDto {
  if (subscriptionMode === 'complimentary' || subscriptionMode === 'free') {
    return {
      state: 'current',
      graceEndsAt: null,
    };
  }

  const isPastDue = billingSub?.status === 'past_due';
  return {
    state: isPastDue ? 'past_due' : 'current',
    graceEndsAt: isPastDue ? (gracePeriodExpiresAt || null) : null,
  };
}

/**
 * Distingue a razão do período de carência (grace period) entre falha de pagamento e excesso de quotas.
 * Retorna 'none' caso a assinatura não esteja em modo 'grace'.
 */
export function resolveCustomerGraceReason(
  accessMode: AccessMode,
  paymentHealthState: CustomerPaymentHealthState,
  isOverLimit: boolean
): CustomerGraceReason {
  if (accessMode !== 'grace') {
    return 'none';
  }

  if (paymentHealthState === 'past_due') {
    return 'payment_failure';
  }

  if (isOverLimit) {
    return 'usage_over_limit';
  }

  return 'usage_over_limit';
}
