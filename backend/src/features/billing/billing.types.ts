import { PlanId, QuotaLimit, BillingInterval } from '../../config/plans.config';

export type BillingProviderName = 'asaas' | 'mock';

export interface BillingCustomerRecord {
  id: string; // e.g. `${ministry_id}_${provider}`
  ministry_id: string;
  provider: BillingProviderName;
  provider_customer_id: string;
  status?: 'ready' | 'creating';
  lease_locked_until?: string | null;
  lease_locked_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type BillingSubscriptionStatus = 'active' | 'pending' | 'past_due' | 'canceled';

export interface BillingSubscriptionRecord {
  id: string; // e.g. `${ministry_id}_${provider}`
  ministry_id: string;
  provider: BillingProviderName;
  checkout_intent_id?: string;
  provider_checkout_id?: string | null;
  provider_subscription_id?: string | null;
  provider_customer_id?: string | null;
  plan_id: PlanId;
  interval: BillingInterval;
  member_addon_blocks: number;
  amount_cents: number;
  status: BillingSubscriptionStatus;
  started_at: string;
  current_period_start: string;
  current_period_end: string | null;
  current_period_start_billing_date?: string;
  current_period_end_billing_date?: string | null;
  effective_billing_date?: string | null;
  cancel_at_period_end: boolean;
  checkout_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type BillingTransitionPolicyVersion = 'billing_transition_v1' | 'legacy';

export type BillingTransitionExecutionStrategy =
  | 'immediate_initial_purchase'
  | 'scheduled_paid_transition'
  | 'scheduled_cancel_to_free';

export type BillingTransitionType = 'upgrade' | 'downgrade' | 'interval_change' | 'addon_change' | 'hybrid';

export type BillingTransitionStatus =
  | 'pending_initial_purchase'
  | 'pending_future_authorization'
  | 'future_target_prepared'
  | 'awaiting_old_inactivation'
  | 'scheduled'
  | 'completed'
  | 'canceled'
  | 'superseded'
  | 'failed'
  | 'financial_attention_required';

export const STRATEGY_ALLOWED_TRANSITION_STATUSES: Record<
  BillingTransitionExecutionStrategy,
  ReadonlySet<BillingTransitionStatus>
> = {
  immediate_initial_purchase: new Set<BillingTransitionStatus>([
    'pending_initial_purchase',
    'completed',
    'canceled',
    'superseded',
    'failed',
    'financial_attention_required',
  ]),
  scheduled_paid_transition: new Set<BillingTransitionStatus>([
    'pending_future_authorization',
    'future_target_prepared',
    'awaiting_old_inactivation',
    'scheduled',
    'completed',
    'canceled',
    'superseded',
    'failed',
    'financial_attention_required',
  ]),
  scheduled_cancel_to_free: new Set<BillingTransitionStatus>([
    'awaiting_old_inactivation',
    'scheduled',
    'completed',
    'canceled',
    'superseded',
    'failed',
    'financial_attention_required',
  ]),
};

export type BillingEarlyActivationStatus =
  | 'not_applicable'
  | 'available'
  | 'pending_checkout'
  | 'payment_pending'
  | 'confirmed'
  | 'activated'
  | 'declined'
  | 'expired';

export type BillingFinancialSafetyStatus =
  | 'live'
  | 'safe_terminal'
  | 'attention_required';

export interface BillingActiveTransitionSlotRecord {
  id: string; // deterministic: `${ministry_id}_${provider}`
  ministry_id: string;
  provider: BillingProviderName;
  plan_change_id: string; // ID da transição de plano atualmente ativa
  acquired_at: string;
  updated_at: string;
  version: number;
}

export type BillingPlanChangeStatus =
  | 'pending'
  | 'payment_confirmed'
  | 'superseding'
  | 'completed'
  | 'failed'
  | 'financial_attention_required'
  | 'expired'
  | 'canceled';

export interface EffectiveEntitlementSnapshot {
  plan_id: PlanId;
  addon_blocks: number;
}

/**
 * Registro de Transição de Plano Legado (pre-V1)
 */
export interface LegacyBillingPlanChangeRecord {
  id: string; // checkout_intent_id
  ministry_id: string;
  provider: BillingProviderName;
  checkout_intent_id: string;
  provider_checkout_id?: string | null;
  requested_plan_id: PlanId;
  requested_interval: BillingInterval;
  requested_addon_blocks: number;
  expected_amount_cents: number;
  currency: 'BRL';
  checkout_url?: string | null;
  previous_provider_subscription_id?: string | null;
  previous_plan_id?: PlanId | null;
  previous_interval?: BillingInterval | null;
  new_provider_subscription_id?: string | null;
  provider_customer_id?: string | null;
  status: BillingPlanChangeStatus;
  policy_version?: undefined | 'legacy';

