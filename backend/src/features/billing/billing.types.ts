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
