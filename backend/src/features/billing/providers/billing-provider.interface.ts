import { PlanId, BillingInterval } from '../../../config/plans.config';
import { BillingProviderName } from '../billing.types';

export type NormalizedWebhookEventType =
  | 'payment_confirmed'
  | 'payment_received'
  | 'payment_overdue'
  | 'payment_deleted'
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_inactivated'
  | 'subscription_canceled'
  | 'checkout_created'
  | 'checkout_paid'
  | 'checkout_canceled'
  | 'checkout_expired'
  | 'unknown';

export type ProviderErrorOutcome = 'DEFINITE_NO_RESOURCE_CREATED' | 'OUTCOME_UNCERTAIN';

export interface ParsedWebhookEvent {
  providerEventId: string;
  eventType: NormalizedWebhookEventType;
  rawEventType: string;
  providerCheckoutId?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  providerPaymentId?: string;
  externalReference?: string;
  amountCents?: number;
  currency?: string;
  paymentMethod?: string;
  dueDate?: string;
  originalDueDate?: string;
  paymentDate?: string;
  confirmedDate?: string;
  invoiceUrl?: string;
  status?: string;
  subscriptionCycle?: BillingInterval;
  subscriptionValueCents?: number;
  subscriptionNextDueDate?: string;
}

export interface ProviderPaymentRecord {
  id: string;
  subscriptionId?: string;
  customerId?: string;
  status: string;
  dueDate: string;
  originalDueDate?: string;
  amountCents: number;
  billingType?: string;
  externalReference?: string;
  clientPaymentDate?: string;
  paymentDate?: string;
  invoiceUrl?: string;
}

export interface CreateDetachedCheckoutParams {
  ministryId: string;
  checkoutIntentId: string;
  providerCustomerId?: string;
  amountCents: number;
  description: string;
  minutesToExpire: number;
  successUrl?: string;
  cancelUrl?: string;
  expiredUrl?: string;
  customerData?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    phone?: string;
  };
}

export interface CreateDetachedCheckoutResult {
  checkoutUrl: string;
  checkoutId: string;
  expiresAt: string | null;
}

export type ProviderSubscriptionReadOutcomeType =
  | 'FOUND'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'TRANSIENT_ERROR'
  | 'MALFORMED_RESPONSE';

export interface ProviderSubscriptionState {
  outcome: ProviderSubscriptionReadOutcomeType;
  status?: string;
  rawSubscription?: {
    status: string;
    value?: number;
    valueCents?: number;
    cycle?: string;
    nextDueDate?: string;
    customer?: string;
  };
  httpStatus?: number;
  errorMessage?: string;
}

export type ProviderSubscriptionInactivateOutcomeType =
  | 'SUCCESS'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'CLIENT_ERROR'
  | 'TRANSIENT_ERROR';

export interface ProviderSubscriptionInactivateResult {
  outcome: ProviderSubscriptionInactivateOutcomeType;
  httpStatus?: number;
  errorMessage?: string;
}

export type ProviderPaymentListOutcomeType =
  | 'SUCCESS'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'TRANSIENT_ERROR'
  | 'MALFORMED_RESPONSE';

export interface ProviderPaymentListResult {
  outcome: ProviderPaymentListOutcomeType;
  payments?: ProviderPaymentRecord[];
  httpStatus?: number;
  errorMessage?: string;
}

export interface BillingProvider {
  readonly name: BillingProviderName;

  classifyErrorOutcome?(error: any): ProviderErrorOutcome;

  createCustomer(params: {
    ministryId: string;
    ministryName: string;
    email?: string;
    taxId?: string;
    phone?: string;
  }): Promise<{ providerCustomerId: string }>;

  updateCustomer?(
    providerCustomerId: string,
    params: { name?: string; email?: string; phone?: string; taxId?: string }
  ): Promise<void>;

  findCustomerByExternalReference?(externalReference: string): Promise<{ providerCustomerId: string } | null>;

  findSubscriptionByExternalReference?(externalReference: string): Promise<{
    providerSubscriptionId: string;
    providerCustomerId?: string;
    status: string;
    valueCents: number;
    cycle?: string;
    nextDueDate?: string;
  } | null>;

  /**
   * Lista cobranças geradas por uma sessão de checkout específica no provedor.
   * Endpoint oficial Asaas documentado: GET /v3/payments?checkoutSession={checkoutSessionId}
   */
  listPaymentsByCheckoutSession?(checkoutSessionId: string): Promise<Array<ProviderPaymentRecord>>;

  createCheckout(params: {
    ministryId: string;
    checkoutIntentId?: string;
    providerCustomerId?: string;
    planId: PlanId;
    planName: string;
    interval: BillingInterval;
    addonBlocks: number;
    amountCents: number;
    successUrl?: string;
    cancelUrl?: string;
    expiredUrl?: string;
    customerData?: {
      name?: string;
      email?: string;
      cpfCnpj?: string;
      phone?: string;
    };
    nextDueDate?: string;
  }): Promise<{
    checkoutUrl: string;
    checkoutId: string;
    expiresAt: string | null;
  }>;

  /**
   * Cria uma sessão hospedada no gateway para cobrança avulsa/desanexada (DETACHED),
   * utilizada no ajuste pró-rata de ativação antecipada.
   * Não cria recorrência nem bloco de assinatura.
   */
  createDetachedCheckout?(params: CreateDetachedCheckoutParams): Promise<CreateDetachedCheckoutResult>;

  /**
   * Cancela uma sessão de checkout hospedada no provedor (POST /v3/checkouts/{checkoutId}/cancel).
   */
  cancelCheckout?(checkoutId: string): Promise<{ success: boolean; status?: string }>;

  inactivateSubscription(providerSubscriptionId: string): Promise<{ success: boolean }>;

  inactivateSubscriptionStrict?(
    providerSubscriptionId: string
  ): Promise<ProviderSubscriptionInactivateResult>;

  removeSubscription(providerSubscriptionId: string): Promise<{ success: boolean }>;

  cancelSubscription(
    providerSubscriptionId: string,
    cancelAtPeriodEnd: boolean
  ): Promise<{ success: boolean; canceledAtPeriodEnd: boolean }>;

  reactivateSubscription(providerSubscriptionId: string, nextDueDate?: string): Promise<{ success: boolean }>;

  listSubscriptionPayments(
    providerSubscriptionId: string,
    options?: { status?: string }
  ): Promise<Array<ProviderPaymentRecord>>;

  listAllSubscriptionPaymentsStrict?(
    providerSubscriptionId: string
  ): Promise<ProviderPaymentListResult>;

  removePayment(providerPaymentId: string): Promise<{ success: boolean }>;

  getPayment?(providerPaymentId: string): Promise<ProviderPaymentRecord | null>;

  validateWebhookRequest(headers: Record<string, any>, rawBody: any): boolean;

  parseWebhookEvent(body: any): ParsedWebhookEvent | null;

  getSubscription?(providerSubscriptionId: string): Promise<{
    status: string;
    value?: number;
    valueCents?: number;
    cycle?: string;
    nextDueDate?: string;
    customer?: string;
  } | null>;

  getSubscriptionState?(providerSubscriptionId: string): Promise<ProviderSubscriptionState>;
}