  supersede_status?: 'pending' | 'completed' | 'failed' | 'financial_attention_required' | 'not_applicable';
  supersede_error?: string | null;
  payment_cleanup_status?: 'pending' | 'completed' | 'failed' | 'financial_attention_required' | 'not_applicable';
  payment_cleanup_ids?: string[] | null;
  payment_cleanup_error?: string | null;
  financial_attention_required?: boolean;
  financial_attention_reason?: string | null;
  renewal_cutoff_date?: string | null;
  retry_count?: number;
  last_retry_at?: string | null;
  next_retry_at?: string | null;
  retry_locked_until?: string | null;
  retry_locked_by?: string | null;
  created_at: string;
  expires_at: string | null;
  confirmed_at?: string | null;
  completed_at?: string | null;
  failure_reason?: string | null;
  updated_at: string;
}

export interface EntitlementSnapshot {
  plan_id: PlanId;
  addon_blocks: number;
  interval?: BillingInterval;
  effective_member_quota?: QuotaLimit;
  effective_song_quota?: QuotaLimit;
}

export type BillingEarlyActivationQuoteStatus = 'active' | 'expired' | 'consumed' | 'superseded';

export interface BillingEarlyActivationQuote {
  quote_id: string;
  transition_id: string;
  ministry_id: string;
  source_current_cycle_total_cents: number;
  target_current_cycle_total_cents: number;
  price_delta_cents?: number;
  total_days?: number;
  remaining_days?: number;
  prorated_adjustment_cents: number;
  currency: 'BRL';
  priced_at: string;
  quote_effective_billing_date: string;
  expires_at: string;
  status: BillingEarlyActivationQuoteStatus;
  calculation_version?: 'proration_v1';
}

export type BillingCheckoutAttemptType = 'initial_purchase' | 'future_authorization' | 'early_activation';
export type BillingCheckoutAttemptStatus =
  | 'pending'
  | 'completed'
  | 'expired'
  | 'canceled'
  | 'failed'
  | 'uncertain'
  | 'uncertain_expired';

export type BillingCheckoutAttemptFailureClassification =
  | 'creation_failed_before_provider_obligation'
  | 'payment_declined_in_session'
  | 'session_expired'
  | 'session_canceled'
  | 'unknown';

export type BillingCheckoutAttemptProviderCreateState =
  | 'reserved'
  | 'attempting'
  | 'created'
  | 'uncertain'
  | 'rejected_no_obligation';

export interface BillingCheckoutAttempt {
  attempt_id: string;
  transition_id: string;
  attempt_type: BillingCheckoutAttemptType;
  internal_checkout_intent_id: string;
  provider_checkout_id?: string | null;
  checkout_url?: string | null;
  quote_id?: string | null;
  amount_cents: number;
  currency: 'BRL';
  status: BillingCheckoutAttemptStatus;
  provider_create_state?: BillingCheckoutAttemptProviderCreateState | null;
  failure_classification?: BillingCheckoutAttemptFailureClassification | null;
  provider_session_terminal?: boolean | null;
  payment_id?: string | null;
  provider_payment_id?: string | null;
  paid_at?: string | null;
  created_at: string;
  checkout_requested_at?: string | null;
  checkout_minutes_to_expire?: number | null;
  uncertain_until?: string | null;
  expires_at?: string | null;
  completed_at?: string | null;
}

/**
 * Registro de Transição de Plano V1 (Billing Transition Policy V1)
 * Tipagem estrita: contratos, price locks e snapshots são estritamente auditáveis.
 */
export interface BillingTransitionV1Record {
  // Dominant Identity & Policy
  id: string; // transition_id
  transition_id: string;
  policy_version: 'billing_transition_v1';
  ministry_id: string;
  provider: BillingProviderName;
  currency: 'BRL';

  // Strategy & Status Dimensions (transition_status é a autoridade única da state machine)
  execution_strategy: BillingTransitionExecutionStrategy;
  transition_status: BillingTransitionStatus;
  early_activation_status: BillingEarlyActivationStatus;
  financial_safety_status: BillingFinancialSafetyStatus;
  transition_type: BillingTransitionType;

