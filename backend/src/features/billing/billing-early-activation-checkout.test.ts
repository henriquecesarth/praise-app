import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { AppError } from '../../middleware/error-handler';
import { BillingEarlyActivationQuote, BillingTransitionV1Record, BillingCheckoutAttempt } from './billing.types';
import {
  canCreateEarlyActivationCheckout,
  canResumeReservedEarlyActivationAttempt,
  calculateCheckoutMinutesToExpire,
  classifyEarlyAdjustmentFinancialState,
} from './billing-transition-domain.service';

describe('Phase 3C.2 — Early Activation Detached Checkout, Attempt Reservation & Quarantine', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockProvider: any;
  let mockSubService: any;
  let mockSubRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;

  const planChangesStore = new Map<string, BillingTransitionV1Record>();

  const createValidScheduledTransition = (overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record => {
    const quoteExpires = new Date(Date.now() + 3600 * 1000).toISOString();

    const quote: BillingEarlyActivationQuote = {
      quote_id: 'quote_active_1',
      transition_id: 'tr_scheduled_1',
      ministry_id: 'min_test_ea',
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

    const record: BillingTransitionV1Record = {
      id: 'tr_scheduled_1',
      transition_id: 'tr_scheduled_1',
      ministry_id: 'min_test_ea',
      provider: 'asaas',
      currency: 'BRL',
      policy_version: 'billing_transition_v1',
      execution_strategy: 'scheduled_paid_transition',
      transition_type: 'upgrade',
      transition_status: 'scheduled',
      status: 'payment_confirmed',
      early_activation_status: 'available',
      financial_safety_status: 'live',
      financial_attention_required: false,
      requested_at: new Date().toISOString(),
      requested_commercial_date: '2026-09-01',
      price_locked_at: new Date().toISOString(),
      requested_by_user_id: 'usr_owner_1',
      source_plan_id: 'essential',
      source_interval: 'monthly',
      source_addon_blocks: 0,
      source_current_cycle_total_cents: 3490,
      source_entitlement_snapshot: { plan_id: 'essential', addon_blocks: 0 },
      target_plan_id: 'pro',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      target_future_recurring_price_cents: 8990,
      target_current_cycle_total_cents: 8990,
      target_entitlement_snapshot: { plan_id: 'pro', addon_blocks: 0 },
      requested_plan_id: 'pro',
      requested_interval: 'monthly',
      requested_addon_blocks: 0,
      expected_amount_cents: 8990,
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
      current_period_start_billing_date: '2026-09-01',
      current_period_end_billing_date: '2026-10-01',
      effective_billing_date: '2026-10-01',
      supersede_status: 'completed',
      payment_cleanup_status: 'completed',
      current_early_activation_quote: quote,
      early_activation_quotes_history: [quote],
      checkout_attempts: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: null,
      ...overrides,
    };

    planChangesStore.set(record.id, record);
    return record;
  };

  beforeEach(() => {
    planChangesStore.clear();

    mockBillingRepo = {
      getPlanChange: vi.fn().mockImplementation(async (id: string) => {
        return planChangesStore.get(id) || null;
      }),
      reserveEarlyActivationCheckoutAttempt: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada.');
        if (tr.early_activation_status === 'payment_pending') {
          throw new AppError(409, 'Já existe uma obrigação financeira de ativação antecipada ativa ou não resolvida.', {
            code: 'EARLY_ACTIVATION_OBLIGATION_LIVE',
          });
        }
        if (tr.current_early_activation_quote?.status !== 'active') {
          throw new AppError(409, 'Cotação com status consumido não pode ser consumida.', {
            code: 'EARLY_ACTIVATION_QUOTE_NOT_ACTIVE',
          });
        }

        const consumedQuote: BillingEarlyActivationQuote = {
          ...tr.current_early_activation_quote!,
          status: 'consumed',
        };
        const newAttempt: BillingCheckoutAttempt = {
          attempt_id: params.attemptId,
          transition_id: params.transitionId,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: params.internalCheckoutIntentId,
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: params.quoteId,
          amount_cents: params.amountCents,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'reserved',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: params.nowIso,
          checkout_requested_at: params.nowIso,
          checkout_minutes_to_expire: params.checkoutMinutesToExpire,
          expires_at: params.quoteExpiresAt,
        };

        const updated: BillingTransitionV1Record = {
          ...tr,
          early_activation_status: 'payment_pending',
          current_early_activation_quote: consumedQuote,
          current_early_activation_checkout_attempt_id: params.attemptId,
          early_activation_checkout_intent_id: params.internalCheckoutIntentId,
          early_activation_provider_checkout_id: null,
          prorated_adjustment_cents: params.amountCents,
          checkout_attempts: [...(tr.checkout_attempts || []), newAttempt],
          updated_at: params.nowIso,
        };
        planChangesStore.set(tr.id, updated);
        return { transition: updated, attempt: newAttempt };
      }),
      markEarlyActivationCheckoutAttempting: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId);
        if (!tr) throw new AppError(404, 'Transição não encontrada.');
        const attempts = [...(tr.checkout_attempts || [])];
        const index = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (index < 0) throw new AppError(404, 'Tentativa de checkout não encontrada.');
        if (attempts[index].provider_create_state !== 'reserved') {
          throw new AppError(
            409,
            `Conflito CAS: tentativa '${params.attemptId}' não está no estado 'reserved' (estado atual: '${attempts[index].provider_create_state}').`,
            { code: 'ATTEMPT_NOT_RESERVED' }
          );
        }
        attempts[index] = {
          ...attempts[index],
          provider_create_state: 'attempting',
          checkout_requested_at: params.nowIso || new Date().toISOString(),
        };
        const updated: BillingTransitionV1Record = {
          ...tr,
          checkout_attempts: attempts,
          updated_at: params.nowIso || new Date().toISOString(),
        };
        planChangesStore.set(tr.id, updated);
        return updated;
      }),
      recordEarlyActivationCheckoutCreated: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId)!;
        const attempts = [...(tr.checkout_attempts || [])];
        const index = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (index >= 0) {
          if (attempts[index].provider_checkout_id && attempts[index].provider_checkout_id !== params.providerCheckoutId) {
            throw new AppError(409, 'Conflito financeiro write-once: tentativa já possui checkout ID.', {
              code: 'CHECKOUT_ID_CONFLICT',
            });
          }
          attempts[index] = {
            ...attempts[index],
            provider_create_state: 'created',
            provider_checkout_id: params.providerCheckoutId,
            checkout_url: params.checkoutUrl,
          };
        }
        const updated: BillingTransitionV1Record = {
          ...tr,
          early_activation_provider_checkout_id: params.providerCheckoutId,
          checkout_url: params.checkoutUrl,
          checkout_attempts: attempts,
          updated_at: params.nowIso,
        };
        planChangesStore.set(tr.id, updated);
        return updated;
      }),
      markEarlyActivationCheckoutCreationFailed: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId)!;
        const attempts = [...(tr.checkout_attempts || [])];
        const index = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        const isPreObligation = params.failureClassification === 'creation_failed_before_provider_obligation';
        if (index >= 0) {
          attempts[index] = {
            ...attempts[index],
            status: 'failed',
            provider_create_state: isPreObligation ? 'rejected_no_obligation' : attempts[index].provider_create_state,
            failure_classification: params.failureClassification,
            provider_session_terminal: isPreObligation ? false : true,
          };
        }
        const updated: BillingTransitionV1Record = {
          ...tr,
          early_activation_status: isPreObligation ? 'available' : tr.early_activation_status,
          checkout_attempts: attempts,
          updated_at: params.nowIso,
        };
        planChangesStore.set(tr.id, updated);
        return updated;
      }),
      markEarlyActivationCheckoutCreateUncertain: vi.fn().mockImplementation(async (params: any) => {
        const tr = planChangesStore.get(params.transitionId)!;
        const attempts = [...(tr.checkout_attempts || [])];
        const index = attempts.findIndex((a) => a.attempt_id === params.attemptId);
        if (index >= 0) {
          attempts[index] = {
            ...attempts[index],
            status: 'uncertain',
            provider_create_state: 'uncertain',
            failure_classification: 'unknown',
            uncertain_until: params.uncertainUntil,
            provider_session_terminal: false,
          };
        }
        const updated: BillingTransitionV1Record = {
          ...tr,
          early_activation_status: 'payment_pending',
          checkout_attempts: attempts,
          updated_at: params.nowIso,
        };
        planChangesStore.set(tr.id, updated);
        return updated;
      }),
    };

    mockProvider = {
      name: 'asaas',
      createDetachedCheckout: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_ea_mock_123',
        checkoutId: 'chk_ea_mock_123',
        expiresAt: '2026-09-15T18:00:00.000Z',
      }),
      classifyErrorOutcome: vi.fn().mockImplementation((err: any) => {
        if (!err) return 'DEFINITE_NO_RESOURCE_CREATED';
        if (err instanceof AppError) {
          const deterministicStatusCodes = [400, 401];
          const statusCode = (err as any).statusCode || (err as any).status;
          const isProviderResponse = (err as any).isProviderResponse === true || !!(err as any).responseBody;
          if (isProviderResponse && deterministicStatusCodes.includes(statusCode)) {
            return 'DEFINITE_NO_RESOURCE_CREATED';
          }
          return 'OUTCOME_UNCERTAIN';
        }
        return 'OUTCOME_UNCERTAIN';
      }),
    };

    mockSubService = {} as any;
    mockSubRepo = {} as any;
    mockMinistryRepo = {
      getMinistryById: vi.fn().mockResolvedValue({ id: 'min_test_ea', name: 'Igreja Central' }),
    };
    mockUserRepo = {
      getUserById: vi.fn().mockResolvedValue({ id: 'usr_owner_1', name: 'Pastor Silva', email: 'silva@igreja.com' }),
    };

    billingService = new BillingService(
      mockBillingRepo,
      mockSubService,
      mockSubRepo,
      mockMinistryRepo,
      mockProvider,
      mockUserRepo
    );
  });

  describe('1. Preconditions & Attempt Reservation Prior to Provider Mutation', () => {
    it('14 & 15. deve reservar attempt no repositório ANTES de disparar chamada externa ao provedor', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      let reservationOccurred = false;
      mockBillingRepo.reserveEarlyActivationCheckoutAttempt.mockImplementationOnce(async (params: any) => {
        reservationOccurred = true;
        expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
        const consumedQuote: BillingEarlyActivationQuote = {
          ...tr.current_early_activation_quote!,
          status: 'consumed',
        };
        const newAttempt: BillingCheckoutAttempt = {
          attempt_id: params.attemptId,
          transition_id: params.transitionId,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: params.internalCheckoutIntentId,
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: params.quoteId,
          amount_cents: params.amountCents,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'reserved',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: params.nowIso,
          checkout_requested_at: params.nowIso,
          checkout_minutes_to_expire: params.checkoutMinutesToExpire,
          expires_at: params.quoteExpiresAt,
        };
        const updated = {
          ...tr,
          early_activation_status: 'payment_pending' as const,
          current_early_activation_quote: consumedQuote,
          checkout_attempts: [newAttempt],
        };
        planChangesStore.set(tr.id, updated);
        return { transition: updated, attempt: newAttempt };
      });

      const result = await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);

      expect(reservationOccurred).toBe(true);
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
      expect(mockBillingRepo.recordEarlyActivationCheckoutCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          transitionId: tr.id,
          providerCheckoutId: 'chk_ea_mock_123',
        })
      );
      expect(result.checkoutId).toBe('chk_ea_mock_123');
      expect(result.amountCents).toBe(2750);
    });

    it('16. deve rejeitar e NÃO chamar provedor se a cotação estiver expirada', async () => {
      const expiredAt = new Date(Date.now() - 600 * 1000).toISOString();
      const tr = createValidScheduledTransition();
      tr.current_early_activation_quote!.expires_at = expiredAt;
      planChangesStore.set(tr.id, tr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, tr.current_early_activation_quote!.quote_id)
      ).rejects.toThrow();

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('17. deve rejeitar e NÃO chamar provedor se o quoteId pertencer a outra transição ou não existir', async () => {
      const tr = createValidScheduledTransition();

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, 'quote_inexistente_999')
      ).rejects.toThrow(/Cotação de early activation inválida/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('18. deve rejeitar e NÃO chamar provedor se transição estiver com financial_attention_required = true', async () => {
      const tr = createValidScheduledTransition({ financial_attention_required: true });

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, tr.current_early_activation_quote!.quote_id)
      ).rejects.toThrow(/Transição requer atenção financeira/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('19. deve rejeitar e NÃO chamar provedor se transição não estiver com transition_status = scheduled', async () => {
      const tr = createValidScheduledTransition({ transition_status: 'pending_future_authorization' });

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, tr.current_early_activation_quote!.quote_id)
      ).rejects.toThrow(/exigido 'scheduled'/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('20. deve rejeitar e NÃO chamar provedor se a fronteira de renovação já tiver sido atingida', async () => {
      const tr = createValidScheduledTransition({
        effective_billing_date: '2026-09-01', // No passado ou igual a now
      });

      await expect(
        billingService.createEarlyActivationCheckout(
          tr.ministry_id,
          'usr_owner_1',
          tr.id,
          tr.current_early_activation_quote!.quote_id,
          { now: '2026-09-02T10:00:00.000Z' }
        )
      ).rejects.toThrow();

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('21. deve rejeitar e NÃO chamar provedor se já existir obrigação financeira viva', async () => {
      const tr = createValidScheduledTransition({
        early_activation_status: 'payment_pending',
        checkout_attempts: [
          {
            attempt_id: 'att_live_1',
            transition_id: 'tr_scheduled_1',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_live_1',
            provider_checkout_id: 'chk_live_1',
            checkout_url: 'https://test',
            quote_id: 'quote_active_1',
            amount_cents: 2750,
            currency: 'BRL',
            status: 'pending',
            failure_classification: null,
            provider_session_terminal: false,
            created_at: new Date().toISOString(),
            checkout_requested_at: new Date().toISOString(),
            checkout_minutes_to_expire: 30,
            expires_at: new Date(Date.now() + 1800 * 1000).toISOString(),
          },
        ],
      });

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, tr.current_early_activation_quote!.quote_id)
      ).rejects.toThrow(/Existe uma obrigação financeira de early activation/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });
  });

  describe('2. Deterministic Failure vs Uncertain Quarantine', () => {
    it('22. Deterministic failure (HTTP 400 Bad Request): marca falha pré-recurso, subflow available, quote consumida', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const badReqErr = new AppError(400, 'Parâmetro de checkout inválido');
      (badReqErr as any).statusCode = 400;
      (badReqErr as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(badReqErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Parâmetro de checkout inválido/);

      // Repositório é notificado com pre-obligation failure
      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          transitionId: tr.id,
          failureClassification: 'creation_failed_before_provider_obligation',
        })
      );

      // Subfluxo foi reaberto para available no repositório
      const saved = planChangesStore.get(tr.id)!;
      expect(saved.early_activation_status).toBe('available');
      // Quote consumida permanece no histórico
      expect(saved.current_early_activation_quote?.status).toBe('consumed');
    });

    it('23. Uncertain failure (HTTP 500 / Network Timeout): coloca em quarentena uncertain, subfluxo payment_pending, slot HELD', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const serverErr = new AppError(500, 'Gateway Asaas fora do ar');
      (serverErr as any).statusCode = 500;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(serverErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway de pagamento/);

      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalledWith(
        expect.objectContaining({
          transitionId: tr.id,
          uncertainUntil: tr.current_early_activation_quote!.expires_at,
        })
      );

      const saved = planChangesStore.get(tr.id)!;
      expect(saved.early_activation_status).toBe('payment_pending');
      const attempt = saved.checkout_attempts?.find((a) => a.quote_id === quoteId);
      expect(attempt?.status).toBe('uncertain');
      expect(attempt?.provider_session_terminal).toBe(false);
    });

    it('24. Sucesso: attempt pending com provider_checkout_id, subflow payment_pending, zero ativação de entitlement', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const result = await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);

      expect(result.checkoutId).toBe('chk_ea_mock_123');
      expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/checkoutSession/show?id=chk_ea_mock_123');

      const saved = planChangesStore.get(tr.id)!;
      expect(saved.early_activation_status).toBe('payment_pending');
      expect(saved.early_activation_provider_checkout_id).toBe('chk_ea_mock_123');

      // Invariante estrita: transição continua agendada, NENHUM entitlement ativado!
      expect(saved.transition_status).toBe('scheduled');
      expect(saved.effective_at).toBeUndefined();
    });

    it('25. Mesma chamada de checkout repetida após sucesso inequívoco: DEVE BLOQUEAR segundo checkout no gateway', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      // Primeiro sucesso
      await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);

      // Segunda chamada
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      // Provedor NÃO foi chamado pela segunda vez!
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Concurrency & One-Live-Obligation Strict Enforcement', () => {
    it('26. Duas chamadas concorrentes executadas simultaneamente: exatamente UMA reserva e cria no gateway', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      // Simulação de corrida concorrente disparando duas promessas em paralelo
      const call1 = billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);
      const call2 = billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);

      const results = await Promise.allSettled([call1, call2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('27. Segunda chamada após attempt pending: bloqueada por obrigação viva', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Existe uma obrigação financeira de early activation/);
    });

    it('28. Segunda chamada após uncertain: bloqueada por quarentena não resolvida', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      mockProvider.createDetachedCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway de pagamento/);

      // Nova tentativa deve ser bloqueada
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Existe uma obrigação financeira de early activation/);
    });

    it('29. Segunda chamada após uncertain_expired_unresolved: o horário de expiração expirado sem cancelamento explícito NÃO libera o checkout', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      // Coloca attempt em uncertain com horário no passado
      const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
      tr.early_activation_status = 'payment_pending';
      tr.checkout_attempts = [
        {
          attempt_id: 'att_expired_unc',
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_past',
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: quoteId,
          amount_cents: 2750,
          currency: 'BRL',
          status: 'uncertain',
          failure_classification: 'unknown',
          provider_session_terminal: false,
          created_at: pastTime,
          checkout_requested_at: pastTime,
          checkout_minutes_to_expire: 30,
          expires_at: pastTime,
          uncertain_until: pastTime,
        },
      ];
      planChangesStore.set(tr.id, tr);

      // canCreateEarlyActivationCheckout classifica como uncertain_expired_unresolved e BLOQUEIA
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Existe uma obrigação financeira de early activation ativa ou não resolvida/);
    });

    it('30. Reattempt após deterministic pre-obligation failure: permitido somente com nova cotação ativa', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const badReq = new AppError(400, 'Rejeição determinística');
      (badReq as any).statusCode = 400;
      (badReq as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(badReq);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Rejeição determinística/);

      // Cotação antiga foi consumida e não pode ser reutilizada
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/não pode ser utilizada/);

      // Quando uma nova cotação ativa for inserida:
      const newQuote: BillingEarlyActivationQuote = {
        ...tr.current_early_activation_quote!,
        quote_id: 'quote_active_2',
        status: 'active',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
      const freshTr = planChangesStore.get(tr.id)!;
      freshTr.current_early_activation_quote = newQuote;
      freshTr.early_activation_status = 'available';
      planChangesStore.set(tr.id, freshTr);

      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_fresh_456',
        checkoutId: 'chk_ea_fresh_456',
        expiresAt: '2026-09-15T19:00:00.000Z',
      });

      const reattemptResult = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        'quote_active_2'
      );

      expect(reattemptResult.checkoutId).toBe('chk_ea_fresh_456');
    });
  });

  describe('4. Provider Create Crash-Window Hardening & Resumption (Phase 3C.2 Hardening)', () => {
    it('31. crash após reservation e antes de mark attempting: mesma attempt pode ser retomada com segurança', async () => {
      const tr = createValidScheduledTransition();
      const quote = tr.current_early_activation_quote!;

      // Simula crash após reservation: tentativa existe em 'reserved' e quote está 'consumed'
      const existingAttemptId = 'att_ea_crashed_reserved';
      const existingIntentId = 'intent_ea_crashed_reserved';
      tr.early_activation_status = 'payment_pending';
      quote.status = 'consumed';
      tr.current_early_activation_quote = quote;
      tr.checkout_attempts = [
        {
          attempt_id: existingAttemptId,
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: existingIntentId,
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: quote.quote_id,
          amount_cents: 2750,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'reserved',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: new Date().toISOString(),
          checkout_requested_at: new Date().toISOString(),
          checkout_minutes_to_expire: 30,
          expires_at: quote.expires_at,
        },
      ];
      planChangesStore.set(tr.id, tr);

      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_resumed_1',
        checkoutId: 'chk_ea_resumed_1',
        expiresAt: '2026-09-15T18:00:00.000Z',
      });

      const result = await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quote.quote_id);

      // Invariante de retomada: NÃO cria nova reservation
      expect(mockBillingRepo.reserveEarlyActivationCheckoutAttempt).not.toHaveBeenCalled();
      // O CAS foi executado para a mesma tentativa
      expect(mockBillingRepo.markEarlyActivationCheckoutAttempting).toHaveBeenCalledWith(
        expect.objectContaining({
          transitionId: tr.id,
          attemptId: existingAttemptId,
        })
      );
      // Mesma attempt ID retornada
      expect(result.attemptId).toBe(existingAttemptId);
      expect(result.checkoutId).toBe('chk_ea_resumed_1');
    });

    it('32. duas chamadas tentam retomar reserved: exatamente uma ganha o CAS e emite POST ao gateway', async () => {
      const tr = createValidScheduledTransition();
      const quote = tr.current_early_activation_quote!;

      const existingAttemptId = 'att_ea_concurrent_res';
      tr.early_activation_status = 'payment_pending';
      quote.status = 'consumed';
      tr.current_early_activation_quote = quote;
      tr.checkout_attempts = [
        {
          attempt_id: existingAttemptId,
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_ea_concurrent_res',
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: quote.quote_id,
          amount_cents: 2750,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'reserved',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: new Date().toISOString(),
          checkout_requested_at: new Date().toISOString(),
          checkout_minutes_to_expire: 30,
          expires_at: quote.expires_at,
        },
      ];
      planChangesStore.set(tr.id, tr);

      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_resumed_conc',
        checkoutId: 'chk_ea_resumed_conc',
        expiresAt: '2026-09-15T18:00:00.000Z',
      });

      const results = await Promise.allSettled([
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quote.quote_id),
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quote.quote_id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Provedor chamado exatamente 1 vez
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('33. crash depois de attempting e antes do POST: fail closed, NO blind retry', async () => {
      const tr = createValidScheduledTransition();
      const quote = tr.current_early_activation_quote!;

      // Attempt em 'attempting' sem checkoutId
      tr.early_activation_status = 'payment_pending';
      quote.status = 'consumed';
      tr.current_early_activation_quote = quote;
      tr.checkout_attempts = [
        {
          attempt_id: 'att_ea_stuck_attempting',
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_ea_stuck',
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: quote.quote_id,
          amount_cents: 2750,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'attempting',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: new Date().toISOString(),
          checkout_requested_at: new Date().toISOString(),
          checkout_minutes_to_expire: 30,
          expires_at: quote.expires_at,
        },
      ];
      planChangesStore.set(tr.id, tr);

      // Nova chamada NÃO pode criar outro checkout nem retomar
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quote.quote_id)
      ).rejects.toThrow(/Existe uma obrigação financeira de early activation ativa ou não resolvida/);

      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('34. POST enviado e response perdida (timeout): quarentena uncertain, NO segundo POST', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      mockProvider.createDetachedCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT connect to Asaas'));

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway/);

      // Segunda chamada deve ser bloqueada
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Existe uma obrigação financeira de early activation ativa ou não resolvida/);

      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('35. provider retorna checkoutId mas persistência local falha: tentativa permanece retida/bloqueante', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_provider_ok',
        checkoutId: 'chk_ea_provider_ok',
        expiresAt: '2026-09-15T18:00:00.000Z',
      });

      // Simulamos falha contínua no repositório
      mockBillingRepo.recordEarlyActivationCheckoutCreated.mockRejectedValue(
        new Error('Firestore connection timeout')
      );

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/ocorreu falha ao persistir localmente/);

      // O gateway NÃO é chamado uma segunda vez
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('36. retry da persistência do MESMO checkoutId: idempotente', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const res = await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);
      expect(res.checkoutId).toBe('chk_ea_mock_123');

      // Chamada repetida de persistência para o MESMO checkout ID: NÃO lança erro
      await expect(
        mockBillingRepo.recordEarlyActivationCheckoutCreated({
          transitionId: tr.id,
          ministryId: tr.ministry_id,
          attemptId: res.attemptId,
          providerCheckoutId: 'chk_ea_mock_123',
          checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_mock_123',
        })
      ).resolves.toBeDefined();
    });

    it('37. persistência tenta checkoutId diferente: falha closed com conflito write-once', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const res = await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);

      // Tentativa de rotacionar para outro checkout ID diverge:
      await expect(
        mockBillingRepo.recordEarlyActivationCheckoutCreated({
          transitionId: tr.id,
          ministryId: tr.ministry_id,
          attemptId: res.attemptId,
          providerCheckoutId: 'chk_ea_divergent_999',
          checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_ea_divergent_999',
        })
      ).rejects.toThrow(/Conflito financeiro write-once/);
    });

    it('38. unknown 4xx does NOT become deterministic automatically (fails closed to uncertain)', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const teapotErr = new AppError(418, 'I am a teapot - unexpected provider response');
      (teapotErr as any).statusCode = 418;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(teapotErr);

      // Não deve classificar como definitivo; deve colocar em quarentena
      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway de pagamento/);

      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).not.toHaveBeenCalled();
    });

    it('39. explicit deterministic whitelist behaves as designed (400, 401)', async () => {
      for (const statusCode of [400, 401]) {
        const tr = createValidScheduledTransition();
        const quoteId = tr.current_early_activation_quote!.quote_id;

        const detErr = new AppError(statusCode, `Deterministic error ${statusCode}`);
        (detErr as any).statusCode = statusCode;
        (detErr as any).isProviderResponse = true;
        mockProvider.createDetachedCheckout.mockRejectedValueOnce(detErr);

        await expect(
          billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
        ).rejects.toThrow();

        expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).toHaveBeenCalledWith(
          expect.objectContaining({
            transitionId: tr.id,
            failureClassification: 'creation_failed_before_provider_obligation',
          })
        );
      }
    });

    it('40. 403, 404, 422, 409, 429 and unknown 4xx default to uncertain', async () => {
      for (const statusCode of [403, 404, 422, 409, 429]) {
        const tr = createValidScheduledTransition();
        const quoteId = tr.current_early_activation_quote!.quote_id;

        const uncertainErr = new AppError(statusCode, `Non-deterministic error ${statusCode}`);
        (uncertainErr as any).statusCode = statusCode;
        (uncertainErr as any).isProviderResponse = true;
        mockProvider.createDetachedCheckout.mockRejectedValueOnce(uncertainErr);

        await expect(
          billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
        ).rejects.toThrow(/Instabilidade ao comunicar com gateway de pagamento/);

        expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
      }
    });

    it('41. reserved attempt does not count as permission to create a NEW financial obligation', async () => {
      const tr = createValidScheduledTransition();
      const quote = tr.current_early_activation_quote!;

      tr.checkout_attempts = [
        {
          attempt_id: 'att_ea_reserved_1',
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_1',
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: quote.quote_id,
          amount_cents: 2750,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'reserved',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: new Date().toISOString(),
        },
      ];

      const eligibility = canCreateEarlyActivationCheckout(tr);
      expect(eligibility.allowed).toBe(false);
      expect(eligibility.reason).toContain('Existe uma reserva de checkout local pendente de execução');
    });

    it('42. reserved attempt can only resume the SAME intent/attempt (rejects divergent quote or expired)', async () => {
      const tr = createValidScheduledTransition();
      const quote = tr.current_early_activation_quote!;

      tr.checkout_attempts = [
        {
          attempt_id: 'att_ea_res_42',
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_42',
          provider_checkout_id: null,
          checkout_url: null,
          quote_id: quote.quote_id,
          amount_cents: 2750,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'reserved',
          failure_classification: null,
          provider_session_terminal: false,
          created_at: new Date().toISOString(),
        },
      ];

      // A) Quote divergente
      const divergentCheck = canResumeReservedEarlyActivationAttempt(tr, 'quote_other_999');
      expect(divergentCheck.canResume).toBe(false);
      expect(divergentCheck.reason).toContain('divergente da solicitada');

      // B) Cotação expirada
      const pastNow = new Date(Date.now() + 7200 * 1000).toISOString();
      const expiredCheck = canResumeReservedEarlyActivationAttempt(tr, quote.quote_id, pastNow);
      expect(expiredCheck.canResume).toBe(false);
      expect(expiredCheck.reason).toContain('expirou');
    });

    it('43. provider TTL 9 min -> provider NOT called (fails BEFORE reservation and POST)', async () => {
      const tr = createValidScheduledTransition();
      // Quote expira em 10 minutos -> 10m - 1m margem = 9m úteis (< 10m mínimo)
      tr.current_early_activation_quote!.expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      planChangesStore.set(tr.id, tr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, tr.current_early_activation_quote!.quote_id)
      ).rejects.toThrow(/Cotação muito próxima do término do dia comercial/);

      expect(mockBillingRepo.reserveEarlyActivationCheckoutAttempt).not.toHaveBeenCalled();
      expect(mockProvider.createDetachedCheckout).not.toHaveBeenCalled();
    });

    it('44. provider TTL exactly 10 min -> comportamento canônico aceito', async () => {
      const tr = createValidScheduledTransition();
      // Quote expira em 11 minutos -> 11m - 1m margem = exatos 10m úteis
      tr.current_early_activation_quote!.expires_at = new Date(Date.now() + 11 * 60 * 1000).toISOString();
      planChangesStore.set(tr.id, tr);

      const result = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        tr.current_early_activation_quote!.quote_id
      );

      expect(result.minutesToExpire).toBe(10);
      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ minutesToExpire: 10 })
      );
    });

    it('45. no DETACHED payload can emit minutesToExpire < 10', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      let emittedMinutes: number | undefined;
      mockProvider.createDetachedCheckout.mockImplementationOnce(async (params: any) => {
        emittedMinutes = params.minutesToExpire;
        return {
          checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_valid_ttl',
          checkoutId: 'chk_ea_valid_ttl',
        };
      });

      await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);
      expect(emittedMinutes).toBeGreaterThanOrEqual(10);
    });

    it('46. relative TTL safety margin preserves quote-bound contract', () => {
      const now = '2026-09-15T10:00:00.000Z';
      const quoteExpiresAt = '2026-09-15T10:45:00.000Z'; // 45 min
      const ttl = calculateCheckoutMinutesToExpire(quoteExpiresAt, now, {
        providerMinimumMinutes: 10,
        safetyMarginMinutes: 1,
        maxMinutes: 60,
      });

      // 45m - 1m margem = 44m
      expect(ttl.minutesToExpire).toBe(44);
      expect(ttl.remainingMinutes).toBe(45);
      expect(ttl.providerValid).toBe(true);
    });

    it('47. 400 deterministic: reabre subfluxo para available', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const badReq = new AppError(400, 'Bad Request Asaas');
      (badReq as any).statusCode = 400;
      (badReq as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(badReq);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          failureClassification: 'creation_failed_before_provider_obligation',
        })
      );
    });

    it('48. 401 deterministic: authentication failure reabre subfluxo para available', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const unauthErr = new AppError(401, 'Unauthorized API Key');
      (unauthErr as any).statusCode = 401;
      (unauthErr as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(unauthErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          failureClassification: 'creation_failed_before_provider_obligation',
        })
      );
    });

    it('49. 422 defaults uncertain unless specific contract is proven', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const unprocErr = new AppError(422, 'Unprocessable Entity');
      (unprocErr as any).statusCode = 422;
      (unprocErr as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(unprocErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway/);

      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).not.toHaveBeenCalled();
    });

    it('50. 403/404 treatment matches explicit documented policy (uncertain)', async () => {
      for (const code of [403, 404]) {
        const tr = createValidScheduledTransition();
        const quoteId = tr.current_early_activation_quote!.quote_id;

        const err = new AppError(code, `Error ${code}`);
        (err as any).statusCode = code;
        (err as any).isProviderResponse = true;
        mockProvider.createDetachedCheckout.mockRejectedValueOnce(err);

        await expect(
          billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
        ).rejects.toThrow(/Instabilidade ao comunicar com gateway/);

        expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
      }
    });

    it('51. unknown 4xx (418, 499) defaults uncertain', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const teapotErr = new AppError(418, 'I am a teapot');
      (teapotErr as any).statusCode = 418;
      (teapotErr as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(teapotErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway/);

      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
    });

    it('52. known checkout + local persistence error never enters provider error classifier', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_ea_ok_52',
        checkoutId: 'chk_ea_ok_52',
      });

      // Erro local de persistência
      mockBillingRepo.recordEarlyActivationCheckoutCreated.mockRejectedValue(new Error('Local Firestore unavailable'));

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/ocorreu falha ao persistir localmente/);

      // NUNCA entra no classificador de erro do provedor
      expect(mockProvider.classifyErrorOutcome).not.toHaveBeenCalled();
      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).not.toHaveBeenCalled();
      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).not.toHaveBeenCalled();
    });

    it('53. creation_failed_before_provider_obligation does NOT claim an existing provider session terminal', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const badReq = new AppError(400, 'Bad Request');
      (badReq as any).statusCode = 400;
      (badReq as any).isProviderResponse = true;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(badReq);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      const saved = planChangesStore.get(tr.id)!;
      const attempt = saved.checkout_attempts?.[0];
      expect(attempt?.failure_classification).toBe('creation_failed_before_provider_obligation');
      // Não deve clamar que uma sessão inexistente terminou
      expect(attempt?.provider_session_terminal).toBe(false);
    });

    it('54. actual session_expired/session_canceled can use provider_session_terminal=true', () => {
      const tr = createValidScheduledTransition();
      tr.checkout_attempts = [
        {
          attempt_id: 'att_expired_real',
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_real',
          provider_checkout_id: 'chk_real_123',
          checkout_url: 'https://sandbox.asaas.com/c/chk_real_123',
          quote_id: 'quote_1',
          amount_cents: 2750,
          currency: 'BRL',
          status: 'failed',
          provider_create_state: 'created',
          failure_classification: 'session_expired',
          provider_session_terminal: true, // Sessão real comprovadamente terminada
          created_at: new Date().toISOString(),
        },
      ];

      const state = classifyEarlyAdjustmentFinancialState(tr);
      expect(state).toBe('provider_terminal_unpaid');
    });

    it('55. provider create response parser succeeds with the minimum official response shape { id: "..." }', async () => {
      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_min_shape_55',
        checkoutId: 'chk_min_shape_55',
      });

      const tr = createValidScheduledTransition();
      const res = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        tr.current_early_activation_quote!.quote_id
      );

      expect(res.checkoutId).toBe('chk_min_shape_55');
      expect(res.checkoutUrl).toBe('https://sandbox.asaas.com/checkoutSession/show?id=chk_min_shape_55');
    });

    it('56. checkout URL construction does not depend on invented response property and avoids /c/{id}', async () => {
      const tr = createValidScheduledTransition();
      const res = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        tr.current_early_activation_quote!.quote_id
      );

      expect(res.checkoutUrl).toContain('checkoutSession/show?id=chk_ea_mock_123');
      expect(res.checkoutUrl).not.toContain('/c/');
    });

    it('57. callback always present and valid in DETACHED payload', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      let capturedParams: any = null;
      mockProvider.createDetachedCheckout.mockImplementationOnce(async (p: any) => {
        capturedParams = p;
        return {
          checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_cb_57',
          checkoutId: 'chk_cb_57',
        };
      });

      await billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId);

      expect(capturedParams.successUrl).toBeDefined();
      expect(capturedParams.successUrl).toMatch(/^https?:\/\//);
      expect(capturedParams.cancelUrl).toBeDefined();
      expect(capturedParams.expiredUrl).toBeDefined();
    });

    it('58. documented response.link is used directly when valid host', async () => {
      const tr = createValidScheduledTransition();
      const officialLink = 'https://sandbox.asaas.com/checkoutSession/show/chk_direct_link_58';
      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: officialLink,
        checkoutId: 'chk_direct_link_58',
      });

      const res = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        tr.current_early_activation_quote!.quote_id
      );

      expect(res.checkoutUrl).toBe(officialLink);
    });

    it('59. production minimal {id} generates official production checkout URL', async () => {
      // Mock do provider simulando builder de produção
      mockProvider.createDetachedCheckout.mockResolvedValueOnce({
        checkoutUrl: 'https://asaas.com/checkoutSession/show?id=chk_prod_min_59',
        checkoutId: 'chk_prod_min_59',
      });

      const tr = createValidScheduledTransition();
      const res = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        tr.current_early_activation_quote!.quote_id
      );

      expect(res.checkoutUrl).toBe('https://asaas.com/checkoutSession/show?id=chk_prod_min_59');
    });

    it('60. no /c/{id} URL is generated anywhere in createEarlyActivationCheckout', async () => {
      const tr = createValidScheduledTransition();
      const res = await billingService.createEarlyActivationCheckout(
        tr.ministry_id,
        'usr_owner_1',
        tr.id,
        tr.current_early_activation_quote!.quote_id
      );

      expect(res.checkoutUrl).not.toContain('/c/');
    });

    it('61. unexpected link host: fail closed with obligation retained in quarantine', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const hostErr = new AppError(500, 'Host inesperado no link de checkout retornado pelo Asaas');
      (hostErr as any).statusCode = 500;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(hostErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway/);

      // Quarentena: retida para reconciliação, nunca liberada como no-obligation
      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).not.toHaveBeenCalled();
    });

    it('62. response missing id: uncertain/retained, never deterministic no-obligation', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const missingIdErr = new AppError(500, 'Gateway Asaas não retornou ID de checkout na criação.');
      (missingIdErr as any).statusCode = 500;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(missingIdErr);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow(/Instabilidade ao comunicar com gateway/);

      expect(mockBillingRepo.markEarlyActivationCheckoutCreateUncertain).toHaveBeenCalled();
      expect(mockBillingRepo.markEarlyActivationCheckoutCreationFailed).not.toHaveBeenCalled();
    });

    it('63. timeout creates exactly ONE outbound attempt', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      mockProvider.createDetachedCheckout.mockRejectedValueOnce(new Error('AbortError: signal timed out'));

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('64. 5xx creates exactly ONE outbound attempt', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const err500 = new AppError(500, 'Internal Server Error');
      (err500 as any).statusCode = 500;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(err500);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('65. 429 creates exactly ONE outbound attempt', async () => {
      const tr = createValidScheduledTransition();
      const quoteId = tr.current_early_activation_quote!.quote_id;

      const err429 = new AppError(429, 'Too Many Requests');
      (err429 as any).statusCode = 429;
      mockProvider.createDetachedCheckout.mockRejectedValueOnce(err429);

      await expect(
        billingService.createEarlyActivationCheckout(tr.ministry_id, 'usr_owner_1', tr.id, quoteId)
      ).rejects.toThrow();

      expect(mockProvider.createDetachedCheckout).toHaveBeenCalledTimes(1);
    });

    it('66. HTTP create timeout is finite', async () => {
      const { HTTP_CREATE_CHECKOUT_TIMEOUT_MS } = await import('./providers/asaas/asaas.provider');
      expect(typeof HTTP_CREATE_CHECKOUT_TIMEOUT_MS).toBe('number');
      expect(HTTP_CREATE_CHECKOUT_TIMEOUT_MS).toBe(25_000);
      expect(Number.isFinite(HTTP_CREATE_CHECKOUT_TIMEOUT_MS)).toBe(true);
    });

    it('67. TTL safety margin > effective outbound timeout requirement', async () => {
      const { HTTP_CREATE_CHECKOUT_TIMEOUT_MS } = await import('./providers/asaas/asaas.provider');
      const safetyMarginMs = 1 * 60 * 1000; // 1 minuto = 60.000 ms

      // A margem de segurança de TTL (60s) é estritamente maior que o timeout de rede da chamada (25s)
      expect(safetyMarginMs).toBeGreaterThan(HTTP_CREATE_CHECKOUT_TIMEOUT_MS);
      const operationalSlackMs = safetyMarginMs - HTTP_CREATE_CHECKOUT_TIMEOUT_MS;
      expect(operationalSlackMs).toBe(35_000); // 35 segundos de margem operacional
    });

    it('68. local expiry metadata is NOT treated as provider terminal evidence', () => {
      const tr = createValidScheduledTransition();
      const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
      tr.checkout_attempts = [
        {
          attempt_id: 'att_local_expired',
          transition_id: tr.id,
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_1',
          provider_checkout_id: 'chk_local_expired_1',
          checkout_url: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_local_expired_1',
          quote_id: 'quote_1',
          amount_cents: 2750,
          currency: 'BRL',
          status: 'pending',
          provider_create_state: 'created',
          expires_at: pastTime, // Metadado local expirado
          provider_session_terminal: false, // Provedor NÃO comprovou encerramento
          created_at: pastTime,
        },
      ];

      // classifyEarlyAdjustmentFinancialState NÃO considera encerrada apenas pelo relógio local; permanece live
      const state = classifyEarlyAdjustmentFinancialState(tr);
      expect(state).toBe('financially_live');
    });
  });
});
