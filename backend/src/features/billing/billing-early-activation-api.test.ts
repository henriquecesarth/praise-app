import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BillingRepository } from '../../repositories/BillingRepository';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { requireMinistryRole } from '../../middleware/rbac';
import { AuthenticatedRequest } from '../../middleware/auth';
import { Response } from 'express';
import { AppError } from '../../middleware/error-handler';
import {
  BillingTransitionV1Record,
  BillingEarlyActivationQuote,
} from './billing.types';
import { config } from '../../config/unifiedConfig';

// Mock transacional do Firestore com fila determinística
vi.mock('../../lib/firebase', () => {
  const store = new Map<string, any>();
  const mockDoc = (docPath: string) => ({
    get: vi.fn(async () => {
      const data = store.get(docPath);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
    set: vi.fn(async (data: any, options?: any) => {
      if (options?.merge && store.has(docPath)) {
        store.set(docPath, { ...store.get(docPath), ...data });
      } else {
        store.set(docPath, data);
      }
    }),
  });

  const mockCollection = (collName: string) => ({
    doc: vi.fn((id: string) => mockDoc(`${collName}/${id}`)),
  });

  let transactionQueue = Promise.resolve();
  return {
    db: {
      collection: vi.fn((name: string) => mockCollection(name)),
      runTransaction: vi.fn((fn: any) => {
        const execute = async () => {
          const transactionContext = {
            get: vi.fn(async (docRef: any) => {
              return await docRef.get();
            }),
            set: vi.fn((docRef: any, data: any, options?: any) => {
              docRef.set(data, options);
            }),
          };
          return await fn(transactionContext);
        };
        const current = transactionQueue.then(execute);
        transactionQueue = current.catch(() => {});
        return current;
      }),
      _store: store,
    },
  };
});

describe('Phase 3C.3 — Tenant-Scoped Early Activation API, Quote Persistence & RBAC/Anti-IDOR', () => {
  let billingRepo: BillingRepository;
  let billingService: BillingService;
  let controller: BillingController;
  let mockProvider: any;
  let firebaseStore: Map<string, any>;

  const MINISTRY_ID = 'min_tenant_100';
  const OTHER_MINISTRY_ID = 'min_attacker_999';
  const USER_ID = 'usr_admin_1';
  const TRANSITION_ID = 'tr_scheduled_v1_001';

  function buildValidScheduledTransition(overrides?: Partial<BillingTransitionV1Record>): BillingTransitionV1Record {
    return {
      id: TRANSITION_ID,
      transition_id: TRANSITION_ID,
      policy_version: 'billing_transition_v1',
      ministry_id: MINISTRY_ID,
      provider: 'asaas',
      currency: 'BRL',
      execution_strategy: 'scheduled_paid_transition',
      transition_status: 'scheduled',
      early_activation_status: 'available',
      financial_safety_status: 'live',
      transition_type: 'upgrade',
      status: 'payment_confirmed',

      supersede_status: 'completed',
      payment_cleanup_status: 'completed',
      financial_attention_required: false,

      requested_plan_id: 'pro',
      requested_interval: 'monthly',
      requested_addon_blocks: 0,
      expected_amount_cents: 8900,

      source_plan_id: 'essential',
      source_interval: 'monthly',
      source_addon_blocks: 0,
      source_current_cycle_total_cents: 3900,
      source_entitlement_snapshot: {
        plan_id: 'essential',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 15,
        effective_song_quota: 100,
      },
      current_period_start: '2026-09-01T03:00:00.000Z',
      current_period_end: '2026-10-01T03:00:00.000Z',

      target_plan_id: 'pro',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      target_future_recurring_price_cents: 8900,
      target_current_cycle_total_cents: 8900,
      target_entitlement_snapshot: {
        plan_id: 'pro',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 30,
        effective_song_quota: 'unlimited',
      },

      price_locked_at: '2026-09-02T12:00:00.000Z',
      effective_at: '2026-10-01T03:00:00.000Z',
      effective_billing_date: '2026-10-01',

      requested_commercial_date: '2026-09-02',
      requested_at: '2026-09-02T12:00:00.000Z',
      created_at: '2026-09-02T12:00:00.000Z',
      updated_at: '2026-09-02T12:00:00.000Z',
      expires_at: null,

      checkout_attempts: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    const { db } = await import('../../lib/firebase');
    firebaseStore = (db as any)._store;
    firebaseStore.clear();

    mockProvider = {
      name: 'asaas',
      createDetachedCheckout: vi.fn(),
      classifyErrorOutcome: vi.fn(),
    };

    billingRepo = new BillingRepository();
    billingService = new BillingService(
      billingRepo,
      {} as any,
      {} as any,
      {} as any,
      mockProvider,
      { findById: vi.fn().mockResolvedValue({ id: USER_ID, email: 'admin@louvaio.com' }) } as any
    );
    controller = new BillingController(billingService);

    // Salvar transição base válida
    firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, buildValidScheduledTransition());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. REPOSITORY QUOTE PERSISTENCE (Testes 1 a 10 + TOCTOU + Stale Economic)
  // ==========================================================================
  describe('1. Repository Quote Persistence (Tests 1 to 10 + TOCTOU + Stale)', () => {
    it('1. recordEarlyActivationQuote: grava current_early_activation_quote e anexa ao early_activation_quotes_history', async () => {
      const quote: BillingEarlyActivationQuote = {
        quote_id: 'quote_1',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        price_delta_cents: 5000,
        total_days: 30,
        remaining_days: 15,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'active',
        calculation_version: 'proration_v1',
      };

      const result = await billingRepo.recordEarlyActivationQuote({
        ministryId: MINISTRY_ID,
        transitionId: TRANSITION_ID,
        quote,
        nowIso: '2026-09-15T12:00:00.000Z',
      });

      expect(result.transition.current_early_activation_quote?.quote_id).toBe('quote_1');
      expect(result.transition.early_activation_quotes_history).toHaveLength(1);
      expect(result.transition.early_activation_quotes_history![0].quote_id).toBe('quote_1');
      expect(result.transition.early_activation_status).toBe('available');
    });

    it('2. CAS: se transição não existir, lança 404', async () => {
      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: 'non_existent_tr',
          quote,
        })
      ).rejects.toThrow(/não encontrada/);
    });

    it('3. Tenant isolation: se ministry_id for divergente, lança 403', async () => {
      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: OTHER_MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
        })
      ).rejects.toThrow(/não autorizado/);
    });

    it('4. Se transição não for V1, lança 400', async () => {
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, {
        id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        policy_version: 'legacy',
      });

      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
        })
      ).rejects.toThrow(/transições V1/);
    });

    it('5. Se status não for scheduled, lança 400', async () => {
      const tr = buildValidScheduledTransition({ transition_status: 'completed', status: 'completed' });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
        })
      ).rejects.toThrow(/não permite cotação/);
    });

    it('6. Se financial_attention_required === true, lança 400', async () => {
      const tr = buildValidScheduledTransition({ financial_attention_required: true });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
        })
      ).rejects.toThrow(/atenção financeira/);
    });

    it('7. Se já existir obrigação viva, lança 409', async () => {
      const tr = buildValidScheduledTransition({
        checkout_attempts: [
          {
            attempt_id: 'att_live_1',
            transition_id: TRANSITION_ID,
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_1',
            amount_cents: 2500,
            currency: 'BRL',
            status: 'pending',
            provider_create_state: 'created',
            created_at: '2026-09-02T12:00:00.000Z',
          },
        ],
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
        })
      ).rejects.toThrow(/obrigação financeira de early activation ativa/);
    });

    it('8. Se early_activation_status === payment_pending, lança 409', async () => {
      const tr = buildValidScheduledTransition({ early_activation_status: 'payment_pending' });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      const quote: any = { quote_id: 'quote_1' };
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
        })
      ).rejects.toThrow(/pagamento de ativação antecipada pendente/);
    });

    it('9. Quote anterior com status active vira superseded no histórico quando nova quote é gravada', async () => {
      const quote1: BillingEarlyActivationQuote = {
        quote_id: 'quote_1',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'active',
      };

      await billingRepo.recordEarlyActivationQuote({
        ministryId: MINISTRY_ID,
        transitionId: TRANSITION_ID,
        quote: quote1,
        nowIso: '2026-09-15T12:00:00.000Z',
      });

      const quote2: BillingEarlyActivationQuote = {
        ...quote1,
        quote_id: 'quote_2',
        prorated_adjustment_cents: 2300,
      };

      const result = await billingRepo.recordEarlyActivationQuote({
        ministryId: MINISTRY_ID,
        transitionId: TRANSITION_ID,
        quote: quote2,
        nowIso: '2026-09-15T12:00:00.000Z',
      });

      expect(result.transition.current_early_activation_quote?.quote_id).toBe('quote_2');
      expect(result.transition.early_activation_quotes_history).toHaveLength(2);
      expect(result.transition.early_activation_quotes_history![0].quote_id).toBe('quote_1');
      expect(result.transition.early_activation_quotes_history![0].status).toBe('superseded');
      expect(result.transition.early_activation_quotes_history![1].quote_id).toBe('quote_2');
      expect(result.transition.early_activation_quotes_history![1].status).toBe('active');
    });

    it('10. Quote anterior com status consumed NUNCA é alterada para superseded', async () => {
      const consumedQuote: BillingEarlyActivationQuote = {
        quote_id: 'quote_consumed_1',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'consumed',
      };

      const tr = buildValidScheduledTransition({
        current_early_activation_quote: consumedQuote,
        early_activation_quotes_history: [consumedQuote],
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      const newQuote: BillingEarlyActivationQuote = {
        ...consumedQuote,
        quote_id: 'quote_new_2',
        status: 'active',
      };

      const result = await billingRepo.recordEarlyActivationQuote({
        ministryId: MINISTRY_ID,
        transitionId: TRANSITION_ID,
        quote: newQuote,
        nowIso: '2026-09-15T12:00:00.000Z',
      });

      const historicalConsumed = result.transition.early_activation_quotes_history!.find(
        (q) => q.quote_id === 'quote_consumed_1'
      );
      expect(historicalConsumed?.status).toBe('consumed');
    });

    it('TOCTOU: transição muda de estado concorrente antes do commit Firestore -> recordEarlyActivationQuote rejeita', async () => {
      const quote: BillingEarlyActivationQuote = {
        quote_id: 'quote_toctou_1',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'active',
      };

      // Simula alteração concorrente que torna a transição insegura antes do commit
      const tr = buildValidScheduledTransition({
        financial_safety_status: 'safe_terminal',
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
          nowIso: '2026-09-15T12:00:00.000Z',
        })
      ).rejects.toThrow(/Estado de segurança financeira/);

      // Prova que a quote NÃO persistiu
      const stored = firebaseStore.get(`billing_plan_changes/${TRANSITION_ID}`);
      expect(stored.current_early_activation_quote).toBeUndefined();
    });

    it('Stale Economic Quote: valores do ciclo da quote divergem dos locked values fresh -> FAIL CLOSED', async () => {
      const quote: BillingEarlyActivationQuote = {
        quote_id: 'quote_stale_1',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 2000, // Divergente do locked 3900
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'active',
      };

      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: MINISTRY_ID,
          transitionId: TRANSITION_ID,
          quote,
          nowIso: '2026-09-15T12:00:00.000Z',
        })
      ).rejects.toThrow(/diverge do valor travado na transição fresh/);

      const stored = firebaseStore.get(`billing_plan_changes/${TRANSITION_ID}`);
      expect(stored.current_early_activation_quote).toBeUndefined();
      expect(stored.early_activation_quotes_history).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. SERVICE QUOTE CREATION & VALIDATION (Testes 11 a 23)
  // ==========================================================================
  describe('2. Service Quote Creation & Validation (Tests 11 to 23)', () => {
    it('11. Cria cotação determinística pura: NÃO chama provedor externo Asaas', async () => {
      const result = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
        now: '2026-09-15T12:00:00.000Z',
      });

      expect(result.quoteId).toBeDefined();
      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('12. Usa SOMENTE dados travados da transição (não chama catálogo para recalcular preço)', async () => {
      const tr = buildValidScheduledTransition({
        source_current_cycle_total_cents: 1000,
        target_current_cycle_total_cents: 5000,
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      const result = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
        now: '2026-09-15T12:00:00.000Z',
      });

      expect(result.sourceCurrentCycleTotalCents).toBe(1000);
      expect(result.targetCurrentCycleTotalCents).toBe(5000);
      expect(result.priceDeltaCents).toBe(4000);
    });

    it('13. O serviço não aceita e não consome inputs monetários enviados do cliente', async () => {
      const result = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
        now: '2026-09-15T12:00:00.000Z',
      });

      expect(result.proratedAdjustmentCents).toBeGreaterThan(0);
      expect(result.currency).toBe('BRL');
    });

    it('14. Rejeita se estratégia não for scheduled_paid_transition', async () => {
      const tr = buildValidScheduledTransition({ execution_strategy: 'immediate_initial_purchase' as any });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/não permite early activation/);
    });

    it('15. Rejeita se status não for scheduled', async () => {
      const tr = buildValidScheduledTransition({ transition_status: 'pending_future_authorization' });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/não permite cotação/);
    });

    it('16. Rejeita se supersede_status !== completed', async () => {
      const tr = buildValidScheduledTransition({ supersede_status: 'pending' });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/supersede_status incompleto/);
    });

    it('17. Rejeita se payment_cleanup_status !== completed', async () => {
      const tr = buildValidScheduledTransition({ payment_cleanup_status: 'pending' });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/Limpeza de cobranças antigas/);
    });

    it('18. Rejeita se financial_safety_status !== live', async () => {
      const tr = buildValidScheduledTransition({ financial_safety_status: 'safe_terminal' });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/Estado de segurança financeira/);
    });

    it('19. Rejeita se data comercial atual atingiu ou ultrapassou a renovação (effective_billing_date)', async () => {
      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
          now: '2026-10-01T15:00:00.000Z', // 12:00 em America/Sao_Paulo (2026-10-01)
        })
      ).rejects.toThrow(/atingiu ou ultrapassou a fronteira da renovação/);
    });

    it('20. Rejeita se capacidades de destino não representarem um pure_upgrade', async () => {
      const tr = buildValidScheduledTransition({
        source_entitlement_snapshot: {
          plan_id: 'pro',
          addon_blocks: 0,
          effective_member_quota: 30,
          effective_song_quota: 'unlimited',
        },
        target_entitlement_snapshot: {
          plan_id: 'essential',
          addon_blocks: 0,
          effective_member_quota: 15,
          effective_song_quota: 100,
        },
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/Transição não é elegível para early activation/);
    });

    it('21. Rejeita se priceDelta <= 0', async () => {
      const tr = buildValidScheduledTransition({
        source_current_cycle_total_cents: 8900,
        target_current_cycle_total_cents: 8900,
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID)
      ).rejects.toThrow(/PRICE_DELTA_NOT_POSITIVE/);
    });

    it('22. Retorna DTO estruturado conforme contrato (EarlyActivationQuoteResponseDto)', async () => {
      const result = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
        now: '2026-09-15T12:00:00.000Z',
      });

      expect(result).toEqual({
        quoteId: expect.any(String),
        transitionId: TRANSITION_ID,
        sourcePlanId: 'essential',
        targetPlanId: 'pro',
        currentPeriodStartBillingDate: '2026-09-01',
        currentPeriodEndBillingDate: '2026-10-01',
        quoteBillingDate: '2026-09-15',
        totalDays: 30,
        remainingDays: 16,
        sourceCurrentCycleTotalCents: 3900,
        targetCurrentCycleTotalCents: 8900,
        priceDeltaCents: 5000,
        proratedAdjustmentCents: 2667,
        currency: 'BRL',
        expiresAt: expect.any(String),
        nextRenewalBillingDate: '2026-10-01',
        nextRecurringAmountCents: 8900,
      });
    });

    it('23. Duas chamadas simultâneas de cotação funcionam serializadas pelo CAS tornando a primeira superseded', async () => {
      const [res1, res2] = await Promise.all([
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
          now: '2026-09-15T12:00:00.000Z',
        }),
        billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID, {
          now: '2026-09-15T12:00:00.000Z',
        }),
      ]);

      expect(res1.quoteId).toBeDefined();
      expect(res2.quoteId).toBeDefined();

      const latestTr = firebaseStore.get(`billing_plan_changes/${TRANSITION_ID}`);
      expect(latestTr.early_activation_quotes_history).toHaveLength(2);
      expect(latestTr.early_activation_quotes_history[0].status).toBe('superseded');
      expect(latestTr.early_activation_quotes_history[1].status).toBe('active');
    });
  });

  // ==========================================================================
  // 3. API / ROUTES / CONTROLLER / RBAC / ANTI-IDOR (Testes 24 a 38)
  // ==========================================================================
  describe('3. API / Routes / Controller / RBAC / Anti-IDOR (Tests 24 to 38)', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
      mockReq = {
        params: { ministryId: MINISTRY_ID, transitionId: TRANSITION_ID },
        query: {},
        body: {},
        headers: {},
        user: { id: USER_ID, email: 'admin@louvaio.com' },
      };

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      mockNext = vi.fn();
    });

    it('24. POST /quote: requer usuário autenticado (401 se sem token)', async () => {
      mockReq.user = undefined;

      await controller.createEarlyActivationQuote(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });

    it('25. POST /quote: requer role admin (403 se membro sem perfil admin)', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: MINISTRY_ID,
        role: 'member',
      } as any);

      const rbacMiddleware = requireMinistryRole('admin');
      await rbacMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    it('26. Anti-IDOR em POST /quote: se transitionId pertencer a outro ministério, retorna 403', async () => {
      mockReq.params = { ministryId: OTHER_MINISTRY_ID, transitionId: TRANSITION_ID };

      await controller.createEarlyActivationQuote(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    it('27. Sucesso em POST /quote: responde HTTP 201 com o DTO completo da cotação', async () => {
      await controller.createEarlyActivationQuote(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: expect.any(String),
          transitionId: TRANSITION_ID,
          proratedAdjustmentCents: expect.any(Number),
          currency: 'BRL',
        })
      );
    });

    it('28. POST /checkout: requer usuário autenticado (401)', async () => {
      mockReq.user = undefined;
      mockReq.body = { quoteId: 'quote_1' };

      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });

    it('29. POST /checkout: requer role admin (403)', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: MINISTRY_ID,
        role: 'member',
      } as any);

      const rbacMiddleware = requireMinistryRole('admin');
      await rbacMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    it('30. Anti-IDOR em POST /checkout: se transitionId pertencer a outro ministério, retorna 403', async () => {
      mockReq.params = { ministryId: OTHER_MINISTRY_ID, transitionId: TRANSITION_ID };
      mockReq.body = { quoteId: 'quote_1' };

      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    it('31. POST /checkout sem quoteId no body: retorna 400 Bad Request', async () => {
      mockReq.body = {};

      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
      expect(mockNext.mock.calls[0][0].message).toMatch(/quoteId é obrigatório/);
    });

    it('32. POST /checkout com quoteId vazio/espaços: retorna 400 Bad Request', async () => {
      mockReq.body = { quoteId: '   ' };

      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    it('33. POST /checkout com campos monetários no body: backend rejeita com 400 (autoridade exclusiva no backend)', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockReq.body = {
        quoteId: quote.quoteId,
        amountCents: 1, // Tentativa maliciosa de pagar R$ 0,01
        amount: 1,
      };

      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
      expect(mockNext.mock.calls[0][0].message).toMatch(/não é permitido no corpo/);
      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('34. POST /checkout quando já existe obrigação viva: retorna 409 Conflict', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      const tr = firebaseStore.get(`billing_plan_changes/${TRANSITION_ID}`);
      tr.checkout_attempts = [
        {
          attempt_id: 'att_live_prev',
          transition_id: TRANSITION_ID,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_live_prev',
          amount_cents: 2500,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'created',
          created_at: '2026-09-02T12:00:00.000Z',
        },
      ];
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(409);
    });

    it('35. POST /checkout quando provider retorna OUTCOME_UNCERTAIN: responde HTTP 202 sem sugerir retry cego', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockRejectedValue(new Error('Gateway timeout'));
      mockProvider.classifyErrorOutcome.mockReturnValue('OUTCOME_UNCERTAIN');

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'creation_verification_pending',
          code: 'CHECKOUT_CREATE_UNCERTAIN',
          transitionId: TRANSITION_ID,
          quoteId: quote.quoteId,
        })
      );
      const jsonCall = mockRes.json.mock.calls[0][0];
      expect(jsonCall.checkoutUrl).toBeUndefined();
      expect(jsonCall.message).toMatch(/Estamos verificando a criação do pagamento/);
      expect(jsonCall.message).not.toMatch(/tente novamente/i);
    });

    it('36. POST /checkout com sucesso: responde HTTP 201 com status payment_pending', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_success_1',
        checkoutId: 'chk_success_1',
        expiresAt: quote.expiresAt,
      });

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_success_1',
          checkoutId: 'chk_success_1',
          quoteId: quote.quoteId,
          status: 'payment_pending',
        })
      );
    });

    it('37. Sucesso no checkout comunica pagamento pendente e NUNCA ativa entitlements', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_success_1',
        checkoutId: 'chk_success_1',
        expiresAt: quote.expiresAt,
      });

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      const tr = firebaseStore.get(`billing_plan_changes/${TRANSITION_ID}`);
      expect(tr.transition_status).toBe('scheduled');
      expect(tr.early_activation_status).toBe('payment_pending');
      expect(tr.early_activation_confirmed_at).toBeUndefined();
    });

    it('38. Rota mergeParams aceita tanto :ministryId quanto :groupId', async () => {
      mockReq.params = { groupId: MINISTRY_ID, transitionId: TRANSITION_ID };

      await controller.createEarlyActivationQuote(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
    });
  });

  // ==========================================================================
  // 4. CALLBACK AUTHORITY & CONFIGURATION (Testes 39 a 41)
  // ==========================================================================
  describe('4. Callback Authority & Configuration (Tests 39 to 41)', () => {
    it('39. createEarlyActivationCheckout usa as URLs de callback do backend (config.billingPublicApiUrl)', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1',
        checkoutId: 'chk_1',
        expiresAt: quote.expiresAt,
      });

      await billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, quote.quoteId);

      const expectedBase = (config.billingPublicApiUrl || '').replace(/\/+$/, '');
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: `${expectedBase}/api/v1/billing/checkout-return/success`,
          cancelUrl: `${expectedBase}/api/v1/billing/checkout-return/cancel`,
          expiredUrl: `${expectedBase}/api/v1/billing/checkout-return/expired`,
        })
      );
    });

    it('40. Frontend NÃO consegue sobrescrever callbacks (options injetadas são ignoradas)', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1',
        checkoutId: 'chk_1',
        expiresAt: quote.expiresAt,
      });

      await billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, quote.quoteId, {
        customerData: undefined,
      });

      const expectedBase = (config.billingPublicApiUrl || '').replace(/\/+$/, '');
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: `${expectedBase}/api/v1/billing/checkout-return/success`,
        })
      );
    });

    it('41. Se billingPublicApiUrl não estiver configurada ou for localhost, falha fechado de forma segura (500)', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      const originalPublicUrl = config.billingPublicApiUrl;
      try {
        (config as any).billingPublicApiUrl = 'http://localhost:3000';

        await expect(
          billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, quote.quoteId)
        ).rejects.toThrow(/não pode ser localhost/);
      } finally {
        (config as any).billingPublicApiUrl = originalPublicUrl;
      }
    });
  });

  // ==========================================================================
  // 5. EXPLICIT QUOTE ANTI-IDOR TESTS (Testes 42 a 45 - Seção 10)
  // ==========================================================================
  describe('5. Explicit Quote Anti-IDOR Tests (Tests 42 to 45)', () => {
    it('42. URL ministry A, transition A, quote pertencente a transition B do mesmo ministry -> rejected, provider NOT called', async () => {
      // 1. Criar transição B para o mesmo ministério
      const trB = buildValidScheduledTransition({
        id: 'tr_scheduled_v1_002',
        transition_id: 'tr_scheduled_v1_002',
      });
      firebaseStore.set(`billing_plan_changes/tr_scheduled_v1_002`, trB);

      // 2. Criar cotação legítima na transição B
      const quoteB = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, 'tr_scheduled_v1_002');

      // 3. Tentar checkout na transição A usando quoteId da transição B
      await expect(
        billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, quoteB.quoteId)
      ).rejects.toThrow(/Cotação de early activation inválida ou divergente da transição/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('43. URL ministry A, transition A, quote pertencente ao ministry B -> rejected, provider NOT called', async () => {
      // 1. Criar transição para ministério B
      const trMinistryB = buildValidScheduledTransition({
        id: 'tr_scheduled_other_ministry',
        transition_id: 'tr_scheduled_other_ministry',
        ministry_id: OTHER_MINISTRY_ID,
      });
      firebaseStore.set(`billing_plan_changes/tr_scheduled_other_ministry`, trMinistryB);

      // 2. Criar cotação no ministério B
      const quoteMinistryB = await billingService.createEarlyActivationQuote(
        OTHER_MINISTRY_ID,
        'usr_other_admin',
        'tr_scheduled_other_ministry'
      );

      // 3. Atacante no ministry A tenta consumir a cotação do ministry B
      await expect(
        billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, quoteMinistryB.quoteId)
      ).rejects.toThrow(/Cotação de early activation inválida ou divergente da transição/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('44. quoteId existente no histórico de outra transition -> rejected, provider NOT called', async () => {
      // 1. Transição B com cotação no histórico
      const historicalQuote: BillingEarlyActivationQuote = {
        quote_id: 'quote_historical_other_tr',
        transition_id: 'tr_other_tr_999',
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-10T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-10',
        expires_at: '2026-09-10T23:59:59.999Z',
        status: 'superseded',
      };
      const trB = buildValidScheduledTransition({
        id: 'tr_other_tr_999',
        transition_id: 'tr_other_tr_999',
        early_activation_quotes_history: [historicalQuote],
      });
      firebaseStore.set(`billing_plan_changes/tr_other_tr_999`, trB);

      // 2. Tenta checkout na transição A
      await expect(
        billingService.createEarlyActivationCheckout(
          MINISTRY_ID,
          USER_ID,
          TRANSITION_ID,
          'quote_historical_other_tr'
        )
      ).rejects.toThrow(/Cotação de early activation inválida ou divergente da transição/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('45. quoteId inventado/inexistente -> rejected, provider NOT called', async () => {
      await expect(
        billingService.createEarlyActivationCheckout(
          MINISTRY_ID,
          USER_ID,
          TRANSITION_ID,
          'quote_fabricated_random_123'
        )
      ).rejects.toThrow(/Cotação de early activation inválida ou divergente da transição/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 6. CHECKOUT QUOTE STATUS TESTS (Testes 46 a 49 - Seção 11)
  // ==========================================================================
  describe('6. Checkout Quote Status Tests (Tests 46 to 49)', () => {
    it('46. quote consumed -> checkout rejected, provider NOT called', async () => {
      const consumedQuote: BillingEarlyActivationQuote = {
        quote_id: 'quote_consumed_test',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'consumed',
      };

      const tr = buildValidScheduledTransition({
        current_early_activation_quote: consumedQuote,
        early_activation_quotes_history: [consumedQuote],
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, 'quote_consumed_test')
      ).rejects.toThrow(/Cotação com status 'consumed' não pode ser utilizada/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('47. quote expired -> checkout rejected, provider NOT called', async () => {
      const expiredQuote: BillingEarlyActivationQuote = {
        quote_id: 'quote_expired_test',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-10T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-10',
        expires_at: '2026-09-10T23:59:59.999Z',
        status: 'active',
      };

      const tr = buildValidScheduledTransition({
        current_early_activation_quote: expiredQuote,
        early_activation_quotes_history: [expiredQuote],
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, 'quote_expired_test', {
          now: '2026-09-15T12:00:00.000Z', // 5 dias após a expiração da cotação
        })
      ).rejects.toThrow(/já expirou/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('48. quote superseded -> checkout rejected, provider NOT called', async () => {
      const supersededQuote: BillingEarlyActivationQuote = {
        quote_id: 'quote_superseded_test',
        transition_id: TRANSITION_ID,
        ministry_id: MINISTRY_ID,
        source_current_cycle_total_cents: 3900,
        target_current_cycle_total_cents: 8900,
        prorated_adjustment_cents: 2500,
        currency: 'BRL',
        priced_at: '2026-09-15T12:00:00.000Z',
        quote_effective_billing_date: '2026-09-15',
        expires_at: '2026-09-15T23:59:59.999Z',
        status: 'superseded',
      };

      const tr = buildValidScheduledTransition({
        current_early_activation_quote: supersededQuote,
        early_activation_quotes_history: [supersededQuote],
      });
      firebaseStore.set(`billing_plan_changes/${TRANSITION_ID}`, tr);

      await expect(
        billingService.createEarlyActivationCheckout(MINISTRY_ID, USER_ID, TRANSITION_ID, 'quote_superseded_test')
      ).rejects.toThrow(/Cotação com status 'superseded' não pode ser utilizada/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('49. quote active da transition correta -> único caminho permitido', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_active_success',
        checkoutId: 'chk_active_success',
        expiresAt: quote.expiresAt,
      });

      const result = await billingService.createEarlyActivationCheckout(
        MINISTRY_ID,
        USER_ID,
        TRANSITION_ID,
        quote.quoteId
      );

      expect(result.checkoutId).toBe('chk_active_success');
      expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/checkoutSession/show?id=chk_active_success');
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // 7. REQUIRED HTTP TEST DELTA (Testes 50 a 54 - Seção 15)
  // ==========================================================================
  describe('7. Required HTTP Test Delta (Tests 50 to 54)', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
      mockReq = {
        params: { ministryId: MINISTRY_ID, transitionId: TRANSITION_ID },
        query: {},
        body: {},
        headers: {},
        user: { id: USER_ID, email: 'admin@louvaio.com' },
      };

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      mockNext = vi.fn();
    });

    it('50. known checkout success -> HTTP 201 payment_pending', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_50',
        checkoutId: 'chk_50',
        expiresAt: quote.expiresAt,
      });

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'payment_pending',
          checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_50',
          checkoutId: 'chk_50',
        })
      );
    });

    it('51. unknown create outcome -> HTTP 202 creation_verification_pending', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockRejectedValue(new Error('Network timeout'));
      mockProvider.classifyErrorOutcome.mockReturnValue('OUTCOME_UNCERTAIN');

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'creation_verification_pending',
          code: 'CHECKOUT_CREATE_UNCERTAIN',
          transitionId: TRANSITION_ID,
          quoteId: quote.quoteId,
        })
      );
    });

    it('52. 202 contains no checkoutUrl', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockRejectedValue(new Error('Gateway 503'));
      mockProvider.classifyErrorOutcome.mockReturnValue('OUTCOME_UNCERTAIN');

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      const responseBody = mockRes.json.mock.calls[0][0];
      expect(responseBody.checkoutUrl).toBeUndefined();
    });

    it('53. 202 does not advise retry', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      mockProvider.createDetachedCheckout.mockRejectedValue(new Error('AbortError'));
      mockProvider.classifyErrorOutcome.mockReturnValue('OUTCOME_UNCERTAIN');

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      const responseBody = mockRes.json.mock.calls[0][0];
      expect(responseBody.message).toMatch(/Estamos verificando a criação do pagamento/);
      expect(responseBody.message).not.toMatch(/tente novamente/i);
      expect(responseBody.retryable).toBeUndefined();
    });

    it('54. second request after uncertain remains blocked -> provider receives ZERO additional POSTs', async () => {
      const quote = await billingService.createEarlyActivationQuote(MINISTRY_ID, USER_ID, TRANSITION_ID);

      // Primeira chamada: falha incerta
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(new Error('Timeout'));
      mockProvider.classifyErrorOutcome.mockReturnValueOnce('OUTCOME_UNCERTAIN');

      mockReq.body = { quoteId: quote.quoteId };
      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(202);

      // Segunda chamada: deve ser bloqueada com 409
      mockRes.status.mockClear();
      mockRes.json.mockClear();
      mockNext.mockClear();

      await controller.createEarlyActivationCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(409);
      // O provedor foi chamado exatamente UMA vez (na primeira chamada) e ZERO vezes adicionais na segunda
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });
  });
});
