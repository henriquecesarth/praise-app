import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingProvider, ParsedWebhookEvent, ProviderPaymentRecord } from './providers/billing-provider.interface';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingPlanChangeRecord,
  BillingTransitionV1Record,
  BillingActiveTransitionSlotRecord,
  BillingTransactionRecord,
  isBillingTransitionV1,
} from './billing.types';
import { calculatePlanPriceCents } from '../../config/plans.config';
import { verifyPaidToPaidTargetReadyGate } from './billing-transition-domain.service';
import { config } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';

describe('Phase 3B.1 — Billing Transition V1 Paid -> Paid Target Recurrence Preparation', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;
  let mockProvider: any;

  const planChangesStore = new Map<string, BillingPlanChangeRecord>();
  const activeSlotsStore = new Map<string, BillingActiveTransitionSlotRecord>();
  const subscriptionsStore = new Map<string, BillingSubscriptionRecord>();
  const customersStore = new Map<string, BillingCustomerRecord>();
  const appSubscriptionsStore = new Map<string, any>();
  const webhookEventsStore = new Map<string, any>();
  const transactionsStore = new Map<string, BillingTransactionRecord>();

  beforeEach(() => {
    (config as any).billingPublicApiUrl = 'https://api.louvaio.com';
    (config as any).billingTimezone = 'America/Sao_Paulo';

    planChangesStore.clear();
    activeSlotsStore.clear();
    subscriptionsStore.clear();
    customersStore.clear();
    appSubscriptionsStore.clear();
    webhookEventsStore.clear();
    transactionsStore.clear();

    mockBillingRepo = {
      getCustomer: vi.fn().mockImplementation(async (ministryId: string) => {
        return customersStore.get(`${ministryId}_asaas`) || null;
      }),
      getCustomerByProviderId: vi.fn().mockImplementation(async (providerCustomerId: string) => {
        for (const c of customersStore.values()) {
          if (c.provider_customer_id === providerCustomerId) return c;
        }
        return null;
      }),
      setCustomer: vi.fn().mockImplementation(async (c: any) => {
        customersStore.set(c.id, c);
      }),
      claimCustomerCreation: vi.fn().mockImplementation(async (ministryId: string, provider: string) => {
        const existing = customersStore.get(`${ministryId}_${provider}`);
        if (existing) return { acquired: false, customer: existing };
        const newCust: BillingCustomerRecord = {
          id: `${ministryId}_${provider}`,
          ministry_id: ministryId,
          provider: provider as any,
          provider_customer_id: `cus_${ministryId}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        customersStore.set(newCust.id, newCust);
        return { acquired: true, customer: newCust };
      }),
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return subscriptionsStore.get(ministryId) || null;
      }),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockImplementation(async (providerSubId: string) => {
        for (const sub of subscriptionsStore.values()) {
          if (sub.provider_subscription_id === providerSubId) return sub;
        }
        return null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        subscriptionsStore.set(sub.ministry_id, sub);
      }),
      getPlanChange: vi.fn().mockImplementation(async (id: string) => {
        return planChangesStore.get(id) || null;
      }),
      setPlanChange: vi.fn().mockImplementation(async (record: any) => {
        planChangesStore.set(record.id, record);
      }),
      getTransitionById: vi.fn().mockImplementation(async (id: string) => {
        return planChangesStore.get(id) || null;
      }),
      getPlanChangeByCheckoutId: vi.fn().mockImplementation(async (chkId: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.provider_checkout_id === chkId ||
            (tr as any).future_provider_checkout_id === chkId ||
            (tr as any).initial_provider_checkout_id === chkId ||
            (tr as any).checkout_attempts?.some((a: any) => a.provider_checkout_id === chkId)
          ) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByCheckoutIntentId: vi.fn().mockImplementation(async (intentId: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.checkout_intent_id === intentId ||
            (tr as any).future_checkout_intent_id === intentId ||
            (tr as any).initial_checkout_intent_id === intentId ||
            (tr as any).checkout_attempts?.some((a: any) => a.internal_checkout_intent_id === intentId)
          ) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByNewSubscriptionId: vi.fn().mockImplementation(async (subId: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.new_provider_subscription_id === subId ||
            (tr as any).future_provider_subscription_id === subId ||
            (tr as any).initial_provider_subscription_id === subId
          ) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByProviderId: vi.fn().mockImplementation(async (providerRef: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.id === providerRef ||
            tr.checkout_intent_id === providerRef ||
            (tr as any).future_checkout_intent_id === providerRef ||
            tr.provider_checkout_id === providerRef ||
            (tr as any).future_provider_checkout_id === providerRef ||
            tr.new_provider_subscription_id === providerRef ||
            (tr as any).future_provider_subscription_id === providerRef ||
            (tr as any).future_provider_payment_id === providerRef ||
            (tr as any).checkout_attempts?.some((a: any) => a.provider_checkout_id === providerRef || a.internal_checkout_intent_id === providerRef)
          ) {
            return tr;
          }
        }
        return null;
      }),
      getActiveTransitionSlot: vi.fn().mockImplementation(async (ministryId: string, provider: string) => {
        return activeSlotsStore.get(`slot_${ministryId}_${provider}`) || null;
      }),
      createTransitionAndClaimSlot: vi.fn().mockImplementation(async (record: BillingTransitionV1Record) => {
        const slotKey = `slot_${record.ministry_id}_${record.provider}`;
        if (activeSlotsStore.has(slotKey)) {
          throw new AppError(409, 'Já existe uma transição ativa para este ministério.', {
            code: 'ACTIVE_TRANSITION_EXISTS',
          });
        }
        planChangesStore.set(record.id, record);
        const slot: BillingActiveTransitionSlotRecord = {
          id: slotKey,
          ministry_id: record.ministry_id,
          provider: record.provider,
          plan_change_id: record.id,
          acquired_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        };
        activeSlotsStore.set(slotKey, slot);
        return { planChange: record, slot };
      }),
      updateTransition: vi.fn().mockImplementation(async (id: string, ministryId: string, updates: any) => {
        const existing = planChangesStore.get(id);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
        return updated;
      }),
      recordNewCheckoutAttempt: vi.fn().mockImplementation(async (transitionId: string, ministryId: string, attempt: any) => {
        const existing = planChangesStore.get(transitionId);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const attempts = (existing as any).checkout_attempts || [];
        const updatedAttempts = [...attempts, attempt];
        const updated = { ...existing, checkout_attempts: updatedAttempts, updated_at: new Date().toISOString() };
        planChangesStore.set(transitionId, updated);
        return updated;
      }),
      releaseSlotIfOwnedAndSafe: vi.fn().mockImplementation(async (ministryId: string, provider: string, planChangeId: string) => {
        const slotKey = `slot_${ministryId}_${provider}`;
        const slot = activeSlotsStore.get(slotKey);
        if (slot && slot.plan_change_id === planChangeId) {
          activeSlotsStore.delete(slotKey);
          return true;
        }
        return false;
      }),
      markFinanciallySafe: vi.fn().mockImplementation(async (id: string, ministryId: string, terminalStatus: string, details?: any) => {
        const existing = planChangesStore.get(id);
        if (!existing) return null;
        const updated = {
          ...existing,
          transition_status: terminalStatus,
          status: terminalStatus === 'completed' ? 'completed' : 'failed',
          financial_safety_status: 'safe_terminal',
          completed_at: new Date().toISOString(),
          ...details,
        };
        planChangesStore.set(id, updated);
        return updated;
      }),
      getWebhookEvent: vi.fn().mockImplementation(async (provider: string, eventId: string) => {
        return webhookEventsStore.get(`${provider}_${eventId}`) || null;
      }),
      registerWebhookEvent: vi.fn().mockImplementation(async (evt: any) => {
        const key = `${evt.provider}_${evt.provider_event_id}`;
        if (webhookEventsStore.has(key)) {
          return { isDuplicate: true, event: webhookEventsStore.get(key) };
        }
        webhookEventsStore.set(key, evt);
        return { isDuplicate: false, event: evt };
      }),
      markWebhookEventProcessed: vi.fn().mockImplementation(async (provider: string, eventId: string, status: string, reason?: string) => {
        const key = `${provider}_${eventId}`;
        const evt = webhookEventsStore.get(key);
        if (evt) {
          evt.status = status;
          evt.processing_error = reason || null;
        }
      }),
      claimTransitionForReconciliation: vi.fn().mockImplementation(async (id: string, ministryId: string, workerId: string) => {
        const tr = planChangesStore.get(id) as any;
        if (!tr) return null;
        if (tr.reconcile_locked_by && tr.reconcile_locked_until && new Date(tr.reconcile_locked_until).getTime() > Date.now()) {
          return null;
        }
        const updated = {
          ...tr,
          reconcile_locked_by: workerId,
          reconcile_locked_until: new Date(Date.now() + 120000).toISOString(),
        };
        planChangesStore.set(id, updated);
        return updated;
      }),
      releaseTransitionReconciliationLock: vi.fn().mockImplementation(async (id: string) => {
        const tr = planChangesStore.get(id);
        if (tr) {
          delete (tr as any).reconcile_locked_by;
          delete (tr as any).reconcile_locked_until;
        }
      }),
      releasePlanChangeLock: vi.fn().mockImplementation(async (id: string) => {
        const tr = planChangesStore.get(id);
        if (tr) {
          delete (tr as any).reconcile_locked_by;
          delete (tr as any).reconcile_locked_until;
        }
      }),
      saveTransaction: vi.fn().mockImplementation(async (tx: any) => {
        transactionsStore.set(tx.id, tx);
      }),
    };

    mockSubscriptionService = {
      changePlan: vi.fn().mockImplementation(async (ministryId: string, planId: string) => {
        const appSub = appSubscriptionsStore.get(ministryId) || {};
        appSubscriptionsStore.set(ministryId, { ...appSub, plan_id: planId, updated_at: new Date().toISOString() });
      }),
      changeMemberAddonBlocks: vi.fn().mockImplementation(async (ministryId: string, blocks: number) => {
        const appSub = appSubscriptionsStore.get(ministryId) || {};
        appSubscriptionsStore.set(ministryId, { ...appSub, member_addon_blocks: blocks, updated_at: new Date().toISOString() });
      }),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return appSubscriptionsStore.get(ministryId) || null;
      }),
    };

    mockMinistryRepo = {
      findById: vi.fn().mockImplementation(async (ministryId: string) => ({
        id: ministryId,
        name: `Ministry ${ministryId}`,
      })),
    };

    mockUserRepo = {
      findById: vi.fn().mockImplementation(async (userId: string) => ({
        id: userId,
        email: 'leader@praiseapp.com',
        name: 'Worship Leader',
      })),
    };

    mockProvider = {
      name: 'asaas',
      createCustomer: vi.fn().mockResolvedValue('cus_canonical_123'),
      createCheckout: vi.fn().mockImplementation(async (params: any) => ({
        checkoutUrl: `https://sandbox.asaas.com/checkout/${params.checkoutIntentId}`,
        checkoutId: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })),
      verifyWebhookSignature: vi.fn().mockReturnValue(true),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
      getSubscription: vi.fn(),
      listSubscriptionPayments: vi.fn(),
      listPayments: vi.fn(),
      classifyErrorOutcome: vi.fn().mockReturnValue('OUTCOME_UNCERTAIN'),
      listPaymentsByCheckoutSession: vi.fn(),
    };

    billingService = new BillingService(
      mockBillingRepo,
      mockSubscriptionService,
      mockSubscriptionRepo,
      mockMinistryRepo,
      mockProvider,
      mockUserRepo
    );
  });

  const setupActivePaidContract = (params: {
    ministryId: string;
    planId: any;
    interval: 'monthly' | 'annual';
    addonBlocks?: number;
    amountCents: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    providerSubId?: string;
    providerCustomerId?: string;
  }) => {
    const subId = params.providerSubId || `sub_source_${params.ministryId}`;
    const cusId = params.providerCustomerId || `cus_${params.ministryId}`;

    const billingSub: BillingSubscriptionRecord = {
      id: `${params.ministryId}_asaas`,
      ministry_id: params.ministryId,
      provider: 'asaas',
      provider_subscription_id: subId,
      provider_customer_id: cusId,
      plan_id: params.planId,
      interval: params.interval,
      member_addon_blocks: params.addonBlocks || 0,
      amount_cents: params.amountCents,
      status: 'active',
      started_at: `${params.currentPeriodStart}T00:00:00.000Z`,
      current_period_start: `${params.currentPeriodStart}T00:00:00.000Z`,
      current_period_end: `${params.currentPeriodEnd}T00:00:00.000Z`,
      current_period_start_billing_date: params.currentPeriodStart,
      current_period_end_billing_date: params.currentPeriodEnd,
      cancel_at_period_end: false,
      created_at: `${params.currentPeriodStart}T00:00:00.000Z`,
      updated_at: `${params.currentPeriodStart}T00:00:00.000Z`,
    };
    subscriptionsStore.set(params.ministryId, billingSub);

    const appSub = {
      id: params.ministryId,
      ministry_id: params.ministryId,
      subscription_mode: 'paid',
      plan_id: params.planId,
      billing_interval: params.interval,
      member_addon_blocks: params.addonBlocks || 0,
      current_period_start: `${params.currentPeriodStart}T00:00:00.000Z`,
      current_period_end: `${params.currentPeriodEnd}T00:00:00.000Z`,
      current_period_start_billing_date: params.currentPeriodStart,
      current_period_end_billing_date: params.currentPeriodEnd,
      status: 'active',
      access_mode: 'normal',
    };
    appSubscriptionsStore.set(params.ministryId, appSub);

    const customer: BillingCustomerRecord = {
      id: `${params.ministryId}_asaas`,
      ministry_id: params.ministryId,
      provider: 'asaas',
      provider_customer_id: cusId,
      created_at: `${params.currentPeriodStart}T00:00:00.000Z`,
      updated_at: `${params.currentPeriodStart}T00:00:00.000Z`,
    };
    customersStore.set(`${params.ministryId}_asaas`, customer);

    return { billingSub, appSub, customer };
  };

  // ===========================================================================
  // 1. HAPPY PATH MATRIX (6 TRANSIÇÕES PAID -> PAID)
  // ===========================================================================
  describe('1. Happy Path Matrix (6 Transições Paid -> Paid)', () => {
    const testTransitions = [
      {
        name: '1.1 Upgrade de plano: Lite -> Essential (Monthly)',
        source: { planId: 'lite' as const, interval: 'monthly' as const, addonBlocks: 0, amountCents: 1490 },
        target: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 0, expectedRecurringCents: calculatePlanPriceCents('essential', 'monthly', 0).totalPriceCents, asaasCycle: 'MONTHLY' },
      },
      {
        name: '1.2 Mudança de intervalo: Essential Monthly -> Essential Annual',
        source: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 0, amountCents: 3490 },
        target: { planId: 'essential' as const, interval: 'annual' as const, addonBlocks: 0, expectedRecurringCents: calculatePlanPriceCents('essential', 'annual', 0).totalPriceCents, asaasCycle: 'YEARLY' },
      },
      {
        name: '1.3 Downgrade de plano: Pro -> Essential (Monthly)',
        source: { planId: 'pro' as const, interval: 'monthly' as const, addonBlocks: 0, amountCents: 6490 },
        target: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 0, expectedRecurringCents: calculatePlanPriceCents('essential', 'monthly', 0).totalPriceCents, asaasCycle: 'MONTHLY' },
      },
      {
        name: '1.4 Addon increase: Essential (0 addons) -> Essential (2 addons)',
        source: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 0, amountCents: 3490 },
        target: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 2, expectedRecurringCents: calculatePlanPriceCents('essential', 'monthly', 2).totalPriceCents, asaasCycle: 'MONTHLY' },
      },
      {
        name: '1.5 Addon decrease: Essential (3 addons) -> Essential (1 addon)',
        source: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 3, amountCents: calculatePlanPriceCents('essential', 'monthly', 3).totalPriceCents },
        target: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 1, expectedRecurringCents: calculatePlanPriceCents('essential', 'monthly', 1).totalPriceCents, asaasCycle: 'MONTHLY' },
      },
      {
        name: '1.6 Mudança híbrida: Essential Monthly (1 addon) -> Pro Annual (2 addons)',
        source: { planId: 'essential' as const, interval: 'monthly' as const, addonBlocks: 1, amountCents: calculatePlanPriceCents('essential', 'monthly', 1).totalPriceCents },
        target: { planId: 'pro' as const, interval: 'annual' as const, addonBlocks: 2, expectedRecurringCents: calculatePlanPriceCents('pro', 'annual', 2).totalPriceCents, asaasCycle: 'YEARLY' },
      },
    ];

    for (const tCase of testTransitions) {
      it(tCase.name, async () => {
        const ministryId = `min_${Math.random().toString(36).substring(2, 7)}`;
        const currentPeriodStart = '2026-09-02';
        const currentPeriodEnd = '2026-10-02';
        const sourceSubId = `sub_src_${ministryId}`;
        const canonicalCusId = `cus_can_${ministryId}`;

        setupActivePaidContract({
          ministryId,
          planId: tCase.source.planId,
          interval: tCase.source.interval,
          addonBlocks: tCase.source.addonBlocks,
          amountCents: tCase.source.amountCents,
          currentPeriodStart,
          currentPeriodEnd,
          providerSubId: sourceSubId,
          providerCustomerId: canonicalCusId,
        });

        // Step 1: Criar Checkout no LouvAIO
        const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
          planId: tCase.target.planId,
          interval: tCase.target.interval,
          addonBlocks: tCase.target.addonBlocks,
        });

        expect(checkoutResult.checkoutUrl).toBeDefined();
        expect(checkoutResult.checkoutId).toBeDefined();
        expect(checkoutResult.totalPriceCents).toBe(tCase.target.expectedRecurringCents);

        // Validar parâmetros enviados ao gateway
        expect(mockProvider.createCheckout).toHaveBeenCalledWith(
          expect.objectContaining({
            ministryId,
            providerCustomerId: canonicalCusId,
            planId: tCase.target.planId,
            interval: tCase.target.interval,
            addonBlocks: tCase.target.addonBlocks,
            amountCents: tCase.target.expectedRecurringCents,
            nextDueDate: currentPeriodEnd, // Data efetiva exata!
          })
        );

        // Validar transição V1 criada e slot retido
        const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
        expect(slot).not.toBeNull();
        expect(slot.plan_change_id).toBeDefined();

        const tr = (await mockBillingRepo.getPlanChange(slot.plan_change_id)) as BillingTransitionV1Record;
        expect(isBillingTransitionV1(tr)).toBe(true);
        expect(tr.execution_strategy).toBe('scheduled_paid_transition');
        expect(tr.transition_status).toBe('pending_future_authorization');
        expect(tr.financial_safety_status).toBe('live');
        expect(tr.current_period_start_billing_date).toBe(currentPeriodStart);
        expect(tr.current_period_end_billing_date).toBe(currentPeriodEnd);
        expect(tr.effective_billing_date).toBe(currentPeriodEnd);
        expect(tr.target_future_recurring_price_cents).toBe(tCase.target.expectedRecurringCents);
        expect(tr.checkout_attempts).toHaveLength(1);
        expect(tr.checkout_attempts?.[0]?.attempt_type).toBe('future_authorization');
        expect(tr.checkout_attempts?.[0]?.provider_checkout_id).toBe(checkoutResult.checkoutId);

        // Step 2: Simular webhook do Asaas (CHECKOUT_PAID / SUBSCRIPTION_CREATED)
        const targetSubId = `sub_tgt_${ministryId}`;
        const targetPaymentId = `pay_tgt_${ministryId}`;

        mockProvider.getSubscription.mockResolvedValue({
          id: targetSubId,
          customer: canonicalCusId,
          cycle: tCase.target.asaasCycle,
          value: tCase.target.expectedRecurringCents / 100,
          status: 'ACTIVE',
          nextDueDate: currentPeriodEnd,
        });

        const paymentRecord = {
          id: targetPaymentId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: tCase.target.expectedRecurringCents,
          dueDate: currentPeriodEnd,
          status: 'PENDING',
          billingType: 'CREDIT_CARD',
        };
        mockProvider.listSubscriptionPayments.mockResolvedValue([paymentRecord]);
        mockProvider.listPayments.mockResolvedValue([paymentRecord]);

        const webhookEvent: ParsedWebhookEvent = {
          providerEventId: `evt_${Date.now()}`,
          rawEventType: 'CHECKOUT_PAID',
          eventType: 'checkout_paid',
          providerCheckoutId: checkoutResult.checkoutId,
          providerSubscriptionId: targetSubId,
          providerCustomerId: canonicalCusId,
          status: 'PENDING',
        };

        mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

        const webhookResult = await billingService.handleWebhook(
          { 'asaas-access-token': 'valid_token' },
          {}
        );

        expect(webhookResult.status).toBe('ok');
        expect(webhookResult.processed).toBe(true);

        // Step 3: Validar que a transição avançou para future_target_prepared
        const updatedTr = (await mockBillingRepo.getPlanChange(tr.id)) as BillingTransitionV1Record;
        expect(updatedTr.transition_status).toBe('future_target_prepared');
        expect(updatedTr.future_provider_checkout_id).toBe(checkoutResult.checkoutId);
        expect(updatedTr.future_provider_subscription_id).toBe(targetSubId);
        expect(updatedTr.future_provider_payment_id).toBe(targetPaymentId);
        expect(updatedTr.target_ready_verified_at).toBeDefined();

        // O slot de transição NÃO pode ter sido liberado nem marcado como safe_terminal!
        const slotAfterReady = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
        expect(slotAfterReady).not.toBeNull();
        expect(slotAfterReady?.plan_change_id).toBe(tr.id);
        expect(updatedTr.financial_safety_status).toBe('live');

        // Nenhuma transação paga foi criada para o pagamento futuro PENDING
        expect(mockBillingRepo.saveTransaction).not.toHaveBeenCalled();

        // Assinatura de origem no app permanece inalterada
        const sourceSubDoc = await mockBillingRepo.getSubscription(ministryId);
        expect(sourceSubDoc.plan_id).toBe(tCase.source.planId);
        expect(sourceSubDoc.provider_subscription_id).toBe(sourceSubId);
        expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      });
    }
  });

  // ===========================================================================
  // 2. TARGET READY FAILURE MATRIX
  // ===========================================================================
  describe('2. Target Ready Failure Matrix & Gate Verification', () => {
    const baseMinistryId = 'min_gate_test';
    const effectiveBillingDate = '2026-10-02';
    const canonicalCusId = 'cus_canonical_123';
    const expectedCents = 3490;
    const targetSubId = 'sub_target_123';
    const targetPayId = 'pay_target_123';

    let transitionRecord: BillingTransitionV1Record;

    beforeEach(() => {
      setupActivePaidContract({
        ministryId: baseMinistryId,
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
        providerCustomerId: canonicalCusId,
      });

      transitionRecord = {
        id: 'tr_gate_test',
        transition_id: 'tr_gate_test',
        ministry_id: baseMinistryId,
        provider: 'asaas',
        policy_version: 'billing_transition_v1',
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'pending_future_authorization',
        financial_safety_status: 'live',
        source_plan_id: 'lite',
        source_interval: 'monthly',
        source_addon_blocks: 0,
        source_current_period_start_billing_date: '2026-09-02',
        source_current_period_end_billing_date: effectiveBillingDate,
        target_plan_id: 'essential',
        target_interval: 'monthly',
        target_addon_blocks: 0,
        effective_billing_date: effectiveBillingDate,
        target_future_recurring_price_cents: expectedCents,
        provider_customer_id: canonicalCusId,
        future_provider_checkout_id: 'chk_future_123',
        future_checkout_intent_id: 'intent_future_123',
        checkout_attempts: [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_gate_test',
            attempt_type: 'future_authorization',
            internal_checkout_intent_id: 'intent_future_123',
            provider_checkout_id: 'chk_future_123',
            amount_cents: expectedCents,
            currency: 'BRL',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
    });

    it('2.1 Customer divergente -> falha gate CUSTOMER_MISMATCH', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: 'cus_wrong_impostor',
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: 'cus_wrong_impostor',
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('CUSTOMER_MISMATCH');
    });

    it('2.2 Provider subscription ID mismatch no checkout attempt -> falha CHECKOUT_CORRELATION_FAILED', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
        checkoutSessionId: 'chk_unrelated_session',
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('CHECKOUT_CORRELATION_FAILED');
    });

    it('2.3 Cycle divergente -> falha CYCLE_MISMATCH', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'annual', // Esperado monthly
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('CYCLE_MISMATCH');
    });

    it('2.4 Recurring value divergente -> falha AMOUNT_MISMATCH', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: 9990, // Divergente de 3490
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('AMOUNT_MISMATCH');
    });

    it('2.5 First payment não visível -> PAYMENT_NOT_YET_VISIBLE (estado recuperável)', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: null, // Ainda não visível
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('PAYMENT_NOT_YET_VISIBLE');
    });

    it('2.6 First payment com subscription diferente -> falha PAYMENT_SUBSCRIPTION_MISMATCH', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: 'sub_another_rogue_sub',
          amountCents: expectedCents,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('PAYMENT_SUBSCRIPTION_MISMATCH');
    });

    it('2.7 First payment com amount divergente -> falha PAYMENT_AMOUNT_MISMATCH', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: 1000, // Divergente
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('PAYMENT_AMOUNT_MISMATCH');
    });

    it('2.8 First payment com dueDate != effective_billing_date -> falha DUE_DATE_MISMATCH', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: '2026-11-15', // Divergente da data civil esperada
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('DUE_DATE_MISMATCH');
    });

    it('2.9 First payment com status inválido (ex: REFUNDED) -> falha PAYMENT_STATUS_INVALID', () => {
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: effectiveBillingDate,
          status: 'REFUNDED',
        },
      });

      expect(result.ready).toBe(false);
      expect(result.failureCode).toBe('PAYMENT_STATUS_INVALID');
    });

    it('2.10 Subscription nextDueDate desacoplada (avança para ciclo seguinte mas payment.dueDate bate com effective_billing_date) -> GATE DEVE PASSAR COM SUCESSO', () => {
      // Comportamento real do Asaas: ao materializar a cobrança da primeira data civil,
      // a subscription.nextDueDate avança para o ciclo subsequente (2026-11-02).
      const result = verifyPaidToPaidTargetReadyGate({
        transition: transitionRecord,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'monthly',
        subscriptionValueCents: expectedCents,
        subscriptionNextDueDate: '2026-11-02', // Ciclo seguinte! Desacoplada!
        firstPayment: {
          id: targetPayId,
          customerId: canonicalCusId,
          subscriptionId: targetSubId,
          amountCents: expectedCents,
          dueDate: effectiveBillingDate, // 2026-10-02 exato!
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(true);
    });

    it('2.11 Desacoplamento de nextDueDate: aprova target anual quando payment.dueDate === effective_billing_date e subscription.nextDueDate avançou para o ano seguinte', () => {
      const annualTransition: BillingTransitionV1Record = {
        ...transitionRecord,
        target_interval: 'annual',
        target_future_recurring_price_cents: 37692, // Essential annual: R$ 34,90 * 12 * 0.9 = 376,92
      };

      const result = verifyPaidToPaidTargetReadyGate({
        transition: annualTransition,
        targetCustomerId: canonicalCusId,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: 'annual',
        subscriptionValueCents: 37692,
        subscriptionStatus: 'ACTIVE',
        subscriptionNextDueDate: '2027-10-02', // No Asaas, avançou +1 ano para o ciclo seguinte!
        firstPayment: {
          id: targetPayId,
          subscriptionId: targetSubId,
          customerId: canonicalCusId,
          amountCents: 37692,
          dueDate: effectiveBillingDate, // 2026-10-02 exato!
          status: 'PENDING',
        },
      });

      expect(result.ready).toBe(true);
    });
  });

  // ===========================================================================
  // 3. MATERIALIZAÇÃO TEMPORÁRIA / RACE CONDITION
  // ===========================================================================
  describe('3. Materialização Temporária / Race Condition', () => {
    it('mantém pending_future_authorization seguro quando webhook chega mas payment ainda não está visível', async () => {
      const ministryId = 'min_race_test';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot.plan_change_id;

      // Gateway retorna a subscription, mas listPayments ainda retorna lista vazia
      const targetSubId = 'sub_race_target';
      mockProvider.getSubscription.mockResolvedValue({
        id: targetSubId,
        customer: `cus_${ministryId}`,
        cycle: 'MONTHLY',
        value: 34.9,
        status: 'ACTIVE',
        nextDueDate: effectiveBillingDate,
      });
      mockProvider.listSubscriptionPayments.mockResolvedValue([]);
      mockProvider.listPayments.mockResolvedValue([]); // Pagamento ainda não propagou no gateway

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_race_1',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: checkoutResult.checkoutId,
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
        status: 'PENDING',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const result = await billingService.handleWebhook(
        { 'asaas-access-token': 'valid_token' },
        {}
      );

      // Retorna ok mas com processed: false e reason: PAYMENT_NOT_YET_VISIBLE
      expect(result.status).toBe('ok');
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('PAYMENT_NOT_YET_VISIBLE');

      // Transição permanece segura em pending_future_authorization
      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('pending_future_authorization');
      expect(tr.future_provider_subscription_id).toBe(targetSubId);

      // Webhook posterior (ou reconciler) encontra o pagamento materializado
      const targetPaymentId = 'pay_race_target';
      const racePayment = {
        id: targetPaymentId,
        customerId: `cus_${ministryId}`,
        subscriptionId: targetSubId,
        amountCents: 3490,
        status: 'PENDING',
        dueDate: effectiveBillingDate,
        billingType: 'CREDIT_CARD',
      };
      mockProvider.listSubscriptionPayments.mockResolvedValue([racePayment]);
      mockProvider.listPayments.mockResolvedValue([racePayment]);

      const secondWebhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_race_2',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: checkoutResult.checkoutId,
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
        status: 'PENDING',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(secondWebhookEvent);

      const secondResult = await billingService.handleWebhook(
        { 'asaas-access-token': 'valid_token' },
        {}
      );

      expect(secondResult.status).toBe('ok');
      expect(secondResult.processed).toBe(true);

      const updatedTr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(updatedTr.transition_status).toBe('future_target_prepared');
      expect(updatedTr.future_provider_payment_id).toBe(targetPaymentId);
    });

    it('recupera materialização fora de ordem (SUBSCRIPTION_CREATED antes de CHECKOUT_PAID) e não regride com evento atrasado', async () => {
      const ministryId = 'min_out_of_order_test';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot.plan_change_id;
      const targetSubId = 'sub_ooo_target';

      // 1. SUBSCRIPTION_CREATED chega primeiro do gateway
      mockProvider.getSubscription.mockResolvedValue({
        id: targetSubId,
        customer: `cus_${ministryId}`,
        cycle: 'MONTHLY',
        value: 34.9,
        status: 'ACTIVE',
        nextDueDate: effectiveBillingDate,
      });
      // Pagamento ainda não foi gerado/visível no momento exato do SUBSCRIPTION_CREATED
      mockProvider.listSubscriptionPayments.mockResolvedValue([]);
      mockProvider.listPayments.mockResolvedValue([]);

      const subCreatedEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_ooo_sub_created',
        rawEventType: 'SUBSCRIPTION_CREATED',
        eventType: 'subscription_created',
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(subCreatedEvent);

      const res1 = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(res1.status).toBe('ok');
      expect(res1.processed).toBe(false);
      expect(res1.reason).toBe('PAYMENT_NOT_YET_VISIBLE');

      const trAfterEvent1 = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(trAfterEvent1.transition_status).toBe('pending_future_authorization');
      expect(trAfterEvent1.future_provider_subscription_id).toBe(targetSubId);

      // 2. Agora o pagamento se materializa e chega CHECKOUT_PAID
      const firstPayId = 'pay_ooo_1';
      const payRecord = {
        id: firstPayId,
        customerId: `cus_${ministryId}`,
        subscriptionId: targetSubId,
        amountCents: 3490,
        status: 'PENDING',
        dueDate: effectiveBillingDate,
        billingType: 'CREDIT_CARD',
      };
      mockProvider.listSubscriptionPayments.mockResolvedValue([payRecord]);
      mockProvider.listPayments.mockResolvedValue([payRecord]);

      const checkoutPaidEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_ooo_checkout_paid',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: checkoutResult.checkoutId,
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
        status: 'PENDING',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(checkoutPaidEvent);

      const res2 = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(res2.status).toBe('ok');
      expect(res2.processed).toBe(true);

      const trAfterEvent2 = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(trAfterEvent2.transition_status).toBe('future_target_prepared');
      expect(trAfterEvent2.future_provider_payment_id).toBe(firstPayId);

      // 3. Evento atrasado/repetido chega após future_target_prepared: NÃO regride status
      const delayedEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_ooo_delayed_sub_updated',
        rawEventType: 'SUBSCRIPTION_UPDATED',
        eventType: 'subscription_updated',
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(delayedEvent);

      const res3 = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(res3.status).toBe('ok');
      expect(res3.processed).toBe(true);
      expect(res3.reason).toBe('already_future_target_prepared');

      const trAfterEvent3 = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(trAfterEvent3.transition_status).toBe('future_target_prepared');
    });
  });

  // ===========================================================================
  // 4. CRIAÇÃO DE CHECKOUT, CONTRATO DOCUMENTADO & RECONCILER (TESTES A-F)
  // ===========================================================================
  describe('4. Criação de Checkout, Contrato Documentado & Reconciler (A-F)', () => {
    it('A/C. Successful create returns checkout ID -> stored write-once -> recovery by payments checkoutSession -> Target Ready', async () => {
      const ministryId = 'min_test_a_c';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slot).not.toBeNull();
      const trId = slot.plan_change_id;

      // Confere persistência write-once do checkout ID
      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.future_provider_checkout_id).toBe(checkoutResult.checkoutId);
      expect(tr.transition_status).toBe('pending_future_authorization');

      // Provedor retorna cobrança vinculada via GET /v3/payments?checkoutSession=<checkoutId>
      const targetSubId = 'sub_target_session_ac';
      const targetPayId = 'pay_target_session_ac';
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
        {
          id: targetPayId,
          subscriptionId: targetSubId,
          customerId: `cus_${ministryId}`,
          amountCents: 3490,
          status: 'PENDING',
          dueDate: effectiveBillingDate,
          billingType: 'CREDIT_CARD',
        },
      ]);
      mockProvider.getSubscription.mockResolvedValue({
        id: targetSubId,
        customer: `cus_${ministryId}`,
        cycle: 'MONTHLY',
        value: 34.9,
        status: 'ACTIVE',
        nextDueDate: effectiveBillingDate,
      });

      const reconciled = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_test');
      expect(reconciled.success).toBe(true);

      const finalTr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(finalTr.transition_status).toBe('future_target_prepared');
      expect(finalTr.financial_attention_required).toBe(false);
      expect(finalTr.future_provider_subscription_id).toBe(targetSubId);
      expect(finalTr.future_provider_payment_id).toBe(targetPayId);

      // Slot permanece HELD
      const slotStillHeld = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotStillHeld).not.toBeNull();
    });

    it('B. Known checkout -> zero payments -> recoverable (checkout_pending_user_action)', async () => {
      const ministryId = 'min_test_b';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot.plan_change_id;

      // Sessão de checkout conhecida, mas nenhuma cobrança materializada ainda (usuário não pagou)
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      const result = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_test');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('checkout_pending_user_action');

      // Transição permanece pending e slot permanece mantido
      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('pending_future_authorization');

      const slotStillHeld = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotStillHeld).not.toBeNull();
    });

    it('D. Known checkout -> ambiguity (múltiplas subscriptions em cobranças da sessão) -> fail closed (AMBIGUOUS_TARGET_RESOURCES)', async () => {
      const ministryId = 'min_test_d';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot.plan_change_id;

      // Provedor retorna cobranças apontando para duas assinaturas distintas na mesma sessão
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
        {
          id: 'pay_ambig_1',
          subscriptionId: 'sub_ambig_1',
          amountCents: 3490,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
        {
          id: 'pay_ambig_2',
          subscriptionId: 'sub_ambig_2',
          amountCents: 3490,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
        },
      ]);

      const result = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_test');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('AMBIGUOUS_TARGET_RESOURCES');

      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('pending_future_authorization');
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('AMBIGUOUS_TARGET_RESOURCES');
      expect(tr.financial_safety_status).toBe('attention_required');

      // Slot permanece mantido
      const slotStillHeld = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotStillHeld).not.toBeNull();
    });

    it('E. Uncertain create without checkout ID -> NO provider lookup by invented endpoint -> no blind retry -> slot held -> attention remains', async () => {
      const ministryId = 'min_test_e';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      mockProvider.createCheckout.mockRejectedValueOnce(new Error('Gateway timeout / ECONNRESET'));
      mockProvider.classifyErrorOutcome.mockReturnValueOnce('OUTCOME_UNCERTAIN');

      await expect(
        billingService.createCheckout(ministryId, 'usr_admin', {
          planId: 'essential',
          interval: 'monthly',
        })
      ).rejects.toThrow('Gateway timeout / ECONNRESET');

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slot).not.toBeNull();
      const trId = slot.plan_change_id;

      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('pending_future_authorization');
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_safety_status).toBe('attention_required');
      expect(tr.future_provider_checkout_id).toBeUndefined();

      // Limpar chamadas prévias do mockProvider para provar que nenhum endpoint inventado é chamado
      mockProvider.listPaymentsByCheckoutSession.mockClear();

      const result = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_test');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('uncertain_create_awaiting_webhook_or_manual_resolution');

      // Nenhuma busca inventada por externalReference ocorreu
      expect(mockProvider.listPaymentsByCheckoutSession).not.toHaveBeenCalled();

      // Atenção financeira permanece, slot permanece HELD, assinatura antiga intacta
      const trAfter = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(trAfter.transition_status).toBe('pending_future_authorization');
      expect(trAfter.financial_attention_required).toBe(true);
      expect(trAfter.financial_safety_status).toBe('attention_required');

      const slotStillHeld = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotStillHeld).not.toBeNull();
    });

    it('F. Later real CHECKOUT event supplies correlated checkout ID -> attempt recovers -> documented payment lookup -> Target Ready', async () => {
      const ministryId = 'min_test_f';
      const effectiveBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      // Criação incerta inicial (sem checkout ID retornado)
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('Gateway timeout'));
      mockProvider.classifyErrorOutcome.mockReturnValueOnce('OUTCOME_UNCERTAIN');

      await expect(
        billingService.createCheckout(ministryId, 'usr_admin', {
          planId: 'essential',
          interval: 'monthly',
        })
      ).rejects.toThrow();

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot.plan_change_id;
      const initialTr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      const checkoutIntentId = initialTr.future_checkout_intent_id!;

      // Mais tarde, o Asaas envia um webhook real com o checkoutId e externalReference correlacionado
      const realCheckoutId = 'chk_webhook_recovered_999';
      const realSubId = 'sub_webhook_recovered_999';
      const realPayId = 'pay_webhook_recovered_999';

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
        {
          id: realPayId,
          subscriptionId: realSubId,
          customerId: `cus_${ministryId}`,
          amountCents: 3490,
          status: 'PENDING',
          dueDate: effectiveBillingDate,
          billingType: 'CREDIT_CARD',
          externalReference: checkoutIntentId,
        },
      ]);
      mockProvider.getSubscription.mockResolvedValue({
        id: realSubId,
        customer: `cus_${ministryId}`,
        cycle: 'MONTHLY',
        value: 34.9,
        status: 'ACTIVE',
        nextDueDate: effectiveBillingDate,
      });

      const checkoutWebhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_recovery_checkout_paid',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: realCheckoutId,
        externalReference: checkoutIntentId,
        providerCustomerId: `cus_${ministryId}`,
        status: 'PENDING',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(checkoutWebhookEvent);

      const webhookResult = await billingService.handleWebhook(
        { 'asaas-access-token': 'valid_token' },
        {}
      );

      expect(webhookResult.status).toBe('ok');
      expect(webhookResult.processed).toBe(true);

      const finalTr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(finalTr.transition_status).toBe('future_target_prepared');
      expect(finalTr.future_provider_checkout_id).toBe(realCheckoutId);
      expect(finalTr.future_provider_subscription_id).toBe(realSubId);
      expect(finalTr.future_provider_payment_id).toBe(realPayId);
      expect(finalTr.financial_attention_required).toBe(false); // Limpo com prova real!
      expect(finalTr.financial_attention_reason).toBeNull();
      expect(finalTr.financial_safety_status).toBe('live');

      // Slot permanece HELD
      const slotStillHeld = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotStillHeld).not.toBeNull();
    });
  });

  // ===========================================================================
  // 5. ZERO MUTATIONS NA ASSINATURA ANTIGA
  // ===========================================================================
  describe('5. Zero Mutations na Assinatura Antiga', () => {
    it('garante que a assinatura antiga não sofre nenhuma mutação nem cancelamento', async () => {
      const ministryId = 'min_zero_mut_test';
      const effectiveBillingDate = '2026-10-02';
      const sourceSubId = 'sub_active_source_999';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
        providerSubId: sourceSubId,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'pro',
        interval: 'annual',
      });

      const targetSubId = 'sub_target_annual_999';
      mockProvider.getSubscription.mockResolvedValue({
        id: targetSubId,
        customer: `cus_${ministryId}`,
        cycle: 'YEARLY',
        value: 649.0,
        status: 'ACTIVE',
        nextDueDate: effectiveBillingDate,
      });
      const annualPayment = {
        id: 'pay_target_annual_999',
        customerId: `cus_${ministryId}`,
        subscriptionId: targetSubId,
        amountCents: 64900,
        status: 'PENDING',
        dueDate: effectiveBillingDate,
        billingType: 'CREDIT_CARD',
      };
      mockProvider.listSubscriptionPayments.mockResolvedValue([annualPayment]);
      mockProvider.listPayments.mockResolvedValue([annualPayment]);

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_zero_mut',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: checkoutResult.checkoutId,
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
        status: 'PENDING',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      await billingService.handleWebhook(
        { 'asaas-access-token': 'valid_token' },
        {}
      );

      // Asserções estritas:
      const currentSub = await mockBillingRepo.getSubscription(ministryId);
      expect(currentSub.plan_id).toBe('lite');
      expect(currentSub.interval).toBe('monthly');
      expect(currentSub.amount_cents).toBe(1490);
      expect(currentSub.status).toBe('active');
      expect(currentSub.provider_subscription_id).toBe(sourceSubId);
      expect(currentSub.cancel_at_period_end).toBe(false);

      // Nenhuma chamada a provedor para inativar / deletar pagamentos da source
      expect((mockProvider as any).inactivateSubscription).toBeUndefined();
      expect((mockProvider as any).deletePayment).toBeUndefined();
    });
  });

  // ===========================================================================
  // 6. ZERO EARLY ACTIVATIONS
  // ===========================================================================
  describe('6. Zero Early Activations', () => {
    it('garante que nenhum entitlement é alterado e nenhuma transação financeira é criada', async () => {
      const ministryId = 'min_zero_ea_test';
      const effectiveBillingDate = '2026-10-02';

      const { appSub } = setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: effectiveBillingDate,
      });

      const checkoutResult = await billingService.createCheckout(ministryId, 'usr_admin', {
        planId: 'pro',
        interval: 'monthly',
        addonBlocks: 3,
      });

      const targetSubId = 'sub_target_pro_3addons';
      mockProvider.getSubscription.mockResolvedValue({
        id: targetSubId,
        customer: `cus_${ministryId}`,
        cycle: 'MONTHLY',
        value: 64.9 + 3 * 9.9,
        status: 'ACTIVE',
        nextDueDate: effectiveBillingDate,
      });
      const proPayment = {
        id: 'pay_target_pro_3addons',
        customerId: `cus_${ministryId}`,
        subscriptionId: targetSubId,
        amountCents: 6490 + 3 * 990,
        status: 'PENDING',
        dueDate: effectiveBillingDate,
        billingType: 'CREDIT_CARD',
      };
      mockProvider.listSubscriptionPayments.mockResolvedValue([proPayment]);
      mockProvider.listPayments.mockResolvedValue([proPayment]);

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_zero_ea',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: checkoutResult.checkoutId,
        providerSubscriptionId: targetSubId,
        providerCustomerId: `cus_${ministryId}`,
        status: 'PENDING',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      await billingService.handleWebhook(
        { 'asaas-access-token': 'valid_token' },
        {}
      );

      // Validar que o SubscriptionService NÃO promoveu entitlement:
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      expect(mockSubscriptionService.changeMemberAddonBlocks).not.toHaveBeenCalled();

      // App subscription permanece idêntica à origem
      const currentAppSub = await mockSubscriptionRepo.getSubscription(ministryId);
      expect(currentAppSub.plan_id).toBe('lite');
      expect(currentAppSub.member_addon_blocks).toBe(0);
      expect(currentAppSub.access_mode).toBe('normal');

      // Nenhuma BillingTransaction foi registrada
      expect(transactionsStore.size).toBe(0);
      expect(mockBillingRepo.saveTransaction).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 8. COMMERCIAL DATES PERSISTENCE AT CREATION (AUDIT INVARIANT)
  // ===========================================================================
  describe('8. Commercial Dates Persistence at Creation (Audit Invariant)', () => {
    it('8.1 Transição Monthly: persiste start, end e effective imediatamente na criação sem update posterior', async () => {
      const ministryId = 'min_comm_dates_monthly';
      const startBillingDate = '2026-09-02';
      const endBillingDate = '2026-10-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 1490,
        currentPeriodStart: startBillingDate,
        currentPeriodEnd: endBillingDate,
      });

      const res = await billingService.createCheckout(ministryId, 'user_test', {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 0,
      });

      expect(res.checkoutUrl).toBeDefined();

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slot).not.toBeNull();
      expect(slot!.plan_change_id).toBeDefined();

      const tr = (await mockBillingRepo.getPlanChange(slot!.plan_change_id)) as BillingTransitionV1Record;
      expect(isBillingTransitionV1(tr)).toBe(true);

      // INVARIANTES ESTRITAS DE DATA COMERCIAL PERSISTIDAS NO INSERT:
      expect(tr.current_period_start_billing_date).toBe('2026-09-02');
      expect(tr.current_period_end_billing_date).toBe('2026-10-02');
      expect(tr.effective_billing_date).toBe('2026-10-02');
      expect(tr.effective_billing_date).toBe(tr.current_period_end_billing_date);
      expect(tr.transition_status).toBe('pending_future_authorization');
      expect(tr.financial_safety_status).toBe('live');
    });

    it('8.2 Transição Annual: persiste start, end e effective imediatamente na criação sem update posterior', async () => {
      const ministryId = 'min_comm_dates_annual';
      const startBillingDate = '2026-09-02';
      const endBillingDate = '2027-09-02';

      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'annual',
        addonBlocks: 0,
        amountCents: 14900,
        currentPeriodStart: startBillingDate,
        currentPeriodEnd: endBillingDate,
      });

      const res = await billingService.createCheckout(ministryId, 'user_test', {
        planId: 'essential',
        interval: 'annual',
        addonBlocks: 0,
      });

      expect(res.checkoutUrl).toBeDefined();

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slot).not.toBeNull();
      expect(slot!.plan_change_id).toBeDefined();

      const tr = (await mockBillingRepo.getPlanChange(slot!.plan_change_id)) as BillingTransitionV1Record;
      expect(isBillingTransitionV1(tr)).toBe(true);

      // INVARIANTES ESTRITAS ANUAIS:
      expect(tr.current_period_start_billing_date).toBe('2026-09-02');
      expect(tr.current_period_end_billing_date).toBe('2027-09-02');
      expect(tr.effective_billing_date).toBe('2027-09-02');
      expect(tr.effective_billing_date).toBe(tr.current_period_end_billing_date);
      expect(tr.transition_status).toBe('pending_future_authorization');
      expect(tr.financial_safety_status).toBe('live');
    });
  });

  // ===========================================================================
  // 9. CANCELLATION SEMANTICS & STALE/DUPLICATE SAFETY (PHASE 3B SEMANTIC PATCH)
  // ===========================================================================
  describe('9. Cancellation Semantics & Stale/Duplicate Safety (Phase 3B Semantic Patch)', () => {
    it('9.1 A) Current future_authorization checkout canceled sem target obligation -> transition canceled, safe_terminal, slot released', async () => {
      const ministryId = 'min_cancel_test_1';
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: '2026-10-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slotBefore = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotBefore).not.toBeNull();

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: `evt_cancel_${Date.now()}`,
        rawEventType: 'CHECKOUT_CANCELED',
        eventType: 'checkout_canceled',
        providerCheckoutId: res.checkoutId,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const handleRes = await billingService.handleWebhook(
        { 'asaas-access-token': 'valid_token' },
        {}
      );
      expect(handleRes.processed).toBe(true);

      const tr = (await mockBillingRepo.getPlanChange(slotBefore!.plan_change_id)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('canceled');
      expect(tr.status).toBe('canceled');
      expect(tr.financial_safety_status).toBe('safe_terminal');
      expect(tr.financial_attention_required).toBe(false);

      const slotAfter = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotAfter).toBeNull();
    });

    it('9.2 B) Duplicate CHECKOUT_CANCELED -> idempotente, não altera estado terminal nem regride', async () => {
      const ministryId = 'min_cancel_dup';
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: '2026-10-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: `evt_cancel_1`,
        rawEventType: 'CHECKOUT_CANCELED',
        eventType: 'checkout_canceled',
        providerCheckoutId: res.checkoutId,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      // Primeiro evento
      await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      const trAfter1 = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(trAfter1.transition_status).toBe('canceled');

      // Segundo evento idêntico (duplicado)
      const webhookEventDup: ParsedWebhookEvent = {
        providerEventId: `evt_cancel_2`,
        rawEventType: 'CHECKOUT_CANCELED',
        eventType: 'checkout_canceled',
        providerCheckoutId: res.checkoutId,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEventDup);

      const dupRes = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(dupRes.processed).toBe(true);

      const trAfter2 = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(trAfter2.transition_status).toBe('canceled');
      expect(trAfter2.financial_safety_status).toBe('safe_terminal');
    });

    it('9.3 C) Stale CHECKOUT_CANCELED from older attempt -> transição atual e slot permanecem pendentes', async () => {
      const ministryId = 'min_cancel_stale';
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: '2026-10-02',
      });

      // Attempt 1 criada
      mockProvider.createCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/chk_old',
        checkoutId: 'chk_old',
        expiresAt: '2026-09-02T20:00:00Z',
      });
      await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      // Simular re-tentativa / nova attempt criada na mesma transição
      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      tr.current_future_checkout_attempt_id = 'att_new_2';
      tr.checkout_attempts = [
        {
          attempt_id: 'att_old_1',
          transition_id: trId,
          attempt_type: 'future_authorization',
          internal_checkout_intent_id: 'intent_1',
          provider_checkout_id: 'chk_old',
          amount_cents: 3490,
          currency: 'BRL',
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        {
          attempt_id: 'att_new_2',
          transition_id: trId,
          attempt_type: 'future_authorization',
          internal_checkout_intent_id: 'intent_2',
          provider_checkout_id: 'chk_new',
          amount_cents: 3490,
          currency: 'BRL',
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ];
      await mockBillingRepo.updateTransition(trId, ministryId, tr as any);

      // Evento de cancelamento chega para a tentativa antiga (chk_old)
      const staleEvent: ParsedWebhookEvent = {
        providerEventId: `evt_stale_cancel`,
        rawEventType: 'CHECKOUT_CANCELED',
        eventType: 'checkout_canceled',
        providerCheckoutId: 'chk_old',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(staleEvent);

      const resStale = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(resStale.processed).toBe(true);

      // Transição deve continuar pending_future_authorization e slot deve permanecer retido!
      const currentTr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(currentTr.transition_status).toBe('pending_future_authorization');
      expect(currentTr.financial_safety_status).toBe('live');

      const currentSlot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(currentSlot).not.toBeNull();
      expect(currentSlot!.plan_change_id).toBe(trId);
    });

    it('9.4 D) CHECKOUT_CANCELED depois de Target Ready -> não desfaz target válida, transição e slot preservados', async () => {
      const ministryId = 'min_cancel_after_ready';
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: '2026-10-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      // Avançar para future_target_prepared com target resources válidos
      await mockBillingRepo.updateTransition(trId, ministryId, {
        transition_status: 'future_target_prepared',
        future_provider_subscription_id: 'sub_tgt_valid',
        future_provider_payment_id: 'pay_tgt_valid',
      });

      // Evento tardio de cancelamento do checkout chega após a target já estar preparada
      const lateCancelEvent: ParsedWebhookEvent = {
        providerEventId: `evt_late_cancel`,
        rawEventType: 'CHECKOUT_CANCELED',
        eventType: 'checkout_canceled',
        providerCheckoutId: res.checkoutId,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(lateCancelEvent);

      const resLate = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(resLate.processed).toBe(true);

      // Transição NÃO regride, target resources preservados, slot retido!
      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('future_target_prepared');
      expect(tr.future_provider_subscription_id).toBe('sub_tgt_valid');

      const slotCheck = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotCheck).not.toBeNull();
      expect(slotCheck!.plan_change_id).toBe(trId);
    });

    it('9.5 E) Real failure path (checkout expirado sem pagamento) -> continua failed com safe_terminal e slot liberado', async () => {
      const ministryId = 'min_expired_fail';
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-09-02',
        currentPeriodEnd: '2026-10-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      const expiredEvent: ParsedWebhookEvent = {
        providerEventId: `evt_expired_fail`,
        rawEventType: 'CHECKOUT_EXPIRED',
        eventType: 'checkout_expired',
        providerCheckoutId: res.checkoutId,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(expiredEvent);

      const resExpired = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(resExpired.processed).toBe(true);

      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('failed');
      expect(tr.status).toBe('failed');
      expect(tr.financial_safety_status).toBe('safe_terminal');

      const slotCheck = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotCheck).toBeNull();
    });
  });

  // ===========================================================================
  // 10. PHASE 3B.3 SANDBOX BUGFIX: SAME-DAY SETTLED FIRST PAYMENT & QUERY SEMANTICS
  // ===========================================================================
  describe('10. Phase 3B.3 Sandbox Bugfix: Same-Day Settled First Payment & Query Semantics', () => {
    it('10.1 Target Ready PASS quando primeira cobrança alvo já nasce CONFIRMED no checkout', async () => {
      const ministryId = 'min_sameday_confirmed';
      const cusId = `cus_${ministryId}`;
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-08-02',
        currentPeriodEnd: '2026-09-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      // Mock de primeira cobrança já CONFIRMED
      const confirmedPayment: ProviderPaymentRecord = {
        id: 'pay_target_confirmed',
        subscriptionId: 'sub_target_conf',
        customerId: cusId,
        status: 'CONFIRMED',
        dueDate: '2026-09-02',
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
      };

      mockProvider.getSubscription.mockResolvedValue({
        status: 'ACTIVE',
        cycle: 'MONTHLY',
        valueCents: 3490,
        nextDueDate: '2026-10-02',
        customer: cusId,
      });
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([confirmedPayment]);
      mockProvider.listSubscriptionPayments.mockResolvedValue([confirmedPayment]);

      const reconcileResult = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_1');
      expect(reconcileResult.success).toBe(true);

      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('future_target_prepared');
      expect(tr.future_provider_payment_id).toBe('pay_target_confirmed');

      // Slot permanece HELD
      const slotCheck = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      expect(slotCheck).not.toBeNull();
      expect(slotCheck!.plan_change_id).toBe(trId);

      // Entitlement runtime ainda não foi promovido
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it('10.2 Target Ready PASS quando primeira cobrança alvo já nasce RECEIVED', async () => {
      const ministryId = 'min_sameday_received';
      const cusId = `cus_${ministryId}`;
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-08-02',
        currentPeriodEnd: '2026-09-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      const receivedPayment: ProviderPaymentRecord = {
        id: 'pay_target_received',
        subscriptionId: 'sub_target_rec',
        customerId: cusId,
        status: 'RECEIVED',
        dueDate: '2026-09-02',
        originalDueDate: '2026-09-02',
        amountCents: 3490,
        billingType: 'PIX',
      };

      mockProvider.getSubscription.mockResolvedValue({
        status: 'ACTIVE',
        cycle: 'MONTHLY',
        valueCents: 3490,
        nextDueDate: '2026-10-02',
        customer: cusId,
      });
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([receivedPayment]);
      mockProvider.listSubscriptionPayments.mockResolvedValue([receivedPayment]);

      const reconcileResult = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_1');
      expect(reconcileResult.success).toBe(true);

      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('future_target_prepared');
      expect(tr.future_provider_payment_id).toBe('pay_target_received');
    });

    it('10.3 Second-Cycle Protection: ignora cobrança do segundo ciclo e elege a primeira boundary exata', async () => {
      const ministryId = 'min_second_cycle';
      const cusId = `cus_${ministryId}`;
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-08-02',
        currentPeriodEnd: '2026-09-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const slot = await mockBillingRepo.getActiveTransitionSlot(ministryId, 'asaas');
      const trId = slot!.plan_change_id;

      const firstCyclePayment: ProviderPaymentRecord = {
        id: 'pay_cycle_1',
        subscriptionId: 'sub_target_sc',
        customerId: cusId,
        status: 'CONFIRMED',
        dueDate: '2026-09-02',
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
      };
      const secondCyclePayment: ProviderPaymentRecord = {
        id: 'pay_cycle_2',
        subscriptionId: 'sub_target_sc',
        customerId: cusId,
        status: 'PENDING',
        dueDate: '2026-10-02', // 2o ciclo
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
      };

      mockProvider.getSubscription.mockResolvedValue({
        status: 'ACTIVE',
        cycle: 'MONTHLY',
        valueCents: 3490,
        nextDueDate: '2026-10-02',
        customer: cusId,
      });
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([secondCyclePayment, firstCyclePayment]);
      mockProvider.listSubscriptionPayments.mockResolvedValue([secondCyclePayment, firstCyclePayment]);

      const reconcileResult = await billingService.reconcilePaidToPaidFutureAuthorization(trId, 'worker_1');
      expect(reconcileResult.success).toBe(true);

      const tr = (await mockBillingRepo.getPlanChange(trId)) as BillingTransitionV1Record;
      expect(tr.future_provider_payment_id).toBe('pay_cycle_1'); // Exatamente o primeiro ciclo
    });

    it('10.4 Webhook Fast Path: parsedEvent.providerPaymentId consulta diretamente via getPayment', async () => {
      const ministryId = 'min_fast_path';
      const cusId = `cus_${ministryId}`;
      setupActivePaidContract({
        ministryId,
        planId: 'lite',
        interval: 'monthly',
        amountCents: 1490,
        currentPeriodStart: '2026-08-02',
        currentPeriodEnd: '2026-09-02',
      });

      const res = await billingService.createCheckout(ministryId, 'usr_test', {
        planId: 'essential',
        interval: 'monthly',
      });

      const exactPayment: ProviderPaymentRecord = {
        id: 'pay_exact_webhook',
        subscriptionId: 'sub_target_fp',
        customerId: cusId,
        status: 'CONFIRMED',
        dueDate: '2026-09-02',
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
      };

      (mockProvider as any).getPayment = vi.fn().mockResolvedValue(exactPayment);
      mockProvider.getSubscription.mockResolvedValue({
        status: 'ACTIVE',
        cycle: 'MONTHLY',
        valueCents: 3490,
        nextDueDate: '2026-10-02',
        customer: cusId,
      });

      const paymentEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_pay_conf_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: res.checkoutId,
        providerPaymentId: 'pay_exact_webhook',
        providerSubscriptionId: 'sub_target_fp',
        amountCents: 3490,
        dueDate: '2026-09-02',
        status: 'CONFIRMED',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(paymentEvent);

      const webhookRes = await billingService.handleWebhook({ 'asaas-access-token': 'valid_token' }, {});
      expect(webhookRes.processed).toBe(true);

      expect((mockProvider as any).getPayment).toHaveBeenCalledWith('pay_exact_webhook');
    });
  });
});
