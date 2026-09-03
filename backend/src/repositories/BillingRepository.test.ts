import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BillingRepository,
  SAFE_TERMINAL_TRANSITION_STATUSES,
  IMMUTABLE_TRANSITION_FIELDS,
  PERMANENT_WRITE_ONCE_FIELDS,
} from './BillingRepository';
import {
  BillingPlanChangeRecord,
  BillingTransitionV1Record,
  LegacyBillingPlanChangeRecord,
  BillingActiveTransitionSlotRecord,
  BillingEarlyActivationQuote,
  BillingCheckoutAttempt,
  isBillingTransitionV1,
  isLegacyPlanChange,
  validateBillingTransitionV1,
  mapTransitionStatusToLegacyStatus,
  buildActiveTransitionSlotId,
} from '../features/billing/billing.types';
import {
  buildTransitionCommercialSnapshot,
  buildBillingTransitionV1Record,
} from '../features/billing/billing-transition-domain.service';
import { AppError } from '../middleware/error-handler';
import { db } from '../lib/firebase';

describe('BillingRepository — Billing Transition Policy V1 Persistence Final Domain Model Hardening (Phase 1.2)', () => {
  let repo: BillingRepository;

  // In-memory Firestore store for transactional testing
  const planChangesStore = new Map<string, BillingPlanChangeRecord>();
  const activeSlotsStore = new Map<string, BillingActiveTransitionSlotRecord>();
  const subscriptionsStore = new Map<string, any>();

  const createQueryMock = (filters: Array<{ field: string; op: string; value: any }> = []) => ({
    where: vi.fn().mockImplementation((field: string, op: string, value: any) => {
      return createQueryMock([...filters, { field, op, value }]);
    }),
    limit: vi.fn().mockImplementation((limitCount: number) => ({
      get: vi.fn().mockImplementation(async () => {
        const matches: any[] = [];
        for (const record of planChangesStore.values()) {
          const matchesAll = filters.every((filter) => (record as any)[filter.field] === filter.value);
          if (matchesAll) {
            matches.push({ id: record.id, data: () => record });
            if (matches.length >= limitCount) break;
          }
        }
        return { empty: matches.length === 0, docs: matches };
      }),
    })),
    get: vi.fn().mockImplementation(async () => {
      const matches: any[] = [];
      for (const record of planChangesStore.values()) {
        const matchesAll = filters.every((filter) => (record as any)[filter.field] === filter.value);
        if (matchesAll) {
          matches.push({ id: record.id, data: () => record });
        }
      }
      return { empty: matches.length === 0, docs: matches };
    }),
  });

  beforeEach(() => {
    planChangesStore.clear();
    activeSlotsStore.clear();
    subscriptionsStore.clear();
    repo = new BillingRepository();

    // Mock Firestore collections
    (repo as any).subscriptionsCollection = {
      doc: (id: string) => ({
        id,
        collectionName: 'billing_subscriptions',
        get: vi.fn().mockImplementation(async () => {
          const data = subscriptionsStore.get(id);
          return { exists: Boolean(data), data: () => data };
        }),
        set: vi.fn().mockImplementation(async (data: any, options?: any) => {
          if (options?.merge && subscriptionsStore.has(id)) {
            subscriptionsStore.set(id, { ...subscriptionsStore.get(id)!, ...data });
          } else {
            subscriptionsStore.set(id, data);
          }
        }),
      }),
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => {
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockImplementation(async () => {
              const matches: any[] = [];
              for (const record of subscriptionsStore.values()) {
                if ((record as any)[field] === value) {
                  matches.push({ id: record.id, data: () => record });
                }
              }
              return { empty: matches.length === 0, docs: matches };
            }),
          }),
        };
      }),
    };

    (repo as any).planChangesCollection = {
      doc: (id: string) => ({
        id,
        collectionName: 'billing_plan_changes',
        get: vi.fn().mockImplementation(async () => {
          const data = planChangesStore.get(id);
          return { exists: Boolean(data), data: () => data };
        }),
        set: vi.fn().mockImplementation(async (data: any, options?: any) => {
          if (options?.merge && planChangesStore.has(id)) {
            planChangesStore.set(id, { ...planChangesStore.get(id)!, ...data });
          } else {
            planChangesStore.set(id, data);
          }
        }),
      }),
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => {
        return createQueryMock([{ field, op, value }]);
      }),
    };

    (repo as any).activeTransitionSlotsCollection = {
      doc: (id: string) => ({
        id,
        collectionName: 'billing_active_transition_slots',
        get: vi.fn().mockImplementation(async () => {
          const data = activeSlotsStore.get(id);
          return { exists: Boolean(data), data: () => data };
        }),
        set: vi.fn().mockImplementation(async (data: any, options?: any) => {
          if (options?.merge && activeSlotsStore.has(id)) {
            activeSlotsStore.set(id, { ...activeSlotsStore.get(id)!, ...data });
          } else {
            activeSlotsStore.set(id, data);
          }
        }),
        delete: vi.fn().mockImplementation(async () => {
          activeSlotsStore.delete(id);
        }),
      }),
    };

    // Mock db.runTransaction with accurate in-memory execution
    db.runTransaction = vi.fn().mockImplementation(async (callback: any) => {
      const transaction = {
        get: vi.fn().mockImplementation(async (docRef: any) => {
          if (docRef.collectionName === 'billing_active_transition_slots' || docRef.id.startsWith('slot_')) {
            const data = activeSlotsStore.get(docRef.id);
            return { exists: Boolean(data), data: () => data };
          } else {
            const data = planChangesStore.get(docRef.id);
            return { exists: Boolean(data), data: () => data };
          }
        }),
        set: vi.fn().mockImplementation((docRef: any, data: any, options?: any) => {
          if (docRef.collectionName === 'billing_active_transition_slots' || docRef.id.startsWith('slot_')) {
            if (options?.merge && activeSlotsStore.has(docRef.id)) {
              activeSlotsStore.set(docRef.id, { ...activeSlotsStore.get(docRef.id)!, ...data });
            } else {
              activeSlotsStore.set(docRef.id, data);
            }
          } else {
            if (options?.merge && planChangesStore.has(docRef.id)) {
              planChangesStore.set(docRef.id, { ...planChangesStore.get(docRef.id)!, ...data });
            } else {
              planChangesStore.set(docRef.id, data);
            }
          }
        }),
        delete: vi.fn().mockImplementation((docRef: any) => {
          if (docRef.collectionName === 'billing_active_transition_slots' || docRef.id.startsWith('slot_')) {
            activeSlotsStore.delete(docRef.id);
          } else {
            planChangesStore.delete(docRef.id);
          }
        }),
      };
      return await callback(transaction);
    });
  });

  const createSampleV1Record = (overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record => {
    const nowIso = new Date().toISOString();
    return {
      id: 'transition_tr_123',
      transition_id: 'transition_tr_123',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      currency: 'BRL',

      // V1 Strategy & Attributes
      policy_version: 'billing_transition_v1',
      execution_strategy: 'scheduled_paid_transition',
      transition_type: 'upgrade',
      transition_status: 'pending_future_authorization',
      early_activation_status: 'not_applicable',
      financial_safety_status: 'live',

      // Legacy denormalized compatibility
      status: 'pending',
      requested_plan_id: 'pro',
      requested_interval: 'monthly',
      requested_addon_blocks: 0,
      expected_amount_cents: 8990,
      checkout_intent_id: 'intent_future_123',

      // Source snapshot (Essential monthly + 3 addons = 6460 cents)
      source_plan_id: 'essential',
      source_interval: 'monthly',
      source_addon_blocks: 3,
      source_current_cycle_total_cents: 6460,
      source_entitlement_snapshot: {
        plan_id: 'essential',
        addon_blocks: 3,
      },
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',

      // Target snapshot (Pro monthly + 0 addons = 8990 cents)
      target_plan_id: 'pro',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      target_future_recurring_price_cents: 8990,
      early_activation_target_entitlement_snapshot: {
        plan_id: 'pro',
        addon_blocks: 0,
      },

      // Early activation snapshot
      target_current_cycle_total_cents: 8990,
      prorated_adjustment_cents: 1265,

      // Distinct Intent & Provider References
      future_checkout_intent_id: 'intent_future_123',
      future_provider_checkout_id: null,
      future_provider_subscription_id: null,
      future_provider_payment_id: null,
      old_provider_subscription_id: 'sub_old_999',
      early_activation_checkout_intent_id: 'intent_early_456',
      early_activation_provider_checkout_id: null,
      early_activation_provider_payment_id: null,
      provider_customer_id: 'cus_can_123',

      // Dates and classification
      effective_at: '2026-10-01T00:00:00.000Z',
      effective_billing_date: '2026-10-01',
      requested_commercial_date: '2026-09-01',
      price_locked_at: nowIso,
      requested_at: nowIso,
      requested_by_user_id: 'usr_admin_1',

      created_at: nowIso,
      updated_at: nowIso,
      expires_at: null,
      ...overrides,
    };
  };

  describe('1. Entitlement Snapshots (Audit Basis, Not Live Runtime Authority)', () => {
    it('deve armazenar source_entitlement_snapshot e early_activation_target_entitlement_snapshot como auditoria imutável', async () => {
      const record = createSampleV1Record({
        source_entitlement_snapshot: { plan_id: 'essential', addon_blocks: 3 },
        early_activation_target_entitlement_snapshot: { plan_id: 'pro', addon_blocks: 0 },
      });

      const { planChange } = await repo.createTransitionAndClaimSlot(record);
      if (isBillingTransitionV1(planChange)) {
        expect(planChange.source_entitlement_snapshot).toEqual({ plan_id: 'essential', addon_blocks: 3 });
        expect(planChange.early_activation_target_entitlement_snapshot).toEqual({ plan_id: 'pro', addon_blocks: 0 });
      }

      // Rejeita modificação de source_entitlement_snapshot
      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          source_entitlement_snapshot: { plan_id: 'free', addon_blocks: 0 },
        })
      ).rejects.toThrow(/Campo imutável 'source_entitlement_snapshot' não pode ser modificado/i);

      // Rejeita modificação de early_activation_target_entitlement_snapshot
      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          early_activation_target_entitlement_snapshot: { plan_id: 'free', addon_blocks: 0 },
        })
      ).rejects.toThrow(/Campo imutável 'early_activation_target_entitlement_snapshot' não pode ser modificado/i);
    });

    it('deve REJEITAR runtime validation se source_entitlement_snapshot for inválido ou ausente', () => {
      const invalidRecord = createSampleV1Record({
        source_entitlement_snapshot: null as any,
      });

      expect(() => validateBillingTransitionV1(invalidRecord)).toThrow(
        /Registro V1 corrompido.*source_entitlement_snapshot/i
      );
    });
  });

  describe('2. Scheduled Recurrence Price Lock vs. Early Activation Quote Lock', () => {
    it('deve manter target_future_recurring_price_cents imutável travado em requested_at', async () => {
      const record = createSampleV1Record({
        target_future_recurring_price_cents: 8990,
      });
      await repo.createTransitionAndClaimSlot(record);

      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          target_future_recurring_price_cents: 9990,
        })
      ).rejects.toThrow(/Campo imutável 'target_future_recurring_price_cents' não pode ser modificado/i);
    });

    it('deve suportar cálculo dinâmico de early activation quote posterior com histórico preservado', async () => {
      const record = createSampleV1Record({ id: 'trans_late_quote' });
      await repo.createTransitionAndClaimSlot(record);

      const quote1: BillingEarlyActivationQuote = {
        quote_id: 'quote_1',
        transition_id: record.id,
        ministry_id: record.ministry_id,
        source_current_cycle_total_cents: 6460,
        target_current_cycle_total_cents: 8990,
        prorated_adjustment_cents: 1800,
        currency: 'BRL',
        priced_at: '2026-09-10T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-10',
        expires_at: '2026-09-12T12:00:00.000Z',
        status: 'active',
      };

      const attempt1: BillingCheckoutAttempt = {
        attempt_id: 'att_1',
        transition_id: record.id,
        attempt_type: 'early_activation',
        internal_checkout_intent_id: 'intent_ea_1',
        provider_checkout_id: 'chk_ea_1',
        quote_id: 'quote_1',
        amount_cents: 1800,
        currency: 'BRL',
        status: 'pending',
        created_at: '2026-09-10T12:00:00.000Z',
      };

      // Registra primeiro quote e attempt
      const step1 = await repo.recordNewCheckoutAttempt(record.id, record.ministry_id, attempt1, quote1);
      expect(step1.current_early_activation_quote?.quote_id).toBe('quote_1');
      expect(step1.prorated_adjustment_cents).toBe(1800);
      expect(step1.checkout_attempts?.length).toBe(1);

      // Usuário retorna dias depois (quote 1 expirou, gera quote 2 com novo cálculo)
      const quote2: BillingEarlyActivationQuote = {
        quote_id: 'quote_2',
        transition_id: record.id,
        ministry_id: record.ministry_id,
        source_current_cycle_total_cents: 6460,
        target_current_cycle_total_cents: 8990,
        prorated_adjustment_cents: 1000,
        currency: 'BRL',
        priced_at: '2026-09-25T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-25',
        expires_at: '2026-09-27T12:00:00.000Z',
        status: 'active',
      };

      const attempt2: BillingCheckoutAttempt = {
        attempt_id: 'att_2',
        transition_id: record.id,
        attempt_type: 'early_activation',
        internal_checkout_intent_id: 'intent_ea_2',
        provider_checkout_id: 'chk_ea_2',
        quote_id: 'quote_2',
        amount_cents: 1000,
        currency: 'BRL',
        status: 'pending',
        created_at: '2026-09-25T12:00:00.000Z',
      };

      const step2 = await repo.recordNewCheckoutAttempt(record.id, record.ministry_id, attempt2, quote2);
      expect(step2.current_early_activation_quote?.quote_id).toBe('quote_2');
      expect(step2.prorated_adjustment_cents).toBe(1000);
      expect(step2.early_activation_quotes_history?.length).toBe(2);
      expect(step2.early_activation_quotes_history?.[0].status).toBe('superseded');
      expect(step2.early_activation_quotes_history?.[1].status).toBe('active');
      expect(step2.checkout_attempts?.length).toBe(2);
      expect(step2.checkout_attempts?.[0].status).toBe('expired');
      expect(step2.checkout_attempts?.[1].status).toBe('pending');
    });
  });

  describe('3. Checkout Attempts & Reference Overwrite Protection', () => {
    it('deve BLOQUEAR sobrescrita de provider checkout via update genérico', async () => {
      const record = createSampleV1Record({
        id: 'trans_block_generic',
        future_provider_checkout_id: 'chk_fut_1',
      });
      await repo.createTransitionAndClaimSlot(record);

      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          future_provider_checkout_id: 'chk_fut_2',
        })
      ).rejects.toThrow(/Substituição de 'future_provider_checkout_id'.*não permitida via update genérico/i);
    });

    it('deve PERMITIR rotação de checkout expirado de future authorization via recordNewCheckoutAttempt', async () => {
      const record = createSampleV1Record({
        id: 'trans_rotate_future',
        future_provider_checkout_id: 'chk_fut_orig',
      });
      await repo.createTransitionAndClaimSlot(record);

      const newAttempt: BillingCheckoutAttempt = {
        attempt_id: 'att_fut_new',
        transition_id: record.id,
        attempt_type: 'future_authorization',
        internal_checkout_intent_id: 'intent_fut_new',
        provider_checkout_id: 'chk_fut_new',
        amount_cents: 8990,
        currency: 'BRL',
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      const updated = await repo.recordNewCheckoutAttempt(record.id, record.ministry_id, newAttempt);
      expect(updated.future_provider_checkout_id).toBe('chk_fut_new');
      expect(updated.current_future_checkout_attempt_id).toBe('att_fut_new');
      expect(updated.checkout_attempts?.length).toBe(1);
    });
  });

  describe('4. Permanent Provider References Write-Once', () => {
    it('deve REJEITAR substituição de provider_customer_id, old_provider_subscription_id e confirmed payment', async () => {
      const record = createSampleV1Record({
        id: 'trans_perm_wo',
        provider_customer_id: 'cus_can_1',
        old_provider_subscription_id: 'sub_old_1',
        early_activation_provider_payment_id: 'pay_ea_confirmed',
      });
      await repo.createTransitionAndClaimSlot(record);

      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          provider_customer_id: 'cus_can_2',
        })
      ).rejects.toThrow(/Campo write-once permanente 'provider_customer_id' não pode ser substituído/i);

      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          old_provider_subscription_id: 'sub_old_2',
        })
      ).rejects.toThrow(/Campo write-once permanente 'old_provider_subscription_id' não pode ser substituído/i);

      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          early_activation_provider_payment_id: 'pay_ea_replaced',
        })
      ).rejects.toThrow(/Campo write-once permanente 'early_activation_provider_payment_id' não pode ser substituído/i);
    });
  });

  describe('5. Slot Key Deterministic & Whitespace Rejection', () => {
    it('deve REJEITAR ministry_id com espaços externos para garantir bijeção formal', () => {
      expect(() => buildActiveTransitionSlotId('  min_1', 'asaas')).toThrow(
        /não pode conter espaços em branco nas extremidades/i
      );
      expect(() => buildActiveTransitionSlotId('min_1  ', 'asaas')).toThrow(
        /não pode conter espaços em branco nas extremidades/i
      );
    });

    it('deve gerar IDs determinísticos e livres de colisão para IDs canônicos', () => {
      const slot1 = buildActiveTransitionSlotId('abc', 'asaas');
      const slot2 = buildActiveTransitionSlotId('abc_def', 'asaas');
      const slot3 = buildActiveTransitionSlotId('abc__asaas', 'mock');

      expect(slot1).toBe('slot_abc__asaas');
      expect(slot2).toBe('slot_abc_def__asaas');
      expect(slot3).toBe('slot_abc__asaas__mock');
      expect(slot1).not.toBe(slot2);
      expect(slot1).not.toBe(slot3);
    });
  });

  describe('6. Strategy-Specific Invariants & State Machine Validation', () => {
    it('immediate_initial_purchase: aceita source Free, períodos nulos e pending_initial_purchase', () => {
      const record = createSampleV1Record({
        execution_strategy: 'immediate_initial_purchase',
        source_plan_id: 'free',
        source_interval: 'monthly',
        source_addon_blocks: 0,
        source_current_cycle_total_cents: 0,
        source_entitlement_snapshot: { plan_id: 'free', addon_blocks: 0 },
        current_period_start: null,
        current_period_end: null,
        effective_at: null,
        effective_billing_date: null,
        transition_status: 'pending_initial_purchase',
        status: 'pending',
        early_activation_status: 'not_applicable',
        early_activation_target_entitlement_snapshot: null,
      });

      expect(() => validateBillingTransitionV1(record)).not.toThrow();
    });

    it('immediate_initial_purchase: REJEITA status de agendamento (future_target_prepared) ou early activation quote', () => {
      const record = createSampleV1Record({
        execution_strategy: 'immediate_initial_purchase',
        source_plan_id: 'free',
        current_period_start: null,
        current_period_end: null,
        transition_status: 'future_target_prepared',
        status: 'pending',
      });

      expect(() => validateBillingTransitionV1(record)).toThrow(/não é permitido para a estratégia 'immediate_initial_purchase'/i);
    });

    it('scheduled_paid_transition: REJEITA se current_period_start/end estiverem ausentes', () => {
      const record = createSampleV1Record({
        execution_strategy: 'scheduled_paid_transition',
        current_period_start: null,
        current_period_end: null,
      });

      expect(() => validateBillingTransitionV1(record)).toThrow(/exige current_period_start e current_period_end não nulos/i);
    });

    it('scheduled_paid_transition: REJEITA status de compra inicial (pending_initial_purchase)', () => {
      const record = createSampleV1Record({
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'pending_initial_purchase',
      });

      expect(() => validateBillingTransitionV1(record)).toThrow(/não é permitido para a estratégia 'scheduled_paid_transition'/i);
    });

    it('scheduled_cancel_to_free: aceita downgrade para Free e REJEITA target diferente de Free', () => {
      const record = createSampleV1Record({
        execution_strategy: 'scheduled_cancel_to_free',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
        transition_status: 'awaiting_old_inactivation',
        status: 'superseding',
        early_activation_status: 'not_applicable',
        early_activation_target_entitlement_snapshot: null,
      });

      expect(() => validateBillingTransitionV1(record)).not.toThrow();

      const invalidTarget = { ...record, target_plan_id: 'pro' as any, requested_plan_id: 'pro' as any };
      expect(() => validateBillingTransitionV1(invalidTarget)).toThrow(/exige target_plan_id === 'free'/i);
    });
  });

  describe('7. Immutability of execution_strategy', () => {
    it('deve REJEITAR alteração de execution_strategy após a criação', async () => {
      const record = createSampleV1Record({
        id: 'trans_immut_strat',
        execution_strategy: 'scheduled_paid_transition',
      });
      await repo.createTransitionAndClaimSlot(record);

      await expect(
        repo.updateTransition(record.id, record.ministry_id, {
          execution_strategy: 'immediate_initial_purchase' as any,
        })
      ).rejects.toThrow(/Campo imutável 'execution_strategy' não pode ser modificado/i);
    });
  });

  describe('8. Domain-to-Persistence Mapper (buildBillingTransitionV1Record)', () => {
    it('deve mapear Free -> Lite em um BillingTransitionV1Record válido com immediate_initial_purchase', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
        { plan_id: 'lite', interval: 'monthly', addon_blocks: 0 },
        { requestedAt: '2026-09-01T15:00:00.000Z' }
      );

      const record = buildBillingTransitionV1Record({
        transitionId: 'trans_init_1',
        ministryId: 'min_test_1',
        provider: 'asaas',
        commercialSnapshot: snapshot,
        requestedByUserId: 'usr_1',
      });

      expect(record.execution_strategy).toBe('immediate_initial_purchase');
      expect(record.transition_status).toBe('pending_initial_purchase');
      expect(record.status).toBe('pending');
      expect(record.source_plan_id).toBe('free');
      expect(record.current_period_start).toBeNull();
      expect(record.current_period_end).toBeNull();
      expect(record.early_activation_status).toBe('not_applicable');
    });

    it('deve mapear Essential -> Pro em um BillingTransitionV1Record válido com scheduled_paid_transition', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'essential',
          interval: 'monthly',
          addon_blocks: 0,
          current_period_start: '2026-09-01',
          current_period_end: '2026-10-01',
        },
        { plan_id: 'pro', interval: 'monthly', addon_blocks: 0 },
        { requestedAt: '2026-09-01T15:00:00.000Z' }
      );

      const record = buildBillingTransitionV1Record({
        transitionId: 'trans_sched_1',
        ministryId: 'min_test_1',
        provider: 'asaas',
        commercialSnapshot: snapshot,
        oldProviderSubscriptionId: 'sub_old_123',
      });

      expect(record.execution_strategy).toBe('scheduled_paid_transition');
      expect(record.transition_status).toBe('pending_future_authorization');
      expect(record.early_activation_status).toBe('available');
      expect(record.current_period_start).toBeDefined();
      expect(record.current_period_end).toBeDefined();
    });

    it('deve mapear Pro -> Free em um BillingTransitionV1Record válido com scheduled_cancel_to_free', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'pro',
          interval: 'monthly',
          addon_blocks: 0,
          current_period_start: '2026-09-01',
          current_period_end: '2026-10-01',
        },
        { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
        { requestedAt: '2026-09-01T15:00:00.000Z' }
      );

      const record = buildBillingTransitionV1Record({
        transitionId: 'trans_cancel_1',
        ministryId: 'min_test_1',
        provider: 'asaas',
        commercialSnapshot: snapshot,
        oldProviderSubscriptionId: 'sub_pro_123',
      });

      expect(record.execution_strategy).toBe('scheduled_cancel_to_free');
      expect(record.transition_status).toBe('awaiting_old_inactivation');
      expect(record.early_activation_status).toBe('not_applicable');
    });
  });

  describe('claimTransitionForReconciliation — V1 Locking Semantics (Phase 3B.3)', () => {
    const baseV1: any = {
      id: 'tr_test_claim_1',
      transition_id: 'tr_test_claim_1',
      policy_version: 'billing_transition_v1',
      ministry_id: 'min_test_1',
      provider: 'asaas',
      currency: 'BRL',
      execution_strategy: 'scheduled_paid_transition',
      early_activation_status: 'available',
      financial_safety_status: 'live',
      transition_status: 'scheduled',
      supersede_status: 'completed',
      source_plan_id: 'lite',
      source_interval: 'monthly',
      source_addon_blocks: 0,
      target_plan_id: 'essential',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      effective_billing_date: '2026-10-02',
      created_at: '2026-09-02T12:00:00.000Z',
      updated_at: '2026-09-02T12:00:00.000Z',
    };

    it('A) deve permitir claim quando transition_status=scheduled e supersede_status=completed (não bloqueia por subfluxo)', async () => {
      planChangesStore.set(baseV1.id, { ...baseV1 });
      const claimed = await repo.claimTransitionForReconciliation(baseV1.id, 'worker_1', 60000);

      expect(claimed).not.toBeNull();
      expect(claimed?.retry_locked_by).toBe('worker_1');
      expect(claimed?.retry_count).toBe(1);
    });

    it('B) deve recusar claim quando transição for terminal segura (completed + safe_terminal)', async () => {
      planChangesStore.set(baseV1.id, {
        ...baseV1,
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
      });
      const claimed = await repo.claimTransitionForReconciliation(baseV1.id, 'worker_1', 60000);

      expect(claimed).toBeNull();
    });

    it('C) HARD BLOCK: deve recusar claim quando financial_attention_required=true', async () => {
      planChangesStore.set(baseV1.id, {
        ...baseV1,
        financial_attention_required: true,
        financial_attention_reason: 'TEST_MANUAL_INTERVENTION_NEEDED',
      });
      const claimed = await repo.claimTransitionForReconciliation(baseV1.id, 'worker_1', 60000);

      expect(claimed).toBeNull();
    });

    it('D) deve recusar claim (concorrência) quando outro worker tiver lease ativo', async () => {
      planChangesStore.set(baseV1.id, {
        ...baseV1,
        retry_locked_by: 'worker_other',
        retry_locked_until: new Date(Date.now() + 30000).toISOString(),
      });
      const claimed = await repo.claimTransitionForReconciliation(baseV1.id, 'worker_my', 60000);

      expect(claimed).toBeNull();
    });

    it('E) deve permitir claim (recuperação) quando lease anterior estiver expirado', async () => {
      planChangesStore.set(baseV1.id, {
        ...baseV1,
        retry_locked_by: 'worker_crashed',
        retry_locked_until: new Date(Date.now() - 5000).toISOString(), // expirado
      });
      const claimed = await repo.claimTransitionForReconciliation(baseV1.id, 'worker_recovery', 60000);

      expect(claimed).not.toBeNull();
      expect(claimed?.retry_locked_by).toBe('worker_recovery');
    });

    it('F) deve permitir que o mesmo worker renove o lease de forma idempotente', async () => {
      planChangesStore.set(baseV1.id, {
        ...baseV1,
        retry_locked_by: 'worker_same',
        retry_locked_until: new Date(Date.now() + 10000).toISOString(),
      });
      const claimed = await repo.claimTransitionForReconciliation(baseV1.id, 'worker_same', 60000);

      expect(claimed).not.toBeNull();
      expect(claimed?.retry_locked_by).toBe('worker_same');
    });
  });

  describe('BillingSubscription Canonical Key Authority, Roundtrip & Dual-Key Safety (Phase 3B.3 Fix)', () => {
    const baseSubInput: any = {
      ministry_id: 'min_test_canonical',
      provider: 'asaas',
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_asaas_001',
      provider_customer_id: 'cus_asaas_001',
      amount_cents: 3490,
      current_period_start: '2026-09-02T12:00:00.000Z',
      current_period_end: '2026-10-02T12:00:00.000Z',
    };

    it('1. Roundtrip: setSubscription normaliza chave canônica min_x_asaas e getSubscription recupera exatamente o mesmo registro', async () => {
      await repo.setSubscription(baseSubInput);

      const result = await repo.getSubscription('min_test_canonical', 'asaas');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('min_test_canonical_asaas');
      expect(result?.provider_subscription_id).toBe('sub_asaas_001');
      expect(subscriptionsStore.has('min_test_canonical_asaas')).toBe(true);
    });

    it('2. Caller não consegue forçar chave invertida: setSubscription com id asaas_min_x grava sob min_x_asaas', async () => {
      await repo.setSubscription({
        ...baseSubInput,
        id: 'asaas_min_test_canonical', // Caller tentando forçar id invertido
      });

      expect(subscriptionsStore.has('asaas_min_test_canonical')).toBe(false);
      expect(subscriptionsStore.has('min_test_canonical_asaas')).toBe(true);

      const result = await repo.getSubscription('min_test_canonical', 'asaas');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('min_test_canonical_asaas');
    });

    it('3. Dual-key: quando apenas registro legado/invertido existe, getSubscription recupera e normaliza id canônico', async () => {
      subscriptionsStore.set('asaas_min_only_legacy', {
        ...baseSubInput,
        id: 'asaas_min_only_legacy',
        ministry_id: 'min_only_legacy',
      });

      const result = await repo.getSubscription('min_only_legacy', 'asaas');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('min_only_legacy_asaas');
      expect(result?.ministry_id).toBe('min_only_legacy');
    });

    it('4. Dual-key: quando ambos existem e apontam para a mesma assinatura do provedor, canônico prevalece', async () => {
      subscriptionsStore.set('min_both_asaas', {
        ...baseSubInput,
        id: 'min_both_asaas',
        ministry_id: 'min_both',
        provider_subscription_id: 'sub_shared_123',
      });
      subscriptionsStore.set('asaas_min_both', {
        ...baseSubInput,
        id: 'asaas_min_both',
        ministry_id: 'min_both',
        provider_subscription_id: 'sub_shared_123',
      });

      const result = await repo.getSubscription('min_both', 'asaas');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('min_both_asaas');
    });

    it('5. Dual-key: quando um é active e o outro canceled, o active prevalece', async () => {
      subscriptionsStore.set('min_both_asaas', {
        ...baseSubInput,
        id: 'min_both_asaas',
        ministry_id: 'min_both',
        provider_subscription_id: 'sub_target_active',
        status: 'active',
      });
      subscriptionsStore.set('asaas_min_both', {
        ...baseSubInput,
        id: 'asaas_min_both',
        ministry_id: 'min_both',
        provider_subscription_id: 'sub_source_old',
        status: 'canceled',
      });

      const result = await repo.getSubscription('min_both', 'asaas');
      expect(result).not.toBeNull();
      expect(result?.provider_subscription_id).toBe('sub_target_active');
    });

    it('6. Dual-key conflict safety: ambos ativos com assinaturas diferentes gera FAIL-CLOSED com AppError 500', async () => {
      subscriptionsStore.set('min_divergent_asaas', {
        ...baseSubInput,
        id: 'min_divergent_asaas',
        ministry_id: 'min_divergent',
        provider_subscription_id: 'sub_sub_A',
        status: 'active',
      });
      subscriptionsStore.set('asaas_min_divergent', {
        ...baseSubInput,
        id: 'asaas_min_divergent',
        ministry_id: 'min_divergent',
        provider_subscription_id: 'sub_sub_B',
        status: 'active',
      });

      await expect(repo.getSubscription('min_divergent', 'asaas')).rejects.toThrow(
        /DUAL_KEY_FINANCIAL_CONFLICT/
      );
    });

    it('7. Identity Immutability: setSubscription recusa merge se ministry_id ou provider divergir do existente', async () => {
      (repo as any).subscriptionsCollection = {
        doc: (id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min_divergent', provider: 'asaas' }),
          }),
          set: vi.fn(),
        }),
      };

      await expect(
        repo.setSubscription({
          ...baseSubInput,
          ministry_id: 'min_new',
          provider: 'asaas',
        })
      ).rejects.toThrow(/IDENTITY IMMUTABILITY VIOLATION/);
    });
  });
});
