import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from './billing.service.js';
import {
  BillingTransitionV1Record,
  BillingCheckoutAttempt,
  BillingActiveTransitionSlotRecord,
  BillingSubscriptionRecord,
  BillingCustomerRecord,
  BillingTransactionRecord,
  isBillingTransitionV1,
} from './billing.types.js';
import { AsaasBillingProvider } from './providers/asaas/asaas.provider.js';
import { AppError } from '../../middleware/error-handler.js';
import { config } from '../../config/unifiedConfig.js';
import { getBillingDate } from '../../utils/billing-date.js';

describe('Phase 3C.5B — Provider Lifecycle Correction: Natural Expiry vs Explicit Cancellation', () => {
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
  const locksStore = new Map<string, { workerId: string; expiresAt: number }>();

  const getBaseScheduledTransition = (): BillingTransitionV1Record & { checkout_attempts: BillingCheckoutAttempt[] } => ({
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
        expires_at: '2026-09-12T10:35:00.000Z',
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
    locksStore.clear();

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
      getActivePlanChange: vi.fn(async (ministryId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.ministry_id === ministryId && tr.transition_status === 'scheduled') {
            return JSON.parse(JSON.stringify(tr));
          }
        }
        return null;
      }),
      getTransitionById: vi.fn(async (id: string, ministryId?: string) => {
        const found = planChangesStore.get(id);
        if (!found) return null;
        if (ministryId && found.ministry_id !== ministryId) return null;
        return JSON.parse(JSON.stringify(found));
      }),
      updateTransition: vi.fn(async (id: string, ministryId: string, updates: Partial<BillingTransitionV1Record>) => {
        const existing = planChangesStore.get(id);
        if (!existing) throw new AppError(404, 'Not found');
        const updated = {
          ...existing,
          ...updates,
          updated_at: new Date().toISOString(),
        };
        planChangesStore.set(id, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      updatePlanChange: vi.fn(async (id: string, updates: any) => {
        const existing = planChangesStore.get(id);
        if (!existing) throw new AppError(404, 'Not found');
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      claimTransitionForReconciliation: vi.fn(async (transitionId: string, workerId: string) => {
        const lock = locksStore.get(transitionId);
        const now = Date.now();
        if (lock && lock.expiresAt > now && lock.workerId !== workerId) {
          return null;
        }
        const tr = planChangesStore.get(transitionId);
        if (!tr) return null;
        if (tr.financial_safety_status === 'safe_terminal' && tr.transition_status === 'completed') return null;
        if (tr.financial_attention_required === true) return null;

        locksStore.set(transitionId, { workerId, expiresAt: now + 60000 });
        const nowIso = new Date(now).toISOString();
        tr.retry_locked_until = new Date(now + 60000).toISOString();
        tr.retry_locked_by = workerId;
        tr.retry_count = (tr.retry_count || 0) + 1;
        tr.last_retry_at = nowIso;
        tr.last_reconciled_at = nowIso;
        tr.updated_at = nowIso;
        return JSON.parse(JSON.stringify(tr));
      }),
      releasePlanChangeLock: vi.fn(async (transitionId: string) => {
        locksStore.delete(transitionId);
        const tr = planChangesStore.get(transitionId);
        if (tr) {
          tr.retry_locked_until = null;
          tr.retry_locked_by = null;
          tr.updated_at = new Date().toISOString();
        }
        return true;
      }),
      getActiveTransitionSlot: vi.fn(async (ministryId: string, provider: string) => {
        const slot = activeSlotsStore.get(`slot_${ministryId}_${provider}`);
        return slot ? JSON.parse(JSON.stringify(slot)) : null;
      }),
      saveTransaction: vi.fn(async (tx: BillingTransactionRecord) => {
        transactionsStore.set(tx.id, { ...tx });
        return { ...tx };
      }),
      getTransactionById: vi.fn(async (txId: string) => {
        const tx = transactionsStore.get(txId);
        return tx ? { ...tx } : null;
      }),
      recordEarlyActivationCheckoutCancelAttempting: vi.fn(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Not found');
        const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
        const idx = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (idx < 0) throw new AppError(404, 'Attempt not found');
        const cur = attempts[idx];
        if (cur.cancel_state === 'attempting') {
          throw new AppError(409, 'Cancel already in progress', { code: 'ATTEMPT_CANCEL_ALREADY_IN_PROGRESS' });
        }
        if (cur.cancel_state === 'confirmed') {
          throw new AppError(409, 'Cancel already confirmed', { code: 'ATTEMPT_ALREADY_CANCELED' });
        }
        if (cur.cancel_state === 'uncertain') {
          throw new AppError(409, 'Cancel uncertain', { code: 'ATTEMPT_CANCEL_UNCERTAIN' });
        }
        attempts[idx] = {
          ...cur,
          cancel_state: 'attempting',
          cancellation_intent_id: params.cancellationIntentId,
          cancellation_requested_at: params.nowIso || new Date().toISOString(),
        };
        const updated = { ...existing, checkout_attempts: attempts, updated_at: new Date().toISOString() };
        planChangesStore.set(params.transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      recordEarlyActivationCheckoutCancelConfirmed: vi.fn(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Not found');
        const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
        const idx = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (idx < 0) throw new AppError(404, 'Attempt not found');
        const cur = attempts[idx];
        const nowIso = params.nowIso || new Date().toISOString();
        attempts[idx] = {
          ...cur,
          status: 'canceled',
          cancel_state: 'confirmed',
          cancellation_confirmed_at: nowIso,
          provider_session_terminal: true,
          failure_classification: 'session_canceled',
          completed_at: nowIso,
        };
        const isBoundaryReached = Boolean(
          params.nowCommercialDate &&
          existing.effective_billing_date &&
          params.nowCommercialDate >= existing.effective_billing_date
        );
        const updated = {
          ...existing,
          checkout_attempts: attempts,
          early_activation_status: isBoundaryReached ? ('expired' as const) : ('available' as const),
          updated_at: nowIso,
        };
        planChangesStore.set(params.transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      markEarlyActivationCheckoutCancelUncertain: vi.fn(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Not found');
        const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
        const idx = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (idx < 0) throw new AppError(404, 'Attempt not found');
        const cur = attempts[idx];
        const nowIso = params.nowIso || new Date().toISOString();
        attempts[idx] = {
          ...cur,
          cancel_state: 'uncertain',
          cancellation_uncertain_at: nowIso,
          cancellation_reason: params.reason || 'cancellation_outcome_uncertain',
        };
        const updated = { ...existing, checkout_attempts: attempts, updated_at: nowIso };
        planChangesStore.set(params.transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      recordEarlyActivationCheckoutExpiredConfirmed: vi.fn(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Not found');
        const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
        const idx = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (idx < 0) throw new AppError(404, 'Attempt not found');
        const cur = attempts[idx];
        const nowIso = params.nowIso || new Date().toISOString();
        attempts[idx] = {
          ...cur,
          status: 'expired',
          provider_session_terminal: true,
          failure_classification: 'session_expired',
          expiry_confirmed_at: nowIso,
          provider_expired_at: nowIso,
          completed_at: nowIso,
        };
        const isBoundaryReached = Boolean(
          params.nowCommercialDate &&
          existing.effective_billing_date &&
          params.nowCommercialDate >= existing.effective_billing_date
        );
        const updated = {
          ...existing,
          checkout_attempts: attempts,
          early_activation_status: isBoundaryReached ? ('expired' as const) : ('available' as const),
          updated_at: nowIso,
        };
        planChangesStore.set(params.transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      markEarlyActivationCheckoutExpiredPending: vi.fn(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Not found');
        const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
        const idx = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (idx < 0) throw new AppError(404, 'Attempt not found');
        const cur = attempts[idx];
        const nowIso = params.nowIso || new Date().toISOString();
        attempts[idx] = {
          ...cur,
          status: 'uncertain_expired',
          provider_expired_at: nowIso,
          failure_classification: 'session_expired',
        };
        const updated = { ...existing, checkout_attempts: attempts, updated_at: nowIso };
        planChangesStore.set(params.transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      markWebhookEventProcessed: vi.fn(async () => {}),
      isWebhookEventProcessed: vi.fn(async () => false),
      recordEarlyAdjustmentFinancialSettlement: vi.fn(async (params: any) => {
        const { transitionId, providerPaymentId, paidBillingDate, settledAt, attemptId, nowIso } = params;
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
        const { transitionId, providerPaymentId, attemptId, nowIso } = params;
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
      recordEarlyActivationQuote: vi.fn(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Not found');
        const quote = params.quote;
        const history = existing.early_activation_quotes_history ? [...existing.early_activation_quotes_history] : [];
        if (existing.current_early_activation_quote) {
          history.push({ ...existing.current_early_activation_quote, status: 'superseded' });
        }
        const updated = {
          ...existing,
          current_early_activation_quote: quote,
          early_activation_quotes_history: history,
          prorated_adjustment_cents: quote.prorated_adjustment_cents,
          early_activation_status: 'available' as const,
          updated_at: new Date().toISOString(),
        };
        planChangesStore.set(params.transitionId, updated);
        return { transition: JSON.parse(JSON.stringify(updated)), quote };
      }),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn(async (ministryId: string) => {
        const found = appSubscriptionsStore.get(ministryId);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }),
      setSubscription: vi.fn(async (sub: any) => {
        appSubscriptionsStore.set(sub.ministry_id, { ...sub });
      }),
    };

    mockSubscriptionService = {
      applyLockedEntitlementSnapshot: vi.fn(async () => {}),
      changePlan: vi.fn(async () => {}),
      changeMemberAddonBlocks: vi.fn(async () => {}),
    };

    mockMinistryRepo = {
      getMinistryById: vi.fn(async () => ({ id: 'min_test_1', name: 'Ministry Test' })),
    };

    mockUserRepo = {
      getUserById: vi.fn(async () => ({ id: 'usr_test_1', email: 'leader@praise.test', name: 'Leader' })),
    };

    mockProvider = {
      name: 'asaas',
      listPaymentsByCheckoutSession: vi.fn(async (chkId: string) => []),
      cancelCheckout: vi.fn(async (chkId: string) => ({ success: true, status: 'CANCELED' })),
      getPayment: vi.fn(async (payId: string) => null),
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

  // =========================================================================================
  // SECTION 29 — TEST MATRIX: PROVIDER LIFECYCLE (NATURAL EXPIRY vs EXPLICIT CANCELLATION)
  // =========================================================================================

  // 1. local expires_at reached -> ZERO cancelCheckout calls
  it('1. local expires_at reached -> ZERO cancelCheckout calls', async () => {
    // Attempt expires at 10:35, current time is 11:00 (locally expired)
    const now = new Date('2026-09-12T11:00:00.000Z');
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment(
      'tr_scheduled_early_001',
      'worker_test_1',
      { now }
    );

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.reason).toBe('local_expiry_awaiting_provider_webhook');

    // Attempt remains pending awaiting provider terminal webhook
    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.checkout_attempts[0].cancel_state).toBeUndefined();
    expect(tr.checkout_attempts[0].status).toBe('pending');
  });

  // 2. CHECKOUT_EXPIRED exists in provider webhook mapping
  it('2. CHECKOUT_EXPIRED exists in provider webhook mapping', () => {
    const asaasProvider = new AsaasBillingProvider({
      apiKey: 'test_key',
      webhookToken: 'test_token',
      apiUrl: 'https://sandbox.asaas.com/api/v3',
    });

    const parsed = asaasProvider.parseWebhookEvent({
      id: 'evt_expired_123',
      event: 'CHECKOUT_EXPIRED',
      checkout: {
        id: 'chk_expired_001',
        externalReference: 'intent_adj_001',
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe('checkout_expired');
    expect(parsed?.rawEventType).toBe('CHECKOUT_EXPIRED');
    expect(parsed?.providerCheckoutId).toBe('chk_expired_001');
    expect(parsed?.externalReference).toBe('intent_adj_001');
  });

  // 3. CHECKOUT_EXPIRED + zero payments -> attempt expired
  it('3. CHECKOUT_EXPIRED + zero payments -> attempt expired', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);

    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    const expiredEvent = {
      providerEventId: 'evt_chk_expired_001',
      eventType: 'checkout_expired' as const,
      providerCheckoutId: 'chk_adj_001',
      externalReference: 'intent_adj_001',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      expiredEvent,
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(mockProvider.listPaymentsByCheckoutSession).toHaveBeenCalledWith('chk_adj_001');
    expect(res.processed).toBe(true);
    expect(res.reason).toBe('safe_expired');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    const att = reloaded.checkout_attempts[0];
    expect(att.status).toBe('expired');
    expect(att.provider_session_terminal).toBe(true);
    expect(att.failure_classification).toBe('session_expired');
    expect(att.expiry_confirmed_at).toBeDefined();
    expect(att.cancel_state).toBeUndefined(); // Distinct from canceled!
    expect(reloaded.early_activation_status).toBe('available');
  });

  // 4. expired attempt keeps transition scheduled
  it('4. expired attempt keeps transition scheduled', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_4', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.transition_status).toBe('scheduled');
  });

  // 5. expired attempt keeps slot HELD
  it('5. expired attempt keeps slot HELD', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_5', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    const slot = await mockBillingRepo.getActiveTransitionSlot('min_test_1', 'asaas');
    expect(slot).toBeDefined();
    expect(slot.plan_change_id).toBe(tr.id);
  });

  // 6. expired attempt touches no target recurrence
  it('6. expired attempt touches no target recurrence', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_6', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.future_provider_subscription_id).toBe('sub_target_new');
    expect(reloaded.future_provider_payment_id).toBe('pay_target_renewal_001');
    expect(reloaded.future_provider_checkout_id).toBe('chk_future_001');
  });

  // 7. expired attempt creates zero BillingTransaction
  it('7. expired attempt creates zero BillingTransaction', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_7', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(transactionsStore.size).toBe(0);
    expect(mockBillingRepo.saveTransaction).not.toHaveBeenCalled();
  });

  // 8. CHECKOUT_EXPIRED + CONFIRMED -> canonical financial processing
  it('8. CHECKOUT_EXPIRED + CONFIRMED -> canonical financial processing', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      {
        id: 'pay_confirmed_exp',
        status: 'CONFIRMED',
        amountCents: 1333,
        confirmedDate: '2026-09-12T10:34:59.000Z',
        customerId: 'cus_test_1',
      },
    ]);

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_8', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(res.processed).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.early_activation_status).toBe('activated');
  });

  // 9. CHECKOUT_EXPIRED + RECEIVED -> canonical financial processing
  it('9. CHECKOUT_EXPIRED + RECEIVED -> canonical financial processing', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      {
        id: 'pay_received_exp',
        status: 'RECEIVED',
        amountCents: 1333,
        paymentDate: '2026-09-12',
        customerId: 'cus_test_1',
      },
    ]);

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_9', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(res.processed).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.early_activation_status).toBe('activated');
  });

  // 10. CHECKOUT_EXPIRED + PENDING -> blocks replacement
  it('10. CHECKOUT_EXPIRED + PENDING -> blocks replacement', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      { id: 'pay_pending_exp', status: 'PENDING', amountCents: 1333, customerId: 'cus_test_1' },
    ]);

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_10', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('materialized_payment_blocks_checkout_cleanup');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.financial_attention_required).toBe(true);
    expect(reloaded.financial_attention_reason).toBe('materialized_payment_blocks_checkout_cleanup');
    expect(reloaded.checkout_attempts[0].status).not.toBe('expired');
  });

  // 11. CHECKOUT_EXPIRED + OVERDUE -> blocks replacement
  it('11. CHECKOUT_EXPIRED + OVERDUE -> blocks replacement', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      { id: 'pay_overdue_exp', status: 'OVERDUE', amountCents: 1333, customerId: 'cus_test_1' },
    ]);

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_11', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('materialized_payment_blocks_checkout_cleanup');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.financial_attention_required).toBe(true);
    expect(reloaded.financial_attention_reason).toBe('materialized_payment_blocks_checkout_cleanup');
  });

  // 12. CHECKOUT_EXPIRED + multiple payments -> ledger + attention
  it('12. CHECKOUT_EXPIRED + multiple payments -> ledger + attention', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      { id: 'pay_m1', status: 'CONFIRMED', amountCents: 1333, customerId: 'cus_test_1' },
      { id: 'pay_m2', status: 'RECEIVED', amountCents: 1333, customerId: 'cus_test_1' },
    ]);

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_12', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.financial_attention_required).toBe(true);
    expect(reloaded.financial_attention_reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');
  });

  // 13. CHECKOUT_EXPIRED + provider read timeout -> terminal checkout evidence preserved, financial verification pending
  it('13. CHECKOUT_EXPIRED + provider read timeout -> terminal checkout evidence preserved, financial verification pending', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockRejectedValue(new Error('Gateway timeout'));

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_13', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('checkout_expired_verification_pending');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    const att = reloaded.checkout_attempts[0];
    expect(att.status).toBe('uncertain_expired');
    expect(att.provider_expired_at).toBeDefined();
    expect(att.status).not.toBe('expired'); // Not declared safe expired!
  });

  // 14. duplicate CHECKOUT_EXPIRED -> idempotent
  it('14. duplicate CHECKOUT_EXPIRED -> idempotent', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    // First EXPIRED webhook
    const res1 = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_14_a', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );
    expect(res1.reason).toBe('safe_expired');

    // Duplicate EXPIRED webhook
    const current = await mockBillingRepo.getTransitionById(tr.id);
    const res2 = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_14_b', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      current,
      new Date('2026-09-12T10:41:00.000Z')
    );
    expect(res2.processed).toBe(true);
    expect(['already_expired', 'attempt_already_expired']).toContain(res2.reason);
  });

  // 15. local expiry without webhook -> not treated as confirmed provider terminal
  it('15. local expiry without webhook -> not treated as confirmed provider terminal', async () => {
    const now = new Date('2026-09-12T11:00:00.000Z');
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment(
      'tr_scheduled_early_001',
      'worker_test_1',
      { now }
    );

    expect(res.reason).toBe('local_expiry_awaiting_provider_webhook');
    const tr = await mockBillingRepo.getTransitionById('tr_scheduled_early_001');
    expect(tr.checkout_attempts[0].status).toBe('pending');
    expect(tr.checkout_attempts[0].provider_session_terminal).toBe(false);
  });

  // 16. local expiry without webhook -> does NOT call POST cancel
  it('16. local expiry without webhook -> does NOT call POST cancel', async () => {
    const now = new Date('2026-09-12T11:00:00.000Z');
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    await billingService.reconcilePaidToPaidEarlyActivationAdjustment(
      'tr_scheduled_early_001',
      'worker_test_1',
      { now }
    );

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
  });

  // 17. uncertain cancellation + zero payments -> NOT safe canceled
  it('17. uncertain cancellation + zero payments -> NOT safe canceled', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].cancel_state = 'uncertain';
    tr.checkout_attempts[0].status = 'uncertain';
    planChangesStore.set(tr.id, tr);

    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment(
      tr.id,
      'worker_test_1',
      { now: new Date('2026-09-12T11:00:00.000Z') }
    );

    expect(res.success).toBe(false);
    expect(res.reason).toBe('cancellation_outcome_uncertain');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].status).toBe('uncertain');
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('uncertain');
    expect(reloaded.checkout_attempts[0].status).not.toBe('canceled');
  });

  // 18. uncertain cancellation + CHECKOUT_CANCELED + zero payments -> safe canceled
  it('18. uncertain cancellation + CHECKOUT_CANCELED + zero payments -> safe canceled', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].cancel_state = 'uncertain';
    tr.checkout_attempts[0].status = 'uncertain';
    planChangesStore.set(tr.id, tr);

    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    const cancelEvent = {
      providerEventId: 'evt_chk_canceled_recovery',
      eventType: 'checkout_canceled' as const,
      providerCheckoutId: 'chk_adj_001',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      cancelEvent,
      tr,
      new Date('2026-09-12T11:05:00.000Z')
    );

    expect(mockProvider.listPaymentsByCheckoutSession).toHaveBeenCalledWith('chk_adj_001');
    expect(res.processed).toBe(true);
    expect(res.reason).toBe('safe_canceled');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].status).toBe('canceled');
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('confirmed');
    expect(reloaded.checkout_attempts[0].provider_session_terminal).toBe(true);
  });

  // 19. CHECKOUT_CANCELED + settled payment -> financial processing
  it('19. CHECKOUT_CANCELED + settled payment -> financial processing', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].cancel_state = 'uncertain';
    planChangesStore.set(tr.id, tr);

    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      {
        id: 'pay_cancel_race_confirmed',
        status: 'CONFIRMED',
        amountCents: 1333,
        confirmedDate: '2026-09-12T10:30:00.000Z',
        customerId: 'cus_test_1',
      },
    ]);

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_chk_canceled_race', eventType: 'checkout_canceled', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T11:05:00.000Z')
    );

    expect(res.processed).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.early_activation_status).toBe('activated');
  });

  // 20. cancel endpoint invoked only while checkout not expired, if legitimate cancel trigger exists
  it('20. cancel endpoint invoked only while checkout not expired, if legitimate cancel trigger exists', async () => {
    const tr = getBaseScheduledTransition();
    // Attempt expires at 10:35
    const attempt = tr.checkout_attempts[0];

    // Case A: now is 10:20 (pre-expiry) -> explicit cancel allowed
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    mockProvider.cancelCheckout.mockResolvedValue({ success: true, status: 'CANCELED' });

    const preExpiryRes = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(mockProvider.cancelCheckout).toHaveBeenCalledWith('chk_adj_001');
    expect(preExpiryRes.success).toBe(true);
    expect(preExpiryRes.reason).toBe('safe_canceled');

    // Reset attempt
    mockProvider.cancelCheckout.mockClear();
    const trExpired = getBaseScheduledTransition();
    const expiredAttempt = trExpired.checkout_attempts[0];

    // Case B: now is 10:40 (post-expiry) -> explicit cancel forbidden
    const postExpiryRes = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: trExpired,
      currentAttempt: expiredAttempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:40:00.000Z'),
    });

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
    expect(postExpiryRes.success).toBe(false);
    expect(postExpiryRes.reason).toBe('checkout_already_expired_explicit_cancel_forbidden');
  });

  // 21. HTTP 200 adapter normalization tested
  it('21. HTTP 200 adapter normalization tested', async () => {
    const asaasProvider = new AsaasBillingProvider({
      apiKey: 'test_key',
      apiUrl: 'https://sandbox.asaas.com/api/v3',
    });

    // Mock global fetch returning HTTP 200 with non-standard body
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async (url: any, init: any) => {
        if (String(url).includes('/checkouts/chk_norm_001/cancel')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ unexpectedField: 123 }), // gateway returns arbitrary/empty body
          } as any;
        }
        return { ok: false, status: 500 } as any;
      });

      const cancelRes = await asaasProvider.cancelCheckout('chk_norm_001');
      expect(cancelRes).toEqual({ success: true, status: 'CANCELED' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 22. late settlement after safe EXPIRED -> stale ledger + attention
  it('22. late settlement after safe EXPIRED -> stale ledger + attention', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'expired';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.early_activation_status = 'available';
    planChangesStore.set(tr.id, tr);

    const lateConfirmedEvent = {
      providerEventId: 'evt_late_confirmed_exp',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_late_settled_exp',
      providerCheckoutId: 'chk_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T12:00:00.000Z',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      lateConfirmedEvent,
      tr,
      new Date('2026-09-12T12:05:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT');

    const tx = transactionsStore.get('asaas_pay_late_settled_exp');
    expect(tx).toBeDefined();
    expect(tx?.status).toBe('paid');
    expect(tx?.amount_cents).toBe(1333);

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.financial_attention_required).toBe(true);
    expect(reloaded.financial_attention_reason).toBe('CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT');
    expect(reloaded.early_activation_status).not.toBe('activated');
    expect(reloaded.transition_status).toBe('scheduled');
  });

  // 23. new quote after safe EXPIRED -> new quote ID / fresh proration
  it('23. new quote after safe EXPIRED -> new quote ID / fresh proration', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'expired';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.early_activation_status = 'available';
    planChangesStore.set(tr.id, tr);

    const quoteRes = await billingService.createEarlyActivationQuote('min_test_1', 'usr_test_1', tr.id, {
      now: new Date('2026-09-22T10:00:00.000Z'),
    });

    expect(quoteRes).toBeDefined();
    expect(quoteRes.quoteId).toBeDefined();
    expect(quoteRes.quoteId).not.toBe('quote_adj_001');
    expect(quoteRes.remainingDays).toBeLessThan(20);
    expect(quoteRes.proratedAdjustmentCents).toBeLessThan(1333);
  });

  // 24. new quote blocked after local expiry but before terminal provider evidence, if adopting strict quarantine policy
  it('24. new quote blocked after local expiry but before terminal provider evidence, if adopting strict quarantine policy', async () => {
    const tr = getBaseScheduledTransition();
    // Attempt expired at 10:35, status is still pending (no CHECKOUT_EXPIRED webhook yet)
    tr.checkout_attempts[0].status = 'pending';
    planChangesStore.set(tr.id, tr);

    await expect(
      billingService.createEarlyActivationQuote('min_test_1', 'usr_test_1', tr.id, {
        now: new Date('2026-09-12T10:45:00.000Z'),
      })
    ).rejects.toThrow(/não resolvida/i);
  });

  // 25. boundary reached -> no replacement
  it('25. boundary reached -> no replacement', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'expired';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.early_activation_status = 'available';
    planChangesStore.set(tr.id, tr);

    // effective_billing_date is 2026-10-02.
    await expect(
      billingService.createEarlyActivationQuote('min_test_1', 'usr_test_1', tr.id, {
        now: new Date('2026-10-02T10:00:00.000Z'),
      })
    ).rejects.toThrow(/atingiu ou ultrapassou a fronteira da renovação/i);
  });

  // 26. out-of-order EXPIRED / PAID / PAYMENT_CONFIRMED events monotonic
  it('26. out-of-order EXPIRED / PAID / PAYMENT_CONFIRMED events monotonic', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);

    // Scenario A: PAYMENT_CONFIRMED arrives first -> activated
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    const payRes = await (billingService as any).handleV1PaidToPaidWebhook(
      {
        providerEventId: 'evt_pay_mono_01',
        eventType: 'payment_confirmed',
        providerPaymentId: 'pay_mono_01',
        providerCheckoutId: 'chk_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
        confirmedDate: '2026-09-12T10:20:00.000Z',
      },
      tr,
      new Date('2026-09-12T10:20:00.000Z')
    );
    expect(payRes.processed).toBe(true);
    expect(payRes.reason).toBe('early_activation_settled_and_promoted');

    const activatedTr = await mockBillingRepo.getTransitionById(tr.id);
    expect(activatedTr.early_activation_status).toBe('activated');

    // Scenario B: CHECKOUT_EXPIRED arrives AFTER promotion -> monotonic no-op
    const expRes = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_mono_late', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      activatedTr,
      new Date('2026-09-12T10:40:00.000Z')
    );
    expect(expRes.processed).toBe(true);
    expect(expRes.reason).toBe('already_activated');

    const preservedTr = await mockBillingRepo.getTransitionById(tr.id);
    expect(preservedTr.early_activation_status).toBe('activated'); // NEVER regresses!
  });

  // =========================================================================================
  // SECTION 30 — EXISTING SAFETY PRESERVED (CRASH MATRIX, 401/403, 404, CONCURRENCY)
  // =========================================================================================

  // 27. Explicit cancel pre-expiry: preflight payments gate blocks cancel if payment exists
  it('27. explicit cancel pre-expiry: preflight payments gate blocks cancel if payment exists', async () => {
    const tr = getBaseScheduledTransition();
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      { id: 'pay_preflight_01', status: 'CONFIRMED', amountCents: 1333, customerId: 'cus_test_1' },
    ]);

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'), // pre-expiry
    });

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.reason).toBe('pre_cancel_gate_found_payments');
  });

  // 28. Explicit cancel: Provider cancel timeout -> uncertain, no blind retry
  it('28. explicit cancel: provider cancel timeout -> uncertain, no blind retry', async () => {
    const tr = getBaseScheduledTransition();
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    mockProvider.cancelCheckout.mockRejectedValue(
      new AppError(504, 'Provider timeout during cancel', { code: 'PROVIDER_TIMEOUT' })
    );

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('cancellation_outcome_uncertain');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('uncertain');
  });

  // 29. Explicit cancel: Provider cancel 401/403 -> operational failure
  it('29. explicit cancel: provider cancel 401/403 -> operational failure', async () => {
    const tr = getBaseScheduledTransition();
    tr.id = 'tr_scheduled_early_29_401';
    tr.transition_id = 'tr_scheduled_early_29_401';
    planChangesStore.set(tr.id, tr);
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    mockProvider.cancelCheckout.mockRejectedValue(
      new AppError(401, 'Unauthorized', { code: 'PROVIDER_AUTH_ERROR' })
    );

    const res401 = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });
    expect(res401.reason).toBe('cancel_auth_failure_401');

    mockProvider.cancelCheckout.mockRejectedValue(
      new AppError(403, 'Forbidden', { code: 'PROVIDER_FORBIDDEN' })
    );
    const tr403 = getBaseScheduledTransition();
    tr403.id = 'tr_scheduled_early_29_403';
    tr403.transition_id = 'tr_scheduled_early_29_403';
    planChangesStore.set(tr403.id, tr403);
    const res403 = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr403,
      currentAttempt: tr403.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });
    expect(res403.reason).toBe('cancel_auth_failure_403');
  });

  // 30. Explicit cancel: Provider cancel 404 -> not assumed safe terminal
  it('30. explicit cancel: provider cancel 404 -> not assumed safe terminal', async () => {
    const tr = getBaseScheduledTransition();
    tr.id = 'tr_scheduled_early_30';
    tr.transition_id = 'tr_scheduled_early_30';
    planChangesStore.set(tr.id, tr);
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    mockProvider.cancelCheckout.mockRejectedValue(
      new AppError(404, 'Checkout not found', { code: 'NOT_FOUND' })
    );

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_cancel_404_not_found');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('uncertain');
    expect(reloaded.checkout_attempts[0].status).not.toBe('canceled');
  });

  // 31. Explicit cancel: Postflight read timeout -> verification pending
  it('31. explicit cancel: postflight read timeout -> verification pending', async () => {
    const tr = getBaseScheduledTransition();
    tr.id = 'tr_scheduled_early_31';
    tr.transition_id = 'tr_scheduled_early_31';
    planChangesStore.set(tr.id, tr);
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]); // preflight
    mockProvider.cancelCheckout.mockResolvedValue({ success: true, status: 'CANCELED' });
    mockProvider.listPaymentsByCheckoutSession.mockRejectedValueOnce(new Error('Postflight timeout'));

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('post_cancel_read_failed_verification_pending');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('uncertain');
  });

  // 32. Crash B intent before POST -> recoverable to uncertain
  it('32. Crash B intent before POST -> recoverable to uncertain', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].cancel_state = 'attempting';
    tr.checkout_attempts[0].cancellation_intent_id = 'intent_crash_b';
    planChangesStore.set(tr.id, tr);

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: tr.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.reason).toBe('cancellation_outcome_uncertain');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('uncertain');
  });

  // 33. Crash C provider success before local write -> local uncertain, recovered via CHECKOUT_CANCELED
  it('33. Crash C provider success before local write -> local uncertain, recovered via CHECKOUT_CANCELED', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].cancel_state = 'attempting';
    planChangesStore.set(tr.id, tr);

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: tr.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });
    expect(res.reason).toBe('cancellation_outcome_uncertain');

    // Trusted webhook CHECKOUT_CANCELED arrives subsequently and recovers
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    const webhookRes = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_recovery_c', eventType: 'checkout_canceled', providerCheckoutId: 'chk_adj_001' },
      await mockBillingRepo.getTransitionById(tr.id),
      new Date('2026-09-12T10:25:00.000Z')
    );
    expect(webhookRes.processed).toBe(true);
    expect(webhookRes.reason).toBe('safe_canceled');
  });

  // 34. Two workers concurrency -> exactly one CAS intent succeeds
  it('34. two workers concurrency -> exactly one CAS intent succeeds', async () => {
    const tr = getBaseScheduledTransition();
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    mockProvider.cancelCheckout.mockResolvedValue({ success: true, status: 'CANCELED' });

    const [res1, res2] = await Promise.all([
      billingService.executeExpiredEarlyActivationCheckoutCleanup({
        claimed: tr,
        currentAttempt: attempt,
        knownCheckoutId: 'chk_adj_001',
        now: new Date('2026-09-12T10:20:00.000Z'),
      }),
      billingService.executeExpiredEarlyActivationCheckoutCleanup({
        claimed: tr,
        currentAttempt: attempt,
        knownCheckoutId: 'chk_adj_001',
        now: new Date('2026-09-12T10:20:00.000Z'),
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    expect(successes.length).toBe(1);
  });

  // 35. No automatic refund under any cleanup path
  it('35. no automatic refund under any cleanup path', async () => {
    // When late payment settles on expired attempt:
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'expired';
    tr.checkout_attempts[0].provider_session_terminal = true;
    planChangesStore.set(tr.id, tr);

    await (billingService as any).handleV1PaidToPaidWebhook(
      {
        providerEventId: 'evt_no_refund',
        eventType: 'payment_confirmed',
        providerPaymentId: 'pay_no_refund_01',
        providerCheckoutId: 'chk_adj_001',
        amountCents: 1333,
        status: 'CONFIRMED',
        confirmedDate: '2026-09-12T12:00:00.000Z',
      },
      tr,
      new Date('2026-09-12T12:05:00.000Z')
    );

    // Transaction is saved as paid in ledger, never refunded automatically
    const tx = transactionsStore.get('asaas_pay_no_refund_01');
    expect(tx).toBeDefined();
    expect(tx?.status).toBe('paid');
  });

  // 36. No data deletion: ministries, members, songs, transitions preserved
  it('36. no data deletion: ministries, members, songs, transitions preserved', async () => {
    const tr = getBaseScheduledTransition();
    planChangesStore.set(tr.id, tr);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_exp_preservation', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    // Transition document still exists in store
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded).toBeDefined();
    expect(reloaded.id).toBe(tr.id);
    expect(reloaded.checkout_attempts.length).toBe(1);
    expect(reloaded.current_early_activation_quote).toBeDefined();
  });

  // =========================================================================================
  // SECTION 31 — TERMINAL CONFLICT TEST MATRIX (SECTION 7) & RESIDUAL SAFETY (SECTION 9)
  // =========================================================================================

  // 37. duplicate CHECKOUT_CANCELED -> idempotent
  it('37. duplicate CHECKOUT_CANCELED -> idempotent', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'canceled';
    tr.checkout_attempts[0].cancel_state = 'confirmed';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.checkout_attempts[0].cancellation_confirmed_at = '2026-09-12T10:25:00.000Z';
    planChangesStore.set(tr.id, tr);

    const cancelEvent = {
      providerEventId: 'evt_chk_canceled_dup',
      eventType: 'checkout_canceled' as const,
      providerCheckoutId: 'chk_adj_001',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      cancelEvent,
      tr,
      new Date('2026-09-12T10:30:00.000Z')
    );

    expect(res.processed).toBe(true);
    expect(res.reason).toBe('attempt_already_canceled');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].status).toBe('canceled');
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('confirmed');
    expect(transactionsStore.size).toBe(0);
  });

  // 38. terminal conflict: expired -> canceled -> no silent historical rewrite
  it('38. terminal conflict: expired -> canceled -> no silent historical rewrite', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'expired';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.checkout_attempts[0].expiry_confirmed_at = '2026-09-12T10:36:00.000Z';
    tr.checkout_attempts[0].provider_expired_at = '2026-09-12T10:36:00.000Z';
    planChangesStore.set(tr.id, tr);

    const cancelEvent = {
      providerEventId: 'evt_late_canceled_after_exp',
      eventType: 'checkout_canceled' as const,
      providerCheckoutId: 'chk_adj_001',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      cancelEvent,
      tr,
      new Date('2026-09-12T10:45:00.000Z')
    );

    expect(res.processed).toBe(true);
    expect(res.reason).toBe('attempt_already_expired');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    const att = reloaded.checkout_attempts[0];
    expect(att.status).toBe('expired');
    expect(att.cancel_state).toBeUndefined(); // Never rewritten to canceled!
    expect(att.expiry_confirmed_at).toBe('2026-09-12T10:36:00.000Z');
    expect(reloaded.transition_status).toBe('scheduled');
    expect(transactionsStore.size).toBe(0);
  });

  // 39. terminal conflict: canceled -> expired -> no silent historical rewrite
  it('39. terminal conflict: canceled -> expired -> no silent historical rewrite', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'canceled';
    tr.checkout_attempts[0].cancel_state = 'confirmed';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.checkout_attempts[0].cancellation_confirmed_at = '2026-09-12T10:25:00.000Z';
    planChangesStore.set(tr.id, tr);

    const expiredEvent = {
      providerEventId: 'evt_late_expired_after_cancel',
      eventType: 'checkout_expired' as const,
      providerCheckoutId: 'chk_adj_001',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      expiredEvent,
      tr,
      new Date('2026-09-12T10:45:00.000Z')
    );

    expect(res.processed).toBe(true);
    expect(res.reason).toBe('attempt_already_canceled');

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    const att = reloaded.checkout_attempts[0];
    expect(att.status).toBe('canceled');
    expect(att.cancel_state).toBe('confirmed');
    expect(att.expiry_confirmed_at).toBeUndefined(); // Never rewritten to expired!
    expect(reloaded.transition_status).toBe('scheduled');
    expect(transactionsStore.size).toBe(0);
  });

  // 40. late settlement after safe CANCELED -> stale ledger + attention, zero entitlement
  it('40. late settlement after safe CANCELED -> stale ledger + attention, zero entitlement', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'canceled';
    tr.checkout_attempts[0].cancel_state = 'confirmed';
    tr.checkout_attempts[0].provider_session_terminal = true;
    tr.early_activation_status = 'available';
    planChangesStore.set(tr.id, tr);

    const lateConfirmedEvent = {
      providerEventId: 'evt_late_confirmed_cancel',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_late_settled_cancel',
      providerCheckoutId: 'chk_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
      confirmedDate: '2026-09-12T12:00:00.000Z',
    };

    const res = await (billingService as any).handleV1PaidToPaidWebhook(
      lateConfirmedEvent,
      tr,
      new Date('2026-09-12T12:05:00.000Z')
    );

    expect(res.processed).toBe(false);
    expect(res.reason).toBe('CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT');

    const tx = transactionsStore.get('asaas_pay_late_settled_cancel');
    expect(tx).toBeDefined();
    expect(tx?.status).toBe('paid');
    expect(tx?.amount_cents).toBe(1333);

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.financial_attention_required).toBe(true);
    expect(reloaded.financial_attention_reason).toBe('CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT');
    expect(reloaded.early_activation_status).not.toBe('activated');
    expect(reloaded.transition_status).toBe('scheduled');
  });

  // 41. terminal attempt (expired or canceled) receives CHECKOUT_PAID -> ignored, zero entitlement, zero BillingTransaction
  it('41. terminal attempt (expired or canceled) receives CHECKOUT_PAID -> ignored, zero entitlement, zero BillingTransaction', async () => {
    // Part A: expired attempt
    const trExpired = getBaseScheduledTransition();
    trExpired.checkout_attempts[0].status = 'expired';
    trExpired.checkout_attempts[0].provider_session_terminal = true;
    planChangesStore.set(trExpired.id, trExpired);

    const resExp = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_chk_paid_exp', eventType: 'checkout_paid', providerCheckoutId: 'chk_adj_001' },
      trExpired,
      new Date('2026-09-12T10:40:00.000Z')
    );
    expect(resExp.reason).toBe('checkout_paid_on_canceled_attempt_ignored');

    // Part B: canceled attempt
    const trCanceled = getBaseScheduledTransition();
    trCanceled.checkout_attempts[0].status = 'canceled';
    trCanceled.checkout_attempts[0].cancel_state = 'confirmed';
    trCanceled.checkout_attempts[0].provider_session_terminal = true;
    planChangesStore.set(trCanceled.id, trCanceled);

    const resCancel = await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_chk_paid_cancel', eventType: 'checkout_paid', providerCheckoutId: 'chk_adj_001' },
      trCanceled,
      new Date('2026-09-12T10:40:00.000Z')
    );
    expect(resCancel.reason).toBe('checkout_paid_on_canceled_attempt_ignored');

    expect(transactionsStore.size).toBe(0);
    const reloaded = await mockBillingRepo.getTransitionById(trCanceled.id);
    expect(reloaded.early_activation_status).not.toBe('activated');
  });

  // 42. no target recurrence mutation across all terminal conflict cases
  it('42. no target recurrence mutation across all terminal conflict cases', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'expired';
    tr.checkout_attempts[0].provider_session_terminal = true;
    planChangesStore.set(tr.id, tr);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_recurrence_check', eventType: 'checkout_canceled', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.future_provider_subscription_id).toBe('sub_target_new');
    expect(reloaded.future_provider_payment_id).toBe('pay_target_renewal_001');
    expect(reloaded.future_provider_checkout_id).toBe('chk_future_001');
  });

  // 43. global transition remains scheduled and global slot remains HELD across all terminal conflict cases
  it('43. global transition remains scheduled and global slot remains HELD across all terminal conflict cases', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].status = 'canceled';
    tr.checkout_attempts[0].cancel_state = 'confirmed';
    planChangesStore.set(tr.id, tr);

    await (billingService as any).handleV1PaidToPaidWebhook(
      { providerEventId: 'evt_slot_check', eventType: 'checkout_expired', providerCheckoutId: 'chk_adj_001' },
      tr,
      new Date('2026-09-12T10:40:00.000Z')
    );

    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.transition_status).toBe('scheduled');

    const slot = await mockBillingRepo.getActiveTransitionSlot('min_test_1', 'asaas');
    expect(slot).toBeDefined();
    expect(slot.plan_change_id).toBe(tr.id);
  });

  // 44. explicit cancel: provider cancel 5xx -> cancel_state uncertain, no blind retry
  it('44. explicit cancel: provider cancel 5xx -> cancel_state uncertain, no blind retry', async () => {
    const tr = getBaseScheduledTransition();
    const attempt = tr.checkout_attempts[0];
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);
    mockProvider.cancelCheckout.mockRejectedValue(
      new AppError(502, 'Bad Gateway from Asaas', { code: 'GATEWAY_ERROR' })
    );

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: attempt,
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('cancellation_outcome_uncertain');
    const reloaded = await mockBillingRepo.getTransitionById(tr.id);
    expect(reloaded.checkout_attempts[0].cancel_state).toBe('uncertain');
  });

  // 45. Crash D recovery: attempt already confirmed canceled -> re-execution is idempotent safe no-op
  it('45. Crash D recovery: attempt already confirmed canceled -> re-execution is idempotent safe no-op', async () => {
    const tr = getBaseScheduledTransition();
    tr.checkout_attempts[0].cancel_state = 'confirmed';
    tr.checkout_attempts[0].status = 'canceled';
    planChangesStore.set(tr.id, tr);

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: tr.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.reason).toBe('already_canceled');
  });

  // 46. Crash E / concurrency: CAS intent conflict fails safely without mutating
  it('46. Crash E / concurrency: CAS intent conflict fails safely without mutating', async () => {
    const tr = getBaseScheduledTransition();
    mockBillingRepo.recordEarlyActivationCheckoutCancelAttempting.mockRejectedValueOnce(
      new Error('CAS precondition failed: cancel already in progress')
    );
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

    const res = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: tr,
      currentAttempt: tr.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.reason).toBe('cancel_intent_cas_conflict');
  });

  // 47. worker / payment-webhook race: payment materializes during explicit cancel -> caught by postflight gate
  it('47. worker / payment-webhook race: payment materializes during explicit cancel -> caught by postflight gate', async () => {
    // Case A: CONFIRMED payment materializes -> promotes early activation settlement
    const trA = getBaseScheduledTransition();
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]); // preflight clear
    mockProvider.cancelCheckout.mockResolvedValue({ success: true, status: 'CANCELED' });
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_race_settled',
        status: 'CONFIRMED',
        amountCents: 1333,
        customerId: 'cus_test_1',
        confirmedDate: '2026-09-12T10:20:30.000Z',
      },
    ]);

    const resA = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: trA,
      currentAttempt: trA.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(resA.success).toBe(true);
    expect(resA.reason).toBe('early_activation_settled_and_promoted');
    const reloadedA = await mockBillingRepo.getTransitionById(trA.id);
    expect(reloadedA.early_activation_status).toBe('activated');

    // Case B: PENDING payment materializes -> blocks cleanup, sets financial attention
    const trB = getBaseScheduledTransition();
    trB.id = 'tr_scheduled_early_race_b';
    trB.transition_id = 'tr_scheduled_early_race_b';
    planChangesStore.set(trB.id, trB);
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]); // preflight clear
    mockProvider.cancelCheckout.mockResolvedValue({ success: true, status: 'CANCELED' });
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_race_pending',
        status: 'PENDING',
        amountCents: 1333,
        customerId: 'cus_test_1',
      },
    ]);

    const resB = await billingService.executeExpiredEarlyActivationCheckoutCleanup({
      claimed: trB,
      currentAttempt: trB.checkout_attempts[0],
      knownCheckoutId: 'chk_adj_001',
      now: new Date('2026-09-12T10:20:00.000Z'),
    });

    expect(resB.success).toBe(false);
    expect(resB.reason).toBe('materialized_payment_blocks_checkout_cleanup');
    const reloadedB = await mockBillingRepo.getTransitionById(trB.id);
    expect(reloadedB.financial_attention_required).toBe(true);
    expect(reloadedB.financial_attention_reason).toBe('materialized_payment_blocks_checkout_cleanup');
  });
});
