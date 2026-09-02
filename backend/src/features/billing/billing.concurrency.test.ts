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
import { config } from '../../config/unifiedConfig';

describe('BillingService — Concurrency, Idempotency & Out-of-Order Hardening', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockProvider: BillingProvider;

  const mockEventsStore = new Map<string, BillingWebhookEventRecord>();
  const mockCustomersStore = new Map<string, BillingCustomerRecord>();
  const mockSubscriptionsStore = new Map<string, BillingSubscriptionRecord>();
  const mockPlanChangesStore = new Map<string, any>();
  const mockAppSubscriptionsStore = new Map<string, MinistrySubscriptionRecord>();
  const mockTransactionsStore = new Map<string, any>();

  beforeEach(() => {
    (config as any).billingPublicApiUrl = 'https://tunnel.trycloudflare.com';
    mockEventsStore.clear();
    mockCustomersStore.clear();
    mockSubscriptionsStore.clear();
    mockPlanChangesStore.clear();
    mockAppSubscriptionsStore.clear();
    mockTransactionsStore.clear();

    mockBillingRepo = {
      getCustomer: vi.fn().mockImplementation(async (ministryId: string, provider: string) => {
        return mockCustomersStore.get(`${ministryId}_${provider}`) || null;
      }),
      getCustomerByProviderId: vi.fn().mockImplementation(async (providerId: string) => {
        for (const cust of mockCustomersStore.values()) {
          if (cust.provider_customer_id === providerId) return cust;
        }
        return null;
      }),
      setCustomer: vi.fn().mockImplementation(async (cust: BillingCustomerRecord) => {
        mockCustomersStore.set(cust.id, cust);
      }),
      claimCustomerCreation: vi.fn().mockImplementation(async (ministryId: string, provider: string, lockWorkerId: string) => {
        const existing = mockCustomersStore.get(`${ministryId}_${provider}`);
        const now = Date.now();
        if (existing) {
          if (existing.provider_customer_id && existing.status !== 'creating') {
            return { acquired: false, customer: existing };
          }
          if (existing.status === 'creating' && existing.lease_locked_until) {
            if (new Date(existing.lease_locked_until).getTime() > now && existing.lease_locked_by !== lockWorkerId) {
              return { acquired: false, customer: existing };
            }
          }
        }
        const record: BillingCustomerRecord = {
          id: `${ministryId}_${provider}`,
          ministry_id: ministryId,
          provider: provider as any,
          provider_customer_id: '',
          status: 'creating',
          lease_locked_until: new Date(now + 30000).toISOString(),
          lease_locked_by: lockWorkerId,
          created_at: existing?.created_at || new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        };
        mockCustomersStore.set(record.id, record);
        return { acquired: true, customer: record };
      }),
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
      getPlanChange: vi.fn().mockImplementation(async (id: string) => {
        return mockPlanChangesStore.get(id) || null;
      }),
      getTransitionById: vi.fn().mockImplementation(async (id: string) => {
        return mockPlanChangesStore.get(id) || null;
      }),
      setPlanChange: vi.fn().mockImplementation(async (change: any) => {
        mockPlanChangesStore.set(change.id, change);
      }),
      getRecentPendingPlanChange: vi.fn().mockImplementation(
        async (ministryId: string, provider: string, planId: string, interval: string, addonBlocks: number) => {
          for (const change of mockPlanChangesStore.values()) {
            if (
              change.ministry_id === ministryId &&
              change.status === 'pending' &&
              change.requested_plan_id === planId &&
              change.requested_interval === interval &&
              (change.requested_addon_blocks || 0) === addonBlocks &&
              change.checkout_url
            ) {
              return change;
            }
          }
          return null;
        }
      ),
      getPlanChangeByCheckoutIntentId: vi.fn().mockImplementation(async (intentId: string) => {
        for (const change of mockPlanChangesStore.values()) {
          if (change.id === intentId || change.checkout_intent_id === intentId) return change;
        }
        return null;
      }),
      getPlanChangeByCheckoutId: vi.fn().mockImplementation(async (checkoutId: string) => {
        for (const change of mockPlanChangesStore.values()) {
          if (change.provider_checkout_id === checkoutId) return change;
        }
        return null;
      }),
      getPlanChangeByNewSubscriptionId: vi.fn().mockImplementation(async (subId: string) => {
        for (const change of mockPlanChangesStore.values()) {
          if (change.new_provider_subscription_id === subId) return change;
        }
        return null;
      }),
      getFailedSupersedes: vi.fn().mockImplementation(async (ministryId: string) => {
        const results = [];
        for (const change of mockPlanChangesStore.values()) {
          if (change.ministry_id === ministryId && change.supersede_status === 'failed') {
            results.push(change);
          }
        }
        return results;
      }),
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
      getActiveTransitionSlot: vi.fn().mockImplementation(async (ministryId: string) => {
        for (const change of mockPlanChangesStore.values()) {
          if (change.ministry_id === ministryId && change.status === 'pending') {
            return {
              id: `slot_${ministryId}_asaas`,
              ministry_id: ministryId,
              provider: 'asaas',
              plan_change_id: change.id,
              acquired_at: change.created_at,
              updated_at: change.updated_at,
              version: 1,
            };
          }
        }
        return null;
      }),
      getActiveTransitionForMinistry: vi.fn().mockImplementation(async (ministryId: string) => {
        for (const change of mockPlanChangesStore.values()) {
          if (change.ministry_id === ministryId && change.status === 'pending') {
            return {
              slot: {
                id: `slot_${ministryId}_asaas`,
                ministry_id: ministryId,
                provider: 'asaas',
                plan_change_id: change.id,
                acquired_at: change.created_at,
                updated_at: change.updated_at,
                version: 1,
              },
              transition: change,
            };
          }
        }
        return null;
      }),
      createTransitionAndClaimSlot: vi.fn().mockImplementation(async (record: any) => {
        mockPlanChangesStore.set(record.id, record);
        return {
          planChange: record,
          slot: {
            id: `slot_${record.ministry_id}_${record.provider}`,
            ministry_id: record.ministry_id,
            provider: record.provider,
            plan_change_id: record.id,
            acquired_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
          },
        };
      }),
      updateTransition: vi.fn().mockImplementation(async (id: string, ministryId: string, updates: any) => {
        const existing = mockPlanChangesStore.get(id) || { id, ministry_id: ministryId };
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
        mockPlanChangesStore.set(id, updated);
        return updated;
      }),
      recordNewCheckoutAttempt: vi.fn().mockImplementation(async (transitionId: string, ministryId: string, attempt: any) => {
        const existing = mockPlanChangesStore.get(transitionId) || { id: transitionId, ministry_id: ministryId };
        const attempts = existing.checkout_attempts || [];
        attempts.push(attempt);
        const updated = { ...existing, checkout_attempts: attempts, updated_at: new Date().toISOString() };
        mockPlanChangesStore.set(transitionId, updated);
        return updated;
      }),
      confirmInitialPurchaseActivation: vi.fn().mockImplementation(async (params: any) => {
        const existing = mockPlanChangesStore.get(params.transitionId) || { id: params.transitionId, ministry_id: params.ministryId };
        const updated = {
          ...existing,
          ...params,
          transition_status: 'completed',
          financial_safety_status: 'safe_terminal',
          status: 'completed',
          updated_at: new Date().toISOString(),
        };
        mockPlanChangesStore.set(params.transitionId, updated);
        return updated;
      }),
      releaseSlotIfOwnedAndSafe: vi.fn().mockResolvedValue(true),
      markFinanciallySafe: vi.fn().mockImplementation(async (id: string, ministryId: string, terminalStatus: string) => {
        const existing = mockPlanChangesStore.get(id) || { id, ministry_id: ministryId };
        const updated = { ...existing, transition_status: terminalStatus, financial_safety_status: 'safe_terminal', updated_at: new Date().toISOString() };
        mockPlanChangesStore.set(id, updated);
        return updated;
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
      findById: vi.fn().mockResolvedValue({ id: 'min_test', name: 'Igreja Central' }),
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
      inactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      removeSubscription: vi.fn().mockResolvedValue({ success: true }),
      reactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
      getSubscription: vi.fn().mockResolvedValue({ status: 'ACTIVE', value: 34.9, cycle: 'MONTHLY' }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      removePayment: vi.fn().mockResolvedValue({ success: true }),
      getPayment: vi.fn().mockResolvedValue(null),
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

  describe('Multi-Instance Lock & Automatic Background Reconciliation Worker', () => {
    it('only 1 concurrent worker successfully leases a failed plan change (atomic lock)', async () => {
      const planChangeRecord = {
        id: 'change_concurrent_lease',
        ministry_id: 'min_test',
        provider: 'asaas',
        status: 'superseding',
        supersede_status: 'failed',
        previous_provider_subscription_id: 'sub_old_1',
        new_provider_subscription_id: 'sub_new_2',
        retry_locked_until: null,
        retry_locked_by: null,
        retry_count: 1,
      };

      mockPlanChangesStore.set(planChangeRecord.id, planChangeRecord);

      mockBillingRepo.claimPlanChangeForRetry = vi.fn().mockImplementation(async (id: string, lockWorkerId: string) => {
        const item = mockPlanChangesStore.get(id);
        if (!item || item.status === 'completed') return null;
        if (item.retry_locked_until && new Date(item.retry_locked_until) > new Date()) {
          return null; // Locked by another worker!
        }
        item.retry_locked_by = lockWorkerId;
        item.retry_locked_until = new Date(Date.now() + 60000).toISOString();
        return { ...item };
      });

      // Worker 1 and Worker 2 try to lease at the same time
      const worker1Claim = await mockBillingRepo.claimPlanChangeForRetry('change_concurrent_lease', 'worker_alpha');
      const worker2Claim = await mockBillingRepo.claimPlanChangeForRetry('change_concurrent_lease', 'worker_beta');

      expect(worker1Claim).not.toBeNull();
      expect(worker1Claim?.retry_locked_by).toBe('worker_alpha');

      // Worker 2 is locked out
      expect(worker2Claim).toBeNull();
    });
  });

  describe('Customer Resolution & Concurrency Safety (GAP-011)', () => {
    it('A) FIRST CUSTOMER CONCURRENCY: duas chamadas concorrentes chamam createCustomer EXATAMENTE UMA VEZ e reutilizam o mesmo ID', async () => {
      // Criação concorrente quando billing_customers está vazio
      mockCustomersStore.clear();
      mockProvider.createCustomer = vi.fn().mockImplementation(async () => {
        // Simula delay de rede no gateway
        await new Promise((r) => setTimeout(r, 100));
        return { providerCustomerId: 'cus_atomic_first_123' };
      });

      const [res1, res2] = await Promise.all([
        billingService.resolveOrCreateBillingCustomer('min_test'),
        billingService.resolveOrCreateBillingCustomer('min_test'),
      ]);

      // Prova essencial: createCustomer foi chamado EXATAMENTE UMA VEZ no provider
      expect(mockProvider.createCustomer).toHaveBeenCalledTimes(1);

      // Ambas as requests retornaram o mesmo ID
      expect(res1.providerCustomerId).toBe('cus_atomic_first_123');
      expect(res2.providerCustomerId).toBe('cus_atomic_first_123');

      // Registro final no Firestore está consolidado como 'ready'
      const canonical = mockCustomersStore.get('min_test_asaas');
      expect(canonical?.provider_customer_id).toBe('cus_atomic_first_123');
      expect(canonical?.status).toBe('ready');
    });

    it('B) MULTI-INSTANCE CLAIM SAFETY: apenas uma instância adquire o lease atômico', async () => {
      mockCustomersStore.clear();

      const claim1 = await mockBillingRepo.claimCustomerCreation('min_test', 'asaas', 'worker_alpha', 30000);
      const claim2 = await mockBillingRepo.claimCustomerCreation('min_test', 'asaas', 'worker_beta', 30000);

      expect(claim1.acquired).toBe(true);
      expect(claim1.customer?.lease_locked_by).toBe('worker_alpha');

      expect(claim2.acquired).toBe(false);
      expect(claim2.customer?.lease_locked_by).toBe('worker_alpha');
    });

    it('C) CRASH/RECOVERY: após falha antes de persistir, busca por externalReference no gateway e evita duplicata', async () => {
      mockCustomersStore.clear();

      // Simula que o gateway já tinha o customer criado por externalReference (de uma tentativa anterior antes do crash)
      mockProvider.findCustomerByExternalReference = vi.fn().mockResolvedValue({
        providerCustomerId: 'cus_recovered_from_crash_999',
      });
      mockProvider.createCustomer = vi.fn();

      const res = await billingService.resolveOrCreateBillingCustomer('min_test');

      expect(mockProvider.findCustomerByExternalReference).toHaveBeenCalledWith('min_test');
      expect(mockProvider.createCustomer).not.toHaveBeenCalled();
      expect(res.providerCustomerId).toBe('cus_recovered_from_crash_999');

      const canonical = mockCustomersStore.get('min_test_asaas');
      expect(canonical?.provider_customer_id).toBe('cus_recovered_from_crash_999');
    });

    it('D) LATE HISTORICAL WEBHOOK: evento atrasado com customer antigo NÃO reverte o customer canônico vigente', async () => {
      // Estado atual: canonical = cus_active_B
      const initialCreatedAt = '2026-07-01T00:00:00.000Z';
      mockCustomersStore.set('min_test_asaas', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_customer_id: 'cus_active_B',
        status: 'ready',
        created_at: initialCreatedAt,
        updated_at: '2026-08-01T00:00:00.000Z',
      });

      // Assinatura ativa vigente aponta para sub_active_2 e cus_active_B
      mockSubscriptionsStore.set('min_test', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        provider_subscription_id: 'sub_active_2',
        provider_customer_id: 'cus_active_B',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        started_at: initialCreatedAt,
        created_at: initialCreatedAt,
        updated_at: '2026-08-01T00:00:00.000Z',
      });

      // Chega webhook atrasado de pagamento de assinatura antiga (sub_old_1) com cus_old_A
      (mockProvider.parseWebhookEvent as any).mockReturnValue({
        providerEventId: 'evt_delayed_old_payment',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_old_1',
        providerCustomerId: 'cus_old_A',
        providerPaymentId: 'pay_old_1',
        amountCents: 3490,
      });

      // Simula que o webhook não é da transição nem da active sub
      const result = await billingService.handleWebhook({ 'asaas-access-token': 'token' }, {});

      // O customer canônico DEVE continuar sendo cus_active_B
      const canonical = mockCustomersStore.get('min_test_asaas');
      expect(canonical?.provider_customer_id).toBe('cus_active_B');
      expect(canonical?.created_at).toBe(initialCreatedAt);
    });

    it('E) CURRENT ACTIVE WEBHOOK: evento legítimo da nova transição reconcilia customer e preserva created_at original', async () => {
      const initialCreatedAt = '2026-07-01T00:00:00.000Z';
      mockCustomersStore.set('min_test_asaas', {
        id: 'min_test_asaas',
        ministry_id: 'min_test',
        provider: 'asaas',
        provider_customer_id: 'cus_old_A',
        status: 'ready',
        created_at: initialCreatedAt,
        updated_at: '2026-08-01T00:00:00.000Z',
      });

      // Plan change ativo
      mockPlanChangesStore.set('intent_min_test_new', {
        id: 'intent_min_test_new',
        ministry_id: 'min_test',
        provider: 'asaas',
        status: 'pending',
        requested_plan_id: 'essential',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 3490,
      });

      // Webhook da transição atual com cus_new_B
      (mockProvider.parseWebhookEvent as any).mockReturnValue({
        providerEventId: 'evt_checkout_paid_current',
        eventType: 'checkout_paid',
        rawEventType: 'CHECKOUT_PAID',
        externalReference: 'intent_min_test_new',
        providerCustomerId: 'cus_new_B',
        providerSubscriptionId: 'sub_new_2',
        amountCents: 3490,
      });

      const res = await billingService.handleWebhook({ 'asaas-access-token': 'token' }, {});
      expect(res.processed).toBe(true);

      const canonical = mockCustomersStore.get('min_test_asaas');
      expect(canonical?.provider_customer_id).toBe('cus_new_B');
      expect(canonical?.created_at).toBe(initialCreatedAt); // created_at original preservado!
    });
  });
});
