import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import {
  BillingTransitionV1Record,
  buildActiveTransitionSlotId,
  mapTransitionToScheduledCancelResponseDto,
} from './billing.types';
import {
  classifyTransition,
  buildTransitionCommercialSnapshot,
  buildBillingTransitionV1Record,
} from './billing-transition-domain.service';
import { PLANS_CATALOG } from '../../config/plans.config';
import { AppError } from '../../middleware/error-handler';
import { config } from '../../config/unifiedConfig';

describe('Phase 3D.1 — Scheduled Cancel-to-Free V1 Domain, Persistence & Internal Preparation', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;
  let mockProvider: any;

  const ministryId = 'min-test-cancel-3d1';
  const providerName = 'asaas';

  beforeEach(() => {
    (config as any).billingTimezone = 'America/Sao_Paulo';

    mockProvider = {
      name: providerName,
      inactivateSubscription: vi.fn(),
      reactivateSubscription: vi.fn(),
      removePayment: vi.fn(),
      createCheckout: vi.fn(),
      listSubscriptionPayments: vi.fn(),
    };

    mockBillingRepo = {
      getSubscription: vi.fn(),
      setSubscription: vi.fn(),
      getCustomer: vi.fn(),
      getActiveTransitionSlot: vi.fn(),
      getActiveTransitionForMinistry: vi.fn(),
      createTransitionAndClaimSlot: vi.fn(),
      releaseSlotIfOwnedAndSafe: vi.fn(),
    };

    mockSubscriptionService = {
      getSubscriptionSummary: vi.fn(),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn(),
      setSubscription: vi.fn(),
    };

    mockMinistryRepo = {
      findById: vi.fn(),
    };

    mockUserRepo = {
      findById: vi.fn(),
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

  // --------------------------------------------------------------------------
  // 1 & 2 & 3. Domain Classification & Execution Strategy
  // --------------------------------------------------------------------------
  it('1. Paid Lite -> Free is classified as downgrade with strategy scheduled_cancel_to_free', () => {
    const classification = classifyTransition(
      { plan_id: 'lite', interval: 'monthly', addon_blocks: 0 },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 }
    );
    expect(classification.transition_type).toBe('downgrade');
    expect(classification.execution_strategy).toBe('scheduled_cancel_to_free');
    expect(classification.early_activation_eligible).toBe(false);
  });

  it('2. Paid Essential -> Free is classified as downgrade with strategy scheduled_cancel_to_free', () => {
    const classification = classifyTransition(
      { plan_id: 'essential', interval: 'monthly', addon_blocks: 2 },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 }
    );
    expect(classification.transition_type).toBe('downgrade');
    expect(classification.execution_strategy).toBe('scheduled_cancel_to_free');
    expect(classification.early_activation_eligible).toBe(false);
  });

  it('3. execution_strategy is scheduled_cancel_to_free in commercial snapshot', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'pro',
        interval: 'monthly',
        addon_blocks: 0,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z', timeZone: 'America/Sao_Paulo' }
    );
    expect(snapshot.execution_strategy).toBe('scheduled_cancel_to_free');
  });

  // --------------------------------------------------------------------------
  // 4 & 5 & 6. Initial Statuses & Early Activation Not Applicable
  // --------------------------------------------------------------------------
  it('4. Initial transition_status is strictly awaiting_old_inactivation (Do-not-renew safety not yet proven)', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'essential',
        interval: 'monthly',
        addon_blocks: 0,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z' }
    );
    const record = buildBillingTransitionV1Record({
      transitionId: 'tr_test_1',
      ministryId,
      provider: 'asaas',
      commercialSnapshot: snapshot,
    });
    expect(record.transition_status).toBe('awaiting_old_inactivation');
  });

  it('5. Initial financial_safety_status is live', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'essential',
        interval: 'monthly',
        addon_blocks: 0,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z' }
    );
    const record = buildBillingTransitionV1Record({
      transitionId: 'tr_test_2',
      ministryId,
      provider: 'asaas',
      commercialSnapshot: snapshot,
    });
    expect(record.financial_safety_status).toBe('live');
  });

  it('6. early_activation_status is strictly not_applicable with zero quote', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'lite',
        interval: 'monthly',
        addon_blocks: 0,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z' }
    );
    const record = buildBillingTransitionV1Record({
      transitionId: 'tr_test_3',
      ministryId,
      provider: 'asaas',
      commercialSnapshot: snapshot,
    });
    expect(record.early_activation_status).toBe('not_applicable');
    expect(record.early_activation_target_entitlement_snapshot).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 7 & 8 & 9. Free Target Snapshot & Economics & Boundaries
  // --------------------------------------------------------------------------
  it('7. Canonical Free target snapshot locks 10 members, 50 songs, and 0 addon blocks', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'essential',
        interval: 'monthly',
        addon_blocks: 2,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z' }
    );
    expect(snapshot.target_entitlement_snapshot).toEqual({
      plan_id: 'free',
      addon_blocks: 0,
      interval: 'monthly',
      effective_member_quota: 10,
      effective_song_quota: 50,
    });
  });

  it('8. target_future_recurring_price_cents and target_current_cycle_total_cents are strictly 0', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'premium',
        interval: 'annual',
        addon_blocks: 0,
        current_period_start: '2026-01-01T00:00:00.000Z',
        current_period_end: '2027-01-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'annual', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z' }
    );
    expect(snapshot.target_future_recurring_price_cents).toBe(0);
    expect(snapshot.target_current_cycle_total_cents).toBe(0);
  });

  it('9. effective_billing_date and effective_at lock to current_period_end in BILLING_TIMEZONE', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'essential',
        interval: 'monthly',
        addon_blocks: 0,
        current_period_start: '2026-09-15T12:00:00.000Z',
        current_period_end: '2026-10-15T12:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-16T12:00:00.000Z', timeZone: 'America/Sao_Paulo' }
    );
    expect(snapshot.effective_billing_date).toBe('2026-10-15');
    expect(snapshot.effective_at).toBe('2026-10-15T12:00:00.000Z');
  });

  // --------------------------------------------------------------------------
  // 10. Canonical Source Snapshot
  // --------------------------------------------------------------------------
  it('10. Canonical source snapshot is locked with current paid capabilities and cannot drift', () => {
    const snapshot = buildTransitionCommercialSnapshot(
      {
        plan_id: 'essential',
        interval: 'monthly',
        addon_blocks: 3,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      { plan_id: 'free', interval: 'monthly', addon_blocks: 0 },
      { requestedAt: '2026-09-04T12:00:00.000Z' }
    );
    expect(snapshot.source_entitlement_snapshot).toEqual({
      plan_id: 'essential',
      addon_blocks: 3,
      interval: 'monthly',
      effective_member_quota: 70, // 40 base + 3*10
      effective_song_quota: 200,
    });
    expect(snapshot.source_current_cycle_total_cents).toBe(6460); // 3490 + 3*990
  });

  // --------------------------------------------------------------------------
  // 11 & 12. Canonical Active Slot & Helper Usage
  // --------------------------------------------------------------------------
  it('11. Canonical active slot is claimed when preparing cancel-to-free transition', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      member_addon_blocks: 0,
      status: 'active',
      provider_subscription_id: 'sub_prov_123',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });

    let claimedRecord: any = null;
    mockBillingRepo.createTransitionAndClaimSlot.mockImplementation(async (record: any) => {
      claimedRecord = record;
      const expectedSlotId = buildActiveTransitionSlotId(ministryId, 'asaas');
      return {
        planChange: record,
        slot: {
          id: expectedSlotId,
          ministry_id: ministryId,
          provider: 'asaas',
          plan_change_id: record.id,
          acquired_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        },
      };
    });

    const result = await billingService.prepareScheduledCancelToFreeTransition(ministryId, {
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    expect(result).toBeDefined();
    expect(mockBillingRepo.createTransitionAndClaimSlot).toHaveBeenCalledTimes(1);
    expect(claimedRecord.execution_strategy).toBe('scheduled_cancel_to_free');
    expect(claimedRecord.transition_status).toBe('awaiting_old_inactivation');
  });

  it('12. Canonical buildActiveTransitionSlotId helper is the single slot identity authority', () => {
    const slotId = buildActiveTransitionSlotId(ministryId, providerName);
    expect(slotId).toBeDefined();
    expect(typeof slotId).toBe('string');
    expect(slotId).toBe(buildActiveTransitionSlotId(ministryId, providerName));
    expect(slotId.startsWith('slot_')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 13. Idempotent Duplicate Request
  // --------------------------------------------------------------------------
  it('13. Duplicate cancel request returns the existing transition without creating a duplicate slot', async () => {
    const existingTransition: Partial<BillingTransitionV1Record> = {
      id: 'tr_cancel_existing_123',
      transition_id: 'tr_cancel_existing_123',
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: 'asaas',
      execution_strategy: 'scheduled_cancel_to_free',
      transition_status: 'awaiting_old_inactivation',
      financial_safety_status: 'live',
      target_plan_id: 'free',
      effective_billing_date: '2026-10-01',
      current_period_end: '2026-10-01T00:00:00.000Z',
    };

    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: existingTransition.id },
      transition: existingTransition,
    });

    const result = await billingService.prepareScheduledCancelToFreeTransition(ministryId);

    expect(result.id).toBe('tr_cancel_existing_123');
    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 14. Concurrent Request Handling (CAS-safety)
  // --------------------------------------------------------------------------
  it('14. Two simultaneous requests create at most one transition (concurrency CAS-safe)', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValueOnce(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'lite',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_prov_concur',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });

    const winningTransition = {
      id: 'tr_cancel_winner',
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: 'asaas',
      execution_strategy: 'scheduled_cancel_to_free',
      transition_status: 'awaiting_old_inactivation',
      financial_safety_status: 'live',
    };

    mockBillingRepo.createTransitionAndClaimSlot.mockRejectedValueOnce(
      new AppError(409, 'Já existe uma transição ativa', { code: 'ACTIVE_TRANSITION_EXISTS' })
    );

    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValueOnce({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: 'tr_cancel_winner' },
      transition: winningTransition,
    });

    const result = await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(result.id).toBe('tr_cancel_winner');
  });

  // --------------------------------------------------------------------------
  // 15 & 16. Other Active Transitions Conflict
  // --------------------------------------------------------------------------
  it('15. Active paid-to-paid transition blocks cancellation with ACTIVE_TRANSITION_EXISTS', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: 'tr_p2p_active' },
      transition: {
        id: 'tr_p2p_active',
        policy_version: 'billing_transition_v1',
        ministry_id: ministryId,
        provider: 'asaas',
        execution_strategy: 'scheduled_paid_transition',
        transition_status: 'scheduled',
      },
    });

    await expect(billingService.prepareScheduledCancelToFreeTransition(ministryId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 409,
        details: expect.objectContaining({ code: 'ACTIVE_TRANSITION_EXISTS' }),
      })
    );
  });

  it('16. Active initial-purchase transition blocks cancellation with ACTIVE_TRANSITION_EXISTS', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: 'tr_init_active' },
      transition: {
        id: 'tr_init_active',
        policy_version: 'billing_transition_v1',
        ministry_id: ministryId,
        provider: 'asaas',
        execution_strategy: 'immediate_initial_purchase',
        transition_status: 'pending_initial_purchase',
      },
    });

    await expect(billingService.prepareScheduledCancelToFreeTransition(ministryId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 409,
        details: expect.objectContaining({ code: 'ACTIVE_TRANSITION_EXISTS' }),
      })
    );
  });

  // --------------------------------------------------------------------------
  // 17, 18, 19, 20. Entitlement Preservation Invariants
  // --------------------------------------------------------------------------
  it('17. Entitlement plan remains unchanged in subscription at request preparation', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      member_addon_blocks: 2,
      status: 'active',
      provider_subscription_id: 'sub_prov_preserve',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId, {
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    expect(mockSubscriptionRepo.setSubscription).not.toHaveBeenCalled();
    expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
  });

  it('18. Paid quotas remain unchanged before commercial boundary', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      member_addon_blocks: 2,
      status: 'active',
      provider_subscription_id: 'sub_prov_preserve_quotas',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(mockSubscriptionRepo.setSubscription).not.toHaveBeenCalled();
  });

  it('19. Addon blocks remain unchanged before commercial boundary', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      member_addon_blocks: 4,
      status: 'active',
      provider_subscription_id: 'sub_prov_preserve_addons',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
  });

  it('20. current_period_end remains unchanged at request preparation', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'pro',
      interval: 'monthly',
      member_addon_blocks: 0,
      status: 'active',
      provider_subscription_id: 'sub_prov_preserve_period',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 21, 22, 23. Zero External / Side-Effect Operations
  // --------------------------------------------------------------------------
  it('21. No provider inactivateSubscription call in preparation phase', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'lite',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_prov_no_inactivation',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
  });

  it('22. No payment cleanup call in preparation phase', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'lite',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_prov_no_cleanup',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
  });

  it('23. No checkout or payment creation in preparation phase', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'lite',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_prov_no_checkout',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_1' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(mockProvider.createCheckout).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 24. Terminal Attention Rule
  // --------------------------------------------------------------------------
  it('24. financial_attention_required transition keeps slot HELD and cannot be released', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: 'tr_attention' },
      transition: {
        id: 'tr_attention',
        policy_version: 'billing_transition_v1',
        ministry_id: ministryId,
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_status: 'financial_attention_required',
        financial_safety_status: 'attention_required',
      },
    });

    const res = await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(res.id).toBe('tr_attention');
    expect(res.transition_status).toBe('financial_attention_required');
    expect(mockBillingRepo.releaseSlotIfOwnedAndSafe).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 25 & 26. Legacy Reactivate Hazard Guard
  // --------------------------------------------------------------------------
  it('25. Legacy reactivateSubscription with active V1 cancellation throws 409 ACTIVE_CANCELLATION_TRANSITION_EXISTS', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: 'tr_cancel_active' },
      transition: {
        id: 'tr_cancel_active',
        policy_version: 'billing_transition_v1',
        ministry_id: ministryId,
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_status: 'awaiting_old_inactivation',
        financial_safety_status: 'live',
      },
    });

    await expect(billingService.reactivateSubscription(ministryId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 409,
        details: expect.objectContaining({
          code: 'ACTIVE_CANCELLATION_TRANSITION_EXISTS',
          transitionId: 'tr_cancel_active',
        }),
      })
    );
  });

  it('26. Legacy reactivate conflict makes ZERO provider reactivateSubscription mutation', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, 'asaas'), plan_change_id: 'tr_cancel_active' },
      transition: {
        id: 'tr_cancel_active',
        policy_version: 'billing_transition_v1',
        ministry_id: ministryId,
        provider: 'asaas',
        execution_strategy: 'scheduled_cancel_to_free',
        transition_status: 'awaiting_old_inactivation',
        financial_safety_status: 'live',
      },
    });

    try {
      await billingService.reactivateSubscription(ministryId);
    } catch {
      // expected conflict
    }

    expect(mockProvider.reactivateSubscription).not.toHaveBeenCalled();
    expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 27 & 28. Tenant Isolation & RBAC Invariants
  // --------------------------------------------------------------------------
  it('27. member role is denied access on public cancel endpoint via requireMinistryRole admin middleware (403)', async () => {
    const { requireMinistryRole } = await import('../../middleware/rbac');
    const { MinistryRepository } = await import('../../repositories/MinistryRepository');

    vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValueOnce({
      id: ministryId,
      role: 'member',
    } as any);

    const mockReq: any = {
      params: { ministryId },
      user: { id: 'usr_member_123', uid: 'usr_member_123', email: 'member@test.com' },
    };
    const mockRes: any = {};
    const mockNext = vi.fn();

    const rbacMiddleware = requireMinistryRole('admin');
    await rbacMiddleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
  });

  it('28A. Cross-tenant HTTP authorization denied: user belonging only to Ministry A attempting to access Ministry B is rejected by requireMinistryRole with 403, and zero mutations occur for Ministry B', async () => {
    const { requireMinistryRole } = await import('../../middleware/rbac');
    const { MinistryRepository } = await import('../../repositories/MinistryRepository');

    const targetMinistryB = 'min-tenant-target-b';
    const userFromA = 'usr_tenant_a_admin';

    // O usuário admin do ministério A não possui perfil admin no ministério B
    vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValueOnce({
      id: targetMinistryB,
      role: 'member', // No tenant B ele é apenas member (ou sem permissão admin)
    } as any);

    const mockReq: any = {
      params: { ministryId: targetMinistryB },
      user: { id: userFromA, uid: userFromA, email: 'admin_a@test.com' },
    };
    const mockRes: any = {};
    const mockNext = vi.fn();

    const rbacMiddleware = requireMinistryRole('admin');
    await rbacMiddleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    expect(mockNext.mock.calls[0][0].statusCode).toBe(403);

    // CRÍTICO: Zero mutação em BillingRepository ou Provedor para o ministério B
    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
    expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
  });

  it('28B. Tenant persistence isolation: internal prepareScheduledCancelToFreeTransition strictly scopes and binds transition and claimed slot to target ministryId', async () => {
    const tenantA = 'min-tenant-aaa';
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${tenantA}_asaas`,
      ministry_id: tenantA,
      plan_id: 'lite',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_prov_tenant_a',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    });

    let savedRecord: any;
    mockBillingRepo.createTransitionAndClaimSlot.mockImplementation(async (record: any) => {
      savedRecord = record;
      return { planChange: record, slot: { id: buildActiveTransitionSlotId(tenantA, providerName) } };
    });

    const res = await billingService.prepareScheduledCancelToFreeTransition(tenantA);
    expect(res.ministry_id).toBe(tenantA);
    expect(savedRecord.ministry_id).toBe(tenantA);
    expect(mockBillingRepo.createTransitionAndClaimSlot).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // 29. Already Free Behavior
  // --------------------------------------------------------------------------
  it('29. Already Free ministry does not create transition and rejects with ALREADY_FREE', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'free',
      interval: 'monthly',
      status: 'active',
    });

    await expect(billingService.prepareScheduledCancelToFreeTransition(ministryId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 400,
        details: expect.objectContaining({ code: 'ALREADY_FREE' }),
      })
    );
    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 30. Invalid or Expired Paid Period Guard
  // --------------------------------------------------------------------------
  it('30. Missing paid period is rejected with INVALID_SOURCE_PERIOD', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_123',
      current_period_start: null,
      current_period_end: null,
    });

    await expect(billingService.prepareScheduledCancelToFreeTransition(ministryId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 400,
        details: expect.objectContaining({ code: 'INVALID_SOURCE_PERIOD' }),
      })
    );
  });

  // --------------------------------------------------------------------------
  // 31A, 31B, 31C, 31D. Deterministic Boundary Matrix [start, end)
  // --------------------------------------------------------------------------
  it('31A. now = current_period_end - 1ms allows cancel preparation to proceed (within [start, end) period)', async () => {
    const periodStart = '2026-09-15T12:00:00.000Z';
    const periodEnd = '2026-10-15T12:00:00.000Z';
    const endMs = new Date(periodEnd).getTime();
    const nowBefore = new Date(endMs - 1); // 1ms antes do boundary instant

    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_boundary_test',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });
    mockBillingRepo.createTransitionAndClaimSlot.mockResolvedValue({
      planChange: { id: 'tr_boundary_ok' },
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName) },
    });

    const res = await billingService.prepareScheduledCancelToFreeTransition(ministryId, {
      now: nowBefore,
    });

    expect(res).toBeDefined();
    expect(mockBillingRepo.createTransitionAndClaimSlot).toHaveBeenCalledTimes(1);
    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
  });

  it('31B. now = current_period_end exactly is rejected with PAID_PERIOD_EXPIRED (zero transition, zero slot claimed)', async () => {
    const periodStart = '2026-09-15T12:00:00.000Z';
    const periodEnd = '2026-10-15T12:00:00.000Z';
    const nowExact = new Date(periodEnd); // exatamente no boundary instant

    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_boundary_test',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });

    await expect(
      billingService.prepareScheduledCancelToFreeTransition(ministryId, {
        now: nowExact,
      })
    ).rejects.toThrow(
      expect.objectContaining({
        statusCode: 400,
        details: expect.objectContaining({ code: 'PAID_PERIOD_EXPIRED' }),
      })
    );

    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
  });

  it('31C. now = current_period_end + 1ms is rejected with PAID_PERIOD_EXPIRED (zero transition, zero slot claimed)', async () => {
    const periodStart = '2026-09-15T12:00:00.000Z';
    const periodEnd = '2026-10-15T12:00:00.000Z';
    const endMs = new Date(periodEnd).getTime();
    const nowAfter = new Date(endMs + 1); // 1ms depois do boundary instant

    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_boundary_test',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });

    await expect(
      billingService.prepareScheduledCancelToFreeTransition(ministryId, {
        now: nowAfter,
      })
    ).rejects.toThrow(
      expect.objectContaining({
        statusCode: 400,
        details: expect.objectContaining({ code: 'PAID_PERIOD_EXPIRED' }),
      })
    );

    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
  });

  it('31D. zero provider mutations and zero repository changes on expired boundary requests (B and C)', async () => {
    const periodStart = '2026-09-15T12:00:00.000Z';
    const periodEnd = '2026-10-15T12:00:00.000Z';
    const nowExact = new Date(periodEnd);

    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
    mockBillingRepo.getSubscription.mockResolvedValue({
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      plan_id: 'essential',
      interval: 'monthly',
      status: 'active',
      provider_subscription_id: 'sub_boundary_test',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });

    try {
      await billingService.prepareScheduledCancelToFreeTransition(ministryId, { now: nowExact });
    } catch {
      // expected rejection
    }

    expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
    expect(mockProvider.reactivateSubscription).not.toHaveBeenCalled();
    expect(mockProvider.removePayment).not.toHaveBeenCalled();
    expect(mockProvider.createCheckout).not.toHaveBeenCalled();
    expect(mockBillingRepo.createTransitionAndClaimSlot).not.toHaveBeenCalled();
    expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
    expect(mockSubscriptionRepo.setSubscription).not.toHaveBeenCalled();
  });

  it('32. Empty or whitespace ministryId is rejected with AppError', async () => {
    await expect(billingService.prepareScheduledCancelToFreeTransition('')).rejects.toThrow(AppError);
    await expect(billingService.prepareScheduledCancelToFreeTransition('   ')).rejects.toThrow(AppError);
  });

  it('33. mapTransitionToScheduledCancelResponseDto formats clean response without secrets', () => {
    const record: BillingTransitionV1Record = {
      id: 'tr_cancel_dto_test',
      transition_id: 'tr_cancel_dto_test',
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: 'asaas',
      currency: 'BRL',
      execution_strategy: 'scheduled_cancel_to_free',
      transition_status: 'awaiting_old_inactivation',
      financial_safety_status: 'live',
      early_activation_status: 'not_applicable',
      transition_type: 'downgrade',
      status: 'pending',
      checkout_intent_id: 'intent_123',
      provider_checkout_id: null,
      new_provider_subscription_id: null,
      provider_customer_id: 'cus_hidden_secret',
      old_provider_subscription_id: 'sub_hidden_secret',
      previous_provider_subscription_id: 'sub_hidden_secret',
      requested_plan_id: 'free',
      requested_interval: 'monthly',
      requested_addon_blocks: 0,
      expected_amount_cents: 0,
      source_plan_id: 'essential',
      source_interval: 'monthly',
      source_addon_blocks: 1,
      source_current_cycle_total_cents: 4480,
      source_entitlement_snapshot: {
        plan_id: 'essential',
        addon_blocks: 1,
        interval: 'monthly',
        effective_member_quota: 50,
        effective_song_quota: 200,
      },
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
      current_period_start_billing_date: '2026-09-01',
      current_period_end_billing_date: '2026-10-01',
      requested_commercial_date: '2026-09-04',
      target_plan_id: 'free',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      target_future_recurring_price_cents: 0,
      target_entitlement_snapshot: {
        plan_id: 'free',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 10,
        effective_song_quota: 50,
      },
      early_activation_target_entitlement_snapshot: null,
      effective_at: '2026-10-01T00:00:00.000Z',
      effective_billing_date: '2026-10-01',
      price_locked_at: '2026-09-04T12:00:00.000Z',
      requested_at: '2026-09-04T12:00:00.000Z',
      last_reconciled_at: null,
      created_at: '2026-09-04T12:00:00.000Z',
      updated_at: '2026-09-04T12:00:00.000Z',
      expires_at: null,
      requested_by_user_id: 'usr_123',
    };

    const dto = mapTransitionToScheduledCancelResponseDto(record);
    expect(dto).toEqual({
      transitionId: 'tr_cancel_dto_test',
      executionStrategy: 'scheduled_cancel_to_free',
      transitionStatus: 'awaiting_old_inactivation',
      financialSafetyStatus: 'live',
      sourcePlanId: 'essential',
      targetPlanId: 'free',
      effectiveBillingDate: '2026-10-01',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      entitlementPreserved: true,
      message: 'Cancelamento agendado para o final do período vigente.',
    });

    expect((dto as any).providerCustomerId).toBeUndefined();
    expect((dto as any).oldProviderSubscriptionId).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 34. Terminal Transition Invariant (Section 14)
  // --------------------------------------------------------------------------
  it('34. Active slot pointing to a terminal transition (completed, canceled, failed, superseded) rejects with ACTIVE_TRANSITION_EXISTS rather than treating as active cancellation', async () => {
    const terminalStatuses = ['completed', 'canceled', 'failed', 'superseded'] as const;

    for (const terminalStatus of terminalStatuses) {
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValueOnce({
        slot: { id: buildActiveTransitionSlotId(ministryId, providerName), plan_change_id: `tr_${terminalStatus}` },
        transition: {
          id: `tr_${terminalStatus}`,
          policy_version: 'billing_transition_v1',
          ministry_id: ministryId,
          provider: providerName,
          execution_strategy: 'scheduled_cancel_to_free',
          transition_status: terminalStatus,
          financial_safety_status: 'live',
        },
      });

      await expect(
        billingService.prepareScheduledCancelToFreeTransition(ministryId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ACTIVE_TRANSITION_EXISTS' }),
        })
      );
    }
  });

  // --------------------------------------------------------------------------
  // 35. Attention Safety Status Invariant (Section 13)
  // --------------------------------------------------------------------------
  it('35. financial_attention_required transition keeps financial_safety_status attention_required and slot HELD without release', async () => {
    mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
      slot: { id: buildActiveTransitionSlotId(ministryId, providerName), plan_change_id: 'tr_attention_spec' },
      transition: {
        id: 'tr_attention_spec',
        policy_version: 'billing_transition_v1',
        ministry_id: ministryId,
        provider: providerName,
        execution_strategy: 'scheduled_cancel_to_free',
        transition_status: 'financial_attention_required',
        financial_safety_status: 'attention_required',
      },
    });

    const res = await billingService.prepareScheduledCancelToFreeTransition(ministryId);
    expect(res.id).toBe('tr_attention_spec');
    expect(res.transition_status).toBe('financial_attention_required');
    expect(res.financial_safety_status).toBe('attention_required');
    expect(mockBillingRepo.releaseSlotIfOwnedAndSafe).not.toHaveBeenCalled();
  });
});
