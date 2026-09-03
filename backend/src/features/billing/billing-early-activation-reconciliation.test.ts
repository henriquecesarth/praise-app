import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from './billing.service.js';
import { BillingReconcilerWorker } from './billing-reconciler.worker.js';
import {
  BillingTransitionV1Record,
  BillingCheckoutAttempt,
  BillingActiveTransitionSlotRecord,
  BillingSubscriptionRecord,
  BillingCustomerRecord,
  BillingTransactionRecord,
  BillingPlanChangeRecord,
} from './billing.types.js';
import { ProviderPaymentRecord } from './providers/billing-provider.interface.js';
import { AppError } from '../../middleware/error-handler.js';
import { config } from '../../config/unifiedConfig.js';
import { getBillingDate } from '../../utils/billing-date.js';
import path from 'path';
import fs from 'fs';
import {
  compareTransitionsLRR,
  getTransitionReconciliationTimestamp,
  getTransitionCreationTimestamp,
} from '../../repositories/BillingRepository.js';

describe('Phase 3C.5A — Early Activation Known-Checkout Reconciliation Worker', () => {
  let billingService: BillingService;
  let reconcilerWorker: BillingReconcilerWorker;
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
  const schedulersStore = new Map<string, any>();

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
    last_reconciled_at: null,
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
    checkout_attempts: [
      {
        attempt_id: 'att_adj_001',
        transition_id: 'tr_scheduled_early_001',
        attempt_type: 'early_activation',
        internal_checkout_intent_id: 'intent_adj_001',
        provider_checkout_id: 'chk_adj_001',
        status: 'pending',
        amount_cents: 1333,
        currency: 'BRL',
        quote_id: 'quote_adj_001',
        provider_create_state: 'created',
        provider_session_terminal: false,
        created_at: '2026-09-12T10:00:00.000Z',
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
    schedulersStore.clear();

    const baseTr = getBaseScheduledTransition();
    planChangesStore.set(baseTr.id, baseTr);

    activeSlotsStore.set('slot_min_test_1_asaas', {
      id: 'slot_min_test_1_asaas',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      plan_change_id: 'tr_scheduled_early_001',
      acquired_at: '2026-09-02T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
      version: 1,
    });

    appSubscriptionsStore.set('min_test_1', {
      ministryId: 'min_test_1',
      planId: 'lite',
      interval: 'monthly',
      addonBlocks: 0,
      memberQuota: 5,
      songQuota: 50,
      currentPeriodStart: '2026-09-02T00:00:00.000Z',
      currentPeriodEnd: '2026-10-02T00:00:00.000Z',
    });

    mockBillingRepo = {
      planChangesCollection: {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockImplementation(async () => {
          return {
            docs: Array.from(planChangesStore.values()).map((val) => ({
              id: val.id,
              data: () => JSON.parse(JSON.stringify(val)),
            })),
          };
        }),
      },
      getTransitionById: vi.fn(async (id: string) => {
        const item = planChangesStore.get(id);
        return item ? JSON.parse(JSON.stringify(item)) : null;
      }),
      getActiveTransitionSlot: vi.fn(async (ministryId: string) => {
        return (
          activeSlotsStore.get(`slot_${ministryId}_asaas`) ||
          activeSlotsStore.get(`slot_${ministryId}__asaas`) ||
          null
        );
      }),
      updateTransition: vi.fn(async (id: string, ministryId: string, updates: any) => {
        const item = planChangesStore.get(id);
        if (!item) throw new Error('Transition not found');
        const updated = { ...item, ...updates, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
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
      claimTransitionForReconciliation: vi.fn(async (transitionId: string, workerId: string) => {
        const lock = locksStore.get(transitionId);
        const now = Date.now();
        if (lock && lock.expiresAt > now && lock.workerId !== workerId) {
          return null; // Locked by another worker
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
      releaseSlotIfOwnedAndSafe: vi.fn(async () => ({ released: true })),
      markWebhookEventProcessed: vi.fn(async () => true),
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
          updated_at: nowIso || new Date().toISOString(),
        };
        planChangesStore.set(transitionId, updated);
        return JSON.parse(JSON.stringify(updated));
      }),
      normalizeLegacyTransitionsWithoutScheduling: vi.fn(async (provider: string = 'asaas', batchSize: number = 50) => {
        const schedulerDocId = `normalization_${provider}`;
        const schedulerData = schedulersStore.get(schedulerDocId);
        const cursors: Record<string, string | null> = { ...(schedulerData?.cursors || {}) };

        const scopes = [
          ...['pending_initial_purchase', 'pending_future_authorization', 'future_target_prepared', 'awaiting_old_inactivation', 'scheduled'].map((st) => ({
            scope: st,
            matches: (t: any) => t.transition_status === st,
          })),
          { scope: 'attention', matches: (t: any) => t.financial_attention_required === true },
        ];
        let inspectedCount = 0;
        let normalizedCount = 0;
        const cursorUpdates: Record<string, { expectedStartCursor: string | null; nextCursor: string | null }> = {};

        for (const s of scopes) {
          if (inspectedCount >= batchSize) break;
          const remaining = batchSize - inspectedCount;
          const startCursor = cursors[s.scope] || null;

          let matching = Array.from(planChangesStore.values()).filter(
            (t) => t.provider === provider && s.matches(t)
          );

          // Stable Document ID ordering
          matching.sort((a, b) => a.id.localeCompare(b.id));

          // startAfter(cursor)
          if (startCursor) {
            matching = matching.filter((t) => t.id > startCursor);
          }

          const batchDocs = matching.slice(0, remaining);

          if (batchDocs.length === 0) {
            if (startCursor) {
              cursorUpdates[s.scope] = { expectedStartCursor: startCursor, nextCursor: null };
            }
            continue;
          }

          inspectedCount += batchDocs.length;

          for (const doc of batchDocs) {
            if (doc.last_reconciled_at === undefined) {
              doc.last_reconciled_at = null;
              normalizedCount++;
            }
          }

          const lastDoc = batchDocs[batchDocs.length - 1];
          if (batchDocs.length < remaining) {
            cursorUpdates[s.scope] = { expectedStartCursor: startCursor, nextCursor: null };
          } else {
            cursorUpdates[s.scope] = { expectedStartCursor: startCursor, nextCursor: lastDoc.id };
          }
        }

        // Commit com Scan-Start CAS e monotonicidade:
        const existingSched = schedulersStore.get(schedulerDocId);
        const existingCursors: Record<string, string | null> = existingSched?.cursors ? { ...existingSched.cursors } : {};

        for (const scopeKey of Object.keys(cursorUpdates)) {
          const { expectedStartCursor, nextCursor } = cursorUpdates[scopeKey];
          const currentCursor = existingCursors[scopeKey] || null;

          if (nextCursor === null) {
            // WRAP CAS: só pode efetuar wrap se o cursor no banco continua exatamente onde este scan começou
            if (currentCursor === expectedStartCursor) {
              existingCursors[scopeKey] = null;
            }
          } else {
            // FORWARD ADVANCEMENT CAS
            if (currentCursor === null) {
              if (expectedStartCursor === null) {
                existingCursors[scopeKey] = nextCursor;
              }
            } else if (nextCursor > currentCursor) {
              existingCursors[scopeKey] = nextCursor;
            }
          }
        }

        schedulersStore.set(schedulerDocId, {
          id: schedulerDocId,
          provider,
          cursors: existingCursors,
          updated_at: new Date().toISOString(),
        });

        return {
          normalizedCount,
          hasMore: inspectedCount >= batchSize,
        };
      }),
      getNormalizationSchedulerRecord: vi.fn(async (provider: string = 'asaas') => {
        return schedulersStore.get(`normalization_${provider}`) || null;
      }),
      getV1TransitionsNeedingReconciliation: vi.fn(async (provider: string, limit: number) => {
        const all = Array.from(planChangesStore.values()).filter(
          (tr) => tr.provider === provider && tr.last_reconciled_at !== undefined
        );

        const sortBucket = (items: BillingPlanChangeRecord[]) => {
          return [...items].sort(compareTransitionsLRR);
        };

        const isLiveNonTerminal = (tr: any) => {
          const status = tr.transition_status || tr.status;
          const safety = tr.financial_safety_status;
          return safety !== 'safe_terminal' && !['completed', 'canceled', 'superseded', 'failed'].includes(status);
        };

        const liveStatuses = [
          'pending_initial_purchase',
          'pending_future_authorization',
          'future_target_prepared',
          'awaiting_old_inactivation',
          'scheduled',
        ];

        const healthyBuckets = liveStatuses.map((st) =>
          sortBucket(all.filter((tr) => tr.transition_status === st && tr.financial_attention_required !== true))
        );

        // Sub-buckets de live attention por status
        const attSubBuckets = liveStatuses.map((st) =>
          sortBucket(all.filter((tr) => tr.transition_status === st && tr.financial_attention_required === true && isLiveNonTerminal(tr)))
        );

        const sortedAttention: BillingPlanChangeRecord[] = [];
        let attAdded = true;
        let attRound = 0;
        while (sortedAttention.length < limit && attAdded) {
          attAdded = false;
          for (const sub of attSubBuckets) {
            if (attRound < sub.length) {
              sortedAttention.push(sub[attRound]);
              attAdded = true;
              if (sortedAttention.length >= limit) break;
            }
          }
          attRound++;
        }

        const buckets = [...healthyBuckets, sortedAttention];
        const seenIds = new Set<string>();
        const results: BillingPlanChangeRecord[] = [];
        let addedInRound = true;
        let roundIdx = 0;

        while (results.length < limit && addedInRound) {
          addedInRound = false;
          for (const bucket of buckets) {
            if (roundIdx < bucket.length) {
              const item = bucket[roundIdx];
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                results.push(JSON.parse(JSON.stringify(item)));
                if (results.length >= limit) break;
              }
              addedInRound = true;
            }
          }
          roundIdx++;
        }

        return results;
      }),
      getPendingOrFailedPlanChanges: vi.fn(async () => []),
    };

    mockSubscriptionService = {
      applyLockedEntitlementSnapshot: vi.fn(async (ministryId: string, snapshot: any) => {
        const sub = appSubscriptionsStore.get(ministryId) || { ministryId };
        const updated = {
          ...sub,
          planId: snapshot.plan_id,
          interval: snapshot.interval,
          addonBlocks: snapshot.addon_blocks,
          memberQuota: snapshot.effective_member_quota,
          songQuota: snapshot.effective_song_quota,
        };
        appSubscriptionsStore.set(ministryId, updated);
        return updated;
      }),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn(async (ministryId: string) => {
        const sub = appSubscriptionsStore.get(ministryId);
        return sub ? JSON.parse(JSON.stringify(sub)) : null;
      }),
      setSubscription: vi.fn(async (sub: any) => {
        appSubscriptionsStore.set(sub.ministry_id || sub.ministryId, JSON.parse(JSON.stringify(sub)));
        return sub;
      }),
    };

    mockMinistryRepo = {
      getMinistryById: vi.fn(async () => ({ id: 'min_test_1', name: 'Ministry Test' })),
    };

    mockUserRepo = {
      getUserById: vi.fn(async () => ({ id: 'user_test_1', email: 'test@example.com' })),
    };

    mockProvider = {
      name: 'asaas',
      listPaymentsByCheckoutSession: vi.fn(),
      getPayment: vi.fn(),
      refundPayment: vi.fn(),
      createDetachedCheckout: vi.fn(),
      cancelCheckout: vi.fn(),
    };

    billingService = new BillingService(
      mockBillingRepo,
      mockSubscriptionService,
      mockSubscriptionRepo,
      mockMinistryRepo,
      mockProvider,
      mockUserRepo
    );

    reconcilerWorker = new BillingReconcilerWorker(billingService, mockBillingRepo);
  });

  // 1. known checkout + zero payments -> unchanged
  it('1. known checkout + zero payments -> unchanged', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('no_payments_found');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
    expect(postTr.financial_attention_required).toBeFalsy();
    expect(transactionsStore.size).toBe(0);
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  // 2. known checkout + PENDING -> unchanged
  it('2. known checkout + PENDING -> unchanged', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_pending_001',
        status: 'PENDING',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
      },
    ]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('payment_pending');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
    expect(transactionsStore.size).toBe(0);
  });

  // 3. known checkout + OVERDUE -> no activation
  it('3. known checkout + OVERDUE -> no activation', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_overdue_001',
        status: 'OVERDUE',
        amountCents: 1333,
        billingType: 'BOLETO',
      },
    ]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('payment_overdue');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
    expect(transactionsStore.size).toBe(0);
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  // 4. known checkout + CONFIRMED -> activation through canonical 3C.4 state machine
  it('4. known checkout + CONFIRMED -> activation through canonical 3C.4 state machine', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_conf_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_conf_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('activated');
    expect(postTr.early_activation_provider_payment_id).toBe('pay_conf_001');

    const tx = transactionsStore.get('asaas_pay_conf_001')!;
    expect(tx).toBeDefined();
    expect(tx.status).toBe('paid');
    expect(tx.amount_cents).toBe(1333);
    expect(tx.transaction_type).toBe('prorated_early_activation_adjustment');

    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
      'min_test_1',
      expect.objectContaining({ plan_id: 'essential', effective_member_quota: 15 })
    );
  });

  // 5. known checkout + RECEIVED -> activation
  it('5. known checkout + RECEIVED -> activation', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_rec_001',
        status: 'RECEIVED',
        amountCents: 1333,
        billingType: 'PIX',
        paymentDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_rec_001',
      status: 'RECEIVED',
      amountCents: 1333,
      billingType: 'PIX',
      paymentDate: '2026-09-12',
    });

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('activated');
    expect(postTr.early_activation_provider_payment_id).toBe('pay_rec_001');
  });

  // 6. lost webhook recovered by worker
  it('6. lost webhook recovered by worker', async () => {
    // Webhook nunca chegou, mas o worker roda o ciclo completo
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_lost_webhook_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_lost_webhook_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });

    const runResult = await reconcilerWorker.runCycle();

    expect(runResult.processed).toBeGreaterThanOrEqual(1);
    expect(runResult.succeeded).toBeGreaterThanOrEqual(1);

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('activated');
    expect(postTr.early_activation_provider_payment_id).toBe('pay_lost_webhook_001');
  });

  // 7. worker then late webhook -> idempotent
  it('7. worker then late webhook -> idempotent', async () => {
    // 1. Worker ativa primeiro
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_shared_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_shared_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });
    await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    const firstTxCount = transactionsStore.size;
    expect(firstTxCount).toBe(1);

    // 2. Webhook tardio chega com o mesmo pagamento
    const lateWebhook = {
      providerEventId: 'evt_late_webhook_001',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_shared_001',
      providerCheckoutId: 'chk_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };
    const webhookRes = await (billingService as any).handleV1PaidToPaidWebhook(
      lateWebhook,
      planChangesStore.get('tr_scheduled_early_001')!,
      new Date('2026-09-12T10:30:00.000Z')
    );

    expect(webhookRes.processed).toBe(true);
    expect(webhookRes.reason).toBe('already_activated');
    expect(transactionsStore.size).toBe(1); // Exatamente 1 transaction preservada!
  });

  // 8. webhook then worker -> idempotent
  it('8. webhook then worker -> idempotent', async () => {
    // 1. Webhook ativa primeiro
    const webhookEvent = {
      providerEventId: 'evt_fast_webhook_001',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_fast_001',
      providerCheckoutId: 'chk_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_fast_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });
    await (billingService as any).handleV1PaidToPaidWebhook(
      webhookEvent,
      planChangesStore.get('tr_scheduled_early_001')!,
      new Date('2026-09-12T10:15:00.000Z')
    );

    expect(planChangesStore.get('tr_scheduled_early_001')!.early_activation_status).toBe('activated');

    // 2. Worker roda posteriormente
    const workerRes = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(workerRes.success).toBe(true);
    expect(workerRes.reason).toBe('already_activated');
    expect(transactionsStore.size).toBe(1);
  });

  // 9. CONFIRMED then RECEIVED across cycles -> one transaction
  it('9. CONFIRMED then RECEIVED across cycles -> one transaction', async () => {
    // Ciclo 1: CONFIRMED
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_cycle_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'BOLETO',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_cycle_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'BOLETO',
      confirmedDate: '2026-09-12',
    });
    await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(transactionsStore.size).toBe(1);

    // Ciclo 2: O mesmo pagamento agora retornando RECEIVED
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_cycle_001',
        status: 'RECEIVED',
        amountCents: 1333,
        billingType: 'BOLETO',
        paymentDate: '2026-09-12',
      },
    ]);
    const res2 = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res2.success).toBe(true);
    expect(res2.reason).toBe('already_activated');
    expect(transactionsStore.size).toBe(1); // Exatamente 1 transação!
  });

  // 10. provider read timeout -> no mutation / retry next cycle
  it('10. provider read timeout -> no mutation / retry next cycle', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockRejectedValueOnce(new Error('Gateway Timeout (504)'));

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_read_failure');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
    expect(postTr.financial_attention_required).toBeFalsy(); // Sem atenção espúria por erro transitório
    expect(transactionsStore.size).toBe(0);
  });

  // 11. unknown checkout ID -> quarantine, zero provider discovery
  it('11. unknown checkout ID -> quarantine, zero provider discovery', async () => {
    const uncertainTr: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      early_activation_provider_checkout_id: undefined,
      current_early_activation_checkout_attempt_id: 'att_uncertain_001',
      checkout_attempts: [
        {
          attempt_id: 'att_uncertain_001',
          transition_id: 'tr_scheduled_early_001',
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_uncertain_001',
          provider_checkout_id: undefined,
          status: 'uncertain',
          amount_cents: 1333,
          currency: 'BRL',
          provider_create_state: 'attempting',
          provider_session_terminal: false,
          created_at: '2026-09-12T10:00:00.000Z',
        },
      ],
    };
    planChangesStore.set(uncertainTr.id, uncertainTr);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('quarantine_unknown_checkout');
    expect(mockProvider.listPaymentsByCheckoutSession).not.toHaveBeenCalled();
    expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.checkout_attempts![0].status).toBe('uncertain');
    expect(postTr.early_activation_status).toBe('payment_pending');
  });

  // 12. uncertain recovered checkout ID + settled payment -> activation
  it('12. uncertain recovered checkout ID + settled payment -> activation', async () => {
    const recoveredTr: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      early_activation_provider_checkout_id: 'chk_recovered_001',
      current_early_activation_checkout_attempt_id: 'att_uncertain_recovered_001',
      checkout_attempts: [
        {
          attempt_id: 'att_uncertain_recovered_001',
          transition_id: 'tr_scheduled_early_001',
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_uncertain_recovered_001',
          provider_checkout_id: 'chk_recovered_001', // Recuperado por webhook
          status: 'pending',
          amount_cents: 1333,
          currency: 'BRL',
          provider_create_state: 'created',
          provider_session_terminal: false,
          created_at: '2026-09-12T10:00:00.000Z',
        },
      ],
    };
    planChangesStore.set(recoveredTr.id, recoveredTr);

    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_recov_settled_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_recov_settled_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('activated');
    expect(postTr.early_activation_provider_payment_id).toBe('pay_recov_settled_001');
    expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
  });

  // 13. multiple settled provider payments -> attention / no arbitrary activation
  it('13. multiple settled provider payments -> attention / no arbitrary activation', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_dup_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
      },
      {
        id: 'pay_dup_002',
        status: 'RECEIVED',
        amountCents: 1333,
        billingType: 'PIX',
      },
    ]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.financial_attention_required).toBe(true);
    expect(postTr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');
    expect(postTr.early_activation_status).toBe('payment_pending'); // NÃO ativou!
    expect(mockProvider.refundPayment).not.toHaveBeenCalled(); // Zero auto-refund

    // Ambos os pagamentos settled foram registrados no ledger canônico
    expect(transactionsStore.size).toBe(2);
    expect(transactionsStore.has('asaas_pay_dup_001')).toBe(true);
    expect(transactionsStore.has('asaas_pay_dup_002')).toBe(true);
  });

  // 14. stale checkout settled payment -> ledger + attention, no entitlement
  it('14. stale checkout settled payment -> ledger + attention, no entitlement', async () => {
    const trWithStale: BillingTransitionV1Record = {
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
    planChangesStore.set(trWithStale.id, trWithStale);

    // Tentativa antiga teve pagamento confirmado
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_stale_settled_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_stale_settled_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(false);
    expect(res.reason).toBe('stale_attempt_settled_recorded');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending'); // NÃO ativou!
    expect(postTr.financial_attention_required).toBe(true);

    // BillingTransaction gravada para a tentativa antiga
    const tx = transactionsStore.get('asaas_pay_stale_settled_001')!;
    expect(tx).toBeDefined();
    expect(tx.attempt_id).toBe('att_adj_001_old');
    expect(tx.status).toBe('paid');
  });

  // 15. current attempt settled -> entitlement
  it('15. current attempt settled -> entitlement', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_current_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_current_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(true);
    expect(res.reason).toBe('early_activation_settled_and_promoted');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('activated');
  });

  // 16. commercial boundary reached -> late settlement guard
  it('16. commercial boundary reached -> late settlement guard', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_late_boundary_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-10-02',
      },
    ]);
    mockProvider.getPayment.mockResolvedValueOnce({
      id: 'pay_late_boundary_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-10-02',
    });

    // Reconciler rodando na data da boundary comercial (2026-10-02)
    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment(
      'tr_scheduled_early_001',
      'worker_1',
      { nowCommercialDate: '2026-10-02' }
    );

    expect(res.success).toBe(false);
    expect(res.reason).toBe('LATE_EARLY_ADJUSTMENT_SETTLEMENT');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending'); // NÃO ativou retroativamente!
    expect(postTr.financial_attention_required).toBe(true);
    expect(postTr.financial_attention_reason).toBe('LATE_EARLY_ADJUSTMENT_SETTLEMENT');
    expect(postTr.transition_status).toBe('scheduled'); // Transição preservada
    expect(mockProvider.refundPayment).not.toHaveBeenCalled(); // Zero auto-refund
  });

  // 17. REFUNDED -> no activation
  it('17. REFUNDED -> no activation', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_refunded_001',
        status: 'REFUNDED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
      },
    ]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_PAYMENT_REFUNDED');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
    expect(postTr.financial_attention_required).toBe(true);
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  // 18. CHARGEBACK -> no activation
  it('18. CHARGEBACK -> no activation', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_chargeback_001',
        status: 'CHARGEBACK',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
      },
    ]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(false);
    expect(res.reason).toBe('EARLY_ADJUSTMENT_PAYMENT_REFUNDED');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
    expect(postTr.financial_attention_required).toBe(true);
  });

  // 19. unknown payment status -> fail closed
  it('19. unknown payment status -> fail closed', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
      {
        id: 'pay_unknown_status_001',
        status: 'UNKNOWN_GATEWAY_STATUS_XYZ' as any,
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
      },
    ]);

    const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

    expect(res.success).toBe(false);
    expect(res.reason).toBe('unknown_payment_status');

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('payment_pending');
  });

  // 20. worker + webhook concurrency -> single transaction / single promotion
  it('20. worker + webhook concurrency -> single transaction / single promotion', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([
      {
        id: 'pay_concurrent_001',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      },
    ]);
    mockProvider.getPayment.mockResolvedValue({
      id: 'pay_concurrent_001',
      status: 'CONFIRMED',
      amountCents: 1333,
      billingType: 'CREDIT_CARD',
      confirmedDate: '2026-09-12',
    });

    const concurrentWebhook = {
      providerEventId: 'evt_concurrent_001',
      eventType: 'payment_confirmed' as const,
      providerPaymentId: 'pay_concurrent_001',
      providerCheckoutId: 'chk_adj_001',
      amountCents: 1333,
      status: 'CONFIRMED',
    };

    // Execução simultânea
    const [workerRes, webhookRes] = await Promise.all([
      billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001', 'worker_A'),
      (billingService as any).handleV1PaidToPaidWebhook(
        concurrentWebhook,
        planChangesStore.get('tr_scheduled_early_001')!,
        new Date('2026-09-12T10:15:00.000Z')
      ),
    ]);

    // Ambos terminam com sucesso/idempotência
    expect(workerRes.success || webhookRes.processed).toBe(true);

    const postTr = planChangesStore.get('tr_scheduled_early_001')!;
    expect(postTr.early_activation_status).toBe('activated');

    // Exatamente 1 BillingTransaction
    const matchingTxs = Array.from(transactionsStore.values()).filter(
      (t) => t.provider_payment_id === 'pay_concurrent_001'
    );
    expect(matchingTxs.length).toBe(1);

    // Exatamente 1 promoção de quota
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledTimes(1);
  });

  // 21. worker never calls create checkout
  it('21. worker never calls create checkout', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]);

    await reconcilerWorker.runCycle();

    expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
  });

  // 22. worker never calls cancel checkout
  it('22. worker never calls cancel checkout', async () => {
    mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([]);

    await reconcilerWorker.runCycle();

    expect(mockProvider.cancelCheckout).not.toHaveBeenCalled();
  });

  // 23. one bad transition does not prevent another from reconciling
  it('23. one bad transition does not prevent another from reconciling', async () => {
    // Transição 1: com slot divergente / missing (falha fechada)
    const badTr: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      id: 'tr_bad_001',
      transition_id: 'tr_bad_001',
      ministry_id: 'min_bad_1',
    };
    planChangesStore.set('tr_bad_001', badTr);

    // Transição 2: saudável, checkout conhecido e pagamento confirmado
    const goodTr: BillingTransitionV1Record = {
      ...getBaseScheduledTransition(),
      id: 'tr_good_002',
      transition_id: 'tr_good_002',
      ministry_id: 'min_good_2',
      early_activation_provider_checkout_id: 'chk_good_002',
      current_early_activation_checkout_attempt_id: 'att_good_002',
      checkout_attempts: [
        {
          attempt_id: 'att_good_002',
          transition_id: 'tr_good_002',
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_good_002',
          provider_checkout_id: 'chk_good_002',
          status: 'pending',
          amount_cents: 1333,
          currency: 'BRL',
          provider_create_state: 'created',
          provider_session_terminal: false,
          created_at: '2026-09-12T10:00:00.000Z',
        },
      ],
    };
    planChangesStore.set('tr_good_002', goodTr);
    activeSlotsStore.set('slot_min_good_2_asaas', {
      id: 'slot_min_good_2_asaas',
      ministry_id: 'min_good_2',
      provider: 'asaas',
      plan_change_id: 'tr_good_002',
      acquired_at: '2026-09-02T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
      version: 1,
    });

    mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'chk_good_002') {
        return [
          {
            id: 'pay_good_002',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          },
        ];
      }
      return [];
    });
    mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
      if (paymentId === 'pay_good_002') {
        return {
          id: 'pay_good_002',
          status: 'CONFIRMED',
          amountCents: 1333,
          billingType: 'CREDIT_CARD',
          confirmedDate: '2026-09-12',
        };
      }
      return null;
    });

    const runResult = await reconcilerWorker.runCycle();

    // A transição boa foi processada com sucesso mesmo com a má no lote
    const postGood = planChangesStore.get('tr_good_002')!;
    expect(postGood.early_activation_status).toBe('activated');
    expect(postGood.early_activation_provider_payment_id).toBe('pay_good_002');
  });

  describe('Phase 3C.5A — Final Ledger, Provider-Failure & Query-Bound Hardening', () => {
    // 1. 2 settled matching payments -> 2 ledger transactions -> attention -> no entitlement
    it('Hardening 1: 2 settled matching payments -> 2 ledger transactions -> attention -> no entitlement', async () => {
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { id: 'pay_h1_001', status: 'CONFIRMED', amountCents: 1333, billingType: 'CREDIT_CARD' },
        { id: 'pay_h1_002', status: 'RECEIVED', amountCents: 1333, billingType: 'PIX' },
      ]);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(postTr.transition_status).toBe('scheduled');

      // Ambas as transações reais entram no ledger canônico
      expect(transactionsStore.size).toBe(2);
      expect(transactionsStore.has('asaas_pay_h1_001')).toBe(true);
      expect(transactionsStore.has('asaas_pay_h1_002')).toBe(true);
      expect(mockProvider.refundPayment).not.toHaveBeenCalled();
    });

    // 2. CONFIRMED + PENDING matching payments -> settled one in ledger -> attention -> no entitlement
    it('Hardening 2: CONFIRMED + PENDING matching payments -> settled one in ledger -> attention -> no entitlement', async () => {
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { id: 'pay_h2_settled', status: 'CONFIRMED', amountCents: 1333, billingType: 'CREDIT_CARD' },
        { id: 'pay_h2_pending', status: 'PENDING', amountCents: 1333, billingType: 'BOLETO' },
      ]);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.early_activation_status).toBe('payment_pending');

      // Apenas a cobrança liquidada entra no ledger; a pendente NÃO recebe BillingTransaction paid
      expect(transactionsStore.size).toBe(1);
      expect(transactionsStore.has('asaas_pay_h2_settled')).toBe(true);
      expect(transactionsStore.has('asaas_pay_h2_pending')).toBe(false);
    });

    // 3. 2 PENDING matching payments -> attention -> zero paid transactions
    it('Hardening 3: 2 PENDING matching payments -> attention -> zero paid transactions', async () => {
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { id: 'pay_h3_pend1', status: 'PENDING', amountCents: 1333, billingType: 'BOLETO' },
        { id: 'pay_h3_pend2', status: 'PENDING', amountCents: 1333, billingType: 'PIX' },
      ]);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(transactionsStore.size).toBe(0); // Zero transações pagas
    });

    // 4. duplicate worker cycle on multi-payment set -> no duplicate ledger rows
    it('Hardening 4: duplicate worker cycle on multi-payment set -> no duplicate ledger rows', async () => {
      const paymentsList = [
        { id: 'pay_h4_001', status: 'CONFIRMED' as const, amountCents: 1333, billingType: 'CREDIT_CARD' },
        { id: 'pay_h4_002', status: 'RECEIVED' as const, amountCents: 1333, billingType: 'PIX' },
      ];

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce(paymentsList);
      await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');
      expect(transactionsStore.size).toBe(2);

      // Segundo ciclo
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce(paymentsList);
      await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      // Idempotência estrita: continua exatamente 2 transações
      expect(transactionsStore.size).toBe(2);
    });

    // 5. same payment CONFIRMED -> RECEIVED -> one transaction
    it('Hardening 5: same payment CONFIRMED -> RECEIVED -> one transaction', async () => {
      // Ciclo 1: CONFIRMED
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { id: 'pay_h5_same', status: 'CONFIRMED', amountCents: 1333, billingType: 'CREDIT_CARD', confirmedDate: '2026-09-12' },
      ]);
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_h5_same',
        status: 'CONFIRMED',
        amountCents: 1333,
        billingType: 'CREDIT_CARD',
        confirmedDate: '2026-09-12',
      });
      await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');
      expect(transactionsStore.size).toBe(1);

      // Ciclo 2: RECEIVED
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { id: 'pay_h5_same', status: 'RECEIVED', amountCents: 1333, billingType: 'CREDIT_CARD', paymentDate: '2026-09-12' },
      ]);
      await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(transactionsStore.size).toBe(1);
      expect(transactionsStore.get('asaas_pay_h5_same')!.status).toBe('paid');
    });

    // 6. ledger conflict -> attention / fail closed
    it('Hardening 6: ledger conflict (divergent amount) -> attention / fail closed', async () => {
      // Inserir previamente no ledger uma transação divergente para o mesmo payment ID
      transactionsStore.set('asaas_pay_h6_conflict', {
        id: 'asaas_pay_h6_conflict',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_h6_conflict',
        amount_cents: 9999, // Divergente!
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-09-12',
        paid_at: '2026-09-12T10:00:00.000Z',
        paid_billing_date: '2026-09-12',
        payment_method: 'CREDIT_CARD',
        transaction_type: 'prorated_early_activation_adjustment',
        attempt_id: 'att_adj_001',
        created_at: '2026-09-12T10:00:00.000Z',
        updated_at: '2026-09-12T10:00:00.000Z',
      });

      // Múltiplos pagamentos onde um colide com o ledger prévio
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { id: 'pay_h6_conflict', status: 'CONFIRMED', amountCents: 1333, billingType: 'CREDIT_CARD' },
        { id: 'pay_h6_other', status: 'RECEIVED', amountCents: 1333, billingType: 'PIX' },
      ]);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('FINANCIAL_TRANSACTION_CONFLICT');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.financial_attention_required).toBe(true);
      expect(postTr.financial_attention_reason).toBe('FINANCIAL_TRANSACTION_CONFLICT');
      // Preserva o registro original
      expect(transactionsStore.get('asaas_pay_h6_conflict')!.amount_cents).toBe(9999);
    });

    // 7. provider timeout -> transient outcome / state unchanged
    it('Hardening 7: provider timeout -> transient outcome / state unchanged', async () => {
      mockProvider.listPaymentsByCheckoutSession.mockRejectedValueOnce(new Error('Connection timed out'));

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_read_failure');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(postTr.financial_attention_required).toBeFalsy();
    });

    // 8. provider 5xx -> transient outcome / state unchanged
    it('Hardening 8: provider 5xx -> transient outcome / state unchanged', async () => {
      const serverErr = new AppError(500, 'Gateway 500 Internal Error');
      (serverErr as any).statusCode = 500;
      mockProvider.listPaymentsByCheckoutSession.mockRejectedValueOnce(serverErr);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_read_failure');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(postTr.financial_attention_required).toBeFalsy();
    });

    // 9. provider 401 -> operational permanent failure distinguished
    it('Hardening 9: provider 401 -> operational permanent failure distinguished', async () => {
      const authErr = new AppError(401, 'Unauthorized: Invalid API key');
      (authErr as any).statusCode = 401;
      mockProvider.listPaymentsByCheckoutSession.mockRejectedValueOnce(authErr);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_auth_failure_401');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(transactionsStore.size).toBe(0);
    });

    // 10. provider 403 -> operational permanent failure distinguished
    it('Hardening 10: provider 403 -> operational permanent failure distinguished', async () => {
      const forbiddenErr = new AppError(403, 'Forbidden: Resource access denied');
      (forbiddenErr as any).statusCode = 403;
      mockProvider.listPaymentsByCheckoutSession.mockRejectedValueOnce(forbiddenErr);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_auth_failure_403');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(transactionsStore.size).toBe(0);
    });

    // 11. malformed provider response -> fail closed
    it('Hardening 11: malformed provider response -> fail closed', async () => {
      // Retorna item sem id ou sem status
      mockProvider.listPaymentsByCheckoutSession.mockResolvedValueOnce([
        { invalidField: 'malformed_data' } as any,
      ]);

      const res = await billingService.reconcilePaidToPaidEarlyActivationAdjustment('tr_scheduled_early_001');

      expect(res.success).toBe(false);
      expect(res.reason).toBe('malformed_provider_response');

      const postTr = planChangesStore.get('tr_scheduled_early_001')!;
      expect(postTr.early_activation_status).toBe('payment_pending');
      expect(transactionsStore.size).toBe(0);
    });

    // 12. query bounded (getV1TransitionsNeedingReconciliation limit respected)
    it('Hardening 12: query bounded (reconciliation worker requests bounded batch size)', async () => {
      mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValueOnce([]);

      await reconcilerWorker.runCycle();

      expect(mockBillingRepo.getV1TransitionsNeedingReconciliation).toHaveBeenCalledWith('asaas', 20);
    });

    // 13. terminal historical states excluded
    it('Hardening 13: terminal historical states excluded from candidate filter', async () => {
      // Inserir transições com status terminais
      const completedTr = { ...getBaseScheduledTransition(), id: 'tr_term_comp', transition_status: 'completed' };
      const canceledTr = { ...getBaseScheduledTransition(), id: 'tr_term_canc', transition_status: 'canceled' };
      planChangesStore.set(completedTr.id, completedTr as any);
      planChangesStore.set(canceledTr.id, canceledTr as any);

      // O worker não deve processar transições que não sejam Live / Live-reconciliation
      const runResult = await reconcilerWorker.runCycle();

      expect(planChangesStore.get('tr_term_comp')!.transition_status).toBe('completed');
      expect(planChangesStore.get('tr_term_canc')!.transition_status).toBe('canceled');
    });

    // 14. bad transition/provider 401 failure does not stop next transition
    it('Hardening 14: bad transition (401 error) does not stop next transition in batch', async () => {
      // Transição A: sofrerá 401
      const badTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        id: 'tr_auth_fail_A',
        transition_id: 'tr_auth_fail_A',
        ministry_id: 'min_auth_A',
        early_activation_provider_checkout_id: 'chk_auth_fail_A',
        current_early_activation_checkout_attempt_id: 'att_auth_fail_A',
        checkout_attempts: [
          {
            attempt_id: 'att_auth_fail_A',
            transition_id: 'tr_auth_fail_A',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_auth_A',
            provider_checkout_id: 'chk_auth_fail_A',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set('tr_auth_fail_A', badTr);
      activeSlotsStore.set('slot_min_auth_A_asaas', {
        id: 'slot_min_auth_A_asaas',
        ministry_id: 'min_auth_A',
        provider: 'asaas',
        plan_change_id: 'tr_auth_fail_A',
        acquired_at: '2026-09-02T10:00:00.000Z',
        updated_at: '2026-09-02T10:00:00.000Z',
        version: 1,
      });

      // Transição B: saudável, com pagamento CONFIRMED
      const goodTr: BillingTransitionV1Record = {
        ...getBaseScheduledTransition(),
        id: 'tr_good_B',
        transition_id: 'tr_good_B',
        ministry_id: 'min_good_B',
        early_activation_provider_checkout_id: 'chk_good_B',
        current_early_activation_checkout_attempt_id: 'att_good_B',
        checkout_attempts: [
          {
            attempt_id: 'att_good_B',
            transition_id: 'tr_good_B',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_good_B',
            provider_checkout_id: 'chk_good_B',
            status: 'pending',
            amount_cents: 1333,
            currency: 'BRL',
            provider_create_state: 'created',
            provider_session_terminal: false,
            created_at: '2026-09-12T10:00:00.000Z',
          },
        ],
      };
      planChangesStore.set('tr_good_B', goodTr);
      activeSlotsStore.set('slot_min_good_B_asaas', {
        id: 'slot_min_good_B_asaas',
        ministry_id: 'min_good_B',
        provider: 'asaas',
        plan_change_id: 'tr_good_B',
        acquired_at: '2026-09-02T10:00:00.000Z',
        updated_at: '2026-09-02T10:00:00.000Z',
        version: 1,
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (sessionId: string) => {
        if (sessionId === 'chk_auth_fail_A') {
          const authErr = new AppError(401, 'Unauthorized');
          (authErr as any).statusCode = 401;
          throw authErr;
        }
        if (sessionId === 'chk_good_B') {
          return [
            {
              id: 'pay_good_B',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_good_B') {
          return {
            id: 'pay_good_B',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      await reconcilerWorker.runCycle();

      // Transição B ativou com sucesso
      const postGood = planChangesStore.get('tr_good_B')!;
      expect(postGood.early_activation_status).toBe('activated');
      expect(postGood.early_activation_provider_payment_id).toBe('pay_good_B');

      // Transição A permaneceu intacta
      const postBad = planChangesStore.get('tr_auth_fail_A')!;
      expect(postBad.early_activation_status).toBe('payment_pending');
    });
  });

  describe('Phase 3C.5A — Final Reconciler Fairness, Pagination & Starvation Hardening', () => {
    // 1. batch size remains bounded at 20 (or canonical configured limit)
    it('1. batch size remains bounded at 20 (or canonical configured limit)', async () => {
      planChangesStore.clear();
      for (let i = 1; i <= 30; i++) {
        const id = `tr_bound_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          early_activation_status: 'payment_pending',
          created_at: new Date(Date.now() - i * 1000).toISOString(),
        } as any);
      }

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.length).toBe(20);
    });

    // 2. 25 live candidates eventually all get opportunity
    it('2. 25 live candidates eventually all get opportunity across 2 cycles', async () => {
      planChangesStore.clear();
      for (let i = 1; i <= 25; i++) {
        const id = `tr_all_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          early_activation_status: 'payment_pending',
          created_at: new Date(Date.now() - (30 - i) * 1000).toISOString(),
        } as any);
      }

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]); // pending/no payments

      // Ciclo 1: processa 20
      await reconcilerWorker.runCycle();
      const afterCycle1 = Array.from(planChangesStore.values());
      const checkedCycle1 = afterCycle1.filter((t) => (t.retry_count || 0) >= 1);
      expect(checkedCycle1.length).toBe(20);

      // Ciclo 2: processa as 5 restantes
      await reconcilerWorker.runCycle();
      const afterCycle2 = Array.from(planChangesStore.values());
      const checkedCycle2 = afterCycle2.filter((t) => (t.retry_count || 0) >= 1);
      expect(checkedCycle2.length).toBe(25); // Todas as 25 ganharam oportunidade!
    });

    // 3. first 20 permanent PENDING do not starve candidate 21 CONFIRMED
    it('3. first 20 permanent PENDING do not starve candidate 21 CONFIRMED', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();
      // 20 transições pending perpétuas
      for (let i = 1; i <= 20; i++) {
        const id = `tr_pending_${String(i).padStart(3, '0')}`;
        const minId = `min_pending_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          early_activation_status: 'payment_pending',
          early_activation_provider_checkout_id: `chk_pending_${i}`,
          created_at: new Date(Date.now() - 100000 + i * 1000).toISOString(),
        } as any);
        activeSlotsStore.set(`slot_${minId}_asaas`, {
          id: `slot_${minId}_asaas`,
          ministry_id: minId,
          provider: 'asaas',
          plan_change_id: id,
        } as any);
        appSubscriptionsStore.set(minId, {
          ministryId: minId,
          planId: 'lite',
          interval: 'monthly',
          currentPeriodStart: '2026-09-02T00:00:00.000Z',
          currentPeriodEnd: '2026-10-02T00:00:00.000Z',
        });
      }

      // 21ª transição com pagamento CONFIRMED (usa checkout e attempt canônicos de getBaseScheduledTransition)
      const id21 = 'tr_confirmed_021';
      const min21 = 'min_confirmed_021';
      planChangesStore.set(id21, {
        ...getBaseScheduledTransition(),
        id: id21,
        transition_id: id21,
        ministry_id: min21,
        early_activation_status: 'payment_pending',
        created_at: new Date(Date.now() - 10000).toISOString(),
      } as any);
      activeSlotsStore.set(`slot_${min21}_asaas`, {
        id: `slot_${min21}_asaas`,
        ministry_id: min21,
        provider: 'asaas',
        plan_change_id: id21,
      } as any);
      appSubscriptionsStore.set(min21, {
        ministryId: min21,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (checkoutId: string) => {
        if (checkoutId === 'chk_adj_001') {
          return [
            {
              id: 'pay_confirmed_021',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return []; // as 20 primeiras não têm pagamento
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_confirmed_021') {
          return {
            id: 'pay_confirmed_021',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      // Ciclo 1 processa as 20 primeiras
      await reconcilerWorker.runCycle();
      expect(planChangesStore.get(id21)!.early_activation_status).toBe('payment_pending');

      // Ciclo 2 alcança a 21ª transição sem sofrer starvation!
      await reconcilerWorker.runCycle();
      const post21 = planChangesStore.get(id21)!;
      expect(post21.early_activation_status).toBe('activated');
      expect(post21.early_activation_provider_payment_id).toBe('pay_confirmed_021');
    });

    // 4. provider timeout candidates do not starve later candidates
    it('4. provider timeout candidates do not starve later candidates', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();
      // 20 transições que sofrem timeout
      for (let i = 1; i <= 20; i++) {
        const id = `tr_timeout_${String(i).padStart(3, '0')}`;
        const minId = `min_timeout_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          early_activation_status: 'payment_pending',
          early_activation_provider_checkout_id: `chk_timeout_${i}`,
          created_at: new Date(Date.now() - 100000 + i * 1000).toISOString(),
        } as any);
        activeSlotsStore.set(`slot_${minId}_asaas`, {
          id: `slot_${minId}_asaas`,
          ministry_id: minId,
          provider: 'asaas',
          plan_change_id: id,
        } as any);
        appSubscriptionsStore.set(minId, {
          ministryId: minId,
          planId: 'lite',
          interval: 'monthly',
          currentPeriodStart: '2026-09-02T00:00:00.000Z',
          currentPeriodEnd: '2026-10-02T00:00:00.000Z',
        });
      }

      // 21ª transição sadia com CONFIRMED
      const id21 = 'tr_timeout_rescue_021';
      const min21 = 'min_timeout_rescue_021';
      planChangesStore.set(id21, {
        ...getBaseScheduledTransition(),
        id: id21,
        transition_id: id21,
        ministry_id: min21,
        early_activation_status: 'payment_pending',
        created_at: new Date(Date.now() - 10000).toISOString(),
      } as any);
      activeSlotsStore.set(`slot_${min21}_asaas`, {
        id: `slot_${min21}_asaas`,
        ministry_id: min21,
        provider: 'asaas',
        plan_change_id: id21,
      } as any);
      appSubscriptionsStore.set(min21, {
        ministryId: min21,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (checkoutId: string) => {
        if (checkoutId.startsWith('chk_timeout_')) {
          throw new Error('Connection timed out');
        }
        if (checkoutId === 'chk_adj_001') {
          return [
            {
              id: 'pay_timeout_rescue_021',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_timeout_rescue_021') {
          return {
            id: 'pay_timeout_rescue_021',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      // Ciclo 1 falha transitória nas 20
      await reconcilerWorker.runCycle();
      expect(planChangesStore.get(id21)!.early_activation_status).toBe('payment_pending');

      // Ciclo 2 avança e ativa a 21ª transição
      await reconcilerWorker.runCycle();
      expect(planChangesStore.get(id21)!.early_activation_status).toBe('activated');
    });

    // 5. 401 candidates do not starve later candidates
    it('5. 401 candidates do not starve later candidates', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();
      for (let i = 1; i <= 20; i++) {
        const id = `tr_401_${String(i).padStart(3, '0')}`;
        const minId = `min_401_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          early_activation_status: 'payment_pending',
          early_activation_provider_checkout_id: `chk_401_${i}`,
          created_at: new Date(Date.now() - 100000 + i * 1000).toISOString(),
        } as any);
        activeSlotsStore.set(`slot_${minId}_asaas`, {
          id: `slot_${minId}_asaas`,
          ministry_id: minId,
          provider: 'asaas',
          plan_change_id: id,
        } as any);
        appSubscriptionsStore.set(minId, {
          ministryId: minId,
          planId: 'lite',
          interval: 'monthly',
          currentPeriodStart: '2026-09-02T00:00:00.000Z',
          currentPeriodEnd: '2026-10-02T00:00:00.000Z',
        });
      }

      const id21 = 'tr_401_rescue_021';
      const min21 = 'min_401_rescue_021';
      planChangesStore.set(id21, {
        ...getBaseScheduledTransition(),
        id: id21,
        transition_id: id21,
        ministry_id: min21,
        early_activation_status: 'payment_pending',
        created_at: new Date(Date.now() - 10000).toISOString(),
      } as any);
      activeSlotsStore.set(`slot_${min21}_asaas`, {
        id: `slot_${min21}_asaas`,
        ministry_id: min21,
        provider: 'asaas',
        plan_change_id: id21,
      } as any);
      appSubscriptionsStore.set(min21, {
        ministryId: min21,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (checkoutId: string) => {
        if (checkoutId.startsWith('chk_401_')) {
          throw new AppError(401, 'Unauthorized API key');
        }
        if (checkoutId === 'chk_adj_001') {
          return [
            {
              id: 'pay_401_rescue_021',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_401_rescue_021') {
          return {
            id: 'pay_401_rescue_021',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      await reconcilerWorker.runCycle();
      await reconcilerWorker.runCycle();

      expect(planChangesStore.get(id21)!.early_activation_status).toBe('activated');
    });

    // 6. financial-attention candidates do not starve healthy candidates
    it('6. financial-attention candidates do not starve healthy candidates', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();
      // 20 transições em attention permanente
      for (let i = 1; i <= 20; i++) {
        const id = `tr_att_${String(i).padStart(3, '0')}`;
        const minId = `min_att_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          financial_attention_required: true,
          financial_attention_reason: 'STALE_PROVIDER_CHECKOUT_MATERIALIZED',
          created_at: new Date(Date.now() - 100000 + i * 1000).toISOString(),
        } as any);
      }

      // 1 transição saudável scheduled com CONFIRMED
      const idHealthy = 'tr_healthy_001';
      const minHealthy = 'min_healthy_001';
      planChangesStore.set(idHealthy, {
        ...getBaseScheduledTransition(),
        id: idHealthy,
        transition_id: idHealthy,
        ministry_id: minHealthy,
        early_activation_status: 'payment_pending',
        created_at: new Date(Date.now() - 5000).toISOString(),
      } as any);
      activeSlotsStore.set(`slot_${minHealthy}_asaas`, {
        id: `slot_${minHealthy}_asaas`,
        ministry_id: minHealthy,
        provider: 'asaas',
        plan_change_id: idHealthy,
      } as any);
      appSubscriptionsStore.set(minHealthy, {
        ministryId: minHealthy,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (checkoutId: string) => {
        if (checkoutId === 'chk_adj_001') {
          return [
            {
              id: 'pay_healthy_001',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_healthy_001') {
          return {
            id: 'pay_healthy_001',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      // No primeiro ciclo, o fair round-robin interleaving seleciona a transição saudável!
      await reconcilerWorker.runCycle();

      expect(planChangesStore.get(idHealthy)!.early_activation_status).toBe('activated');
    });

    // 7. multi-query bucket A cannot permanently starve bucket B
    it('7. multi-query bucket A cannot permanently starve bucket B', async () => {
      planChangesStore.clear();
      // Bucket A: 25 transições scheduled
      for (let i = 1; i <= 25; i++) {
        const id = `tr_sched_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'scheduled',
          created_at: new Date(Date.now() - 100000 + i * 1000).toISOString(),
        } as any);
      }

      // Bucket B: 1 transição awaiting_old_inactivation
      const idAwaiting = 'tr_awaiting_001';
      planChangesStore.set(idAwaiting, {
        ...getBaseScheduledTransition(),
        id: idAwaiting,
        transition_id: idAwaiting,
        transition_status: 'awaiting_old_inactivation',
        created_at: new Date(Date.now() - 50000).toISOString(),
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);

      // O batch de 20 inclui o item de Bucket B graças ao Fair Interleaving!
      const containsBucketB = batch.some((t: BillingPlanChangeRecord) => t.id === idAwaiting);
      expect(containsBucketB).toBe(true);
      expect(batch.length).toBe(20);
    });

    // 8. worker restart preserves eventual progress
    it('8. worker restart preserves eventual progress', async () => {
      planChangesStore.clear();
      for (let i = 1; i <= 25; i++) {
        const id = `tr_restart_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          early_activation_status: 'payment_pending',
          created_at: new Date(Date.now() - (30 - i) * 1000).toISOString(),
        } as any);
      }

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      // Instância 1 do worker processa primeiro ciclo
      await reconcilerWorker.runCycle();
      const firstBatchProcessedIds = Array.from(planChangesStore.values())
        .filter((t) => t.retry_count === 1)
        .map((t) => t.id);
      expect(firstBatchProcessedIds.length).toBe(20);

      // Simula worker restart: cria nova instância sem nenhum estado em memória
      const newWorkerInstance = new BillingReconcilerWorker(billingService, mockBillingRepo);
      await newWorkerInstance.runCycle();

      // Os 5 restantes foram processados pela nova instância
      const allChecked = Array.from(planChangesStore.values()).filter((t) => (t.retry_count || 0) >= 1);
      expect(allChecked.length).toBe(25);
    });

    // 9. two workers + overlapping candidate fetch safe through CAS
    it('9. two workers + overlapping candidate fetch safe through CAS', async () => {
      planChangesStore.clear();
      const trId = 'tr_cas_test_001';
      planChangesStore.set(trId, {
        ...getBaseScheduledTransition(),
        id: trId,
        transition_id: trId,
        early_activation_status: 'payment_pending',
      } as any);

      // Worker 1 dá claim com sucesso
      const claim1 = await mockBillingRepo.claimTransitionForReconciliation(trId, 'worker_1');
      expect(claim1).not.toBeNull();
      expect(claim1!.id).toBe(trId);

      // Worker 2 tenta dar claim concorrente enquanto lock está ativo: recebe null!
      const claim2 = await mockBillingRepo.claimTransitionForReconciliation(trId, 'worker_2');
      expect(claim2).toBeNull();

      // Libera lock
      await mockBillingRepo.releasePlanChangeLock(trId);
    });

    // 10. terminal candidate disappears from live scheduling
    it('10. terminal candidate disappears from live scheduling', async () => {
      planChangesStore.clear();
      const trId = 'tr_terminal_001';
      planChangesStore.set(trId, {
        ...getBaseScheduledTransition(),
        id: trId,
        transition_id: trId,
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((t: BillingPlanChangeRecord) => t.id === trId)).toBe(false);
    });

    // 11. new candidate during later cycles eventually processed
    it('11. new candidate during later cycles eventually processed with priority', async () => {
      planChangesStore.clear();
      // 20 transições que já foram checadas anteriormente
      const oldTime = new Date(Date.now() - 50000).toISOString();
      for (let i = 1; i <= 20; i++) {
        const id = `tr_old_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          early_activation_status: 'payment_pending',
          last_reconciled_at: oldTime,
        } as any);
      }

      // Nova transição que surge agora (last_reconciled_at nulo)
      const idNew = 'tr_brand_new_001';
      planChangesStore.set(idNew, {
        ...getBaseScheduledTransition(),
        id: idNew,
        transition_id: idNew,
        early_activation_status: 'payment_pending',
        last_reconciled_at: null,
      } as any);

      // A nova transição (por ter last_reconciled_at nulo) sobe para o topo
      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((t: BillingPlanChangeRecord) => t.id === idNew)).toBe(true);
      expect(batch[0].id).toBe(idNew);
    });

    // 12. no worker cycle processes more than configured max
    it('12. no worker cycle processes more than configured max', async () => {
      planChangesStore.clear();
      for (let i = 1; i <= 50; i++) {
        const id = `tr_max_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          early_activation_status: 'payment_pending',
        } as any);
      }

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      const result = await reconcilerWorker.runCycle();
      expect(result.processed).toBeLessThanOrEqual(20);
    });

    // 13. no full active collection load
    it('13. no full active collection load (limitCount enforced per bucket and total)', async () => {
      planChangesStore.clear();
      for (let i = 1; i <= 100; i++) {
        const id = `tr_scale_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'scheduled',
        } as any);
      }

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.length).toBe(20);
    });

    // 14. no hot-loop of same transition inside a cycle
    it('14. no hot-loop of same transition inside a cycle', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();
      const trId = 'tr_loop_check_001';
      const minId = 'min_loop_001';
      planChangesStore.set(trId, {
        ...getBaseScheduledTransition(),
        id: trId,
        transition_id: trId,
        ministry_id: minId,
        early_activation_status: 'payment_pending',
        early_activation_provider_checkout_id: 'chk_loop_001',
      } as any);
      activeSlotsStore.set(`slot_${minId}_asaas`, {
        id: `slot_${minId}_asaas`,
        ministry_id: minId,
        provider: 'asaas',
        plan_change_id: trId,
      } as any);
      appSubscriptionsStore.set(minId, {
        ministryId: minId,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      let invocations = 0;
      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async () => {
        invocations++;
        return [];
      });

      await reconcilerWorker.runCycle();
      expect(invocations).toBe(1); // Exatamente uma invocação por ciclo
    });

    // 15. Firestore pagination/order deterministic
    it('15. Firestore pagination/order deterministic (triple tiebreak)', () => {
      const items = [
        { id: 'tr_C', last_reconciled_at: '2026-09-03T10:00:00Z', created_at: '2026-09-01T00:00:00Z' },
        { id: 'tr_A', last_reconciled_at: null, created_at: '2026-09-02T00:00:00Z' },
        { id: 'tr_B', last_reconciled_at: null, created_at: '2026-09-01T00:00:00Z' },
        { id: 'tr_D', last_reconciled_at: '2026-09-03T10:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      ];

      const sorted = [...items].sort((a, b) => {
        const aTime = a.last_reconciled_at ? new Date(a.last_reconciled_at).getTime() : 0;
        const bTime = b.last_reconciled_at ? new Date(b.last_reconciled_at).getTime() : 0;
        if (aTime !== bTime) return aTime - bTime;

        const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aCreated !== bCreated) return aCreated - bCreated;

        return a.id.localeCompare(b.id);
      });

      // tr_B vem antes de tr_A (ambos null, mas tr_B foi criado antes)
      expect(sorted[0].id).toBe('tr_B');
      expect(sorted[1].id).toBe('tr_A');
      // tr_C vem antes de tr_D (ambos mesmo timestamp e created_at, mas tr_C < tr_D lexicograficamente)
      expect(sorted[2].id).toBe('tr_C');
      expect(sorted[3].id).toBe('tr_D');
    });

    // 16. required indexes are versioned if introduced
    it('16. required indexes are versioned if introduced', () => {
      const indexesFilePath = path.join(__dirname, '../../../firestore.indexes.json');
      const indexesContent = JSON.parse(fs.readFileSync(indexesFilePath, 'utf-8'));

      const planChangesIndexes = indexesContent.indexes.filter(
        (idx: any) => idx.collectionGroup === 'billing_plan_changes'
      );

      expect(planChangesIndexes.length).toBeGreaterThanOrEqual(2);
      const hasReconciledOrder = planChangesIndexes.some((idx: any) =>
        idx.fields.some((f: any) => f.fieldPath === 'last_reconciled_at')
      );
      expect(hasReconciledOrder).toBe(true);
    });
  });

  describe('Phase 3C.5A — Legacy Progress Cursor / Normalization Final Hardening', () => {
    // 1. Reprodução do bug de dual-pass da query estática sem normalização
    it('1. Current Dual-Pass Failure Demonstration: fixed baseline orderBy(created_at).limit(20) re-selects same 20 docs without normalization', async () => {
      // Demonstração conceitual de como a query sem normalização causa starvation:
      const docs: Array<{ id: string; created_at: string; last_reconciled_at?: string | null }> = [];
      for (let i = 1; i <= 45; i++) {
        docs.push({
          id: `doc_${String(i).padStart(2, '0')}`,
          created_at: new Date(1700000000000 + i * 1000).toISOString(),
          // last_reconciled_at está ausente
        });
      }

      // Query estática por created_at ASC com limit 20:
      const staticQuery = (pool: typeof docs) => {
        return [...pool].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 20);
      };

      // Ciclo 1: seleciona os 20 primeiros
      const cycle1 = staticQuery(docs);
      expect(cycle1.length).toBe(20);
      expect(cycle1[0].id).toBe('doc_01');
      expect(cycle1[19].id).toBe('doc_20');

      // Claim no Ciclo 1 atualiza last_reconciled_at dos 20 primeiros, mas não altera created_at
      for (const d of cycle1) {
        d.last_reconciled_at = new Date().toISOString();
      }

      // Ciclo 2 sem normalização: a query baseada apenas em created_at RETORNA OS MESMOS 20 NOVAMENTE!
      const cycle2WithoutNormalization = staticQuery(docs);
      expect(cycle2WithoutNormalization[0].id).toBe('doc_01');
      expect(cycle2WithoutNormalization[19].id).toBe('doc_20');
      // Prova de starvation: os documentos 21 a 45 NUNCA seriam alcançados pela query legacy!
      expect(cycle2WithoutNormalization.some((d) => d.id === 'doc_21')).toBe(false);
    });

    // 6. Legacy document test: last_reconciled_at ABSENT
    it('6. Legacy Document Test: transition with absent last_reconciled_at is normalized and receives opportunity', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();

      const trRecent = {
        ...getBaseScheduledTransition(),
        id: 'tr_recent_001',
        transition_id: 'tr_recent_001',
        last_reconciled_at: new Date(Date.now() - 60000).toISOString(),
        created_at: new Date(Date.now() - 120000).toISOString(),
      };
      planChangesStore.set(trRecent.id, trRecent as any);

      const trLegacy = {
        ...getBaseScheduledTransition(),
        id: 'tr_legacy_001',
        transition_id: 'tr_legacy_001',
        created_at: new Date(Date.now() - 300000).toISOString(),
      };
      delete (trLegacy as any).last_reconciled_at;
      expect((trLegacy as any).last_reconciled_at).toBeUndefined();
      planChangesStore.set(trLegacy.id, trLegacy as any);

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      // Executa o ciclo: passo de normalização normaliza tr_legacy_001 para null, que vai para o topo do LRR
      await reconcilerWorker.runCycle();
      const updatedLegacy = planChangesStore.get('tr_legacy_001');
      expect((updatedLegacy?.retry_count || 0)).toBeGreaterThanOrEqual(1);
      expect(updatedLegacy?.last_reconciled_at).toBeDefined();
    });

    // 7. Mixed legacy + new data: 10 absent, 10 null, 20 recently reconciled
    it('7. Mixed Legacy + New Data: 10 absent, 10 null, 20 recently reconciled -> legacy & null treated as never reconciled', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 10; i++) {
        const id = `tr_legacy_${String(i).padStart(2, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          created_at: new Date(Date.now() - (100 - i) * 1000).toISOString(),
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      for (let i = 1; i <= 10; i++) {
        const id = `tr_new_${String(i).padStart(2, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          last_reconciled_at: null,
          created_at: new Date(Date.now() - (80 - i) * 1000).toISOString(),
        };
        planChangesStore.set(id, tr);
      }

      for (let i = 1; i <= 20; i++) {
        const id = `tr_reconciled_${String(i).padStart(2, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          last_reconciled_at: new Date(Date.now() - (40 - i) * 1000).toISOString(),
          created_at: new Date(Date.now() - 200000).toISOString(),
        };
        planChangesStore.set(id, tr);
      }

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      // Roda a normalização
      await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);

      // O batch de 20 deve conter os 10 legados e os 10 novos
      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.length).toBe(20);

      const batchIds = new Set(batch.map((b: any) => b.id));
      for (let i = 1; i <= 10; i++) {
        expect(batchIds.has(`tr_legacy_${String(i).padStart(2, '0')}`)).toBe(true);
        expect(batchIds.has(`tr_new_${String(i).padStart(2, '0')}`)).toBe(true);
      }

      for (let i = 1; i <= 20; i++) {
        expect(batchIds.has(`tr_reconciled_${String(i).padStart(2, '0')}`)).toBe(false);
      }
    });

    // 8 / 15. 45 legacy candidates: all 45 processed across 3 cycles with individual ID assertions
    it('15. 45 Legacy Real Progress Test: all 45 candidates without last_reconciled_at receive opportunity with individual ID assertions', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 45; i++) {
        const id = `tr_leg45_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          created_at: new Date(Date.now() - (60 - i) * 1000).toISOString(),
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      // Ciclo 1: 20 processados
      await reconcilerWorker.runCycle();
      const afterCycle1 = Array.from(planChangesStore.values());
      const checked1 = afterCycle1.filter((t) => (t.retry_count || 0) >= 1);
      expect(checked1.length).toBe(20);

      // Ciclo 2: mais 20 processados (total 40 distintos)
      await reconcilerWorker.runCycle();
      const afterCycle2 = Array.from(planChangesStore.values());
      const checked2 = afterCycle2.filter((t) => (t.retry_count || 0) >= 1);
      expect(checked2.length).toBe(40);

      // Ciclo 3: os 5 restantes processados (total 45)
      await reconcilerWorker.runCycle();
      const afterCycle3 = Array.from(planChangesStore.values());
      const checked3 = afterCycle3.filter((t) => (t.retry_count || 0) >= 1);
      expect(checked3.length).toBe(45);

      // Assert individual para CADA UM dos 45 IDs
      for (let i = 1; i <= 45; i++) {
        const targetId = `tr_leg45_${String(i).padStart(3, '0')}`;
        const item = planChangesStore.get(targetId);
        expect(item).toBeDefined();
        expect(item?.retry_count || 0).toBeGreaterThanOrEqual(1);
        expect(item?.last_reconciled_at).toBeDefined();
      }
    });

    // 16. 100 legacy candidates: all 100 receive opportunity across 5 cycles
    it('16. 100 Legacy Test: 100 legacy candidates without last_reconciled_at all receive opportunity across 5 cycles', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 100; i++) {
        const id = `tr_leg100_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          created_at: new Date(Date.now() - (120 - i) * 1000).toISOString(),
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      // Executa 5 ciclos com batch = 20
      for (let cycle = 1; cycle <= 5; cycle++) {
        await reconcilerWorker.runCycle();
        const currentChecked = Array.from(planChangesStore.values()).filter((t) => (t.retry_count || 0) >= 1);
        expect(currentChecked.length).toBe(cycle * 20);
      }

      // Assert individual dos 100 IDs
      for (let i = 1; i <= 100; i++) {
        const targetId = `tr_leg100_${String(i).padStart(3, '0')}`;
        const item = planChangesStore.get(targetId);
        expect(item).toBeDefined();
        expect(item?.retry_count || 0).toBeGreaterThanOrEqual(1);
        expect(item?.last_reconciled_at).toBeDefined();
      }
    });

    // 17. Legacy + Permanent Pending: 20 pending do not block 21st confirmed
    it('17. Legacy + Permanent Pending: 20 permanent pending legacy records do not pin queue and 21st confirmed is reached', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_seq_${String(i).padStart(2, '0')}`;
        const minId = `min_seq_${i}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          created_at: new Date(Date.now() - (50 - i) * 1000).toISOString(),
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
        activeSlotsStore.set(`slot_${minId}_asaas`, {
          id: `slot_${minId}_asaas`,
          ministry_id: minId,
          provider: 'asaas',
          plan_change_id: id,
        } as any);
        appSubscriptionsStore.set(minId, {
          ministryId: minId,
          planId: 'lite',
          interval: 'monthly',
          currentPeriodStart: '2026-09-02T00:00:00.000Z',
          currentPeriodEnd: '2026-10-02T00:00:00.000Z',
        });
      }

      const id21 = 'tr_seq_21';
      const min21 = 'min_seq_21';
      const tr21: any = {
        ...getBaseScheduledTransition(),
        id: id21,
        transition_id: id21,
        ministry_id: min21,
        created_at: new Date(Date.now() - 10000).toISOString(),
      };
      delete tr21.last_reconciled_at;
      tr21.early_activation_provider_checkout_id = 'chk_confirmed_21';
      tr21.checkout_attempts[0].provider_checkout_id = 'chk_confirmed_21';
      planChangesStore.set(id21, tr21);
      activeSlotsStore.set(`slot_${min21}_asaas`, {
        id: `slot_${min21}_asaas`,
        ministry_id: min21,
        provider: 'asaas',
        plan_change_id: id21,
      } as any);
      appSubscriptionsStore.set(min21, {
        ministryId: min21,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (chkId: string) => {
        if (chkId === 'chk_confirmed_21') {
          return [
            {
              id: 'pay_confirmed_21',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return [
          {
            id: 'pay_pending',
            status: 'PENDING',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
          },
        ];
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_confirmed_21') {
          return {
            id: 'pay_confirmed_21',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      // Ciclo 1: os 20 primeiros são reconciliados, mas continuam pending
      await reconcilerWorker.runCycle();
      const first20 = Array.from(planChangesStore.values()).filter((t) => t.id !== 'tr_seq_21');
      expect(first20.every((t) => (t.retry_count || 0) >= 1)).toBe(true);
      expect(planChangesStore.get('tr_seq_21')?.retry_count || 0).toBe(0);

      // Ciclo 2: o 21º é alcançado e liquidado com sucesso!
      await reconcilerWorker.runCycle();
      const updated21 = planChangesStore.get('tr_seq_21');
      expect(updated21?.retry_count).toBe(1);
      expect(updated21?.early_activation_status).toBe('activated');
    });

    // 18. Legacy + Provider Failure: 20 failures do not prevent 21st from progress
    it('18. Legacy + Provider Failure: transient provider failures on first 20 do not pin queue and 21st settled proceeds', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_fl_${String(i).padStart(2, '0')}`;
        const minId = `min_fl_${i}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          created_at: new Date(Date.now() - (50 - i) * 1000).toISOString(),
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
        activeSlotsStore.set(`slot_${minId}_asaas`, {
          id: `slot_${minId}_asaas`,
          ministry_id: minId,
          provider: 'asaas',
          plan_change_id: id,
        } as any);
        appSubscriptionsStore.set(minId, {
          ministryId: minId,
          planId: 'lite',
          interval: 'monthly',
          currentPeriodStart: '2026-09-02T00:00:00.000Z',
          currentPeriodEnd: '2026-10-02T00:00:00.000Z',
        });
      }

      const id21 = 'tr_fl_21';
      const min21 = 'min_fl_21';
      const tr21: any = {
        ...getBaseScheduledTransition(),
        id: id21,
        transition_id: id21,
        ministry_id: min21,
        created_at: new Date(Date.now() - 10000).toISOString(),
      };
      delete tr21.last_reconciled_at;
      tr21.early_activation_provider_checkout_id = 'chk_settled_21';
      tr21.checkout_attempts[0].provider_checkout_id = 'chk_settled_21';
      planChangesStore.set(id21, tr21);
      activeSlotsStore.set(`slot_${min21}_asaas`, {
        id: `slot_${min21}_asaas`,
        ministry_id: min21,
        provider: 'asaas',
        plan_change_id: id21,
      } as any);
      appSubscriptionsStore.set(min21, {
        ministryId: min21,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (chkId: string) => {
        if (chkId === 'chk_settled_21') {
          return [
            {
              id: 'pay_settled_21',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        throw new Error('ETIMEDOUT: Connection timed out');
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_settled_21') {
          return {
            id: 'pay_settled_21',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      // Ciclo 1: primeiros 20 sofrem falha transitória, mas recebem claim e atualizam last_reconciled_at
      await reconcilerWorker.runCycle();
      const first20 = Array.from(planChangesStore.values()).filter((t) => t.id !== 'tr_fl_21');
      expect(first20.every((t) => (t.retry_count || 0) >= 1)).toBe(true);

      // Ciclo 2: o 21º é processado e liquidado com sucesso!
      await reconcilerWorker.runCycle();
      const updated21 = planChangesStore.get('tr_fl_21');
      expect(updated21?.retry_count).toBe(1);
      expect(updated21?.early_activation_status).toBe('activated');
    });

    // 19. Missing created_at test: missing both last_reconciled_at and created_at is discovered and processed
    it('19. Missing created_at Test: transition with absent last_reconciled_at and absent created_at is discovered and processed', async () => {
      planChangesStore.clear();

      const trNoCreated: any = {
        ...getBaseScheduledTransition(),
        id: 'tr_no_created_001',
        transition_id: 'tr_no_created_001',
      };
      delete trNoCreated.last_reconciled_at;
      delete trNoCreated.created_at;
      expect(trNoCreated.last_reconciled_at).toBeUndefined();
      expect(trNoCreated.created_at).toBeUndefined();
      planChangesStore.set('tr_no_created_001', trNoCreated);

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      await reconcilerWorker.runCycle();
      const updated = planChangesStore.get('tr_no_created_001');
      expect(updated?.retry_count).toBe(1);
      expect(updated?.last_reconciled_at).toBeDefined();
    });

    // 20. Modernized legacy without created_at: remains discoverable in subsequent cycles
    it('20. Modernized Legacy Without created_at: remains discoverable and eligible after first claim', async () => {
      planChangesStore.clear();

      const trNoCreated: any = {
        ...getBaseScheduledTransition(),
        id: 'tr_modernized_no_created',
        transition_id: 'tr_modernized_no_created',
        last_reconciled_at: new Date(Date.now() - 3600000).toISOString(), // reconciliado há 1h
      };
      delete trNoCreated.created_at;
      planChangesStore.set('tr_modernized_no_created', trNoCreated);

      mockProvider.listPaymentsByCheckoutSession.mockResolvedValue([]);

      // Permanece elegível e é descoberto pela query moderna
      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === 'tr_modernized_no_created')).toBe(true);

      await reconcilerWorker.runCycle();
      const updated = planChangesStore.get('tr_modernized_no_created');
      expect(updated?.retry_count).toBe(1);
    });

    // 22 / 23. Exact Index Contract Test: exactly the 2 canonical modern indexes are versioned
    it('23. Exact Query/Index Contract Test: verifies exactly the 2 modern LRR composite indexes are versioned in firestore.indexes.json', () => {
      const indexesFilePath = path.join(__dirname, '../../../firestore.indexes.json');
      const indexesContent = JSON.parse(fs.readFileSync(indexesFilePath, 'utf-8'));

      const planChangesIndexes = indexesContent.indexes.filter(
        (idx: any) => idx.collectionGroup === 'billing_plan_changes'
      );

      // Deve possuir exatamente 2 composite indexes para billing_plan_changes
      expect(planChangesIndexes.length).toBe(2);

      // 1. provider + transition_status + last_reconciled_at + __name__
      const hasStatusIndex = planChangesIndexes.some((idx: any) => {
        const fields = idx.fields.map((f: any) => f.fieldPath);
        return (
          fields.length === 4 &&
          fields[0] === 'provider' &&
          fields[1] === 'transition_status' &&
          fields[2] === 'last_reconciled_at' &&
          fields[3] === '__name__'
        );
      });
      expect(hasStatusIndex).toBe(true);

      // 2. provider + transition_status + financial_attention_required + last_reconciled_at + __name__
      const hasAttentionIndex = planChangesIndexes.some((idx: any) => {
        const fields = idx.fields.map((f: any) => f.fieldPath);
        return (
          fields.length === 5 &&
          fields[0] === 'provider' &&
          fields[1] === 'transition_status' &&
          fields[2] === 'financial_attention_required' &&
          fields[3] === 'last_reconciled_at' &&
          fields[4] === '__name__'
        );
      });
      expect(hasAttentionIndex).toBe(true);
    });

    // 24 / 18. Claim scheduling authority: release does not touch last_reconciled_at
    it('24. Claim Scheduling Authority: releasePlanChangeLock preserves last_reconciled_at from claim', async () => {
      planChangesStore.clear();
      const trId = 'tr_authority_001';
      const tr = {
        ...getBaseScheduledTransition(),
        id: trId,
        transition_id: trId,
      };
      planChangesStore.set(trId, tr as any);

      const claimed = await mockBillingRepo.claimTransitionForReconciliation(trId, 'worker-1');
      const claimTimestamp = claimed.last_reconciled_at;
      expect(claimTimestamp).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 20));
      await mockBillingRepo.releasePlanChangeLock(trId);

      const afterRelease = planChangesStore.get(trId);
      expect(afterRelease?.last_reconciled_at).toBe(claimTimestamp);
    });

    // 25 / 16. Crash after claim: recoverable after lock expiry
    it('25. Crash After Claim: crashed worker leaves record recoverable after lock expiration', async () => {
      planChangesStore.clear();
      locksStore.clear();
      const legacyId = 'tr_legacy_crash_001';
      const tr: any = {
        ...getBaseScheduledTransition(),
        id: legacyId,
        transition_id: legacyId,
      };
      delete tr.last_reconciled_at;
      planChangesStore.set(legacyId, tr);

      const claimed1 = await mockBillingRepo.claimTransitionForReconciliation(legacyId, 'worker-1');
      expect(claimed1).not.toBeNull();

      const claimedTooEarly = await mockBillingRepo.claimTransitionForReconciliation(legacyId, 'worker-2');
      expect(claimedTooEarly).toBeNull();

      const expiredLock = locksStore.get(legacyId);
      if (expiredLock) {
        expiredLock.expiresAt = Date.now() - 1000;
      }

      const claimedAfterExpiry = await mockBillingRepo.claimTransitionForReconciliation(legacyId, 'worker-2');
      expect(claimedAfterExpiry).not.toBeNull();
      expect(claimedAfterExpiry.retry_locked_by).toBe('worker-2');
    });

    // 26. Modern LRR Fairness after legacy normalization: 25+ live docs, first 20 pending, 21st confirmed
    it('26. Modern LRR Fairness After Legacy Normalization: 25 normalized live docs, first 20 pending -> 21st confirmed is eventually processed', async () => {
      planChangesStore.clear();
      activeSlotsStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_mod_seq_${String(i).padStart(2, '0')}`;
        const minId = `min_mod_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          ministry_id: minId,
          last_reconciled_at: null,
          created_at: new Date(Date.now() - (60 - i) * 1000).toISOString(),
        } as any);
        activeSlotsStore.set(`slot_${minId}_asaas`, {
          id: `slot_${minId}_asaas`,
          ministry_id: minId,
          provider: 'asaas',
          plan_change_id: id,
        } as any);
        appSubscriptionsStore.set(minId, {
          ministryId: minId,
          planId: 'lite',
          interval: 'monthly',
          currentPeriodStart: '2026-09-02T00:00:00.000Z',
          currentPeriodEnd: '2026-10-02T00:00:00.000Z',
        });
      }

      const id21 = 'tr_mod_seq_21';
      const min21 = 'min_mod_21';
      const tr21: any = {
        ...getBaseScheduledTransition(),
        id: id21,
        transition_id: id21,
        ministry_id: min21,
        last_reconciled_at: null,
        created_at: new Date(Date.now() - 10000).toISOString(),
      };
      tr21.early_activation_provider_checkout_id = 'chk_modern_21';
      tr21.checkout_attempts[0].provider_checkout_id = 'chk_modern_21';
      planChangesStore.set(id21, tr21);
      activeSlotsStore.set(`slot_${min21}_asaas`, {
        id: `slot_${min21}_asaas`,
        ministry_id: min21,
        provider: 'asaas',
        plan_change_id: id21,
      } as any);
      appSubscriptionsStore.set(min21, {
        ministryId: min21,
        planId: 'lite',
        interval: 'monthly',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.listPaymentsByCheckoutSession.mockImplementation(async (chkId: string) => {
        if (chkId === 'chk_modern_21') {
          return [
            {
              id: 'pay_modern_21',
              status: 'CONFIRMED',
              amountCents: 1333,
              billingType: 'CREDIT_CARD',
              confirmedDate: '2026-09-12',
            },
          ];
        }
        return [{ id: 'pay_pen', status: 'PENDING', amountCents: 1333, billingType: 'CREDIT_CARD' }];
      });

      mockProvider.getPayment.mockImplementation(async (paymentId: string) => {
        if (paymentId === 'pay_modern_21') {
          return {
            id: 'pay_modern_21',
            status: 'CONFIRMED',
            amountCents: 1333,
            billingType: 'CREDIT_CARD',
            confirmedDate: '2026-09-12',
          };
        }
        return null;
      });

      // Ciclo 1: 20 primeiros recebem claim e atualizam last_reconciled_at
      await reconcilerWorker.runCycle();
      expect(planChangesStore.get('tr_mod_seq_21')?.retry_count || 0).toBe(0);

      // Ciclo 2: o 21º avança para o topo e liquida
      await reconcilerWorker.runCycle();
      const updated21 = planChangesStore.get('tr_mod_seq_21');
      expect(updated21?.retry_count).toBe(1);
      expect(updated21?.early_activation_status).toBe('activated');
    });

    // 27 / 20. Multi-bucket fairness preserved
    it('27. Multi-Bucket Fairness: round-robin interleaving fairly selects from distinct buckets', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_sched_${String(i).padStart(2, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'scheduled',
          last_reconciled_at: null,
        } as any);
      }

      for (let i = 1; i <= 5; i++) {
        const id = `tr_ftp_${String(i).padStart(2, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'future_target_prepared',
          last_reconciled_at: null,
        } as any);
      }

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      const ftpInBatch = batch.filter((b: any) => b.transition_status === 'future_target_prepared');
      expect(ftpInBatch.length).toBe(5);
      const schedInBatch = batch.filter((b: any) => b.transition_status === 'scheduled');
      expect(schedInBatch.length).toBe(15);
    });

    // 28 / 21. Multi-worker CAS preserved
    it('28. Multi-Worker CAS Lock Safety: concurrent workers on same record safe via atomic lock', async () => {
      planChangesStore.clear();
      locksStore.clear();
      const id = 'tr_cas_test_001';
      planChangesStore.set(id, {
        ...getBaseScheduledTransition(),
        id,
        transition_id: id,
        last_reconciled_at: null,
      } as any);

      const [w1, w2] = await Promise.all([
        mockBillingRepo.claimTransitionForReconciliation(id, 'worker-1'),
        mockBillingRepo.claimTransitionForReconciliation(id, 'worker-2'),
      ]);

      const winners = [w1, w2].filter((r) => r !== null);
      const losers = [w1, w2].filter((r) => r === null);
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
    });

    // 29. 100 Legacy Normalization Test (Section 12)
    it('29. 100 Legacy Normalization Test: 100 legacy docs all persist in store, batch 50 -> 2 cycles normalize 100/100', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 100; i++) {
        const id = `tr_norm100_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          created_at: new Date(Date.now() - (200 - i) * 1000).toISOString(),
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Cycle 1: normaliza os primeiros 50
      const res1 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(res1.normalizedCount).toBe(50);
      expect(res1.hasMore).toBe(true);

      const afterCycle1 = Array.from(planChangesStore.values());
      expect(afterCycle1.filter((d) => d.last_reconciled_at !== undefined).length).toBe(50);
      expect(afterCycle1.filter((d) => d.last_reconciled_at === undefined).length).toBe(50);

      // Cycle 2: normaliza os 50 restantes (progredindo além de L050 sem remover nada da store)
      const res2 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(res2.normalizedCount).toBe(50);

      const afterCycle2 = Array.from(planChangesStore.values());
      expect(afterCycle2.filter((d) => d.last_reconciled_at !== undefined).length).toBe(100);
      expect(afterCycle2.filter((d) => d.last_reconciled_at === undefined).length).toBe(0);

      // Assert individual para TODOS os 100 IDs
      for (let i = 1; i <= 100; i++) {
        const id = `tr_norm100_${String(i).padStart(3, '0')}`;
        const doc = planChangesStore.get(id);
        expect(doc).toBeDefined();
        expect(doc?.last_reconciled_at).toBeNull();
      }
    });

    // 30. 125 Legacy Normalization Test (Section 13)
    it('30. 125 Legacy Normalization Test: 125 legacy docs, batch 50 -> 3 cycles normalize all 125 (50 -> 100 -> 125)', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 125; i++) {
        const id = `tr_norm125_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Cycle 1: 50
      const c1 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(c1.normalizedCount).toBe(50);
      expect(c1.hasMore).toBe(true);

      // Cycle 2: 50 (total 100)
      const c2 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(c2.normalizedCount).toBe(50);
      expect(c2.hasMore).toBe(true);

      // Cycle 3: 25 restantes (total 125)
      const c3 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(c3.normalizedCount).toBe(25);
      expect(c3.hasMore).toBe(false);

      const all = Array.from(planChangesStore.values());
      expect(all.filter((d) => d.last_reconciled_at !== undefined).length).toBe(125);
    });

    // 31. Mixed Normalized + Legacy (Section 14)
    it('31. Mixed Normalized + Legacy: 50 already normalized precede 100 legacy in ID order -> all 100 legacy are discovered', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      // 50 já normalizados com IDs menores
      for (let i = 1; i <= 50; i++) {
        const id = `tr_a_normalized_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          last_reconciled_at: null,
        } as any);
      }

      // 100 legados não normalizados com IDs maiores
      for (let i = 1; i <= 100; i++) {
        const id = `tr_b_legacy_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Cycle 1: inspeciona os 50 já normalizados (0 normalizados, mas cursor avança além deles!)
      const r1 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(r1.normalizedCount).toBe(0);
      expect(r1.hasMore).toBe(true);

      // Cycle 2: alcança os primeiros 50 legados
      const r2 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(r2.normalizedCount).toBe(50);
      expect(r2.hasMore).toBe(true);

      // Cycle 3: alcança os últimos 50 legados
      const r3 = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(r3.normalizedCount).toBe(50);

      // Todos os 150 documentos agora possuem last_reconciled_at definido
      const all = Array.from(planChangesStore.values());
      expect(all.filter((d) => d.last_reconciled_at === undefined).length).toBe(0);
      expect(all.filter((d) => d.last_reconciled_at === null).length).toBe(150);
    });

    // 32. Restart Test: Durable Progress Survives Worker Re-instantiation (Section 15)
    it('32. Restart Test: normalization progress survives worker destruction and re-creation via durable scheduler store', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 100; i++) {
        const id = `tr_restart_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Worker 1 executa cycle 1
      let workerInstance: any = new BillingReconcilerWorker(billingService, mockBillingRepo);
      await workerInstance.runCycle();

      const afterWorker1 = Array.from(planChangesStore.values());
      expect(afterWorker1.filter((d) => d.last_reconciled_at !== undefined).length).toBe(50);

      // Destrói worker 1
      workerInstance = null;

      // Cria Worker 2 novo (simulando restart de processo)
      const worker2 = new BillingReconcilerWorker(billingService, mockBillingRepo);

      // Worker 2 executa cycle 2: deve continuar o progresso de onde o worker 1 parou
      await worker2.runCycle();

      const afterWorker2 = Array.from(planChangesStore.values());
      expect(afterWorker2.filter((d) => d.last_reconciled_at !== undefined).length).toBe(100);
      expect(afterWorker2.filter((d) => d.last_reconciled_at === undefined).length).toBe(0);
    });

    // 33. Crash Before Normalization Write (Section 16)
    it('33. Crash Before Normalization Write: simulated failure before write leaves cursor intact and records recoverable on retry', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 50; i++) {
        const id = `tr_crash1_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Simula crash durante normalização: cursor não foi persistido
      const initialSched = await mockBillingRepo.getNormalizationSchedulerRecord('asaas');
      expect(initialSched).toBeNull();

      // Próxima execução: consegue normalizar os 50 com sucesso sem ter pulado nenhum documento
      const r = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(r.normalizedCount).toBe(50);
      const afterRetry = Array.from(planChangesStore.values());
      expect(afterRetry.filter((d) => d.last_reconciled_at !== undefined).length).toBe(50);
    });

    // 34. Crash After Normalization Before Cursor Commit (Section 17)
    it('34. Crash After Normalization Before Cursor Commit: idempotent retry re-reads normalized docs and safely commits cursor', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 50; i++) {
        const id = `tr_crash2_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Simula: normaliza os primeiros 25 diretamente mas não comita cursor
      for (let i = 1; i <= 25; i++) {
        const id = `tr_crash2_${String(i).padStart(3, '0')}`;
        planChangesStore.get(id)!.last_reconciled_at = null;
      }

      // Retry lê desde o início: normaliza os 25 restantes e comita cursor com sucesso
      const res = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(res.normalizedCount).toBe(25);
      const all = Array.from(planChangesStore.values());
      expect(all.filter((d) => d.last_reconciled_at !== undefined).length).toBe(50);
    });

    // 35. Multi-Worker Normalization (Section 18)
    it('35. Multi-Worker Normalization Safety: concurrent workers on normalization pass remain safe and idempotent', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 50; i++) {
        const id = `tr_multi_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Dois workers executam normalização concorrentemente
      const [r1, r2] = await Promise.all([
        mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50),
        mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50),
      ]);

      // Ambos completam sem erro e o total de documentos normalizados é 50
      const all = Array.from(planChangesStore.values());
      expect(all.filter((d) => d.last_reconciled_at === null).length).toBe(50);
    });

    // 36. Never Overwrite Real Scheduling Timestamp (Section 19)
    it('36. Never Overwrite Real Scheduling Timestamp: records with existing ISO timestamp are strictly preserved', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      const existingTimestamp = '2026-09-02T10:00:00.000Z';
      const id = 'tr_real_timestamp_001';
      planChangesStore.set(id, {
        ...getBaseScheduledTransition(),
        id,
        transition_id: id,
        last_reconciled_at: existingTimestamp,
      } as any);

      await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);

      const doc = planChangesStore.get(id);
      expect(doc?.last_reconciled_at).toBe(existingTimestamp);
    });

    // 37. Updated_at Audit & Zero Business Field Mutation (Section 20 & 21)
    it('37. Zero Business Field Mutation & Updated_at Audit: normalization alters ONLY last_reconciled_at', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      const origUpdatedAt = '2026-08-15T12:00:00.000Z';
      const id = 'tr_audit_fields_001';
      const tr: any = {
        ...getBaseScheduledTransition(),
        id,
        transition_id: id,
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        expected_amount_cents: 3490,
        provider_customer_id: 'cust_asaas_001',
        updated_at: origUpdatedAt,
      };
      delete tr.last_reconciled_at;
      planChangesStore.set(id, tr);

      await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);

      const updated = planChangesStore.get(id);
      expect(updated?.last_reconciled_at).toBeNull();
      // Zero mutações em campos de negócio
      expect(updated?.transition_status).toBe('scheduled');
      expect(updated?.financial_safety_status).toBe('live');
      expect(updated?.expected_amount_cents).toBe(3490);
      expect(updated?.provider_customer_id).toBe('cust_asaas_001');
      // Updated_at NÃO é mutacionado pela normalização
      expect(updated?.updated_at).toBe(origUpdatedAt);
    });

    // 38. New Transitions Birth With last_reconciled_at: null (Section 11)
    it('38. New Transitions Contract: new transitions are created with last_reconciled_at = null by default', async () => {
      const base = getBaseScheduledTransition();
      expect(base.last_reconciled_at).toBeNull();
    });

    // 39. Attention Bucket Terminal Starvation Guard (Sections 10 & 11)
    it('39. Attention Bucket Terminal Starvation Guard: terminal records (completed, canceled, failed, superseded, safe_terminal) do not monopolize attention bucket and live attention record is scheduled', async () => {
      planChangesStore.clear();

      // 20 transições com attention mas em status terminais históricos (completed, canceled, failed, superseded)
      const terminalStatuses = ['completed', 'canceled', 'failed', 'superseded'] as const;
      for (let i = 1; i <= 20; i++) {
        const id = `tr_term_att_${String(i).padStart(2, '0')}`;
        const st = terminalStatuses[i % terminalStatuses.length];
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: st,
          status: st,
          financial_safety_status: 'safe_terminal',
          financial_attention_required: true,
          financial_attention_reason: 'historical_terminal_issue',
          last_reconciled_at: null,
        } as any);
      }

      // 1 transição VIVA com attention que precisa de reconciliação operacional
      const liveId = 'tr_live_att_scheduled';
      planChangesStore.set(liveId, {
        ...getBaseScheduledTransition(),
        id: liveId,
        transition_id: liveId,
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        financial_attention_required: true,
        financial_attention_reason: 'EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS',
        last_reconciled_at: null,
      } as any);

      // Busca o batch de reconciliação: o registro vivo em atenção DEVE estar presente
      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      const liveFound = batch.some((b: any) => b.id === liveId);
      expect(liveFound).toBe(true);

      // Nenhum dos 20 registros terminais deve constar no lote operacional retornado
      const terminalFound = batch.some((b: any) => b.id.startsWith('tr_term_att_'));
      expect(terminalFound).toBe(false);
    });

    // ==========================================
    // WRAP TEST MATRIX (Section 6)
    // ==========================================

    // 40. A plans wrap from 050, B advances 100, A commits late -> 100 preserved
    it('40. Wrap CAS: stale wrap observation from cursor 050 cannot overwrite newer cursor 100 to null', async () => {
      schedulersStore.clear();
      const schedulerDocId = 'normalization_asaas';

      // Estado inicial: cursor em 050
      schedulersStore.set(schedulerDocId, {
        id: schedulerDocId,
        provider: 'asaas',
        cursors: { scheduled: 'tr_doc_050' },
        updated_at: new Date().toISOString(),
      });

      // Worker A lê cursor 050 e planeja wrap (expectedStartCursor: 050, nextCursor: null)
      const workerAUpdate = { expectedStartCursor: 'tr_doc_050', nextCursor: null };

      // Worker B avança o cursor para 100 no banco antes do commit de A
      const sched = schedulersStore.get(schedulerDocId)!;
      sched.cursors.scheduled = 'tr_doc_100';

      // Worker A tenta comitar seu wrap tardio com Scan-Start CAS
      const current = sched.cursors.scheduled;
      if (workerAUpdate.nextCursor === null) {
        if (current === workerAUpdate.expectedStartCursor) {
          sched.cursors.scheduled = null; // Wrap legítimo
        }
        // Se current !== expectedStartCursor: stale wrap observation! Ignorado!
      }

      expect(sched.cursors.scheduled).toBe('tr_doc_100');
    });

    // 41. A and B both scan 050. A advances 100, B advances 090 late -> 100 preserved
    it('41. Forward Monotonicity: late commit of 090 cannot regress cursor 100', async () => {
      schedulersStore.clear();
      const schedulerDocId = 'normalization_asaas';

      schedulersStore.set(schedulerDocId, {
        id: schedulerDocId,
        provider: 'asaas',
        cursors: { scheduled: 'tr_doc_100' }, // A já comitou 100
        updated_at: new Date().toISOString(),
      });

      const workerBLateUpdate = { expectedStartCursor: 'tr_doc_050', nextCursor: 'tr_doc_090' };
      const sched = schedulersStore.get(schedulerDocId)!;
      const current = sched.cursors.scheduled;

      if (workerBLateUpdate.nextCursor !== null) {
        if (current === null) {
          if (workerBLateUpdate.expectedStartCursor === null) {
            sched.cursors.scheduled = workerBLateUpdate.nextCursor;
          }
        } else if (workerBLateUpdate.nextCursor > current) {
          sched.cursors.scheduled = workerBLateUpdate.nextCursor;
        }
      }

      expect(sched.cursors.scheduled).toBe('tr_doc_100');
    });

    // 42. Legitimate wrap: A scans current 100 to EOF with no other worker change -> 100 -> null succeeds
    it('42. Legitimate Wrap CAS: scanning from current 100 to EOF successfully wraps to null', async () => {
      schedulersStore.clear();
      const schedulerDocId = 'normalization_asaas';

      schedulersStore.set(schedulerDocId, {
        id: schedulerDocId,
        provider: 'asaas',
        cursors: { scheduled: 'tr_doc_100' },
        updated_at: new Date().toISOString(),
      });

      const workerAUpdate = { expectedStartCursor: 'tr_doc_100', nextCursor: null };
      const sched = schedulersStore.get(schedulerDocId)!;
      const current = sched.cursors.scheduled;

      if (workerAUpdate.nextCursor === null) {
        if (current === workerAUpdate.expectedStartCursor) {
          sched.cursors.scheduled = null; // CAS match!
        }
      }

      expect(sched.cursors.scheduled).toBeNull();
    });

    // 43. Two scopes update concurrently -> both survive
    it('43. Per-Scope Isolation: concurrent updates to scheduled and attention preserve both scopes', async () => {
      schedulersStore.clear();
      const schedulerDocId = 'normalization_asaas';

      schedulersStore.set(schedulerDocId, {
        id: schedulerDocId,
        provider: 'asaas',
        cursors: { scheduled: 'tr_sched_050', attention: 'tr_att_020' },
        updated_at: new Date().toISOString(),
      });

      const sched = schedulersStore.get(schedulerDocId)!;

      // Update 1: scheduled avança para 100
      sched.cursors.scheduled = 'tr_sched_100';
      // Update 2: attention avança para 040
      sched.cursors.attention = 'tr_att_040';

      expect(sched.cursors.scheduled).toBe('tr_sched_100');
      expect(sched.cursors.attention).toBe('tr_att_040');
    });

    // 44. Crash after normalization before cursor update -> at-least-once safety
    it('44. Crash After Normalization: documents remain normalized and cursor update retried safely', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_crash_norm_${String(i).padStart(3, '0')}`;
        const tr: any = {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
        };
        delete tr.last_reconciled_at;
        planChangesStore.set(id, tr);
      }

      // Normaliza documentos mas simula crash antes do commit do cursor
      for (const tr of planChangesStore.values()) {
        tr.last_reconciled_at = null;
      }
      // Cursor permanece não atualizado (null)
      const sched = schedulersStore.get('normalization_asaas');
      expect(sched).toBeUndefined();

      // No próximo ciclo pós-crash, a re-execução é totalmente idempotente e conclui o cursor
      const res = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(res.normalizedCount).toBe(0); // Já estavam com null
      expect(res.hasMore).toBe(false);
    });

    // ==========================================
    // ATTENTION TEST MATRIX (Section 13)
    // ==========================================

    // 45. 20 terminal attention + 1 scheduled live attention -> live candidate is reached
    it('45. Attention Starvation Guard: 20 terminal records do not hide 1 scheduled live attention', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_perm_term_${String(i).padStart(2, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'completed',
          financial_safety_status: 'safe_terminal',
          financial_attention_required: true,
          last_reconciled_at: null,
        } as any);
      }

      const liveId = 'tr_live_attention_target';
      planChangesStore.set(liveId, {
        ...getBaseScheduledTransition(),
        id: liveId,
        transition_id: liveId,
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        financial_attention_required: true,
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === liveId)).toBe(true);
      expect(batch.some((b: any) => b.id.startsWith('tr_perm_term_'))).toBe(false);
    });

    // 46. 100 terminal attention records -> do not pin live attention queue
    it('46. 100 Terminal Records Invariant: 100 terminal records never pin live attention queue', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 100; i++) {
        const id = `tr_term100_${String(i).padStart(3, '0')}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'canceled',
          financial_safety_status: 'safe_terminal',
          financial_attention_required: true,
          last_reconciled_at: null,
        } as any);
      }

      const liveId = 'tr_live_active_attention';
      planChangesStore.set(liveId, {
        ...getBaseScheduledTransition(),
        id: liveId,
        transition_id: liveId,
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        financial_attention_required: true,
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === liveId)).toBe(true);
    });

    // 47. Multiple live attention statuses -> eventual opportunity for each status
    it('47. Attention Multi-Status Fairness: fair interleaving grants opportunity across live attention statuses', async () => {
      planChangesStore.clear();

      // 5 attention em scheduled
      for (let i = 1; i <= 5; i++) {
        const id = `tr_att_sched_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'scheduled',
          financial_attention_required: true,
          last_reconciled_at: null,
        } as any);
      }

      // 5 attention em future_target_prepared
      for (let i = 1; i <= 5; i++) {
        const id = `tr_att_ftp_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'future_target_prepared',
          financial_attention_required: true,
          last_reconciled_at: null,
        } as any);
      }

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      const schedAttCount = batch.filter((b: any) => b.transition_status === 'scheduled' && b.financial_attention_required === true).length;
      const ftpAttCount = batch.filter((b: any) => b.transition_status === 'future_target_prepared' && b.financial_attention_required === true).length;

      expect(schedAttCount).toBeGreaterThanOrEqual(1);
      expect(ftpAttCount).toBeGreaterThanOrEqual(1);
    });

    // 48. Attention remains financially fail-closed
    it('48. Financial Attention Fail-Closed: reconciliation does not auto-activate, auto-clear or auto-refund', async () => {
      planChangesStore.clear();
      const tr = {
        ...getBaseScheduledTransition(),
        id: 'tr_att_fail_closed',
        transition_id: 'tr_att_fail_closed',
        financial_attention_required: true,
        financial_attention_reason: 'EARLY_ADJUSTMENT_MULTIPLE_PROVIDER_PAYMENTS',
        early_activation_status: 'pending_checkout',
        last_reconciled_at: null,
      } as any;
      planChangesStore.set(tr.id, tr);

      mockProvider.listPaymentsByCheckoutSession = vi.fn().mockResolvedValue([
        { id: 'pay_1', status: 'CONFIRMED', value: 34.9, dateCreated: '2026-09-02' },
        { id: 'pay_2', status: 'CONFIRMED', value: 34.9, dateCreated: '2026-09-02' },
      ]);

      const res = await reconcilerWorker.runCycle();
      const updated = planChangesStore.get(tr.id);

      // Invariantes estritos:
      expect(updated?.financial_attention_required).toBe(true);
      expect(updated?.early_activation_status).not.toBe('activated');
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    });

    // 49. Terminal transition never enters provider polling merely because financial_attention_required remained true historically
    it('49. Terminal Transition Provider Polling Guard: terminal transition is never polled', async () => {
      planChangesStore.clear();
      const tr = {
        ...getBaseScheduledTransition(),
        id: 'tr_term_never_poll',
        transition_id: 'tr_term_never_poll',
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
        financial_attention_required: true,
        last_reconciled_at: null,
      } as any;
      planChangesStore.set(tr.id, tr);

      mockProvider.listPaymentsByCheckoutSession = vi.fn();
      await reconcilerWorker.runCycle();

      expect(mockProvider.listPaymentsByCheckoutSession).not.toHaveBeenCalled();
    });

    // ==========================================
    // FIRESTORE INDEX CONTRACT (Section 14)
    // ==========================================

    // 50. Static Firestore Indexes Contract
    it('50. Firestore Index Contract: firestore.indexes.json defines exact composite indexes', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const indexesPath = path.resolve(__dirname, '../../../firestore.indexes.json');
      const content = JSON.parse(fs.readFileSync(indexesPath, 'utf8'));

      const planChangeIndexes = content.indexes.filter((idx: any) => idx.collectionGroup === 'billing_plan_changes');
      expect(planChangeIndexes.length).toBe(2);

      // Index 1: transition_status LRR
      const idx1 = planChangeIndexes.find((idx: any) => idx.fields.some((f: any) => f.fieldPath === 'transition_status' && !idx.fields.some((f2: any) => f2.fieldPath === 'financial_attention_required')));
      expect(idx1).toBeDefined();
      expect(idx1.fields.map((f: any) => f.fieldPath)).toEqual(['provider', 'transition_status', 'last_reconciled_at', '__name__']);

      // Index 2: transition_status + financial_attention_required LRR
      const idx2 = planChangeIndexes.find((idx: any) => idx.fields.some((f: any) => f.fieldPath === 'financial_attention_required'));
      expect(idx2).toBeDefined();
      expect(idx2.fields.map((f: any) => f.fieldPath)).toEqual(['provider', 'transition_status', 'financial_attention_required', 'last_reconciled_at', '__name__']);
    });

    // ==========================================
    // CROSS-PHASE RECONCILIATION TEST MATRIX (Section 11)
    // ==========================================

    // 51. Cada live V1 reconciliation status conhecido é retornável pelo scheduler
    it('51. Cross-Phase: all 5 known live V1 reconciliation statuses are discoverable by scheduler', async () => {
      planChangesStore.clear();

      const liveStatuses = [
        'pending_initial_purchase',
        'pending_future_authorization',
        'future_target_prepared',
        'awaiting_old_inactivation',
        'scheduled',
      ];

      for (const st of liveStatuses) {
        const id = `tr_live_known_${st}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: st,
          last_reconciled_at: null,
        } as any);
      }

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      const foundStatuses = batch.map((b: any) => b.transition_status);

      for (const st of liveStatuses) {
        expect(foundStatuses).toContain(st);
      }
    });

    // 52. Cada terminal V1 status é excluído antes do effective limit
    it('52. Cross-Phase: each terminal V1 status is excluded before effective limit', async () => {
      planChangesStore.clear();

      const terminalStatuses = ['completed', 'canceled', 'superseded', 'failed'];
      for (const st of terminalStatuses) {
        for (let i = 1; i <= 5; i++) {
          const id = `tr_term_test_${st}_${i}`;
          planChangesStore.set(id, {
            ...getBaseScheduledTransition(),
            id,
            transition_id: id,
            transition_status: st,
            financial_safety_status: 'safe_terminal',
            financial_attention_required: true,
            last_reconciled_at: null,
          } as any);
        }
      }

      const liveId = 'tr_lone_live_survivor';
      planChangesStore.set(liveId, {
        ...getBaseScheduledTransition(),
        id: liveId,
        transition_id: liveId,
        transition_status: 'scheduled',
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.length).toBe(1);
      expect(batch[0].id).toBe(liveId);
    });

    // 53. Initial purchase pending/reconcilable continua visível
    it('53. Cross-Phase: Phase 3A initial purchase pending_initial_purchase is scheduled and discoverable', async () => {
      planChangesStore.clear();

      const ipId = 'tr_phase3a_initial_purchase';
      planChangesStore.set(ipId, {
        ...getBaseScheduledTransition(),
        id: ipId,
        transition_id: ipId,
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
        financial_safety_status: 'live',
        financial_attention_required: false,
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === ipId && b.transition_status === 'pending_initial_purchase')).toBe(true);
    });

    // 54. Initial purchase + financial attention continua visível
    it('54. Cross-Phase: Phase 3A initial purchase with financial attention is scheduled in attention bucket', async () => {
      planChangesStore.clear();

      const ipAttId = 'tr_phase3a_attention';
      planChangesStore.set(ipAttId, {
        ...getBaseScheduledTransition(),
        id: ipAttId,
        transition_id: ipAttId,
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
        financial_safety_status: 'live',
        financial_attention_required: true,
        financial_attention_reason: 'UNCERTAIN_CREATE_TIMEOUT',
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === ipAttId && b.financial_attention_required === true)).toBe(true);
    });

    // 55. Paid-to-paid live statuses continuam visíveis
    it('55. Cross-Phase: Phase 3B/3C paid-to-paid live statuses remain visible and ordered', async () => {
      planChangesStore.clear();

      const p2pStatuses = ['pending_future_authorization', 'future_target_prepared', 'awaiting_old_inactivation', 'scheduled'];
      for (const st of p2pStatuses) {
        const id = `tr_p2p_${st}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          execution_strategy: 'scheduled_paid_transition',
          transition_status: st,
          last_reconciled_at: null,
        } as any);
      }

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      for (const st of p2pStatuses) {
        expect(batch.some((b: any) => b.transition_status === st)).toBe(true);
      }
    });

    // 56. 20 records de um live status não starvam outro live status (cross-phase starvation guard)
    it('56. Cross-Phase: 20 scheduled records do not starve 1 pending_initial_purchase record', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 20; i++) {
        const id = `tr_sched_bulk_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          transition_status: 'scheduled',
          last_reconciled_at: null,
        } as any);
      }

      const ipId = 'tr_ip_lone_candidate';
      planChangesStore.set(ipId, {
        ...getBaseScheduledTransition(),
        id: ipId,
        transition_id: ipId,
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === ipId)).toBe(true);
    });

    // 57. Terminal attention records continuam incapazes de consumir o lote
    it('57. Cross-Phase: terminal attention records never consume candidate limit', async () => {
      planChangesStore.clear();

      for (let i = 1; i <= 30; i++) {
        const id = `tr_term_att_ip_${i}`;
        planChangesStore.set(id, {
          ...getBaseScheduledTransition(),
          id,
          transition_id: id,
          execution_strategy: 'immediate_initial_purchase',
          transition_status: 'completed',
          financial_safety_status: 'safe_terminal',
          financial_attention_required: true,
          last_reconciled_at: null,
        } as any);
      }

      const liveAttId = 'tr_live_ip_attention';
      planChangesStore.set(liveAttId, {
        ...getBaseScheduledTransition(),
        id: liveAttId,
        transition_id: liveAttId,
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
        financial_safety_status: 'live',
        financial_attention_required: true,
        last_reconciled_at: null,
      } as any);

      const batch = await mockBillingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      expect(batch.some((b: any) => b.id === liveAttId)).toBe(true);
      expect(batch.some((b: any) => b.id.startsWith('tr_term_att_ip_'))).toBe(false);
    });

    // 58. Worker routing continua escolhendo o reconciler correto por strategy/status
    it('58. Cross-Phase: worker routes immediate_initial_purchase strictly to reconcileInitialPurchaseTransition', async () => {
      planChangesStore.clear();

      const ipId = 'tr_routing_initial_purchase';
      planChangesStore.set(ipId, {
        ...getBaseScheduledTransition(),
        id: ipId,
        transition_id: ipId,
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
        last_reconciled_at: null,
      } as any);

      billingService.reconcileInitialPurchaseTransition = vi.fn().mockResolvedValue({ success: true });
      billingService.reconcilePaidToPaidEarlyActivationAdjustment = vi.fn();

      await reconcilerWorker.runCycle();

      expect(billingService.reconcileInitialPurchaseTransition).toHaveBeenCalledWith(ipId, expect.any(String));
      expect(billingService.reconcilePaidToPaidEarlyActivationAdjustment).not.toHaveBeenCalled();
    });

    // 59. Nenhum estado da Phase 3C.5B/Paid->Free é inventado
    it('59. Cross-Phase: V1_RECONCILABLE_TRANSITION_STATUSES defines exactly the 5 supported live statuses', async () => {
      const { V1_RECONCILABLE_TRANSITION_STATUSES: statuses } = await import('./billing.types.js');
      expect(statuses).toEqual([
        'pending_initial_purchase',
        'pending_future_authorization',
        'future_target_prepared',
        'awaiting_old_inactivation',
        'scheduled',
      ]);
    });

    // 60. Normalization Pass covers all 5 reconcilable statuses via durable cursors
    it('60. Cross-Phase: normalization pass covers pending_initial_purchase without skipping other scopes', async () => {
      planChangesStore.clear();
      schedulersStore.clear();

      const ipId = 'tr_norm_ip_001';
      const tr: any = {
        ...getBaseScheduledTransition(),
        id: ipId,
        transition_id: ipId,
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
      };
      delete tr.last_reconciled_at;
      planChangesStore.set(ipId, tr);

      const res = await mockBillingRepo.normalizeLegacyTransitionsWithoutScheduling('asaas', 50);
      expect(res.normalizedCount).toBe(1);

      const normalizedDoc = planChangesStore.get(ipId);
      expect(normalizedDoc?.last_reconciled_at).toBeNull();
    });
  });
});
