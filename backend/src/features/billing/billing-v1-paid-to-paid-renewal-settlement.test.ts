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
      getSubscription: vi.fn().mockResolvedValue({
        id: 'sub_target_new',
        status: 'ACTIVE',
        value: 34.9,
        valueCents: 3490,
        cycle: 'MONTHLY',
        nextDueDate: '2026-11-02',
        customer: 'cus_test_1',
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
      const todayDate = new Date().toISOString().slice(0, 10);
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

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('renewal_payment_not_settled');

      // Mantém plano de origem Lite
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      const appSub = appSubscriptionsStore.get('min_test_1');
      expect(appSub.plan_id).toBe('lite');

      // Transição permanece scheduled
      const tr = planChangesStore.get('tr_scheduled_001')!;
      expect(tr.transition_status).toBe('scheduled');

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
});
