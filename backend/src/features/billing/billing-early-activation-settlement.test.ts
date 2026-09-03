import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from './billing.service.js';
import {
  BillingTransitionV1Record,
  BillingCheckoutAttempt,
  BillingActiveTransitionSlotRecord,
  BillingSubscriptionRecord,
  BillingCustomerRecord,
  BillingTransactionRecord,
} from './billing.types.js';
import { AppError } from '../../middleware/error-handler.js';
import { config } from '../../config/unifiedConfig.js';
import { getBillingDate } from '../../utils/billing-date.js';

describe('Phase 3C.4 — Early Activation Adjustment Settlement & Entitlement Convergence', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;
  let mockProvider: any;

  const planChangesStore = new Map<string, BillingTransitionV1Record>();
  const activeSlotsStore = new Map<string, BillingActiveTransitionSlotRecord>();
  const subscriptionsStore = new Map<string, BillingSubscriptionRecord>();
  const customersStore = new Map<string, BillingCustomerRecord>();
  const appSubscriptionsStore = new Map<string, any>();
  const transactionsStore = new Map<string, BillingTransactionRecord>();

  const getBaseScheduledTransition = (): BillingTransitionV1Record => ({
    id: 'tr_scheduled_early_001',
    transition_id: 'tr_scheduled_early_001',
    policy_version: 'billing_transition_v1',
    ministry_id: 'min_test_1',
    provider: 'asaas',
    currency: 'BRL',
    execution_strategy: 'scheduled_paid_transition',
    transition_status: 'scheduled',
    early_activation_status: 'payment_pending',
    financial_safety_status: 'live',
    transition_type: 'upgrade',
    status: 'pending',
    provider_customer_id: 'cus_test_1',
    source_plan_id: 'lite',
    source_interval: 'monthly',
    source_addon_blocks: 0,
    source_current_cycle_total_cents: 1490,
    source_entitlement_snapshot: {
      plan_id: 'lite',
      addon_blocks: 0,
      interval: 'monthly',
      effective_member_quota: 5,
      effective_song_quota: 50,
    },
    current_period_start: '2026-09-02T00:00:00.000Z',
    current_period_end: '2026-10-02T00:00:00.000Z',
    current_period_start_billing_date: '2026-09-02',
    current_period_end_billing_date: '2026-10-02',
    effective_billing_date: '2026-10-02',
    target_plan_id: 'essential',
    target_interval: 'monthly',
    target_addon_blocks: 0,
    target_current_cycle_total_cents: 3490,
    target_future_recurring_price_cents: 3490,
    target_entitlement_snapshot: {
      plan_id: 'essential',
      addon_blocks: 0,
      interval: 'monthly',
      effective_member_quota: 15,
      effective_song_quota: 200,
    },
    requested_plan_id: 'essential',
    requested_interval: 'monthly',
    requested_addon_blocks: 0,
    expected_amount_cents: 3490,
    requested_commercial_date: '2026-09-02',
    price_locked_at: '2026-09-02T10:00:00.000Z',
    requested_at: '2026-09-02T10:00:00.000Z',
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    expires_at: null,
    old_provider_subscription_id: 'sub_source_old',
    previous_provider_subscription_id: 'sub_source_old',
    supersede_status: 'completed',
    payment_cleanup_status: 'completed',
    future_provider_subscription_id: 'sub_target_new',
    new_provider_subscription_id: 'sub_target_new',
    future_provider_payment_id: 'pay_target_renewal_001',
    future_provider_checkout_id: 'chk_future_001',
    // Early activation quote and checkout state
    early_activation_checkout_intent_id: 'intent_adj_001',
    early_activation_provider_checkout_id: 'chk_adj_001',
    current_early_activation_checkout_attempt_id: 'att_adj_001',
    current_early_activation_quote: {
      quote_id: 'quote_adj_001',
      transition_id: 'tr_scheduled_early_001',
      ministry_id: 'min_test_1',
      source_current_cycle_total_cents: 1490,
      target_current_cycle_total_cents: 3490,
      price_delta_cents: 2000,
      total_days: 30,
      remaining_days: 20,
      prorated_adjustment_cents: 1333,
      currency: 'BRL',
      priced_at: '2026-09-12T10:00:00.000Z',
      quote_effective_billing_date: '2026-10-02',
      expires_at: '2026-09-12T10:30:00.000Z',
      status: 'consumed',
    },
    prorated_adjustment_cents: 1333,
    checkout_attempts: [
      {
        attempt_id: 'att_adj_001',
        transition_id: 'tr_scheduled_early_001',
        attempt_type: 'early_activation',
        internal_checkout_intent_id: 'intent_adj_001',
        provider_checkout_id: 'chk_adj_001',
        checkout_url: 'https://sandbox.asaas.com/c/chk_adj_001',
        quote_id: 'quote_adj_001',
        amount_cents: 1333,
        currency: 'BRL',
        status: 'pending',
        provider_create_state: 'created',
        provider_session_terminal: false,
        created_at: '2026-09-12T10:05:00.000Z',
        checkout_requested_at: '2026-09-12T10:05:00.000Z',
      },
    ],
  });

  beforeEach(() => {
    planChangesStore.clear();
    activeSlotsStore.clear();
    subscriptionsStore.clear();
    customersStore.clear();
    appSubscriptionsStore.clear();
    transactionsStore.clear();

    const initialTransition = getBaseScheduledTransition();
    planChangesStore.set(initialTransition.id, initialTransition);

    activeSlotsStore.set('slot_min_test_1_asaas', {
      id: 'slot_min_test_1_asaas',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      plan_change_id: initialTransition.id,
      acquired_at: initialTransition.created_at,
      updated_at: initialTransition.created_at,
      version: 1,
    });

    appSubscriptionsStore.set('min_test_1', {
      ministry_id: 'min_test_1',
      plan_id: 'lite',
      member_addon_blocks: 0,
      billing_interval: 'monthly',
      billing_status: 'active',
      subscription_mode: 'paid',
      current_period_start: '2026-09-02T00:00:00.000Z',
      current_period_end: '2026-10-02T00:00:00.000Z',
      locked_member_quota: 5,
      locked_song_quota: 50,
      entitlement_snapshot: {
        plan_id: 'lite',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 5,
        effective_song_quota: 50,
      },
    });

    mockBillingRepo = {
      getPlanChange: vi.fn(async (id: string) => {
        const found = planChangesStore.get(id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }),
      getTransitionById: vi.fn(async (id: string, ministryId?: string) => {
        const found = planChangesStore.get(id);
        if (!found) return null;
        if (ministryId && found.ministry_id !== ministryId) return null;
        return JSON.parse(JSON.stringify(found));
      }),
      getPlanChangeByCheckoutIntentId: vi.fn(async (intentId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.early_activation_checkout_intent_id === intentId) {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getTransitionByEarlyActivationCheckoutIntentId: vi.fn(async (intentId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.early_activation_checkout_intent_id === intentId) {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getPlanChangeByCheckoutId: vi.fn(async (chkId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.early_activation_provider_checkout_id === chkId) {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getTransitionByEarlyActivationProviderCheckoutId: vi.fn(async (chkId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.early_activation_provider_checkout_id === chkId) {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getTransitionByEarlyActivationPaymentId: vi.fn(async (payId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.early_activation_provider_payment_id === payId) {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getTransitionByFuturePaymentId: vi.fn(async (payId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.future_provider_payment_id === payId) {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getSubscriptionByCheckoutIntentId: vi.fn(async () => null),
      getSubscriptionByCheckoutId: vi.fn(async () => null),
      getSubscriptionByProviderSubscriptionId: vi.fn(async () => null),
      getCustomerByProviderId: vi.fn(async () => null),
      getSubscription: vi.fn(async () => null),
      getActiveTransitionSlot: vi.fn(async (ministryId: string) => {
        return activeSlotsStore.get(`slot_${ministryId}_asaas`) || null;
      }),
      updateTransition: vi.fn(async (id: string, ministryId: string, patch: any) => {
        const current = planChangesStore.get(id);
        if (!current) throw new AppError(404, 'Transition not found');
        const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      recordEarlyAdjustmentFinancialSettlement: vi.fn(async (params: any) => {
        const { transitionId, ministryId, providerPaymentId, paidBillingDate, settledAt, attemptId, nowIso } = params;
        const current = planChangesStore.get(transitionId);
        if (!current) throw new AppError(404, 'Transition not found');
        if (
          current.early_activation_provider_payment_id &&
          current.early_activation_provider_payment_id !== providerPaymentId
        ) {
          throw new AppError(409, 'Payment ID conflict', { code: 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT' });
        }
        const attempts = current.checkout_attempts ? [...current.checkout_attempts] : [];
        const attIdx = attempts.findIndex((a) => a.attempt_id === (attemptId || current.current_early_activation_checkout_attempt_id));
        if (attIdx >= 0) {
          attempts[attIdx] = {
            ...attempts[attIdx],
            provider_payment_id: providerPaymentId,
            paid_at: settledAt,
            provider_session_terminal: true,
          };
        }
        const updated: BillingTransitionV1Record = {
          ...current,
          early_activation_provider_payment_id: providerPaymentId,
          successful_early_adjustment_provider_payment_id: providerPaymentId,
          early_activation_payment_settled_at: settledAt,
          early_adjustment_paid_billing_date: paidBillingDate,
          checkout_attempts: attempts,
          updated_at: nowIso || new Date().toISOString(),
        };
        planChangesStore.set(transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      confirmEarlyActivationEntitlement: vi.fn(async (params: any) => {
        const { transitionId, ministryId, providerPaymentId, attemptId, nowIso } = params;
        const current = planChangesStore.get(transitionId);
        if (!current) throw new AppError(404, 'Transition not found');
        const attempts = current.checkout_attempts ? [...current.checkout_attempts] : [];
        const attIdx = attempts.findIndex((a) => a.attempt_id === (attemptId || current.current_early_activation_checkout_attempt_id));
        if (attIdx >= 0) {
          attempts[attIdx] = {
            ...attempts[attIdx],
            status: 'completed',
            completed_at: nowIso,
            provider_session_terminal: true,
          };
        }
        const updated: BillingTransitionV1Record = {
          ...current,
          early_activation_status: 'activated',
          early_activation_activated_at: nowIso || new Date().toISOString(),
          early_activation_confirmed_at: nowIso || new Date().toISOString(),
          early_activation_provider_payment_id: providerPaymentId,
          successful_early_adjustment_provider_payment_id: providerPaymentId,
          checkout_attempts: attempts,
          transition_status: 'scheduled',
          financial_safety_status: 'live',
          updated_at: nowIso || new Date().toISOString(),
        };
        planChangesStore.set(transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      saveTransaction: vi.fn(async (tx: BillingTransactionRecord) => {
        const existing = transactionsStore.get(tx.id);
        if (existing) {
          if (
            existing.amount_cents !== undefined &&
            tx.amount_cents !== undefined &&
            existing.amount_cents !== tx.amount_cents
          ) {
            throw new AppError(409, 'Amount conflict', { code: 'CONFLICTING_FINANCIAL_AMOUNT' });
          }
          if (
            existing.paid_billing_date &&
            tx.paid_billing_date &&
            existing.paid_billing_date !== tx.paid_billing_date
          ) {
            throw new AppError(409, 'Date conflict', { code: 'CONFLICTING_FINANCIAL_DATE' });
          }
          const merged = { ...existing, ...tx };
          transactionsStore.set(tx.id, merged);
          return merged;
        }
        transactionsStore.set(tx.id, tx);
        return tx;
      }),
      getTransaction: vi.fn(async (providerOrId: string, paymentId?: string) => {
        const key = paymentId ? `${providerOrId}_${paymentId}` : providerOrId;
        return transactionsStore.get(key) || null;
      }),
      releaseSlotIfOwnedAndSafe: vi.fn(async () => ({ released: true })),
      markWebhookEventProcessed: vi.fn(async () => true),
      setSubscription: vi.fn(async (sub: any) => {
        subscriptionsStore.set(sub.ministry_id, sub);
        return sub;
      }),
      enterScheduledPaidTransitionGrace: vi.fn(async (params: any) => {
        const { transitionId, graceStartBillingDate, graceEndBillingDate, graceEntitlementSnapshot, startedAt } = params;
        const current = planChangesStore.get(transitionId);
        if (current) {
          const updated = {
            ...current,
            grace_status: 'in_grace',
            grace_start_billing_date: graceStartBillingDate,
            grace_end_billing_date: graceEndBillingDate,
            grace_entitlement_snapshot: graceEntitlementSnapshot,
            grace_started_at: startedAt,
          };
          planChangesStore.set(transitionId, updated as any);
          return updated;
        }
      }),
      confirmRenewalActivation: vi.fn(async (params: any) => {
        const { transitionId, completedAt } = params;
        const current = planChangesStore.get(transitionId);
        if (current) {
          const updated = {
            ...current,
            transition_status: 'completed',
            financial_safety_status: 'safe_terminal',
            completed_at: completedAt,
          };
          planChangesStore.set(transitionId, updated as any);
          return updated;
        }
      }),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn(async (ministryId: string) => {
        const sub = appSubscriptionsStore.get(ministryId);
        return sub ? JSON.parse(JSON.stringify(sub)) : null;
      }),
      setSubscription: vi.fn(async (sub: any) => {
        appSubscriptionsStore.set(sub.ministry_id, JSON.parse(JSON.stringify(sub)));
      }),
    };

    mockSubscriptionService = {
      applyLockedEntitlementSnapshot: vi.fn(async (ministryId: string, snapshot: any) => {
        const current = appSubscriptionsStore.get(ministryId);
        if (current) {
          current.plan_id = snapshot.plan_id;
          current.member_addon_blocks = snapshot.addon_blocks;
          current.locked_member_quota = snapshot.effective_member_quota;
          current.locked_song_quota = snapshot.effective_song_quota;
          current.entitlement_snapshot = snapshot;
        }
      }),
      changePlan: vi.fn(),
      changeMemberAddonBlocks: vi.fn(),
    };

    mockMinistryRepo = {
      getById: vi.fn(async (id: string) => ({ id, name: 'Ministry 1' })),
    };
    mockUserRepo = {
      getById: vi.fn(async (id: string) => ({ id, email: 'admin@test.com' })),
    };

    mockProvider = {
      name: 'asaas',
      getPayment: vi.fn(async (paymentId: string) => {
        return {
          id: paymentId,
          status: 'CONFIRMED',
          amountCents: 1333,
          dueDate: '2026-09-12',
          confirmedDate: '2026-09-12T10:15:00.000Z',
          checkoutSession: 'chk_adj_001',
          billingType: 'CREDIT_CARD',
          invoiceUrl: 'https://sandbox.asaas.com/i/inv_001',
        };
      }),
      listPaymentsByCheckoutSession: vi.fn(async (sessionId: string) => {
        return [
          {
            id: 'pay_adj_settled_001',
            status: 'CONFIRMED',
            amountCents: 1333,
            dueDate: '2026-09-12',
            confirmedDate: '2026-09-12T10:15:00.000Z',
            checkoutSession: sessionId,
          },
        ];
      }),
      listSubscriptionPayments: vi.fn(async () => [
        {
          id: 'pay_target_renewal_001',
          status: 'CONFIRMED',
          amountCents: 3490,
          dueDate: '2026-10-02',
          confirmedDate: '2026-10-02T08:00:00.000Z',
          subscription: 'sub_target_new',
        },
      ]),
      refundPayment: vi.fn(async () => ({ success: true })),
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

  // 1 & 2. Exact detached adjustment payment confirms -> target entitlement active early & immediate runtime convergence
  it('1 & 2. exact detached adjustment payment confirms -> target entitlement active early immediately', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_001',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.status).toBe('ok');
    expect(res.processed).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');

    // Runtime subscription promotes immediately to essential
    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.plan_id).toBe('essential');
    expect(appSub.locked_member_quota).toBe(15);
    expect(appSub.locked_song_quota).toBe(200);

    // Transition record is updated to activated
    const updatedTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(updatedTr.early_activation_status).toBe('activated');
    expect(updatedTr.early_activation_provider_payment_id).toBe('pay_adj_settled_001');
  });

  // 3 & 4. Source current commercial period start and end unchanged
  it('3 & 4. source current commercial period start and end remain strictly unchanged', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_002',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.current_period_start).toBe('2026-09-02T00:00:00.000Z');
    expect(appSub.current_period_end).toBe('2026-10-02T00:00:00.000Z');
  });

  // 5, 6 & 7. Effective billing date unchanged, future recurring payment and subscription untouched
  it('5, 6 & 7. effective billing date unchanged; future recurring payment and subscription untouched', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_003',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.effective_billing_date).toBe('2026-10-02');
    expect(tr.future_provider_payment_id).toBe('pay_target_renewal_001');
    expect(tr.future_provider_subscription_id).toBe('sub_target_new');
    expect(tr.early_activation_provider_payment_id).toBe('pay_adj_settled_001');
  });

  // 8. Old source subscription not revived
  it('8. old source subscription is not revived', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_004',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.old_provider_subscription_id).toBe('sub_source_old');
    expect(tr.supersede_status).toBe('completed');
  });

  // 9 & 10. Canonical BillingTransaction created with type prorated_early_activation_adjustment with quote_id and attempt_id
  it('9 & 10. canonical BillingTransaction created with type prorated_early_activation_adjustment with quote_id and attempt_id', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_005',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const tx = await mockBillingRepo.getTransaction('asaas', 'pay_adj_settled_001');
    expect(tx).toBeDefined();
    expect(tx.transaction_type).toBe('prorated_early_activation_adjustment');
    expect(tx.quote_id).toBe('quote_adj_001');
    expect(tx.attempt_id).toBe('att_adj_001');
    expect(tx.amount_cents).toBe(1333);
    expect(tx.status).toBe('paid');
  });

  // 11. Two distinct BillingTransactions when early adjustment settles + renewal settles later
  it('11. creates two distinct BillingTransactions when early adjustment settles and renewal settles later', async () => {
    // 1. Early adjustment settles on 2026-09-12
    const adjEvent = {
      providerEventId: 'evt_adj_conf_006',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      adjEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    // 2. Later at boundary (2026-10-02), renewal payment settles
    const freshTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    const renewalEvent = {
      providerEventId: 'evt_renewal_conf_001',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_target_renewal_001',
      providerSubscriptionId: 'sub_target_new',
      amountCents: 3490,
      status: 'CONFIRMED',
      confirmedDate: '2026-10-02T08:00:00.000Z',
    };

    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_target_renewal_001',
      status: 'CONFIRMED',
      amountCents: 3490,
      dueDate: '2026-10-02',
      confirmedDate: '2026-10-02T08:00:00.000Z',
      subscription: 'sub_target_new',
    });

    await (billingService as any).handleV1PaidToPaidWebhook(
      renewalEvent,
      freshTr,
      new Date('2026-10-02T08:00:00.000Z')
    );

    const adjTx = await mockBillingRepo.getTransaction('asaas', 'pay_adj_settled_001');
    const renewalTx = await mockBillingRepo.getTransaction('asaas', 'pay_target_renewal_001');

    expect(adjTx).toBeDefined();
    expect(adjTx.transaction_type).toBe('prorated_early_activation_adjustment');

    expect(renewalTx).toBeDefined();
    expect(renewalTx.transaction_type).toBe('recurring_payment');
  });

  // 12. Duplicate PAYMENT_CONFIRMED webhook is idempotent and produces zero extra transactions
  it('12. duplicate PAYMENT_CONFIRMED is idempotent and produces zero extra transactions', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_007',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    // First arrival
    const res1 = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );
    expect(res1.reason).toBe('early_activation_settled_and_promoted');

    const freshTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');

    // Duplicate arrival
    const res2 = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      freshTr,
      new Date('2026-09-12T10:16:00.000Z')
    );
    expect(res2.status).toBe('ok');
    expect(res2.processed).toBe(true);
    expect(res2.reason).toBe('already_activated');
    expect(transactionsStore.size).toBe(1);
  });

  // 13. Out of order PAYMENT_RECEIVED after CONFIRMED is terminal ok with zero duplicate mutations
  it('13. out of order PAYMENT_RECEIVED after CONFIRMED is terminal ok with zero duplicate mutations', async () => {
    const confEvent = {
      providerEventId: 'evt_adj_conf_008',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      confEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const freshTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');

    const recvEvent = {
      providerEventId: 'evt_adj_recv_008',
      eventType: 'payment_received' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      amountCents: 1333,
      status: 'RECEIVED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      recvEvent,
      freshTr,
      new Date('2026-09-12T10:16:00.000Z')
    );

    expect(res.status).toBe('ok');
    expect(res.processed).toBe(true);
    expect(res.reason).toBe('already_activated');
    expect(transactionsStore.size).toBe(1);
  });

  // 14. CHECKOUT_PAID event alone does not activate target entitlement without settled payment
  it('14. CHECKOUT_PAID event alone does not activate target entitlement without settled payment', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]);

    const checkoutPaidEvent = {
      providerEventId: 'evt_chk_paid_009',
      eventType: 'checkout_paid' as const,
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      checkoutPaidEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:10:00.000Z')
    );

    expect(res.status).toBe('ok');
    expect(res.processed).toBe(true);
    expect(res.reason).toBe('checkout_paid_awaiting_payment_confirmation');

    // Runtime entitlement has NOT been promoted yet
    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.plan_id).toBe('lite');

    // Transition early_activation_status remains payment_pending
    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.early_activation_status).toBe('payment_pending');
  });

  // 15. CHECKOUT_PAID followed by PAYMENT_CONFIRMED settles cleanly
  it('15. CHECKOUT_PAID followed by PAYMENT_CONFIRMED settles cleanly', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]);

    const checkoutPaidEvent = {
      providerEventId: 'evt_chk_paid_010',
      eventType: 'checkout_paid' as const,
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      checkoutPaidEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:10:00.000Z')
    );

    const intermediateTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');

    const confEvent = {
      providerEventId: 'evt_adj_conf_010',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      confEvent,
      intermediateTr,
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.reason).toBe('early_activation_settled_and_promoted');
    const finalAppSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(finalAppSub.plan_id).toBe('essential');
  });

  // 16. PAYMENT_CONFIRMED arriving before CHECKOUT_PAID settles cleanly and later CHECKOUT_PAID is no-op
  it('16. PAYMENT_CONFIRMED arriving before CHECKOUT_PAID settles cleanly and later CHECKOUT_PAID is no-op', async () => {
    const confEvent = {
      providerEventId: 'evt_adj_conf_011',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    const res1 = await (billingService as any).handleV1PaidToPaidWebhook(
      confEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );
    expect(res1.reason).toBe('early_activation_settled_and_promoted');

    const freshTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');

    const checkoutPaidEvent = {
      providerEventId: 'evt_chk_paid_011',
      eventType: 'checkout_paid' as const,
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
    };

    const res2 = await (billingService as any).handleV1PaidToPaidWebhook(
      checkoutPaidEvent,
      freshTr,
      new Date('2026-09-12T10:16:00.000Z')
    );
    expect(res2.reason).toBe('already_activated');
  });

  // 17. Payment amount mismatch fails closed into financial_attention_required and holds slot
  it('17. payment amount mismatch fails closed into financial_attention_required and holds slot', async () => {
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_adj_mismatch',
      status: 'CONFIRMED',
      amountCents: 999, // Mismatched (expected 1333)
      dueDate: '2026-09-12',
      confirmedDate: '2026-09-12T10:15:00.000Z',
      checkoutSession: 'chk_adj_001',
    });

    const webhookEvent = {
      providerEventId: 'evt_adj_mismatch_012',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_mismatch',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 999,
      status: 'CONFIRMED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_AMOUNT_MISMATCH');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_AMOUNT_MISMATCH');

    // Slot remains held
    const slot = await mockBillingRepo.getActiveTransitionSlot('min_test_1');
    expect(slot).toBeDefined();

    // Entitlement untouched
    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.plan_id).toBe('lite');
  });

  // 18. Payment checkoutSession mismatch fails closed into financial_attention_required
  it('18. payment checkoutSession mismatch fails closed into financial_attention_required', async () => {
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_adj_chk_mismatch',
      status: 'CONFIRMED',
      amountCents: 1333,
      dueDate: '2026-09-12',
      confirmedDate: '2026-09-12T10:15:00.000Z',
      checkoutSession: 'chk_DIFFERENT_SESSION',
    });

    const webhookEvent = {
      providerEventId: 'evt_adj_chk_mismatch_013',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_chk_mismatch',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_CHECKOUT_SESSION_MISMATCH');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_CHECKOUT_SESSION_MISMATCH');
  });

  // 19. Stale attempt payment settlement fails closed into financial_attention_required
  it('19. stale attempt payment settlement fails closed into financial_attention_required', async () => {
    const transitionWithStaleAttempt: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      current_early_activation_checkout_attempt_id: 'att_adj_002',
      checkout_attempts: [
        {
          attempt_id: 'att_adj_001_old',
          transition_id: 'tr_scheduled_early_001',
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_adj_001_old',
          provider_checkout_id: 'chk_adj_001_old',
          amount_cents: 1333,
          currency: 'BRL',
          status: 'expired',
          created_at: '2026-09-11T10:00:00.000Z',
        },
        {
          attempt_id: 'att_adj_002',
          transition_id: 'tr_scheduled_early_001',
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_adj_002',
          provider_checkout_id: 'chk_adj_002',
          amount_cents: 1333,
          currency: 'BRL',
          status: 'pending',
          created_at: '2026-09-12T10:00:00.000Z',
        },
      ],
    };
    planChangesStore.set(transitionWithStaleAttempt.id, transitionWithStaleAttempt);

    const webhookEvent = {
      providerEventId: 'evt_stale_att_014',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_stale_001',
      providerCheckoutId: 'chk_adj_001_old',
      externalReference: 'intent_adj_001_old',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      transitionWithStaleAttempt,
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');
  });

  // 20. Canceled/expired attempt payment settlement race fails closed into financial_attention_required
  it('20. canceled/expired attempt payment settlement race fails closed into financial_attention_required', async () => {
    const transitionWithCanceledAttempt: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      checkout_attempts: [
        {
          ...getBaseScheduledTransition().checkout_attempts![0],
          status: 'canceled',
        },
      ],
    };
    planChangesStore.set(transitionWithCanceledAttempt.id, transitionWithCanceledAttempt);

    const webhookEvent = {
      providerEventId: 'evt_canceled_att_015',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      transitionWithCanceledAttempt,
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT');
  });

  // 21. Cross-routing: future recurring payment does not trigger early adjustment settlement
  it('21. cross-routing: future recurring payment does not trigger early adjustment settlement', async () => {
    const renewalEvent = {
      providerEventId: 'evt_renewal_016',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_target_renewal_001', // Future recurring payment
      providerSubscriptionId: 'sub_target_new',
      amountCents: 3490,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-20T10:00:00.000Z',
    };

    const isEarly = (billingService as any).isEarlyActivationWebhookEvent(
      renewalEvent,
      getBaseScheduledTransition()
    );
    expect(isEarly).toBe(false);
  });

  // 22. Cross-routing: early adjustment payment does not trigger renewal settlement
  it('22. cross-routing: early adjustment payment does not trigger renewal settlement', async () => {
    const adjEvent = {
      providerEventId: 'evt_adj_017',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    const isEarly = (billingService as any).isEarlyActivationWebhookEvent(
      adjEvent,
      getBaseScheduledTransition()
    );
    expect(isEarly).toBe(true);
  });

  // 23 & 24. Transition status remains 'scheduled' after early activation settlement (does not advance to completed)
  it('23 & 24. transition status remains scheduled after early activation settlement (does not advance to completed)', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_018',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.transition_status).toBe('scheduled');
    expect(tr.financial_safety_status).toBe('live');
    expect(tr.early_activation_status).toBe('activated');
  });

  // 25. Slot remains HELD after early activation settlement
  it('25. slot remains HELD after early activation settlement', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_conf_019',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const slot = await mockBillingRepo.getActiveTransitionSlot('min_test_1');
    expect(slot).toBeDefined();
    expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
  });

  // 26 & 27. Grace scenario: target renewal payment fails at boundary -> grace enters with TARGET snapshot
  it('26 & 27. target renewal payment fails at boundary -> grace enters with TARGET snapshot, NOT source', async () => {
    // 1. Early adjustment settles first
    const adjEvent = {
      providerEventId: 'evt_adj_conf_020',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    await (billingService as any).handleV1PaidToPaidWebhook(
      adjEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    const freshTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');

    // 2. Renewal fails at boundary (2026-10-02)
    const overdueEvent = {
      providerEventId: 'evt_renewal_overdue_020',
      eventType: 'payment_overdue' as const,
      providerPaymentId: 'pay_target_renewal_001',
      providerSubscriptionId: 'sub_target_new',
      amountCents: 3490,
      status: 'OVERDUE',
    };

    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_target_renewal_001',
      status: 'OVERDUE',
      amountCents: 3490,
      dueDate: '2026-10-02',
      subscription: 'sub_target_new',
    });

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      overdueEvent,
      freshTr,
      new Date('2026-10-02T08:00:00.000Z')
    );

    expect(res.reason).toBe('grace_entered_unpaid');

    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.billing_status).toBe('past_due');
    expect(appSub.grace_period_expires_billing_date).toBe('2026-10-09');
    expect(appSub.plan_id).toBe('essential'); // Still Essential during grace!
  });

  // 28 & 29. Commercial boundary guard: early adjustment settling on or after boundary does not auto-activate
  it('28 & 29. commercial boundary guard: late settlement creates BillingTransaction but marks financial attention', async () => {
    // Current commercial date is 2026-10-02 (effective_billing_date is 2026-10-02)
    const lateWebhookEvent = {
      providerEventId: 'evt_adj_late_021',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-10-02T10:00:00.000Z',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      lateWebhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-10-02T10:00:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('LATE_EARLY_ADJUSTMENT_SETTLEMENT');

    // Canonical BillingTransaction is preserved
    const tx = await mockBillingRepo.getTransaction('asaas', 'pay_adj_settled_001');
    expect(tx).toBeDefined();

    // Financial attention marked
    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('LATE_EARLY_ADJUSTMENT_SETTLEMENT');

    // Target entitlement was NOT auto-promoted
    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.plan_id).toBe('lite');
  });

  // 30. Reversal before activation: REFUNDED adjustment blocks activation into financial attention
  it('30. reversal before activation: REFUNDED adjustment blocks activation into financial attention', async () => {
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_adj_refunded',
      status: 'REFUNDED',
      amountCents: 1333,
      dueDate: '2026-09-12',
      checkoutSession: 'chk_adj_001',
    });

    const webhookEvent = {
      providerEventId: 'evt_adj_ref_022',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_refunded',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'REFUNDED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('ADJUSTMENT_PAYMENT_REVERSED_REFUNDED');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_PAYMENT_REVERSED_REFUNDED');
  });

  // 31. Reversal before activation: CHARGEBACK adjustment blocks activation into financial attention
  it('31. reversal before activation: CHARGEBACK adjustment blocks activation into financial attention', async () => {
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_adj_chargeback',
      status: 'CHARGEBACK',
      amountCents: 1333,
      dueDate: '2026-09-12',
      checkoutSession: 'chk_adj_001',
    });

    const webhookEvent = {
      providerEventId: 'evt_adj_cb_023',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_chargeback',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CHARGEBACK',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('ADJUSTMENT_PAYMENT_REVERSED_CHARGEBACK');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_PAYMENT_REVERSED_CHARGEBACK');
  });

  // 32. Idempotency: exact same payment settled twice returns terminal ok
  it('32. exact same payment settled twice returns terminal ok', async () => {
    const webhookEvent = {
      providerEventId: 'evt_adj_idemp_024',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T10:15:00.000Z',
    };

    const res1 = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );
    expect(res1.reason).toBe('early_activation_settled_and_promoted');

    const freshTr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');

    const res2 = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      freshTr,
      new Date('2026-09-12T10:16:00.000Z')
    );
    expect(res2.status).toBe('ok');
    expect(res2.processed).toBe(true);
    expect(res2.reason).toBe('already_activated');
  });

  // 33. Conflicting provider payment ID for same early adjustment attempt fails closed (write-once)
  it('33. conflicting provider payment ID for same early adjustment attempt fails closed (write-once)', async () => {
    const transitionWithExistingPaymentId: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      early_activation_provider_payment_id: 'pay_first_written_001',
    };
    planChangesStore.set(transitionWithExistingPaymentId.id, transitionWithExistingPaymentId);

    const webhookEvent = {
      providerEventId: 'evt_conflict_pay_025',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_second_conflicting_002',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      transitionWithExistingPaymentId,
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT');

    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.financial_attention_required).toBe(true);
    expect(tr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT');
  });

  // 34. Expired quote TTL with pre-boundary settled payment settles cleanly because provider checkout was already created
  it('34. expired quote TTL with pre-boundary settled payment settles cleanly', async () => {
    const transitionWithExpiredQuote: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      current_early_activation_quote: {
        ...getBaseScheduledTransition().current_early_activation_quote!,
        expires_at: '2026-09-12T10:30:00.000Z',
      },
    };
    planChangesStore.set(transitionWithExpiredQuote.id, transitionWithExpiredQuote);

    // Payment arrives on 2026-09-13 (after quote TTL, but before renewal boundary 2026-10-02)
    const webhookEvent = {
      providerEventId: 'evt_adj_ttl_026',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-13T10:00:00.000Z',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      transitionWithExpiredQuote,
      new Date('2026-09-13T10:00:00.000Z')
    );

    expect(res.status).toBe('ok');
    expect(res.processed).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');

    const appSub = await mockSubscriptionRepo.getSubscription('min_test_1');
    expect(appSub.plan_id).toBe('essential');
  });

  // 35. Local Early Activation Completion Gate fails if app subscription cannot be promoted
  it('35. local Early Activation Completion Gate fails if app subscription cannot be promoted', async () => {
    mockSubscriptionRepo.getSubscription.mockResolvedValue({
      ministry_id: 'min_test_1',
      plan_id: 'lite', // Still lite despite promotion attempt
      billing_status: 'active',
    });

    const webhookEvent = {
      providerEventId: 'evt_gate_fail_027',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_adj_settled_001',
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      getBaseScheduledTransition(),
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('LOCAL_EARLY_ACTIVATION_COMPLETION_GATE_FAILED');

    // Early activation status is NOT confirmed
    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.early_activation_status).not.toBe('activated');
  });

  describe('Crash Matrix A-F, Webhook Monotonicity & Uncertain Create Recovery (Hardening)', () => {
    // 1. Crash A: exact adjustment payment financially settled -> crash before recordEarlyAdjustmentFinancialSettlement
    it('Crash A: payment settled -> crash before settlement evidence persisted -> clean recovery on redelivery', async () => {
      const webhookEvent = {
        providerEventId: 'evt_crash_a_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      // Simulação da 1ª execução falhando antes de recordEarlyAdjustmentFinancialSettlement
      mockBillingRepo.recordEarlyAdjustmentFinancialSettlement.mockRejectedValueOnce(
        new Error('Crash before recording financial settlement evidence')
      );

      await expect(
        (billingService as any).handleV1PaidToPaidWebhook(
          webhookEvent,
          getBaseScheduledTransition(),
          new Date('2026-09-12T10:15:00.000Z')
        )
      ).rejects.toThrow('Crash before recording financial settlement evidence');

      // Estado Parcial Pós-Crash A: nenhuma evidência gravada, slot permanece HELD
      const preTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(preTr.early_activation_status).toBe('payment_pending');
      expect(preTr.successful_early_adjustment_provider_payment_id).toBeUndefined();
      expect(preTr.transition_status).toBe('scheduled');
      expect(preTr.financial_safety_status).toBe('live');
      const slotPre = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slotPre).toBeDefined();
      expect(slotPre.plan_change_id).toBe('tr_scheduled_early_001');

      // 2ª Execução (Recovery / Redelivery)
      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        webhookEvent,
        getBaseScheduledTransition(),
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('early_activation_settled_and_promoted');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.successful_early_adjustment_provider_payment_id).toBe('pay_adj_settled_001');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slotPost = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slotPost).toBeDefined();
      expect(slotPost.plan_change_id).toBe('tr_scheduled_early_001');

      // Transaction criada exatamente uma vez
      expect(transactionsStore.size).toBe(1);
    });

    // 2. Crash B: settlement evidence persisted -> crash before BillingTransaction
    it('Crash B: settlement evidence persisted -> crash before BillingTransaction -> recovery creates tx exactly once', async () => {
      // Estado Parcial: recordEarlyAdjustmentFinancialSettlement já foi persistido
      const transitionWithSettledEvidence: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_payment_id: 'pay_adj_settled_001',
        successful_early_adjustment_provider_payment_id: 'pay_adj_settled_001',
        early_activation_payment_settled_at: '2026-09-12T10:15:00.000Z',
        early_adjustment_paid_billing_date: '2026-09-12',
      };
      planChangesStore.set(transitionWithSettledEvidence.id, transitionWithSettledEvidence);

      // Verificação de que nenhuma transação foi criada ainda
      expect(transactionsStore.size).toBe(0);

      const webhookEvent = {
        providerEventId: 'evt_crash_b_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        webhookEvent,
        transitionWithSettledEvidence,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('early_activation_settled_and_promoted');

      // Transação criada exatamente uma vez
      expect(transactionsStore.size).toBe(1);
      const tx = transactionsStore.get('asaas_pay_adj_settled_001');
      expect(tx).toBeDefined();
      expect(tx?.transaction_type).toBe('prorated_early_activation_adjustment');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot).toBeDefined();
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 3. Crash C: BillingTransaction persisted -> crash before applyLockedEntitlementSnapshot
    it('Crash C: BillingTransaction persisted -> crash before entitlement promotion -> recovery does not duplicate tx and promotes entitlement', async () => {
      // Estado Parcial: Evidence + Transaction já existem
      const transitionWithTx: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_payment_id: 'pay_adj_settled_001',
        successful_early_adjustment_provider_payment_id: 'pay_adj_settled_001',
        early_activation_payment_settled_at: '2026-09-12T10:15:00.000Z',
        early_adjustment_paid_billing_date: '2026-09-12',
      };
      planChangesStore.set(transitionWithTx.id, transitionWithTx);

      transactionsStore.set('asaas_pay_adj_settled_001', {
        id: 'asaas_pay_adj_settled_001',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_adj_settled_001',
        amount_cents: 1333,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-09-12',
        paid_billing_date: '2026-09-12',
        paid_at: '2026-09-12T10:15:00.000Z',
        payment_method: 'CREDIT_CARD',
        transaction_type: 'prorated_early_activation_adjustment',
        created_at: '2026-09-12T10:15:00.000Z',
        updated_at: '2026-09-12T10:15:00.000Z',
      });

      // AppSub ainda em Lite
      appSubscriptionsStore.set('min_test_1', {
        ministry_id: 'min_test_1',
        plan_id: 'lite',
        billing_status: 'active',
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
      });

      const webhookEvent = {
        providerEventId: 'evt_crash_c_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        webhookEvent,
        transitionWithTx,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('early_activation_settled_and_promoted');

      // Transação continua sendo apenas uma
      expect(transactionsStore.size).toBe(1);

      // Entitlement promovido para Essential
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');
      expect(appSub.current_period_start).toBe('2026-09-02T00:00:00.000Z');
      expect(appSub.current_period_end).toBe('2026-10-02T00:00:00.000Z');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot).toBeDefined();
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 4. Crash D: target entitlement applied -> crash before converging ministry_subscriptions
    it('Crash D: target entitlement applied -> crash before app subscription convergence -> recovery completes convergence', async () => {
      const webhookEvent = {
        providerEventId: 'evt_crash_d_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      // 1ª Execução falha durante a atualização de subscriptionRepo.setSubscription
      mockSubscriptionRepo.setSubscription.mockRejectedValueOnce(
        new Error('Crash before persisting app subscription update')
      );

      await expect(
        (billingService as any).handleV1PaidToPaidWebhook(
          webhookEvent,
          getBaseScheduledTransition(),
          new Date('2026-09-12T10:15:00.000Z')
        )
      ).rejects.toThrow('Crash before persisting app subscription update');

      // Slot permanece HELD após o crash
      const slotPre = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slotPre).toBeDefined();
      expect(slotPre.plan_change_id).toBe('tr_scheduled_early_001');

      // 2ª Execução (Recovery)
      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        webhookEvent,
        planChangesStore.get('tr_scheduled_early_001')!,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('early_activation_settled_and_promoted');

      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slotPost = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slotPost).toBeDefined();
      expect(slotPost.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 5. Crash E: app/ministry subscription already converged -> crash before confirmEarlyActivationEntitlement
    it('Crash E: app subscription converged -> crash before marking activated -> completion gate recognizes state and completes', async () => {
      // Estado Parcial: Evidence + Tx + AppSub já convergidos, mas early_activation_status ainda é payment_pending
      const transitionWithConvergedState: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_payment_id: 'pay_adj_settled_001',
        successful_early_adjustment_provider_payment_id: 'pay_adj_settled_001',
        early_activation_payment_settled_at: '2026-09-12T10:15:00.000Z',
        early_adjustment_paid_billing_date: '2026-09-12',
        early_activation_status: 'payment_pending',
      };
      planChangesStore.set(transitionWithConvergedState.id, transitionWithConvergedState);

      transactionsStore.set('asaas_pay_adj_settled_001', {
        id: 'asaas_pay_adj_settled_001',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_adj_settled_001',
        amount_cents: 1333,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-09-12',
        paid_billing_date: '2026-09-12',
        paid_at: '2026-09-12T10:15:00.000Z',
        payment_method: 'CREDIT_CARD',
        transaction_type: 'prorated_early_activation_adjustment',
        created_at: '2026-09-12T10:15:00.000Z',
        updated_at: '2026-09-12T10:15:00.000Z',
      });

      appSubscriptionsStore.set('min_test_1', {
        ministry_id: 'min_test_1',
        plan_id: 'essential',
        billing_status: 'active',
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
      });

      const webhookEvent = {
        providerEventId: 'evt_crash_e_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        webhookEvent,
        transitionWithConvergedState,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('early_activation_settled_and_promoted');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot).toBeDefined();
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');

      // Transações não foram duplicadas
      expect(transactionsStore.size).toBe(1);
    });

    // 6. Crash F: early_activation_status = activated -> duplicate execution is idempotent NO-OP
    it('Crash F: early_activation_status is activated -> duplicate webhook/re-execution is idempotent NO-OP', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_activated_at: '2026-09-12T10:15:00.000Z',
        early_activation_provider_payment_id: 'pay_adj_settled_001',
        successful_early_adjustment_provider_payment_id: 'pay_adj_settled_001',
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      transactionsStore.set('asaas_pay_adj_settled_001', {
        id: 'asaas_pay_adj_settled_001',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_adj_settled_001',
        amount_cents: 1333,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-09-12',
        paid_billing_date: '2026-09-12',
        paid_at: '2026-09-12T10:15:00.000Z',
        payment_method: 'CREDIT_CARD',
        transaction_type: 'prorated_early_activation_adjustment',
        created_at: '2026-09-12T10:15:00.000Z',
        updated_at: '2026-09-12T10:15:00.000Z',
      });

      const duplicateEvent = {
        providerEventId: 'evt_crash_f_dup_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        duplicateEvent,
        activatedTr,
        new Date('2026-09-12T10:16:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('already_activated');

      // Zero mutações
      expect(transactionsStore.size).toBe(1);
      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot).toBeDefined();
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 7. CHECKOUT_CREATED after activated
    it('7. CHECKOUT_CREATED arriving after activation is terminal idempotent NO-OP without regression', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_provider_payment_id: 'pay_adj_settled_001',
        early_activation_provider_checkout_id: 'chk_adj_001',
        checkout_attempts: [
          {
            ...getBaseScheduledTransition().checkout_attempts![0],
            status: 'completed',
          },
        ],
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      const lateCheckoutCreatedEvent = {
        providerEventId: 'evt_late_chk_created_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        lateCheckoutCreatedEvent,
        activatedTr,
        new Date('2026-09-12T10:20:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('already_activated');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.checkout_attempts![0].status).toBe('completed');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 8. CHECKOUT_PAID after activated
    it('8. CHECKOUT_PAID arriving after activation is terminal idempotent NO-OP without regression', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_provider_payment_id: 'pay_adj_settled_001',
        early_activation_provider_checkout_id: 'chk_adj_001',
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      const lateCheckoutPaidEvent = {
        providerEventId: 'evt_late_chk_paid_001',
        eventType: 'checkout_paid' as const,
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        lateCheckoutPaidEvent,
        activatedTr,
        new Date('2026-09-12T10:20:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('already_activated');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 9. duplicate PAYMENT_CONFIRMED after activated
    it('9. duplicate PAYMENT_CONFIRMED arriving after activation is terminal idempotent NO-OP', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_provider_payment_id: 'pay_adj_settled_001',
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      const dupEvent = {
        providerEventId: 'evt_dup_conf_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        dupEvent,
        activatedTr,
        new Date('2026-09-12T10:20:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('already_activated');
      expect(planChangesStore.get('tr_scheduled_early_001')!.transition_status).toBe('scheduled');
      expect(activeSlotsStore.get('slot_min_test_1_asaas')!.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 10. PAYMENT_RECEIVED after activated
    it('10. PAYMENT_RECEIVED arriving after activation is terminal idempotent NO-OP', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_provider_payment_id: 'pay_adj_settled_001',
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      const recEvent = {
        providerEventId: 'evt_dup_rec_001',
        eventType: 'payment_received' as const,
        providerPaymentId: 'pay_adj_settled_001',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'RECEIVED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        recEvent,
        activatedTr,
        new Date('2026-09-12T10:20:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('already_activated');
      expect(planChangesStore.get('tr_scheduled_early_001')!.transition_status).toBe('scheduled');
      expect(activeSlotsStore.get('slot_min_test_1_asaas')!.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 11. Provider checkout ID write-once conflict
    it('11. provider checkout ID write-once conflict fails closed into financial_attention_required', async () => {
      const trWithCheckoutId: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_checkout_id: 'chk_adj_001',
        checkout_attempts: [
          {
            ...getBaseScheduledTransition().checkout_attempts![0],
            provider_checkout_id: 'chk_adj_001',
          },
        ],
      };
      planChangesStore.set(trWithCheckoutId.id, trWithCheckoutId);

      const conflictingCheckoutEvent = {
        providerEventId: 'evt_chk_conflict_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_CONFLICTING_999',
        externalReference: 'intent_adj_001',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        conflictingCheckoutEvent,
        trWithCheckoutId,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('CHECKOUT_ID_WRITE_ONCE_CONFLICT');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('CHECKOUT_ID_WRITE_ONCE_CONFLICT');
      expect(postTr.early_activation_provider_checkout_id).toBe('chk_adj_001'); // Preservado write-once!

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 12. Provider payment ID write-once conflict
    it('12. provider payment ID write-once conflict fails closed into financial_attention_required', async () => {
      const trWithPaymentId: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_payment_id: 'pay_original_001',
        successful_early_adjustment_provider_payment_id: 'pay_original_001',
      };
      planChangesStore.set(trWithPaymentId.id, trWithPaymentId);

      const conflictingPaymentEvent = {
        providerEventId: 'evt_pay_conflict_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_DIFFERENT_999',
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        conflictingPaymentEvent,
        trWithPaymentId,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.early_activation_provider_payment_id).toBe('pay_original_001'); // Preservado!
      expect(postTr.transition_status).toBe('scheduled');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 13. Stale CHECKOUT_CREATED cannot mutate current attempt
    it('13. stale CHECKOUT_CREATED cannot mutate current attempt or current checkout ID', async () => {
      const trWithTwoAttempts: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: null,
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'uncertain',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trWithTwoAttempts.id, trWithTwoAttempts);

      // Chega CHECKOUT_CREATED referente à tentativa antiga att_adj_001_old
      const staleCheckoutEvent = {
        providerEventId: 'evt_stale_chk_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_old_recovered_001',
        externalReference: 'intent_adj_001_old',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        staleCheckoutEvent,
        trWithTwoAttempts,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('STALE_PROVIDER_CHECKOUT_MATERIALIZED');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      // A tentativa corrente continua intocada
      expect(postTr.early_activation_provider_checkout_id).toBe('chk_current_002');
      expect(postTr.current_early_activation_checkout_attempt_id).toBe('att_adj_002_current');
      expect(postTr.checkout_attempts![1].provider_checkout_id).toBe('chk_current_002');

      // A tentativa antiga atualizou apenas o seu próprio ID
      expect(postTr.checkout_attempts![0].provider_checkout_id).toBe('chk_old_recovered_001');

      // Atenção financeira acionada
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('STALE_PROVIDER_CHECKOUT_MATERIALIZED');
      expect(postTr.financial_safety_status).toBe('attention_required');
      expect(postTr.transition_status).toBe('scheduled');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 14. Uncertain attempt recovery via CHECKOUT_CREATED (UNCERTAIN CREATE WEBHOOK RECOVERY: IMPLEMENTED)
    it('14. uncertain attempt recovery via CHECKOUT_CREATED persists checkout ID and marks attempt pending without new POST', async () => {
      // Tentativa que sofreu OUTCOME_UNCERTAIN na criação
      const trWithUncertainAttempt: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_checkout_id: null as any,
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001',
            provider_checkout_id: null,
            status: 'uncertain',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'uncertain',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:05:00.000Z',
          },
        ],
      };
      planChangesStore.set(trWithUncertainAttempt.id, trWithUncertainAttempt);

      // Webhook oficial CHECKOUT_CREATED chega do gateway com o intent correlacionável
      const checkoutCreatedEvent = {
        providerEventId: 'evt_recovered_chk_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_recovered_001',
        externalReference: 'intent_adj_001',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        checkoutCreatedEvent,
        trWithUncertainAttempt,
        new Date('2026-09-12T10:06:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('checkout_created_acknowledged');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_provider_checkout_id).toBe('chk_recovered_001');
      expect(postTr.checkout_attempts![0].provider_checkout_id).toBe('chk_recovered_001');
      expect(postTr.checkout_attempts![0].status).toBe('pending');
      expect(postTr.checkout_attempts![0].provider_create_state).toBe('created');

      // Slot permanece HELD
      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 15. Uncertain recovered checkout + PAYMENT_CONFIRMED -> completes settlement without blind retry
    it('15. uncertain recovered checkout + PAYMENT_CONFIRMED executes full settlement and entitlement convergence cleanly', async () => {
      // Estado recuperado pelo teste 14
      const trRecovered: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_checkout_id: 'chk_recovered_001',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001',
            provider_checkout_id: 'chk_recovered_001',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:05:00.000Z',
          },
        ],
      };
      planChangesStore.set(trRecovered.id, trRecovered);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_adj_recovered_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        dueDate: '2026-09-12',
        confirmedDate: '2026-09-12T10:15:00.000Z',
        checkoutSession: 'chk_recovered_001',
      });

      const paymentEvent = {
        providerEventId: 'evt_pay_recovered_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_adj_recovered_001',
        providerCheckoutId: 'chk_recovered_001',
        externalReference: 'intent_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
        confirmedDate: '2026-09-12T10:15:00.000Z',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        paymentEvent,
        trRecovered,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('early_activation_settled_and_promoted');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.early_activation_provider_payment_id).toBe('pay_adj_recovered_001');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_safety_status).toBe('live');

      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 16. Quarantine maintained if uncertain attempt receives no valid correlation
    it('16. quarantine maintained: uncertain attempt without matching provider correlation blocks activation and holds slot', async () => {
      const trUncertainQuarantine: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_checkout_id: null as any,
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001',
            provider_checkout_id: null,
            status: 'uncertain',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'uncertain',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:05:00.000Z',
          },
        ],
      };
      planChangesStore.set(trUncertainQuarantine.id, trUncertainQuarantine);

      // Chega um pagamento sem checkout ID e sem correlação inequívoca
      const unlinkedEvent = {
        providerEventId: 'evt_unlinked_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_unlinked_001',
        providerCheckoutId: 'chk_UNKNOWN_001',
        externalReference: 'intent_UNKNOWN_999',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]);

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        unlinkedEvent,
        trUncertainQuarantine,
        new Date('2026-09-12T10:15:00.000Z')
      );

      // Não ativa entitlement
      expect(res.reason).not.toBe('early_activation_settled_and_promoted');
      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).not.toBe('activated');

      // Slot permanece estritamente retido
      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot).toBeDefined();
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 17. Stale attempt existing ID A + incoming ID B -> conflict -> old A preserved -> attention
    it('17. stale attempt existing ID A + incoming ID B -> conflict -> old A preserved -> attention', async () => {
      const trWithOldIdA: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_OLD_A_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trWithOldIdA.id, trWithOldIdA);

      // Chega CHECKOUT_CREATED com OLD_B != OLD_A para o attempt antigo
      const conflictingEvent = {
        providerEventId: 'evt_stale_conflict_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_OLD_B_999',
        externalReference: 'intent_adj_001_old',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        conflictingEvent,
        trWithOldIdA,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('CHECKOUT_ID_WRITE_ONCE_CONFLICT');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      // OLD_A preservado sem sobrescrita
      expect(postTr.checkout_attempts![0].provider_checkout_id).toBe('chk_OLD_A_001');
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('CHECKOUT_ID_WRITE_ONCE_CONFLICT');
      expect(postTr.transition_status).toBe('scheduled');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 18. Stale checkout later PAYMENT_CONFIRMED -> no current activation -> attention -> no refund -> slot HELD
    it('18. stale checkout later PAYMENT_CONFIRMED -> no current activation -> attention -> no refund -> slot HELD', async () => {
      const trStaleWithPayment: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        financial_attention_required: true,
        financial_attention_reason: 'STALE_PROVIDER_CHECKOUT_MATERIALIZED',
        financial_safety_status: 'attention_required',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trStaleWithPayment.id, trStaleWithPayment);

      const stalePaymentEvent = {
        providerEventId: 'evt_pay_stale_settled_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_stale_001',
        providerCheckoutId: 'chk_old_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        stalePaymentEvent,
        trStaleWithPayment,
        new Date('2026-09-12T10:15:00.000Z')
      );

      // Dinheiro real reconhecido como conflito, NÃO ativa target
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending'); // NÃO ativou!
      expect(postTr.early_activation_provider_payment_id).toBeUndefined(); // NÃO associou ao current!
      expect(postTr.checkout_attempts![0].provider_payment_id).toBe('pay_stale_001'); // Evidência preservada no attempt antigo!

      // BillingTransaction canônica criada
      const tx = transactionsStore.get('asaas_pay_stale_001')!;
      expect(tx).toBeDefined();
      expect(tx.provider_payment_id).toBe('pay_stale_001');
      expect(tx.amount_cents).toBe(1333);
      expect(tx.status).toBe('paid');
      expect(tx.attempt_id).toBe('att_adj_001_old');
      expect(tx.transaction_type).toBe('prorated_early_activation_adjustment');

      // Zero refund automático
      expect(mockProvider.refundPayment).not.toHaveBeenCalled();

      // Transição scheduled e slot HELD
      expect(postTr.transition_status).toBe('scheduled');
      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 19. Activated transition + duplicate historical checkout event -> no entitlement regression
    it('19. activated transition + duplicate historical checkout event -> no entitlement regression', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_activated_at: '2026-09-12T10:15:00.000Z',
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_known_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'completed',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      // Chega duplicate do checkout histórico já conhecido chk_old_known_001
      const dupOldEvent = {
        providerEventId: 'evt_dup_old_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_old_known_001',
        externalReference: 'intent_adj_001_old',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        dupOldEvent,
        activatedTr,
        new Date('2026-09-12T10:20:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('already_activated');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 20. Activated transition + genuinely new stale checkout resource -> entitlement preserved -> financial attention
    it('20. activated transition + genuinely new stale checkout resource -> entitlement preserved -> financial attention', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_activated_at: '2026-09-12T10:15:00.000Z',
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: null, // Ainda não tinha materializado no gateway!
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'uncertain',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'completed',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      // Inesperadamente materializou um checkout novo no Asaas para a tentativa antiga!
      const newStaleResourceEvent = {
        providerEventId: 'evt_new_stale_res_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_unexpected_old_001',
        externalReference: 'intent_adj_001_old',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        newStaleResourceEvent,
        activatedTr,
        new Date('2026-09-12T10:20:00.000Z')
      );

      // Atenção financeira acionada porque há um novo recurso financeiro potencialmente pagável
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('STALE_PROVIDER_CHECKOUT_MATERIALIZED');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      // Entitlement PRESERVADO em activated (NÃO regrediu!)
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('STALE_PROVIDER_CHECKOUT_MATERIALIZED');
      expect(postTr.financial_safety_status).toBe('attention_required');
      expect(postTr.transition_status).toBe('scheduled');

      // O novo checkout foi isolado na tentativa antiga
      expect(postTr.checkout_attempts![0].provider_checkout_id).toBe('chk_unexpected_old_001');
      expect(postTr.early_activation_provider_checkout_id).toBe('chk_current_002'); // Current inalterado!

      // Slot permanece HELD
      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 21. Current pending + duplicate same CHECKOUT_CREATED -> idempotent no-op without attention
    it('21. current pending + duplicate same CHECKOUT_CREATED -> idempotent no-op without attention', async () => {
      const currentPendingTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_provider_checkout_id: 'chk_adj_001',
        checkout_attempts: [
          {
            ...getBaseScheduledTransition().checkout_attempts![0],
            status: 'pending',
            provider_checkout_id: 'chk_adj_001',
          },
        ],
      };
      planChangesStore.set(currentPendingTr.id, currentPendingTr);

      const duplicateCheckoutCreated = {
        providerEventId: 'evt_dup_current_chk_001',
        eventType: 'checkout_created' as const,
        providerCheckoutId: 'chk_adj_001',
        externalReference: 'intent_adj_001',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        duplicateCheckoutCreated,
        currentPendingTr,
        new Date('2026-09-12T10:10:00.000Z')
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(true);
      expect(res.reason).toBe('checkout_created_already_acknowledged');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBeFalsy();
      expect(postTr.early_activation_provider_checkout_id).toBe('chk_adj_001');
      expect(postTr.transition_status).toBe('scheduled');

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 22. Stale PAYMENT_RECEIVED -> one canonical BillingTransaction containing att_old attempt_id
    it('22. stale PAYMENT_RECEIVED -> one canonical BillingTransaction containing att_old attempt_id', async () => {
      const trStaleWithPaymentReceived: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trStaleWithPaymentReceived.id, trStaleWithPaymentReceived);

      const receivedEvent = {
        providerEventId: 'evt_pay_stale_received_001',
        eventType: 'payment_received' as const,
        providerPaymentId: 'pay_stale_rec_001',
        providerCheckoutId: 'chk_old_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333,
        status: 'RECEIVED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        receivedEvent,
        trStaleWithPaymentReceived,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');

      const tx = transactionsStore.get('asaas_pay_stale_rec_001')!;
      expect(tx).toBeDefined();
      expect(tx.provider_payment_id).toBe('pay_stale_rec_001');
      expect(tx.attempt_id).toBe('att_adj_001_old');
      expect(tx.transaction_type).toBe('prorated_early_activation_adjustment');
      expect(tx.status).toBe('paid');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');
      expect(postTr.checkout_attempts![0].provider_payment_id).toBe('pay_stale_rec_001');
      expect(postTr.checkout_attempts![1].provider_payment_id).toBeUndefined(); // Current untouched!
    });

    // 23. Duplicate stale CONFIRMED -> idempotent with exactly one transaction
    it('23. duplicate stale CONFIRMED -> idempotent with exactly one transaction', async () => {
      const trDuplicateStale: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trDuplicateStale.id, trDuplicateStale);

      const staleEvent = {
        providerEventId: 'evt_dup_stale_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_stale_dup_001',
        providerCheckoutId: 'chk_old_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      await (billingService as any).handleV1PaidToPaidWebhook(
        staleEvent,
        trDuplicateStale,
        new Date('2026-09-12T10:15:00.000Z')
      );

      const firstTxCount = Array.from(transactionsStore.values()).filter(
        (t) => t.provider_payment_id === 'pay_stale_dup_001'
      ).length;
      expect(firstTxCount).toBe(1);

      // Redelivery do mesmo evento
      const res2 = await (billingService as any).handleV1PaidToPaidWebhook(
        staleEvent,
        planChangesStore.get('tr_scheduled_early_001')!,
        new Date('2026-09-12T10:16:00.000Z')
      );

      expect(res2.processed).toBe(false);
      expect(res2.reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');

      const secondTxCount = Array.from(transactionsStore.values()).filter(
        (t) => t.provider_payment_id === 'pay_stale_dup_001'
      ).length;
      expect(secondTxCount).toBe(1); // Exatamente 1 transaction mantida!
    });

    // 24. Stale CONFIRMED then RECEIVED -> exactly one canonical transaction
    it('24. stale CONFIRMED then RECEIVED -> exactly one canonical transaction', async () => {
      const trStaleSeq: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trStaleSeq.id, trStaleSeq);

      const confirmedEvt = {
        providerEventId: 'evt_seq_conf_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_stale_seq_001',
        providerCheckoutId: 'chk_old_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333,
        status: 'CONFIRMED',
      };
      await (billingService as any).handleV1PaidToPaidWebhook(
        confirmedEvt,
        trStaleSeq,
        new Date('2026-09-12T10:15:00.000Z')
      );

      const receivedEvt = {
        providerEventId: 'evt_seq_rec_001',
        eventType: 'payment_received' as const,
        providerPaymentId: 'pay_stale_seq_001',
        providerCheckoutId: 'chk_old_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333,
        status: 'RECEIVED',
      };
      await (billingService as any).handleV1PaidToPaidWebhook(
        receivedEvt,
        planChangesStore.get('tr_scheduled_early_001')!,
        new Date('2026-09-12T10:16:00.000Z')
      );

      const matchingTxs = Array.from(transactionsStore.values()).filter(
        (t) => t.provider_payment_id === 'pay_stale_seq_001'
      );
      expect(matchingTxs.length).toBe(1);
      expect(matchingTxs[0].attempt_id).toBe('att_adj_001_old');
    });

    // 25. Stale transaction conflict (divergent amount) -> fails closed into FINANCIAL_TRANSACTION_CONFLICT
    it('25. stale transaction conflict (divergent amount) -> fails closed into FINANCIAL_TRANSACTION_CONFLICT', async () => {
      const trStaleConflict: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trStaleConflict.id, trStaleConflict);

      // Pre-existente no store com valor 5000 divergente
      transactionsStore.set('asaas_pay_stale_conflict_001', {
        id: 'asaas_pay_stale_conflict_001',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_stale_conflict_001',
        amount_cents: 5000,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-09-12',
        paid_at: '2026-09-12T10:00:00.000Z',
        transaction_type: 'prorated_early_activation_adjustment',
        attempt_id: 'att_adj_001_old',
        created_at: '2026-09-12T10:00:00.000Z',
        updated_at: '2026-09-12T10:00:00.000Z',
      });

      const conflictEvent = {
        providerEventId: 'evt_pay_conflict_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_stale_conflict_001',
        providerCheckoutId: 'chk_old_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333, // Divergente de 5000
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        conflictEvent,
        trStaleConflict,
        new Date('2026-09-12T10:15:00.000Z')
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('FINANCIAL_TRANSACTION_CONFLICT');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('FINANCIAL_TRANSACTION_CONFLICT');
      expect(postTr.financial_safety_status).toBe('attention_required');

      // Valor original de 5000 preservado na transaction (não sobrescrito)
      const tx = transactionsStore.get('asaas_pay_stale_conflict_001')!;
      expect(tx.amount_cents).toBe(5000);

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 26. Activated current entitlement + stale settled payment -> entitlement preserved, transaction recorded, attention, slot HELD
    it('26. activated current entitlement + stale settled payment -> entitlement preserved, transaction recorded, attention, slot HELD', async () => {
      const activatedTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        early_activation_status: 'activated',
        early_activation_activated_at: '2026-09-12T10:15:00.000Z',
        early_activation_provider_payment_id: 'pay_current_002',
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_known_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            provider_payment_id: 'pay_current_002',
            status: 'completed',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(activatedTr.id, activatedTr);

      // Chega pagamento confirmado na tentativa antiga após o target já estar ativado
      const stalePayEvent = {
        providerEventId: 'evt_pay_hist_001',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_historical_late_001',
        providerCheckoutId: 'chk_old_known_001',
        externalReference: 'intent_adj_001_old',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        stalePayEvent,
        activatedTr,
        new Date('2026-09-12T10:30:00.000Z')
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      // Entitlement PRESERVADO em activated
      expect(postTr.early_activation_status).toBe('activated');
      expect(postTr.transition_status).toBe('scheduled');
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED');

      // Transaction canônica do pagamento stale foi salva
      const tx = transactionsStore.get('asaas_pay_historical_late_001')!;
      expect(tx).toBeDefined();
      expect(tx.provider_payment_id).toBe('pay_historical_late_001');
      expect(tx.attempt_id).toBe('att_adj_001_old');
      expect(tx.status).toBe('paid');

      // Tentativa corrente preservada com seu próprio payment ID
      expect(postTr.early_activation_provider_payment_id).toBe('pay_current_002');
      expect(postTr.checkout_attempts![1].provider_payment_id).toBe('pay_current_002');

      // Tentativa antiga gravou a evidência
      expect(postTr.checkout_attempts![0].provider_payment_id).toBe('pay_historical_late_001');

      // Zero refund
      expect(mockProvider.refundPayment).not.toHaveBeenCalled();

      // Slot permanece HELD
      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });

    // 27. Stale settled then later current payment arrives while attention unresolved -> blocks automatic convergence
    it('27. stale settled then later current payment arrives while attention unresolved -> blocks automatic convergence', async () => {
      // Estado onde o stale payment já foi liquidado e a transição está com attention = true
      const trStaleAttentionActive: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        current_early_activation_checkout_attempt_id: 'att_adj_002_current',
        early_activation_provider_checkout_id: 'chk_current_002',
        financial_attention_required: true,
        financial_attention_reason: 'STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED',
        financial_safety_status: 'attention_required',
        checkout_attempts: [
          {
            attempt_id: 'att_adj_001_old',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_001_old',
            provider_checkout_id: 'chk_old_001',
            provider_payment_id: 'pay_stale_old_001',
            status: 'expired',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: true,
            created_at: '2026-09-12T09:00:00.000Z',
          },
          {
            attempt_id: 'att_adj_002_current',
            transition_id: 'tr_scheduled_early_001',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_adj_002_current',
            provider_checkout_id: 'chk_current_002',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set(trStaleAttentionActive.id, trStaleAttentionActive);

      // Chega pagamento para a tentativa corrente
      const currentPaymentEvent = {
        providerEventId: 'evt_pay_current_002',
        eventType: 'payment_confirmed' as const,
        providerPaymentId: 'pay_current_002',
        providerCheckoutId: 'chk_current_002',
        externalReference: 'intent_adj_002_current',
        amountCents: 1333,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        currentPaymentEvent,
        trStaleAttentionActive,
        new Date('2026-09-12T10:20:00.000Z')
      );

      // Rejeitado pelo Readiness Gate porque financial_attention_required === true
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('financial_attention_required');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      // Entitlement NÃO converge para activated
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(postTr.financial_attention_required).toBe(true);

      const slot = activeSlotsStore.get('slot_min_test_1_asaas')!;
      expect(slot.plan_change_id).toBe('tr_scheduled_early_001');
    });
  });
});