  // Legacy Denormalized Fields for Compatibility
  status: BillingPlanChangeStatus;
  checkout_intent_id?: string;
  provider_checkout_id?: string | null;
  new_provider_subscription_id?: string | null;
  provider_customer_id?: string | null;
  requested_plan_id: PlanId;
  requested_interval: BillingInterval;
  requested_addon_blocks: number;
  expected_amount_cents: number;

  // Source Contract Snapshot (Immutable Audit Basis)
  source_plan_id: PlanId;
  source_interval: BillingInterval;
  source_addon_blocks: number;
  source_current_cycle_total_cents: number;
  source_entitlement_snapshot: EntitlementSnapshot;
  current_period_start: string | null;
  current_period_end: string | null;

  // Target Contract Snapshot (Immutable Recurrence Price Lock)
  target_plan_id: PlanId;
  target_interval: BillingInterval;
  target_addon_blocks: number;
  target_future_recurring_price_cents: number;
  target_entitlement_snapshot?: EntitlementSnapshot | null;
  early_activation_target_entitlement_snapshot?: EntitlementSnapshot | null;

  // Early Activation Dynamic Quotes & Audit History
  current_early_activation_quote?: BillingEarlyActivationQuote | null;
  early_activation_quotes_history?: BillingEarlyActivationQuote[];
  target_current_cycle_total_cents?: number | null;
  prorated_adjustment_cents?: number | null;
  early_activation_confirmed_at?: string | null;

  // Checkout Attempts History & Current Pointers
  checkout_attempts?: BillingCheckoutAttempt[];
  current_future_checkout_attempt_id?: string | null;
  current_early_activation_checkout_attempt_id?: string | null;
  current_initial_purchase_checkout_attempt_id?: string | null;

  // Dates & Price Lock
  effective_at?: string | null;
  effective_billing_date?: string | null; // YYYY-MM-DD em America/Sao_Paulo (preenchido após confirmação para initial purchase)
  current_period_start_billing_date?: string | null; // YYYY-MM-DD em America/Sao_Paulo
  current_period_end_billing_date?: string | null; // YYYY-MM-DD em America/Sao_Paulo
  requested_commercial_date: string; // YYYY-MM-DD em America/Sao_Paulo travado em requested_at
  price_locked_at: string;
  requested_at: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  checkout_requested_at?: string | null;
  checkout_minutes_to_expire?: number | null;
  uncertain_until?: string | null;

  // Active / Confirmed Provider Correlation References
  initial_checkout_intent_id?: string | null;
  initial_provider_checkout_id?: string | null;
  initial_provider_subscription_id?: string | null;
  initial_provider_payment_id?: string | null;
  future_checkout_intent_id?: string | null;
  future_provider_checkout_id?: string | null;
  future_provider_subscription_id?: string | null;
  future_provider_payment_id?: string | null;
  old_provider_subscription_id?: string | null;
  previous_provider_subscription_id?: string | null;
  early_activation_checkout_intent_id?: string | null;
  early_activation_provider_checkout_id?: string | null;
  early_activation_provider_payment_id?: string | null;
  requested_by_user_id?: string | null;
  failure_reason?: string | null;
  completed_at?: string | null;
  confirmed_at?: string | null;
  checkout_url?: string | null;

  // Operational & Reconciler Fields
  supersede_status?: 'pending' | 'completed' | 'failed' | 'financial_attention_required' | 'not_applicable';
  supersede_error?: string | null;
  payment_cleanup_status?: 'pending' | 'completed' | 'failed' | 'financial_attention_required' | 'not_applicable';
  payment_cleanup_ids?: string[] | null;
  payment_cleanup_error?: string | null;
  financial_attention_required?: boolean;
  financial_attention_reason?: string | null;
  target_ready_verified_at?: string | null;
  renewal_cutoff_date?: string | null;
  renewal_payment_settled_at?: string | null;
  renewal_paid_billing_date?: string | null;
  successful_renewal_provider_payment_id?: string | null;
  successful_early_adjustment_provider_payment_id?: string | null;
  early_activation_payment_settled_at?: string | null;
  early_adjustment_paid_billing_date?: string | null;
  early_activation_activated_at?: string | null;
  target_promoted_at?: string | null;
  retry_count?: number;
  last_retry_at?: string | null;
  next_retry_at?: string | null;
  retry_locked_until?: string | null;
  retry_locked_by?: string | null;
  reconcile_locked_until?: string | null;
  reconcile_locked_by?: string | null;

