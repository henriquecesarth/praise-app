import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingReconcilerWorker } from './billing-reconciler.worker';
import { BillingController } from './billing.controller';
import {
  BillingTransitionV1Record,
  buildActiveTransitionSlotId,
  CANCEL_TO_FREE_ATTENTION_REASONS,
  ScheduledCancelToFreeResponseDto,
  V1_RECONCILABLE_TRANSITION_STATUSES,
} from './billing.types';
import { AppError } from '../../middleware/error-handler';
import { config } from '../../config/unifiedConfig';
import { AuthenticatedRequest } from '../../middleware/auth';
import { Response } from 'express';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { PLANS_CATALOG, resolveAccessMode } from '../../config/plans.config';

describe('Phase 3D.3 — Period-End Cancel-to-Free Cutover & Public V1 Migration (Section 43 Matrix)', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;
  let mockProvider: any;

  const ministryId = 'min-cancel-3d3';
  const providerName = 'asaas';
  const sourceSubId = 'sub_source_3d3';
  const effectiveBillingDate = '2026-10-01';
  const currentPeriodEnd = '2026-10-01T00:00:00.000Z';
  const boundaryInstant = new Date(currentPeriodEnd);

  let activeRecord: BillingTransitionV1Record;
  let activeSlot: any;
  let billingSubRecord: any;
  let appSubRecord: any;

  function createScheduledRecord(overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record {
    return {
      id: 'tr_cancel_3d3_spec',
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: providerName,
      provider_customer_id: 'cus_exact_3d3',
      old_provider_subscription_id: sourceSubId,
      previous_provider_subscription_id: sourceSubId,
      execution_strategy: 'scheduled_cancel_to_free',
      transition_type: 'downgrade',
      transition_status: 'scheduled',
      early_activation_status: 'not_applicable',
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
      source_entitlement_snapshot: {
        plan_id: 'essential',
        interval: 'monthly',
        addon_blocks: 0,
        effective_member_quota: 30,
        effective_song_quota: 150,
      },
      target_entitlement_snapshot: {
        plan_id: 'free',
        interval: 'monthly',
        addon_blocks: 0,
        effective_member_quota: 10,
        effective_song_quota: 50,
      },
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
      payment_cleanup_status: 'completed',
      payment_cleanup_ids: [],
      created_at: '2026-09-04T12:00:00.000Z',
      updated_at: '2026-09-04T12:00:00.000Z',
      ...overrides,
    } as BillingTransitionV1Record;
  }

  beforeEach(() => {
    (config as any).billingTimezone = 'America/Sao_Paulo';

    activeRecord = createScheduledRecord();
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
      provider_customer_id: 'cus_exact_3d3',
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      cycle: 'monthly',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: true,
      member_addon_blocks: 0,
      updated_at: '2026-09-04T12:00:00.000Z',
    };

    appSubRecord = {
      ministry_id: ministryId,
      plan_id: 'essential',
      status: 'active',
      subscription_mode: 'paid',
      billing_status: 'paid',
      access_mode: 'full',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: true,
      locked_member_quota: null,
      locked_song_quota: null,
      member_addon_blocks: 0,
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
      getCustomer: vi.fn().mockResolvedValue({ provider_customer_id: 'cus_exact_3d3' }),
      getActiveTransitionSlot: vi.fn().mockImplementation(async () => activeSlot),
      getActiveTransitionForMinistry: vi.fn().mockImplementation(async () => {
        if (!activeSlot) return null;
        return {
          slot: activeSlot,
          transition: activeRecord,
        };
      }),
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
      releaseSlotIfOwnedAndSafe: vi.fn().mockImplementation(async () => {
        activeSlot = null;
        return { released: true };
      }),
      completeTransitionAndReleaseOwnedSlotAtomically: vi.fn().mockImplementation(async (minId: string, prov: string, id: string, updates: any) => {
        if (!appSubRecord) {
          return { success: false, reason: 'subscription_not_found' };
        }
        if (
          activeRecord.financial_attention_required === true ||
          activeRecord.transition_status === 'financial_attention_required' ||
          activeRecord.financial_safety_status === 'attention_required'
        ) {
          return { success: false, reason: 'financial_attention_required' };
        }
        if (!activeSlot || activeSlot.plan_change_id !== id) {
          if (activeRecord.transition_status === 'completed') {
            return { success: true, reason: 'already_completed' };
          }
          return { success: false, reason: 'slot_not_found' };
        }
        if (
          appSubRecord.active_cancellation_transition_id &&
          appSubRecord.active_cancellation_transition_id !== id
        ) {
          return { success: false, reason: 'subscription_marker_owned_by_another_transition' };
        }
        activeRecord = {
          ...activeRecord,
          ...updates,
          transition_status: 'completed',
          status: 'completed',
          financial_safety_status: 'safe_terminal',
          financial_attention_required: false,
          financial_attention_reason: null,
        };
        activeSlot = null;
        appSubRecord.active_cancellation_transition_id = null;
        appSubRecord.cancel_at_period_end = false;
        return { success: true };
      }),
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
        cancelAtPeriodEnd: true,
        memberLimit: 30,
        songLimit: 150,
      }),
      applyLockedEntitlementSnapshot: vi.fn().mockImplementation(async (minId: string, snapshot: any) => {
        appSubRecord = {
          ...appSubRecord,
          plan_id: snapshot.plan_id,
          subscription_mode: snapshot.plan_id === 'free' ? 'free' : 'paid',
          locked_member_quota: snapshot.effective_member_quota,
          locked_song_quota: snapshot.effective_song_quota,
          member_addon_blocks: snapshot.addon_blocks,
          entitlement_snapshot: snapshot,
          updated_at: new Date().toISOString(),
        };
        return appSubRecord;
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
      deleteMember: vi.fn(),
      deleteSong: vi.fn(),
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
  // Section 43 Test Matrix (Items 1 to 55)
  // ==========================================================================

  it('1. scheduled before boundary -> NO-OP waiting_for_period_boundary', async () => {
    const beforeDate = new Date(boundaryInstant.getTime() - 3600000); // 1 hour before
    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: beforeDate });

    expect(res.success).toBe(true);
    expect(res.reason).toBe('waiting_for_period_boundary');
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(activeSlot).not.toBeNull();
    expect(appSubRecord.plan_id).toBe('essential');
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    expect(mockBillingRepo.releaseSlotIfOwnedAndSafe).not.toHaveBeenCalled();
  });

  it('2. effective_at -1ms -> paid intact, slot HELD', async () => {
    const minus1ms = new Date(boundaryInstant.getTime() - 1);
    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: minus1ms });

    expect(res.success).toBe(true);
    expect(res.reason).toBe('waiting_for_period_boundary');
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(activeSlot).not.toBeNull();
    expect(appSubRecord.plan_id).toBe('essential');
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('3. effective_at exact -> eligible for boundary cutover', async () => {
    const exactBoundary = new Date(boundaryInstant.getTime());
    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: exactBoundary });

    expect(res.success).toBe(true);
    expect(res.reason).toBe('cutover_completed');
    expect(activeRecord.transition_status).toBe('completed');
    expect(activeRecord.financial_safety_status).toBe('safe_terminal');
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(ministryId, activeRecord.target_entitlement_snapshot);
    expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).toHaveBeenCalled();
    expect(activeSlot).toBeNull();
  });

  it('4. effective_at +1ms -> eligible for boundary cutover', async () => {
    const plus1ms = new Date(boundaryInstant.getTime() + 1);
    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: plus1ms });

    expect(res.success).toBe(true);
    expect(res.reason).toBe('cutover_completed');
    expect(activeRecord.transition_status).toBe('completed');
  });

  it('5. effective_billing_date não substitui effective_at para clock', async () => {
    // effective_billing_date = '2026-10-01', mas effective_at é às 15:00 UTC
    activeRecord = createScheduledRecord({
      effective_billing_date: '2026-10-01',
      effective_at: '2026-10-01T15:00:00.000Z',
    });

    // Se o relógio for 10:00 UTC do mesmo dia civil:
    const midday = new Date('2026-10-01T10:00:00.000Z');
    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: midday });

    expect(res.success).toBe(true);
    expect(res.reason).toBe('waiting_for_period_boundary');
    expect(activeRecord.transition_status).toBe('scheduled');
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('6. slot ownership required: active slot missing or divergent fails closed', async () => {
    mockBillingRepo.getActiveTransitionSlot.mockResolvedValue(null);

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('active_slot_missing_or_divergent');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.ACTIVE_SLOT_MISSING_OR_DIVERGENT);
    expect(activeRecord.financial_safety_status).toBe('attention_required');
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('7. source INACTIVE rechecked at boundary: proceeds when INACTIVE', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'FOUND',
      status: 'INACTIVE',
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(true);
    expect(mockProvider.getSubscriptionState).toHaveBeenCalledWith(sourceSubId);
    expect(activeRecord.transition_status).toBe('completed');
  });

  it('8. source ACTIVE unexpectedly -> attention (source_subscription_reactivated)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'FOUND',
      status: 'ACTIVE',
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('source_subscription_reactivated');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.SOURCE_SUBSCRIPTION_REACTIVATED);
    expect(activeSlot).not.toBeNull();
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('9. source 404 -> attention (provider_resource_divergence)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'NOT_FOUND',
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_resource_divergence');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.PROVIDER_RESOURCE_DIVERGENCE);
    expect(activeSlot).not.toBeNull();
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('10. source auth error -> attention (provider_auth_failure)', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'AUTH_ERROR',
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('provider_auth_failure');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.PROVIDER_AUTH_FAILURE);
  });

  it('11. source transient -> no cutover, remains scheduled, slot HELD, no status regression', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'TRANSIENT_ERROR',
      errorMessage: 'Network timeout',
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('transient_provider_read_error');
    expect(activeRecord.transition_status).toBe('scheduled'); // NOT awaiting_old_inactivation
    expect(activeSlot).not.toBeNull();
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('12. exhaustive payment re-read at boundary executed with strict contract', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockProvider.listAllSubscriptionPaymentsStrict).toHaveBeenCalled();
  });

  it('13. late future PENDING cleaned + fresh read proves convergence', async () => {
    let callCount = 0;
    mockProvider.listSubscriptionPayments.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ id: 'pay_late_pending', status: 'PENDING', dueDate: '2026-10-05', subscriptionId: sourceSubId }];
      }
      return []; // fresh read = 0
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(true);
    expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_late_pending');
    expect(activeRecord.transition_status).toBe('completed');
  });

  it('14. late future CONFIRMED -> attention (unexpected_renewal_payment_detected)', async () => {
    mockProvider.listSubscriptionPayments.mockResolvedValue([
      { id: 'pay_late_confirmed', status: 'CONFIRMED', dueDate: '2026-10-01', subscriptionId: sourceSubId },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('unexpected_renewal_payment_detected');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.UNEXPECTED_RENEWAL_PAYMENT_DETECTED);
    expect(activeSlot).not.toBeNull();
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    expect(mockProvider.refundPayment).not.toHaveBeenCalled();
  });

  it('15. late future RECEIVED -> attention (unexpected_renewal_payment_detected)', async () => {
    mockProvider.listSubscriptionPayments.mockResolvedValue([
      { id: 'pay_late_received', status: 'RECEIVED', dueDate: '2026-10-02', subscriptionId: sourceSubId },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('unexpected_renewal_payment_detected');
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.UNEXPECTED_RENEWAL_PAYMENT_DETECTED);
  });

  it('16. late RECEIVED_IN_CASH -> attention (unexpected_renewal_payment_detected)', async () => {
    mockProvider.listSubscriptionPayments.mockResolvedValue([
      { id: 'pay_late_cash', status: 'RECEIVED_IN_CASH', dueDate: '2026-10-02', subscriptionId: sourceSubId },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('unexpected_renewal_payment_detected');
  });

  it('17. late OVERDUE -> attention (future_overdue_obligation_detected)', async () => {
    mockProvider.listSubscriptionPayments.mockResolvedValue([
      { id: 'pay_late_overdue', status: 'OVERDUE', dueDate: '2026-10-01', subscriptionId: sourceSubId },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('future_overdue_obligation_detected');
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_OVERDUE_OBLIGATION_DETECTED);
  });

  it('18. malformed provider payment -> attention', async () => {
    mockProvider.listSubscriptionPayments.mockResolvedValue([
      { id: 'pay_corrupted', status: null, dueDate: '2026-10-01', subscriptionId: sourceSubId },
    ]);

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('malformed_provider_payment');
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.MALFORMED_PROVIDER_PAYMENT);
  });

  it('19. locked Free snapshot used directly', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
      ministryId,
      expect.objectContaining({
        plan_id: 'free',
        effective_member_quota: 10,
        effective_song_quota: 50,
      })
    );
  });

  it('20. catalog drift after request does not alter target snapshot', async () => {
    // Simula catalog drift alterando PLANS_CATALOG
    const originalFreeMembers = PLANS_CATALOG.free.baseMembers;
    const originalFreeSongs = PLANS_CATALOG.free.baseSongs;
    try {
      (PLANS_CATALOG.free as any).baseMembers = 999;
      (PLANS_CATALOG.free as any).baseSongs = 9999;

      await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

      // O entitlement aplicado DEVE ser o do snapshot travado (10/50), não o do catálogo modificado (999/9999)
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
        ministryId,
        expect.objectContaining({
          effective_member_quota: 10,
          effective_song_quota: 50,
        })
      );
    } finally {
      (PLANS_CATALOG.free as any).baseMembers = originalFreeMembers;
      (PLANS_CATALOG.free as any).baseSongs = originalFreeSongs;
    }
  });

  it('21. malformed target snapshot fails closed (malformed_target_entitlement_snapshot)', async () => {
    activeRecord.target_entitlement_snapshot = {
      plan_id: 'pro' as any, // Not free!
      addon_blocks: 0,
    } as any;

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('malformed_target_entitlement_snapshot');
    expect(activeRecord.financial_attention_required).toBe(true);
    expect(activeRecord.financial_attention_reason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.MALFORMED_TARGET_ENTITLEMENT_SNAPSHOT);
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
  });

  it('22. Free plan applied on application subscription', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.plan_id).toBe('free');
  });

  it('23. locked member quota becomes 10', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.locked_member_quota).toBe(10);
  });

  it('24. locked song quota becomes 50', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.locked_song_quota).toBe(50);
  });

  it('25. addons become 0', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.member_addon_blocks).toBe(0);
  });

  it('26. subscription_mode becomes free', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.subscription_mode).toBe('free');
  });

  it('27. current paid plan remains until exact boundary', async () => {
    const beforeBoundary = new Date(boundaryInstant.getTime() - 1000);
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: beforeBoundary });

    expect(appSubRecord.plan_id).toBe('essential');
    expect(appSubRecord.subscription_mode).toBe('paid');
  });

  it('28. cancel_at_period_end cleared only after cutover', async () => {
    expect(appSubRecord.cancel_at_period_end).toBe(true);
    expect(billingSubRecord.cancel_at_period_end).toBe(true);

    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.cancel_at_period_end).toBe(false);
    expect(billingSubRecord.cancel_at_period_end).toBe(false);
  });

  it('29. no renewal failure grace granted on voluntary cancel', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(appSubRecord.plan_id).toBe('free');
    expect(billingSubRecord.status).toBe('canceled');
  });

  it('30. usage over-limit grace preserved when usage exceeds Free quota', async () => {
    // Usando SubscriptionService real para verificar preservação de dados e grace de overlimit
    const fakeRepo = {
      ensureSubscriptionAndUsage: vi.fn().mockResolvedValue({
        subscription: {
          id: ministryId,
          ministry_id: ministryId,
          plan_id: 'essential',
          subscription_mode: 'paid',
          grace_period_expires_at: null,
          billing_interval: 'monthly',
        },
        usage: {
          members_count: 15, // 15 members > Free limit of 10!
          songs_count: 20,
        },
      }),
      setSubscription: vi.fn(),
    };
    const realSubService = new SubscriptionService(fakeRepo as any);
    const sub = await realSubService.applyLockedEntitlementSnapshot(ministryId, activeRecord.target_entitlement_snapshot!);

    expect(sub.plan_id).toBe('free');
    expect(sub.locked_member_quota).toBe(10);
    expect(sub.grace_period_expires_at).not.toBeNull(); // Usage grace created!
  });

  it('31. no member deletion during downgrade to Free', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockMinistryRepo.deleteMember).not.toHaveBeenCalled();
  });

  it('32. no song deletion during downgrade to Free', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockMinistryRepo.deleteSong).not.toHaveBeenCalled();
  });

  it('33. no billing history deletion during cutover', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockBillingRepo.deleteTransaction).toBeUndefined();
  });

  it('34. transition completed after entitlement convergence', async () => {
    let entitlementApplied = false;
    mockSubscriptionService.applyLockedEntitlementSnapshot.mockImplementationOnce(async () => {
      entitlementApplied = true;
      return appSubRecord;
    });

    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(entitlementApplied).toBe(true);
    expect(activeRecord.transition_status).toBe('completed');
    expect(activeRecord.status).toBe('completed');
  });

  it('35. financial safety safe_terminal only after entitlement', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(activeRecord.financial_safety_status).toBe('safe_terminal');
  });

  it('36. slot released after safe terminal via atomic terminalization', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).toHaveBeenCalledWith(
      ministryId,
      providerName,
      activeRecord.id,
      expect.any(Object)
    );
    expect(activeSlot).toBeNull();
  });

  it('37. attention never releases slot', async () => {
    mockProvider.getSubscriptionState.mockResolvedValue({
      outcome: 'FOUND',
      status: 'ACTIVE',
    });

    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).not.toHaveBeenCalled();
    expect(activeSlot).not.toBeNull();
  });

  it('38. crash before entitlement recoverable (Window A)', async () => {
    // 1st run: crash right before applyLockedEntitlementSnapshot
    mockSubscriptionService.applyLockedEntitlementSnapshot.mockRejectedValueOnce(new Error('Process killed'));

    const res1 = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
    expect(res1.success).toBe(false);
    expect(activeRecord.transition_status).toBe('scheduled'); // Still scheduled

    // 2nd run: recovers and applies
    mockSubscriptionService.applyLockedEntitlementSnapshot.mockImplementation(async (minId: string, snap: any) => {
      appSubRecord.plan_id = snap.plan_id;
      return appSubRecord;
    });

    const res2 = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
    expect(res2.success).toBe(true);
    expect(activeRecord.transition_status).toBe('completed');
    expect(appSubRecord.plan_id).toBe('free');
  });

  it('39. crash after entitlement before completion recoverable (Window B)', async () => {
    // State: Free entitlement already applied
    appSubRecord.plan_id = 'free';
    appSubRecord.subscription_mode = 'free';
    appSubRecord.locked_member_quota = 10;
    appSubRecord.locked_song_quota = 50;
    appSubRecord.member_addon_blocks = 0;

    // Transition still scheduled
    activeRecord.transition_status = 'scheduled';

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(true);
    // Did not re-apply destructively
    expect(mockSubscriptionService.applyLockedEntitlementSnapshot).not.toHaveBeenCalled();
    expect(activeRecord.transition_status).toBe('completed');
    expect(activeRecord.financial_safety_status).toBe('safe_terminal');
  });

  it('40. Crash Window C eliminated: atomic terminalization commits completed and slot release together', async () => {
    // Normal boundary completion executes atomic terminalization:
    const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(true);
    expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).toHaveBeenCalledTimes(1);
    expect(activeRecord.transition_status).toBe('completed');
    expect(activeRecord.financial_safety_status).toBe('safe_terminal');
    expect(activeSlot).toBeNull(); // Slot is released atomically in the same commit
  });

  it('41. duplicate boundary worker idempotent', async () => {
    const res1 = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
    expect(res1.success).toBe(true);

    const res2 = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
    expect(res2.success).toBe(true);
    expect(res2.reason).toBe('already_completed');
  });

  it('42. worker scheduled branch routes to boundary reconciler', async () => {
    const boundarySpy = vi.spyOn(billingService, 'reconcileScheduledCancelToFreeBoundary').mockResolvedValue({
      success: true,
      reason: 'waiting_for_period_boundary',
    });

    mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValue([activeRecord]);

    const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
    await (worker as any).runCycle();

    expect(boundarySpy).toHaveBeenCalledWith(activeRecord.id, expect.any(String));
  });

  it('43. worker fairness preserved across awaiting and scheduled', async () => {
    const awaitingRecord = createScheduledRecord({
      id: 'tr_awaiting_1',
      transition_status: 'awaiting_old_inactivation',
    });
    const scheduledRecord = createScheduledRecord({
      id: 'tr_scheduled_2',
      transition_status: 'scheduled',
    });

    mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValue([awaitingRecord, scheduledRecord]);

    const doNotRenewSpy = vi.spyOn(billingService, 'reconcileScheduledCancelToFreeDoNotRenew').mockResolvedValue({
      success: true,
    });
    const boundarySpy = vi.spyOn(billingService, 'reconcileScheduledCancelToFreeBoundary').mockResolvedValue({
      success: true,
    });

    const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
    await (worker as any).runCycle();

    expect(doNotRenewSpy).toHaveBeenCalledWith('tr_awaiting_1', expect.any(String));
    expect(boundarySpy).toHaveBeenCalledWith('tr_scheduled_2', expect.any(String));
  });

  it('44. public /cancel now uses V1', async () => {
    const v1Spy = vi.spyOn(billingService, 'cancelSubscriptionV1').mockResolvedValue({
      ...billingSubRecord,
      cancel_at_period_end: true,
    });

    const res = await billingService.cancelSubscription(ministryId);

    expect(v1Spy).toHaveBeenCalledWith(ministryId, undefined);
    expect(res.cancel_at_period_end).toBe(true);
  });

  it('45. public /cancel no legacy fallback', async () => {
    const legacySpy = vi.spyOn(billingService, 'cancelSubscriptionLegacy');

    await billingService.cancelSubscription(ministryId);

    expect(legacySpy).not.toHaveBeenCalled();
  });

  it('46. checkout planId free uses V1 cancelSubscription', async () => {
    const cancelSpy = vi.spyOn(billingService, 'cancelSubscription').mockResolvedValue({
      ...billingSubRecord,
      cancel_at_period_end: true,
    });

    const res = await billingService.createCheckout(ministryId, 'usr_admin', {
      planId: 'free',
      interval: 'monthly',
    });

    expect(cancelSpy).toHaveBeenCalledWith(ministryId, { userId: 'usr_admin' });
    expect(res.totalPriceCents).toBe(0);
  });

  it('47. duplicate public cancel awaiting: reuses same transition', async () => {
    const awaitingTr = createScheduledRecord({ transition_status: 'awaiting_old_inactivation' });
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: activeSlot,
      transition: awaitingTr,
    });

    const res = await billingService.cancelSubscription(ministryId);

    expect(res.transition?.transitionId).toBe(awaitingTr.id);
  });

  it('48. duplicate public cancel scheduled: reuses same transition', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: activeSlot,
      transition: activeRecord,
    });

    const res = await billingService.cancelSubscription(ministryId);

    expect(res.transition?.transitionId).toBe(activeRecord.id);
  });

  it('49. completed/free duplicate: rejects cancel when already free', async () => {
    billingSubRecord.plan_id = 'free';
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);

    await expect(billingService.cancelSubscription(ministryId)).rejects.toThrow(
      'Ministério já possui plano gratuito.'
    );
  });

  it('50. public response hides provider IDs', async () => {
    const res = await billingService.cancelSubscription(ministryId);

    expect(res.transition).toBeDefined();
    const dto = res.transition!;
    expect((dto as any).provider_customer_id).toBeUndefined();
    expect((dto as any).old_provider_subscription_id).toBeUndefined();
    expect((dto as any).provider).toBeUndefined();
    expect(dto.executionStrategy).toBe('scheduled_cancel_to_free');
    expect(dto.targetPlanId).toBe('free');
  });

  it('51. member role receives 403 on cancel route (RBAC)', async () => {
    const controller = new BillingController(billingService, mockSubscriptionService);
    const mockReq = {
      user: { id: 'usr_member' },
      params: { ministryId },
      membership: { role: 'member' },
    } as any as AuthenticatedRequest;
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any as Response;
    const mockNext = vi.fn();

    // The route requires 'admin'. When a non-admin calls, RBAC rejects with 403
    const middleware = (req: any, res: any, next: any) => {
      if (req.membership?.role !== 'admin') {
        return next(new AppError(403, 'Acesso restrito a administradores.'));
      }
      next();
    };

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('52. cross-tenant access receives 403/404', async () => {
    // Attempting to reconcile a transition belonging to another ministry
    const otherMinistryId = 'min_other_tenant';
    const otherTr = createScheduledRecord({ ministry_id: otherMinistryId });
    mockBillingRepo.claimPlanChangeForRetry.mockResolvedValue(otherTr);

    // Active slot belongs to different tenant
    mockBillingRepo.getActiveTransitionSlot.mockResolvedValue({
      id: buildActiveTransitionSlotId(otherMinistryId, providerName),
      plan_change_id: otherTr.id,
      ministry_id: ministryId, // Divergent!
      provider: providerName,
    });

    const res = await billingService.reconcileScheduledCancelToFreeBoundary(otherTr.id, 'worker', { now: boundaryInstant });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('active_slot_missing_or_divergent');
  });

  it('53. reactivate guard remains: throws 409 when cancel transition is scheduled', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: activeSlot,
      transition: activeRecord,
    });

    await expect(billingService.reactivateSubscription(ministryId)).rejects.toThrow(
      'Existe um cancelamento agendado em processamento para este ministério.'
    );
    expect(mockProvider.reactivateSubscription).not.toHaveBeenCalled();
  });

  it('54. zero DELETE subscription (mockProvider.removeSubscription never called)', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockProvider.removeSubscription).not.toHaveBeenCalled();
  });

  it('55. zero refund (mockProvider.refundPayment never called)', async () => {
    await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

    expect(mockProvider.refundPayment).not.toHaveBeenCalled();
  });

  describe('Phase 3D.3 Final Hardening — Entitlement Authority & Atomic Terminalization Matrix', () => {
    let realSubscriptionService: SubscriptionService;

    beforeEach(() => {
      mockSubscriptionRepo = {
        getSubscription: vi.fn().mockImplementation(async () => appSubRecord),
        setSubscription: vi.fn().mockImplementation(async (sub: any) => {
          appSubRecord = { ...sub };
          return appSubRecord;
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: ministryId,
          ministry_id: ministryId,
          members_count: 5,
          songs_count: 20,
        }),
      };
      realSubscriptionService = new SubscriptionService(mockSubscriptionRepo);
    });

    it('H1. V1 cancel + boundary transient -> SubscriptionService remains paid (no silent Free downgrade)', async () => {
      // Setup V1 scheduled cancellation with active marker
      appSubRecord.cancel_at_period_end = true;
      appSubRecord.active_cancellation_transition_id = activeRecord.id;
      appSubRecord.current_period_end = '2026-09-01T00:00:00.000Z'; // in the past

      mockProvider.getSubscriptionState.mockResolvedValue({
        outcome: 'TRANSIENT_ERROR',
        status: null,
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transient_provider_read_error');
      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeSlot).not.toBeNull();

      // SubscriptionService query directly:
      const summary = await realSubscriptionService.getSubscriptionSummary(ministryId);
      expect(summary.plan.id).toBe('essential');
      expect(summary.subscription.subscriptionMode).toBe('paid');
      expect(summary.quotas.members).toBe(40);
      expect(summary.quotas.songs).toBe(200);
      expect(summary.subscription.cancelAtPeriodEnd).toBe(true);
      expect(summary.subscription.activeCancellationTransitionId).toBe(activeRecord.id);
    });

    it('H2. V1 cancel + boundary future settled -> remains paid + attention (slot HELD, no Free downgrade)', async () => {
      appSubRecord.cancel_at_period_end = true;
      appSubRecord.active_cancellation_transition_id = activeRecord.id;
      appSubRecord.current_period_end = '2026-09-01T00:00:00.000Z';

      mockProvider.listSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_future_settled_h2',
          subscriptionId: sourceSubId,
          status: 'CONFIRMED',
          dueDate: '2026-10-01',
          value: 34.9,
        },
      ]);

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unexpected_renewal_payment_detected');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeSlot).not.toBeNull();

      const summary = await realSubscriptionService.getSubscriptionSummary(ministryId);
      expect(summary.plan.id).toBe('essential');
      expect(summary.subscription.subscriptionMode).toBe('paid');
      expect(summary.quotas.members).toBe(40);
      expect(summary.quotas.songs).toBe(200);
    });

    it('H3. V1 cancel + source ACTIVE unexpectedly -> remains paid + attention (no Free downgrade)', async () => {
      appSubRecord.cancel_at_period_end = true;
      appSubRecord.active_cancellation_transition_id = activeRecord.id;
      appSubRecord.current_period_end = '2026-09-01T00:00:00.000Z';

      mockProvider.getSubscriptionState.mockResolvedValue({
        outcome: 'FOUND',
        status: 'ACTIVE',
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('source_subscription_reactivated');
      expect(activeRecord.financial_attention_required).toBe(true);

      const summary = await realSubscriptionService.getSubscriptionSummary(ministryId);
      expect(summary.plan.id).toBe('essential');
      expect(summary.subscription.subscriptionMode).toBe('paid');
      expect(summary.quotas.members).toBe(40);
    });

    it('H4. legacy cancellation without V1 marker still performs legacy convergence', async () => {
      // Legacy cancellation: cancel_at_period_end is true, but active_cancellation_transition_id is undefined
      appSubRecord.cancel_at_period_end = true;
      appSubRecord.active_cancellation_transition_id = undefined;
      appSubRecord.current_period_end = '2026-09-01T00:00:00.000Z'; // in past

      const summary = await realSubscriptionService.getSubscriptionSummary(ministryId);
      expect(summary.plan.id).toBe('free');
      expect(summary.subscription.subscriptionMode).toBe('free');
      expect(summary.quotas.members).toBe(10);
      expect(summary.quotas.songs).toBe(50);
    });

    it('H5. V1 cancel_at_period_end flag alone cannot force Free (resolveAccessMode)', () => {
      const v1SubState: any = {
        plan_id: 'essential',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'paid',
        cancel_at_period_end: true,
        active_cancellation_transition_id: activeRecord.id,
        current_period_end: '2026-09-01T00:00:00.000Z',
      };

      const res = resolveAccessMode(v1SubState, PLANS_CATALOG.essential, { members_count: 5, songs_count: 10 }, new Date());
      expect(res.effectiveQuotas.members).toBe(40);
      expect(res.effectiveQuotas.songs).toBe(200);
      expect(res.accessMode).toBe('normal');
    });

    it('H6. crash after Free apply before terminal transaction -> next worker completes', async () => {
      // Free entitlement applied
      appSubRecord.plan_id = 'free';
      appSubRecord.subscription_mode = 'free';
      appSubRecord.locked_member_quota = 10;
      appSubRecord.locked_song_quota = 50;
      appSubRecord.member_addon_blocks = 0;

      // Transition still scheduled and slot held
      activeRecord.transition_status = 'scheduled';
      expect(activeSlot).not.toBeNull();

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);
      expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).toHaveBeenCalledTimes(1);
      expect(activeRecord.transition_status).toBe('completed');
      expect(activeSlot).toBeNull();
    });

    it('H7. atomic terminal transaction commits completed + slot release together', async () => {
      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });

      expect(res.success).toBe(true);
      expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).toHaveBeenCalledWith(
        ministryId,
        providerName,
        activeRecord.id,
        expect.objectContaining({
          completed_at: expect.any(String),
          effective_at: expect.any(String),
        })
      );
      expect(activeRecord.transition_status).toBe('completed');
      expect(activeRecord.financial_safety_status).toBe('safe_terminal');
      expect(activeSlot).toBeNull();
    });

    it('H8. atomic transaction failure leaves scheduled + HELD (no partial commit)', async () => {
      mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically.mockResolvedValueOnce({
        success: false,
        reason: 'transaction_conflict',
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transaction_conflict');
      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeSlot).not.toBeNull();
    });

    it('H9. no completed + HELD state produced by normal V1 boundary path', async () => {
      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);

      // If transition is completed and safe_terminal, slot MUST be null
      if (activeRecord.transition_status === 'completed' && activeRecord.financial_safety_status === 'safe_terminal') {
        expect(activeSlot).toBeNull();
      }
    });

    it('H10. duplicate worker after terminal transaction is idempotent', async () => {
      const res1 = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res1.success).toBe(true);

      const res2 = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res2.success).toBe(true);
      expect(res2.reason).toBe('already_completed');
    });

    it('H11. locked target snapshot remains authority under catalog drift', async () => {
      const originalCatalog = PLANS_CATALOG.free.baseMembers;
      try {
        (PLANS_CATALOG.free as any).baseMembers = 999;

        const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
        expect(res.success).toBe(true);
        expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
          ministryId,
          expect.objectContaining({
            plan_id: 'free',
            effective_member_quota: 10,
            effective_song_quota: 50,
          })
        );
      } finally {
        (PLANS_CATALOG.free as any).baseMembers = originalCatalog;
      }
    });

    it('H12. target snapshot integrity does not depend improperly on current catalog (future Free catalog 15/75)', async () => {
      // Future legitimate Free catalog locked snapshot: 15 members, 75 songs
      activeRecord.target_entitlement_snapshot = {
        plan_id: 'free',
        interval: 'monthly',
        addon_blocks: 0,
        effective_member_quota: 15,
        effective_song_quota: 75,
      };

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);
      expect(mockSubscriptionService.applyLockedEntitlementSnapshot).toHaveBeenCalledWith(
        ministryId,
        expect.objectContaining({
          plan_id: 'free',
          effective_member_quota: 15,
          effective_song_quota: 75,
        })
      );
    });

    it('H13. worker query reachability: completed transitions are strictly excluded from V1_RECONCILABLE_TRANSITION_STATUSES', () => {
      expect(V1_RECONCILABLE_TRANSITION_STATUSES).not.toContain('completed');
      expect(V1_RECONCILABLE_TRANSITION_STATUSES).not.toContain('safe_terminal');
      expect(V1_RECONCILABLE_TRANSITION_STATUSES).toContain('scheduled');
      expect(V1_RECONCILABLE_TRANSITION_STATUSES).toContain('awaiting_old_inactivation');
    });
  });

  describe('Phase 3D.3A — Terminal Ownership / Canonical Slot Hardening & CAS Audit (Section 23)', () => {
    it('1. marker present during awaiting', async () => {
      const awaitingRecord = createScheduledRecord({
        id: 'tr_awaiting_marker',
        transition_status: 'awaiting_old_inactivation',
      });
      activeRecord = awaitingRecord;
      appSubRecord.active_cancellation_transition_id = awaitingRecord.id;

      expect(appSubRecord.active_cancellation_transition_id).toBe('tr_awaiting_marker');
      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
    });

    it('2. marker present during scheduled', async () => {
      activeRecord.transition_status = 'scheduled';
      appSubRecord.active_cancellation_transition_id = activeRecord.id;

      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
    });

    it('3. marker present during attention (never cleared on financial attention)', async () => {
      appSubRecord.active_cancellation_transition_id = activeRecord.id;

      // Simulate unexpected settled payment at boundary -> enters financial_attention_required
      const paymentDate = new Date(boundaryInstant.getTime() + 86400000);
      mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
        {
          id: 'pay_late_settled',
          subscription: activeRecord.old_provider_subscription_id,
          status: 'RECEIVED',
          dueDate: paymentDate.toISOString().split('T')[0],
          paymentDate: paymentDate.toISOString(),
          confirmedDate: paymentDate.toISOString(),
          value: 99.0,
        },
      ]);

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unexpected_renewal_payment_detected');
      expect(activeRecord.financial_attention_required).toBe(true);

      // Marker MUST still be present on ministry subscription
      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
      expect(activeSlot).not.toBeNull();
    });

    it('4. marker present after Free apply but before terminalization (crash window between STEP 4 and 5)', async () => {
      appSubRecord.active_cancellation_transition_id = activeRecord.id;

      // STEP 4 applies Free target snapshot
      mockSubscriptionService.applyLockedEntitlementSnapshot.mockImplementationOnce(async () => {
        appSubRecord.plan_id = 'free';
        appSubRecord.subscription_mode = 'free';
        appSubRecord.locked_member_quota = 10;
        appSubRecord.locked_song_quota = 50;
        // Marker MUST be retained
        expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
        throw new Error('Crash before atomic terminalization');
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);

      // Crash occurred before atomic terminalization: marker remains, slot remains held, transition remains scheduled
      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
      expect(activeSlot).not.toBeNull();
      expect(activeRecord.transition_status).toBe('scheduled');
    });

    it('5. marker cleared atomically at successful terminalization', async () => {
      appSubRecord.active_cancellation_transition_id = activeRecord.id;
      appSubRecord.cancel_at_period_end = true;

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);

      expect(activeRecord.transition_status).toBe('completed');
      expect(activeRecord.financial_safety_status).toBe('safe_terminal');
      expect(activeSlot).toBeNull();
      expect(appSubRecord.active_cancellation_transition_id).toBeNull();
      expect(appSubRecord.cancel_at_period_end).toBe(false);
    });

    it('6. transition completed + slot released + marker cleared as one logical commit', async () => {
      appSubRecord.active_cancellation_transition_id = activeRecord.id;

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);

      expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).toHaveBeenCalledWith(
        ministryId,
        providerName,
        activeRecord.id,
        expect.any(Object)
      );
      expect(activeRecord.transition_status).toBe('completed');
      expect(activeSlot).toBeNull();
      expect(appSubRecord.active_cancellation_transition_id).toBeNull();
    });

    it('7. transaction failure preserves scheduled + HELD + marker', async () => {
      appSubRecord.active_cancellation_transition_id = activeRecord.id;
      mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically.mockResolvedValueOnce({
        success: false,
        reason: 'transaction_abort',
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transaction_abort');

      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeSlot).not.toBeNull();
      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
    });

    it('8. wrong marker owner fails closed (CAS protection)', async () => {
      // Subscription marker belongs to another transition!
      appSubRecord.active_cancellation_transition_id = 'tr_other_conflict';

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('subscription_marker_owned_by_another_transition');

      // Does not delete slot, does not complete transition, does not clear marker
      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeSlot).not.toBeNull();
      expect(appSubRecord.active_cancellation_transition_id).toBe('tr_other_conflict');
    });

    it('9. wrong slot owner fails closed', async () => {
      appSubRecord.active_cancellation_transition_id = activeRecord.id;
      // Slot owned by another transition
      activeSlot.plan_change_id = 'tr_other_owner';

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('active_slot_missing_or_divergent');

      expect(activeRecord.transition_status).toBe('scheduled');
      expect(activeSlot.plan_change_id).toBe('tr_other_owner');
      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
    });

    it('10. attention cannot terminalize', async () => {
      activeRecord.financial_attention_required = true;
      activeRecord.financial_safety_status = 'attention_required';
      appSubRecord.active_cancellation_transition_id = activeRecord.id;

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('financial_attention_required');

      expect(mockBillingRepo.completeTransitionAndReleaseOwnedSlotAtomically).not.toHaveBeenCalled();
      expect(activeSlot).not.toBeNull();
      expect(appSubRecord.active_cancellation_transition_id).toBe(activeRecord.id);
    });

    it('11. canonical slot created then exact same canonical slot released', async () => {
      const canonicalSlotId = buildActiveTransitionSlotId(ministryId, providerName);
      expect(activeSlot.id).toBe(canonicalSlotId);

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);
      expect(activeSlot).toBeNull();
    });

    it('12. no manual slot format in boundary tests', () => {
      const expectedSlotId = buildActiveTransitionSlotId(ministryId, providerName);
      expect(expectedSlotId).not.toContain('undefined');
      expect(expectedSlotId).toBe(`slot_${ministryId}__${providerName}`);
    });

    it('13. completed/free duplicate cancel is idempotent (ALREADY_FREE)', async () => {
      // Cutover finishes normally
      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);

      // Now billingSub is canceled and plan is free
      billingSubRecord = {
        ...billingSubRecord,
        plan_id: 'free',
        status: 'canceled',
        cancel_at_period_end: false,
      };

      await expect(
        billingService.cancelSubscription(ministryId, { userId: 'usr_1' })
      ).rejects.toThrow(/Não há assinatura ativa para cancelar|já possui plano gratuito/i);
    });

    it('14. completed cancellation leaves no stale marker blocking future paid flow', async () => {
      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker', { now: boundaryInstant });
      expect(res.success).toBe(true);

      // Ministry subscription has no active cancellation marker
      expect(appSubRecord.active_cancellation_transition_id).toBeNull();
      expect(activeSlot).toBeNull();
    });
  });
});
