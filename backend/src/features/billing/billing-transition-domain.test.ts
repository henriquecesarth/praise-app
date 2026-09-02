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
} from './billing-transition-domain.service';
import {
  SourceContractInput,
  TargetContractRequest,
} from './billing-transition-domain.types';
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
});
