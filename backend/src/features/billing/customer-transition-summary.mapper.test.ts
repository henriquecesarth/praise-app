import { describe, it, expect } from 'vitest';
import {
  classifyCustomerFacingTransitionKind,
  mapCustomerFacingTransitionStatus,
  mapToCustomerFacingTransition,
  resolveCustomerPaymentStatus,
  resolveCustomerGraceReason,
} from './customer-transition-summary.mapper';
import {
  BillingTransitionV1Record,
  BillingSubscriptionRecord,
} from './billing.types';

function createMockTransitionV1(overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record {
  return {
    id: 'tr_mock_123',
    transition_id: 'tr_mock_123',
    policy_version: 'billing_transition_v1',
    ministry_id: 'min_test_1',
    provider: 'asaas',
    currency: 'BRL',
    execution_strategy: 'scheduled_paid_transition',
    transition_status: 'scheduled',
    early_activation_status: 'available',
    financial_safety_status: 'live',
    transition_type: 'upgrade',
    status: 'payment_confirmed',
    requested_plan_id: 'essential',
    requested_interval: 'monthly',
    requested_addon_blocks: 0,
    expected_amount_cents: 3490,
    source_plan_id: 'lite',
    source_interval: 'monthly',
    source_addon_blocks: 0,
    source_current_cycle_total_cents: 1490,
    source_entitlement_snapshot: {
      plan_id: 'lite',
      addon_blocks: 0,
      effective_member_quota: 20,
      effective_song_quota: 100,
    },
    current_period_start: '2026-09-01T00:00:00.000Z',
    current_period_end: '2026-10-01T00:00:00.000Z',
    target_plan_id: 'essential',
    target_interval: 'monthly',
    target_addon_blocks: 0,
    target_future_recurring_price_cents: 3490,
    target_entitlement_snapshot: {
      plan_id: 'essential',
      addon_blocks: 0,
      effective_member_quota: 40,
      effective_song_quota: 200,
    },
    requested_commercial_date: '2026-09-07',
    price_locked_at: '2026-09-07T12:00:00.000Z',
    requested_at: '2026-09-07T12:00:00.000Z',
    created_at: '2026-09-07T12:00:00.000Z',
    updated_at: '2026-09-07T12:00:00.000Z',
    expires_at: null,
    effective_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 4A.1: Customer Billing Summary Normalization', () => {
  // ==========================================================================
  // Section 31: Test Matrix — Pending Transition
  // ==========================================================================
  describe('Section 31: Pending Transition Test Matrix', () => {
    it('1. no active transition -> null', () => {
      const result = mapToCustomerFacingTransition(null, 'min_test_1');
      expect(result).toBeNull();

      const resultUndefined = mapToCustomerFacingTransition(undefined, 'min_test_1');
      expect(resultUndefined).toBeNull();
    });

    it('2. scheduled paid upgrade -> normalized DTO (plan_upgrade, scheduled)', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        source_interval: 'monthly',
        target_interval: 'monthly',
        transition_status: 'scheduled',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.transitionId).toBe('tr_mock_123');
      expect(dto?.kind).toBe('plan_upgrade');
      expect(dto?.status).toBe('scheduled');
      expect(dto?.effectiveAt).toBe('2026-10-01T00:00:00.000Z');
      expect(dto?.source).toEqual({
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      expect(dto?.target).toEqual({
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 0,
      });
    });

    it('3. scheduled downgrade -> normalized DTO (plan_downgrade, scheduled)', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'pro',
        target_plan_id: 'essential',
        source_interval: 'monthly',
        target_interval: 'monthly',
        transition_status: 'scheduled',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('plan_downgrade');
      expect(dto?.status).toBe('scheduled');
      expect(dto?.source.planId).toBe('pro');
      expect(dto?.target.planId).toBe('essential');
    });

    it('4. interval change -> normalized DTO (interval_change, scheduled)', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'essential',
        target_plan_id: 'essential',
        source_interval: 'monthly',
        target_interval: 'annual',
        transition_status: 'scheduled',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('interval_change');
      expect(dto?.status).toBe('scheduled');
      expect(dto?.source.interval).toBe('monthly');
      expect(dto?.target.interval).toBe('annual');
    });

    it('5. addon increase/decrease -> normalized kind (addon_increase, addon_decrease)', () => {
      // Addon increase
      const increaseTransition = createMockTransitionV1({
        source_plan_id: 'essential',
        target_plan_id: 'essential',
        source_interval: 'monthly',
        target_interval: 'monthly',
        source_addon_blocks: 1,
        target_addon_blocks: 3,
        transition_status: 'scheduled',
      });
      const dtoIncrease = mapToCustomerFacingTransition(increaseTransition, 'min_test_1');
      expect(dtoIncrease?.kind).toBe('addon_increase');
      expect(dtoIncrease?.source.addonBlocks).toBe(1);
      expect(dtoIncrease?.target.addonBlocks).toBe(3);

      // Addon decrease
      const decreaseTransition = createMockTransitionV1({
        source_plan_id: 'essential',
        target_plan_id: 'essential',
        source_interval: 'monthly',
        target_interval: 'monthly',
        source_addon_blocks: 3,
        target_addon_blocks: 1,
        transition_status: 'scheduled',
      });
      const dtoDecrease = mapToCustomerFacingTransition(decreaseTransition, 'min_test_1');
      expect(dtoDecrease?.kind).toBe('addon_decrease');
      expect(dtoDecrease?.source.addonBlocks).toBe(3);
      expect(dtoDecrease?.target.addonBlocks).toBe(1);
    });

    it('6. cancel-to-free -> normalized DTO (cancel_to_free, scheduled)', () => {
      const transition = createMockTransitionV1({
        execution_strategy: 'scheduled_cancel_to_free',
        source_plan_id: 'pro',
        target_plan_id: 'free',
        source_interval: 'monthly',
        target_interval: 'monthly',
        source_addon_blocks: 2,
        target_addon_blocks: 0,
        transition_status: 'scheduled',
        effective_at: '2026-10-01T00:00:00.000Z',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('cancel_to_free');
      expect(dto?.status).toBe('scheduled');
      expect(dto?.source.planId).toBe('pro');
      expect(dto?.target.planId).toBe('free');
      expect(dto?.target.addonBlocks).toBe(0);
      expect(dto?.effectiveAt).toBe('2026-10-01T00:00:00.000Z');
    });

    it('7. attention transition -> customer attention status (attention_required, sanitizado)', () => {
      // financial_attention_required = true
      const attentionTransition = createMockTransitionV1({
        financial_attention_required: true,
        financial_attention_reason: 'INTERNAL_MOCK_PROVIDER_ERROR_123',
        transition_status: 'scheduled',
      });
      const dto = mapToCustomerFacingTransition(attentionTransition, 'min_test_1');
      expect(dto?.status).toBe('attention_required');
      expect((dto as any).financial_attention_reason).toBeUndefined();

      // financial_safety_status = 'attention_required'
      const safetyAttentionTransition = createMockTransitionV1({
        financial_safety_status: 'attention_required',
        transition_status: 'scheduled',
      });
      const dtoSafety = mapToCustomerFacingTransition(safetyAttentionTransition, 'min_test_1');
      expect(dtoSafety?.status).toBe('attention_required');

      // transition_status = 'financial_attention_required'
      const statusAttentionTransition = createMockTransitionV1({
        transition_status: 'financial_attention_required',
      });
      const dtoStatus = mapToCustomerFacingTransition(statusAttentionTransition, 'min_test_1');
      expect(dtoStatus?.status).toBe('attention_required');
    });

    it('8. completed transition -> not pending (null)', () => {
      const completedTransition = createMockTransitionV1({
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
      });
      const dto = mapToCustomerFacingTransition(completedTransition, 'min_test_1');
      expect(dto).toBeNull();
    });

    it('9. terminal failed/canceled/superseded -> not pending (null)', () => {
      const canceledTransition = createMockTransitionV1({ transition_status: 'canceled' });
      expect(mapToCustomerFacingTransition(canceledTransition, 'min_test_1')).toBeNull();

      const supersededTransition = createMockTransitionV1({ transition_status: 'superseded' });
      expect(mapToCustomerFacingTransition(supersededTransition, 'min_test_1')).toBeNull();

      const failedTransition = createMockTransitionV1({ transition_status: 'failed' });
      expect(mapToCustomerFacingTransition(failedTransition, 'min_test_1')).toBeNull();
    });

    it('10. wrong Ministry -> not leaked (tenant isolation)', () => {
      const transition = createMockTransitionV1({
        ministry_id: 'min_tenant_A',
      });

      // Ministry B tenta ler a transição da Ministry A
      const dto = mapToCustomerFacingTransition(transition, 'min_tenant_B');
      expect(dto).toBeNull();
    });

    it('11. malformed record -> fail safe (null)', () => {
      // Não é objeto
      expect(mapToCustomerFacingTransition('invalid' as any, 'min_test_1')).toBeNull();

      // Policy version ausente ou legacy
      const legacyTransition = {
        id: 'legacy_123',
        ministry_id: 'min_test_1',
        policy_version: 'legacy',
      };
      expect(mapToCustomerFacingTransition(legacyTransition as any, 'min_test_1')).toBeNull();

      // Campos obrigatórios ausentes
      const missingFields = {
        policy_version: 'billing_transition_v1',
        ministry_id: 'min_test_1',
      };
      expect(mapToCustomerFacingTransition(missingFields as any, 'min_test_1')).toBeNull();
    });

    it('12. locked snapshots used instead of current catalog', () => {
      // Transição possui snapshot de cotas congelado explicitamente diferente do catálogo atual
      const customSnapshotTransition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        source_addon_blocks: 0,
        target_addon_blocks: 2,
        effective_at: '2026-11-15T00:00:00.000Z',
      });

      const dto = mapToCustomerFacingTransition(customSnapshotTransition, 'min_test_1');
      expect(dto?.source.planId).toBe('lite');
      expect(dto?.target.planId).toBe('essential');
      expect(dto?.target.addonBlocks).toBe(2);
      expect(dto?.effectiveAt).toBe('2026-11-15T00:00:00.000Z');
    });

    it('multi-dimension change -> classified as mixed_change', () => {
      const mixedTransition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        source_interval: 'monthly',
        target_interval: 'annual',
      });
      const dto = mapToCustomerFacingTransition(mixedTransition, 'min_test_1');
      expect(dto?.kind).toBe('mixed_change');
    });

    it('operational intermediate states -> awaiting_payment and processing', () => {
      // pending_initial_purchase -> awaiting_payment
      const initialPurchase = createMockTransitionV1({
        execution_strategy: 'immediate_initial_purchase',
        source_plan_id: 'free',
        target_plan_id: 'pro',
        transition_status: 'pending_initial_purchase',
      });
      const dtoInitial = mapToCustomerFacingTransition(initialPurchase, 'min_test_1');
      expect(dtoInitial?.kind).toBe('initial_purchase');
      expect(dtoInitial?.status).toBe('awaiting_payment');

      // pending_future_authorization -> awaiting_payment
      const futureAuth = createMockTransitionV1({
        transition_status: 'pending_future_authorization',
      });
      expect(mapToCustomerFacingTransition(futureAuth, 'min_test_1')?.status).toBe('awaiting_payment');

      // future_target_prepared -> processing
      const targetPrep = createMockTransitionV1({
        transition_status: 'future_target_prepared',
      });
      expect(mapToCustomerFacingTransition(targetPrep, 'min_test_1')?.status).toBe('processing');

      // awaiting_old_inactivation -> processing
      const cutover = createMockTransitionV1({
        transition_status: 'awaiting_old_inactivation',
      });
      expect(mapToCustomerFacingTransition(cutover, 'min_test_1')?.status).toBe('processing');
    });
  });

  // ==========================================================================
  // Section 32: Test Matrix — Payment Health & Grace Reason
  // ==========================================================================
  describe('Section 32: Payment Health & Grace Reason Test Matrix', () => {
    it('1. paid + active/current -> state: current', () => {
      const billingSub: Partial<BillingSubscriptionRecord> = {
        status: 'active',
      };
      const paymentStatus = resolveCustomerPaymentStatus(
        billingSub as BillingSubscriptionRecord,
        'paid',
        null
      );
      expect(paymentStatus.state).toBe('current');
      expect(paymentStatus.graceEndsAt).toBeNull();

      const graceReason = resolveCustomerGraceReason('normal', paymentStatus.state, false);
      expect(graceReason).toBe('none');
    });

    it('2. paid + past_due -> state: past_due com graceEndsAt', () => {
      const billingSub: Partial<BillingSubscriptionRecord> = {
        status: 'past_due',
      };
      const paymentStatus = resolveCustomerPaymentStatus(
        billingSub as BillingSubscriptionRecord,
        'paid',
        '2026-09-14T00:00:00.000Z'
      );
      expect(paymentStatus.state).toBe('past_due');
      expect(paymentStatus.graceEndsAt).toBe('2026-09-14T00:00:00.000Z');
    });

    it('3. payment-failure grace distinguishable from usage grace', () => {
      // Inadimplência financeira em carência
      const paymentFailureGrace = resolveCustomerGraceReason('grace', 'past_due', false);
      expect(paymentFailureGrace).toBe('payment_failure');

      // Excesso de uso em carência com pagamento em dia
      const usageGrace = resolveCustomerGraceReason('grace', 'current', true);
      expect(usageGrace).toBe('usage_over_limit');

      // Excesso de uso em carência fallback quando payment é current
      const fallbackUsageGrace = resolveCustomerGraceReason('grace', 'current', false);
      expect(fallbackUsageGrace).toBe('usage_over_limit');
    });

    it('4. restricted_over_limit does not imply past_due', () => {
      const billingSub: Partial<BillingSubscriptionRecord> = {
        status: 'active',
      };
      const paymentStatus = resolveCustomerPaymentStatus(
        billingSub as BillingSubscriptionRecord,
        'paid',
        null
      );
      expect(paymentStatus.state).toBe('current');

      // Em restricted_over_limit, graceReason é 'none' (não está em carência)
      const graceReason = resolveCustomerGraceReason('restricted_over_limit', paymentStatus.state, true);
      expect(graceReason).toBe('none');
    });

    it('5. complimentary mode does not fabricate delinquency', () => {
      // Mesmo se billingSub tivesse past_due (cenário defensivo improvável)
      const billingSub: Partial<BillingSubscriptionRecord> = {
        status: 'past_due',
      };
      const paymentStatus = resolveCustomerPaymentStatus(
        billingSub as BillingSubscriptionRecord,
        'complimentary',
        '2026-09-14T00:00:00.000Z'
      );
      expect(paymentStatus.state).toBe('current');
      expect(paymentStatus.graceEndsAt).toBeNull();

      const graceReason = resolveCustomerGraceReason('normal', paymentStatus.state, false);
      expect(graceReason).toBe('none');
    });

    it('6. free mode not past_due', () => {
      const paymentStatus = resolveCustomerPaymentStatus(null, 'free', null);
      expect(paymentStatus.state).toBe('current');
      expect(paymentStatus.graceEndsAt).toBeNull();

      // Free em excesso de uso e carência
      const graceReason = resolveCustomerGraceReason('grace', paymentStatus.state, true);
      expect(graceReason).toBe('usage_over_limit');
    });

    it('7. tenant isolation: no provider identifiers or internal metadata leaked', () => {
      const transition = createMockTransitionV1({
        provider_customer_id: 'cus_mock_cust_123',
        new_provider_subscription_id: 'sub_mock_sub_456',
        initial_provider_payment_id: 'pay_mock_pay_789',
        retry_locked_until: '2026-09-07T15:00:00.000Z',
        retry_locked_by: 'worker_node_1',
        retry_count: 3,
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();

      const serialized = JSON.stringify(dto);
      expect(serialized).not.toContain('cus_mock_cust_123');
      expect(serialized).not.toContain('sub_mock_sub_456');
      expect(serialized).not.toContain('pay_mock_pay_789');
      expect(serialized).not.toContain('worker_node_1');
      expect(serialized).not.toContain('retry_count');
      expect(serialized).not.toContain('provider');
    });
  });

  describe('Phase 4A.5: Customer-Facing Early Activation Summary Mapping', () => {
    it('1. plan upgrade with available early activation is marked eligible', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        early_activation_status: 'available',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.earlyActivation).toEqual({
        eligible: true,
        status: 'available',
        checkoutUrl: null,
      });
    });

    it('2. addon increase with available early activation is marked eligible', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'essential',
        target_plan_id: 'essential',
        source_addon_blocks: 0,
        target_addon_blocks: 2,
        early_activation_status: 'available',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('addon_increase');
      expect(dto?.earlyActivation).toEqual({
        eligible: true,
        status: 'available',
        checkoutUrl: null,
      });
    });

    it('3. plan downgrade is NEVER eligible for early activation', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'pro',
        target_plan_id: 'essential',
        early_activation_status: 'not_applicable',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('plan_downgrade');
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'not_applicable',
        checkoutUrl: null,
      });
    });

    it('4. addon decrease is NEVER eligible for early activation', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'essential',
        target_plan_id: 'essential',
        source_addon_blocks: 2,
        target_addon_blocks: 1,
        early_activation_status: 'not_applicable',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('addon_decrease');
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'not_applicable',
        checkoutUrl: null,
      });
    });

    it('5. cancel to free is NEVER eligible for early activation', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'essential',
        target_plan_id: 'free',
        execution_strategy: 'scheduled_cancel_to_free',
        early_activation_status: 'not_applicable',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.kind).toBe('cancel_to_free');
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'not_applicable',
        checkoutUrl: null,
      });
    });

    it('6. attention_required disables early activation eligibility', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        early_activation_status: 'available',
        financial_attention_required: true,
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.status).toBe('attention_required');
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'not_applicable',
        checkoutUrl: null,
      });
    });

    it('7. payment_pending exposes checkoutUrl and eligible=false', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        early_activation_status: 'payment_pending',
        checkout_url: 'https://sandbox.asaas.com/c/checkout_test_123',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'payment_pending',
        checkoutUrl: 'https://sandbox.asaas.com/c/checkout_test_123',
      });
    });

    it('8. activated early activation is marked not eligible and status activated', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        early_activation_status: 'activated',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'activated',
        checkoutUrl: null,
      });
    });

    it('9. boundary reached (currentCommercialDate >= effective_billing_date) disables early activation', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        early_activation_status: 'available',
        effective_billing_date: '2026-09-08',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1', {
        currentCommercialDate: '2026-09-08',
      });
      expect(dto).not.toBeNull();
      expect(dto?.earlyActivation).toEqual({
        eligible: false,
        status: 'not_applicable',
        checkoutUrl: null,
      });
    });

    it('10. expired early activation checkout before boundary is eligible for re-quote', () => {
      const transition = createMockTransitionV1({
        source_plan_id: 'lite',
        target_plan_id: 'essential',
        early_activation_status: 'expired',
        effective_billing_date: '2099-12-31',
      });

      const dto = mapToCustomerFacingTransition(transition, 'min_test_1');
      expect(dto).not.toBeNull();
      expect(dto?.earlyActivation).toEqual({
        eligible: true,
        status: 'expired',
        checkoutUrl: null,
      });
    });
  });
});