  // Phase 3B.3B Grace & Delinquency Recovery Fields (Write-Once)
  grace_status?: BillingGraceStatus;
  grace_started_at?: string | null;
  grace_start_billing_date?: string | null;
  grace_end_billing_date?: string | null;
  grace_entitlement_snapshot?: EntitlementSnapshot | null;
  grace_expired_at?: string | null;
  grace_expired_billing_date?: string | null;
}

export type BillingGraceStatus = 'not_entered' | 'in_grace' | 'expired' | 'resolved';

export type BillingPlanChangeRecord = LegacyBillingPlanChangeRecord | BillingTransitionV1Record;

export function isBillingTransitionV1(
  record: BillingPlanChangeRecord | any
): record is BillingTransitionV1Record {
  return Boolean(record && record.policy_version === 'billing_transition_v1');
}

export function isLegacyPlanChange(
  record: BillingPlanChangeRecord | any
): record is LegacyBillingPlanChangeRecord {
  return !record || !record.policy_version || record.policy_version === 'legacy';
}

export function mapTransitionStatusToLegacyStatus(
  transitionStatus: BillingTransitionStatus
): BillingPlanChangeStatus {
  switch (transitionStatus) {
    case 'pending_initial_purchase':
    case 'pending_future_authorization':
    case 'future_target_prepared':
      return 'pending';
    case 'awaiting_old_inactivation':
      return 'superseding';
    case 'scheduled':
      return 'payment_confirmed';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
    case 'superseded':
      return 'superseding';
    case 'failed':
      return 'failed';
    case 'financial_attention_required':
      return 'financial_attention_required';
    default:
      return 'pending';
  }
}

/**
 * Constrói o ID determinístico do slot ativo de transição de forma unívoca e livre de colisões.
 * Rejeita explicitamente ministry_id com whitespace nas extremidades para garantir bijeção formal.
 */
export function buildActiveTransitionSlotId(ministryId: string, provider: BillingProviderName): string {
  if (!ministryId || typeof ministryId !== 'string' || ministryId !== ministryId.trim()) {
    throw new Error('ministry_id é obrigatório e não pode conter espaços em branco nas extremidades.');
  }
  if (provider !== 'asaas' && provider !== 'mock') {
    throw new Error(`Provedor inválido para slot de transição: ${provider}`);
  }
  const safeMinistry = encodeURIComponent(ministryId);
  return `slot_${safeMinistry}__${provider}`;
}

/**
 * Constrói a chave canônica e determinística de documento para BillingSubscription no Firestore.
 * Formato oficial canônico: `${ministryId}_${provider}`
 */
export function buildBillingSubscriptionId(ministryId: string, provider: BillingProviderName): string {
  if (!ministryId || typeof ministryId !== 'string' || ministryId !== ministryId.trim()) {
    throw new Error('ministry_id é obrigatório e não pode conter espaços em branco nas extremidades.');
  }
  if (provider !== 'asaas' && provider !== 'mock') {
    throw new Error(`Provedor inválido para BillingSubscription: ${provider}`);
  }
  return `${ministryId}_${provider}`;
}

/**
 * Validador em runtime para registros de transição V1
 * Se um registro V1 estiver corrompido, incompleto ou com drift entre autoridades e aliases,
 * falha estritamente (Fail-Closed).
 */
export function validateBillingTransitionV1(data: any): BillingTransitionV1Record {
  if (!data || typeof data !== 'object') {
    throw new Error('Objeto de transição V1 inválido.');
  }

  if (data.policy_version !== 'billing_transition_v1') {
    throw new Error(`Versão de política inválida: '${data.policy_version}'. Esperado 'billing_transition_v1'.`);
  }

  // 1. Validação de execution_strategy
  const validStrategies: BillingTransitionExecutionStrategy[] = [
    'immediate_initial_purchase',
    'scheduled_paid_transition',
    'scheduled_cancel_to_free',
  ];
  if (!data.execution_strategy || !validStrategies.includes(data.execution_strategy)) {
    throw new Error(`execution_strategy inválida ou ausente: '${data.execution_strategy}'.`);
  }

  // 2. Validação da State Machine (Status × Strategy Matrix)
  const allowedStatuses = STRATEGY_ALLOWED_TRANSITION_STATUSES[data.execution_strategy as BillingTransitionExecutionStrategy];
  if (!allowedStatuses || !allowedStatuses.has(data.transition_status)) {
    throw new Error(
      `Status '${data.transition_status}' não é permitido para a estratégia '${data.execution_strategy}'.`
    );
  }

  // 3. Campos universais obrigatórios
  const universalRequiredFields: (keyof BillingTransitionV1Record)[] = [
    'id',
    'transition_id',
    'ministry_id',
    'provider',
    'currency',
    'transition_type',
    'transition_status',
    'execution_strategy',
    'early_activation_status',
    'financial_safety_status',
    'source_plan_id',
    'source_interval',
    'source_addon_blocks',
    'source_current_cycle_total_cents',
    'source_entitlement_snapshot',
    'target_plan_id',
    'target_interval',
    'target_addon_blocks',
    'target_future_recurring_price_cents',
    'requested_plan_id',
    'requested_interval',
    'requested_addon_blocks',
    'expected_amount_cents',
    'status',
    'requested_commercial_date',
    'price_locked_at',
    'requested_at',
    'created_at',
    'updated_at',
  ];

  for (const field of universalRequiredFields) {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(`Registro V1 corrompido ou incompleto: campo obrigatório '${String(field)}' ausente.`);
    }
  }

