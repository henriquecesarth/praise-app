import { describe, it, expect } from 'vitest';
import {
  validateTargetContract,
  resolveEffectiveCapabilities,
  compareCapabilities,
  classifyTransition,
  commercialDaysBetween,
  roundHalfUpDivide,
  buildTransitionCommercialSnapshot,
  calculateProration,
  createEarlyActivationQuote,
  classifyCapabilityEligibility,
  calculateCheckoutMinutesToExpire,
  classifyEarlyAdjustmentFinancialState,
  isEarlyAdjustmentObligationFinanciallyLive,
  canCreateEarlyActivationCheckout,
  isEarlyActivationBoundarySafe,
  validateEarlyActivationCompletion,
} from './billing-transition-domain.service';
import {
  SourceContractInput,
  TargetContractRequest,
} from './billing-transition-domain.types';
import {
  BillingTransitionV1Record,
  BillingCheckoutAttempt,
  BillingTransactionRecord,
} from './billing.types';
import { PLANS_CATALOG } from '../../config/plans.config';

describe('Billing Transition Domain — Phase 2.1 Execution Strategy & Pure Entitlement Hardening', () => {
  // --------------------------------------------------------------------------
  // 1. Target Validation & Addon Auditing
  // --------------------------------------------------------------------------
  describe('1. Target Validation', () => {
    it('deve aceitar contratos de destino válidos do catálogo', () => {
      expect(() =>
        validateTargetContract({
          plan_id: 'pro',
          interval: 'monthly',
          addon_blocks: 2,
        })
      ).not.toThrow();

      expect(() =>
        validateTargetContract({
          plan_id: 'essential',
          interval: 'annual',
          addon_blocks: 4,
        })
      ).not.toThrow();
    });

    it('deve REJEITAR plano de destino inexistente no catálogo', () => {
      expect(() =>
        validateTargetContract({
          plan_id: 'invalid_tier' as any,
          interval: 'monthly',
          addon_blocks: 0,
        })
      ).toThrow(/não encontrado no catálogo/i);
    });

    it('deve REJEITAR intervalo de faturamento inválido', () => {
      expect(() =>
        validateTargetContract({
          plan_id: 'pro',
          interval: 'weekly' as any,
          addon_blocks: 0,
        })
      ).toThrow(/Intervalo de faturamento.*inválido/i);
    });

    it('deve REJEITAR add-ons em planos que não suportam add-ons (ex: Free, Lite, Premium)', () => {
      expect(() =>
        validateTargetContract({
          plan_id: 'lite',
          interval: 'monthly',
          addon_blocks: 1,
        })
      ).toThrow(/não suporta blocos adicionais/i);

      expect(() =>
        validateTargetContract({
          plan_id: 'premium',
          interval: 'monthly',
          addon_blocks: 1,
        })
      ).toThrow(/não suporta blocos adicionais/i);
    });

    it('deve REJEITAR quantidade de add-ons negativa ou superior ao limite do plano', () => {
      expect(() =>
        validateTargetContract({
          plan_id: 'essential',
          interval: 'monthly',
          addon_blocks: -1,
        })
      ).toThrow(/maior ou igual a zero/i);

      expect(() =>
        validateTargetContract({
          plan_id: 'essential',
          interval: 'monthly',
          addon_blocks: 5, // Essential max is 4
        })
      ).toThrow(/suporta no máximo 4 blocos/i);
    });

    it('deve auditar e confirmar que o preço anual de add-ons existe no catálogo', () => {
      expect(PLANS_CATALOG.essential.addonBlockAnnualPriceCents).toBeGreaterThan(0);
      expect(PLANS_CATALOG.pro.addonBlockAnnualPriceCents).toBeGreaterThan(0);

      expect(() =>
        validateTargetContract({
          plan_id: 'essential',
          interval: 'annual',
          addon_blocks: 2,
        })
      ).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Pure Entitlement Capabilities vs Commercial Features & Catalog Ladder
  // --------------------------------------------------------------------------
  describe('2. Entitlement Capabilities vs Commercial Features', () => {
    it('deve resolver quotas de membros e músicas puras sem poluir com flags de compra', () => {
      const proCap = resolveEffectiveCapabilities('pro', 0);
      expect(proCap).toEqual({ members: 100, songs: 500 });

      const premiumCap = resolveEffectiveCapabilities('premium', 0);
      expect(premiumCap).toEqual({ members: 300, songs: 1500 });
    });

    it('Pro -> Premium deve ser estritamente TARGET_STRICTLY_GREATER (não distorcido por allowMemberAddons)', () => {
      const proCap = resolveEffectiveCapabilities('pro', 0);
      const premiumCap = resolveEffectiveCapabilities('premium', 0);

      expect(compareCapabilities(proCap, premiumCap)).toBe('TARGET_STRICTLY_GREATER');
    });

    it('Premium -> Pro deve ser estritamente TARGET_STRICTLY_LOWER', () => {
      const proCap = resolveEffectiveCapabilities('pro', 0);
      const premiumCap = resolveEffectiveCapabilities('premium', 0);

      expect(compareCapabilities(premiumCap, proCap)).toBe('TARGET_STRICTLY_LOWER');
    });

    it('Escada completa do catálogo deve ser estritamente monotônica crescente', () => {
      const ladder: Array<import('../../config/plans.config').PlanId> = [
        'free',
        'lite',
        'lite_plus',
        'essential',
        'pro',
        'premium',
      ];

      for (let i = 0; i < ladder.length - 1; i++) {
        const current = resolveEffectiveCapabilities(ladder[i], 0);
        const next = resolveEffectiveCapabilities(ladder[i + 1], 0);
        expect(compareCapabilities(current, next)).toBe('TARGET_STRICTLY_GREATER');
        expect(compareCapabilities(next, current)).toBe('TARGET_STRICTLY_LOWER');
      }
    });

    it('Entitlement misto (ex: members aumenta mas songs diminui) resulta em MIXED e fail-closed para early activation', () => {
      const mixedSource = { members: 50, songs: 300 };
      const mixedTarget = { members: 100, songs: 200 };

      expect(compareCapabilities(mixedSource, mixedTarget)).toBe('MIXED');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Execution Strategy Classification Matrix
  // --------------------------------------------------------------------------
  describe('3. Execution Strategy Classification Matrix', () => {
    const paidSource: SourceContractInput = {
      plan_id: 'essential',
      interval: 'monthly',
      addon_blocks: 0,
      current_period_start: '2026-09-01',
      current_period_end: '2026-10-01',
    };

    const freeSource: SourceContractInput = {
      plan_id: 'free',
      interval: 'monthly',
      addon_blocks: 0,
      current_period_start: null,
      current_period_end: null,
    };

    it('Free -> Lite deve ser immediate_initial_purchase com early_activation_eligible = false', () => {
      const res = classifyTransition(freeSource, {
        plan_id: 'lite',
        interval: 'monthly',
        addon_blocks: 0,
      });

      expect(res.execution_strategy).toBe('immediate_initial_purchase');
      expect(res.is_initial_purchase).toBe(true);
      expect(res.early_activation_eligible).toBe(false);
      expect(res.transition_type).toBe('upgrade');
    });

    it('Free -> Pro Annual deve ser immediate_initial_purchase', () => {
      const res = classifyTransition(freeSource, {
        plan_id: 'pro',
        interval: 'annual',
        addon_blocks: 0,
      });

      expect(res.execution_strategy).toBe('immediate_initial_purchase');
      expect(res.is_initial_purchase).toBe(true);
      expect(res.early_activation_eligible).toBe(false);
    });

    it('Paid -> Paid Upgrade (Essential -> Pro) deve ser scheduled_paid_transition com early_activation_eligible = true', () => {
      const res = classifyTransition(paidSource, {
        plan_id: 'pro',
        interval: 'monthly',
        addon_blocks: 0,
      });

      expect(res.execution_strategy).toBe('scheduled_paid_transition');
      expect(res.transition_type).toBe('upgrade');
      expect(res.early_activation_eligible).toBe(true);
    });

    it('Paid -> Paid Downgrade (Pro -> Essential) deve ser scheduled_paid_transition com early_activation_eligible = false', () => {
      const res = classifyTransition(
        { ...paidSource, plan_id: 'pro' },
        { plan_id: 'essential', interval: 'monthly', addon_blocks: 0 }
      );

      expect(res.execution_strategy).toBe('scheduled_paid_transition');
      expect(res.transition_type).toBe('downgrade');
      expect(res.early_activation_eligible).toBe(false);
    });

    it('Paid -> Paid Interval Change (Essential Monthly -> Essential Annual) deve ser scheduled_paid_transition com early_activation_eligible = false', () => {
      const res = classifyTransition(paidSource, {
        plan_id: 'essential',
        interval: 'annual',
        addon_blocks: 0,
      });

      expect(res.execution_strategy).toBe('scheduled_paid_transition');
      expect(res.transition_type).toBe('interval_change');
      expect(res.early_activation_eligible).toBe(false);
    });

    it('Paid -> Free (Pro -> Free) deve ser scheduled_cancel_to_free com early_activation_eligible = false', () => {
      const res = classifyTransition(
        { ...paidSource, plan_id: 'pro' },
        { plan_id: 'free', interval: 'monthly', addon_blocks: 0 }
      );

      expect(res.execution_strategy).toBe('scheduled_cancel_to_free');
      expect(res.is_cancel_to_free).toBe(true);
      expect(res.transition_type).toBe('downgrade');
      expect(res.early_activation_eligible).toBe(false);
    });

    it('Rejeita NO-OP transition (Free -> Free ou mesma configuração)', () => {
      expect(() =>
        classifyTransition(freeSource, {
          plan_id: 'free',
          interval: 'monthly',
          addon_blocks: 0,
        })
      ).toThrow(/NO-OP/i);

      expect(() =>
        classifyTransition(paidSource, {
          plan_id: 'essential',
          interval: 'monthly',
          addon_blocks: 0,
        })
      ).toThrow(/NO-OP/i);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Commercial Snapshot & Period Requirements
  // --------------------------------------------------------------------------
  describe('4. Commercial Snapshot & Period Requirements', () => {
    it('Free -> Paid não precisa de datas artificiais de período corrente', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'free',
          interval: 'monthly',
          addon_blocks: 0,
        },
        {
          plan_id: 'lite',
          interval: 'monthly',
          addon_blocks: 0,
        },
        { requestedAt: '2026-09-01T15:00:00.000Z' }
      );

      expect(snapshot.execution_strategy).toBe('immediate_initial_purchase');
      expect(snapshot.current_period_start).toBeNull();
      expect(snapshot.current_period_end).toBeNull();
      expect(snapshot.current_period_start_date).toBeNull();
      expect(snapshot.current_period_end_date).toBeNull();
      expect(snapshot.effective_billing_date).toBe('2026-09-01');
      expect(snapshot.target_future_recurring_price_cents).toBe(1490);
    });

    it('Paid -> Paid exige período corrente válido', () => {
      expect(() =>
        buildTransitionCommercialSnapshot(
          {
            plan_id: 'essential',
            interval: 'monthly',
            addon_blocks: 0,
            current_period_start: null,
            current_period_end: null,
          },
          {
            plan_id: 'pro',
            interval: 'monthly',
            addon_blocks: 0,
          }
        )
      ).toThrow(/Período corrente de faturamento obrigatório/i);
    });

    it('Paid -> Free agenda cancelamento no current_period_end com target price = 0', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'pro',
          interval: 'monthly',
          addon_blocks: 0,
          current_period_start: '2026-09-05',
          current_period_end: '2026-10-05',
        },
        {
          plan_id: 'free',
          interval: 'monthly',
          addon_blocks: 0,
        }
      );

      expect(snapshot.execution_strategy).toBe('scheduled_cancel_to_free');
      expect(snapshot.effective_billing_date).toBe('2026-10-05');
      expect(snapshot.target_future_recurring_price_cents).toBe(0);
      expect(snapshot.early_activation_eligible).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Early Activation Guards & Proration Calculations
  // --------------------------------------------------------------------------
  describe('5. Early Activation Guards & Proration Calculations', () => {
    it('createEarlyActivationQuote deve REJEITAR compra inicial imediata (Free -> Paid)', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
        { plan_id: 'pro', interval: 'monthly', addon_blocks: 0 }
      );

      expect(() => createEarlyActivationQuote(snapshot)).toThrow(/não é elegível para early activation/i);
      expect(() => calculateProration(snapshot)).toThrow(/não é aplicável para compra inicial imediata/i);
    });

    it('createEarlyActivationQuote deve REJEITAR cancelamento para Free (Paid -> Free)', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'pro',
          interval: 'monthly',
          addon_blocks: 0,
          current_period_start: '2026-09-05',
          current_period_end: '2026-10-05',
        },
        { plan_id: 'free', interval: 'monthly', addon_blocks: 0 }
      );

      expect(() => createEarlyActivationQuote(snapshot)).toThrow(/não é elegível para early activation/i);
    });

    it('EXEMPLO A: Essential Monthly (3490) -> Pro Monthly (8990) com 15/30 dias', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'essential',
          interval: 'monthly',
          addon_blocks: 0,
          current_period_start: '2026-09-05',
          current_period_end: '2026-10-05',
        },
        {
          plan_id: 'pro',
          interval: 'monthly',
          addon_blocks: 0,
        }
      );

      const proration = calculateProration(snapshot, { now: '2026-09-20T12:00:00.000Z' });
      expect(proration.total_days).toBe(30);
      expect(proration.remaining_days).toBe(15);
      expect(proration.price_delta_cents).toBe(5500);
      expect(proration.prorated_adjustment_cents).toBe(2750); // R$ 27,50
      expect(proration.payment_required).toBe(true);
    });

    it('EXEMPLO B: Essential + 3 addons (6460) -> Pro + 0 addons (8990) com 15/30 dias', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'essential',
          interval: 'monthly',
          addon_blocks: 3,
          current_period_start: '2026-09-05',
          current_period_end: '2026-10-05',
        },
        {
          plan_id: 'pro',
          interval: 'monthly',
          addon_blocks: 0,
        }
      );

      const proration = calculateProration(snapshot, { now: '2026-09-20T12:00:00.000Z' });
      expect(proration.price_delta_cents).toBe(2530);
      expect(proration.prorated_adjustment_cents).toBe(1265); // R$ 12,65
      expect(proration.payment_required).toBe(true);
    });

    it('EXEMPLO C: Essential Annual (37692) -> Pro Annual (97092) com 120/365 dias', () => {
      const snapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'essential',
          interval: 'annual',
          addon_blocks: 0,
          current_period_start: '2026-09-05',
          current_period_end: '2027-09-05',
        },
        {
          plan_id: 'pro',
          interval: 'annual',
          addon_blocks: 0,
        }
      );

      const proration = calculateProration(snapshot, { now: '2027-05-08T12:00:00.000Z' });
      expect(proration.total_days).toBe(365);
      expect(proration.remaining_days).toBe(120);
      expect(proration.price_delta_cents).toBe(59400);
      expect(proration.prorated_adjustment_cents).toBe(19529); // R$ 195,29
    });
  });

  // --------------------------------------------------------------------------
  // 6. BigInt & Integer Math Safety
  // --------------------------------------------------------------------------
  describe('6. BigInt & Integer Math Safety', () => {
    it('deve executar divisão ROUND_HALF_UP exata via BigInt', () => {
      expect(roundHalfUpDivide(10, 3)).toBe(3);
      expect(roundHalfUpDivide(11, 3)).toBe(4);
      expect(roundHalfUpDivide(5, 2)).toBe(3);
      expect(roundHalfUpDivide(7, 2)).toBe(4);
    });

    it('deve REJEITAR overflow acima de MAX_SAFE_INTEGER', () => {
      const hugeNumerator = BigInt(Number.MAX_SAFE_INTEGER) * 2n;
      expect(() => roundHalfUpDivide(hugeNumerator, 1n)).toThrow(/excede limite seguro/i);
    });

    it('deve REJEITAR denominador zero ou negativo', () => {
      expect(() => roundHalfUpDivide(100n, 0n)).toThrow(/Denominador inválido/i);
      expect(() => roundHalfUpDivide(100n, -1n)).toThrow(/Denominador inválido/i);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Commercial Days Arithmetic & Expiry
  // --------------------------------------------------------------------------
  describe('7. Commercial Days Arithmetic & Expiry', () => {
    it('deve calcular dias civis exatos', () => {
      expect(commercialDaysBetween('2026-09-05', '2026-09-06')).toBe(1);
      expect(commercialDaysBetween('2026-09-05', '2026-10-05')).toBe(30);
      expect(commercialDaysBetween('2026-09-05', '2027-09-05')).toBe(365);
    });

    it('deve definir expiry da cotação sem ultrapassar a meia-noite do dia comercial', () => {
      const quote = createEarlyActivationQuote(
        buildTransitionCommercialSnapshot(
          {
            plan_id: 'essential',
            interval: 'monthly',
            addon_blocks: 0,
            current_period_start: '2026-09-01',
            current_period_end: '2026-10-01',
          },
          { plan_id: 'pro', interval: 'monthly', addon_blocks: 0 }
        ),
        { now: '2026-09-25T13:00:00.000Z' }
      );

      expect(quote.expires_at).toContain('2026-09-26T02:59:59');
    });
  });

  // ==========================================================================
  // Phase 3C.1 — Pure Domain Early Activation Test Matrix (Scenarios 1 to 58)
  // ==========================================================================
  describe('Phase 3C.1 — Pure Domain Early Activation Test Matrix', () => {
    // ------------------------------------------------------------------------
    // Capability Eligibility (Scenarios 1 to 7)
    // ------------------------------------------------------------------------
    describe('1. Capability Eligibility (Scenarios 1 to 7)', () => {
      it('1: pure upgrade -> eligible', () => {
        const res = classifyCapabilityEligibility(
          { members: 15, songs: 100 },
          { members: 30, songs: 100 }
        );
        expect(res.classification).toBe('pure_upgrade');
        expect(res.early_activation_eligible).toBe(true);
      });

      it('2: pure downgrade -> not eligible', () => {
        const res = classifyCapabilityEligibility(
          { members: 30, songs: 100 },
          { members: 15, songs: 100 }
        );
        expect(res.classification).toBe('pure_downgrade');
        expect(res.early_activation_eligible).toBe(false);
        expect(res.reason).toBe('CAPABILITIES_DECREASED');
      });

      it('3: mixed capabilities -> not eligible', () => {
        const res = classifyCapabilityEligibility(
          { members: 15, songs: 'unlimited' },
          { members: 30, songs: 100 }
        );
        expect(res.classification).toBe('mixed');
        expect(res.early_activation_eligible).toBe(false);
        expect(res.reason).toBe('MIXED_CAPABILITY_CHANGE');
      });

      it('4: no change -> not eligible', () => {
        const res = classifyCapabilityEligibility(
          { members: 15, songs: 100 },
          { members: 15, songs: 100 }
        );
        expect(res.classification).toBe('no_change');
        expect(res.early_activation_eligible).toBe(false);
        expect(res.reason).toBe('NO_CAPABILITY_CHANGE');
      });

      it('5: positive price but mixed capabilities -> NOT eligible (fail closed)', () => {
        const res = classifyCapabilityEligibility(
          { members: 15, songs: 'unlimited' },
          { members: 30, songs: 100 },
          { priceDeltaCents: 5000 }
        );
        expect(res.classification).toBe('mixed');
        expect(res.early_activation_eligible).toBe(false);
      });

      it('6: zero delta -> NOT eligible', () => {
        const res = classifyCapabilityEligibility(
          { members: 15, songs: 100 },
          { members: 30, songs: 100 },
          { priceDeltaCents: 0 }
        );
        expect(res.classification).toBe('pure_upgrade');
        expect(res.early_activation_eligible).toBe(false);
        expect(res.reason).toBe('PRICE_DELTA_NOT_POSITIVE');
      });

      it('7: negative delta -> NOT eligible', () => {
        const res = classifyCapabilityEligibility(
          { members: 15, songs: 100 },
          { members: 30, songs: 100 },
          { priceDeltaCents: -500 }
        );
        expect(res.classification).toBe('pure_upgrade');
        expect(res.early_activation_eligible).toBe(false);
        expect(res.reason).toBe('PRICE_DELTA_NOT_POSITIVE');
      });
    });

    // ------------------------------------------------------------------------
    // Proration Engine (Scenarios 8 to 15)
    // ------------------------------------------------------------------------
    describe('2. Proration Engine (Scenarios 8 to 15)', () => {
      it('8: 30-day half period (15 remaining of 30 days) delta 2000 -> 1000', () => {
        const snapshot = buildTransitionCommercialSnapshot(
          { plan_id: 'lite', interval: 'monthly', addon_blocks: 0, current_period_start: '2026-09-01', current_period_end: '2026-10-01' },
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 0 }
        );
        const proration = calculateProration(snapshot, { now: '2026-09-16T12:00:00.000Z' });
        expect(proration.total_days).toBe(30);
        expect(proration.remaining_days).toBe(15);
        expect(proration.price_delta_cents).toBe(2000);
        expect(proration.prorated_adjustment_cents).toBe(1000);
      });

      it('9: 31-day period (10 remaining of 31 days) delta 6500 -> 2097', () => {
        const snapshot = buildTransitionCommercialSnapshot(
          { plan_id: 'lite_plus', interval: 'monthly', addon_blocks: 0, current_period_start: '2026-08-01', current_period_end: '2026-09-01' },
          { plan_id: 'pro', interval: 'monthly', addon_blocks: 0 }
        );
        const proration = calculateProration(snapshot, { now: '2026-08-22T12:00:00.000Z' });
        expect(proration.total_days).toBe(31);
        expect(proration.remaining_days).toBe(10);
        expect(proration.price_delta_cents).toBe(6500);
        expect(proration.prorated_adjustment_cents).toBe(2097); // roundHalfUp((65000 + 15)/31) = 2097
      });

      it('10: addon increase (Essential + 1 addon -> Essential + 3 addons) delta 1980, 18 of 30 days -> 1188', () => {
        const snapshot = buildTransitionCommercialSnapshot(
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 1, current_period_start: '2026-09-01', current_period_end: '2026-10-01' },
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 3 }
        );
        const proration = calculateProration(snapshot, { now: '2026-09-13T12:00:00.000Z' });
        expect(proration.total_days).toBe(30);
        expect(proration.remaining_days).toBe(18);
        expect(proration.price_delta_cents).toBe(1980);
        expect(proration.prorated_adjustment_cents).toBe(1188); // (1980 * 18 + 15)/30 = 1188
      });

      it('11: monthly -> annual source-interval calculation (Essential Monthly -> Pro Annual)', () => {
        const snapshot = buildTransitionCommercialSnapshot(
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 0, current_period_start: '2026-09-01', current_period_end: '2026-10-01' },
          { plan_id: 'pro', interval: 'annual', addon_blocks: 0 }
        );
        // Base de comparação é Pro Mensal (8990) - Essential Mensal (3490) = 5500
        expect(snapshot.target_current_cycle_total_cents).toBe(8990);
        expect(snapshot.source_current_cycle_total_cents).toBe(3490);
        const proration = calculateProration(snapshot, { now: '2026-09-19T12:00:00.000Z' });
        expect(proration.total_days).toBe(30);
        expect(proration.remaining_days).toBe(12);
        expect(proration.price_delta_cents).toBe(5500);
        expect(proration.prorated_adjustment_cents).toBe(2200); // 5500 * 12 / 30 = 2200
      });

      it('12: last day = one day (1 of 30 days) delta 2000 -> 67', () => {
        const snapshot = buildTransitionCommercialSnapshot(
          { plan_id: 'lite', interval: 'monthly', addon_blocks: 0, current_period_start: '2026-09-01', current_period_end: '2026-10-01' },
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 0 }
        );
        const proration = calculateProration(snapshot, { now: '2026-09-30T12:00:00.000Z' });
        expect(proration.total_days).toBe(30);
        expect(proration.remaining_days).toBe(1);
        expect(proration.prorated_adjustment_cents).toBe(67); // (2000 + 15)/30 = 67
      });

      it('13: quote date == period end not eligible (lança EARLY_ACTIVATION_OUTSIDE_CURRENT_PERIOD)', () => {
        const snapshot = buildTransitionCommercialSnapshot(
          { plan_id: 'lite', interval: 'monthly', addon_blocks: 0, current_period_start: '2026-09-01', current_period_end: '2026-10-01' },
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 0 }
        );
        expect(() => calculateProration(snapshot, { now: '2026-10-01T12:00:00.000Z' })).toThrow(
          /atingiu ou ultrapassou o fim do ciclo corrente/i
        );
      });

      it('14: round-half-up cent boundary (exact half rounds up)', () => {
        // Exemplo: 1 centavo em 2 dias (resto 1/2): roundHalfUpDivide(1, 2) = 1
        expect(roundHalfUpDivide(1n, 2n)).toBe(1);
        expect(roundHalfUpDivide(3n, 2n)).toBe(2);
        expect(roundHalfUpDivide(5n, 2n)).toBe(3);
      });

      it('15: large integer / BigInt safety maintains exactness', () => {
        const largeNum = 100_000_000_000n; // R$ 1 bilhão em centavos
        expect(roundHalfUpDivide(largeNum, 2n)).toBe(50_000_000_000);
      });
    });

    // ------------------------------------------------------------------------
    // Quote Creation & Expiry (Scenarios 16 to 20)
    // ------------------------------------------------------------------------
    describe('3. Quote Creation & Expiry (Scenarios 16 to 20)', () => {
      const getSnapshot = () =>
        buildTransitionCommercialSnapshot(
          { plan_id: 'lite', interval: 'monthly', addon_blocks: 0, current_period_start: '2026-09-01', current_period_end: '2026-10-01' },
          { plan_id: 'essential', interval: 'monthly', addon_blocks: 0 }
        );

      it('16: expiry 60m before EOD when requested in morning', () => {
        const quote = createEarlyActivationQuote(getSnapshot(), {
          now: '2026-09-15T10:00:00.000Z',
          ttlMinutes: 60,
        });
        expect(quote.expires_at).toBe('2026-09-15T11:00:00.000Z');
        expect(quote.status).toBe('active');
        expect(quote.calculation_version).toBe('proration_v1');
      });

      it('17: expiry clipped at commercial EOD when close to midnight', () => {
        // 23:30 em SP (UTC-3) é 2026-09-16T02:30:00.000Z
        const quote = createEarlyActivationQuote(getSnapshot(), {
          now: '2026-09-16T02:30:00.000Z', // 23:30 local em 15/09
          ttlMinutes: 60,
        });
        // Deve expirar às 23:59:59.999 local (02:59:59.999Z), e NÃO às 03:30:00Z!
        expect(quote.expires_at).toContain('2026-09-16T02:59:59');
      });

      it('18: timezone America/Sao_Paulo EOD is UTC 02:59:59Z of next day', () => {
        const quote = createEarlyActivationQuote(getSnapshot(), {
          now: '2026-09-15T18:00:00.000Z', // 15:00 em SP
          ttlMinutes: 600, // 10 horas
        });
        expect(quote.expires_at).toContain('2026-09-16T02:59:59');
      });

      it('19: catalog locked prices preserved regardless of external changes', () => {
        const snapshot = getSnapshot();
        const quote = createEarlyActivationQuote(snapshot, { now: '2026-09-15T12:00:00.000Z' });
        expect(quote.source_current_cycle_total_cents).toBe(snapshot.source_current_cycle_total_cents);
        expect(quote.target_current_cycle_total_cents).toBe(snapshot.target_current_cycle_total_cents);
      });

      it('20: target snapshot reference/identity preserved in snapshot', () => {
        const snapshot = getSnapshot();
        expect(snapshot.target_entitlement_snapshot?.plan_id).toBe('essential');
      });
    });

    // ------------------------------------------------------------------------
    // Checkout TTL Pure Function (Scenarios 21 to 25)
    // ------------------------------------------------------------------------
    describe('4. Checkout TTL Pure Function (Scenarios 21 to 25)', () => {
      it('21: normal 60m when plenty of time remaining', () => {
        const now = '2026-09-15T10:00:00.000Z';
        const quoteExpiresAt = '2026-09-15T12:00:00.000Z'; // 120 min restantes
        const res = calculateCheckoutMinutesToExpire(quoteExpiresAt, now);
        expect(res.minutesToExpire).toBe(60);
        expect(res.remainingMinutes).toBe(120);
      });

      it('22: clipped by quote expiry when less than 60m remaining', () => {
        const now = '2026-09-15T10:00:00.000Z';
        const quoteExpiresAt = '2026-09-15T10:35:00.000Z'; // 35 min restantes
        const res = calculateCheckoutMinutesToExpire(quoteExpiresAt, now);
        expect(res.minutesToExpire).toBe(35);
        expect(res.remainingMinutes).toBe(35);
      });

      it('23: <5m throws EARLY_ACTIVATION_QUOTE_TOO_CLOSE_TO_EXPIRY', () => {
        const now = '2026-09-15T10:00:00.000Z';
        const quoteExpiresAt = '2026-09-15T10:04:30.000Z'; // 4 min restantes
        expect(() => calculateCheckoutMinutesToExpire(quoteExpiresAt, now)).toThrow(
          /Cotação muito próxima do término do dia comercial/i
        );
      });

      it('24: exact 5m behavior explicit (returns 5)', () => {
        const now = '2026-09-15T10:00:00.000Z';
        const quoteExpiresAt = '2026-09-15T10:05:00.000Z'; // exatos 5 min
        const res = calculateCheckoutMinutesToExpire(quoteExpiresAt, now);
        expect(res.minutesToExpire).toBe(5);
        expect(res.remainingMinutes).toBe(5);
      });

      it('25: no checkout beyond quote expiry (expired throws)', () => {
        const now = '2026-09-15T10:05:00.000Z';
        const quoteExpiresAt = '2026-09-15T10:00:00.000Z'; // expirada
        expect(() => calculateCheckoutMinutesToExpire(quoteExpiresAt, now)).toThrow(
          /A cotação de early activation já expirou/i
        );
      });
    });

    // ------------------------------------------------------------------------
    // Financial Obligation State & Financially Live Predicate (Scenarios 26 to 34)
    // ------------------------------------------------------------------------
    describe('5. Financial Obligation State (Scenarios 26 to 34)', () => {
      const createBaseTransition = (attemptOverrides: Partial<BillingCheckoutAttempt>[] = []): BillingTransitionV1Record => {
        return {
          id: 'tr_1',
          transition_id: 'tr_1',
          policy_version: 'billing_transition_v1',
          ministry_id: 'min_1',
          provider: 'asaas',
          currency: 'BRL',
          execution_strategy: 'scheduled_paid_transition',
          transition_status: 'scheduled',
          early_activation_status: 'payment_pending',
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
          target_plan_id: 'essential',
          target_interval: 'monthly',
          target_addon_blocks: 0,
          target_future_recurring_price_cents: 3490,
          target_current_cycle_total_cents: 3490,
          requested_commercial_date: '2026-09-01',
          price_locked_at: '2026-09-01T00:00:00.000Z',
          requested_at: '2026-09-01T00:00:00.000Z',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
          expires_at: null,
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
          effective_billing_date: '2026-10-01',
          checkout_attempts: attemptOverrides.map((over, idx) => ({
            attempt_id: `att_${idx + 1}`,
            transition_id: 'tr_1',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: `intent_${idx + 1}`,
            amount_cents: 1000,
            currency: 'BRL',
            status: 'pending',
            created_at: '2026-09-15T10:00:00.000Z',
            ...over,
          })),
        };
      };

      it('26: deterministic create failure safe (creation_failed_before_provider_obligation)', () => {
        const tr = createBaseTransition([
          { status: 'failed', failure_classification: 'creation_failed_before_provider_obligation' },
        ]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('provider_terminal_unpaid');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(false);
      });

      it('27: payment decline inside live checkout remains live (payment_declined_in_session)', () => {
        const tr = createBaseTransition([
          { status: 'failed', failure_classification: 'payment_declined_in_session' },
        ]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('financially_live');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(true);
      });

      it('28: pending checkout live', () => {
        const tr = createBaseTransition([{ status: 'pending' }]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('financially_live');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(true);
      });

      it('29: uncertain live', () => {
        const tr = createBaseTransition([{ status: 'uncertain' }]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('uncertain');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(true);
      });

      it('30: uncertain_expired unresolved STILL live', () => {
        const tr = createBaseTransition([{ status: 'uncertain_expired' }]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('uncertain_expired_unresolved');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(true);
      });

      it('31: provider expired + no settlement uncertainty safe', () => {
        const tr = createBaseTransition([{ status: 'expired' }]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('provider_terminal_unpaid');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(false);
      });

      it('32: provider canceled + no settlement uncertainty safe', () => {
        const tr = createBaseTransition([{ status: 'canceled' }]);
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('provider_terminal_unpaid');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(false);
      });

      it('33: settled-unconverged live', () => {
        const tr = createBaseTransition([{ status: 'completed' }]);
        tr.early_activation_status = 'payment_pending'; // ainda não confirmada
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('settled_unconverged');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(true);
      });

      it('34: attention live/blocking', () => {
        const tr = createBaseTransition([{ status: 'expired' }]);
        tr.financial_attention_required = true;
        expect(classifyEarlyAdjustmentFinancialState(tr)).toBe('attention_required');
        expect(isEarlyAdjustmentObligationFinanciallyLive(tr)).toBe(true);
      });
    });

    // ------------------------------------------------------------------------
    // Checkout Eligibility (Scenarios 35 to 38)
    // ------------------------------------------------------------------------
    describe('6. Checkout Eligibility (Scenarios 35 to 38)', () => {
      const getBaseScheduledTr = (): BillingTransitionV1Record => ({
        id: 'tr_1',
        transition_id: 'tr_1',
        policy_version: 'billing_transition_v1',
        ministry_id: 'min_1',
        provider: 'asaas',
        currency: 'BRL',
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
        early_activation_status: 'available',
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
        target_plan_id: 'essential',
        target_interval: 'monthly',
        target_addon_blocks: 0,
        target_future_recurring_price_cents: 3490,
        target_current_cycle_total_cents: 3490,
        requested_commercial_date: '2026-09-01',
        price_locked_at: '2026-09-01T00:00:00.000Z',
        requested_at: '2026-09-01T00:00:00.000Z',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        expires_at: null,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        effective_billing_date: '2026-10-01',
        checkout_attempts: [],
      });

      it('35: second live checkout blocked', () => {
        const tr = getBaseScheduledTr();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_1',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'pending',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = canCreateEarlyActivationCheckout(tr, { currentCommercialDate: '2026-09-15' });
        expect(res.allowed).toBe(false);
        expect(res.financialState).toBe('financially_live');
      });

      it('36: reattempt after deterministic no-obligation failure allowed', () => {
        const tr = getBaseScheduledTr();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_1',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'failed',
            failure_classification: 'creation_failed_before_provider_obligation',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = canCreateEarlyActivationCheckout(tr, { currentCommercialDate: '2026-09-15' });
        expect(res.allowed).toBe(true);
      });

      it('37: reattempt after provider-terminal unpaid allowed', () => {
        const tr = getBaseScheduledTr();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_1',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'expired',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = canCreateEarlyActivationCheckout(tr, { currentCommercialDate: '2026-09-15' });
        expect(res.allowed).toBe(true);
      });

      it('38: unresolved uncertain blocks', () => {
        const tr = getBaseScheduledTr();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_1',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'intent_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'uncertain_expired',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = canCreateEarlyActivationCheckout(tr, { currentCommercialDate: '2026-09-15' });
        expect(res.allowed).toBe(false);
        expect(res.financialState).toBe('uncertain_expired_unresolved');
      });
    });

    // ------------------------------------------------------------------------
    // Boundary Handoff Gate (Scenarios 39 to 49)
    // ------------------------------------------------------------------------
    describe('7. Boundary Handoff Gate (Scenarios 39 to 49)', () => {
      const getTrForBoundary = (): BillingTransitionV1Record => ({
        id: 'tr_b',
        transition_id: 'tr_b',
        policy_version: 'billing_transition_v1',
        ministry_id: 'min_1',
        provider: 'asaas',
        currency: 'BRL',
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
        early_activation_status: 'available',
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
        target_plan_id: 'essential',
        target_interval: 'monthly',
        target_addon_blocks: 0,
        target_future_recurring_price_cents: 3490,
        target_current_cycle_total_cents: 3490,
        requested_commercial_date: '2026-09-01',
        price_locked_at: '2026-09-01T00:00:00.000Z',
        requested_at: '2026-09-01T00:00:00.000Z',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        expires_at: null,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
        effective_billing_date: '2026-10-01',
        checkout_attempts: [],
      });

      it('39: confirmed+converged safe', () => {
        const tr = getTrForBoundary();
        tr.early_activation_status = 'confirmed';
        tr.early_activation_provider_payment_id = 'pay_adj_1';
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(true);
        expect(res.financialState).toBe('settled_converged');
      });

      it('40: confirmed but convergence incomplete unsafe', () => {
        const tr = getTrForBoundary();
        tr.early_activation_status = 'confirmed';
        tr.early_activation_provider_payment_id = undefined;
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });

      it('41: not_applicable safe', () => {
        const tr = getTrForBoundary();
        tr.early_activation_status = 'not_applicable';
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(true);
      });

      it('42: available/no attempt safe', () => {
        const tr = getTrForBoundary();
        tr.early_activation_status = 'available';
        tr.checkout_attempts = [];
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(true);
        expect(res.financialState).toBe('no_obligation');
      });

      it('43: terminal historical attempts safe', () => {
        const tr = getTrForBoundary();
        tr.early_activation_status = 'available';
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_b',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'int_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'expired',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(true);
        expect(res.financialState).toBe('provider_terminal_unpaid');
      });

      it('44: active checkout unsafe', () => {
        const tr = getTrForBoundary();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_b',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'int_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'pending',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });

      it('45: declined live session unsafe', () => {
        const tr = getTrForBoundary();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_b',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'int_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'failed',
            failure_classification: 'payment_declined_in_session',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });

      it('46: uncertain unsafe', () => {
        const tr = getTrForBoundary();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_b',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'int_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'uncertain',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });

      it('47: uncertain_expired unresolved unsafe', () => {
        const tr = getTrForBoundary();
        tr.checkout_attempts = [
          {
            attempt_id: 'att_1',
            transition_id: 'tr_b',
            attempt_type: 'early_activation',
            internal_checkout_intent_id: 'int_1',
            amount_cents: 1000,
            currency: 'BRL',
            status: 'uncertain_expired',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ];
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });

      it('48: settled-unconverged unsafe', () => {
        const tr = getTrForBoundary();
        tr.early_activation_provider_payment_id = 'pay_1';
        tr.early_activation_status = 'available'; // status ainda não confirmado
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });

      it('49: attention unsafe', () => {
        const tr = getTrForBoundary();
        tr.financial_attention_required = true;
        const res = isEarlyActivationBoundarySafe(tr);
        expect(res.safe).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // Early Activation Completion Gate (Scenarios 50 to 58)
    // ------------------------------------------------------------------------
    describe('8. Early Activation Completion Gate (Scenarios 50 to 58)', () => {
      const getValidGateParams = () => {
        const transition: BillingTransitionV1Record = {
          id: 'tr_gate',
          transition_id: 'tr_gate',
          policy_version: 'billing_transition_v1',
          ministry_id: 'min_test',
          provider: 'asaas',
          currency: 'BRL',
          execution_strategy: 'scheduled_paid_transition',
          transition_status: 'scheduled',
          early_activation_status: 'payment_pending',
          financial_safety_status: 'live',
          transition_type: 'upgrade',
          status: 'pending',
          requested_plan_id: 'essential',
          requested_interval: 'monthly',
          requested_addon_blocks: 2,
          expected_amount_cents: 3490,
          source_plan_id: 'lite',
          source_interval: 'monthly',
          source_addon_blocks: 0,
          source_current_cycle_total_cents: 1490,
          source_entitlement_snapshot: { plan_id: 'lite', addon_blocks: 0 },
          target_plan_id: 'essential',
          target_interval: 'monthly',
          target_addon_blocks: 2,
          target_future_recurring_price_cents: 5470,
          target_current_cycle_total_cents: 5470,
          requested_commercial_date: '2026-09-01',
          price_locked_at: '2026-09-01T00:00:00.000Z',
          requested_at: '2026-09-01T00:00:00.000Z',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
          expires_at: null,
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
          effective_billing_date: '2026-10-01',
          prorated_adjustment_cents: 1990,
          early_activation_provider_payment_id: 'pay_gate_123',
          current_early_activation_checkout_attempt_id: 'att_gate_1',
          current_early_activation_quote: {
            quote_id: 'quote_gate_1',
            transition_id: 'tr_gate',
            ministry_id: 'min_test',
            source_current_cycle_total_cents: 1490,
            target_current_cycle_total_cents: 5470,
            prorated_adjustment_cents: 1990,
            currency: 'BRL',
            priced_at: '2026-09-15T12:00:00.000Z',
            quote_effective_billing_date: '2026-09-15',
            expires_at: '2026-09-15T13:00:00.000Z',
            status: 'consumed',
          },
        };

        const payment = {
          id: 'pay_gate_123',
          status: 'CONFIRMED',
          amountCents: 1990,
          paidBillingDate: '2026-09-15',
        };

        const transaction: BillingTransactionRecord = {
          id: 'asaas_pay_gate_123',
          ministry_id: 'min_test',
          provider: 'asaas',
          provider_payment_id: 'pay_gate_123',
          amount_cents: 1990,
          currency: 'BRL',
          status: 'paid',
          due_date: '2026-09-15',
          paid_at: '2026-09-15T12:30:00.000Z',
          paid_billing_date: '2026-09-15',
          transaction_type: 'prorated_early_activation_adjustment',
          created_at: '2026-09-15T12:30:00.000Z',
          updated_at: '2026-09-15T12:30:00.000Z',
        };

        const attempt: BillingCheckoutAttempt = {
          attempt_id: 'att_gate_1',
          transition_id: 'tr_gate',
          attempt_type: 'early_activation',
          internal_checkout_intent_id: 'intent_gate_1',
          amount_cents: 1990,
          currency: 'BRL',
          status: 'completed',
          created_at: '2026-09-15T12:00:00.000Z',
        };

        const runtimeSubscription = {
          plan_id: 'essential' as const,
          member_addon_blocks: 2,
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
        };

        return { transition, payment, transaction, attempt, runtimeSubscription };
      };

      it('50: exact converged PASS', () => {
        const params = getValidGateParams();
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(true);
      });

      it('51: wrong payment id fail', () => {
        const params = getValidGateParams();
        params.payment.id = 'pay_DIFFERENT';
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toMatch(/diverge do registrado na transi/i);
      });

      it('52: wrong amount fail', () => {
        const params = getValidGateParams();
        params.transaction.amount_cents = 9999;
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('diverge do ajuste contratado');
      });

      it('53: wrong transaction type fail', () => {
        const params = getValidGateParams();
        params.transaction.transaction_type = 'recurring_payment';
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('Tipo da transação');
      });

      it('54: missing paid_billing_date fail', () => {
        const params = getValidGateParams();
        params.transaction.paid_billing_date = null as any;
        params.payment.paidBillingDate = null as any;
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('paid_billing_date');
      });

      it('55: runtime snapshot drift fail', () => {
        const params = getValidGateParams();
        params.runtimeSubscription.member_addon_blocks = 0; // esperado 2
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('Entitlements do runtime');
      });

      it('56: source period dates mutated fail', () => {
        const params = getValidGateParams();
        params.runtimeSubscription.current_period_start = '2026-09-15T00:00:00.000Z'; // corrompido
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('Data inicial do ciclo corrente');
      });

      it('57: attempt not completed fail', () => {
        const params = getValidGateParams();
        params.attempt.status = 'pending';
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('Tentativa de checkout ausente ou não concluída');
      });

      it('58: wrong attempt identity fail if fields exist', () => {
        const params = getValidGateParams();
        params.attempt.attempt_id = 'att_DIFFERENT';
        const res = validateEarlyActivationCompletion(params);
        expect(res.ready).toBe(false);
        expect(res.reason).toContain('ID da tentativa');
      });
    });
  });
});
