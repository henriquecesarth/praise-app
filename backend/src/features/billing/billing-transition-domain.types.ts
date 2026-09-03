import {
  PlanId,
  BillingInterval,
  QuotaLimit,
} from '../../config/plans.config';
import {
  EntitlementSnapshot,
  BillingEarlyActivationQuote,
  BillingTransitionType,
} from './billing.types';

export type EntitlementComparisonResult =
  | 'EQUAL'
  | 'TARGET_STRICTLY_GREATER'
  | 'TARGET_STRICTLY_LOWER'
  | 'MIXED';

export type EntitlementDirection = 'increase' | 'decrease' | 'same' | 'mixed';

export type BillingTransitionExecutionStrategy =
  | 'immediate_initial_purchase'
  | 'scheduled_paid_transition'
  | 'scheduled_cancel_to_free';

export interface SourceContractInput {
  plan_id: PlanId;
  interval: BillingInterval;
  addon_blocks: number;
  current_period_start?: string | Date | null;
  current_period_end?: string | Date | null;
}

export interface TargetContractRequest {
  plan_id: PlanId;
  interval: BillingInterval;
  addon_blocks: number;
}

export interface EffectiveCapabilities {
  members: QuotaLimit;
  songs: QuotaLimit;
}

export interface CommercialConfiguration {
  allowMemberAddons: boolean;
  maxMemberAddonBlocks: number;
}

export interface TransitionClassificationResult {
  transition_type: BillingTransitionType;
  execution_strategy: BillingTransitionExecutionStrategy;
  entitlement_comparison: EntitlementComparisonResult;
  entitlement_direction: EntitlementDirection;
  early_activation_eligible: boolean;
  is_interval_change: boolean;
  is_addon_change: boolean;
  is_plan_change: boolean;
  is_initial_purchase: boolean;
  is_cancel_to_free: boolean;
}

export interface TransitionCommercialSnapshot {
  // Classification & Strategy
  classification: TransitionClassificationResult;
  transition_type: BillingTransitionType;
  execution_strategy: BillingTransitionExecutionStrategy;
  early_activation_eligible: boolean;

  // Source Contract Snapshots (Immutable Basis)
  source_plan_id: PlanId;
  source_interval: BillingInterval;
  source_addon_blocks: number;
  source_entitlement_snapshot: EntitlementSnapshot;
  source_current_cycle_total_cents: number;
  current_period_start: string | null; // ISO 8601 (null for initial purchase from Free)
  current_period_end: string | null; // ISO 8601 (null for initial purchase from Free)
  current_period_start_date: string | null; // YYYY-MM-DD
  current_period_end_date: string | null; // YYYY-MM-DD

  // Target Contract Snapshots (Locked at requested_at)
  target_plan_id: PlanId;
  target_interval: BillingInterval;
  target_addon_blocks: number;
  target_future_recurring_price_cents: number;
  target_current_cycle_total_cents: number; // Target capabilities evaluated in source interval
  target_entitlement_snapshot?: EntitlementSnapshot | null;
  early_activation_target_entitlement_snapshot: EntitlementSnapshot | null;

  // Currency & Timestamps
  currency: 'BRL';
  price_locked_at: string; // ISO 8601
  effective_at: string; // ISO 8601 instant
  effective_billing_date: string; // YYYY-MM-DD
}

export interface ProrationCalculationResult {
  total_days: number;
  remaining_days: number;
  source_current_cycle_total_cents: number;
  target_current_cycle_total_cents: number;
  price_delta_cents: number;
  prorated_adjustment_cents: number;
  payment_required: boolean;
  quote_effective_billing_date: string;
}

export interface CreateQuoteOptions {
  now?: Date | string;
  quoteId?: string;
  timeZone?: string;
  ttlMinutes?: number;
}

export interface BuildBillingTransitionRecordParams {
  transitionId: string;
  ministryId: string;
  provider: import('./billing.types').BillingProviderName;
  commercialSnapshot: TransitionCommercialSnapshot;
  requestedByUserId?: string | null;
  providerCustomerId?: string | null;
  oldProviderSubscriptionId?: string | null;
  previousProviderSubscriptionId?: string | null;
  now?: Date | string;
  expiresAt?: string | null;
}

export interface InitialPurchaseProviderReadyParams {
  transition: import('./billing.types').BillingTransitionV1Record;
  parsedEvent: import('./providers/billing-provider.interface').ParsedWebhookEvent;
  expectedAmountCents: number;
  expectedCurrency?: 'BRL';
}

export interface InitialPurchaseProviderReadyResult {
  ready: boolean;
  reason?: string;
  failureCode?:
    | 'INVALID_TRANSITION'
    | 'STRATEGY_MISMATCH'
    | 'ATTEMPT_TYPE_MISMATCH'
    | 'CHECKOUT_CORRELATION_FAILED'
    | 'CUSTOMER_MISMATCH'
    | 'SUBSCRIPTION_CORRELATION_FAILED'
    | 'PAYMENT_CORRELATION_FAILED'
    | 'AMOUNT_MISMATCH'
    | 'CURRENCY_MISMATCH'
    | 'CYCLE_MISMATCH'
    | 'PAYMENT_NOT_SETTLED'
    | 'RENEWAL_DATE_INVALID';
}

export interface PaidToPaidTargetReadyParams {
  transition: import('./billing.types').BillingTransitionV1Record;
  targetCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  subscriptionCycle?: BillingInterval | null;
  subscriptionValueCents?: number | null;
  subscriptionStatus?: string | null;
  subscriptionNextDueDate?: string | null;
  firstPayment?: {
    id: string;
    subscriptionId?: string | null;
    customerId?: string | null;
    amountCents: number;
    dueDate: string;
    originalDueDate?: string | null;
    status: string;
  } | null;
  checkoutSessionId?: string | null;
  externalReference?: string | null;
}

export interface PaidToPaidTargetReadyResult {
  ready: boolean;
  reason?: string;
  failureCode?:
    | 'INVALID_TRANSITION'
    | 'STRATEGY_MISMATCH'
    | 'CUSTOMER_MISMATCH'
    | 'CHECKOUT_CORRELATION_FAILED'
    | 'SUBSCRIPTION_CORRELATION_FAILED'
    | 'CYCLE_MISMATCH'
    | 'AMOUNT_MISMATCH'
    | 'PAYMENT_NOT_YET_VISIBLE'
    | 'PAYMENT_SUBSCRIPTION_MISMATCH'
    | 'PAYMENT_AMOUNT_MISMATCH'
    | 'DUE_DATE_MISMATCH'
    | 'PAYMENT_STATUS_INVALID';
}
