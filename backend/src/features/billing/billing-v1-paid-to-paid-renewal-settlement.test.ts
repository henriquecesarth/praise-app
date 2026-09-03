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
} from './billing.types.js';
import { AppError } from '../../middleware/error-handler.js';
import { config } from '../../config/unifiedConfig.js';
import { PLANS_CATALOG } from '../../config/plans.config.js';
import { SubscriptionService as RealSubscriptionService } from '../subscriptions/subscription.service.js';
import { getBillingDate } from '../../utils/billing-date.js';

describe('Phase 3B.3A — Scheduled Renewal Settlement & Target Activation', () => {
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

  const baseScheduledTransition: BillingTransitionV1Record = {
    id: 'tr_scheduled_001',
    transition_id: 'tr_scheduled_001',
    policy_version: 'billing_transition_v1',
    ministry_id: 'min_test_1',
    provider: 'asaas',
    currency: 'BRL',
    execution_strategy: 'scheduled_paid_transition',
    transition_status: 'scheduled',
    early_activation_status: 'not_applicable',
    financial_safety_status: 'live',
    transition_type: 'upgrade',
    status: 'pending',
    provider_customer_id: 'cus_test_1',
    source_plan_id: 'lite',
    source_interval: 'monthly',
    source_addon_blocks: 0,
    source_current_cycle_total_cents: 1490,
    source_entitlement_snapshot: { plan_id: 'lite', addon_blocks: 0 },
    current_period_start: '2026-09-02T00:00:00.000Z',
    current_period_end: '2026-10-02T00:00:00.000Z',
    current_period_start_billing_date: '2026-09-02',
    current_period_end_billing_date: '2026-10-02',
    effective_billing_date: '2026-10-02',
    target_plan_id: 'essential',
    target_interval: 'monthly',
    target_addon_blocks: 0,
    target_future_recurring_price_cents: 3490,
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

    mockBillingRepo = {
      getCustomer: vi.fn().mockImplementation(async (ministryId: string) => {
        return customersStore.get(`${ministryId}_asaas`) || null;
      }),
      setCustomer: vi.fn().mockImplementation(async (c: any) => {
        customersStore.set(c.id, c);
      }),
      getSubscription: vi.fn().mockImplementation(async (ministryId: string, provider: string = 'asaas') => {
        return subscriptionsStore.get(`${ministryId}_${provider}`) || subscriptionsStore.get(ministryId) || null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        const canonicalKey = `${sub.ministry_id}_${sub.provider}`;
        const record = { ...sub, id: canonicalKey };
        subscriptionsStore.set(canonicalKey, record);
        subscriptionsStore.set(sub.ministry_id, record);
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
      getActiveTransitionSlot: vi.fn().mockImplementation(async (ministryId: string, provider: string) => {
        return activeSlotsStore.get(`slot_${ministryId}_${provider}`) || null;
      }),
      updateTransition: vi.fn().mockImplementation(async (id: string, ministryId: string, updates: any) => {
        const existing = planChangesStore.get(id);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
        return updated;
      }),
      confirmScheduledPaidRenewalActivation: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada');
        const updated: BillingTransitionV1Record = {
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
        };
        planChangesStore.set(tr.id, updated);
        return updated;
      }),
      recordRenewalFinancialSettlement: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada');
        const updated = {
          ...tr,
          successful_renewal_provider_payment_id: params.providerPaymentId,
          renewal_paid_billing_date: params.paidBillingDate,
          renewal_payment_settled_at: params.settledAt,
          updated_at: new Date().toISOString(),
        };
        planChangesStore.set(tr.id, updated);
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
        const tr = planChangesStore.get(id);
        if (tr) {
          delete (tr as any).retry_locked_by;
          delete (tr as any).retry_locked_until;
        }
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
      getV1TransitionsNeedingReconciliation: vi.fn().mockImplementation(async (provider: string, limit: number) => {
        const list: BillingPlanChangeRecord[] = [];
        for (const item of planChangesStore.values()) {
          if (item.provider === provider) {
            if (
              (item as any).financial_attention_required === true ||
              (item as any).transition_status === 'scheduled' ||
              (item as any).transition_status === 'future_target_prepared'
            ) {
              list.push(item);
            }
          }
        }
        return list.slice(0, limit);
      }),
      getPendingOrFailedPlanChanges: vi.fn().mockResolvedValue([]),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      saveTransaction: vi.fn().mockImplementation(async (tx: any) => {
        const existing = transactionsStore.get(tx.id);
        if (existing) {
          if (existing.paid_billing_date && tx.paid_billing_date && existing.paid_billing_date !== tx.paid_billing_date) {
            throw new AppError(409, 'Conflito de data financeira', { code: 'CONFLICTING_FINANCIAL_DATE' });
          }
          if (existing.amount_cents !== undefined && tx.amount_cents !== undefined && existing.amount_cents !== tx.amount_cents) {
            throw new AppError(409, 'Conflito de valor financeiro', { code: 'CONFLICTING_FINANCIAL_AMOUNT' });
          }
          transactionsStore.set(tx.id, { ...existing, ...tx });
        } else {
          transactionsStore.set(tx.id, tx);
        }
      }),
      getTransaction: vi.fn().mockImplementation(async (providerOrId: string, paymentId?: string) => {
        const key = paymentId ? `${providerOrId}_${paymentId}` : providerOrId;
        return transactionsStore.get(key) || null;
      }),
      getTransactions: vi.fn().mockImplementation(async (ministryId: string) => {
        return Array.from(transactionsStore.values()).filter((t) => t.ministry_id === ministryId);
      }),
    };

    mockSubscriptionService = {
      changePlan: vi.fn().mockResolvedValue(undefined),
      changeMemberAddonBlocks: vi.fn().mockResolvedValue(undefined),
      applyLockedEntitlementSnapshot: vi.fn().mockImplementation(async (ministryId: string, snapshot: any) => {
        const sub = appSubscriptionsStore.get(ministryId);
        if (sub) {
          sub.plan_id = snapshot.plan_id;
          sub.member_addon_blocks = snapshot.addon_blocks;
          sub.locked_member_quota = snapshot.effective_member_quota;
          sub.locked_song_quota = snapshot.effective_song_quota;
          sub.entitlement_snapshot = snapshot;
        }
        return sub;
      }),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return appSubscriptionsStore.get(ministryId) || null;
      }),
      setSubscription: vi.fn().mockImplementation(async (record: any) => {
        appSubscriptionsStore.set(record.ministry_id, record);
      }),
      ensureSubscriptionAndUsage: vi.fn().mockImplementation(async (ministryId: string) => {
        let sub = appSubscriptionsStore.get(ministryId);
        if (!sub) {
          sub = { id: ministryId, ministry_id: ministryId, plan_id: 'lite', member_addon_blocks: 0, billing_status: 'active' };
          appSubscriptionsStore.set(ministryId, sub);
        }
        return {
          subscription: sub,
          usage: { members_count: 5, songs_count: 10 },
        };
      }),
      getUsage: vi.fn().mockResolvedValue({ members_count: 5, songs_count: 10 }),
    };

    mockMinistryRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'min_test_1', name: 'Ministry Test' }),
    };

    mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'leader@test.com' }),
    };

    mockProvider = {
      name: 'asaas',
      getSubscription: vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_source_old' || (subId && (subId.includes('source') || subId.includes('old')))) {
          return {
            id: subId,
            status: 'INACTIVE',
            value: 14.9,
            valueCents: 1490,
            cycle: 'MONTHLY',
            customer: 'cus_test_1',
          };
        }
        return {
          id: subId || 'sub_target_new',
          status: 'ACTIVE',
          value: 34.9,
          valueCents: 3490,
          cycle: 'MONTHLY',
          nextDueDate: '2026-11-02',
          customer: 'cus_test_1',
        };
      }),
      getPayment: vi.fn().mockResolvedValue({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
        paymentDate: '2026-10-02T12:00:00Z',
        clientPaymentDate: '2026-10-02',
      }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
    };

    // Pre-populate canonical state
    planChangesStore.set(baseScheduledTransition.id, { ...baseScheduledTransition });
    activeSlotsStore.set(`slot_min_test_1_asaas`, {
      id: 'slot_min_test_1_asaas',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      plan_change_id: baseScheduledTransition.id,
      acquired_at: '2026-09-02T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
      version: 1,
    });
    customersStore.set('min_test_1_asaas', {
      id: 'min_test_1_asaas',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      provider_customer_id: 'cus_test_1',
      created_at: '2026-09-02T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
    });
    appSubscriptionsStore.set('min_test_1', {
      id: 'min_test_1',
      ministry_id: 'min_test_1',
      plan_id: 'lite',
      member_addon_blocks: 0,
      billing_status: 'active',
      billing_interval: 'monthly',
      subscription_mode: 'paid',
      current_period_start: '2026-09-02T00:00:00.000Z',
      current_period_end: '2026-10-02T00:00:00.000Z',
      cancel_at_period_end: false,
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      grace_period_expires_at: null,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    });
    subscriptionsStore.set('min_test_1', {
      id: 'asaas_min_test_1',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      plan_id: 'lite',
      interval: 'monthly',
      member_addon_blocks: 0,
      amount_cents: 1490,
      status: 'active',
      started_at: '2026-08-01T00:00:00.000Z',
      provider_subscription_id: 'sub_source_old',
      provider_customer_id: 'cus_test_1',
      current_period_start_billing_date: '2026-09-02',
      current_period_end_billing_date: '2026-10-02',
      effective_billing_date: '2026-09-02',
      current_period_start: '2026-09-02T00:00:00.000Z',
      current_period_end: '2026-10-02T00:00:00.000Z',
      cancel_at_period_end: false,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    });

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

  // ==========================================================================
  // Test Matrix Section 30
  // ==========================================================================

  describe('1. Monthly target PAYMENT_CONFIRMED on exact boundary -> activation complete', () => {
    it('liquida cobrança no vencimento comercial exato, ativa target, avança período em 1 mês e libera slot', async () => {
      const boundaryDate = new Date('2026-10-02T12:00:00.000Z');

      const result = await billingService.processScheduledPaidRenewalSettlement(
        {
          providerEventId: 'evt_conf_1',
          eventType: 'payment_confirmed',
          rawEventType: 'PAYMENT_CONFIRMED',
          providerPaymentId: 'pay_target_001',
          providerSubscriptionId: 'sub_target_new',
          providerCustomerId: 'cus_test_1',
          amountCents: 3490,
          dueDate: '2026-10-02',
        },
        planChangesStore.get('tr_scheduled_001')!,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.status).toBe('ok');
      expect(result.processed).toBe(true);
      expect(result.reason).toBe('renewal_activated');

      // 1. Canonical BillingTransaction criada
      const tx = transactionsStore.get('asaas_pay_target_001');
      expect(tx).toBeDefined();
      expect(tx?.status).toBe('paid');
      expect(tx?.amount_cents).toBe(3490);
      expect(tx?.paid_billing_date).toBe('2026-10-02');
      expect(tx?.provider_subscription_id).toBe('sub_target_new');

      // 2. Entitlement promovido no SubscriptionService via snapshot imutável
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
        'min_test_1',
        expect.objectContaining({ plan_id: 'essential' })
      );

      // 3. Ministry subscription atualizado com novo período civil mensal (+1 mês)
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');
      expect(appSub.current_period_start).toBe('2026-10-02T00:00:00.000Z');
      expect(appSub.current_period_end).toBe('2026-11-02T00:00:00.000Z');

      // 4. BillingSubscription aponta para target
      const billingSub = subscriptionsStore.get('min_test_1')!;
      expect(billingSub.provider_subscription_id).toBe('sub_target_new');
      expect(billingSub.plan_id).toBe('essential');
      expect(billingSub.current_period_start_billing_date).toBe('2026-10-02');
      expect(billingSub.current_period_end_billing_date).toBe('2026-11-02');

      // 5. Transição completada em safe_terminal
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.transition_status).toBe('completed');
      expect(tr.financial_safety_status).toBe('safe_terminal');
      expect(tr.successful_renewal_provider_payment_id).toBe('pay_target_001');

      // 6. Slot ativo liberado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });
  });

  describe('2. Annual target PAYMENT_CONFIRMED on exact boundary -> commercial period +1 year', () => {
    it('avança período em exatamente 1 ano civil para plano anual', async () => {
      const annualTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_annual_001',
        target_interval: 'annual',
        requested_interval: 'annual',
        target_future_recurring_price_cents: 37692,
        expected_amount_cents: 37692,
      };
      planChangesStore.set(annualTr.id, annualTr);

      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        valueCents: 37692,
        cycle: 'YEARLY',
        nextDueDate: '2027-10-02',
        customer: 'cus_test_1',
      });
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 37692,
        billingType: 'CREDIT_CARD',
        paymentDate: '2026-10-02T14:00:00Z',
      });

      const boundaryDate = new Date('2026-10-02T14:00:00.000Z');

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        annualTr,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('renewal_activated');

      // Período de 1 ano civil: 2026-10-02 -> 2027-10-02
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.current_period_start).toBe('2026-10-02T00:00:00.000Z');
      expect(appSub.current_period_end).toBe('2027-10-02T00:00:00.000Z');

      const billingSub = subscriptionsStore.get('min_test_1')!;
      expect(billingSub.current_period_start_billing_date).toBe('2026-10-02');
      expect(billingSub.current_period_end_billing_date).toBe('2027-10-02');
    });
  });

  describe('3. PAYMENT_RECEIVED equivalent -> one transaction, one activation', () => {
    it('trata PAYMENT_RECEIVED com a mesma autoridade de liquidação financeira que CONFIRMED', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'RECEIVED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const boundaryDate = new Date('2026-10-02T15:00:00.000Z');

      const result = await billingService.processScheduledPaidRenewalSettlement(
        {
          providerEventId: 'evt_rec_1',
          eventType: 'payment_received',
          rawEventType: 'PAYMENT_RECEIVED',
          providerPaymentId: 'pay_target_001',
        },
        planChangesStore.get('tr_scheduled_001')!,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(true);
      expect(transactionsStore.size).toBe(1);
      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('completed');
    });
  });

  describe('4. Early settlement before boundary -> transaction yes, entitlement no, slot HELD', () => {
    it('persiste fato financeiro mas NÃO promove entitlement se currentCommercialDate < effective_billing_date', async () => {
      const earlyDate = new Date('2026-10-01T18:00:00.000Z');

      const result = await billingService.processScheduledPaidRenewalSettlement(
        {
          providerEventId: 'evt_early_1',
          eventType: 'payment_confirmed',
          rawEventType: 'PAYMENT_CONFIRMED',
          providerPaymentId: 'pay_target_001',
        },
        planChangesStore.get('tr_scheduled_001')!,
        earlyDate,
        { nowCommercialDate: '2026-10-01' }
      );

      expect(result.status).toBe('ok');
      expect(result.processed).toBe(true);
      expect(result.reason).toBe('early_settlement_recorded_awaiting_boundary');

      // 1. BillingTransaction financeira criada
      expect(transactionsStore.has('asaas_pay_target_001')).toBe(true);

      // 2. Prova de liquidação gravada na transição
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.successful_renewal_provider_payment_id).toBe('pay_target_001');
      expect(tr.renewal_paid_billing_date).toBe('2026-10-02');
      expect(tr.transition_status).toBe('scheduled'); // Permanece scheduled!

      // 3. Entitlement LouvAIO NÃO promovido
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('lite'); // Continua Lite!
      expect(appSub.current_period_start).toBe('2026-09-02T00:00:00.000Z');

      // 4. Slot ativo permanece HELD
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  describe('5. Reconciler on boundary activates settlement previously received', () => {
    it('reconciliador na fronteira ativa transição que já teve liquidação gravada antecipadamente', async () => {
      // 1. Simular estado pós-early settlement
      const trWithEarlySettlement: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        successful_renewal_provider_payment_id: 'pay_target_001',
        renewal_paid_billing_date: '2026-10-01',
        renewal_payment_settled_at: '2026-10-01T20:00:00.000Z',
      };
      planChangesStore.set(trWithEarlySettlement.id, trWithEarlySettlement);

      // 2. Reconciliador roda no dia 2026-10-02 (fronteira atingida)
      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        trWithEarlySettlement.id,
        'reconciler_worker',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(recResult.reason).toBe('renewal_activated');

      // Entitlement promovido
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
        'min_test_1',
        expect.objectContaining({ plan_id: 'essential' })
      );
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');

      // Transição completada e slot liberado
      const reloadedTr = planChangesStore.get(trWithEarlySettlement.id)!;
      expect(reloadedTr.transition_status).toBe('completed');
      expect(reloadedTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });
  });

  describe('6. Duplicate CONFIRMED -> idempotent', () => {
    it('ignora webhook duplicado sem regredir completed nem reabrir slot', async () => {
      // 1. Primeira confirmação na fronteira
      await billingService.processScheduledPaidRenewalSettlement(
        { providerEventId: 'evt_1', eventType: 'payment_confirmed', rawEventType: 'PAYMENT_CONFIRMED' } as any,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('completed');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);

      // 2. Segunda entrega duplicada
      const dupResult = await billingService.processScheduledPaidRenewalSettlement(
        { providerEventId: 'evt_1', eventType: 'payment_confirmed', rawEventType: 'PAYMENT_CONFIRMED' } as any,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:05:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(dupResult.status).toBe('ok');
      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('completed');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });
  });

  describe('7. CONFIRMED then RECEIVED -> idempotent single transaction', () => {
    it('atualiza transação existente sem duplicar ou disparar segunda promoção de cotas', async () => {
      const boundaryDate = new Date('2026-10-02T12:00:00Z');

      // 1. CONFIRMED
      await billingService.processScheduledPaidRenewalSettlement(
        { providerEventId: 'evt_conf', eventType: 'payment_confirmed', rawEventType: 'PAYMENT_CONFIRMED' } as any,
        planChangesStore.get('tr_scheduled_001')!,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(transactionsStore.size).toBe(1);
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledTimes(1);

      // 2. RECEIVED posterior
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        status: 'RECEIVED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      await billingService.processScheduledPaidRenewalSettlement(
        { providerEventId: 'evt_rec', eventType: 'payment_received', rawEventType: 'PAYMENT_RECEIVED' } as any,
        planChangesStore.get('tr_scheduled_001')!,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(transactionsStore.size).toBe(1);
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe('8. Wrong payment ID -> fail closed', () => {
    it('rejeita webhook com payment ID divergente do target payment fixado na transição', async () => {
      const result = await billingService.processScheduledPaidRenewalSettlement(
        {
          providerEventId: 'evt_wrong',
          eventType: 'payment_confirmed',
          rawEventType: 'PAYMENT_CONFIRMED',
          providerPaymentId: 'pay_intruder_999',
        } as any,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('WRONG_PAYMENT_ID');
      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  describe('9. Second-cycle target payment -> não conclui primeira transição', () => {
    it('ignora cobrança com dueDate de ciclo posterior sem concluir a transição da boundary', async () => {
      const webhookEvent: any = {
        providerPaymentId: 'pay_target_cycle_2',
        providerSubscriptionId: 'sub_target_new',
        dueDate: '2026-11-02',
        eventType: 'payment_confirmed',
      };

      const result = await billingService.processScheduledPaidRenewalSettlement(
        webhookEvent,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('SECOND_CYCLE_PAYMENT');
      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('scheduled');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });
  });

  describe('10. Target provider mismatch (amount/dueDate/customer) -> financial attention', () => {
    it('aciona financial_attention_required se amountCents do payment divergir do locked target', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 9999, // Divergente de 3490
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_PAYMENT_AMOUNT_MISMATCH');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('TARGET_PAYMENT_AMOUNT_MISMATCH');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true); // Slot continua HELD!
    });

    it('aciona financial_attention_required se customerId divergir', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_intruder',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_PAYMENT_CUSTOMER_MISMATCH');
      expect(planChangesStore.get('tr_scheduled_001')!.financial_attention_required).toBe(true);
    });

    it('aciona financial_attention_required se status da subscription alvo não for ACTIVE', async () => {
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'INACTIVE',
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_SUBSCRIPTION_NOT_ACTIVE');
      expect(planChangesStore.get('tr_scheduled_001')!.financial_attention_required).toBe(true);
    });
  });

  describe('11. Crash recovery tests', () => {
    it('Crash após promoção de cota -> reconciler completa app sub, billing sub, status completed e libera slot', async () => {
      // Simular que SubscriptionService já foi promovido mas crashou antes de atualizar app subscription e transição
      const todayDate = getBillingDate(new Date(), config.billingTimezone);
      const boundaryTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        current_period_start_billing_date: '2026-08-02',
        current_period_end_billing_date: todayDate,
        effective_billing_date: todayDate,
      };
      planChangesStore.set(boundaryTr.id, boundaryTr);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: todayDate,
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
        paymentDate: `${todayDate}T12:00:00Z`,
        clientPaymentDate: todayDate,
      });

      let callCount = 0;
      mockSubscriptionService.applyLockedEntitlementSnapshot.mockImplementation(async (ministryId: string, snapshot: any) => {
        callCount++;
        const sub = appSubscriptionsStore.get(ministryId);
        if (sub) {
          sub.plan_id = snapshot.plan_id;
          sub.member_addon_blocks = snapshot.addon_blocks;
        }
        return sub;
      });

      // Executa reconciliação
      const recResult = await reconcilerWorker.runCycle();

      expect(recResult.succeeded).toBe(1);
      expect(callCount).toBe(1);

      // Estado local completamente convergido
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.transition_status).toBe('completed');
      expect(tr.financial_safety_status).toBe('safe_terminal');

      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');

      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('Crash após transição completed mas antes de liberar slot -> reconciler libera o slot com segurança', async () => {
      // Simular que a transição já alcançou completed e safe_terminal, mas o slot ficou preso
      const completedTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
        status: 'completed',
      };
      planChangesStore.set(completedTr.id, completedTr);

      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        completedTr.id,
        'crash_worker'
      );

      expect(recResult.success).toBe(true);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false); // Slot liberado!
    });
  });

  describe('12. Boundary reached but payment PENDING/unpaid -> remains scheduled, source entitlement, slot HELD', () => {
    it('se a data da fronteira comercial chegou mas o pagamento continua PENDING, não ativa e não implementa grace na 3B.3A', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'PENDING', // Cobrança ainda pendente!
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const boundaryDate = new Date('2026-10-02T10:00:00Z');

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        boundaryDate,
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('grace_entered_unpaid');

      // Mantém plano de origem Lite
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('lite');

      // Transição permanece scheduled
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.grace_status).toBe('in_grace');
      expect(tr.grace_start_billing_date).toBe('2026-10-02');
      expect(tr.grace_end_billing_date).toBe('2026-10-09');

      // Slot permanece HELD
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  describe('13. Catalog Drift & Addon Drift Immunity (Section 1, 2, 3, 5, 6)', () => {
    it('1. catalog drift does not alter target entitlement (bought snapshot is immutable)', async () => {
      // 1. Cria transição travando snapshot de Essential (40 membros, 200 músicas)
      const driftTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_drift_001',
        target_plan_id: 'essential',
        target_addon_blocks: 0,
        target_entitlement_snapshot: {
          plan_id: 'essential',
          addon_blocks: 0,
          interval: 'monthly',
          effective_member_quota: 40,
          effective_song_quota: 200,
        },
      };
      planChangesStore.set(driftTr.id, driftTr);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        billingType: 'CREDIT_CARD',
        paymentDate: '2026-10-02T12:00:00Z',
      });

      // 2. SIMULAÇÃO DO DRIFT: Catálogo altera Essential para 15 membros e 50 músicas
      const originalMembers = PLANS_CATALOG.essential.baseMembers;
      const originalSongs = PLANS_CATALOG.essential.baseSongs;
      try {
        (PLANS_CATALOG.essential as any).baseMembers = 15;
        (PLANS_CATALOG.essential as any).baseSongs = 50;

        // 3. Executa ativação na renewal boundary
        const result = await billingService.processScheduledPaidRenewalSettlement(
          null,
          driftTr,
          new Date('2026-10-02T12:00:00Z'),
          { nowCommercialDate: '2026-10-02' }
        );

        expect(result.processed).toBe(true);
        expect(result.reason).toBe('renewal_activated');

        // 4. Prova que o snapshot imutável foi aplicado e não o catálogo alterado
        expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
          'min_test_1',
          expect.objectContaining({
            plan_id: 'essential',
            effective_member_quota: 40,
            effective_song_quota: 200,
          })
        );

        // 5. Prova com o runtime real do SubscriptionService
        const realSubService = new RealSubscriptionService(mockSubscriptionRepo as any);
        const appliedSub = await realSubService.applyLockedEntitlementSnapshot('min_test_1', driftTr.target_entitlement_snapshot!);
        expect(appliedSub.locked_member_quota).toBe(40);
        expect(appliedSub.locked_song_quota).toBe(200);

        const summary = await realSubService.getSubscriptionSummary('min_test_1');
        expect(summary.quotas.members).toBe(40); // 40 e NÃO 15!
        expect(summary.quotas.songs).toBe(200); // 200 e NÃO 50!
      } finally {
        (PLANS_CATALOG.essential as any).baseMembers = originalMembers;
        (PLANS_CATALOG.essential as any).baseSongs = originalSongs;
      }
    });

    it('2. addon/quota drift does not alter locked entitlement (addon rule change immunity)', async () => {
      // 1. Transição com Essential + 2 addon blocks = 60 membros travados
      const addonDriftTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_addon_drift_001',
        target_plan_id: 'essential',
        target_addon_blocks: 2,
        target_future_recurring_price_cents: 5490,
        target_entitlement_snapshot: {
          plan_id: 'essential',
          addon_blocks: 2,
          interval: 'monthly',
          effective_member_quota: 60,
          effective_song_quota: 200,
        },
      };
      planChangesStore.set(addonDriftTr.id, addonDriftTr);

      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 5490,
      });

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 5490,
        billingType: 'CREDIT_CARD',
        paymentDate: '2026-10-02T12:00:00Z',
      });

      // 2. SIMULAÇÃO DO DRIFT: Catálogo altera allowMemberAddons para false
      const originalAllow = PLANS_CATALOG.essential.allowMemberAddons;
      try {
        (PLANS_CATALOG.essential as any).allowMemberAddons = false;

        const result = await billingService.processScheduledPaidRenewalSettlement(
          null,
          addonDriftTr,
          new Date('2026-10-02T12:00:00Z'),
          { nowCommercialDate: '2026-10-02' }
        );

        expect(result.processed).toBe(true);
        expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
          'min_test_1',
          expect.objectContaining({
            plan_id: 'essential',
            addon_blocks: 2,
            effective_member_quota: 60,
          })
        );

        const realSubService = new RealSubscriptionService(mockSubscriptionRepo as any);
        await realSubService.applyLockedEntitlementSnapshot('min_test_1', addonDriftTr.target_entitlement_snapshot!);
        const summary = await realSubService.getSubscriptionSummary('min_test_1');
        expect(summary.quotas.members).toBe(60); // 60 travados imutáveis!
      } finally {
        (PLANS_CATALOG.essential as any).allowMemberAddons = originalAllow;
      }
    });
  });

  describe('14. Exact First Payment DueDate & Mismatch Safeguards (Section 7, 8)', () => {
    it('3. exact first payment dueDate mismatch -> attention (TARGET_FIRST_PAYMENT_BOUNDARY_MISMATCH)', async () => {
      // O mesmo ID de pagamento esperado (pay_target_001) teve sua dueDate alterada no provedor
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-05', // Diverge de effective_billing_date (2026-10-02)
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_FIRST_PAYMENT_BOUNDARY_MISMATCH');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('TARGET_FIRST_PAYMENT_BOUNDARY_MISMATCH');

      // Slot permanece HELD e zero promoções
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('15. Full Crash Matrix & Invariant Proving Slot is HELD in Partial States (Section 9, 10)', () => {
    it('5. Crash A: financial settlement evidence persisted -> crash before BillingTransaction / activation', async () => {
      // Prova que em estado de liquidação pré-boundary, o slot permanece HELD
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        clientPaymentDate: '2026-10-01',
      });

      // Executa liquidação antecipada (Crash A antes da boundary)
      const earlyResult = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-01T12:00:00Z'),
        { nowCommercialDate: '2026-10-01' }
      );
      expect(earlyResult.reason).toBe('early_settlement_recorded_awaiting_boundary');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true); // Slot HELD!

      // Na boundary, reconciler recupera e finaliza
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
        clientPaymentDate: '2026-10-01',
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_001',
        'worker_crash_a',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false); // Liberado somente após conclusão!
    });

    it('6. Crash B: BillingTransaction persisted -> crash before entitlement promotion', async () => {
      // Grava BillingTransaction previamente
      transactionsStore.set('asaas_pay_target_001', {
        id: 'asaas_pay_target_001',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_target_001',
        provider_subscription_id: 'sub_target_new',
        amount_cents: 3490,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-10-02',
        paid_at: '2026-10-02T10:00:00Z',
        paid_billing_date: '2026-10-02',
        created_at: '2026-10-02T10:00:00Z',
        updated_at: '2026-10-02T10:00:00Z',
      });

      // Em estado parcial B, slot está retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(true);
      expect(transactionsStore.size).toBe(1); // Não duplicou
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('7. Crash C: entitlement promotion executada -> crash antes de ministry subscription persistence', async () => {
      // Estado parcial C: slot retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_001',
        'worker_crash_c',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('8. Crash D: ministry/app subscription target persistida -> crash antes de BillingSubscription switch', async () => {
      // App subscription já foi atualizada para essential
      appSubscriptionsStore.set('min_test_1', {
        ...appSubscriptionsStore.get('min_test_1'),
        plan_id: 'essential',
      });

      // Em estado parcial D: slot retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_001',
        'worker_crash_d',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(subscriptionsStore.get('min_test_1')!.provider_subscription_id).toBe('sub_target_new');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('9. Crash E: BillingSubscription target persistida -> crash antes de transition completed', async () => {
      // Billing subscription já foi alterada para target
      subscriptionsStore.set('min_test_1', {
        ...subscriptionsStore.get('min_test_1')!,
        provider_subscription_id: 'sub_target_new',
        plan_id: 'essential',
      });

      // Em estado parcial E: slot retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const recResult = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_001',
        'worker_crash_e',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(recResult.success).toBe(true);
      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('completed');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });
  });

  describe('16. Local Completion Gate & Financial Conflict Safeguards (Section 11, 12)', () => {
    it('11. local completion gate detects partial state and keeps slot HELD', async () => {
      // Simular que setSubscription de BillingSubscription falhou/foi corrompido
      mockBillingRepo.setSubscription.mockImplementationOnce(async () => {
        // No-op simulando falha de persistência
      });

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('ACTIVATION_COMPLETION_GATE_FAILED');

      // Transição NÃO completada e slot permanece HELD
      expect(planChangesStore.get('tr_scheduled_001')!.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('12. BillingTransaction financial conflict -> attention', async () => {
      // Pre-existente com valor conflitante
      transactionsStore.set('asaas_pay_target_001', {
        id: 'asaas_pay_target_001',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_target_001',
        provider_subscription_id: 'sub_target_new',
        amount_cents: 1490, // CONFLITO: existente é 1490
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-10-02',
        paid_at: '2026-10-02T10:00:00Z',
        paid_billing_date: '2026-10-02',
        created_at: '2026-10-02T10:00:00Z',
        updated_at: '2026-10-02T10:00:00Z',
      });

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490, // Conflita com 1490!
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('FINANCIAL_TRANSACTION_CONFLICT');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('FINANCIAL_TRANSACTION_CONFLICT');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  describe('17. Pre-Boundary Refund, Chargeback & Target Contract Validation (Section 13, 14)', () => {
    it('13. early settlement then REFUNDED before boundary -> no activation, slot HELD', async () => {
      // Simula que houve settlement antecipado pré-boundary
      planChangesStore.get('tr_scheduled_001')!.successful_renewal_provider_payment_id = 'pay_target_001';

      // Mas na boundary, a leitura fresh revela status REFUNDED
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'REFUNDED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_PAYMENT_STATUS_REFUNDED');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('TARGET_PAYMENT_STATUS_REFUNDED');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true); // Slot HELD
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    });

    it('14. early settlement then CHARGEBACK -> no activation, slot HELD', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CHARGEBACK',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_PAYMENT_STATUS_CHARGEBACK');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('TARGET_PAYMENT_STATUS_CHARGEBACK');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    });

    it('15. target cycle mismatch -> attention (TARGET_SUBSCRIPTION_CYCLE_MISMATCH)', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'YEARLY', // Conflito: transição é monthly!
        valueCents: 3490,
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_SUBSCRIPTION_CYCLE_MISMATCH');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('TARGET_SUBSCRIPTION_CYCLE_MISMATCH');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('16. target recurring value mismatch -> attention (TARGET_SUBSCRIPTION_VALUE_MISMATCH)', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 9999, // Conflito: valor recorrente diverge de 3490!
      });

      const result = await billingService.processScheduledPaidRenewalSettlement(
        null,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('TARGET_SUBSCRIPTION_VALUE_MISMATCH');

      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('TARGET_SUBSCRIPTION_VALUE_MISMATCH');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  describe('17. V1 Reconciliation Claim & Locking Semantics (Phase 3B.3 Bugfix)', () => {
    beforeEach(() => {
      // Configurar transição scheduled padrão herdando todos os snapshots canônicos
      const trScheduled: any = {
        ...baseScheduledTransition,
        id: 'tr_scheduled_claim_test',
        transition_id: 'tr_scheduled_claim_test',
        supersede_status: 'completed', // Subfluxo concluído na Phase 3B.2!
        financial_safety_status: 'live',
        transition_status: 'scheduled',
        financial_attention_required: false,
        financial_attention_reason: null,
      };
      planChangesStore.set(trScheduled.id, trScheduled);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: trScheduled.id,
        acquired_at: '2026-09-02T12:00:00.000Z',
        updated_at: '2026-09-02T12:00:00.000Z',
        version: 1,
      } as any);
    });

    it('A) scheduled + supersede_status=completed + financial_safety_status=live -> renewal reconciliation claim SUCCEEDS', async () => {
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_claim_test',
        'worker_claim_test',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('renewal_activated');
      const tr = planChangesStore.get('tr_scheduled_claim_test')!;
      expect(tr.transition_status).toBe('completed');
      expect(tr.financial_safety_status).toBe('safe_terminal');
    });

    it('B) completed + safe_terminal -> claim/reconciliation does not rerun business flow (already_completed)', async () => {
      const tr = planChangesStore.get('tr_scheduled_claim_test')!;
      tr.transition_status = 'completed';
      tr.financial_safety_status = 'safe_terminal';

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_claim_test',
        'worker_claim_test'
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('already_completed');
      expect(mockProvider.getPayment).not.toHaveBeenCalled();
    });

    it('C) HARD BLOCK: financial_attention_required=true -> automatic renewal processing BLOCKED (financial_attention_required, slot HELD)', async () => {
      const tr = planChangesStore.get('tr_scheduled_claim_test')!;
      tr.financial_attention_required = true;
      tr.financial_attention_reason = 'PAYMENT_AMOUNT_MISMATCH';

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_claim_test',
        'worker_claim_test'
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
      expect(mockProvider.getPayment).not.toHaveBeenCalled();
    });

    it('D) active valid lease owned by another worker -> second worker gets lock_busy', async () => {
      const tr = planChangesStore.get('tr_scheduled_claim_test') as any;
      tr.retry_locked_by = 'worker_alpha';
      tr.retry_locked_until = new Date(Date.now() + 45000).toISOString();

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_claim_test',
        'worker_beta'
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('lock_busy');
    });

    it('E) expired lease -> another worker can recover and take over lease', async () => {
      const tr = planChangesStore.get('tr_scheduled_claim_test') as any;
      tr.retry_locked_by = 'worker_dead';
      tr.retry_locked_until = new Date(Date.now() - 5000).toISOString(); // Expirado

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_claim_test',
        'worker_recovery',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('renewal_activated');
    });

    it('F) same worker / retry semantics remain idempotent and can re-acquire lease', async () => {
      const tr = planChangesStore.get('tr_scheduled_claim_test') as any;
      tr.retry_locked_by = 'worker_same';
      tr.retry_locked_until = new Date(Date.now() + 30000).toISOString();

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_new',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_scheduled_claim_test',
        'worker_same',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('renewal_activated');
    });

    it('G) End-to-End Regression: future_target_prepared -> source cutover -> supersede_status completed -> scheduled -> renewal reconciler acquires V1 lock -> processes settled first target payment', async () => {
      // 1. Simular transição que acabou de passar pelo Cutover (Phase 3B.2)
      const trPostCutover: any = {
        ...baseScheduledTransition,
        id: 'tr_e2e_regression_001',
        transition_id: 'tr_e2e_regression_001',
        supersede_status: 'completed', // Subfluxo concluído com sucesso
        payment_cleanup_status: 'completed',
        financial_attention_required: false,
        future_provider_subscription_id: 'sub_target_8f7b',
        future_provider_payment_id: 'pay_cygipl0svq',
      };
      planChangesStore.set(trPostCutover.id, trPostCutover);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: trPostCutover.id,
        acquired_at: '2026-09-02T12:00:00.000Z',
        updated_at: '2026-09-02T12:00:00.000Z',
        version: 1,
      } as any);

      // 2. Mocks de provider: pagamento CONFIRMED na boundary (como observado no Sandbox)
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_cygipl0svq',
        subscriptionId: 'sub_target_8f7b',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        originalDueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_8f7b',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      // 3. Execução do reconciliador de liquidação (o lock DEVE ser adquirido apesar de supersede_status=completed)
      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_e2e_regression_001',
        'worker_e2e_reconciler',
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('renewal_activated');

      // 4. Verificar mutações canônicas de domínio
      const trFinal = planChangesStore.get('tr_e2e_regression_001')!;
      expect(trFinal.transition_status).toBe('completed');
      expect(trFinal.financial_safety_status).toBe('safe_terminal');

      // Slot liberado por último
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);

      // Entitlements promovidos para Essential
      const appSub = appSubscriptionsStore.get('min_test_1')!;
      expect(appSub.plan_id).toBe('essential');
      expect(appSub.locked_member_quota).toBe(40);
      expect(appSub.locked_song_quota).toBe(200);
      expect(appSub.billing_status).toBe('active');

      // BillingSubscription apontando para sub_target_8f7b
      const billingSub = subscriptionsStore.get('min_test_1')!;
      expect(billingSub.provider_subscription_id).toBe('sub_target_8f7b');
    });
  });

  describe('18. BillingSubscription Canonical Key & Activation Completion Gate Regression (Phase 3B.3 Fix)', () => {
    it('18.A) Reprodução do bug e validação da cura: renewal activation persiste BillingSubscription com chave canônica min_x_asaas, getSubscription imediato encontra o registro, Completion Gate aprova billingSub=true e transição conclui', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_canonical_fix_001',
        transition_id: 'tr_canonical_fix_001',
        supersede_status: 'completed',
        payment_cleanup_status: 'completed',
        financial_attention_required: false,
        future_provider_subscription_id: 'sub_target_canon',
        future_provider_payment_id: 'pay_target_canon',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_canon',
        subscriptionId: 'sub_target_canon',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        originalDueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_canon',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_canonical_fix_001',
        'worker_canon',
        { nowCommercialDate: '2026-10-02' }
      );
      expect(res.success).toBe(true);
      expect(res.reason).toBe('renewal_activated');

      // Verificar que BillingSubscription foi gravada sob a chave canônica min_test_1_asaas
      const canonicalBillingSub = subscriptionsStore.get('min_test_1_asaas');
      expect(canonicalBillingSub).toBeDefined();
      expect(canonicalBillingSub?.id).toBe('min_test_1_asaas');
      expect(canonicalBillingSub?.provider_subscription_id).toBe('sub_target_canon');
      expect(canonicalBillingSub?.status).toBe('active');

      // Verificar que transição foi completed e slot foi liberado por último
      const updatedTr = planChangesStore.get('tr_canonical_fix_001')!;
      expect(updatedTr.transition_status).toBe('completed');
      expect(updatedTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('18.B) Crash Recovery de Estado Parcial (Attempt #3 scenario): runtime app sub já promovido, BillingTransaction paid já gravada, mas BillingSubscription não convergida -> reconciler converge estado, passa Completion Gate e conclui liberando slot', async () => {
      // Cenário de crash exatamente como no Attempt #3:
      // Runtime app sub já está em essential (40/200), billing_status active
      appSubscriptionsStore.set('min_test_1', {
        ministry_id: 'min_test_1',
        plan_id: 'essential',
        billing_interval: 'monthly',
        billing_status: 'active',
        locked_member_quota: 40,
        locked_song_quota: 200,
        current_period_start: '2026-10-02T00:00:00.000Z',
        current_period_end: '2026-11-02T00:00:00.000Z',
      });

      // Transição ainda em scheduled, slot HELD
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_partial_crash_001',
        transition_id: 'tr_partial_crash_001',
        supersede_status: 'completed',
        payment_cleanup_status: 'completed',
        financial_attention_required: false,
        future_provider_subscription_id: 'sub_target_partial',
        future_provider_payment_id: 'pay_target_partial',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      // BillingSubscription ainda aponta para source antiga (inconvergente)
      subscriptionsStore.set('min_test_1_asaas', {
        id: 'min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_id: 'lite',
        status: 'active',
        provider_subscription_id: 'sub_source_old',
      } as any);

      // BillingTransaction paid já gravada
      transactionsStore.set('pay_target_partial', {
        id: 'asaas_pay_target_partial',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_target_partial',
        status: 'paid',
        amount_cents: 3490,
      } as any);

      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_partial',
        subscriptionId: 'sub_target_partial',
        customerId: 'cus_test_1',
        status: 'RECEIVED',
        dueDate: '2026-10-02',
        originalDueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.getSubscription.mockResolvedValueOnce({
        id: 'sub_target_partial',
        status: 'ACTIVE',
        customer: 'cus_test_1',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      // Retentativa do reconciliador
      const res = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_partial_crash_001',
        'worker_partial',
        { nowCommercialDate: '2026-10-02' }
      );
      expect(res.success).toBe(true);
      expect(res.reason).toBe('renewal_activated');

      // Convergência confirmada
      const billingSub = subscriptionsStore.get('min_test_1_asaas');
      expect(billingSub?.provider_subscription_id).toBe('sub_target_partial');
      expect(billingSub?.status).toBe('active');

      const updatedTr = planChangesStore.get('tr_partial_crash_001')!;
      expect(updatedTr.transition_status).toBe('completed');
      expect(updatedTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });
  });

  describe('19. Webhook Cutover Ordering, Settlement Precondition Gate & Fresh Source Safety (Phase 3B.3 Fix)', () => {
    it('12. TEST — EXACT WEBHOOK ORDER FROM SANDBOX: CHECKOUT_PAID -> future_target_prepared -> PAYMENT_CONFIRMED -> cutover executa antes da liquidação -> target ativado somente após scheduled', async () => {
      // Setup transition in future_target_prepared
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_webhook_order_001',
        transition_id: 'tr_webhook_order_001',
        transition_status: 'future_target_prepared',
        supersede_status: 'pending',
        payment_cleanup_status: 'pending',
        future_provider_subscription_id: 'sub_target_order',
        future_provider_payment_id: 'pay_target_order',
        old_provider_subscription_id: 'sub_source_order',
        previous_provider_subscription_id: 'sub_source_order',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      // Iniciar runtime app sub em Lite
      appSubscriptionsStore.set('min_test_1', {
        ministry_id: 'min_test_1',
        plan_id: 'lite',
        billing_interval: 'monthly',
        billing_status: 'active',
        locked_member_quota: 20,
        locked_song_quota: 100,
      });

      // Mocks de cutover e settlement
      let sourceStatus = 'ACTIVE';
      mockProvider.getSubscription = vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_source_order') {
          return { id: subId, status: sourceStatus, cycle: 'MONTHLY' };
        }
        return { id: subId, status: 'ACTIVE', customer: 'cus_test_1', cycle: 'MONTHLY', valueCents: 3490 };
      });
      mockProvider.inactivateSubscription = vi.fn().mockImplementation(async () => {
        sourceStatus = 'INACTIVE';
        return { id: 'sub_source_order', status: 'INACTIVE' };
      });
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_order',
        subscriptionId: 'sub_target_order',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });
      mockProvider.deletePendingSubscriptionPayments = vi.fn().mockResolvedValue({ deleted: 0 });
      mockProvider.listSubscriptionPayments = vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_target_order') {
          return [
            {
              id: 'pay_target_order',
              subscriptionId: 'sub_target_order',
              customerId: 'cus_test_1',
              amountCents: 3490,
              dueDate: '2026-10-02',
              status: 'CONFIRMED',
            },
          ];
        }
        return [];
      });

      // Webhook PAYMENT_CONFIRMED chega enquanto a transição está em future_target_prepared
      const parsedEvent: any = {
        providerEventId: 'evt_sandbox_race_001',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_target_order',
        providerPaymentId: 'pay_target_order',
        customerId: 'cus_test_1',
        amountCents: 3490,
        status: 'CONFIRMED',
      };

      const res = await (billingService as any).handleV1PaidToPaidWebhook(
        parsedEvent,
        tr,
        new Date('2026-10-02T12:00:00Z')
      );
      expect(res.status).toBe('ok');

      // Verificar que o cutover FOI EXECUTADO
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_source_order');

      // Verificar que a transição avançou para completed
      const finalTr = planChangesStore.get('tr_webhook_order_001')!;
      expect(finalTr.supersede_status).toBe('completed');
      expect(finalTr.payment_cleanup_status).toBe('completed');
      expect(finalTr.transition_status).toBe('completed');
      expect(finalTr.financial_safety_status).toBe('safe_terminal');

      // Verificar que o slot foi liberado por último
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);

      // Runtime promovido
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('essential');
      expect(appSub.locked_member_quota).toBe(40);
    });

    it('13. TEST — SETTLEMENT CALLED DIRECTLY TOO EARLY: future_target_prepared com boundary atingida -> rejeita com SOURCE_CUTOVER_NOT_COMPLETED, slot HELD', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_early_direct_001',
        transition_id: 'tr_early_direct_001',
        transition_status: 'future_target_prepared',
        supersede_status: 'pending',
        payment_cleanup_status: 'pending',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      // Chamar o pipeline de settlement diretamente
      const res = await billingService.processScheduledPaidRenewalSettlement(
        null,
        tr,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('SOURCE_CUTOVER_NOT_COMPLETED');

      // Slot permanece HELD
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      // Transição NÃO foi completed
      const afterTr = planChangesStore.get('tr_early_direct_001')!;
      expect(afterTr.transition_status).toBe('future_target_prepared');
    });

    it('14. TEST — AWAITING OLD INACTIVATION: awaiting_old_inactivation com target CONFIRMED -> rejeita com SOURCE_CUTOVER_NOT_COMPLETED, slot HELD', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_awaiting_direct_001',
        transition_id: 'tr_awaiting_direct_001',
        transition_status: 'awaiting_old_inactivation',
        supersede_status: 'pending',
        payment_cleanup_status: 'pending',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const res = await billingService.processScheduledPaidRenewalSettlement(
        null,
        tr,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('SOURCE_CUTOVER_NOT_COMPLETED');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('15. TEST — SOURCE STILL ACTIVE DESPITE BAD LOCAL FLAG: scheduled + supersede completed local, mas provider retorna source ACTIVE -> FAIL CLOSED com SOURCE_SUBSCRIPTION_STILL_ACTIVE, slot HELD', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_source_active_lie_001',
        transition_id: 'tr_source_active_lie_001',
        transition_status: 'scheduled',
        supersede_status: 'completed',
        payment_cleanup_status: 'completed',
        old_provider_subscription_id: 'sub_source_ghost_active',
        previous_provider_subscription_id: 'sub_source_ghost_active',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      // Provider retorna que source ainda está ACTIVE!
      mockProvider.getSubscription = vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_source_ghost_active') {
          return { id: subId, status: 'ACTIVE', cycle: 'MONTHLY' };
        }
        return { id: subId, status: 'ACTIVE', customer: 'cus_test_1', cycle: 'MONTHLY', valueCents: 3490 };
      });

      const res = await billingService.processScheduledPaidRenewalSettlement(
        null,
        tr,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(res.processed).toBe(false);
      expect(res.reason).toBe('SOURCE_SUBSCRIPTION_STILL_ACTIVE');

      const updatedTr = planChangesStore.get('tr_source_active_lie_001')!;
      expect(updatedTr.financial_attention_required).toBe(true);
      expect(updatedTr.financial_attention_reason).toBe('SOURCE_SUBSCRIPTION_STILL_ACTIVE_AT_RENEWAL');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('16. TEST — SOURCE CONFLICTING PAYMENT APPEARS: cutover detecta cobrança >= cutoff na origem -> attention, slot HELD', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_conflicting_payment_001',
        transition_id: 'tr_conflicting_payment_001',
        transition_status: 'future_target_prepared',
        supersede_status: 'pending',
        payment_cleanup_status: 'pending',
        future_provider_subscription_id: 'sub_target_conflict',
        old_provider_subscription_id: 'sub_source_conflict',
        previous_provider_subscription_id: 'sub_source_conflict',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      // Mock cutover detectando cobrança pendente não deletável ou com status conflituoso
      mockProvider.inactivateSubscription = vi.fn().mockResolvedValue({ id: 'sub_source_conflict', status: 'INACTIVE' });
      mockProvider.deletePendingSubscriptionPayments = vi.fn().mockResolvedValue({ deleted: 0 });
      mockProvider.listSubscriptionPayments = vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_target_conflict') {
          return [
            {
              id: 'pay_target_conflict',
              subscriptionId: 'sub_target_conflict',
              customerId: 'cus_test_1',
              amountCents: 3490,
              dueDate: '2026-10-02',
              status: 'CONFIRMED',
            },
          ];
        }
        if (subId === 'sub_source_conflict') {
          return [
            { id: 'pay_conflict_001', status: 'PENDING', dueDate: '2026-10-05', value: 14.9 },
          ];
        }
        return [];
      });

      const res = await billingService.reconcilePaidToPaidSourceCutover('tr_conflicting_payment_001', 'test_worker');
      expect(res.success).toBe(false);
      expect(['SOURCE_ACTIVE_OBLIGATION_DETECTED', 'SOURCE_PAYMENT_SETTLED_DURING_CUTOVER']).toContain(res.reason);

      const updatedTr = planChangesStore.get('tr_conflicting_payment_001')!;
      expect(updatedTr.financial_attention_required).toBe(true);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('17. TEST — HAPPY ORDER: future_target_prepared -> cutover -> source INACTIVE -> supersede completed -> scheduled -> payment CONFIRMED -> target activation -> completed safe_terminal -> slot release', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_happy_order_001',
        transition_id: 'tr_happy_order_001',
        transition_status: 'future_target_prepared',
        supersede_status: 'pending',
        payment_cleanup_status: 'pending',
        future_provider_subscription_id: 'sub_target_happy',
        future_provider_payment_id: 'pay_target_happy',
        old_provider_subscription_id: 'sub_source_happy',
        previous_provider_subscription_id: 'sub_source_happy',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      mockProvider.inactivateSubscription = vi.fn().mockResolvedValue({ id: 'sub_source_happy', status: 'INACTIVE' });
      mockProvider.deletePendingSubscriptionPayments = vi.fn().mockResolvedValue({ deleted: 1 });
      mockProvider.listSubscriptionPayments = vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_target_happy') {
          return [
            {
              id: 'pay_target_happy',
              subscriptionId: 'sub_target_happy',
              customerId: 'cus_test_1',
              amountCents: 3490,
              dueDate: '2026-10-02',
              status: 'CONFIRMED',
            },
          ];
        }
        return [];
      });
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_happy',
        subscriptionId: 'sub_target_happy',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      // Passo 1: Cutover
      const cutoverRes = await billingService.reconcilePaidToPaidSourceCutover('tr_happy_order_001', 'worker_happy');
      expect(cutoverRes.success).toBe(true);

      const intermediateTr = planChangesStore.get('tr_happy_order_001')!;
      expect(intermediateTr.transition_status).toBe('scheduled');
      expect(intermediateTr.supersede_status).toBe('completed');
      expect(intermediateTr.payment_cleanup_status).toBe('completed');

      // Passo 2: Settlement
      const settlementRes = await billingService.reconcilePaidToPaidRenewalSettlement(
        'tr_happy_order_001',
        'worker_happy',
        { nowCommercialDate: '2026-10-02' }
      );
      expect(settlementRes.success).toBe(true);
      expect(settlementRes.reason).toBe('renewal_activated');

      // Passo 3: Terminal + Slot liberado
      const finalTr = planChangesStore.get('tr_happy_order_001')!;
      expect(finalTr.transition_status).toBe('completed');
      expect(finalTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('18. TEST — DUPLICATE / OUT-OF-ORDER EVENTS: múltiplos webhooks duplicados e out-of-order não regridem estado e não duplicam ativações', async () => {
      const tr: any = {
        ...baseScheduledTransition,
        id: 'tr_duplicate_events_001',
        transition_id: 'tr_duplicate_events_001',
        transition_status: 'future_target_prepared',
        supersede_status: 'pending',
        payment_cleanup_status: 'pending',
        future_provider_subscription_id: 'sub_target_dup',
        future_provider_payment_id: 'pay_target_dup',
        old_provider_subscription_id: 'sub_source_dup',
        previous_provider_subscription_id: 'sub_source_dup',
      };
      planChangesStore.set(tr.id, tr);
      activeSlotsStore.set('slot_min_test_1_asaas', {
        id: 'slot_min_test_1_asaas',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: tr.id,
        held_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      mockProvider.inactivateSubscription = vi.fn().mockResolvedValue({ id: 'sub_source_dup', status: 'INACTIVE' });
      mockProvider.deletePendingSubscriptionPayments = vi.fn().mockResolvedValue({ deleted: 0 });
      mockProvider.listSubscriptionPayments = vi.fn().mockImplementation(async (subId: string) => {
        if (subId === 'sub_target_dup') {
          return [
            {
              id: 'pay_target_dup',
              subscriptionId: 'sub_target_dup',
              customerId: 'cus_test_1',
              amountCents: 3490,
              dueDate: '2026-10-02',
              status: 'CONFIRMED',
            },
          ];
        }
        return [];
      });
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_target_dup',
        subscriptionId: 'sub_target_dup',
        customerId: 'cus_test_1',
        status: 'CONFIRMED',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const parsedEvent: any = {
        providerEventId: 'evt_dup_001',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_target_dup',
        providerPaymentId: 'pay_target_dup',
        customerId: 'cus_test_1',
        amountCents: 3490,
        status: 'CONFIRMED',
      };

      // 1. Primeiro webhook
      await (billingService as any).handleV1PaidToPaidWebhook(
        parsedEvent,
        tr,
        new Date('2026-10-02T12:00:00Z')
      );
      const afterFirst = planChangesStore.get('tr_duplicate_events_001')!;
      expect(afterFirst.transition_status).toBe('completed');

      // 2. Webhook duplicado (mesmo evento)
      const resDup = await (billingService as any).handleV1PaidToPaidWebhook(
        parsedEvent,
        afterFirst,
        new Date('2026-10-02T12:00:00Z')
      );
      expect(resDup.reason).toBe('already_completed');

      // 3. Webhook de evento atrasado (ex: checkout_created ou late checkout_paid)
      const resLate = await (billingService as any).handleV1PaidToPaidWebhook(
        { ...parsedEvent, providerEventId: 'evt_late_checkout', eventType: 'checkout_created' },
        afterFirst,
        new Date('2026-10-02T12:00:00Z')
      );
      expect(resLate.reason).toBe('already_completed');

      // O estado permanece completed e safe_terminal
      const finalTr = planChangesStore.get('tr_duplicate_events_001')!;
      expect(finalTr.transition_status).toBe('completed');
      expect(finalTr.financial_safety_status).toBe('safe_terminal');
    });
  });

  // ==========================================================================
  // Suite 20: Webhook Event Lifecycle Semantics (Phase 3B.3 Hardening)
  //
  // Valida que processed:false NÃO implica processing permanente.
  // Categoria A: evento consumido, sem mudança de estado → processed terminal.
  // Categoria B: falha transitória real → processing (retryable).
  // Categoria C: financial_attention persistida → processed terminal.
  // Categoria D: evento de recurso errado → ignored terminal.
  // ==========================================================================
  describe('20. Webhook Event Lifecycle Semantics (Phase 3B.3 Hardening)', () => {
    const preboundaryEvent = {
      providerEventId: 'evt_overdue_preboundary_001',
      eventType: 'payment_overdue' as const,
      rawEventType: 'PAYMENT_OVERDUE',
      providerPaymentId: 'pay_target_001',
      providerSubscriptionId: 'sub_target_new',
      providerCustomerId: 'cus_test_1',
      amountCents: 3490,
      dueDate: '2026-10-02',
    };

    it('Teste A: PAYMENT_OVERDUE pre-boundary → markWebhookEventProcessed("processed") chamado, transição permanece scheduled, slot HELD', async () => {
      // Pre-boundary: currentCommercialDate < effectiveBillingDate
      const preboundaryNow = new Date('2026-09-15T10:00:00Z');

      // Provider retorna pagamento OVERDUE (não liquidado)
      mockProvider.getPayment.mockResolvedValueOnce({
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      });

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        preboundaryEvent,
        planChangesStore.get('tr_scheduled_001')!,
        preboundaryNow,
        { nowCommercialDate: '2026-09-15' }
      );

      // Domínio: não há ação a tomar antes da fronteira
      expect(result.status).toBe('ok');
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('renewal_payment_not_settled');

      // Lifecycle: evento marcado como processado terminalmente
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_overdue_preboundary_001',
        'processed'
      );

      // Transição permanece scheduled
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.transition_status).toBe('scheduled');

      // Slot permanece HELD
      const slot = activeSlotsStore.get('slot_min_test_1_asaas');
      expect(slot).toBeDefined();
      expect(slot?.plan_change_id).toBe('tr_scheduled_001');

      // Nenhuma BillingTransaction criada
      expect(transactionsStore.size).toBe(0);
    });

    it('Teste A2: strategy_mismatch → markWebhookEventProcessed("processed") chamado', async () => {
      const wrongStrategyTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_strategy_mismatch_001',
        execution_strategy: 'immediate_paid_transition' as any,
      };
      planChangesStore.set('tr_strategy_mismatch_001', wrongStrategyTr);

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_strategy_mismatch_001' },
        planChangesStore.get('tr_strategy_mismatch_001')!,
        new Date('2026-09-15T10:00:00Z'),
        { nowCommercialDate: '2026-09-15' }
      );

      expect(result.reason).toBe('strategy_mismatch');
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_strategy_mismatch_001',
        'processed'
      );
    });

    it('Teste A3: SECOND_CYCLE_PAYMENT → markWebhookEventProcessed("processed") chamado', async () => {
      const secondCycleEvent = {
        providerEventId: 'evt_second_cycle_001',
        eventType: 'payment_confirmed' as const,
        rawEventType: 'PAYMENT_CONFIRMED',
        providerPaymentId: 'pay_second_cycle_different',
        providerSubscriptionId: 'sub_target_new', // mesma sub, mas cobrança diferente
        providerCustomerId: 'cus_test_1',
        amountCents: 3490,
        dueDate: '2026-11-02',
      };

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        secondCycleEvent,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('SECOND_CYCLE_PAYMENT');
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_second_cycle_001',
        'processed'
      );
    });

    it('Teste B: PAYMENT_NOT_FOUND → processing NÃO finalizado (retryable)', async () => {
      // Provider retorna null para o pagamento (indisponibilidade transitória)
      mockProvider.getPayment.mockResolvedValueOnce(null);

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_not_found_001' },
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('PAYMENT_NOT_FOUND');
      // Retryable: markWebhookEventProcessed NÃO deve ser chamado para este evento
      const calls = mockBillingRepo.markWebhookEventProcessed.mock.calls;
      const calledForThisEvent = calls.some(
        (args: any[]) => args[1] === 'evt_not_found_001'
      );
      expect(calledForThisEvent).toBe(false);
    });

    it('Teste B2: SOURCE_CUTOVER_NOT_COMPLETED → processing NÃO finalizado (retryable)', async () => {
      const cutoverPendingTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_cutover_pending_001',
        supersede_status: 'pending', // cutover não concluído
      };
      planChangesStore.set('tr_cutover_pending_001', cutoverPendingTr);

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_cutover_pending_001' },
        planChangesStore.get('tr_cutover_pending_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('SOURCE_CUTOVER_NOT_COMPLETED');
      const calls = mockBillingRepo.markWebhookEventProcessed.mock.calls;
      const calledForThisEvent = calls.some(
        (args: any[]) => args[1] === 'evt_cutover_pending_001'
      );
      expect(calledForThisEvent).toBe(false);
    });

    it('Teste C: financial_attention_required=true → markWebhookEventProcessed("processed") chamado, sem retry loop', async () => {
      const attentionTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_financial_attention_001',
        financial_attention_required: true,
        financial_attention_reason: 'MANUAL_REVIEW',
        financial_safety_status: 'attention_required',
      };
      planChangesStore.set('tr_financial_attention_001', attentionTr);

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_attention_001' },
        planChangesStore.get('tr_financial_attention_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('financial_attention_required');
      // Categoria C: bloqueio vem do campo financial_attention_required, não do webhook.
      // Evento DEVE ser finalizado terminalmente para evitar loop de retry.
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_attention_001',
        'processed'
      );
      // Transição não deve ter sido alterada
      const tr = planChangesStore.get('tr_financial_attention_001')!;
      expect((tr as any).financial_attention_required).toBe(true);
    });

    it('Teste C2: COMMERCIAL_BOUNDARY_MISMATCH → markWebhookEventProcessed("processed") chamado', async () => {
      const boundaryMismatchTr: BillingTransitionV1Record = {
        ...baseScheduledTransition,
        id: 'tr_boundary_mismatch_001',
        effective_billing_date: '2026-10-02',
        current_period_end_billing_date: '2026-10-05', // divergente
      };
      planChangesStore.set('tr_boundary_mismatch_001', boundaryMismatchTr);

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_boundary_mismatch_001' },
        planChangesStore.get('tr_boundary_mismatch_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('COMMERCIAL_BOUNDARY_MISMATCH');
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_boundary_mismatch_001',
        'processed'
      );
      // Atenção financeira deve ter sido persistida
      const tr = planChangesStore.get('tr_boundary_mismatch_001')!;
      expect((tr as any).financial_attention_required).toBe(true);
    });

    it('Teste D: WRONG_PAYMENT_ID → markWebhookEventProcessed("ignored") chamado', async () => {
      const wrongPaymentEvent = {
        providerEventId: 'evt_wrong_payment_001',
        eventType: 'payment_confirmed' as const,
        rawEventType: 'PAYMENT_CONFIRMED',
        providerPaymentId: 'pay_completely_different', // ID errado
        providerSubscriptionId: 'sub_completely_different', // sub errada também
        providerCustomerId: 'cus_test_1',
        amountCents: 3490,
        dueDate: '2026-10-02',
      };

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        wrongPaymentEvent,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('WRONG_PAYMENT_ID');
      // Categoria D: ignorado definitivamente
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_wrong_payment_001',
        'ignored',
        expect.stringContaining('pay_completely_different')
      );
    });

    it('Teste D2: WRONG_TARGET_SUBSCRIPTION → markWebhookEventProcessed("ignored") chamado', async () => {
      const wrongSubEvent = {
        providerEventId: 'evt_wrong_sub_001',
        eventType: 'payment_confirmed' as const,
        rawEventType: 'PAYMENT_CONFIRMED',
        providerPaymentId: 'pay_target_001', // payment correto
        providerSubscriptionId: 'sub_completely_different', // sub errada
        providerCustomerId: 'cus_test_1',
        amountCents: 3490,
        dueDate: '2026-10-02',
      };

      const result = await (billingService as any).processScheduledPaidRenewalSettlement(
        wrongSubEvent,
        planChangesStore.get('tr_scheduled_001')!,
        new Date('2026-10-02T12:00:00Z'),
        { nowCommercialDate: '2026-10-02' }
      );

      expect(result.reason).toBe('WRONG_TARGET_SUBSCRIPTION');
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_wrong_sub_001',
        'ignored',
        expect.stringContaining('sub_completely_different')
      );
    });

    it('Teste E: múltiplos eventos distintos pré-boundary → cada um obtém status processed independentemente', async () => {
      const preboundaryNow = new Date('2026-09-20T10:00:00Z');

      // Provider retorna OVERDUE para ambas as chamadas
      const overduePayment = {
        id: 'pay_target_001',
        subscriptionId: 'sub_target_new',
        customerId: 'cus_test_1',
        status: 'OVERDUE',
        dueDate: '2026-10-02',
        amountCents: 3490,
      };
      mockProvider.getPayment.mockResolvedValueOnce(overduePayment);
      mockProvider.getPayment.mockResolvedValueOnce(overduePayment);

      const result1 = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_overdue_001' },
        planChangesStore.get('tr_scheduled_001')!,
        preboundaryNow,
        { nowCommercialDate: '2026-09-20' }
      );
      const result2 = await (billingService as any).processScheduledPaidRenewalSettlement(
        { ...preboundaryEvent, providerEventId: 'evt_overdue_002' },
        planChangesStore.get('tr_scheduled_001')!,
        preboundaryNow,
        { nowCommercialDate: '2026-09-20' }
      );

      expect(result1.reason).toBe('renewal_payment_not_settled');
      expect(result2.reason).toBe('renewal_payment_not_settled');

      // Cada evento chamou markWebhookEventProcessed independentemente
      const calls = mockBillingRepo.markWebhookEventProcessed.mock.calls;
      const event1Finalized = calls.some((args: any[]) => args[1] === 'evt_overdue_001' && args[2] === 'processed');
      const event2Finalized = calls.some((args: any[]) => args[1] === 'evt_overdue_002' && args[2] === 'processed');
      expect(event1Finalized).toBe(true);
      expect(event2Finalized).toBe(true);

      // Transição permanece scheduled; entitlement source preservado
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.transition_status).toBe('scheduled');
      expect(transactionsStore.size).toBe(0);
    });
  });
});
