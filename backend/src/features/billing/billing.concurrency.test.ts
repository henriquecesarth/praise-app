import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { BillingProvider, ParsedWebhookEvent } from './providers/billing-provider.interface';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingWebhookEventRecord,
} from './billing.types';
import { MinistrySubscriptionRecord, MinistryUsageRecord } from '../subscriptions/subscription.types';

describe('BillingService — Concurrency, Idempotency & Out-of-Order Hardening', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockProvider: BillingProvider;

  const mockEventsStore = new Map<string, BillingWebhookEventRecord>();
  const mockSubscriptionsStore = new Map<string, BillingSubscriptionRecord>();
  const mockAppSubscriptionsStore = new Map<string, MinistrySubscriptionRecord>();
  const mockTransactionsStore = new Map<string, any>();

  beforeEach(() => {
    mockEventsStore.clear();
    mockSubscriptionsStore.clear();
    mockAppSubscriptionsStore.clear();
    mockTransactionsStore.clear();

    mockBillingRepo = {
      getCustomer: vi.fn().mockResolvedValue({
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_customer_id: 'cus_123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      getCustomerByProviderId: vi.fn().mockImplementation(async (providerId: string) => {
        if (providerId === 'cus_123') {
          return {
            id: 'min_test_asaas',
            ministry_id: 'min_test',
            provider: 'asaas',
            provider_customer_id: 'cus_123',
          };
        }
        return null;
      }),
      setCustomer: vi.fn().mockResolvedValue(undefined),
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return mockSubscriptionsStore.get(ministryId) || null;
      }),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockImplementation(async (providerSubId: string) => {
        for (const sub of mockSubscriptionsStore.values()) {
          if (sub.provider_subscription_id === providerSubId) return sub;
        }
        return null;
      }),
      getSubscriptionByCheckoutId: vi.fn().mockImplementation(async (checkoutId: string) => {
        for (const sub of mockSubscriptionsStore.values()) {
          if (sub.provider_checkout_id === checkoutId) return sub;
        }
        return null;
      }),
      getSubscriptionByCheckoutIntentId: vi.fn().mockImplementation(async (intentId: string) => {
        for (const sub of mockSubscriptionsStore.values()) {
          if (sub.checkout_intent_id === intentId) return sub;
        }
        return null;
      }),
      getSubscriptionByProviderId: vi.fn().mockImplementation(async (providerSubId: string) => {
        for (const sub of mockSubscriptionsStore.values()) {
          if (
            sub.provider_subscription_id === providerSubId ||
            sub.provider_checkout_id === providerSubId ||
            sub.checkout_intent_id === providerSubId
          ) return sub;
        }
        return null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: BillingSubscriptionRecord) => {
        mockSubscriptionsStore.set(sub.ministry_id, sub);
      }),
      getRecentPendingSubscription: vi.fn().mockImplementation(
        async (ministryId: string, provider: string, planId: string, interval: string, addonBlocks: number) => {
          const sub = mockSubscriptionsStore.get(ministryId);
          if (
            sub &&
            sub.status === 'pending' &&
            sub.plan_id === planId &&
            sub.interval === interval &&
            sub.member_addon_blocks === addonBlocks &&
            sub.checkout_url
          ) {
            return sub;
          }
          return null;
        }
      ),
      registerWebhookEvent: vi.fn().mockImplementation(async (event: BillingWebhookEventRecord) => {
        if (mockEventsStore.has(event.id)) {
          return { isDuplicate: true, event: mockEventsStore.get(event.id)! };
        }
        mockEventsStore.set(event.id, event);
        return { isDuplicate: false, event };
      }),
      markWebhookEventProcessed: vi.fn().mockImplementation(async (provider: string, eventId: string, status: string) => {
        const key = `${provider}_${eventId}`;
        const evt = mockEventsStore.get(key);
        if (evt) {
          evt.processing_status = status as any;
          evt.processed_at = new Date().toISOString();
        }
      }),
      saveTransaction: vi.fn().mockImplementation(async (tx: any) => {
        mockTransactionsStore.set(tx.id, tx);
      }),
      getTransactions: vi.fn().mockResolvedValue([]),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return mockAppSubscriptionsStore.get(ministryId) || null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: MinistrySubscriptionRecord) => {
        mockAppSubscriptionsStore.set(sub.ministry_id, sub);
      }),
    };

    mockSubscriptionService = {
      getSubscriptionSummary: vi.fn().mockResolvedValue({
        plan: { id: 'free', name: 'Free' },
        subscription: { planId: 'free', memberAddonBlocks: 0, billingStatus: 'active' },
        quotas: { members: 10, songs: 50 },
        usage: { membersCount: 5, songsCount: 20 },
        isOverLimit: false,
      }),
      changePlan: vi.fn().mockResolvedValue({}),
      changeMemberAddonBlocks: vi.fn().mockResolvedValue({}),
    };

    mockMinistryRepo = {
      getMinistryById: vi.fn().mockResolvedValue({ id: 'min_test', name: 'Igreja Central' }),
    };

    mockProvider = {
      name: 'asaas',
      createCustomer: vi.fn().mockResolvedValue({ providerCustomerId: 'cus_123' }),
      createCheckout: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_123',
        checkoutId: 'chk_123',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      cancelSubscription: vi.fn().mockResolvedValue({ success: true, canceledAtPeriodEnd: true }),
      reactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
      getSubscription: vi.fn().mockResolvedValue({ status: 'ACTIVE', value: 34.9, cycle: 'MONTHLY' }),
    };

    billingService = new BillingService(
      mockBillingRepo as unknown as BillingRepository,
      mockSubscriptionService as unknown as SubscriptionService,
      mockSubscriptionRepo as unknown as SubscriptionRepository,
      mockMinistryRepo as unknown as MinistryRepository,
      mockProvider
    );
  });

  describe('P0: Atomic Idempotency with Concurrent Webhooks', () => {
    it('handles 10 simultaneous webhooks with identical provider_event_id with exactly 1 business mutation and 9 idempotent responses', async () => {
      const providerEventId = 'evt_duplicate_stress_test_100';
      const parsedEvent: ParsedWebhookEvent = {
        providerEventId,
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'chk_123',
        providerPaymentId: 'pay_999',
        amountCents: 3490, // Essential monthly
      };

      // Mock subscription in pending state
      mockSubscriptionsStore.set('min_test', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_subscription_id: 'chk_123',
        provider_customer_id: 'cus_123',
        plan_id: 'essential',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 3490,
        status: 'pending',
        started_at: new Date().toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockAppSubscriptionsStore.set('min_test', {
        id: 'min_test',
        ministry_id: 'min_test',
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue(parsedEvent);

      // Disparar 10 chamadas concorrentes usando Promise.all
      const promises = Array.from({ length: 10 }).map(() =>
        billingService.handleWebhook({ 'asaas-access-token': 'token' }, { id: providerEventId })
      );

      const results = await Promise.all(promises);

      // Contar quantas processaram vs duplicadas
      const processedCount = results.filter((r) => r.processed === true).length;
      const duplicateCount = results.filter((r) => r.reason === 'duplicate_event').length;

      expect(processedCount).toBe(1);
      expect(duplicateCount).toBe(9);
      expect(results.length).toBe(10);

      // Mutação de plano deve ter sido chamada exatamente 1 vez
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1);
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min_test', 'essential');
      expect(mockTransactionsStore.size).toBe(1);
    });
  });

  describe('P0: Double Checkout Protection', () => {
    it('reuses existing pending checkout session if created within last 15 minutes for same plan and interval', async () => {
      // 1ª Chamada: Cria o checkout
      const result1 = await billingService.createCheckout('min_test', 'user_1', {
        planId: 'pro',
        interval: 'monthly',
        addonBlocks: 2,
      });

      expect(result1.checkoutId).toBe('chk_123');
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);

      // 2ª Chamada imediata (duplo clique): Deve retornar a mesma sessão sem chamar o gateway novamente
      const result2 = await billingService.createCheckout('min_test', 'user_1', {
        planId: 'pro',
        interval: 'monthly',
        addonBlocks: 2,
      });

      expect(result2.checkoutId).toBe('chk_123');
      expect(result2.checkoutUrl).toBe(result1.checkoutUrl);
      // createCheckout no provider NÃO deve ser chamado uma 2ª vez
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Amount & Currency Validation (Security Hardening)', () => {
    it('blocks entitlement upgrade if webhook payment amount is lower than expected plan price', async () => {
      // Subscrição contratada: Premium (R$ 214,90 = 21490 cents)
      mockSubscriptionsStore.set('min_test', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_subscription_id: 'chk_premium',
        provider_customer_id: 'cus_123',
        plan_id: 'premium',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 21490,
        status: 'pending',
        started_at: new Date().toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockAppSubscriptionsStore.set('min_test', {
        id: 'min_test',
        ministry_id: 'min_test',
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Webhook forjado ou anômalo: valor de R$ 14,90 (1490 cents) para o plano Premium
      const maliciousEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_amount_spoofing',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'chk_premium',
        providerPaymentId: 'pay_low_amount',
        amountCents: 1490, // R$ 14,90 em vez de R$ 214,90
      };

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue(maliciousEvent);

      const result = await billingService.handleWebhook(
        { 'asaas-access-token': 'token' },
        { id: 'evt_amount_spoofing' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('amount_validation_failed');
      // Entitlement NÃO deve ter sido concedido
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });
  });

  describe('Out-of-Order Webhook Sequence Guards', () => {
    it('ignores delayed PAYMENT_OVERDUE if current subscription period was already confirmed and active with newer timestamp', async () => {
      const futureActiveStart = new Date('2026-09-01T10:00:00.000Z').toISOString();
      const pastOverdueDueDate = '2026-08-15';

      mockSubscriptionsStore.set('min_test', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_subscription_id: 'chk_active_cycle',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: futureActiveStart,
        current_period_start: futureActiveStart,
        current_period_end: new Date('2026-10-01T10:00:00.000Z').toISOString(),
        cancel_at_period_end: false,
        created_at: futureActiveStart,
        updated_at: futureActiveStart,
      });

      mockAppSubscriptionsStore.set('min_test', {
        id: 'min_test',
        ministry_id: 'min_test',
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: futureActiveStart,
        current_period_end: new Date('2026-10-01T10:00:00.000Z').toISOString(),
        cancel_at_period_end: false,
        created_at: futureActiveStart,
        updated_at: futureActiveStart,
      });

      // Evento PAYMENT_OVERDUE de fatura antiga de agosto chegando com atraso
      const delayedOverdueEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_delayed_overdue',
        eventType: 'payment_overdue',
        rawEventType: 'PAYMENT_OVERDUE',
        providerSubscriptionId: 'chk_active_cycle',
        providerPaymentId: 'pay_old_overdue',
        dueDate: pastOverdueDueDate,
        amountCents: 8990,
      };

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue(delayedOverdueEvent);

      const result = await billingService.handleWebhook(
        { 'asaas-access-token': 'token' },
        { id: 'evt_delayed_overdue' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('out_of_order_overdue_ignored');

      // Assinatura deve permanecer active
      const appSub = mockAppSubscriptionsStore.get('min_test');
      expect(appSub?.billing_status).toBe('active');
    });
  });

  describe('Reconciliation with Gateway', () => {
    it('reconciles status from Asaas recovering past_due subscription if gateway is active', async () => {
      mockSubscriptionsStore.set('min_test', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_subscription_id: 'sub_asaas_1',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'past_due',
        started_at: new Date().toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockAppSubscriptionsStore.set('min_test', {
        id: 'min_test',
        ministry_id: 'min_test',
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'past_due',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: new Date(Date.now() + 86400000).toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      vi.spyOn(mockProvider, 'getSubscription').mockResolvedValue({
        status: 'ACTIVE',
        value: 89.9,
        cycle: 'MONTHLY',
      });

      const reconciliation = await billingService.reconcileBillingSubscription('min_test');

      expect(reconciliation.reconciled).toBe(true);
      expect(reconciliation.providerStatus).toBe('ACTIVE');

      const updatedSub = mockSubscriptionsStore.get('min_test');
      expect(updatedSub?.status).toBe('active');

      const updatedAppSub = mockAppSubscriptionsStore.get('min_test');
      expect(updatedAppSub?.billing_status).toBe('active');
      expect(updatedAppSub?.grace_period_expires_at).toBeNull();
    });

    it('skips external gateway query if subscription is complimentary', async () => {
      mockAppSubscriptionsStore.set('min_test', {
        id: 'min_test',
        ministry_id: 'min_test',
        plan_id: 'premium',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'complimentary',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const reconciliation = await billingService.reconcileBillingSubscription('min_test');

      expect(reconciliation.reconciled).toBe(true);
      expect(reconciliation.message).toContain('cortesia');
      expect(mockProvider.getSubscription).not.toHaveBeenCalled();
    });
  });
});
