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
  buildBillingSubscriptionId,
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
  const ministrySubscriptionsStore = new Map<string, any>();

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
    ministrySubscriptionsStore.clear();
    repo = new BillingRepository();

    // Mock Firestore collections
    (repo as any).ministrySubscriptionsCollection = {
      doc: (id: string) => ({
        id,
        collectionName: 'ministry_subscriptions',
        get: vi.fn().mockImplementation(async () => {
          const data = ministrySubscriptionsStore.get(id);
          return { exists: Boolean(data), data: () => data };
        }),
        set: vi.fn().mockImplementation(async (data: any, options?: any) => {
          if (options?.merge && ministrySubscriptionsStore.has(id)) {
            ministrySubscriptionsStore.set(id, { ...ministrySubscriptionsStore.get(id)!, ...data });
          } else {
            ministrySubscriptionsStore.set(id, data);
          }
        }),
      }),
    };

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
          } else if (docRef.collectionName === 'billing_subscriptions') {
            const data = subscriptionsStore.get(docRef.id);
            return { exists: Boolean(data), data: () => data };
          } else if (docRef.collectionName === 'ministry_subscriptions' || docRef.id.startsWith('min_')) {
            const data = ministrySubscriptionsStore.get(docRef.id);
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
          } else if (docRef.collectionName === 'billing_subscriptions') {
            if (options?.merge && subscriptionsStore.has(docRef.id)) {
              subscriptionsStore.set(docRef.id, { ...subscriptionsStore.get(docRef.id)!, ...data });
            } else {
              subscriptionsStore.set(docRef.id, data);
            }
          } else if (docRef.collectionName === 'ministry_subscriptions' || docRef.id.startsWith('min_')) {
            if (options?.merge && ministrySubscriptionsStore.has(docRef.id)) {
              ministrySubscriptionsStore.set(docRef.id, { ...ministrySubscriptionsStore.get(docRef.id)!, ...data });
            } else {
              ministrySubscriptionsStore.set(docRef.id, data);
            }
          } else {
            if (options?.merge && planChangesStore.has(docRef.id)) {
              planChangesStore.set(docRef.id, { ...planChangesStore.get(docRef.id)!, ...data });
            } else {
              planChangesStore.set(docRef.id, data);
            }
          }
        }),
        update: vi.fn().mockImplementation((docRef: any, data: any) => {
          if (docRef.collectionName === 'billing_subscriptions') {
            if (subscriptionsStore.has(docRef.id)) {
              subscriptionsStore.set(docRef.id, { ...subscriptionsStore.get(docRef.id)!, ...data });
            }
          } else if (docRef.collectionName === 'ministry_subscriptions' || docRef.id.startsWith('min_')) {
            if (ministrySubscriptionsStore.has(docRef.id)) {
              ministrySubscriptionsStore.set(docRef.id, { ...ministrySubscriptionsStore.get(docRef.id)!, ...data });
            }
          } else if (docRef.collectionName === 'billing_active_transition_slots' || docRef.id.startsWith('slot_')) {
            if (activeSlotsStore.has(docRef.id)) {
              activeSlotsStore.set(docRef.id, { ...activeSlotsStore.get(docRef.id)!, ...data });
            }
          } else {
            if (planChangesStore.has(docRef.id)) {
              planChangesStore.set(docRef.id, { ...planChangesStore.get(docRef.id)!, ...data });
            }
          }
        }),
        delete: vi.fn().mockImplementation((docRef: any) => {
          if (docRef.collectionName === 'billing_active_transition_slots' || docRef.id.startsWith('slot_')) {
            activeSlotsStore.delete(docRef.id);
          } else if (docRef.collectionName === 'billing_subscriptions') {
            subscriptionsStore.delete(docRef.id);
          } else if (docRef.collectionName === 'ministry_subscriptions' || docRef.id.startsWith('min_')) {
            ministrySubscriptionsStore.delete(docRef.id);
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

  describe('Phase 3C.2 — Early Activation Repository Operations (Reservation, Creation, Failure, Quarantine)', () => {
    const createBaseScheduledTransition = (): BillingTransitionV1Record => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const quoteExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const quote: BillingEarlyActivationQuote = {
        quote_id: 'quote_ea_001',
        transition_id: 'tr_scheduled_ea_1',
        ministry_id: 'min_ea_test',
        source_current_cycle_total_cents: 3490,
        target_current_cycle_total_cents: 8990,
        price_delta_cents: 5500,
        total_days: 30,
        remaining_days: 15,
        prorated_adjustment_cents: 2750,
        currency: 'BRL',
        priced_at: new Date().toISOString(),
        quote_effective_billing_date: '2026-10-01',
        expires_at: quoteExpires,
        status: 'active',
        calculation_version: 'proration_v1',
      };

      const base = createSampleV1Record({
        id: 'tr_scheduled_ea_1',
        transition_id: 'tr_scheduled_ea_1',
        ministry_id: 'min_ea_test',
        transition_status: 'scheduled',
        status: 'payment_confirmed',
        supersede_status: 'completed',
        payment_cleanup_status: 'completed',
        financial_safety_status: 'live',
        effective_billing_date: '2026-10-01',
        current_early_activation_quote: quote,
        early_activation_quotes_history: [quote],
        early_activation_status: 'available',
      });

      planChangesStore.set(base.id, base);
      return base;
    };

    it('1. reserveEarlyActivationCheckoutAttempt: reserva atômica consome quote e cria tentativa local pending', async () => {
      const base = createBaseScheduledTransition();

      const result = await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_100',
        internalCheckoutIntentId: 'intent_ea_100',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      expect(result.transition.early_activation_status).toBe('payment_pending');
      expect(result.transition.current_early_activation_checkout_attempt_id).toBe('att_ea_100');
      expect(result.transition.early_activation_checkout_intent_id).toBe('intent_ea_100');
      expect(result.transition.early_activation_provider_checkout_id).toBeNull();
      expect(result.transition.current_early_activation_quote?.status).toBe('consumed');

      // Attempt local
      expect(result.attempt.attempt_id).toBe('att_ea_100');
      expect(result.attempt.status).toBe('pending');
      expect(result.attempt.provider_checkout_id).toBeNull();
      expect(result.attempt.amount_cents).toBe(2750);
      expect(result.attempt.provider_session_terminal).toBe(false);
    });

    it('2. reserveEarlyActivationCheckoutAttempt: falha fechada se cotação não for ativa', async () => {
      const base = createBaseScheduledTransition();
      base.current_early_activation_quote!.status = 'consumed';
      planChangesStore.set(base.id, base);

      await expect(
        repo.reserveEarlyActivationCheckoutAttempt({
          transitionId: base.id,
          ministryId: base.ministry_id,
          quoteId: 'quote_ea_001',
          attemptId: 'att_ea_101',
          internalCheckoutIntentId: 'intent_ea_101',
          amountCents: 2750,
          checkoutMinutesToExpire: 45,
          quoteExpiresAt: base.current_early_activation_quote!.expires_at,
        })
      ).rejects.toThrow(/não pode ser consumida/);
    });

    it('3. reserveEarlyActivationCheckoutAttempt: bloqueia segunda reserva simultânea (one-live-obligation)', async () => {
      const base = createBaseScheduledTransition();

      // Primeira reserva
      await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_first',
        internalCheckoutIntentId: 'intent_ea_first',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      // Segunda chamada concorrente tenta reservar: DEVE FALHAR com 409
      await expect(
        repo.reserveEarlyActivationCheckoutAttempt({
          transitionId: base.id,
          ministryId: base.ministry_id,
          quoteId: 'quote_ea_001',
          attemptId: 'att_ea_second',
          internalCheckoutIntentId: 'intent_ea_second',
          amountCents: 2750,
          checkoutMinutesToExpire: 45,
          quoteExpiresAt: base.current_early_activation_quote!.expires_at,
        })
      ).rejects.toThrow(/Já existe uma obrigação financeira de ativação antecipada/);
    });

    it('4. recordEarlyActivationCheckoutCreated: grava provider_checkout_id de forma write-once', async () => {
      const base = createBaseScheduledTransition();

      await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_created',
        internalCheckoutIntentId: 'intent_ea_created',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      const updated = await repo.recordEarlyActivationCheckoutCreated({
        transitionId: base.id,
        ministryId: base.ministry_id,
        attemptId: 'att_ea_created',
        providerCheckoutId: 'chk_asaas_live_123',
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_asaas_live_123',
      });

      expect(updated.early_activation_provider_checkout_id).toBe('chk_asaas_live_123');
      expect(updated.checkout_url).toBe('https://sandbox.asaas.com/c/chk_asaas_live_123');

      const attempt = updated.checkout_attempts?.find((a) => a.attempt_id === 'att_ea_created');
      expect(attempt?.provider_checkout_id).toBe('chk_asaas_live_123');

      // Idempotência permitida se for o mesmo providerCheckoutId
      await expect(
        repo.recordEarlyActivationCheckoutCreated({
          transitionId: base.id,
          ministryId: base.ministry_id,
          attemptId: 'att_ea_created',
          providerCheckoutId: 'chk_asaas_live_123',
          checkoutUrl: 'https://sandbox.asaas.com/c/chk_asaas_live_123',
        })
      ).resolves.toBeDefined();

      // Conflito write-once se tentar gravar ID divergente: DEVE FALHAR FECHADO com 409
      await expect(
        repo.recordEarlyActivationCheckoutCreated({
          transitionId: base.id,
          ministryId: base.ministry_id,
          attemptId: 'att_ea_created',
          providerCheckoutId: 'chk_asaas_OTHER_456',
          checkoutUrl: 'https://sandbox.asaas.com/c/chk_asaas_OTHER_456',
        })
      ).rejects.toThrow(/Conflito financeiro write-once/);
    });

    it('5. markEarlyActivationCheckoutCreationFailed: libera status para available se criação falhou antes de obrigação', async () => {
      const base = createBaseScheduledTransition();

      await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_failed',
        internalCheckoutIntentId: 'intent_ea_failed',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      const updated = await repo.markEarlyActivationCheckoutCreationFailed({
        transitionId: base.id,
        ministryId: base.ministry_id,
        attemptId: 'att_ea_failed',
        failureClassification: 'creation_failed_before_provider_obligation',
      });

      // Subfluxo reaberto para permitir nova tentativa
      expect(updated.early_activation_status).toBe('available');

      const attempt = updated.checkout_attempts?.find((a) => a.attempt_id === 'att_ea_failed');
      expect(attempt?.status).toBe('failed');
      expect(attempt?.failure_classification).toBe('creation_failed_before_provider_obligation');
      expect(attempt?.provider_session_terminal).toBe(false);

      // Quote consumida permanece imutável no histórico
      expect(updated.current_early_activation_quote?.status).toBe('consumed');
    });

    it('6. markEarlyActivationCheckoutCreateUncertain: quarentena mantém payment_pending e provider_session_terminal false', async () => {
      const base = createBaseScheduledTransition();

      await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_unc',
        internalCheckoutIntentId: 'intent_ea_unc',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      const updated = await repo.markEarlyActivationCheckoutCreateUncertain({
        transitionId: base.id,
        ministryId: base.ministry_id,
        attemptId: 'att_ea_unc',
        uncertainUntil: '2026-09-15T23:59:59.000Z',
      });

      expect(updated.early_activation_status).toBe('payment_pending');

      const attempt = updated.checkout_attempts?.find((a) => a.attempt_id === 'att_ea_unc');
      expect(attempt?.status).toBe('uncertain');
      expect(attempt?.failure_classification).toBe('unknown');
      expect(attempt?.uncertain_until).toBe('2026-09-15T23:59:59.000Z');
      expect(attempt?.provider_session_terminal).toBe(false);
      expect(attempt?.provider_create_state).toBe('uncertain');
    });

    it('7. markEarlyActivationCheckoutAttempting: CAS transiciona reserved -> attempting com sucesso', async () => {
      const base = createBaseScheduledTransition();

      await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_cas',
        internalCheckoutIntentId: 'intent_ea_cas',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      const updated = await repo.markEarlyActivationCheckoutAttempting({
        transitionId: base.id,
        ministryId: base.ministry_id,
        attemptId: 'att_ea_cas',
      });

      const attempt = updated.checkout_attempts?.find((a) => a.attempt_id === 'att_ea_cas');
      expect(attempt?.provider_create_state).toBe('attempting');
    });

    it('8. markEarlyActivationCheckoutAttempting: rejeita com 409 ATTEMPT_NOT_RESERVED se já estiver em attempting', async () => {
      const base = createBaseScheduledTransition();

      await repo.reserveEarlyActivationCheckoutAttempt({
        transitionId: base.id,
        ministryId: base.ministry_id,
        quoteId: 'quote_ea_001',
        attemptId: 'att_ea_cas2',
        internalCheckoutIntentId: 'intent_ea_cas2',
        amountCents: 2750,
        checkoutMinutesToExpire: 45,
        quoteExpiresAt: base.current_early_activation_quote!.expires_at,
      });

      await repo.markEarlyActivationCheckoutAttempting({
        transitionId: base.id,
        ministryId: base.ministry_id,
        attemptId: 'att_ea_cas2',
      });

      // Segunda chamada com a mesma attempt falha o CAS
      await expect(
        repo.markEarlyActivationCheckoutAttempting({
          transitionId: base.id,
          ministryId: base.ministry_id,
          attemptId: 'att_ea_cas2',
        })
      ).rejects.toThrow(/não está no estado 'reserved'/);
    });
  });

  describe('completeTransitionAndReleaseOwnedSlotAtomically — Final Authority & Preconditions', () => {
    // Fábrica scoped: garante execution_strategy correto para este helper (Phase 3D.3B.1).
    // NÃO altera createSampleV1Record (usada por outros describe blocks com scheduled_paid_transition).
    const createCtfRecord = (overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record =>
      createSampleV1Record({
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        ...overrides,
      });

    it('1. fail closed se transição não existir', async () => {
      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', 'tr_non_existent', {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transition_not_found');
    });

    it('2. fail closed se houver tenant mismatch', async () => {
      const record = createCtfRecord({ id: 'tr_tenant_1', ministry_id: 'min_tenant_A' });
      planChangesStore.set(record.id, record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_tenant_B', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('tenant_mismatch');
    });

    it('3. fail closed se transição estiver com financial_attention_required', async () => {
      const record = createCtfRecord({
        id: 'tr_atten_1',
        ministry_id: 'min_test_1',
        financial_attention_required: true,
      });
      planChangesStore.set(record.id, record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('4. fail closed se financial_safety_status for attention_required', async () => {
      const record = createCtfRecord({
        id: 'tr_atten_2',
        ministry_id: 'min_test_1',
        financial_safety_status: 'attention_required' as any,
      });
      planChangesStore.set(record.id, record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('5. fail closed se assinatura do ministério não existir em ministry_subscriptions', async () => {
      const record = createCtfRecord({ id: 'tr_no_sub', ministry_id: 'min_test_1' });
      planChangesStore.set(record.id, record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_not_found');
    });

    it('6. fail closed se slot não existir no fluxo normal', async () => {
      const record = createCtfRecord({ id: 'tr_no_slot', ministry_id: 'min_test_1' });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('slot_not_found');
    });

    it('7. fail closed se slot pertencer a outra transição', async () => {
      const record = createCtfRecord({ id: 'tr_my_tx', ministry_id: 'min_test_1' });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });

      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: 'tr_other_tx',
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('slot_owned_by_another_transition');
    });

    it('8. [3D.3B.1] fail closed: execution_strategy=scheduled_paid_transition → unsupported_transition_strategy (strategy gate)', async () => {
      // Prova que outras estratégias V1 vivas não herdam semânticas de cancellation marker.
      // O strategy gate (precondição 0) rejeita antes de qualquer operação de slot ou marker.
      const record = createSampleV1Record({
        id: 'tr_paid_transition',
        ministry_id: 'min_test_1',
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: null });

      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');

      // Zero mutações: slot intacto, marker intacto
      expect(activeSlotsStore.has(slotId)).toBe(true);
      expect(ministrySubscriptionsStore.get('min_test_1')?.active_cancellation_transition_id).toBeNull();
    });

    it('9. sucesso normal: atualiza transição para completed/safe_terminal, deleta slot e limpa marker na sub atomicamente', async () => {
      const record = createCtfRecord({
        id: 'tr_success_term',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', {
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: true,
      });

      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {
        completed_at: '2026-10-01T15:00:00.000Z',
      });

      expect(res.success).toBe(true);

      // 1. Transição atualizada
      const updatedTx = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(updatedTx?.transition_status).toBe('completed');
      expect(updatedTx?.financial_safety_status).toBe('safe_terminal');
      expect(updatedTx?.completed_at).toBe('2026-10-01T15:00:00.000Z');

      // 2. Slot deletado
      expect(activeSlotsStore.has(slotId)).toBe(false);

      // 3. Marker da subscription limpo
      const updatedSub = ministrySubscriptionsStore.get('min_test_1');
      expect(updatedSub?.active_cancellation_transition_id).toBeNull();
      expect(updatedSub?.cancel_at_period_end).toBe(false);
    });

    it('10. idempotência: transição já completed e safe_terminal retorna sucesso e repara anomalia de slot se ainda detido', async () => {
      const record = createCtfRecord({
        id: 'tr_already_done',
        ministry_id: 'min_test_1',
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', {
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: false,
      });

      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(true);
      expect(res.reason).toBe('already_completed');

      // Slot foi liberado na reparação
      expect(activeSlotsStore.has(slotId)).toBe(false);
      // Marker foi limpo
      const updatedSub = ministrySubscriptionsStore.get('min_test_1');
      expect(updatedSub?.active_cancellation_transition_id).toBeNull();
    });
    // -----------------------------------------------------------------------
    // Phase 3D.3B.1 / 3D.3B.2 — Cancel-to-Free Strategy Isolation,
    // Strict Marker CAS & Terminal Source State Machine Gate
    //
    // Helper aceita APENAS dois caminhos:
    //   1. NORMAL: scheduled_cancel_to_free + scheduled/live + correct marker → terminalize
    //   2. IDEMPOTENCY: scheduled_cancel_to_free + completed/safe_terminal → repair
    //
    // Todos os outros statuses (awaiting, failed, canceled, superseded, attention) → FAIL CLOSED.
    // -----------------------------------------------------------------------

    const buildSlotForRecord = (record: BillingTransitionV1Record) => {
      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });
      return slotId;
    };

    it('11. [3D.3B.1] fail closed: scheduled_cancel_to_free + transition_status=scheduled + marker null', async () => {
      const record = createCtfRecord({
        id: 'tr_3d3b_null',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: null });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_missing_or_divergent');
    });

    it('12. [3D.3B.1] fail closed: scheduled_cancel_to_free + transition_status=scheduled + marker string vazia', async () => {
      const record = createCtfRecord({
        id: 'tr_3d3b_empty',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: '' });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_missing_or_divergent');
    });

    it('13. [3D.3B.1] fail closed: scheduled_cancel_to_free + transition_status=scheduled + marker undefined (campo ausente)', async () => {
      const record = createCtfRecord({
        id: 'tr_3d3b_undef',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      // active_cancellation_transition_id propositalmente ausente do documento
      ministrySubscriptionsStore.set('min_test_1', { cancel_at_period_end: true });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_missing_or_divergent');
    });

    it('14. [3D.3B.2] fail closed: scheduled_cancel_to_free + transition_status=awaiting_old_inactivation → invalid_terminalization_source_status', async () => {
      // awaiting_old_inactivation: DO-NOT-RENEW safety ainda não provada.
      // Rejeição ocorre no source status gate (pré-condição 5) ANTES do marker check.
      // Mesmo com marker correto e slot correto: FAIL CLOSED.
      const record = createCtfRecord({
        id: 'tr_3d3b2_aoi',
        ministry_id: 'min_test_1',
        transition_status: 'awaiting_old_inactivation',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      // Marker correto (se chegasse ao check, passaria — mas não deve chegar)
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');

      // Zero mutações
      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      expect(activeSlotsStore.has(slotId)).toBe(true);
      const sub = ministrySubscriptionsStore.get('min_test_1');
      expect(sub?.active_cancellation_transition_id).toBe(record.id);
      expect((planChangesStore.get(record.id) as BillingTransitionV1Record)?.transition_status).toBe('awaiting_old_inactivation');
    });

    it('15. [3D.3B.1] fail closed: scheduled_cancel_to_free + transition_status=scheduled + marker divergente (outra transição)', async () => {
      const record = createCtfRecord({
        id: 'tr_3d3b_diverge',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: 'tr_alien_other' });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_missing_or_divergent');
    });

    it('16. [3D.3B.2] fail closed: scheduled_cancel_to_free + transition_status=superseded → invalid_terminalization_source_status', async () => {
      // superseded é terminal histórico imutável — não pode ser reescrito para completed.
      // Source status gate rejeita ANTES de qualquer mutação.
      const record = createCtfRecord({
        id: 'tr_3d3b2_superseded',
        ministry_id: 'min_test_1',
        transition_status: 'superseded' as any,
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');

      // Zero mutações: histórico preservado
      expect((planChangesStore.get(record.id) as BillingTransitionV1Record)?.transition_status).toBe('superseded');
    });

    it('17. [3D.3B.1] fail closed: execution_strategy=immediate_initial_purchase → unsupported_transition_strategy', async () => {
      const record = createSampleV1Record({
        id: 'tr_initial_purchase',
        ministry_id: 'min_test_1',
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'completed' as any,
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: null });

      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');

      // Zero mutações: slot intacto
      expect(activeSlotsStore.has(slotId)).toBe(true);
    });

    it('18. [3D.3B.1] invariant: strategy gate rejeitada não muta transition, slot nem marker', async () => {
      // Prova que a rejeição por strategy gate é completamente sem efeitos colaterais.
      const record = createSampleV1Record({
        id: 'tr_isolation_guard',
        ministry_id: 'min_test_1',
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      const initialMarker = 'tr_cancel_to_free_active';
      const initialCancelAtPeriodEnd = true;
      ministrySubscriptionsStore.set('min_test_1', {
        active_cancellation_transition_id: initialMarker,
        cancel_at_period_end: initialCancelAtPeriodEnd,
      });

      const slotId = buildActiveTransitionSlotId('min_test_1', 'asaas');
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: 'min_test_1',
        provider: 'asaas',
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');

      // Slot intacto
      expect(activeSlotsStore.has(slotId)).toBe(true);
      expect(activeSlotsStore.get(slotId)?.plan_change_id).toBe(record.id);
      // Marker de cancellation intacto (a outra transição de cancellation não foi perturbada)
      const sub = ministrySubscriptionsStore.get('min_test_1');
      expect(sub?.active_cancellation_transition_id).toBe(initialMarker);
      expect(sub?.cancel_at_period_end).toBe(initialCancelAtPeriodEnd);
      // Transição intacta
      const storedTx = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(storedTx?.transition_status).toBe('scheduled');
      expect(storedTx?.financial_safety_status).toBe('live');
    });

    // -----------------------------------------------------------------------
    // Phase 3D.3B.2 — Invalid source status matrix
    // -----------------------------------------------------------------------

    it('19. [3D.3B.2] fail closed: scheduled_cancel_to_free + transition_status=failed → invalid_terminalization_source_status', async () => {
      const record = createCtfRecord({
        id: 'tr_3d3b2_failed',
        ministry_id: 'min_test_1',
        transition_status: 'failed' as any,
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');
      // Zero mutações: failed permanece failed
      expect((planChangesStore.get(record.id) as BillingTransitionV1Record)?.transition_status).toBe('failed');
    });

    it('20. [3D.3B.2] fail closed: scheduled_cancel_to_free + transition_status=canceled → invalid_terminalization_source_status', async () => {
      const record = createCtfRecord({
        id: 'tr_3d3b2_canceled',
        ministry_id: 'min_test_1',
        transition_status: 'canceled' as any,
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');
      expect((planChangesStore.get(record.id) as BillingTransitionV1Record)?.transition_status).toBe('canceled');
    });

    it('21. [3D.3B.2] fail closed: scheduled_cancel_to_free + transition_status=completed + financial_safety_status=live → invalid_terminalization_source_status', async () => {
      // completed/live é estado inconsistente — não pode usar idempotency path
      const record = createCtfRecord({
        id: 'tr_3d3b2_completed_live',
        ministry_id: 'min_test_1',
        transition_status: 'completed',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');
    });

    it('22. [3D.3B.2] fail closed: scheduled_cancel_to_free + transition_status=completed + financial_safety_status=attention_required → financial_attention_required', async () => {
      // completed + attention é estado inválido no modelo — fail closed via pré-condição 3 (financial_attention_required)
      const record = createCtfRecord({
        id: 'tr_3d3b2_completed_attn',
        ministry_id: 'min_test_1',
        transition_status: 'completed',
        financial_safety_status: 'attention_required' as any,
        financial_attention_required: true,
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('23. [3D.3B.2] idempotency variant: completed/safe_terminal + slot já ausente + marker null → already_completed', async () => {
      // Slot já limpo e marker já null: idempotência pura sem reparo
      const record = createCtfRecord({
        id: 'tr_3d3b2_idem_clean',
        ministry_id: 'min_test_1',
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      // Marker já null e slot ausente (estado pós-terminalization limpa)
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: null });
      // Sem slot no store

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(true);
      expect(res.reason).toBe('already_completed');
    });

    it('24. [3D.3B.2] invariant: invalid source status rejeita sem mutar transition, slot nem marker', async () => {
      // Prova que awaiting_old_inactivation com marker e slot corretos não muta nada
      const record = createCtfRecord({
        id: 'tr_3d3b2_zero_mut',
        ministry_id: 'min_test_1',
        transition_status: 'awaiting_old_inactivation',
        financial_safety_status: 'live',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', {
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: true,
      });
      const slotId = buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');

      // Todas as projeções intactas
      expect(activeSlotsStore.has(slotId)).toBe(true);
      expect(activeSlotsStore.get(slotId)?.plan_change_id).toBe(record.id);
      const sub = ministrySubscriptionsStore.get('min_test_1');
      expect(sub?.active_cancellation_transition_id).toBe(record.id);
      expect(sub?.cancel_at_period_end).toBe(true);
      expect((planChangesStore.get(record.id) as BillingTransitionV1Record)?.transition_status).toBe('awaiting_old_inactivation');
    });

    // -----------------------------------------------------------------------
    // Phase 3D.3B.3 — Strict financial safety source gate (scheduled + live only)
    // -----------------------------------------------------------------------

    it('25. [3D.3B.3] fail closed: scheduled_cancel_to_free + transition_status=scheduled + financial_safety_status=safe_terminal → invalid_terminalization_source_status', async () => {
      // scheduled + safe_terminal é estado inconsistente / cruzado — FAIL CLOSED
      const record = createCtfRecord({
        id: 'tr_3d3b3_sched_safe_term',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', { active_cancellation_transition_id: record.id });
      buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');
    });

    it('26. [3D.3B.3] invariant: scheduled + safe_terminal rejeita sem mutar transition, slot nem marker', async () => {
      // Prova que scheduled + safe_terminal não deleta slot, não limpa marker e não altera transição
      const record = createCtfRecord({
        id: 'tr_3d3b3_zero_mut_safe_term',
        ministry_id: 'min_test_1',
        transition_status: 'scheduled',
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(record.id, record);
      ministrySubscriptionsStore.set('min_test_1', {
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: true,
      });
      const slotId = buildSlotForRecord(record);

      const res = await repo.completeTransitionAndReleaseOwnedSlotAtomically('min_test_1', 'asaas', record.id, {});
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_terminalization_source_status');

      // Todas as projeções intactas: zero mutações
      expect(activeSlotsStore.has(slotId)).toBe(true);
      expect(activeSlotsStore.get(slotId)?.plan_change_id).toBe(record.id);
      const sub = ministrySubscriptionsStore.get('min_test_1');
      expect(sub?.active_cancellation_transition_id).toBe(record.id);
      expect(sub?.cancel_at_period_end).toBe(true);
      const storedTx = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(storedTx?.transition_status).toBe('scheduled');
      expect(storedTx?.financial_safety_status).toBe('safe_terminal');
    });
  });

  // ==========================================================================
  // Phase 4A.4.1 Cancellation Reversal Persistence Primitives & Validation
  // ==========================================================================

  describe('validateBillingTransitionV1 — Cancellation Reversal Subworkflow Fields (Phase 4A.4.1)', () => {
    const createBaseCtfRecord = (): BillingTransitionV1Record =>
      createSampleV1Record({
        id: 'tr_ctf_val_1',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        status: 'payment_confirmed',
        financial_safety_status: 'live',
        effective_at: '2026-10-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
      });

    it('1. aceita transição scheduled_cancel_to_free sem campos de reversão (backward compatibility)', () => {
      const record = createBaseCtfRecord();
      expect(() => validateBillingTransitionV1(record)).not.toThrow();
    });

    it('2. aceita subworkflow com status "requested" e timestamp ISO válido', () => {
      const record = createBaseCtfRecord();
      record.cancellation_reversal_status = 'requested';
      record.cancellation_reversal_requested_at = '2026-09-15T10:00:00.000Z';
      record.cancellation_reversal_requested_by = 'usr_admin_123';
      expect(() => validateBillingTransitionV1(record)).not.toThrow();
    });

    it('3. aceita subworkflow com status "completed" e timestamp ISO válido', () => {
      const record = createBaseCtfRecord();
      record.transition_status = 'canceled';
      record.status = 'canceled';
      record.financial_safety_status = 'safe_terminal';
      record.cancellation_reversal_status = 'completed';
      record.cancellation_reversal_completed_at = '2026-09-15T10:05:00.000Z';
      expect(() => validateBillingTransitionV1(record)).not.toThrow();
    });

    it('4. aceita subworkflow com status "attention_required" e razão não vazia', () => {
      const record = createBaseCtfRecord();
      record.cancellation_reversal_status = 'attention_required';
      record.cancellation_reversal_attention_reason = 'provider_reactivation_failed';
      expect(() => validateBillingTransitionV1(record)).not.toThrow();
    });

    it('5. rejeita status de reversão inválido', () => {
      const record = createBaseCtfRecord();
      (record as any).cancellation_reversal_status = 'invalid_status';
      expect(() => validateBillingTransitionV1(record)).toThrow(/cancellation_reversal_status inválido/i);
    });

    it('6. rejeita cancellation_reversal_status em immediate_initial_purchase', () => {
      const record = createSampleV1Record({
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
        status: 'pending',
        target_plan_id: 'essential',
        requested_plan_id: 'essential',
        source_plan_id: 'free',
        early_activation_status: 'not_applicable',
        cancellation_reversal_status: 'requested',
        cancellation_reversal_requested_at: '2026-09-15T10:00:00.000Z',
      });
      expect(() => validateBillingTransitionV1(record)).toThrow(/só é permitido para a estratégia 'scheduled_cancel_to_free'/i);
    });

    it('7. rejeita cancellation_reversal_status em scheduled_paid_transition', () => {
      const record = createSampleV1Record({
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
        status: 'payment_confirmed',
        effective_billing_date: '2026-10-01',
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        cancellation_reversal_status: 'requested',
        cancellation_reversal_requested_at: '2026-09-15T10:00:00.000Z',
      });
      expect(() => validateBillingTransitionV1(record)).toThrow(/só é permitido para a estratégia 'scheduled_cancel_to_free'/i);
    });

    it('8. rejeita campos de reversão avulsos em scheduled_paid_transition', () => {
      const record = createSampleV1Record({
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
        status: 'payment_confirmed',
        effective_billing_date: '2026-10-01',
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        cancellation_reversal_requested_by: 'usr_admin',
      });
      expect(() => validateBillingTransitionV1(record)).toThrow(/só são permitidos para a estratégia 'scheduled_cancel_to_free'/i);
    });

    it('9. rejeita status "requested" se cancellation_reversal_requested_at for ausente', () => {
      const record = createBaseCtfRecord();
      record.cancellation_reversal_status = 'requested';
      record.cancellation_reversal_requested_at = null;
      expect(() => validateBillingTransitionV1(record)).toThrow(/exige cancellation_reversal_requested_at ISO válido/i);
    });

    it('10. rejeita status "requested" se cancellation_reversal_requested_at for data inválida', () => {
      const record = createBaseCtfRecord();
      record.cancellation_reversal_status = 'requested';
      record.cancellation_reversal_requested_at = 'data-invalida';
      expect(() => validateBillingTransitionV1(record)).toThrow(/exige cancellation_reversal_requested_at ISO válido/i);
    });

    it('11. rejeita status "completed" se cancellation_reversal_completed_at for ausente', () => {
      const record = createBaseCtfRecord();
      record.transition_status = 'canceled';
      record.status = 'canceled';
      record.financial_safety_status = 'safe_terminal';
      record.cancellation_reversal_status = 'completed';
      record.cancellation_reversal_completed_at = null;
      expect(() => validateBillingTransitionV1(record)).toThrow(/exige cancellation_reversal_completed_at ISO válido/i);
    });

    it('12. rejeita status "completed" se cancellation_reversal_completed_at for data inválida', () => {
      const record = createBaseCtfRecord();
      record.transition_status = 'canceled';
      record.status = 'canceled';
      record.financial_safety_status = 'safe_terminal';
      record.cancellation_reversal_status = 'completed';
      record.cancellation_reversal_completed_at = 'not-a-date';
      expect(() => validateBillingTransitionV1(record)).toThrow(/exige cancellation_reversal_completed_at ISO válido/i);
    });

    it('13. rejeita status "attention_required" se cancellation_reversal_attention_reason for vazio', () => {
      const record = createBaseCtfRecord();
      record.cancellation_reversal_status = 'attention_required';
      record.cancellation_reversal_attention_reason = '   ';
      expect(() => validateBillingTransitionV1(record)).toThrow(/exige cancellation_reversal_attention_reason não vazio/i);
    });

    it('14. rejeita cancellation_reversal_requested_by se for string vazia', () => {
      const record = createBaseCtfRecord();
      record.cancellation_reversal_requested_by = '   ';
      expect(() => validateBillingTransitionV1(record)).toThrow(/deve ser uma string não vazia/i);
    });
  });

  describe('beginCancellationReversalAtomically — Phase 4A.4.1', () => {
    const createCtfRecord = (overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record =>
      createSampleV1Record({
        id: 'tr_begin_rev_1',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        status: 'payment_confirmed',
        financial_safety_status: 'live',
        effective_at: '2026-10-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
        ...overrides,
      });

    const setupValidCtfState = (overrides: Partial<BillingTransitionV1Record> = {}) => {
      const record = createCtfRecord(overrides);
      planChangesStore.set(record.id, record);

      const slotId = buildActiveTransitionSlotId(record.ministry_id, record.provider);
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: record.ministry_id,
        provider: record.provider,
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      ministrySubscriptionsStore.set(record.ministry_id, {
        id: record.ministry_id,
        plan_id: 'essential',
        addon_blocks: 0,
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: true,
        current_period_end: record.effective_at || '2026-10-01T00:00:00.000Z',
        updated_at: new Date().toISOString(),
      });

      const billingSubId = buildBillingSubscriptionId(record.ministry_id, record.provider);
      subscriptionsStore.set(billingSubId, {
        id: billingSubId,
        ministry_id: record.ministry_id,
        provider: record.provider,
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: record.effective_at || '2026-10-01T00:00:00.000Z',
        updated_at: new Date().toISOString(),
      });

      return { record, slotId, billingSubId };
    };

    it('1. fail closed se transição não existir', async () => {
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', 'tr_not_found');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transition_not_found');
    });

    it('2. fail closed em tenant mismatch', async () => {
      const { record } = setupValidCtfState({ ministry_id: 'min_tenant_A' });
      const res = await repo.beginCancellationReversalAtomically('min_tenant_B', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('tenant_mismatch');
    });

    it('3. fail closed em transição legada', async () => {
      const legacyRecord: any = { id: 'tr_legacy_1', ministry_id: 'min_test_1', policy_version: 'legacy' };
      planChangesStore.set(legacyRecord.id, legacyRecord);
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', legacyRecord.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('legacy_transition_unsupported');
    });

    it('4. fail closed se execution_strategy não for scheduled_cancel_to_free', async () => {
      const { record } = setupValidCtfState({ execution_strategy: 'scheduled_paid_transition' as any });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');
    });

    it('5. fail closed se financial_attention_required for true', async () => {
      const { record } = setupValidCtfState({ financial_attention_required: true });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('6. fail closed se financial_safety_status for attention_required', async () => {
      const { record } = setupValidCtfState({ financial_safety_status: 'attention_required' });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('7. fail closed se reversão já tiver status "completed"', async () => {
      const { record } = setupValidCtfState({ cancellation_reversal_status: 'completed' });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('reversal_already_completed');
    });

    it('8. fail closed se reversão já tiver status "attention_required"', async () => {
      const { record } = setupValidCtfState({ cancellation_reversal_status: 'attention_required' });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('reversal_attention_required');
    });

    it('9. fail closed se transition_status !== "scheduled"', async () => {
      const { record } = setupValidCtfState({ transition_status: 'awaiting_old_inactivation' });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_source_status');
    });

    it('10. fail closed se financial_safety_status !== "live"', async () => {
      const { record } = setupValidCtfState({ financial_safety_status: 'safe_terminal' });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_source_status');
    });

    it('11. fail closed se effective_at estiver ausente', async () => {
      const { record } = setupValidCtfState({ effective_at: null, current_period_end: null });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id);
      expect(res.success).toBe(false);
      expect(res.reason).toBe('missing_effective_at_boundary');
    });

    it('12. fail closed se now >= effective_at (boundary_expired)', async () => {
      const { record } = setupValidCtfState({ effective_at: '2026-10-01T00:00:00.000Z' });
      // Exato instante da fronteira
      const resExact = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-10-01T00:00:00.000Z',
      });
      expect(resExact.success).toBe(false);
      expect(resExact.reason).toBe('boundary_expired');

      // 1ms após a fronteira
      const resPast = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-10-01T00:00:00.001Z',
      });
      expect(resPast.success).toBe(false);
      expect(resPast.reason).toBe('boundary_expired');
    });

    it('13. fail closed se lease for de outro worker (lease_not_owned)', async () => {
      const { record } = setupValidCtfState({
        retry_locked_by: 'worker_alpha',
        retry_locked_until: '2026-09-20T00:00:00.000Z',
      });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
        expectedLockOwner: 'worker_beta',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('lease_not_owned');
    });

    it('14. fail closed se lease estiver expirado (lease_expired)', async () => {
      const { record } = setupValidCtfState({
        retry_locked_by: 'worker_alpha',
        retry_locked_until: '2026-09-10T00:00:00.000Z',
      });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
        expectedLockOwner: 'worker_alpha',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('lease_expired');
    });

    it('15. fail closed se slot ativo não existir', async () => {
      const { record, slotId } = setupValidCtfState();
      activeSlotsStore.delete(slotId);
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('slot_not_found');
    });

    it('16. fail closed se slot pertencer a outra transição', async () => {
      const { record, slotId } = setupValidCtfState();
      activeSlotsStore.set(slotId, { ...activeSlotsStore.get(slotId)!, plan_change_id: 'tr_other_999' });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('slot_owned_by_another_transition');
    });

    it('17. fail closed se ministry_subscriptions não existir', async () => {
      const { record } = setupValidCtfState();
      ministrySubscriptionsStore.delete('min_test_1');
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_not_found');
    });

    it('18. fail closed se marker em ministry_subscriptions for ausente ou divergente', async () => {
      const { record } = setupValidCtfState();
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: 'tr_other_divergent',
      });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_missing_or_divergent');
    });

    it('19. fail closed se cancel_at_period_end em ministry_subscriptions for false', async () => {
      const { record } = setupValidCtfState();
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        cancel_at_period_end: false,
      });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_cancel_at_period_end_false');
    });

    it('20. fail closed se billing_subscriptions não existir', async () => {
      const { record, billingSubId } = setupValidCtfState();
      subscriptionsStore.delete(billingSubId);
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('billing_subscription_not_found');
    });

    it('21. fail closed se cancel_at_period_end em billing_subscriptions for false', async () => {
      const { record, billingSubId } = setupValidCtfState();
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'user_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('billing_subscription_cancel_at_period_end_false');
    });

    it('22. caminho normal: transiciona subworkflow para "requested" de forma atômica', async () => {
      const { record, slotId, billingSubId } = setupValidCtfState();
      const res = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'usr_admin_1', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });

      expect(res.success).toBe(true);
      expect(res.transition).toBeDefined();
      expect(res.transition?.cancellation_reversal_status).toBe('requested');
      expect(res.transition?.cancellation_reversal_requested_at).toBe('2026-09-15T12:00:00.000Z');
      expect(res.transition?.cancellation_reversal_requested_by).toBe('usr_admin_1');

      // Persistência atualizada
      const stored = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(stored.cancellation_reversal_status).toBe('requested');
      expect(stored.cancellation_reversal_requested_at).toBe('2026-09-15T12:00:00.000Z');
      expect(stored.cancellation_reversal_requested_by).toBe('usr_admin_1');

      // Invariantes globais intactas: slot continua HELD, markers mantidos, entitlement inalterado
      expect(activeSlotsStore.has(slotId)).toBe(true);
      expect(ministrySubscriptionsStore.get('min_test_1')?.active_cancellation_transition_id).toBe(record.id);
      expect(ministrySubscriptionsStore.get('min_test_1')?.cancel_at_period_end).toBe(true);
      expect(subscriptionsStore.get(billingSubId)?.cancel_at_period_end).toBe(true);
      expect(stored.transition_status).toBe('scheduled');
      expect(stored.financial_safety_status).toBe('live');
    });

    it('23. idempotência: chamadas repetidas retornam reversal_already_requested sem sobrescrever requested_at', async () => {
      const { record } = setupValidCtfState();
      // Primeira chamada
      const firstRes = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'usr_first', {
        nowIso: '2026-09-15T12:00:00.000Z',
      });
      expect(firstRes.success).toBe(true);

      // Segunda chamada com outro timestamp e outro ator
      const secondRes = await repo.beginCancellationReversalAtomically('min_test_1', 'asaas', record.id, 'usr_second', {
        nowIso: '2026-09-15T13:00:00.000Z',
      });
      expect(secondRes.success).toBe(true);
      expect(secondRes.reason).toBe('reversal_already_requested');
      expect(secondRes.transition?.cancellation_reversal_status).toBe('requested');
      // Preserva o timestamp e ator originais
      expect(secondRes.transition?.cancellation_reversal_requested_at).toBe('2026-09-15T12:00:00.000Z');
      expect(secondRes.transition?.cancellation_reversal_requested_by).toBe('usr_first');
    });
  });

  describe('completeCancellationReversalAndReleaseOwnedSlotAtomically — Phase 4A.4.1', () => {
    const createCtfRecord = (overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record =>
      createSampleV1Record({
        id: 'tr_comp_rev_1',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        effective_at: '2026-10-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
        cancellation_reversal_status: 'requested',
        cancellation_reversal_requested_at: '2026-09-15T10:00:00.000Z',
        cancellation_reversal_requested_by: 'usr_admin_1',
        ...overrides,
      });

    const setupValidCtfRequestedState = (overrides: Partial<BillingTransitionV1Record> = {}) => {
      const record = createCtfRecord(overrides);
      planChangesStore.set(record.id, record);

      const slotId = buildActiveTransitionSlotId(record.ministry_id, record.provider);
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: record.ministry_id,
        provider: record.provider,
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      ministrySubscriptionsStore.set(record.ministry_id, {
        id: record.ministry_id,
        plan_id: 'essential',
        addon_blocks: 0,
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: true,
        current_period_end: record.effective_at || '2026-10-01T00:00:00.000Z',
        updated_at: new Date().toISOString(),
      });

      const billingSubId = buildBillingSubscriptionId(record.ministry_id, record.provider);
      subscriptionsStore.set(billingSubId, {
        id: billingSubId,
        ministry_id: record.ministry_id,
        provider: record.provider,
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: record.effective_at || '2026-10-01T00:00:00.000Z',
        updated_at: new Date().toISOString(),
      });

      return { record, slotId, billingSubId };
    };

    it('1. fail closed se transição não existir', async () => {
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        'tr_not_found'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transition_not_found');
    });

    it('2. fail closed em tenant mismatch', async () => {
      const { record } = setupValidCtfRequestedState({ ministry_id: 'min_tenant_A' });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_tenant_B',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('tenant_mismatch');
    });

    it('3. fail closed em transição legada', async () => {
      const legacyRecord: any = { id: 'tr_legacy_2', ministry_id: 'min_test_1', policy_version: 'legacy' };
      planChangesStore.set(legacyRecord.id, legacyRecord);
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        legacyRecord.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('legacy_transition_unsupported');
    });

    it('4. fail closed se execution_strategy não for scheduled_cancel_to_free', async () => {
      const { record } = setupValidCtfRequestedState({ execution_strategy: 'scheduled_paid_transition' as any });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');
    });

    it('5. fail closed se financial_attention_required for true', async () => {
      const { record } = setupValidCtfRequestedState({ financial_attention_required: true });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('6. fail closed se ministry_subscriptions não existir', async () => {
      const { record } = setupValidCtfRequestedState();
      ministrySubscriptionsStore.delete('min_test_1');
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_not_found');
    });

    it('7. fail closed se billing_subscriptions não existir', async () => {
      const { record, billingSubId } = setupValidCtfRequestedState();
      subscriptionsStore.delete(billingSubId);
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('billing_subscription_not_found');
    });

    it('8. idempotência terminal: transição já canceled/safe_terminal e recursos limpos retorna already_completed', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState({
        transition_status: 'canceled',
        status: 'canceled',
        financial_safety_status: 'safe_terminal',
        cancellation_reversal_status: 'completed',
        cancellation_reversal_completed_at: '2026-09-15T12:00:00.000Z',
      });
      // Recursos pós-terminalização limpos:
      activeSlotsStore.delete(slotId);
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: null,
        cancel_at_period_end: false,
      });
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });

      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(true);
      expect(res.reason).toBe('already_completed');
    });

    it('9. divergência terminal: transição canceled/safe_terminal mas slot ainda HELD → fail closed', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState({
        transition_status: 'canceled',
        status: 'canceled',
        financial_safety_status: 'safe_terminal',
        cancellation_reversal_status: 'completed',
        cancellation_reversal_completed_at: '2026-09-15T12:00:00.000Z',
      });
      // Slot retido indevidamente
      expect(activeSlotsStore.has(slotId)).toBe(true);
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: null,
        cancel_at_period_end: false,
      });
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });

      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('terminal_divergence_slot_held');
    });

    it('10. divergência terminal: transição canceled/safe_terminal mas marker retido → fail closed', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState({
        transition_status: 'canceled',
        status: 'canceled',
        financial_safety_status: 'safe_terminal',
        cancellation_reversal_status: 'completed',
        cancellation_reversal_completed_at: '2026-09-15T12:00:00.000Z',
      });
      activeSlotsStore.delete(slotId);
      // Marker ainda aponta para esta transição
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: record.id,
        cancel_at_period_end: false,
      });
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });

      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('terminal_divergence_marker_retained');
    });

    it('11. divergência terminal: transição canceled/safe_terminal mas cancel_at_period_end retido em ministry_subscriptions → fail closed', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState({
        transition_status: 'canceled',
        status: 'canceled',
        financial_safety_status: 'safe_terminal',
        cancellation_reversal_status: 'completed',
        cancellation_reversal_completed_at: '2026-09-15T12:00:00.000Z',
      });
      activeSlotsStore.delete(slotId);
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: null,
        cancel_at_period_end: true,
      });
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });

      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('terminal_divergence_cancel_flag_retained');
    });

    it('12. divergência terminal: transição canceled/safe_terminal mas cancel_at_period_end retido em billing_subscriptions → fail closed', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState({
        transition_status: 'canceled',
        status: 'canceled',
        financial_safety_status: 'safe_terminal',
        cancellation_reversal_status: 'completed',
        cancellation_reversal_completed_at: '2026-09-15T12:00:00.000Z',
      });
      activeSlotsStore.delete(slotId);
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: null,
        cancel_at_period_end: false,
      });
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: true,
      });

      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('terminal_divergence_billing_cancel_flag_retained');
    });

    it('13. divergência terminal: transição canceled/safe_terminal mas reversal_status !== "completed" → fail closed', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState({
        transition_status: 'canceled',
        status: 'canceled',
        financial_safety_status: 'safe_terminal',
        cancellation_reversal_status: 'requested',
      });
      activeSlotsStore.delete(slotId);
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: null,
        cancel_at_period_end: false,
      });
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });

      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('terminal_divergence_reversal_status_invalid');
    });

    it('14. fail closed se transition_status !== "scheduled"', async () => {
      const { record } = setupValidCtfRequestedState({ transition_status: 'awaiting_old_inactivation' });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_source_status');
    });

    it('15. fail closed se financial_safety_status !== "live"', async () => {
      const { record } = setupValidCtfRequestedState({ financial_safety_status: 'attention_required' });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');
    });

    it('16. fail closed se cancellation_reversal_status !== "requested"', async () => {
      const { record } = setupValidCtfRequestedState({ cancellation_reversal_status: undefined });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('reversal_not_requested');
    });

    it('17. fail closed se boundary já tiver expirado (now >= effective_at)', async () => {
      const { record } = setupValidCtfRequestedState({ effective_at: '2026-10-01T00:00:00.000Z' });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-10-01T00:00:00.000Z' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('boundary_expired');
    });

    it('18. fail closed se lease for de outro worker (lease_not_owned)', async () => {
      const { record } = setupValidCtfRequestedState({
        retry_locked_by: 'worker_alpha',
        retry_locked_until: '2026-09-20T00:00:00.000Z',
      });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z', expectedLockOwner: 'worker_beta' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('lease_not_owned');
    });

    it('19. fail closed se lease estiver expirado (lease_expired)', async () => {
      const { record } = setupValidCtfRequestedState({
        retry_locked_by: 'worker_alpha',
        retry_locked_until: '2026-09-10T00:00:00.000Z',
      });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z', expectedLockOwner: 'worker_alpha' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('lease_expired');
    });

    it('20. fail closed se slot não existir', async () => {
      const { record, slotId } = setupValidCtfRequestedState();
      activeSlotsStore.delete(slotId);
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('slot_not_found');
    });

    it('21. fail closed se slot pertencer a outra transição', async () => {
      const { record, slotId } = setupValidCtfRequestedState();
      activeSlotsStore.set(slotId, { ...activeSlotsStore.get(slotId)!, plan_change_id: 'tr_other_123' });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('slot_owned_by_another_transition');
    });

    it('22. fail closed se marker na assinatura do ministério for ausente ou divergente', async () => {
      const { record } = setupValidCtfRequestedState();
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        active_cancellation_transition_id: 'tr_divergent_xyz',
      });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_missing_or_divergent');
    });

    it('23. fail closed se cancel_at_period_end em ministry_subscriptions for false', async () => {
      const { record } = setupValidCtfRequestedState();
      ministrySubscriptionsStore.set('min_test_1', {
        ...ministrySubscriptionsStore.get('min_test_1'),
        cancel_at_period_end: false,
      });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_cancel_at_period_end_false');
    });

    it('24. fail closed se cancel_at_period_end em billing_subscriptions for false', async () => {
      const { record, billingSubId } = setupValidCtfRequestedState();
      subscriptionsStore.set(billingSubId, {
        ...subscriptionsStore.get(billingSubId),
        cancel_at_period_end: false,
      });
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:00:00.000Z' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('billing_subscription_cancel_at_period_end_false');
    });

    it('25. caminho normal: completa reversão atomicamente liberando o slot e limpando os markers', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState();
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-09-15T12:05:00.000Z' }
      );

      expect(res.success).toBe(true);

      // 1. Transição marcada como canceled / safe_terminal com reversal completed
      const storedTx = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(storedTx.transition_status).toBe('canceled');
      expect(storedTx.status).toBe('canceled');
      expect(storedTx.financial_safety_status).toBe('safe_terminal');
      expect(storedTx.cancellation_reversal_status).toBe('completed');
      expect(storedTx.cancellation_reversal_completed_at).toBe('2026-09-15T12:05:00.000Z');

      // 2. Slot foi liberado (deletado)
      expect(activeSlotsStore.has(slotId)).toBe(false);

      // 3. ministry_subscriptions limpo
      const ministrySub = ministrySubscriptionsStore.get('min_test_1');
      expect(ministrySub.active_cancellation_transition_id).toBeNull();
      expect(ministrySub.cancel_at_period_end).toBe(false);
      // Quotas e plano intactos!
      expect(ministrySub.plan_id).toBe('essential');

      // 4. billing_subscriptions limpo
      const billingSub = subscriptionsStore.get(billingSubId);
      expect(billingSub.cancel_at_period_end).toBe(false);
      expect(billingSub.status).toBe('active');
    });

    it('26. zero-mutation invariant: em caso de falha (boundary_expired), nenhum documento é modificado', async () => {
      const { record, slotId, billingSubId } = setupValidCtfRequestedState();
      const res = await repo.completeCancellationReversalAndReleaseOwnedSlotAtomically(
        'min_test_1',
        'asaas',
        record.id,
        { nowIso: '2026-10-01T00:00:00.000Z' }
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('boundary_expired');

      // Zero mutações
      expect(activeSlotsStore.has(slotId)).toBe(true);
      expect(ministrySubscriptionsStore.get('min_test_1')?.active_cancellation_transition_id).toBe(record.id);
      expect(ministrySubscriptionsStore.get('min_test_1')?.cancel_at_period_end).toBe(true);
      expect(subscriptionsStore.get(billingSubId)?.cancel_at_period_end).toBe(true);
      const storedTx = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(storedTx.transition_status).toBe('scheduled');
      expect(storedTx.financial_safety_status).toBe('live');
      expect(storedTx.cancellation_reversal_status).toBe('requested');
    });
  });

  describe('setCancellationReversalAttentionAtomically — Phase 4A.4.1', () => {
    const createCtfRecord = (overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record =>
      createSampleV1Record({
        id: 'tr_att_rev_1',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        effective_at: '2026-10-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
        cancellation_reversal_status: 'requested',
        ...overrides,
      });

    it('1. fail closed se attentionReason for vazio ou inválido', async () => {
      const res = await repo.setCancellationReversalAttentionAtomically('min_test_1', 'tr_any', '');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_attention_reason');

      const resSpace = await repo.setCancellationReversalAttentionAtomically('min_test_1', 'tr_any', '   ');
      expect(resSpace.success).toBe(false);
      expect(resSpace.reason).toBe('invalid_attention_reason');
    });

    it('2. fail closed se transição não existir', async () => {
      const res = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        'tr_not_found',
        'provider_reversal_error'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transition_not_found');
    });

    it('3. fail closed em tenant mismatch', async () => {
      const record = createCtfRecord({ ministry_id: 'min_tenant_A' });
      planChangesStore.set(record.id, record);
      const res = await repo.setCancellationReversalAttentionAtomically(
        'min_tenant_B',
        record.id,
        'provider_reversal_error'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('tenant_mismatch');
    });

    it('4. fail closed em transição legada', async () => {
      const legacyRecord: any = { id: 'tr_leg_att', ministry_id: 'min_test_1', policy_version: 'legacy' };
      planChangesStore.set(legacyRecord.id, legacyRecord);
      const res = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        legacyRecord.id,
        'provider_reversal_error'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('legacy_transition_unsupported');
    });

    it('5. fail closed se execution_strategy não for scheduled_cancel_to_free', async () => {
      const record = createCtfRecord({ execution_strategy: 'scheduled_paid_transition' as any });
      planChangesStore.set(record.id, record);
      const res = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        record.id,
        'provider_reversal_error'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');
    });

    it('6. fail closed se transição já for terminal (completed ou canceled)', async () => {
      const recordCompleted = createCtfRecord({
        id: 'tr_term_comp',
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(recordCompleted.id, recordCompleted);
      const resComp = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        recordCompleted.id,
        'provider_reversal_error'
      );
      expect(resComp.success).toBe(false);
      expect(resComp.reason).toBe('transition_already_terminal');

      const recordCanceled = createCtfRecord({
        id: 'tr_term_canc',
        transition_status: 'canceled',
        financial_safety_status: 'safe_terminal',
      });
      planChangesStore.set(recordCanceled.id, recordCanceled);
      const resCanc = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        recordCanceled.id,
        'provider_reversal_error'
      );
      expect(resCanc.success).toBe(false);
      expect(resCanc.reason).toBe('transition_already_terminal');
    });

    it('7. fail closed em divergência de lease', async () => {
      const record = createCtfRecord({
        retry_locked_by: 'worker_alpha',
        retry_locked_until: '2026-09-20T00:00:00.000Z',
      });
      planChangesStore.set(record.id, record);
      const res = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        record.id,
        'provider_reversal_error',
        { nowIso: '2026-09-15T12:00:00.000Z', expectedLockOwner: 'worker_beta' }
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('lease_not_owned');
    });

    it('8. sucesso: marca atenção financeira e preserva slot, marker e quotas', async () => {
      const record = createCtfRecord();
      planChangesStore.set(record.id, record);

      const slotId = buildActiveTransitionSlotId(record.ministry_id, record.provider);
      activeSlotsStore.set(slotId, {
        id: slotId,
        ministry_id: record.ministry_id,
        provider: record.provider,
        plan_change_id: record.id,
        acquired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      });

      const res = await repo.setCancellationReversalAttentionAtomically(
        'min_test_1',
        record.id,
        'provider_reactivation_ambiguous',
        { nowIso: '2026-09-15T12:00:00.000Z' }
      );

      expect(res.success).toBe(true);

      const storedTx = planChangesStore.get(record.id) as BillingTransitionV1Record;
      expect(storedTx.cancellation_reversal_status).toBe('attention_required');
      expect(storedTx.cancellation_reversal_attention_reason).toBe('provider_reactivation_ambiguous');
      expect(storedTx.financial_attention_required).toBe(true);
      expect(storedTx.financial_attention_reason).toBe('provider_reactivation_ambiguous');
      expect(storedTx.financial_safety_status).toBe('attention_required');

      // Slot permanece estritamente HELD
      expect(activeSlotsStore.has(slotId)).toBe(true);
    });
  });

  describe('Reconciliation Visibility — Phase 4A.4.1', () => {
    it('1. transição scheduled_cancel_to_free com cancellation_reversal_status "requested" é visível em getV1TransitionsNeedingReconciliation', async () => {
      const record = createSampleV1Record({
        id: 'tr_reconcile_ctf_rev_1',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        effective_at: '2026-10-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
        cancellation_reversal_status: 'requested',
        cancellation_reversal_requested_at: '2026-09-15T10:00:00.000Z',
      });
      planChangesStore.set(record.id, record);

      const transitions = await repo.getV1TransitionsNeedingReconciliation('asaas', 10);
      const found = transitions.find((t) => t.id === record.id);
      expect(found).toBeDefined();
      expect((found as BillingTransitionV1Record)?.transition_status).toBe('scheduled');
      expect((found as BillingTransitionV1Record)?.cancellation_reversal_status).toBe('requested');
    });

    it('2. transição em attention_required é visível no bucket de atenção', async () => {
      const record = createSampleV1Record({
        id: 'tr_reconcile_ctf_rev_att_1',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_type: 'downgrade',
        transition_status: 'scheduled',
        financial_safety_status: 'attention_required',
        financial_attention_required: true,
        effective_at: '2026-10-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        target_plan_id: 'free',
        requested_plan_id: 'free',
        target_future_recurring_price_cents: 0,
        expected_amount_cents: 0,
        cancellation_reversal_status: 'attention_required',
        cancellation_reversal_attention_reason: 'provider_error',
      });
      planChangesStore.set(record.id, record);

      const transitions = await repo.getV1TransitionsNeedingReconciliation('asaas', 10);
      const found = transitions.find((t) => t.id === record.id);
      expect(found).toBeDefined();
      expect(found?.financial_attention_required).toBe(true);
      expect((found as BillingTransitionV1Record)?.cancellation_reversal_status).toBe('attention_required');
    });
  });
});