  // 4. Invariantes discriminadas por Strategy
  if (data.execution_strategy === 'immediate_initial_purchase') {
    if (data.source_plan_id !== 'free') {
      throw new Error("Estratégia 'immediate_initial_purchase' exige source_plan_id === 'free'.");
    }
    if (data.target_plan_id === 'free') {
      throw new Error("Estratégia 'immediate_initial_purchase' exige target_plan_id !== 'free'.");
    }
    if (data.early_activation_status !== 'not_applicable') {
      throw new Error("Estratégia 'immediate_initial_purchase' exige early_activation_status === 'not_applicable'.");
    }
    if (data.current_early_activation_quote) {
      throw new Error("Estratégia 'immediate_initial_purchase' não permite early activation quote.");
    }
  } else if (data.execution_strategy === 'scheduled_paid_transition') {
    if (data.source_plan_id === 'free') {
      throw new Error("Estratégia 'scheduled_paid_transition' não permite source_plan_id === 'free'.");
    }
    if (data.target_plan_id === 'free') {
      throw new Error("Estratégia 'scheduled_paid_transition' não permite target_plan_id === 'free'. Use 'scheduled_cancel_to_free'.");
    }
    if (!data.current_period_start || !data.current_period_end) {
      throw new Error("Estratégia 'scheduled_paid_transition' exige current_period_start e current_period_end não nulos.");
    }
    if (!data.effective_billing_date) {
      throw new Error("Estratégia 'scheduled_paid_transition' exige effective_billing_date.");
    }
  } else if (data.execution_strategy === 'scheduled_cancel_to_free') {
    if (data.source_plan_id === 'free') {
      throw new Error("Estratégia 'scheduled_cancel_to_free' não permite source_plan_id === 'free'.");
    }
    if (data.target_plan_id !== 'free') {
      throw new Error("Estratégia 'scheduled_cancel_to_free' exige target_plan_id === 'free'.");
    }
    if (data.early_activation_status !== 'not_applicable') {
      throw new Error("Estratégia 'scheduled_cancel_to_free' exige early_activation_status === 'not_applicable'.");
    }
    if (data.current_early_activation_quote) {
      throw new Error("Estratégia 'scheduled_cancel_to_free' não permite early activation quote.");
    }
    if (!data.current_period_start || !data.current_period_end) {
      throw new Error("Estratégia 'scheduled_cancel_to_free' exige current_period_start e current_period_end não nulos.");
    }
    if (!data.effective_billing_date) {
      throw new Error("Estratégia 'scheduled_cancel_to_free' exige effective_billing_date.");
    }
  }

  // 1. Validação de snapshots de entitlement
  if (
    typeof data.source_entitlement_snapshot !== 'object' ||
    !data.source_entitlement_snapshot.plan_id ||
    typeof data.source_entitlement_snapshot.addon_blocks !== 'number'
  ) {
    throw new Error('Registro V1 corrompido: source_entitlement_snapshot inválido.');
  }

