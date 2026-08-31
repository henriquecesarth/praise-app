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
  paymentMethod?: string;
  dueDate?: string;
  paymentDate?: string;
  invoiceUrl?: string;
  status?: string;
}

export interface BillingProvider {
  readonly name: BillingProviderName;

  createCustomer(params: {
    ministryId: string;
    ministryName: string;
    email?: string;
    taxId?: string;
    phone?: string;
  }): Promise<{ providerCustomerId: string }>;

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
    customerData?: {
      name?: string;
      email?: string;
      cpfCnpj?: string;
      phone?: string;
    };
  }): Promise<{
    checkoutUrl: string;
    checkoutId: string;
    expiresAt: string | null;
  }>;

  cancelSubscription(
    providerSubscriptionId: string,
    cancelAtPeriodEnd: boolean
  ): Promise<{ success: boolean; canceledAtPeriodEnd: boolean }>;

  reactivateSubscription(providerSubscriptionId: string): Promise<{ success: boolean }>;

  validateWebhookRequest(headers: Record<string, any>, rawBody: any): boolean;

  parseWebhookEvent(body: any): ParsedWebhookEvent | null;

  getSubscription?(providerSubscriptionId: string): Promise<{
    status: string;
    value?: number;
    cycle?: string;
    nextDueDate?: string;
  } | null>;
}

