import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingReconcilerWorker } from './billing-reconciler.worker';
import { BillingController } from './billing.controller';
import {
  BillingTransitionV1Record,
  buildActiveTransitionSlotId,
  CANCEL_TO_FREE_ATTENTION_REASONS,
  ScheduledCancelToFreeResponseDto,
} from './billing.types';
import { AppError } from '../../middleware/error-handler';
import { config } from '../../config/unifiedConfig';
import { requireMinistryRole } from '../../middleware/rbac';
import { AuthenticatedRequest } from '../../middleware/auth';
import { Response } from 'express';

describe('Phase 3D.2 — Provider Do-Not-Renew & Payment Safety Orchestration (Section 41 Matrix)', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;
  let mockProvider: any;

  const ministryId = 'min-cancel-3d2';
  const providerName = 'asaas';
  const sourceSubId = 'sub_source_exact_123';
  const effectiveBillingDate = '2026-10-01';
  const currentPeriodEnd = '2026-10-01T00:00:00.000Z';

  let activeRecord: BillingTransitionV1Record;
  let activeSlot: any;
  let billingSubRecord: any;
  let appSubRecord: any;

  function createBaseRecord(overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record {
    return {
      id: 'tr_cancel_3d2_spec',
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: providerName,
      provider_customer_id: 'cus_exact_123',
      old_provider_subscription_id: sourceSubId,
      previous_provider_subscription_id: sourceSubId,
      execution_strategy: 'scheduled_cancel_to_free',
      transition_type: 'downgrade',
      transition_status: 'awaiting_old_inactivation',
      financial_safety_status: 'live',
      financial_attention_required: false,
      financial_attention_reason: null,
      source_plan_id: 'essential',
      target_plan_id: 'free',
      source_interval: 'monthly',
      target_interval: 'monthly',
      source_addon_blocks: 0,
      target_addon_blocks: 0,
      current_period_end: currentPeriodEnd,
      effective_billing_date: effectiveBillingDate,
      effective_at: currentPeriodEnd,
      source_commercial_snapshot: {
        plan_id: 'essential',
        interval: 'monthly',
        effective_member_quota: 30,
        effective_song_quota: 150,
      },
      target_commercial_snapshot: {
        plan_id: 'free',
        interval: 'monthly',
        effective_member_quota: 10,
        effective_song_quota: 50,
      },
      payment_cleanup_status: 'none',
      payment_cleanup_ids: [],
      created_at: '2026-09-04T12:00:00.000Z',
      updated_at: '2026-09-04T12:00:00.000Z',
      ...overrides,
    } as BillingTransitionV1Record;
  }

  beforeEach(() => {
    (config as any).billingTimezone = 'America/Sao_Paulo';

    activeRecord = createBaseRecord();
    activeSlot = {
      id: buildActiveTransitionSlotId(ministryId, providerName),
      plan_change_id: activeRecord.id,
      ministry_id: ministryId,
      provider: providerName,
      held: true,
      created_at: '2026-09-04T12:00:00.000Z',
    };

    billingSubRecord = {
      ministry_id: ministryId,
      provider: providerName,
      provider_subscription_id: sourceSubId,
      provider_customer_id: 'cus_exact_123',
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      cycle: 'monthly',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: false,
      updated_at: '2026-09-04T12:00:00.000Z',
    };

    appSubRecord = {
      ministry_id: ministryId,
      plan_id: 'essential',
      status: 'active',
      billing_status: 'paid',
      access_mode: 'full',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: false,
      updated_at: '2026-09-04T12:00:00.000Z',
    };

    mockProvider = {
      name: providerName,
      getSubscription: vi.fn(),
      getSubscriptionState: vi.fn().mockResolvedValue({
        outcome: 'FOUND',
        status: 'INACTIVE',
        httpStatus: 200,
      }),
      inactivateSubscriptionStrict: vi.fn().mockResolvedValue({
        outcome: 'SUCCESS',
        httpStatus: 200,
      }),
      inactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      reactivateSubscription: vi.fn(),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      listAllSubscriptionPaymentsStrict: vi.fn().mockImplementation(async () => {
        const payments = await mockProvider.listSubscriptionPayments();
        return {
          outcome: 'SUCCESS',
          payments,
        };
      }),
      removePayment: vi.fn().mockResolvedValue({ success: true }),
      getPayment: vi.fn(),
      removeSubscription: vi.fn(), // MUST NEVER BE CALLED
      refundPayment: vi.fn(), // MUST NEVER BE CALLED
    };

    mockBillingRepo = {
      getSubscription: vi.fn().mockImplementation(async () => billingSubRecord),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        billingSubRecord = { ...sub };
        return billingSubRecord;
      }),
      getCustomer: vi.fn().mockResolvedValue({ provider_customer_id: 'cus_exact_123' }),
      getActiveTransitionSlot: vi.fn().mockImplementation(async () => activeSlot),
      getActiveTransitionForMinistry: vi.fn().mockImplementation(async () => ({
        slot: activeSlot,
        transition: activeRecord,
      })),
      createTransitionAndClaimSlot: vi.fn().mockImplementation(async (rec: any) => {
        activeRecord = { ...rec };
        activeSlot = {
          id: buildActiveTransitionSlotId(ministryId, providerName),
          plan_change_id: rec.id,
          ministry_id: ministryId,
          provider: providerName,
          held: true,
        };
        return { transition: activeRecord, slot: activeSlot };
      }),
      claimPlanChangeForRetry: vi.fn().mockImplementation(async (id: string) => {
        if (activeRecord && activeRecord.id === id) return activeRecord;
        return null;
      }),
      releasePlanChangeLock: vi.fn().mockResolvedValue(true),
      updateTransition: vi.fn().mockImplementation(async (id: string, minId: string, updates: any) => {
        activeRecord = { ...activeRecord, ...updates };
        return activeRecord;
      }),
      getTransitionById: vi.fn().mockImplementation(async () => activeRecord),
      releaseSlotIfOwnedAndSafe: vi.fn(),
      getV1TransitionsNeedingReconciliation: vi.fn().mockResolvedValue([]),
      listDueTransitions: vi.fn().mockResolvedValue([]),
      getPendingOrFailedPlanChanges: vi.fn().mockResolvedValue([]),
    };

    mockSubscriptionService = {
      getSubscriptionSummary: vi.fn().mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        billingStatus: 'paid',
        accessMode: 'full',
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        memberLimit: 30,
        songLimit: 150,
      }),
      updateSubscription: vi.fn(),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async () => appSubRecord),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        appSubRecord = { ...sub };
        return appSubRecord;
      }),
    };

    mockMinistryRepo = {
      findById: vi.fn().mockResolvedValue({ id: ministryId, name: 'Louvor Central' }),
      getMinistryById: vi.fn().mockResolvedValue({ id: ministryId, role: 'admin' }),
    };

    mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'usr_admin', email: 'admin@louvaio.com' }),
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

  // ==========================================================================
  // Section 41 Tests
  // ==========================================================================

  // 1. awaiting + GET INACTIVE + no obligations -> scheduled
  it('1. awaiting + GET INACTIVE + no obligations -> scheduled', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'FOUND',
      status: 'INACTIVE',
      httpStatus: 200,
    });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(activeRecord.payment_cleanup_status).toBe('completed');
    expect(activeRecord.source_inactivation_confirmed_at).toBeTruthy();
    expect(mockProvider.inactivateSubscriptionStrict).not.toHaveBeenCalled();
  });

  // 2. awaiting + GET ACTIVE + PUT 200 + fresh GET INACTIVE -> scheduled
  it('2. awaiting + GET ACTIVE + PUT 200 + fresh GET INACTIVE -> scheduled', async () => {
    mockProvider.getSubscriptionState
      .mockResolvedValueOnce({ outcome: 'FOUND', status: 'ACTIVE', httpStatus: 200 })
      .mockResolvedValueOnce({ outcome: 'FOUND', status: 'INACTIVE', httpStatus: 200 })
      .mockResolvedValueOnce({ outcome: 'FOUND', status: 'INACTIVE', httpStatus: 200 }); // final check

    mockProvider.inactivateSubscriptionStrict.mockResolvedValue({
      outcome: 'SUCCESS',
      httpStatus: 200,
    });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(mockProvider.inactivateSubscriptionStrict).toHaveBeenCalledWith(sourceSubId);
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(activeRecord.source_inactivation_attempted_at).toBeTruthy();
    expect(activeRecord.source_inactivation_confirmed_at).toBeTruthy();
  });

  // 3. repeat PUT idempotent
  it('3. repeat PUT idempotent (second PUT returns 200 without side effects)', async () => {
    mockProvider.inactivateSubscriptionStrict.mockResolvedValue({ outcome: 'SUCCESS', httpStatus: 200 });

    const firstPut = await mockProvider.inactivateSubscriptionStrict(sourceSubId);
    const secondPut = await mockProvider.inactivateSubscriptionStrict(sourceSubId);

    expect(firstPut.outcome).toBe('SUCCESS');
    expect(secondPut.outcome).toBe('SUCCESS');
  });

  // 4. PUT timeout -> awaiting
  it('4. PUT timeout -> awaiting', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({ outcome: 'FOUND', status: 'ACTIVE' });
    mockProvider.inactivateSubscriptionStrict.mockResolvedValueOnce({
      outcome: 'TRANSIENT_ERROR',
      errorMessage: 'Network timeout',
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('uncertain_put_timeout');
    expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
    expect(activeRecord.financial_safety_status).toBe('live');
    expect(activeRecord.financial_attention_required).toBe(false);
  });

  // 5. PUT 5xx -> awaiting
  it('5. PUT 5xx -> awaiting', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({ outcome: 'FOUND', status: 'ACTIVE' });
    mockProvider.inactivateSubscriptionStrict.mockResolvedValueOnce({
      outcome: 'TRANSIENT_ERROR',
      httpStatus: 502,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('uncertain_put_timeout');
    expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
    expect(activeRecord.financial_attention_required).toBe(false);
  });

  // 6. GET timeout -> awaiting
  it('6. GET timeout -> awaiting', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({
      outcome: 'TRANSIENT_ERROR',
      errorMessage: 'Connection timed out',
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('transient_provider_read_error');
    expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
    expect(activeRecord.financial_attention_required).toBe(false);
  });

  // 7. GET 5xx -> awaiting
  it('7. GET 5xx -> awaiting', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({
      outcome: 'TRANSIENT_ERROR',
      httpStatus: 500,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('transient_provider_read_error');
    expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
  });

  // 8. GET 401 -> attention
  it('8. GET 401 -> attention', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({
      outcome: 'AUTH_ERROR',
      httpStatus: 401,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_auth_failure');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.PROVIDER_AUTH_FAILURE);
    expect(activeRecord.financial_safety_status).toBe('attention_required');
  });

  // 9. GET 403 -> attention
  it('9. GET 403 -> attention', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({
      outcome: 'AUTH_ERROR',
      httpStatus: 403,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.PROVIDER_AUTH_FAILURE);
  });

  // 10. GET 404 -> attention (404 is NEVER cancellation proof)
  it('10. GET 404 -> attention (resource divergence, never safe cancellation)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({
      outcome: 'NOT_FOUND',
      httpStatus: 404,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_resource_divergence');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.PROVIDER_RESOURCE_DIVERGENCE);
    expect(activeRecord.financial_safety_status).toBe('attention_required');
  });

  // 11. PUT 404 -> attention
  it('11. PUT 404 -> attention', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({ outcome: 'FOUND', status: 'ACTIVE' });
    mockProvider.inactivateSubscriptionStrict.mockResolvedValueOnce({
      outcome: 'NOT_FOUND',
      httpStatus: 404,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_resource_divergence');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.PROVIDER_RESOURCE_DIVERGENCE);
  });

  // 12. malformed subscription response -> attention/fail closed
  it('12. malformed subscription response -> attention/fail closed', async () => {
    mockProvider.getSubscriptionState.mockResolvedValueOnce({
      outcome: 'MALFORMED_RESPONSE',
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('malformed_provider_subscription');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.MALFORMED_PROVIDER_SUBSCRIPTION);
  });

  // 13. future PENDING removed
  it('13. future PENDING removed surgically', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments
      .mockResolvedValueOnce([
        { id: 'pay_fut_1', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'PENDING' },
      ])
      .mockResolvedValueOnce([]); // fresh re-read confirms gone

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_1');
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(activeRecord.payment_cleanup_ids).toContain('pay_fut_1');
    expect(activeRecord.payment_cleanup_status).toBe('completed');
  });

  // 14. multiple future PENDING all removed
  it('14. multiple future PENDING all removed', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments
      .mockResolvedValueOnce([
        { id: 'pay_fut_1', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'PENDING' },
        { id: 'pay_fut_2', subscriptionId: sourceSubId, dueDate: '2026-11-01', status: 'PENDING' },
      ])
      .mockResolvedValueOnce([]); // fresh re-read empty

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(mockProvider.removePayment).toHaveBeenCalledTimes(2);
    expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_1');
    expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_2');
    expect(activeRecord.payment_cleanup_ids).toEqual(['pay_fut_1', 'pay_fut_2']);
    expect(activeRecord.transition_status).toBe('scheduled');
  });

  // 15. historical settled same subscription preserved (MANDATORY TEST)
  it('15. historical settled on the same subscription preserved untouched', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    const pastSettled = {
      id: 'pay_past_settled',
      subscriptionId: sourceSubId,
      dueDate: '2026-09-01',
      status: 'CONFIRMED',
    };
    const futurePending = {
      id: 'pay_fut_pending',
      subscriptionId: sourceSubId,
      dueDate: '2026-10-01',
      status: 'PENDING',
    };

    mockProvider.listSubscriptionPayments
      .mockResolvedValueOnce([pastSettled, futurePending])
      .mockResolvedValueOnce([pastSettled]); // re-read preserves pastSettled

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(mockProvider.removePayment).toHaveBeenCalledTimes(1);
    expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_pending');
    expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_past_settled');
    expect(activeRecord.transition_status).toBe('scheduled');
  });

  // 16. payment before cutoff preserved
  it('16. payment before cutoff preserved even if pending', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    const beforeCutoff = {
      id: 'pay_before_cutoff',
      subscriptionId: sourceSubId,
      dueDate: '2026-09-25',
      status: 'PENDING',
    };

    mockProvider.listSubscriptionPayments
      .mockResolvedValueOnce([beforeCutoff])
      .mockResolvedValueOnce([beforeCutoff]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
    expect(activeRecord.transition_status).toBe('scheduled');
  });

  // 17. future CONFIRMED -> attention
  it('17. future CONFIRMED -> attention (financial conflict, zero auto-refund)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_conf', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'CONFIRMED' },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('future_settled_obligation_detected');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_SETTLED_OBLIGATION_DETECTED);
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
    expect(mockProvider.refundPayment).not.toHaveBeenCalled();
  });

  // 18. future RECEIVED -> attention
  it('18. future RECEIVED -> attention', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_rec', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'RECEIVED' },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_SETTLED_OBLIGATION_DETECTED);
  });

  // 19. future RECEIVED_IN_CASH -> attention
  it('19. future RECEIVED_IN_CASH -> attention', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_cash', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'RECEIVED_IN_CASH' },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_SETTLED_OBLIGATION_DETECTED);
  });

  // 20. future OVERDUE -> attention
  it('20. future OVERDUE -> attention (blocking obligation, not removed)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_od', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'OVERDUE' },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('future_overdue_obligation_detected');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_OVERDUE_OBLIGATION_DETECTED);
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
  });

  // 21. malformed future payment -> attention
  it('21. malformed future payment -> attention/fail-closed', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_malf', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: undefined as any },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('malformed_provider_payment');
    expect(activeRecord.financial_attention_required).toBe(true);
  });

  // 22. cleanup transient failure -> awaiting
  it('22. cleanup transient failure -> remains awaiting for retry', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_err', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'PENDING' },
    ]);
    mockProvider.removePayment.mockRejectedValueOnce(new Error('Gateway timeout'));
    mockProvider.getPayment.mockResolvedValueOnce({ id: 'pay_err', status: 'PENDING' });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('cleanup_transient_failure');
    expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
    expect(activeRecord.financial_safety_status).toBe('live');
  });

  // 23. PENDING->CONFIRMED race -> attention
  it('23. PENDING->CONFIRMED race during cleanup -> attention required', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
      { id: 'pay_race', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'PENDING' },
    ]);
    mockProvider.removePayment.mockRejectedValueOnce(new Error('Cannot delete paid charge'));
    mockProvider.getPayment.mockResolvedValueOnce({ id: 'pay_race', status: 'CONFIRMED' });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('cleanup_race_settled');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.CLEANUP_RACE_SETTLED);
    expect(activeRecord.financial_safety_status).toBe('attention_required');
  });

  // 24. fresh read after cleanup required
  it('24. fresh read after cleanup required (promotion blocked if PENDING still persists in fresh read)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments
      .mockResolvedValueOnce([
        { id: 'pay_stubborn', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'PENDING' },
      ])
      .mockResolvedValueOnce([
        { id: 'pay_stubborn', subscriptionId: sourceSubId, dueDate: '2026-10-01', status: 'PENDING' },
      ]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('cleanup_incomplete');
    expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
  });

  // 25. no DELETE subscription
  it('25. NEVER calls DELETE /v3/subscriptions/{id} (removeSubscription)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(mockProvider.removeSubscription).not.toHaveBeenCalled();
  });

  // 26. zero refund
  it('26. zero refund executed during cancel orchestration', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(mockProvider.refundPayment).not.toHaveBeenCalled();
  });

  // 27. entitlement stays paid after scheduled
  it('27. entitlement stays paid after scheduled', async () => {
    activeRecord.transition_status = 'scheduled';

    const summary = await mockSubscriptionService.getSubscriptionSummary(ministryId);

    expect(summary.planId).toBe('essential');
    expect(summary.billingStatus).toBe('paid');
    expect(summary.memberLimit).toBe(30);
    expect(summary.songLimit).toBe(150);
  });

  // 28. current_period_end unchanged
  it('28. current_period_end unchanged throughout cancellation', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(activeRecord.current_period_end).toBe(currentPeriodEnd);
    expect(activeRecord.effective_billing_date).toBe(effectiveBillingDate);
    expect(billingSubRecord.current_period_end).toBe(currentPeriodEnd);
  });

  // 29. slot remains HELD
  it('29. slot remains HELD throughout awaiting and scheduled states', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(activeRecord.transition_status).toBe('scheduled');
    expect(mockBillingRepo.releaseSlotIfOwnedAndSafe).not.toHaveBeenCalled();
    expect(activeSlot.held).toBe(true);
  });

  // 30. transition scheduled idempotent NO-OP
  it('30. transition scheduled is idempotent NO-OP without provider mutations', async () => {
    activeRecord.transition_status = 'scheduled';

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(true);
    expect(res.reason).toBe('already_scheduled');
    expect(mockProvider.getSubscriptionState).not.toHaveBeenCalled();
    expect(mockProvider.inactivateSubscriptionStrict).not.toHaveBeenCalled();
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
  });

  // 31. duplicate public cancel uses same transition
  it('31. duplicate public cancel uses same transition without creating a new one', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    const res1 = await billingService.cancelSubscriptionV1(ministryId);
    expect(res1.transition?.transitionId).toBe(activeRecord.id);

    const res2 = await billingService.cancelSubscriptionV1(ministryId);
    expect(res2.transition?.transitionId).toBe(activeRecord.id);
    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
  });

  // 32. concurrent public cancel remains one transition
  it('32. concurrent public cancel remains one transition (recovers concurrent slot or rejects if conflict)', async () => {
    // Cenário A: corrida concorrente onde outro request/worker acabou de criar a transição de cancelamento
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValueOnce(null);
    mockBillingRepo.createTransitionAndClaimSlot.mockRejectedValueOnce(
      new AppError(409, 'Existe uma transição de plano ativa para este ministério.', {
        code: 'ACTIVE_TRANSITION_EXISTS',
      })
    );
    // Ao reler, encontra a transição criada concorrentemente
    const concurrentResult = await billingService.cancelSubscriptionV1(ministryId);
    expect(concurrentResult.transition?.transitionId).toBe(activeRecord.id);

    // Cenário B: conflito concorrente com estratégia incompatível (ex: upgrade em andamento)
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValueOnce(null);
    mockBillingRepo.createTransitionAndClaimSlot.mockRejectedValueOnce(
      new AppError(409, 'Existe uma transição de plano ativa para este ministério.', {
        code: 'ACTIVE_TRANSITION_EXISTS',
      })
    );
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValueOnce({
      slot: { id: 'slot_diff', plan_change_id: 'tr_diff' },
      transition: {
        id: 'tr_diff',
        policy_version: 'billing_transition_v1',
        execution_strategy: 'immediate_initial_purchase',
      },
    });

    await expect(billingService.cancelSubscriptionV1(ministryId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 409,
        details: expect.objectContaining({ code: 'ACTIVE_TRANSITION_EXISTS' }),
      })
    );
  });

  // 33. crash before PUT recoverable
  it('33. crash before PUT recoverable (worker picks up awaiting transition and succeeds)', async () => {
    activeRecord.transition_status = 'awaiting_old_inactivation';
    mockProvider.getSubscriptionState.mockResolvedValueOnce({ outcome: 'FOUND', status: 'ACTIVE' });
    mockProvider.inactivateSubscriptionStrict.mockResolvedValueOnce({ outcome: 'SUCCESS', httpStatus: 200 });
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id, 'worker_recovery');

    expect(res.success).toBe(true);
    expect(activeRecord.transition_status).toBe('scheduled');
  });

  // 34. crash after PUT recoverable via GET
  it('34. crash after PUT recoverable via GET (sees INACTIVE without resending PUT)', async () => {
    activeRecord.source_inactivation_attempted_at = '2026-09-04T12:05:00.000Z';
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id, 'worker_recovery');

    expect(res.success).toBe(true);
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(mockProvider.inactivateSubscriptionStrict).not.toHaveBeenCalled();
  });

  // 35. crash after payment removal recoverable via list
  it('35. crash after payment removal recoverable via list (future payments already absent)', async () => {
    activeRecord.payment_cleanup_ids = ['pay_fut_1'];
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]); // already absent

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id, 'worker_recovery');

    expect(res.success).toBe(true);
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
  });

  // 36. scheduled write crash / idempotent response
  it('36. scheduled transition idempotent response on subsequent calls', async () => {
    activeRecord.transition_status = 'scheduled';

    const result = await billingService.cancelSubscriptionV1(ministryId);

    expect(result.transition?.transitionStatus).toBe('scheduled');
    expect(result.cancel_at_period_end).toBe(true);
  });

  // 37. worker routes awaiting cancel
  it('37. worker routes awaiting_old_inactivation to reconcileScheduledCancelToFreeDoNotRenew', async () => {
    mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValue([activeRecord]);
    const recSpy = vi.spyOn(billingService, 'reconcileScheduledCancelToFreeDoNotRenew').mockResolvedValue({
      success: true,
      transition: { ...activeRecord, transition_status: 'scheduled' },
    });

    const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
    const report = await worker.runCycle();

    expect(recSpy).toHaveBeenCalledWith(activeRecord.id, expect.any(String));
    expect(report.processed).toBe(1);
    expect(report.succeeded).toBe(1);
  });

  // 38. worker does not silently fall through scheduled cancel
  it('38. worker does not silently fall through scheduled cancel (intentional NO-OP pending 3D.3)', async () => {
    activeRecord.transition_status = 'scheduled';
    mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValue([activeRecord]);
    const recSpy = vi.spyOn(billingService, 'reconcileScheduledCancelToFreeDoNotRenew');

    const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
    const report = await worker.runCycle();

    expect(recSpy).not.toHaveBeenCalled();
    expect(report.processed).toBe(1);
    expect(report.succeeded).toBe(1); // handled safely without error or unexpected fallthrough
  });

  // 39. scheduler fairness reused
  it('39. scheduler fairness reused (relies on getV1TransitionsNeedingReconciliation)', async () => {
    mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValue([activeRecord]);

    const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
    await worker.runCycle();

    expect(mockBillingRepo.getV1TransitionsNeedingReconciliation).toHaveBeenCalledWith('asaas', 20);
  });

  // 40. reactivate still 409
  it('40. reactivate throws 409 and blocks provider reactivate when cancel transition is active', async () => {
    const cancelStatuses = ['awaiting_old_inactivation', 'scheduled', 'financial_attention_required'] as const;

    for (const st of cancelStatuses) {
      activeRecord.transition_status = st;
      await expect(billingService.reactivateSubscription(ministryId)).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ACTIVE_CANCELLATION_TRANSITION_EXISTS' }),
        })
      );
      expect(mockProvider.reactivateSubscription).not.toHaveBeenCalled();
    }
  });

  // 41. member role 403
  it('41. member role receives 403 on cancel route', async () => {
    const { MinistryRepository } = await import('../../repositories/MinistryRepository');
    vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValueOnce({
      id: ministryId,
      role: 'member',
    } as any);

    const middleware = requireMinistryRole('admin');
    const mockReq = {
      user: { id: 'usr_member' },
      params: { ministryId },
    } as any as AuthenticatedRequest;
    const mockRes = {} as Response;
    const mockNext = vi.fn();

    await middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
      })
    );
  });

  // 42. cross-tenant 403
  it('42. cross-tenant access receives 403/404', async () => {
    const { MinistryRepository } = await import('../../repositories/MinistryRepository');
    vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockRejectedValueOnce(
      new AppError(404, 'Ministério não encontrado.')
    );

    const middleware = requireMinistryRole('admin');
    const mockReq = {
      user: { id: 'usr_member' },
      params: { ministryId: 'min_other_foreign' },
    } as any as AuthenticatedRequest;
    const mockRes = {} as Response;
    const mockNext = vi.fn();

    await middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
      })
    );
  });

  // 43. response DTO has no provider IDs
  it('43. response DTO contains zero provider internal IDs or customer IDs', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    const result = await billingService.cancelSubscriptionV1(ministryId);
    const dto = result.transition!;

    expect(dto).toBeDefined();
    expect((dto as any).providerCustomerId).toBeUndefined();
    expect((dto as any).providerSubscriptionId).toBeUndefined();
    expect((dto as any).oldProviderSubscriptionId).toBeUndefined();
    expect((dto as any).paymentId).toBeUndefined();
    expect((dto as any).activeTransitionSlotId).toBeUndefined();
  });

  // 44. cancel_at_period_end compatibility if retained
  it('44. cancel_at_period_end synchronized on billing and application subscriptions', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    await billingService.cancelSubscriptionV1(ministryId);

    expect(billingSubRecord.cancel_at_period_end).toBe(true);
    expect(appSubRecord.cancel_at_period_end).toBe(true);
  });

  // 45. local billing status does not prematurely revoke entitlement
  it('45. local billing status does not prematurely revoke entitlement (status remains active, not canceled)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
    mockProvider.listSubscriptionPayments.mockResolvedValue([]);

    await billingService.cancelSubscriptionV1(ministryId);

    expect(billingSubRecord.status).toBe('active');
    expect(appSubRecord.plan_id).toBe('essential');
    expect(appSubRecord.access_mode).toBe('full');
  });

  // Additional safety test: Active slot divergence causes immediate fail-closed
  it('Active slot divergence or missing causes immediate fail-closed without provider calls', async () => {
    mockBillingRepo.getActiveTransitionSlot.mockResolvedValueOnce({
      id: buildActiveTransitionSlotId(ministryId, providerName),
      plan_change_id: 'tr_other_foreign',
      ministry_id: ministryId,
      provider: providerName,
    });

    const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('active_slot_missing_or_divergent');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.ACTIVE_SLOT_MISSING_OR_DIVERGENT);
    expect(mockProvider.getSubscriptionState).not.toHaveBeenCalled();
    expect(mockProvider.inactivateSubscriptionStrict).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Phase 3D.2 Hardening — Section 27 Test Matrix Delta
  // ==========================================================================

  describe('Phase 3D.2 Hardening — Capability, Pagination & Deployability Delta', () => {
    it('46. Strict capability absent: fail-closed with STRICT_PROVIDER_CONTRACT_UNAVAILABLE, remains awaiting, slot HELD', async () => {
      const providerWithoutStrict = {
        name: providerName,
        getSubscription: vi.fn(),
        inactivateSubscription: vi.fn(),
      };
      const service = new BillingService(
        mockBillingRepo,
        mockSubscriptionService,
        mockSubscriptionRepo,
        mockMinistryRepo,
        providerWithoutStrict as any,
        mockUserRepo
      );

      const res = await service.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('STRICT_PROVIDER_CONTRACT_UNAVAILABLE');
      expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
      expect(activeSlot.held).toBe(true);
      expect(providerWithoutStrict.inactivateSubscription).not.toHaveBeenCalled();
    });

    it('47. No V1 -> legacy fallback: cancelSubscriptionV1 never delegates to cancelSubscriptionLegacy', async () => {
      const legacySpy = vi.spyOn(billingService, 'cancelSubscriptionLegacy');
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });

      await billingService.cancelSubscriptionV1(ministryId);

      expect(legacySpy).not.toHaveBeenCalled();
      expect(mockProvider.removeSubscription).not.toHaveBeenCalled();
    });

    it('48. Public cancelSubscription executes V1 flow and delegates to cancelSubscriptionV1', async () => {
      const v1Spy = vi.spyOn(billingService, 'cancelSubscriptionV1').mockResolvedValue({
        ministry_id: ministryId,
        provider: providerName,
        status: 'active',
        cancel_at_period_end: true,
        transition: {
          transitionId: 'tr_test_1',
          status: 'pending',
          executionStrategy: 'scheduled_cancel_to_free',
          targetPlanId: 'free',
          effectiveBillingDate: '2026-10-01',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          cancelAtPeriodEnd: true,
          entitlementPreserved: true,
          message: 'Cancelamento agendado para o final do período vigente.',
        },
      } as any);
      const legacySpy = vi.spyOn(billingService, 'cancelSubscriptionLegacy');

      const res = await billingService.cancelSubscription(ministryId);

      expect(v1Spy).toHaveBeenCalledWith(ministryId, undefined);
      expect(legacySpy).not.toHaveBeenCalled();
      expect(res.cancel_at_period_end).toBe(true);
      expect(res.transition).toBeDefined();
    });

    it('49. Controller cancelSubscription returns envelope { message, subscription, transition } with transition DTO', async () => {
      const controller = new BillingController(billingService, mockSubscriptionService);
      const mockTransitionDto: ScheduledCancelToFreeResponseDto = {
        transitionId: 'tr_test_dto',
        executionStrategy: 'scheduled_cancel_to_free',
        transitionStatus: 'scheduled',
        financialSafetyStatus: 'live',
        sourcePlanId: 'pro',
        targetPlanId: 'free',
        effectiveBillingDate: '2026-10-01',
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        cancelAtPeriodEnd: true,
        entitlementPreserved: true,
        message: 'Cancelamento agendado para o final do período vigente.',
      };

      vi.spyOn(billingService, 'cancelSubscription').mockResolvedValue({
        ministry_id: ministryId,
        provider: providerName,
        status: 'active',
        cancel_at_period_end: true,
        transition: mockTransitionDto,
      } as any);

      const mockReq = {
        user: { id: 'usr_admin' },
        params: { ministryId },
      } as any as AuthenticatedRequest;
      const jsonMock = vi.fn();
      const mockRes = { json: jsonMock } as any as Response;
      const mockNext = vi.fn();

      await controller.cancelSubscription(mockReq, mockRes, mockNext);

      expect(jsonMock).toHaveBeenCalledWith({
        message: 'Cancelamento agendado para o final do período vigente.',
        subscription: expect.objectContaining({ cancel_at_period_end: true }),
        transition: mockTransitionDto,
      });
      expect(jsonMock.mock.calls[0][0].transition).toEqual(mockTransitionDto);
    });

    it('50. Multi-page Case A: Page 1 safe history + Page 2 future CONFIRMED -> attention, never scheduled', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
      mockProvider.listAllSubscriptionPaymentsStrict.mockResolvedValue({
        outcome: 'SUCCESS',
        payments: [
          {
            id: 'pay_hist_1',
            subscriptionId: sourceSubId,
            status: 'RECEIVED',
            dueDate: '2026-09-01',
            amountCents: 2990,
          },
          {
            id: 'pay_future_confirmed_p2',
            subscriptionId: sourceSubId,
            status: 'CONFIRMED',
            dueDate: '2026-10-05', // >= effectiveBillingDate 2026-10-01
            amountCents: 2990,
          },
        ],
      });

      const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('future_settled_obligation_detected');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_SETTLED_OBLIGATION_DETECTED);
      expect(activeRecord.transition_status).not.toBe('scheduled');
      expect(activeSlot.held).toBe(true);
    });

    it('51. Multi-page Case B: Page 1 future PENDING A + Page 2 future PENDING B -> both cleaned, fresh re-read = 0 -> scheduled', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
      mockProvider.listAllSubscriptionPaymentsStrict
        // First list: returns both future PENDING payments across pages
        .mockResolvedValueOnce({
          outcome: 'SUCCESS',
          payments: [
            {
              id: 'pay_fut_pending_p1',
              subscriptionId: sourceSubId,
              status: 'PENDING',
              dueDate: '2026-10-01',
              amountCents: 2990,
            },
            {
              id: 'pay_fut_pending_p2',
              subscriptionId: sourceSubId,
              status: 'PENDING',
              dueDate: '2026-11-01',
              amountCents: 2990,
            },
          ],
        })
        // Fresh re-read (Section 13): exhaustive empty list confirming convergence
        .mockResolvedValueOnce({
          outcome: 'SUCCESS',
          payments: [],
        });

      const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(true);
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_pending_p1');
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_pending_p2');
      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeRecord.payment_cleanup_ids).toEqual(['pay_fut_pending_p1', 'pay_fut_pending_p2']);
      expect(activeRecord.payment_cleanup_completed_at).toBeTruthy();
    });

    it('52. Multi-page Case C: Page 1 empty with hasMore=true, Page 2 blocking -> obligation detected', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
      mockProvider.listAllSubscriptionPaymentsStrict.mockResolvedValue({
        outcome: 'SUCCESS',
        payments: [
          {
            id: 'pay_fut_overdue_p2',
            subscriptionId: sourceSubId,
            status: 'OVERDUE',
            dueDate: '2026-10-05',
            amountCents: 2990,
          },
        ],
      });

      const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('future_overdue_obligation_detected');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_OVERDUE_OBLIGATION_DETECTED);
      expect(activeRecord.transition_status).not.toBe('scheduled');
    });

    it('53. Multi-page Case D: Page 2 transient failure -> awaiting, slot HELD, not scheduled', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
      mockProvider.listAllSubscriptionPaymentsStrict.mockResolvedValue({
        outcome: 'TRANSIENT_ERROR',
        errorMessage: 'Network timeout on page 2',
      });

      const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('transient_payment_list_error');
      expect(activeRecord.transition_status).toBe('awaiting_old_inactivation');
      expect(activeRecord.financial_attention_required).toBe(false);
      expect(activeSlot.held).toBe(true);
    });

    it('54. Multi-page Case E: Conflicting duplicate payment IDs across pages -> fail closed attention', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
      mockProvider.listAllSubscriptionPaymentsStrict.mockResolvedValue({
        outcome: 'MALFORMED_RESPONSE',
        errorMessage: 'Conflito de estado detectado para a cobrança pay_conflict_dup: PENDING vs CONFIRMED',
      });

      const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('malformed_provider_payment');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.MALFORMED_PROVIDER_PAYMENT);
      expect(activeRecord.transition_status).not.toBe('scheduled');
      expect(activeSlot.held).toBe(true);
    });

    it('55. Same-source history across pages: Page 1 RECEIVED before cutoff preserved, Page 2 PENDING cleaned', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({ outcome: 'FOUND', status: 'INACTIVE' });
      mockProvider.listAllSubscriptionPaymentsStrict
        .mockResolvedValueOnce({
          outcome: 'SUCCESS',
          payments: [
            {
              id: 'pay_hist_received_p1',
              subscriptionId: sourceSubId,
              status: 'RECEIVED',
              dueDate: '2026-09-01', // Before cutoff 2026-10-01
              amountCents: 2990,
            },
            {
              id: 'pay_fut_pending_p2',
              subscriptionId: sourceSubId,
              status: 'PENDING',
              dueDate: '2026-10-01', // At cutoff
              amountCents: 2990,
            },
          ],
        })
        .mockResolvedValueOnce({
          outcome: 'SUCCESS',
          payments: [
            {
              id: 'pay_hist_received_p1',
              subscriptionId: sourceSubId,
              status: 'RECEIVED',
              dueDate: '2026-09-01',
              amountCents: 2990,
            },
          ],
        });

      const res = await billingService.reconcileScheduledCancelToFreeDoNotRenew(activeRecord.id);

      expect(res.success).toBe(true);
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_fut_pending_p2');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_hist_received_p1');
      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeRecord.payment_cleanup_ids).toEqual(['pay_fut_pending_p2']);
    });
  });
});
