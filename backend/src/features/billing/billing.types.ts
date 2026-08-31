import { PlanId, QuotaLimit, BillingInterval } from '../../config/plans.config';

export type BillingProviderName = 'asaas' | 'mock';

export interface BillingCustomerRecord {
  id: string; // e.g. `${ministry_id}_${provider}`
  ministry_id: string;
  provider: BillingProviderName;
  provider_customer_id: string;
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
  cancel_at_period_end: boolean;
  checkout_url?: string | null;
  created_at: string;
  updated_at: string;
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

export interface BillingPlanChangeRecord {
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

export type BillingTransactionStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'canceled' | 'failed';

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
  payment_method?: string | null;
  invoice_url?: string | null;
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
}

export interface CheckoutCreationResult {
  checkoutUrl: string;
  checkoutId: string;
  expiresAt: string | null;
  totalPriceCents: number;
  currency: 'BRL';
}
