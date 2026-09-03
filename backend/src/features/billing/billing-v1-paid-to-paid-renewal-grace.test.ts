import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from './billing.service.js';
import { BillingReconcilerWorker } from './billing-reconciler.worker.js';
import {
  BillingPlanChangeRecord,
  BillingActiveTransitionSlotRecord,
  BillingSubscriptionRecord,
  BillingCustomerRecord,
  BillingTransactionRecord,
  BillingTransitionV1Record,
  EntitlementSnapshot,
} from './billing.types.js';
import { AppError } from '../../middleware/error-handler.js';
import { config } from '../../config/unifiedConfig.js';
import { PLANS_CATALOG, resolveAccessMode } from '../../config/plans.config.js';
import { SubscriptionService as RealSubscriptionService } from '../subscriptions/subscription.service.js';
import { addCommercialDays } from '../../utils/billing-date.js';

describe('Phase 3B.3B — Renewal Failure, 7-Day Grace & Recovery', () => {
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
  const membersStore = new Map<string, any[]>();
  const songsStore = new Map<string, any[]>();

  const baseScheduledTransition: BillingTransitionV1Record = {
    id: 'tr_grace_001',
    transition_id: 'tr_grace_001',
    policy_version: 'billing_transition_v1',
    ministry_id: 'min_grace_test',
    provider: 'asaas',
    currency: 'BRL',
    execution_strategy: 'scheduled_paid_transition',
    transition_status: 'scheduled',
    early_activation_status: 'not_applicable',
    financial_safety_status: 'live',
    transition_type: 'upgrade',
    status: 'pending',
    provider_customer_id: 'cus_grace_1',
    source_plan_id: 'lite',
    source_interval: 'monthly',
    source_addon_blocks: 0,
    source_current_cycle_total_cents: 1490,
    source_entitlement_snapshot: {
      plan_id: 'lite',
      addon_blocks: 0,
      interval: 'monthly',
      effective_member_quota: 20,
      effective_song_quota: 100,
    },
    current_period_start: '2026-09-02T00:00:00.000Z',
    current_period_end: '2026-10-02T00:00:00.000Z',
    current_period_start_billing_date: '2026-09-02',
    current_period_end_billing_date: '2026-10-02',
    effective_billing_date: '2026-10-02',
    target_plan_id: 'essential',
    target_interval: 'monthly',
    target_addon_blocks: 0,
    target_future_recurring_price_cents: 3490,
    target_entitlement_snapshot: {
      plan_id: 'essential',
      addon_blocks: 0,
      interval: 'monthly',
      effective_member_quota: 40,
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
    future_provider_payment_id: 'pay_target_001',
    future_provider_checkout_id: 'chk_future_001',
    future_checkout_intent_id: 'intent_future_001',
  };

  beforeEach(() => {
    (config as any).billingPublicApiUrl = 'https://api.louvaio.com';
    (config as any).billingTimezone = 'America/Sao_Paulo';

    planChangesStore.clear();
    activeSlotsStore.clear();
    subscriptionsStore.clear();
    customersStore.clear();
    appSubscriptionsStore.clear();
    transactionsStore.clear();
    membersStore.clear();
    songsStore.clear();

    membersStore.set('min_grace_test', [
      { id: 'm1', name: 'Member 1' },
      { id: 'm2', name: 'Member 2' },
    ]);
    songsStore.set('min_grace_test', [
      { id: 's1', title: 'Song 1' },
      { id: 's2', title: 'Song 2' },
    ]);

    mockBillingRepo = {
      getCustomer: vi.fn().mockImplementation(async (ministryId: string) => {
        return customersStore.get(`${ministryId}_asaas`) || null;
      }),
      setCustomer: vi.fn().mockImplementation(async (c: any) => {
        customersStore.set(c.id, c);
      }),
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return subscriptionsStore.get(ministryId) || null;
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
      getTransitionByFuturePaymentId: vi.fn().mockImplementation(async (paymentId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.future_provider_payment_id === paymentId) return tr;
        }
        return null;
      }),
      getTransitionByFutureSubscriptionId: vi.fn().mockImplementation(async (subId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.future_provider_subscription_id === subId) return tr;
        }
        return null;
      }),
      updateTransition: vi.fn().mockImplementation(async (id: string, ministryId: string, updates: any) => {
        const existing = planChangesStore.get(id);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
        return updated;
      }),
      enterScheduledPaidTransitionGrace: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada');
        if (!tr.grace_started_at) {
          const updated = {
            ...tr,
            grace_status: 'in_grace',
            grace_started_at: params.graceStartedAt,
            grace_start_billing_date: params.graceStartBillingDate,
            grace_end_billing_date: params.graceEndBillingDate,
            grace_entitlement_snapshot: params.graceEntitlementSnapshot,
            updated_at: params.graceStartedAt,
          };
          planChangesStore.set(tr.id, updated as any);
          return updated;
        }
        return tr;
      }),
      recordGraceExpiry: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada');
        if (!tr.grace_expired_at) {
          const updated = {
            ...tr,
            grace_status: 'expired',
            grace_expired_at: params.graceExpiredAt,
            grace_expired_billing_date: params.graceExpiredBillingDate,
            updated_at: params.graceExpiredAt,
          };
          planChangesStore.set(tr.id, updated as any);
          return updated;
        }
        return tr;
      }),
      confirmScheduledPaidRenewalActivation: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada');
        const updated = {
          ...tr,
          transition_status: 'completed',
          financial_safety_status: 'safe_terminal',
          status: 'completed',
          effective_billing_date: params.effectiveBillingDate,
          current_period_start_billing_date: params.currentPeriodStartBillingDate,
          current_period_end_billing_date: params.currentPeriodEndBillingDate,
          successful_renewal_provider_payment_id: params.providerPaymentId,
          renewal_paid_billing_date: params.renewalPaidBillingDate,
          renewal_payment_settled_at: params.renewalPaymentSettledAt,
          target_promoted_at: params.completedAt || new Date().toISOString(),
          completed_at: params.completedAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          grace_status: tr.grace_started_at ? 'resolved' : tr.grace_status,
        };
        planChangesStore.set(tr.id, updated as any);
        return updated;
      }),
      claimPlanChangeForRetry: vi.fn().mockImplementation(async (id: string, lockWorkerId: string) => {
        const tr = planChangesStore.get(id) as any;
        if (!tr) return null;
        if (tr.retry_locked_by && tr.retry_locked_until && new Date(tr.retry_locked_until).getTime() > Date.now()) {
          return null;
        }
        const updated = {
          ...tr,
          retry_locked_by: lockWorkerId,
          retry_locked_until: new Date(Date.now() + 60000).toISOString(),
        };
        planChangesStore.set(id, updated);
        return updated;
      }),
      claimTransitionForReconciliation: vi.fn().mockImplementation(async (id: string, lockWorkerId: string, lockDurationMs: number = 60000) => {
        const tr = planChangesStore.get(id) as any;
        if (!tr) return null;
        if (tr.financial_safety_status === 'safe_terminal' && tr.transition_status === 'completed') return null;
        if (tr.financial_attention_required === true) return null;
        if (tr.retry_locked_by && tr.retry_locked_until && new Date(tr.retry_locked_until).getTime() > Date.now() && tr.retry_locked_by !== lockWorkerId) {
          return null;
        }
        const updated = {
          ...tr,
          retry_locked_by: lockWorkerId,
          retry_locked_until: new Date(Date.now() + lockDurationMs).toISOString(),
        };
        planChangesStore.set(id, updated);
        return updated;
      }),
      releasePlanChangeLock: vi.fn().mockImplementation(async (id: string) => {
        const tr = planChangesStore.get(id) as any;
        if (tr) {
          tr.retry_locked_by = null;
          tr.retry_locked_until = null;
          planChangesStore.set(id, tr);
        }
      }),
      releaseSlotIfOwnedAndSafe: vi.fn().mockImplementation(async (ministryId: string, provider: string, transitionId: string) => {
        const tr = planChangesStore.get(transitionId);
        if (!tr || tr.transition_status !== 'completed' || tr.financial_safety_status !== 'safe_terminal') {
          return false;
        }
        activeSlotsStore.delete(`slot_${ministryId}_${provider}`);
        return true;
      }),
      saveTransaction: vi.fn().mockImplementation(async (tx: BillingTransactionRecord) => {
        const existing = transactionsStore.get(tx.id);
        if (existing) {
          if (existing.paid_billing_date && tx.paid_billing_date && existing.paid_billing_date !== tx.paid_billing_date) {
            throw new AppError(409, 'Conflito de data financeira', { code: 'CONFLICTING_FINANCIAL_DATE' });
          }
          if (existing.amount_cents !== undefined && tx.amount_cents !== undefined && existing.amount_cents !== tx.amount_cents) {
            throw new AppError(409, 'Conflito de valor financeiro', { code: 'CONFLICTING_FINANCIAL_AMOUNT' });
          }
        }
        transactionsStore.set(tx.id, tx);
      }),
      getTransaction: vi.fn().mockImplementation(async (provider: string, paymentId: string) => {
        return transactionsStore.get(`${provider}_${paymentId}`) || null;
      }),
      getTransactions: vi.fn().mockImplementation(async (ministryId: string) => {
        return Array.from(transactionsStore.values()).filter((t) => t.ministry_id === ministryId);
      }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return appSubscriptionsStore.get(ministryId) || null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        appSubscriptionsStore.set(sub.ministry_id, sub);
        return sub;
      }),
      ensureSubscriptionAndUsage: vi.fn().mockImplementation(async (ministryId: string) => {
        let sub = appSubscriptionsStore.get(ministryId);
        if (!sub) {
          sub = {
            id: ministryId,
            ministry_id: ministryId,
            plan_id: 'lite',
            member_addon_blocks: 0,
            billing_status: 'active',
            billing_interval: 'monthly',
            subscription_mode: 'paid',
            grace_period_expires_at: null,
            current_period_start: '2026-09-02T00:00:00.000Z',
            current_period_end: '2026-10-02T00:00:00.000Z',
            cancel_at_period_end: false,
            created_at: '2026-09-02T00:00:00.000Z',
            updated_at: '2026-09-02T00:00:00.000Z',
          };
          appSubscriptionsStore.set(ministryId, sub);
        }
        return {
          subscription: sub,
          usage: {
            id: ministryId,
            ministry_id: ministryId,
            members_count: membersStore.get(ministryId)?.length || 2,
            songs_count: songsStore.get(ministryId)?.length || 2,
            created_at: '2026-09-02T00:00:00.000Z',
            updated_at: '2026-09-02T00:00:00.000Z',
          },
        };
      }),
      getUsage: vi.fn().mockImplementation(async (ministryId: string) => {
        return {
          id: ministryId,
          ministry_id: ministryId,
          members_count: membersStore.get(ministryId)?.length || 2,
          songs_count: songsStore.get(ministryId)?.length || 2,
          created_at: '2026-09-02T00:00:00.000Z',
          updated_at: '2026-09-02T00:00:00.000Z',
        };
      }),
    };

    mockSubscriptionService = {
      applyLockedEntitlementSnapshot: vi.fn().mockImplementation(async (ministryId: string, snapshot: EntitlementSnapshot) => {
        const sub = appSubscriptionsStore.get(ministryId);
        const updated = {
          ...sub,
          plan_id: snapshot.plan_id,
          member_addon_blocks: snapshot.addon_blocks,
          billing_interval: snapshot.interval || sub?.billing_interval || 'monthly',
          billing_status: 'active',
          subscription_mode: 'paid',
          locked_member_quota: snapshot.effective_member_quota,
          locked_song_quota: snapshot.effective_song_quota,
          entitlement_snapshot: snapshot,
          grace_period_expires_at: null,
          grace_period_expires_billing_date: null,
          updated_at: new Date().toISOString(),
        };
        appSubscriptionsStore.set(ministryId, updated);
        return updated;
      }),
      changePlan: vi.fn().mockImplementation(async (ministryId: string, planId: string) => {
        const sub = appSubscriptionsStore.get(ministryId);
        if (sub) {
          sub.plan_id = planId;
          appSubscriptionsStore.set(ministryId, sub);
        }
      }),
      changeMemberAddonBlocks: vi.fn().mockImplementation(async (ministryId: string, blocks: number) => {
        const sub = appSubscriptionsStore.get(ministryId);
        if (sub) {
          sub.member_addon_blocks = blocks;
          appSubscriptionsStore.set(ministryId, sub);
        }
      }),
    };

    mockMinistryRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'min_grace_test', name: 'Grace Ministry' }),
    };

    mockUserRepo = {
      getUserRoleInMinistry: vi.fn().mockResolvedValue('admin'),
    };

    mockProvider = {
      name: 'asaas',
      getPayment: vi.fn().mockImplementation(async (paymentId: string) => {
        return {
          id: paymentId,
          subscriptionId: 'sub_target_new',
          customerId: 'cus_grace_1',
          status: 'PENDING',
          dueDate: '2026-10-02',
          amountCents: 3490,
        };
      }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      getSubscription: vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_source_old' || (subId && (subId.includes('source') || subId.includes('old')))) {
          return {
            id: subId,
            status: 'INACTIVE',
            customer: 'cus_grace_1',
            cycle: 'MONTHLY',
            valueCents: 1490,
          };
        }
        return {
          id: subId || 'sub_target_new',
          status: 'ACTIVE',
          customer: 'cus_grace_1',
          cycle: 'MONTHLY',
          valueCents: 3490,
        };
      }),
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

    // Initial setup
    planChangesStore.set('tr_grace_001', { ...baseScheduledTransition });
    activeSlotsStore.set('slot_min_grace_test_asaas', {
      id: 'slot_min_grace_test_asaas',
      ministry_id: 'min_grace_test',
      provider: 'asaas',
      plan_change_id: 'tr_grace_001',
      acquired_at: '2026-09-02T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
      version: 1,
    });
    appSubscriptionsStore.set('min_grace_test', {
      id: 'min_grace_test',
      ministry_id: 'min_grace_test',
      plan_id: 'lite',
      member_addon_blocks: 0,
      billing_status: 'active',
      billing_interval: 'monthly',
      subscription_mode: 'paid',
      grace_period_expires_at: null,
      current_period_start: '2026-09-02T00:00:00.000Z',
      current_period_end: '2026-10-02T00:00:00.000Z',
      cancel_at_period_end: false,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    });
    subscriptionsStore.set('min_grace_test', {
      id: 'asaas_min_grace_test',
      ministry_id: 'min_grace_test',
      provider: 'asaas',
      plan_id: 'lite',
      interval: 'monthly',
      member_addon_blocks: 0,
      amount_cents: 1490,
      status: 'active',
      provider_subscription_id: 'sub_source_old',
      provider_customer_id: 'cus_grace_1',
      started_at: '2026-09-02T00:00:00.000Z',
      current_period_start: '2026-09-02T00:00:00.000Z',
      current_period_end: '2026-10-02T00:00:00.000Z',
      current_period_start_billing_date: '2026-09-02',
      current_period_end_billing_date: '2026-10-02',
      effective_billing_date: '2026-09-02',
      cancel_at_period_end: false,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    });
  });

  // ==========================================================================
  // 1. BOUNDARY & GRACE ENTRY (Tests 1, 2, 8, 11, 12)
  // ==========================================================================
  describe('1. Commercial Boundary Reached & Grace Entry', () => {
    it('1. Boundary + PENDING → grace created with write-once dates and snapshot', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const boundaryDate = new Date('2026-10-02T08:00:00-03:00');
      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('grace_entered_unpaid');

      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.grace_status).toBe('in_grace');
      expect(tr.grace_start_billing_date).toBe('2026-10-02');
      expect(tr.grace_end_billing_date).toBe('2026-10-09');
      expect(tr.grace_entitlement_snapshot).toEqual({
        plan_id: 'lite',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 20,
        effective_song_quota: 100,
      });

      // Runtime subscription set to past_due with grace expiry
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('past_due');
      expect(appSub.grace_period_expires_billing_date).toBe('2026-10-09');

      // Slot remains strictly HELD
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });

    it('2. Duplicate reconciliation → same grace dates/snapshot (Write-Once Idempotency)', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const day1 = new Date('2026-10-02T10:00:00Z');
      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        day1,
        { nowCommercialDate: '2026-10-02' }
      );

      const firstGraceSnapshot = planChangesStore.get('tr_grace_001')!.grace_entitlement_snapshot;
      const firstGraceStart = planChangesStore.get('tr_grace_001')!.grace_start_billing_date;
      const firstGraceEnd = planChangesStore.get('tr_grace_001')!.grace_end_billing_date;

      // Segunda reconciliação no dia seguinte (2026-10-03)
      const day2 = new Date('2026-10-03T10:00:00Z');
      const secondResult = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        day2,
        { nowCommercialDate: '2026-10-03' }
      );

      expect(secondResult.reason).toBe('grace_entered_unpaid');
      const trAfterSecond = planChangesStore.get('tr_grace_001')!;
      expect(trAfterSecond.grace_start_billing_date).toBe(firstGraceStart);
      expect(trAfterSecond.grace_end_billing_date).toBe(firstGraceEnd);
      expect(trAfterSecond.grace_entitlement_snapshot).toEqual(firstGraceSnapshot);
    });

    it('8. Lite -> Essential unpaid preserves Lite quotas during grace (No Free Target)', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.plan_id).toBe('lite');
      expect(appSub.locked_member_quota).toBe(20);
      expect(appSub.locked_song_quota).toBe(100);

      // Não concede 40 membros ou 200 músicas do Essential
      expect(appSub.locked_member_quota).not.toBe(40);
      expect(appSub.locked_song_quota).not.toBe(200);
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it('11. PENDING during grace produces zero new paid BillingTransaction', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(transactionsStore.size).toBe(0);
      expect(mockBillingRepo.saveTransaction).not.toHaveBeenCalled();
    });

    it('12. OVERDUE during grace does not activate target and slot remains HELD', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-03T12:00:00Z'),
        { nowCommercialDate: '2026-10-03' }
      );

      expect(result.reason).toBe('grace_entered_unpaid');
      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.financial_safety_status).toBe('live');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 2. CIVIL GRACE MODEL [start, end) (Tests 3, 4, 5, 6, 7 & Access Mode A-D)
  // ==========================================================================
  describe('2. Civil Grace Model [start, end) & Access Mode', () => {
    it('3. Grace duration is exactly 7 civil days [effective_billing_date, effective + 7 days)', () => {
      const start = '2026-10-02';
      const end = addCommercialDays(start, 7, 'America/Sao_Paulo');
      expect(end).toBe('2026-10-09');
    });

    it('4 & A. Exact start (2026-10-02) is INSIDE grace and access is normal', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };
      const usage = { members_count: 5, songs_count: 10 };

      // Data de início: 2026-10-02
      const res = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-02T12:00:00Z'));
      expect(res.accessMode).toBe('normal');
      expect(res.isOverLimit).toBe(false);
      expect(res.effectiveQuotas.members).toBe(20);
    });

    it('5. Middle inside grace (2026-10-05) is INSIDE grace and access is normal', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };
      const usage = { members_count: 5, songs_count: 10 };

      const res = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-05T12:00:00Z'));
      expect(res.accessMode).toBe('normal');
    });

    it('6 & B. Exact last civil grace date (2026-10-08) is INSIDE grace (ainda normal)', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };
      const usage = { members_count: 5, songs_count: 10 };

      // 2026-10-08 é o último dia civil da carência [02..09)
      const res = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-08T23:59:00Z'));
      expect(res.accessMode).toBe('normal');
    });

    it('7 & C. Exact grace_end (2026-10-09) is EXPIRED and access becomes restricted_over_limit', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };
      const usage = { members_count: 5, songs_count: 10 };

      // A partir de 2026-10-09 00:00 America/Sao_Paulo a carência está expirada
      const res = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-09T10:00:00Z'));
      expect(res.accessMode).toBe('restricted_over_limit');
      expect(res.graceDaysRemaining).toBe(0);
      // Quotas históricas de Lite permanecem intactas no objeto retornado
      expect(res.effectiveQuotas.members).toBe(20);
      expect(res.effectiveQuotas.songs).toBe(100);
    });

    it('D. After grace_end (2026-10-10) remains restricted_over_limit', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };
      const usage = { members_count: 5, songs_count: 10 };

      const res = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-10T12:00:00Z'));
      expect(res.accessMode).toBe('restricted_over_limit');
    });
  });

  // ==========================================================================
  // 3. CATALOG DRIFT & PHASE 3C COMPATIBILITY (Tests 9, 10)
  // ==========================================================================
  describe('3. Immutability & Future 3C Compatibility', () => {
    it('9. Catalog drift during grace does not change locked snapshot', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      // Simula alteração no catálogo de Lite (drift)
      const originalLiteMembers = PLANS_CATALOG.lite.baseMembers;
      try {
        (PLANS_CATALOG.lite as any).baseMembers = 999;

        const tr = planChangesStore.get('tr_grace_001')!;
        expect(tr.grace_entitlement_snapshot?.effective_member_quota).toBe(20);

        const appSub = appSubscriptionsStore.get('min_grace_test')!;
        const mode = resolveAccessMode(appSub, PLANS_CATALOG.lite, { members_count: 5, songs_count: 10 }, new Date('2026-10-05T12:00:00Z'));
        expect(mode.effectiveQuotas.members).toBe(20);
        expect(mode.effectiveQuotas.members).not.toBe(999);
      } finally {
        (PLANS_CATALOG.lite as any).baseMembers = originalLiteMembers;
      }
    });

    it('10. Simulated pre-boundary target entitlement (Phase 3C) → grace captures TARGET', async () => {
      // Simula que antes da boundary o runtime já era Essential (ex: antecipado na 3C)
      appSubscriptionsStore.set('min_grace_test', {
        id: 'min_grace_test',
        ministry_id: 'min_grace_test',
        plan_id: 'essential',
        member_addon_blocks: 0,
        billing_status: 'active',
        billing_interval: 'monthly',
        subscription_mode: 'paid',
        locked_member_quota: 40,
        locked_song_quota: 200,
        grace_period_expires_at: null,
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-09-02T00:00:00.000Z',
      });

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('grace_entered_unpaid');
      const tr = planChangesStore.get('tr_grace_001')!;
      // Prova que grace != source fixo: capturou Essential (target) pois era o runtime pre-boundary!
      expect(tr.grace_entitlement_snapshot?.plan_id).toBe('essential');
      expect(tr.grace_entitlement_snapshot?.effective_member_quota).toBe(40);
      expect(tr.grace_entitlement_snapshot?.effective_song_quota).toBe(200);
    });
  });

  // ==========================================================================
  // 4. SETTLEMENT DURING GRACE & RECOVERY (Tests 13, 14, 15, 16, E)
  // ==========================================================================
  describe('4. Target Settlement During Grace (Recovery)', () => {
    it('13, 15, 16 & E. Payment settles inside grace (2026-10-05) → target activated, commercial period starts at 2026-10-02 and slot RELEASED', async () => {
      // 1. Entra em carência em 2026-10-02 com payment PENDING
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      // 2. Pagamento é quitado em 2026-10-05 (CONFIRMED) dentro da janela de carência
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        paymentDate: '2026-10-05',
        clientPaymentDate: '2026-10-05',
      });

      const recoveryDate = new Date('2026-10-05T15:30:00-03:00');
      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        recoveryDate,
        { nowCommercialDate: '2026-10-05' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('renewal_activated');

      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.transition_status).toBe('completed');
      expect(tr.financial_safety_status).toBe('safe_terminal');
      expect(tr.grace_status).toBe('resolved');

      // Proveniência temporal de datas:
      // 15. Novo período começa na fronteira comercial original (2026-10-02), NÃO na data do pagamento (2026-10-05)
      expect(tr.current_period_start_billing_date).toBe('2026-10-02');
      expect(tr.current_period_end_billing_date).toBe('2026-11-02');
      // 16. paid_billing_date preserva a data real do provedor (2026-10-05)
      expect(tr.renewal_paid_billing_date).toBe('2026-10-05');

      const tx = transactionsStore.get('asaas_pay_target_001');
      expect(tx).toBeDefined();
      expect(tx?.status).toBe('paid');
      expect(tx?.paid_billing_date).toBe('2026-10-05');
      expect(tx?.due_date).toBe('2026-10-02');

      // Entitlement promovido para Essential
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.plan_id).toBe('essential');
      expect(appSub.billing_status).toBe('active');
      expect(appSub.grace_period_expires_at).toBeNull();
      expect(appSub.locked_member_quota).toBe(40);
      expect(appSub.locked_song_quota).toBe(200);

      // Slot liberado LAST
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(false);
    });

    it('14. PAYMENT_RECEIVED during grace recovers target idempotently', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'RECEIVED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        paymentDate: '2026-10-08',
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-08T10:00:00Z'),
        { nowCommercialDate: '2026-10-08' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('renewal_activated');
      expect(planChangesStore.get('tr_grace_001')!.transition_status).toBe('completed');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(false);
    });

    it('17. REFUNDED payment blocks recovery and flags financial attention', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'REFUNDED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-04T10:00:00Z'),
        { nowCommercialDate: '2026-10-04' }
      );

      expect(result.reason).toBe('TARGET_PAYMENT_STATUS_REFUNDED');
      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });

    it('18. CHARGEBACK payment blocks recovery and keeps slot HELD', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CHARGEBACK',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-04T10:00:00Z'),
        { nowCommercialDate: '2026-10-04' }
      );

      expect(result.reason).toBe('TARGET_PAYMENT_STATUS_CHARGEBACK');
      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });
  });

  // ==========================================================================
  // 5. GRACE EXPIRY, DATA PRESERVATION & LATE PAYMENT (Tests 19, 20, 21, 22, 23, 24, F)
  // ==========================================================================
  describe('5. Grace Expiry, Data Preservation & Late Payment Policy Gap', () => {
    it('19, 21 & 22. Grace expiry at 2026-10-09 → access mode restricted, transition remains scheduled, slot HELD', async () => {
      // 1. Entra em carência em 2026-10-02
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      // 2. Reconcilia em 2026-10-09 (grace_end)
      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-09T08:00:00-03:00'),
        { nowCommercialDate: '2026-10-09' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('grace_expired_restricted');

      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.grace_status).toBe('expired');
      expect(tr.grace_expired_billing_date).toBe('2026-10-09');

      // 21. Transição NÃO está completed nem safe_terminal (obrigação financeira live)
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.financial_safety_status).toBe('live');

      // 22. Slot permanece HELD
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);

      // 19. Runtime em restricted_over_limit
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('past_due');
      const mode = resolveAccessMode(appSub, PLANS_CATALOG.lite, { members_count: 2, songs_count: 2 }, new Date('2026-10-09T10:00:00Z'));
      expect(mode.accessMode).toBe('restricted_over_limit');
    });

    it('20. Grace expiry deletes zero data (absolute preservation of members, songs, and subscriptions)', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Passa pela fronteira e expiração
      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-10T10:00:00Z'),
        { nowCommercialDate: '2026-10-10' }
      );

      // Verifica dados intactos
      expect(membersStore.get('min_grace_test')?.length).toBe(2);
      expect(songsStore.get('min_grace_test')?.length).toBe(2);
      expect(appSubscriptionsStore.has('min_grace_test')).toBe(true);
      expect(subscriptionsStore.has('min_grace_test')).toBe(true);
      expect(planChangesStore.has('tr_grace_001')).toBe(true);
    });

    it('23, 24 & F. Late payment at or after grace_end (2026-10-09) → does NOT auto-activate target, flags explicit policy gap and keeps slot HELD', async () => {
      // Configura transição já com carência de [2026-10-02, 2026-10-09)
      const trWithGrace: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        grace_status: 'in_grace',
        grace_started_at: '2026-10-02T10:00:00Z',
        grace_start_billing_date: '2026-10-02',
        grace_end_billing_date: '2026-10-09',
        grace_entitlement_snapshot: {
          plan_id: 'lite',
          addon_blocks: 0,
          interval: 'monthly',
          effective_member_quota: 20,
          effective_song_quota: 100,
        },
      };
      planChangesStore.set('tr_grace_001', trWithGrace);

      // Pagamento liquidado exatamente em grace_end (2026-10-09)
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        paymentDate: '2026-10-09',
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-09T14:00:00-03:00'),
        { nowCommercialDate: '2026-10-09' }
      );

      // Condição explícita de gap de política documentado
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('RENEWAL_SETTLED_AFTER_GRACE_REQUIRES_POLICY');

      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('RENEWAL_SETTLED_AFTER_GRACE_REQUIRES_POLICY');
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.financial_safety_status).toBe('attention_required');

      // NÃO auto-ativa target
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();

      // Slot permanece HELD
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });

    it('25. Source provider subscription is NEVER reactivated during grace or expiry', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Provider não deve ter método updateSubscription/reactivate chamado para a assinatura source
      mockProvider.updateSubscription = vi.fn();

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-03T10:00:00Z'),
        { nowCommercialDate: '2026-10-03' }
      );

      expect(mockProvider.updateSubscription).not.toHaveBeenCalled();
    });

    it('26. No duplicate target subscription is created during grace evaluation', async () => {
      mockProvider.createSubscription = vi.fn();

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-03T10:00:00Z'),
        { nowCommercialDate: '2026-10-03' }
      );

      expect(mockProvider.createSubscription).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 6. CRASH RECOVERY MATRIX A-F & RECONCILER (Tests 27, 28)
  // ==========================================================================
  describe('6. Crash Recovery Matrix (A-F) & Single State Machine', () => {
    it('27.A Crash A: boundary reached -> crash before grace persistence -> reconciler converges', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Reconciliador executa como se tivesse acordado após crash
      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_crash_a',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('grace_entered_unpaid');
      expect(planChangesStore.get('tr_grace_001')!.grace_status).toBe('in_grace');
    });

    it('27.B Crash B: grace persisted -> crash before access evaluation -> reconciler does not alter snapshot', async () => {
      // Simula grace já gravado
      const trWithGrace: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        grace_status: 'in_grace',
        grace_started_at: '2026-10-02T08:00:00Z',
        grace_start_billing_date: '2026-10-02',
        grace_end_billing_date: '2026-10-09',
        grace_entitlement_snapshot: {
          plan_id: 'lite',
          addon_blocks: 0,
          interval: 'monthly',
          effective_member_quota: 20,
          effective_song_quota: 100,
        },
      };
      planChangesStore.set('tr_grace_001', trWithGrace);

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_crash_b',
        { nowCommercialDate: '2026-10-03' }
      );

      expect(recResult.success).toBe(true);
      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.grace_started_at).toBe('2026-10-02T08:00:00Z');
      expect(tr.grace_end_billing_date).toBe('2026-10-09');
    });

    it('27.C Crash C: payment settles during grace -> BillingTransaction saved -> crash before activation -> reconciler completes', async () => {
      // Transação já gravada
      transactionsStore.set('asaas_pay_target_001', {
        id: 'asaas_pay_target_001',
        ministry_id: 'min_grace_test',
        provider: 'asaas',
        provider_payment_id: 'pay_target_001',
        amount_cents: 3490,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-10-02',
        paid_at: '2026-10-04T10:00:00Z',
        paid_billing_date: '2026-10-04',
        created_at: '2026-10-04T10:00:00Z',
        updated_at: '2026-10-04T10:00:00Z',
      });

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        paymentDate: '2026-10-04',
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_crash_c',
        { nowCommercialDate: '2026-10-04' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('renewal_activated');
      expect(planChangesStore.get('tr_grace_001')!.transition_status).toBe('completed');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(false);
    });

    it('27.D Crash D: partial target activation -> reconciler completes and releases slot', async () => {
      // AppSub já promovido mas transição ainda em scheduled
      appSubscriptionsStore.set('min_grace_test', {
        id: 'min_grace_test',
        ministry_id: 'min_grace_test',
        plan_id: 'essential',
        member_addon_blocks: 0,
        billing_status: 'active',
        billing_interval: 'monthly',
        subscription_mode: 'paid',
        current_period_start: '2026-10-02T00:00:00.000Z',
        current_period_end: '2026-11-02T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
      });

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_crash_d',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(planChangesStore.get('tr_grace_001')!.transition_status).toBe('completed');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(false);
    });

    it('27.E Crash E: grace expires -> crash before restricted_over_limit -> reconciler converges restriction', async () => {
      // Carência de [2026-10-02, 2026-10-09)
      const trWithGrace: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        grace_status: 'in_grace',
        grace_started_at: '2026-10-02T10:00:00Z',
        grace_start_billing_date: '2026-10-02',
        grace_end_billing_date: '2026-10-09',
        grace_entitlement_snapshot: {
          plan_id: 'lite',
          addon_blocks: 0,
          interval: 'monthly',
          effective_member_quota: 20,
          effective_song_quota: 100,
        },
      };
      planChangesStore.set('tr_grace_001', trWithGrace);

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Reconciliador roda em 2026-10-09
      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_crash_e',
        { nowCommercialDate: '2026-10-09' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('grace_expired_restricted');
      expect(planChangesStore.get('tr_grace_001')!.grace_status).toBe('expired');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });

    it('27.F Crash F: restricted_over_limit applied -> crash before expiry persistence -> reconciler does not duplicate effect and keeps slot HELD', async () => {
      // AppSub já past_due
      appSubscriptionsStore.set('min_grace_test', {
        id: 'min_grace_test',
        ministry_id: 'min_grace_test',
        plan_id: 'lite',
        member_addon_blocks: 0,
        billing_status: 'past_due',
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-09-02T00:00:00.000Z',
      });

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_crash_f',
        { nowCommercialDate: '2026-10-10' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('grace_expired_restricted');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
      expect(planChangesStore.get('tr_grace_001')!.transition_status).toBe('scheduled');
    });

    it('28. Webhook and Reconciler use the exact same single state machine', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const webhookPayload = {
        providerEventId: 'evt_overdue_1',
        eventType: 'payment_overdue' as const,
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: 'pay_target_001',
        providerSubscriptionId: 'sub_target_new',
        dueDate: '2026-10-02',
      };

      // Webhook executa
      const hookResult = await billingService.processScheduledPaidRenewalSettlement(
        webhookPayload,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T10:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(hookResult.reason).toBe('grace_entered_unpaid');

      // Reconciler executa a mesma máquina
      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_test_same',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.reason).toBe('grace_entered_unpaid');
    });
  });

  // ==========================================================================
  // 7. BILLING STATUS & ACCESS-MODE CONSISTENCY AUDIT (Tests A - J)
  // ==========================================================================
  describe('7. Phase 3B.3B — Billing Status & Access-Mode Consistency Audit (Tests A - J)', () => {
    it('Audit A: boundary + unpaid -> transition grace persisted, ministry subscription past_due, grace expiry date synchronized', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const boundaryInstant = new Date('2026-10-02T08:00:00-03:00');
      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        boundaryInstant,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('grace_entered_unpaid');

      // 1. Autoridade da Transição (BillingTransition)
      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.grace_status).toBe('in_grace');
      expect(tr.grace_start_billing_date).toBe('2026-10-02');
      expect(tr.grace_end_billing_date).toBe('2026-10-09');
      expect(tr.financial_safety_status).toBe('live');

      // 2. Autoridade do Runtime (MinistrySubscription)
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('past_due');
      expect(appSub.grace_period_expires_billing_date).toBe('2026-10-09');
      expect(appSub.grace_period_expires_billing_date).toBe(tr.grace_end_billing_date);
      expect(appSub.plan_id).toBe('lite'); // NÃO alterado para target
      expect(appSub.locked_member_quota).toBe(20);
      expect(appSub.locked_song_quota).toBe(100);

      // 3. Slot Invariant
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });

    it('Audit B: transition grace persisted -> crash antes de subscription past_due -> reconciler converges', async () => {
      // Simula crash exatamente após enterScheduledPaidTransitionGrace:
      // transição já possui grace gravado, mas ministry_subscriptions ainda está 'active'
      const trWithGraceOnly: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        grace_status: 'in_grace',
        grace_started_at: '2026-10-02T08:00:00.000Z',
        grace_start_billing_date: '2026-10-02',
        grace_end_billing_date: '2026-10-09',
        grace_entitlement_snapshot: {
          plan_id: 'lite',
          addon_blocks: 0,
          interval: 'monthly',
          effective_member_quota: 20,
          effective_song_quota: 100,
        },
      };
      planChangesStore.set('tr_grace_001', trWithGraceOnly);

      // Subscription ainda 'active' devido ao crash
      appSubscriptionsStore.set('min_grace_test', {
        id: 'min_grace_test',
        ministry_id: 'min_grace_test',
        plan_id: 'lite',
        member_addon_blocks: 0,
        billing_status: 'active',
        billing_interval: 'monthly',
        subscription_mode: 'paid',
        grace_period_expires_at: null,
        grace_period_expires_billing_date: null,
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-09-02T00:00:00.000Z',
      });

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Reconciliador acorda após o crash
      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_audit_b',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('grace_entered_unpaid');

      // Runtime subscription deve ter convergido crash-safely para past_due
      const convergedSub = appSubscriptionsStore.get('min_grace_test');
      expect(convergedSub.billing_status).toBe('past_due');
      expect(convergedSub.grace_period_expires_billing_date).toBe('2026-10-09');
      expect(convergedSub.locked_member_quota).toBe(20);
      expect(convergedSub.locked_song_quota).toBe(100);
    });

    it('Audit C: subscription past_due persisted -> crash antes de transition grace completion -> reconciler converges safely', async () => {
      // Simula crash onde ministry_subscriptions já está past_due mas transição ainda não tinha gravado grace_started_at
      appSubscriptionsStore.set('min_grace_test', {
        id: 'min_grace_test',
        ministry_id: 'min_grace_test',
        plan_id: 'lite',
        member_addon_blocks: 0,
        billing_status: 'past_due',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        grace_period_expires_billing_date: '2026-10-09',
        locked_member_quota: 20,
        locked_song_quota: 100,
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-09-02T00:00:00.000Z',
      });

      // Transição ainda pura 'scheduled' sem grace
      planChangesStore.set('tr_grace_001', { ...baseScheduledTransition });

      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_audit_c',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('grace_entered_unpaid');

      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.grace_status).toBe('in_grace');
      expect(tr.grace_started_at).toBeDefined();
      expect(tr.grace_start_billing_date).toBe('2026-10-02');
      expect(tr.grace_end_billing_date).toBe('2026-10-09');

      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('past_due');
      expect(appSub.grace_period_expires_billing_date).toBe('2026-10-09');
    });

    it('Audit D: inside grace: past_due + before expiry -> normal access using locked grace entitlement', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };

      // Uso dentro do plano Lite (15 membros, 80 músicas)
      const withinLite = { members_count: 15, songs_count: 80 };
      const res = resolveAccessMode(sub, PLANS_CATALOG.lite, withinLite, new Date('2026-10-05T12:00:00Z'));
      expect(res.accessMode).toBe('normal');
      expect(res.effectiveQuotas.members).toBe(20);
      expect(res.effectiveQuotas.songs).toBe(100);

      // Se exceder a quota do snapshot (ex: 25 membros), entra em grace de cota, mas NÃO concede target
      const overLite = { members_count: 25, songs_count: 80 };
      const resOver = resolveAccessMode(sub, PLANS_CATALOG.lite, overLite, new Date('2026-10-05T12:00:00Z'));
      expect(resOver.accessMode).toBe('grace');
      expect(resOver.effectiveQuotas.members).toBe(20); // Quota é 20 (Lite), nunca 40 (Essential)
    });

    it('Audit E: exact grace_end -> restricted_over_limit: 02/10 -> normal, 08/10 -> normal, 09/10 -> restricted_over_limit', () => {
      const sub = {
        plan_id: 'lite' as const,
        member_addon_blocks: 0,
        billing_status: 'past_due' as const,
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
      };
      const usage = { members_count: 5, songs_count: 10 };

      // 02/10 -> normal
      const dayStart = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-02T10:00:00Z'));
      expect(dayStart.accessMode).toBe('normal');

      // 08/10 -> normal (último dia da janela)
      const dayLast = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-08T22:00:00Z'));
      expect(dayLast.accessMode).toBe('normal');

      // 09/10 -> restricted_over_limit (data de término da carência)
      const dayEnd = resolveAccessMode(sub, PLANS_CATALOG.lite, usage, new Date('2026-10-09T12:00:00Z'));
      expect(dayEnd.accessMode).toBe('restricted_over_limit');
    });

    it('Audit F: payment settles inside grace -> target activation, billing_status active, access normal target', async () => {
      // 1. Entra em carência
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T10:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      // 2. Quitação confirmada em 2026-10-06
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        paymentDate: '2026-10-06',
      });

      const recResult = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-06T14:00:00Z'),
        { nowCommercialDate: '2026-10-06' }
      );

      expect(recResult.processed).toBe(true);
      expect(recResult.reason).toBe('renewal_activated');

      // MinistrySubscription promovido para target Essential ativo
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('active');
      expect(appSub.plan_id).toBe('essential');
      expect(appSub.locked_member_quota).toBe(40);
      expect(appSub.locked_song_quota).toBe(200);
      expect(appSub.grace_period_expires_billing_date).toBeNull();
      expect(appSub.grace_period_expires_at).toBeNull();

      // AccessMode avalia como normal target com 40 membros
      const mode = resolveAccessMode(appSub, PLANS_CATALOG.essential, { members_count: 35, songs_count: 150 }, new Date('2026-10-06T15:00:00Z'));
      expect(mode.accessMode).toBe('normal');
      expect(mode.effectiveQuotas.members).toBe(40);

      // Transição concluída e slot liberado
      expect(planChangesStore.get('tr_grace_001')!.transition_status).toBe('completed');
      expect(planChangesStore.get('tr_grace_001')!.grace_status).toBe('resolved');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(false);
    });

    it('Audit G: grace metadata stale after recovery cannot cause restricted mode later', () => {
      // Simula que após recovery a assinatura está active com cotas Essential
      const recoveredSub = {
        plan_id: 'essential' as const,
        member_addon_blocks: 0,
        billing_status: 'active' as const,
        grace_period_expires_billing_date: null,
        grace_period_expires_at: null,
        locked_member_quota: 40,
        locked_song_quota: 200,
      };

      // Uso dentro do Essential
      const res = resolveAccessMode(recoveredSub, PLANS_CATALOG.essential, { members_count: 30, songs_count: 150 }, new Date('2026-10-15T12:00:00Z'));
      expect(res.accessMode).toBe('normal');

      // Mesmo se hipoteticamente grace_period_expires_billing_date fosse um valor do passado ('2026-10-09'):
      const subWithStaleGraceDate = {
        ...recoveredSub,
        grace_period_expires_billing_date: '2026-10-09',
      };
      // Em status 'active', a carência de inadimplência NÃO é consultada, evitando qualquer falso restricted_over_limit
      const resActive = resolveAccessMode(subWithStaleGraceDate, PLANS_CATALOG.essential, { members_count: 30, songs_count: 150 }, new Date('2026-10-15T12:00:00Z'));
      expect(resActive.accessMode).toBe('normal');
    });

    it('Audit H: grace expired -> past_due + restricted_over_limit, zero deletions of data', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Avaliação na data de expiração (2026-10-09)
      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-09T10:00:00Z'),
        { nowCommercialDate: '2026-10-09' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('grace_expired_restricted');

      // MinistrySubscription permanece past_due
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('past_due');
      expect(appSub.plan_id).toBe('lite'); // Não muda para free/canceled

      // Modo de acesso restrito
      const mode = resolveAccessMode(appSub, PLANS_CATALOG.lite, { members_count: 2, songs_count: 2 }, new Date('2026-10-09T12:00:00Z'));
      expect(mode.accessMode).toBe('restricted_over_limit');

      // Zero deletions
      expect(membersStore.get('min_grace_test')?.length).toBe(2);
      expect(songsStore.get('min_grace_test')?.length).toBe(2);
      expect(appSubscriptionsStore.has('min_grace_test')).toBe(true);

      // Transição scheduled e slot HELD
      expect(planChangesStore.get('tr_grace_001')!.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);
    });

    it('Audit I: payment after expiry -> financial attention, billing_status NOT automatically active', async () => {
      // Transição já com carência expirada
      const expiredTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        grace_status: 'expired',
        grace_started_at: '2026-10-02T10:00:00Z',
        grace_start_billing_date: '2026-10-02',
        grace_end_billing_date: '2026-10-09',
        grace_expired_at: '2026-10-09T10:00:00Z',
        grace_expired_billing_date: '2026-10-09',
      };
      planChangesStore.set('tr_grace_001', expiredTr);

      // Assinatura em past_due
      appSubscriptionsStore.set('min_grace_test', {
        id: 'min_grace_test',
        ministry_id: 'min_grace_test',
        plan_id: 'lite',
        member_addon_blocks: 0,
        billing_status: 'past_due',
        grace_period_expires_billing_date: '2026-10-09',
        grace_period_expires_at: '2026-10-09T00:00:00.000Z',
        locked_member_quota: 20,
        locked_song_quota: 100,
        current_period_start: '2026-09-02T00:00:00.000Z',
        current_period_end: '2026-10-02T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-09-02T00:00:00.000Z',
      });

      // Pagamento confirmado pós-carência em 2026-10-12
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        paymentDate: '2026-10-12',
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-12T10:00:00Z'),
        { nowCommercialDate: '2026-10-12' }
      );

      // Bloqueia auto-ativação
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('RENEWAL_SETTLED_AFTER_GRACE_REQUIRES_POLICY');

      const tr = planChangesStore.get('tr_grace_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);

      // billing_status NÃO é alterado para active automaticamente
      const appSub = appSubscriptionsStore.get('min_grace_test');
      expect(appSub.billing_status).toBe('past_due');
      expect(appSub.plan_id).toBe('lite');
    });

    it('Audit J: duplicate webhook / reconciler -> states stay converged and idempotent', async () => {
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_grace_1',
        status: 'PENDING',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Primeiro webhook dispara entrada em carência
      const webhook1 = {
        providerEventId: 'evt_1',
        eventType: 'payment_overdue' as const,
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: 'pay_target_001',
        providerSubscriptionId: 'sub_target_new',
      };

      await billingService.processScheduledPaidRenewalSettlement(
        webhook1,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T10:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      const firstSnapshot = planChangesStore.get('tr_grace_001')!.grace_entitlement_snapshot;
      const firstGraceStartedAt = planChangesStore.get('tr_grace_001')!.grace_started_at;

      // Segundo webhook idêntico
      const webhook2 = { ...webhook1, providerEventId: 'evt_2' };
      await billingService.processScheduledPaidRenewalSettlement(
        webhook2,
        planChangesStore.get('tr_grace_001')!,
        new Date('2026-10-02T11:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      // Reconciliador executa em seguida
      await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_grace_001',
        'worker_dup',
        { nowCommercialDate: '2026-10-02' }
      );

      const trFinal = planChangesStore.get('tr_grace_001')!;
      expect(trFinal.grace_started_at).toBe(firstGraceStartedAt);
      expect(trFinal.grace_entitlement_snapshot).toEqual(firstSnapshot);
      expect(trFinal.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has('slot_min_grace_test_asaas')).toBe(true);

      const subFinal = appSubscriptionsStore.get('min_grace_test');
      expect(subFinal.billing_status).toBe('past_due');
      expect(subFinal.grace_period_expires_billing_date).toBe('2026-10-09');
    });
  });
});
