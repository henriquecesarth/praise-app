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

describe('Phase 3B.2 — Paid -> Paid Source Recurrence Cutover & Scheduling', () => {
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
              (item as any).transition_status === 'pending_future_authorization' ||
              (item as any).transition_status === 'future_target_prepared' ||
              (item as any).transition_status === 'awaiting_old_inactivation'
            ) {
              list.push(item);
            }
          }
        }
        return list.slice(0, limit);
      }),
      getPendingOrFailedPlanChanges: vi.fn().mockResolvedValue([]),
      saveTransaction: vi.fn().mockImplementation(async (tx: any) => {
        transactionsStore.set(tx.id, tx);
      }),
    };

    mockSubscriptionService = {
      changePlan: vi.fn().mockResolvedValue(undefined),
      changeMemberAddonBlocks: vi.fn().mockResolvedValue(undefined),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return appSubscriptionsStore.get(ministryId) || null;
      }),
    };

    mockMinistryRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'min_test_1', name: 'Ministry Test' }),
    };

    mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'leader@test.com' }),
    };

    mockProvider = {
      name: 'asaas',
      getSubscription: vi.fn(),
      inactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      removeSubscription: vi.fn().mockResolvedValue({ success: true }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      listPaymentsByCheckoutSession: vi.fn().mockResolvedValue([]),
      getPayment: vi.fn(),
      removePayment: vi.fn().mockResolvedValue({ success: true }),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
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

  function setupBaselinePreparedTransition(overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record {
    const ministryId = overrides.ministry_id || 'min_test_1';
    const cutoffDate = overrides.effective_billing_date || overrides.current_period_end_billing_date || '2026-10-01';

    // Source subscription (Lite Monthly R$ 14,90)
    const sourceSub: BillingSubscriptionRecord = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: 'sub_src_lite_123',
      provider_customer_id: 'cus_can_123',
      plan_id: 'lite',
      interval: 'monthly',
      member_addon_blocks: 0,
      amount_cents: 1490,
      status: 'active',
      started_at: '2026-09-01T12:00:00.000Z',
      current_period_start: '2026-09-01T12:00:00.000Z',
      current_period_end: '2026-10-01T12:00:00.000Z',
      current_period_end_billing_date: cutoffDate,
      cancel_at_period_end: false,
      created_at: '2026-09-01T12:00:00.000Z',
      updated_at: '2026-09-01T12:00:00.000Z',
    };
    subscriptionsStore.set(ministryId, sourceSub);

    // Customer
    customersStore.set(`${ministryId}_asaas`, {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_customer_id: 'cus_can_123',
      created_at: '2026-09-01T12:00:00.000Z',
      updated_at: '2026-09-01T12:00:00.000Z',
    });

    // Active Transition Slot HELD
    const transitionId = overrides.id || `tr_prepared_${Date.now()}`;
    const slotKey = `slot_${ministryId}_asaas`;
    activeSlotsStore.set(slotKey, {
      id: slotKey,
      ministry_id: ministryId,
      provider: 'asaas',
      plan_change_id: transitionId,
      acquired_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });

    // Transition record in future_target_prepared
    const transitionRecord: BillingTransitionV1Record = {
      id: transitionId,
      transition_id: transitionId,
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: 'asaas',
      currency: 'BRL',
      execution_strategy: 'scheduled_paid_transition',
      transition_status: 'future_target_prepared',
      early_activation_status: 'not_applicable',
      financial_safety_status: 'live',
      transition_type: 'upgrade',
      status: 'pending',
      requested_plan_id: 'essential',
      requested_interval: 'monthly',
      requested_addon_blocks: 0,
      expected_amount_cents: 3490,
      source_plan_id: 'lite',
      source_interval: 'monthly',
      source_addon_blocks: 0,
      source_current_cycle_total_cents: 1490,
      source_entitlement_snapshot: { plan_id: 'lite', addon_blocks: 0 },
      current_period_start: '2026-09-01T12:00:00.000Z',
      current_period_end: '2026-10-01T12:00:00.000Z',
      current_period_end_billing_date: cutoffDate,
      effective_billing_date: cutoffDate,
      target_plan_id: 'essential',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      target_future_recurring_price_cents: 3490,
      requested_commercial_date: '2026-09-02',
      price_locked_at: new Date().toISOString(),
      requested_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: null,
      provider_customer_id: 'cus_can_123',
      old_provider_subscription_id: 'sub_src_lite_123',
      future_provider_checkout_id: 'chk_target_456',
      future_provider_subscription_id: 'sub_tgt_ess_789',
      new_provider_subscription_id: 'sub_tgt_ess_789',
      future_provider_payment_id: 'pay_tgt_boundary_1',
      financial_attention_required: false,
      financial_attention_reason: null,
      ...overrides,
    };

    planChangesStore.set(transitionId, transitionRecord);
    return transitionRecord;
  }

  // ==========================================================================
  // 1. HAPPY PATH: CUTOVER & SCHEDULING
  // ==========================================================================
  describe('1. Happy Path Cutover & Scheduling (future_target_prepared -> awaiting_old_inactivation -> scheduled)', () => {
    it('executa com sucesso revalidação do target, inativação da source, limpeza de faturas futuras PENDING e marca scheduled com slot HELD', async () => {
      const tr = setupBaselinePreparedTransition();

      // Provider Target: ativa, cycle monthly, valor 3490
      mockProvider.getSubscription.mockImplementation(async (subId: string) => {
        if (subId === 'sub_tgt_ess_789') {
          return {
            status: 'ACTIVE',
            customer: 'cus_can_123',
            cycle: 'MONTHLY',
            value: 34.9,
            valueCents: 3490,
            nextDueDate: '2026-11-01',
          };
        }
        if (subId === 'sub_src_lite_123') {
          return {
            status: 'ACTIVE',
            customer: 'cus_can_123',
            cycle: 'MONTHLY',
            value: 14.9,
          };
        }
        return null;
      });

      // Target payments: first payment na boundary (2026-10-01)
      mockProvider.listSubscriptionPayments.mockImplementation(async (subId: string) => {
        if (subId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
              billingType: 'CREDIT_CARD',
            },
          ];
        }
        if (subId === 'sub_src_lite_123') {
          return [
            {
              id: 'pay_src_old_pending',
              subscriptionId: 'sub_src_lite_123',
              customerId: 'cus_can_123',
              amountCents: 1490,
              dueDate: '2026-10-01', // >= cutoff -> elegível para deleção
              status: 'PENDING',
              billingType: 'CREDIT_CARD',
            },
          ];
        }
        return [];
      });

      // Fresh read do payment da source antes do delete
      mockProvider.getPayment.mockImplementation(async (payId: string) => {
        if (payId === 'pay_src_old_pending') {
          return {
            id: 'pay_src_old_pending',
            subscriptionId: 'sub_src_lite_123',
            customerId: 'cus_can_123',
            amountCents: 1490,
            dueDate: '2026-10-01',
            status: 'PENDING',
            billingType: 'CREDIT_CARD',
          };
        }
        return null;
      });

      // Ao inativar, fresh read de source passa a retornar INACTIVE
      mockProvider.inactivateSubscription.mockImplementation(async (subId: string) => {
        mockProvider.getSubscription.mockImplementation(async (sId: string) => {
          if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
          if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
          return null;
        });
        return { success: true };
      });

      // Ao deletar o payment da source, relistagem retorna vazio
      mockProvider.removePayment.mockImplementation(async (pId: string) => {
        mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
          if (sId === 'sub_tgt_ess_789') {
            return [
              {
                id: 'pay_tgt_boundary_1',
                subscriptionId: 'sub_tgt_ess_789',
                customerId: 'cus_can_123',
                amountCents: 3490,
                dueDate: '2026-10-01',
                status: 'PENDING',
              },
            ];
          }
          return [];
        });
        return { success: true };
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'test_worker');
      expect(result.success).toBe(true);

      const finalTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(finalTr.transition_status).toBe('scheduled');
      expect(finalTr.status).toBe('pending');
      expect(finalTr.supersede_status).toBe('completed');
      expect(finalTr.payment_cleanup_status).toBe('completed');
      expect(finalTr.payment_cleanup_ids).toEqual(['pay_src_old_pending']);
      expect(finalTr.financial_attention_required).toBe(false);
      expect(finalTr.financial_safety_status).toBe('live');

      // Invariante 1: Slot permanece HELD
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
      expect(mockBillingRepo.releaseSlotIfOwnedAndSafe).not.toHaveBeenCalled();

      // Invariante 2: Entitlement LouvAIO NÃO é alterado
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      expect(mockSubscriptionService.changeMemberAddonBlocks).not.toHaveBeenCalled();

      // Invariante 3: DELETE /v3/subscriptions NUNCA é chamado
      expect(mockProvider.removeSubscription).not.toHaveBeenCalled();

      // Invariante 4: PUT /v3/subscriptions status INACTIVE é chamado na source
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_src_lite_123');

      // Invariante 5: Nenhuma BillingTransaction foi salva
      expect(transactionsStore.size).toBe(0);
    });
  });

  // ==========================================================================
  // 2. TARGET REVALIDATION BEFORE SOURCE MUTATION
  // ==========================================================================
  describe('2. Target Ready Revalidation Failure BEFORE Source Mutation', () => {
    it('se o target payment sumiu ou mudou de valor antes da mutação, NÃO toca na assinatura de origem', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockResolvedValue({
        status: 'ACTIVE',
        customer: 'cus_can_123',
        cycle: 'MONTHLY',
        valueCents: 3490,
      });

      // Target payments vazio: target boundary payment não encontrado
      mockProvider.listSubscriptionPayments.mockResolvedValue([]);

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('target_payment_not_found_on_boundary');

      // Source NUNCA foi inativada nem teve pagamentos removidos
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
      expect(mockProvider.removePayment).not.toHaveBeenCalled();

      // Transição permanece intacta
      const currentTr = planChangesStore.get(tr.id)!;
      expect(currentTr.transition_status).toBe('future_target_prepared');
    });

    it('se o target tiver valor divergente do price lock, falha no Gate e não muta source', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockResolvedValue({
        status: 'ACTIVE',
        customer: 'cus_can_123',
        cycle: 'MONTHLY',
        valueCents: 8990, // Divergente de 3490
      });

      mockProvider.listSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_tgt_wrong_amount',
          subscriptionId: 'sub_tgt_ess_789',
          customerId: 'cus_can_123',
          amountCents: 3490,
          dueDate: '2026-10-01',
          status: 'PENDING',
        },
      ]);

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('AMOUNT_MISMATCH');

      // Source NÃO foi tocada
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
      expect(mockProvider.removePayment).not.toHaveBeenCalled();

      const currentTr = planChangesStore.get(tr.id)!;
      expect(currentTr.financial_attention_required).toBe(true);
      expect(currentTr.financial_attention_reason).toBe('AMOUNT_MISMATCH');
    });
  });

  // ==========================================================================
  // 3. SOURCE == TARGET COLLISION INVARIANT
  // ==========================================================================
  describe('3. Source == Target Subscription Collision Guard', () => {
    it('aciona fail closed SOURCE_TARGET_SUBSCRIPTION_COLLISION e atenção financeira se sourceId == targetId', async () => {
      const tr = setupBaselinePreparedTransition({
        old_provider_subscription_id: 'sub_same_id',
        future_provider_subscription_id: 'sub_same_id',
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_TARGET_SUBSCRIPTION_COLLISION');

      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();

      const currentTr = planChangesStore.get(tr.id)!;
      expect(currentTr.financial_attention_required).toBe(true);
      expect(currentTr.financial_attention_reason).toBe('SOURCE_TARGET_SUBSCRIPTION_COLLISION');
    });
  });

  // ==========================================================================
  // 4. IDEMPOTENT SOURCE INACTIVATION
  // ==========================================================================
  describe('4. Source Inactivation Idempotency', () => {
    it('se a assinatura de origem já estiver INACTIVE, não repete PUT desnecessariamente e prossegue', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        }
        if (sId === 'sub_src_lite_123') {
          return { status: 'INACTIVE', customer: 'cus_can_123' }; // Já INACTIVE!
        }
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        return [];
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(true);

      // inactivateSubscription NÃO foi chamado de novo
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
    });
  });

  // ==========================================================================
  // 5. UNCERTAIN SOURCE INACTIVATION RECOVERY
  // ==========================================================================
  describe('5. Uncertain Source Inactivation Recovery', () => {
    it('quando PUT status INACTIVE sofre erro de rede mas fresh read comprova INACTIVE, continua com segurança', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        }
        if (sId === 'sub_src_lite_123') {
          return { status: 'ACTIVE', customer: 'cus_can_123' };
        }
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        return [];
      });

      // inactivateSubscription sofre timeout/network error
      mockProvider.inactivateSubscription.mockRejectedValue(new Error('Network timeout'));

      // fresh read posterior no recheck comprova que ficou INACTIVE no gateway
      let calledInactivate = false;
      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_src_lite_123') {
          return { status: calledInactivate ? 'INACTIVE' : 'ACTIVE' };
        }
        if (sId === 'sub_tgt_ess_789') {
          return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        }
        return null;
      });

      mockProvider.inactivateSubscription.mockImplementation(async () => {
        calledInactivate = true;
        throw new Error('Network timeout');
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(true);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(false);
    });
  });

  // ==========================================================================
  // 6. PHASE 3B.2 FINANCIAL BOUNDARY HARDENING & TEST MATRIX (A-J)
  // ==========================================================================
  describe('6. Financial Boundary Hardening & Test Matrix (A-J)', () => {
    // A) DELETE timeout, fresh GET -> 404 -> deletion confirmed
    it('A) DELETE timeout com fresh GET -> 404: confirma remoção e avança com sucesso para scheduled', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      const sourcePayments = [
        { id: 'pay_src_timeout_404', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') return sourcePayments;
        return [];
      });

      // DELETE sofre timeout
      let deleteAttempted = false;
      mockProvider.removePayment.mockImplementation(async (id: string) => {
        deleteAttempted = true;
        // Ao deletar no provedor, a fatura sumiu (404)
        sourcePayments.length = 0;
        throw new Error('Gateway timeout on DELETE');
      });

      // Antes do delete, getPayment retorna a fatura PENDING. Após o delete timeout, retorna null (404).
      mockProvider.getPayment.mockImplementation(async (id: string) => {
        if (!deleteAttempted) {
          return { id, status: 'PENDING', dueDate: '2026-10-01', subscriptionId: 'sub_src_lite_123' };
        }
        return null;
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(true);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
      expect(finalTr.payment_cleanup_ids).toEqual(['pay_src_timeout_404']);
      expect(finalTr.financial_attention_required).toBe(false);
    });

    // B) DELETE timeout, fresh GET -> PENDING -> not confirmed / fail closed
    it('B) DELETE timeout com fresh GET -> PENDING: deleção NÃO confirmada, fail closed com SOURCE_PAYMENT_DELETE_UNCERTAIN', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      const sourcePayments = [
        { id: 'pay_src_timeout_pend', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') return sourcePayments;
        return [];
      });

      mockProvider.removePayment.mockRejectedValue(new Error('Gateway connection reset'));
      // Fresh recheck mostra que a fatura continua ativa PENDING!
      mockProvider.getPayment.mockResolvedValue(sourcePayments[0]);

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_DELETE_UNCERTAIN');

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).not.toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('SOURCE_PAYMENT_DELETE_UNCERTAIN');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });

    // C) DELETE timeout, fresh GET -> CONFIRMED -> SOURCE_PAYMENT_SETTLED_DURING_CUTOVER
    it('C) DELETE timeout com fresh GET -> CONFIRMED: fail closed com SOURCE_PAYMENT_SETTLED_DURING_CUTOVER', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') {
          return [{ id: 'pay_src_raced_conf', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' }];
        }
        return [];
      });

      mockProvider.removePayment.mockRejectedValue(new Error('Gateway timeout'));
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_src_raced_conf',
        subscriptionId: 'sub_src_lite_123',
        status: 'CONFIRMED', // Liquidada concorrentemente!
        dueDate: '2026-10-01',
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_SETTLED_DURING_CUTOVER');

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).not.toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('SOURCE_PAYMENT_SETTLED_DURING_CUTOVER');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });

    // D) DELETE timeout, fresh GET -> RECEIVED -> attention
    it('D) DELETE timeout com fresh GET -> RECEIVED: fail closed com SOURCE_PAYMENT_SETTLED_DURING_CUTOVER', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') {
          return [{ id: 'pay_src_raced_rec', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' }];
        }
        return [];
      });

      mockProvider.removePayment.mockRejectedValue(new Error('Gateway timeout'));
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_src_raced_rec',
        subscriptionId: 'sub_src_lite_123',
        status: 'RECEIVED', // Liquidada concorrentemente via PIX/Boleto!
        dueDate: '2026-10-01',
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_SETTLED_DURING_CUTOVER');

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).not.toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('SOURCE_PAYMENT_SETTLED_DURING_CUTOVER');
    });

    // E) source já possui CONFIRMED due cutoff antes do cleanup -> preserve -> attention -> no scheduled
    it('E) source já possui CONFIRMED due cutoff antes do cleanup: preserva, aciona SOURCE_PAYMENT_ALREADY_SETTLED e bloqueia scheduled', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'ACTIVE' };
        return null;
      });

      const sourcePayments = [
        { id: 'pay_src_pre_confirmed', subscriptionId: 'sub_src_lite_123', status: 'CONFIRMED', dueDate: '2026-10-01' },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') return sourcePayments;
        return [];
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_ALREADY_SETTLED');

      // NÃO deleta fatura liquidada, NÃO inativa provedor, NÃO estorna
      expect(mockProvider.removePayment).not.toHaveBeenCalled();
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).not.toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('SOURCE_PAYMENT_ALREADY_SETTLED');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });

    // F) source já possui OVERDUE due cutoff+1 -> preserve -> attention -> no scheduled
    it('F) source já possui OVERDUE due cutoff+1 antes do cleanup: preserva, aciona SOURCE_PAYMENT_OVERDUE e bloqueia scheduled', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'ACTIVE' };
        return null;
      });

      const sourcePayments = [
        { id: 'pay_src_overdue', subscriptionId: 'sub_src_lite_123', status: 'OVERDUE', dueDate: '2026-10-02' },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') return sourcePayments;
        return [];
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_OVERDUE');

      expect(mockProvider.removePayment).not.toHaveBeenCalled();
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).not.toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('SOURCE_PAYMENT_OVERDUE');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });

    // G) cleanup de PENDING termina, mas final all-status read encontra CONFIRMED >= cutoff -> no scheduled
    it('G) cleanup de PENDING termina, mas final all-status read encontra CONFIRMED >= cutoff: bloqueia scheduled', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      let callCount = 0;
      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string, opts: any) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') {
          callCount++;
          // Na primeira listagem (antes do cleanup): fatura PENDING normal
          if (callCount === 1) {
            return [{ id: 'pay_src_pending_clean', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' }];
          }
          // Na segunda listagem (cleanup list): vazia porque foi deletada
          if (opts?.status === 'PENDING') return [];
          // Na checagem final all-status: surge uma fatura CONFIRMED >= cutoff
          return [{ id: 'pay_src_late_confirmed', subscriptionId: 'sub_src_lite_123', status: 'CONFIRMED', dueDate: '2026-10-01' }];
        }
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (id: string) => {
        if (id === 'pay_src_pending_clean') return { id, status: 'PENDING', dueDate: '2026-10-01' };
        return null;
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_ALREADY_SETTLED');

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).not.toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('SOURCE_PAYMENT_ALREADY_SETTLED');
    });

    // H) effective_billing_date missing -> no provider mutation
    it('H) effective_billing_date missing: fail closed com COMMERCIAL_BOUNDARY_MISMATCH sem mutação no gateway', async () => {
      const tr = setupBaselinePreparedTransition({
        effective_billing_date: null as any,
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('COMMERCIAL_BOUNDARY_MISMATCH');

      // Nenhuma mutação no gateway!
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
      expect(mockProvider.removePayment).not.toHaveBeenCalled();

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('COMMERCIAL_BOUNDARY_MISMATCH');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });

    // I) periodEnd != effective -> COMMERCIAL_BOUNDARY_MISMATCH -> no provider mutation
    it('I) periodEnd != effective: fail closed com COMMERCIAL_BOUNDARY_MISMATCH sem mutação no gateway', async () => {
      const tr = setupBaselinePreparedTransition({
        effective_billing_date: '2026-10-01',
        current_period_end_billing_date: '2026-10-02', // Divergente!
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('COMMERCIAL_BOUNDARY_MISMATCH');

      // Nenhuma mutação no gateway!
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
      expect(mockProvider.removePayment).not.toHaveBeenCalled();

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.financial_attention_required).toBe(true);
      expect(finalTr.financial_attention_reason).toBe('COMMERCIAL_BOUNDARY_MISMATCH');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });

    // J) source possui apenas histórico < cutoff + nenhum obligation >= cutoff -> scheduled PASS
    it('J) source possui apenas histórico < cutoff e nenhum obligation >= cutoff: avança para scheduled PASS', async () => {
      const tr = setupBaselinePreparedTransition({
        effective_billing_date: '2026-10-01',
        current_period_end_billing_date: '2026-10-01',
      });

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      const sourcePayments = [
        { id: 'pay_hist_conf_1', subscriptionId: 'sub_src_lite_123', status: 'CONFIRMED', dueDate: '2026-08-01' },
        { id: 'pay_hist_rec_2', subscriptionId: 'sub_src_lite_123', status: 'RECEIVED', dueDate: '2026-09-01' },
        { id: 'pay_src_pending_boundary', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') return sourcePayments;
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (id: string) => {
        return sourcePayments.find((p) => p.id === id) || null;
      });

      mockProvider.removePayment.mockImplementation(async (id: string) => {
        const idx = sourcePayments.findIndex((p) => p.id === id);
        if (idx >= 0) sourcePayments.splice(idx, 1);
        return { success: true };
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(true);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
      expect(finalTr.financial_attention_required).toBe(false);
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);

      // Histórico preservado
      expect(sourcePayments.find((p) => p.id === 'pay_hist_conf_1')).toBeDefined();
      expect(sourcePayments.find((p) => p.id === 'pay_hist_rec_2')).toBeDefined();
      // Cobrança boundary removida
      expect(sourcePayments.find((p) => p.id === 'pay_src_pending_boundary')).toBeUndefined();
    });
  });

  // ==========================================================================
  // 7. EXACT SUBSCRIPTION BOUNDARY (SECTION 29)
  // ==========================================================================
  describe('7. Exact Subscription Boundary Isolation', () => {
    it('remove cobranças APENAS da source e NUNCA da target, mesmo com pagamentos de mesmo valor e data', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      const sourcePayments = [
        { id: 'pay_src_due_cutoff', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' },
      ];
      const targetPayments = [
        { id: 'pay_tgt_due_cutoff', subscriptionId: 'sub_tgt_ess_789', status: 'PENDING', dueDate: '2026-10-01', amountCents: 3490 },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_src_lite_123') return sourcePayments;
        if (sId === 'sub_tgt_ess_789') return targetPayments;
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (id: string) => {
        if (id === 'pay_src_due_cutoff') return sourcePayments[0];
        if (id === 'pay_tgt_due_cutoff') return targetPayments[0];
        return null;
      });

      const removedIds: string[] = [];
      mockProvider.removePayment.mockImplementation(async (id: string) => {
        removedIds.push(id);
        const idx = sourcePayments.findIndex((p) => p.id === id);
        if (idx >= 0) sourcePayments.splice(idx, 1);
        return { success: true };
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(true);

      expect(removedIds).toEqual(['pay_src_due_cutoff']);
      expect(removedIds).not.toContain('pay_tgt_due_cutoff');
    });
  });

  // ==========================================================================
  // 8. PENDING -> SETTLED RACE GUARD (SECTIONS 16, 27)
  // ==========================================================================
  describe('8. Race Condition: PENDING -> CONFIRMED / RECEIVED Settled Race', () => {
    it('se cobrança source foi liquidada entre listagem e deleção: NÃO deleta, NÃO estorna, aciona financial attention e não avança para scheduled', async () => {
      const tr = setupBaselinePreparedTransition();

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') {
          // Listagem viu PENDING
          return [
            {
              id: 'pay_src_raced',
              subscriptionId: 'sub_src_lite_123',
              customerId: 'cus_can_123',
              amountCents: 1490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        return [];
      });

      // Fresh read no getPayment revela que o pagamento foi liquidado (CONFIRMED) no banco
      mockProvider.getPayment.mockResolvedValue({
        id: 'pay_src_raced',
        subscriptionId: 'sub_src_lite_123',
        customerId: 'cus_can_123',
        amountCents: 1490,
        dueDate: '2026-10-01',
        status: 'CONFIRMED', // Settled!
      });

      const result = await billingService.cutoverPaidToPaidSourceRecurrence(tr.id, 'worker');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('SOURCE_PAYMENT_SETTLED_DURING_CUTOVER');

      // NÃO deleta!
      expect(mockProvider.removePayment).not.toHaveBeenCalled();

      // Transição NÃO avançou para scheduled
      const currentTr = planChangesStore.get(tr.id)!;
      expect(currentTr.transition_status).not.toBe('scheduled');
      expect(currentTr.financial_attention_required).toBe(true);
      expect(currentTr.financial_attention_reason).toBe('SOURCE_PAYMENT_SETTLED_DURING_CUTOVER');
      expect(currentTr.financial_safety_status).toBe('attention_required');

      // Slot permanece HELD
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });
  });

  // ==========================================================================
  // 9. PARTIAL-FAILURE CRASH & RECONCILER RECOVERY (SECTION 26)
  // ==========================================================================
  describe('9. Partial-Failure Crash Tests (Section 26)', () => {
    it('Crash 1: awaiting_old_inactivation persistido -> crash antes do PUT -> reconciler recupera e finaliza em scheduled', async () => {
      // Estado onde o sistema persistiu awaiting_old_inactivation e caiu antes do PUT
      const tr = setupBaselinePreparedTransition({
        transition_status: 'awaiting_old_inactivation',
      });

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'ACTIVE' }; // Ainda ACTIVE
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        return [];
      });

      mockProvider.inactivateSubscription.mockImplementation(async () => {
        mockProvider.getSubscription.mockImplementation(async (sId: string) => {
          if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
          if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
          return null;
        });
        return { success: true };
      });

      const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
      const cycleRes = await worker.runCycle();
      expect(cycleRes.processed).toBe(1);
      expect(cycleRes.succeeded).toBe(1);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_src_lite_123');
    });

    it('Crash 3: Source INACTIVE -> um payment removido -> crash antes dos demais -> reconciler remove os restantes e conclui', async () => {
      const tr = setupBaselinePreparedTransition({
        transition_status: 'awaiting_old_inactivation',
      });

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' }; // Já INACTIVE
        return null;
      });

      // Sobrou pay_src_2 após pay_src_1 já ter sido removido na tentativa anterior
      const remainingPayments = [
        { id: 'pay_src_2', subscriptionId: 'sub_src_lite_123', status: 'PENDING', dueDate: '2026-10-01' },
      ];

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        if (sId === 'sub_src_lite_123') return remainingPayments;
        return [];
      });

      mockProvider.getPayment.mockImplementation(async (id: string) => {
        return remainingPayments.find((p) => p.id === id) || null;
      });

      mockProvider.removePayment.mockImplementation(async (id: string) => {
        const idx = remainingPayments.findIndex((p) => p.id === id);
        if (idx >= 0) remainingPayments.splice(idx, 1);
        return { success: true };
      });

      const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
      const cycleRes = await worker.runCycle();
      expect(cycleRes.succeeded).toBe(1);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_src_2');
      expect(finalTr.payment_cleanup_ids).toEqual(['pay_src_2']);
    });

    it('Crash 2: Source já INACTIVE no gateway mas status local ainda era future_target_prepared -> reconciler continua idempotentemente', async () => {
      const tr = setupBaselinePreparedTransition({
        transition_status: 'future_target_prepared',
      });

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' }; // Já INACTIVE no gateway
        return null;
      });

      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        return [];
      });

      const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
      const cycleRes = await worker.runCycle();
      expect(cycleRes.succeeded).toBe(1);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
      // Não re-inativou desnecessariamente
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
    });

    it('Crash 4: Todos os pagamentos elegíveis já foram removidos -> crash antes de scheduled -> reconciler reverifica e conclui', async () => {
      const tr = setupBaselinePreparedTransition({
        transition_status: 'awaiting_old_inactivation',
      });

      mockProvider.getSubscription.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') return { status: 'ACTIVE', customer: 'cus_can_123', cycle: 'MONTHLY', valueCents: 3490 };
        if (sId === 'sub_src_lite_123') return { status: 'INACTIVE' };
        return null;
      });

      // Nenhum pagamento elegível restante na source
      mockProvider.listSubscriptionPayments.mockImplementation(async (sId: string) => {
        if (sId === 'sub_tgt_ess_789') {
          return [
            {
              id: 'pay_tgt_boundary_1',
              subscriptionId: 'sub_tgt_ess_789',
              customerId: 'cus_can_123',
              amountCents: 3490,
              dueDate: '2026-10-01',
              status: 'PENDING',
            },
          ];
        }
        return [];
      });

      const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
      const cycleRes = await worker.runCycle();
      expect(cycleRes.succeeded).toBe(1);

      const finalTr = planChangesStore.get(tr.id)!;
      expect(finalTr.transition_status).toBe('scheduled');
    });

    it('Late/duplicate PAYMENT_DELETED webhook não causa regressão de estado em scheduled nem libera slot', async () => {
      const tr = setupBaselinePreparedTransition({
        transition_status: 'scheduled',
      });

      mockBillingRepo.getWebhookEvent = vi.fn().mockResolvedValue(null);
      mockBillingRepo.registerWebhookEvent = vi.fn().mockResolvedValue({ isDuplicate: false, event: {} });
      mockBillingRepo.markWebhookEventProcessed = vi.fn().mockResolvedValue(undefined);

      mockProvider.parseWebhookEvent = vi.fn().mockReturnValue({
        providerEventId: 'evt_del_late_999',
        eventType: 'PAYMENT_DELETED',
        rawEventType: 'PAYMENT_DELETED',
        paymentId: 'pay_src_old_pending',
      });

      const res = await billingService.handleWebhook({}, { event: 'PAYMENT_DELETED' });
      expect(res.status).toBe('ok');

      const currentTr = planChangesStore.get(tr.id)!;
      expect(currentTr.transition_status).toBe('scheduled');
      expect(activeSlotsStore.has(`slot_${tr.ministry_id}_asaas`)).toBe(true);
    });
  });
});