  if (
    data.early_activation_target_entitlement_snapshot !== undefined &&
    data.early_activation_target_entitlement_snapshot !== null
  ) {
    if (
      typeof data.early_activation_target_entitlement_snapshot !== 'object' ||
      !data.early_activation_target_entitlement_snapshot.plan_id ||
      typeof data.early_activation_target_entitlement_snapshot.addon_blocks !== 'number'
    ) {
      throw new Error('Registro V1 corrompido: early_activation_target_entitlement_snapshot inválido.');
    }
  }

  // 2. Validação da autoridade de Target vs Aliases Legados
  if (
    data.requested_plan_id !== data.target_plan_id ||
    data.requested_interval !== data.target_interval ||
    data.requested_addon_blocks !== data.target_addon_blocks ||
    data.expected_amount_cents !== data.target_future_recurring_price_cents
  ) {
    throw new Error('Drift detectado em target aliases: requested_* e target_* divergem.');
  }

  // 3. Validação da autoridade de Status
  const expectedLegacyStatus = mapTransitionStatusToLegacyStatus(data.transition_status);
  if (data.status !== expectedLegacyStatus) {
    throw new Error(`Drift detectado em status: status legado '${data.status}' não corresponde a transition_status '${data.transition_status}'.`);
  }

  return data as BillingTransitionV1Record;
}

export type BillingTransactionStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'canceled' | 'failed';

export type BillingTransactionType = 'recurring_payment' | 'prorated_early_activation_adjustment';

export interface BillingTransactionRecord {
  id: string; // e.g. `${provider}_${provider_payment_id}`
  ministry_id: string;
  provider: BillingProviderName;
  provider_payment_id: string;
  provider_subscription_id?: string | null;
  amount_cents: number;
  currency: 'BRL';
  status: BillingTransactionStatus;
  due_date: string;
  paid_at: string | null;
  paid_billing_date?: string | null;
  payment_method?: string | null;
  invoice_url?: string | null;
  transaction_type?: BillingTransactionType;
  quote_id?: string | null;
  attempt_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type WebhookProcessingStatus = 'processing' | 'processed' | 'failed' | 'ignored';

export interface BillingWebhookEventRecord {
  id: string; // e.g. `${provider}_${provider_event_id}`
  provider: BillingProviderName;
  provider_event_id: string;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  processing_status: WebhookProcessingStatus;
  attempts: number;
  payload_hash: string;
  error_message?: string | null;
}

export interface CheckoutPreviewResult {
  planId: PlanId;
  planName: string;
  interval: BillingInterval;
  addonBlocks: number;
  effectiveMembersQuota: QuotaLimit;
  effectiveSongsQuota: QuotaLimit;
  basePriceCents: number;
  addonsPriceCents: number;
  totalPriceCents: number;
  fullMonthlyEquivalentCents: number;
  annualSavingsCents: number;
  currency: 'BRL';
  currentPlanId: PlanId;
  isDowngrade: boolean;
  downgradeImpact?: {
    isOverLimit: boolean;
    membersOver: boolean;
    songsOver: boolean;
    gracePeriodDays: number;
  };
}

export interface CheckoutCreationRequest {
  planId: PlanId;
  interval: BillingInterval;
  addonBlocks?: number;
  successUrl?: string;
  cancelUrl?: string;
  policyVersion?: BillingTransitionPolicyVersion;
}

export interface CheckoutCreationResult {
  checkoutUrl: string;
  checkoutId: string;
  expiresAt: string | null;
  totalPriceCents: number;
  currency: 'BRL';
}

export interface EarlyActivationQuoteResponseDto {
  quoteId: string;
  transitionId: string;
  sourcePlanId: string;
  targetPlanId: string;
  currentPeriodStartBillingDate: string;
  currentPeriodEndBillingDate: string;
  quoteBillingDate: string;
  totalDays: number;
  remainingDays: number;
  sourceCurrentCycleTotalCents: number;
  targetCurrentCycleTotalCents: number;
  priceDeltaCents: number;
  proratedAdjustmentCents: number;
  currency: 'BRL';
  expiresAt: string;
  nextRenewalBillingDate: string;
  nextRecurringAmountCents: number;
}

export interface EarlyActivationCheckoutResponseDto {
  checkoutUrl: string;
  checkoutId: string;
  quoteId: string;
  amountCents: number;
  expiresAt: string | null;
  transitionId: string;
  status: 'payment_pending';
}
