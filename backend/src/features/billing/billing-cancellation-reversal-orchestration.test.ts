import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingReconcilerWorker } from './billing-reconciler.worker';
import {
  BillingTransitionV1Record,
  buildActiveTransitionSlotId,
  CANCEL_TO_FREE_ATTENTION_REASONS,
  CANCELLATION_REVERSAL_ATTENTION_REASONS,
} from './billing.types';
import { ProviderPaymentRecord } from './providers/billing-provider.interface';
import { config } from '../../config/unifiedConfig';

describe('Phase 4A.4.2 — V1 Cancellation Reversal Provider Orchestration', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockUserRepo: any;
  let mockProvider: any;

  const ministryId = 'min-reversal-4a42';
  const providerName = 'asaas';
  const sourceSubId = 'sub_source_4a42';
  const effectiveBillingDate = '2026-10-01';
  const currentPeriodEnd = '2026-10-01T00:00:00.000Z';
  const beforeBoundaryDate = new Date('2026-09-20T12:00:00.000Z');
  const boundaryDate = new Date(currentPeriodEnd);
  const afterBoundaryDate = new Date('2026-10-01T01:00:00.000Z');

  let activeRecord: BillingTransitionV1Record;
  let activeSlot: any;
  let billingSubRecord: any;
  let appSubRecord: any;

  function createScheduledCancelRecord(overrides: Partial<BillingTransitionV1Record> = {}): BillingTransitionV1Record {
    return {
      id: 'tr_rev_spec_1',
      policy_version: 'billing_transition_v1',
      ministry_id: ministryId,
      provider: providerName,
      provider_customer_id: 'cus_rev_1',
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
        effective_member_quota: 40,
        effective_song_quota: 200,
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
        effective_member_quota: 40,
        effective_song_quota: 200,
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

    activeRecord = createScheduledCancelRecord();
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
      provider_customer_id: 'cus_rev_1',
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
      active_cancellation_transition_id: activeRecord.id,
      locked_member_quota: 40,
      locked_song_quota: 200,
      member_addon_blocks: 0,
      updated_at: '2026-09-04T12:00:00.000Z',
    };

    let providerStatus = 'INACTIVE';
    mockProvider = {
      name: providerName,
      getSubscription: vi.fn(),
      getSubscriptionState: vi.fn().mockImplementation(async () => ({
        outcome: 'FOUND',
        status: providerStatus,
        httpStatus: 200,
        rawSubscription: {
          status: providerStatus,
          nextDueDate: effectiveBillingDate,
        },
      })),
      reactivateSubscriptionStrict: vi.fn().mockImplementation(async () => {
        providerStatus = 'ACTIVE';
        return {
          outcome: 'SUCCESS',
          httpStatus: 200,
          status: 'ACTIVE',
          nextDueDate: effectiveBillingDate,
        };
      }),
      inactivateSubscriptionStrict: vi.fn().mockImplementation(async () => {
        providerStatus = 'INACTIVE';
        return {
          outcome: 'SUCCESS',
          httpStatus: 200,
        };
      }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      listAllSubscriptionPaymentsStrict: vi.fn().mockImplementation(async () => {
        const payments = await mockProvider.listSubscriptionPayments();
        return {
          outcome: 'SUCCESS',
          payments,
        };
      }),
      removePayment: vi.fn(),
      refundPayment: vi.fn(),
    };

    mockBillingRepo = {
      getV1TransitionsNeedingReconciliation: vi.fn().mockResolvedValue([]),
      getSubscription: vi.fn().mockImplementation(async () => billingSubRecord),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        billingSubRecord = { ...sub };
        return billingSubRecord;
      }),
      getActiveTransitionSlot: vi.fn().mockImplementation(async () => activeSlot),
      getActiveTransitionForMinistry: vi.fn().mockImplementation(async () => {
        if (!activeSlot) return null;
        return { slot: activeSlot, transition: activeRecord };
      }),
      getTransitionById: vi.fn().mockImplementation(async (id: string) => {
        if (activeRecord && activeRecord.id === id) return activeRecord;
        return null;
      }),
      claimTransitionForReconciliation: vi.fn().mockImplementation(async (id: string, lockOwner: string) => {
        if (!activeRecord || activeRecord.id !== id) return null;
        if (
          activeRecord.retry_locked_until &&
          new Date(activeRecord.retry_locked_until).getTime() > Date.now() &&
          activeRecord.retry_locked_by !== lockOwner
        ) {
          return null;
        }
        activeRecord.retry_locked_by = lockOwner;
        activeRecord.retry_locked_until = new Date(Date.now() + 60000).toISOString();
        return activeRecord;
      }),
      releasePlanChangeLock: vi.fn().mockImplementation(async () => {
        if (activeRecord) {
          activeRecord.retry_locked_by = null;
          activeRecord.retry_locked_until = null;
        }
        return true;
      }),
      updateTransition: vi.fn().mockImplementation(async (id: string, minId: string, updates: any) => {
        activeRecord = { ...activeRecord, ...updates };
        return activeRecord;
      }),
      beginCancellationReversalAtomically: vi.fn().mockImplementation(
        async (minId: string, prov: string, id: string, actor: string, opts: any) => {
          if (!activeRecord || activeRecord.id !== id) return { success: false, reason: 'transition_not_found' };
          if (activeRecord.ministry_id !== minId) return { success: false, reason: 'tenant_mismatch' };
          if (activeRecord.execution_strategy !== 'scheduled_cancel_to_free')
            return { success: false, reason: 'unsupported_transition_strategy' };
          if (activeRecord.financial_attention_required) return { success: false, reason: 'financial_attention_required' };
          if (activeRecord.cancellation_reversal_status === 'completed')
            return { success: false, reason: 'reversal_already_completed' };
          if (activeRecord.cancellation_reversal_status === 'attention_required')
            return { success: false, reason: 'reversal_attention_required' };
          if (activeRecord.cancellation_reversal_status === 'expired')
            return { success: false, reason: 'reversal_already_expired' };
          if (activeRecord.cancellation_reversal_status === 'requested')
            return { success: true, reason: 'reversal_already_requested', transition: activeRecord };

          const boundary = activeRecord.effective_at || activeRecord.current_period_end;
          const nowMs = opts?.nowIso ? new Date(opts.nowIso).getTime() : Date.now();
          if (boundary && nowMs >= new Date(boundary).getTime()) {
            return { success: false, reason: 'boundary_expired' };
          }

          if (!opts?.expectedLockOwner || activeRecord.retry_locked_by !== opts.expectedLockOwner) {
            return { success: false, reason: 'lease_not_owned' };
          }

          activeRecord.cancellation_reversal_status = 'requested';
          activeRecord.cancellation_reversal_requested_at = opts?.nowIso || new Date().toISOString();
          activeRecord.cancellation_reversal_requested_by = actor;
          return { success: true, transition: activeRecord };
        }
      ),
      completeCancellationReversalAndReleaseOwnedSlotAtomically: vi.fn().mockImplementation(
        async (minId: string, prov: string, id: string, opts: any) => {
          if (!activeRecord || activeRecord.id !== id) return { success: false, reason: 'transition_not_found' };
          if (activeRecord.ministry_id !== minId) return { success: false, reason: 'tenant_mismatch' };
          if (activeRecord.cancellation_reversal_status !== 'requested') {
            return { success: false, reason: 'reversal_not_requested' };
          }
          const boundary = activeRecord.effective_at || activeRecord.current_period_end;
          const nowMs = opts?.nowIso ? new Date(opts.nowIso).getTime() : Date.now();
          if (boundary && nowMs >= new Date(boundary).getTime()) {
            return { success: false, reason: 'boundary_expired' };
          }
          if (!opts?.expectedLockOwner || activeRecord.retry_locked_by !== opts.expectedLockOwner) {
            return { success: false, reason: 'lease_not_owned' };
          }

          const completionIso = opts?.nowIso || new Date().toISOString();
          activeRecord.transition_status = 'canceled';
          activeRecord.status = 'canceled';
          activeRecord.financial_safety_status = 'safe_terminal';
          activeRecord.cancellation_reversal_status = 'completed';
          activeRecord.cancellation_reversal_completed_at = completionIso;
          activeRecord.updated_at = completionIso;

          // Atomic release of slot
          activeSlot = null;

          // Clear markers
          if (appSubRecord) {
            appSubRecord.active_cancellation_transition_id = null;
            appSubRecord.cancel_at_period_end = false;
            appSubRecord.updated_at = completionIso;
          }
          if (billingSubRecord) {
            billingSubRecord.cancel_at_period_end = false;
            billingSubRecord.updated_at = completionIso;
          }

          return { success: true };
        }
      ),
      setCancellationReversalAttentionAtomically: vi.fn().mockImplementation(
        async (minId: string, prov: string, id: string, reason: string, opts: any) => {
          if (!activeRecord || activeRecord.id !== id) return { success: false, reason: 'transition_not_found' };
          const nowIso = opts?.nowIso || new Date().toISOString();
          activeRecord.cancellation_reversal_status = 'attention_required';
          activeRecord.cancellation_reversal_attention_reason = reason;
          activeRecord.financial_attention_required = true;
          activeRecord.financial_attention_reason = reason;
          activeRecord.financial_safety_status = 'attention_required';
          activeRecord.updated_at = nowIso;
          return { success: true };
        }
      ),
      completeTransitionAndReleaseOwnedSlotAtomically: vi.fn().mockImplementation(
        async (minId: string, prov: string, id: string, updates: any) => {
          activeRecord = {
            ...activeRecord,
            ...updates,
            transition_status: 'completed',
            financial_safety_status: 'safe_terminal',
          };
          activeSlot = null;
          if (appSubRecord) {
            appSubRecord.active_cancellation_transition_id = null;
            appSubRecord.cancel_at_period_end = false;
          }
          return { success: true };
        }
      ),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async () => appSubRecord),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        appSubRecord = { ...sub };
        return appSubRecord;
      }),
    };

    mockSubscriptionService = {
      getSubscriptionSummary: vi.fn().mockImplementation(async () => ({
        planId: appSubRecord.plan_id,
        status: appSubRecord.status,
        billingStatus: appSubRecord.billing_status,
        cancelAtPeriodEnd: appSubRecord.cancel_at_period_end,
      })),
      applyLockedEntitlementSnapshot: vi.fn().mockImplementation(async (minId: string, snap: any) => {
        appSubRecord.plan_id = snap.plan_id;
        appSubRecord.locked_member_quota = snap.effective_member_quota;
        appSubRecord.locked_song_quota = snap.effective_song_quota;
      }),
    };

    mockMinistryRepo = {};
    mockUserRepo = {};

    billingService = new BillingService(
      mockBillingRepo,
      mockSubscriptionService,
      mockSubscriptionRepo,
      mockMinistryRepo,
      mockProvider,
      mockUserRepo
    );
  });

  describe('1. validateReversalPaymentSafety', () => {
    it('1.1 aceita zero obrigações futuras (Phase 4A.4.0B Sandbox evidence)', () => {
      const res = billingService.validateReversalPaymentSafety([], effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(true);
    });

    it('1.2 aceita exatamente 1 cobrança PENDING com dueDate idêntica à fronteira esperada', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_pending_exact',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(true);
    });

    it('1.3 rejeita 1 cobrança PENDING com dueDate divergente da fronteira', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_pending_wrong_date',
          subscriptionId: sourceSubId,
          dueDate: '2026-10-15',
          status: 'PENDING',
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('pending_payment_wrong_due_date');
        expect(res.attentionReason).toBe(CANCELLATION_REVERSAL_ATTENTION_REASONS.PENDING_PAYMENT_WRONG_DUE_DATE);
      }
    });

    it('1.4 rejeita múltiplas cobranças PENDING (> 1)', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_p1',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
          amountCents: 3490,
        },
        {
          id: 'pay_p2',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: 'PENDING',
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('multiple_pending_payments');
        expect(res.attentionReason).toBe(CANCELLATION_REVERSAL_ATTENTION_REASONS.MULTIPLE_PENDING_PAYMENTS);
      }
    });

    it('1.5 rejeita cobrança liquidada inesperada (CONFIRMED)', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_settled_conf',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: 'CONFIRMED',
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('unexpected_settled_payment');
        expect(res.attentionReason).toBe(CANCELLATION_REVERSAL_ATTENTION_REASONS.UNEXPECTED_SETTLED_PAYMENT);
      }
    });

    it('1.6 rejeita cobrança liquidada inesperada (RECEIVED / RECEIVED_IN_CASH)', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_settled_rec',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: 'RECEIVED',
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('unexpected_settled_payment');
      }
    });

    it('1.7 rejeita cobrança OVERDUE', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_overdue',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: 'OVERDUE',
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('overdue_payment_detected');
        expect(res.attentionReason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.FUTURE_OVERDUE_OBLIGATION_DETECTED);
      }
    });

    it('1.8 rejeita cobrança com status malformado ou nulo', () => {
      const obligations: ProviderPaymentRecord[] = [
        {
          id: 'pay_malformed',
          subscriptionId: sourceSubId,
          dueDate: effectiveBillingDate,
          status: null as any,
          amountCents: 3490,
        },
      ];
      const res = billingService.validateReversalPaymentSafety(obligations, effectiveBillingDate, sourceSubId);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('malformed_provider_payment');
        expect(res.attentionReason).toBe(CANCEL_TO_FREE_ATTENTION_REASONS.MALFORMED_PROVIDER_PAYMENT);
      }
    });
  });

  describe('2. requestScheduledCancellationReversal — Pre-conditions & Guards', () => {
    it('2.1 rejeita actorUserId vazio ou ausente', async () => {
      const res = await billingService.requestScheduledCancellationReversal(ministryId, '   ');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('actor_user_id_required');
    });

    it('2.2 rejeita quando não há slot ativo de cancelamento', async () => {
      activeSlot = null;
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('no_active_cancellation_found');
    });

    it('2.3 rejeita quando a transição referenciada pelo slot não existe', async () => {
      mockBillingRepo.getTransitionById.mockResolvedValueOnce(null);
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('transition_not_found');
    });

    it('2.4 rejeita quando execution_strategy não for scheduled_cancel_to_free', async () => {
      activeRecord.execution_strategy = 'scheduled_paid_transition' as any;
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('unsupported_transition_strategy');
    });

    it('2.5 rejeita quando transition_status !== scheduled ou financial_safety_status !== live', async () => {
      activeRecord.transition_status = 'awaiting_old_inactivation';
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('invalid_source_status');
    });

    it('2.6 rejeita quando now >= effective_at (fronteira já expirou)', async () => {
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1', {
        now: boundaryDate,
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('boundary_expired');
    });

    it('2.7 rejeita quando cancellation_reversal_status já for completed', async () => {
      activeRecord.cancellation_reversal_status = 'completed';
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('reversal_already_completed');
    });

    it('2.8 rejeita quando cancellation_reversal_status for attention_required', async () => {
      activeRecord.cancellation_reversal_status = 'attention_required';
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('reversal_attention_required');
    });

    it('2.9 rejeita quando cancellation_reversal_status for expired', async () => {
      activeRecord.cancellation_reversal_status = 'expired';
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('reversal_already_expired');
    });

    it('2.10 falha com locked_by_another_worker se transição já estiver travada', async () => {
      mockBillingRepo.claimTransitionForReconciliation.mockResolvedValueOnce(null);
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_admin_1');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('locked_by_another_worker');
    });
  });

  describe('3. Happy Path & Terminal Invariants', () => {
    it('3.1 reverte cancelamento com sucesso: reativa no provedor, limpa flags locais e libera slot', async () => {
      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'usr_pastor_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(true);
      expect(res.reason).toBe('reversal_completed');

      // Provedor reativado via PUT estrito com status ACTIVE e nextDueDate correto
      expect(mockProvider.reactivateSubscriptionStrict).toHaveBeenCalledWith(sourceSubId, effectiveBillingDate);

      // Transição finalizada como canceled + safe_terminal + completed
      expect(activeRecord.transition_status).toBe('canceled');
      expect(activeRecord.financial_safety_status).toBe('safe_terminal');
      expect(activeRecord.cancellation_reversal_status).toBe('completed');
      expect(activeRecord.cancellation_reversal_completed_at).toBeDefined();

      // Slot liberado
      expect(activeSlot).toBeNull();

      // Projeções locais atualizadas: cancel_at_period_end desmarcado e marker limpo
      expect(appSubRecord.cancel_at_period_end).toBe(false);
      expect(appSubRecord.active_cancellation_transition_id).toBeNull();
      expect(billingSubRecord.cancel_at_period_end).toBe(false);

      // Entitlement Essential e quotas intactas (zero perda de dados, zero downgrade)
      expect(appSubRecord.plan_id).toBe('essential');
      expect(appSubRecord.locked_member_quota).toBe(40);
      expect(appSubRecord.locked_song_quota).toBe(200);

      // Trava técnica liberada
      expect(mockBillingRepo.releasePlanChangeLock).toHaveBeenCalled();
    });

    it('3.2 idempotência: chamada duplicada após completion retorna reversal_already_completed', async () => {
      // Primeira execução bem-sucedida
      await billingService.requestScheduledCancellationReversal(ministryId, 'usr_pastor_1', {
        now: beforeBoundaryDate,
      });

      // Segunda chamada com mesmo ID
      const secondRes = await billingService.requestScheduledCancellationReversal(ministryId, 'usr_pastor_1', {
        now: beforeBoundaryDate,
      });

      expect(secondRes.success).toBe(false);
      expect(secondRes.reason).toBe('reversal_already_completed');
    });
  });

  describe('4. Provider Failures & Attention Handling', () => {
    it('4.1 initial GET retorna NOT_FOUND: marca atenção provider_resource_divergence e retém slot', async () => {
      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'NOT_FOUND',
        httpStatus: 404,
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_resource_divergence');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeSlot).not.toBeNull(); // Slot retido
      expect(mockProvider.reactivateSubscriptionStrict).not.toHaveBeenCalled();
    });

    it('4.2 initial GET retorna AUTH_ERROR: marca atenção provider_auth_failure e retém slot', async () => {
      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'AUTH_ERROR',
        httpStatus: 401,
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_auth_failure');
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeSlot).not.toBeNull();
    });

    it('4.3 initial GET retorna TRANSIENT_ERROR: libera lock para retry, NÃO marca atenção', async () => {
      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'TRANSIENT_ERROR',
        httpStatus: 503,
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('transient_provider_read_error');
      expect(activeRecord.cancellation_reversal_status).toBe('requested'); // Permanece requested
      expect(activeRecord.financial_attention_required).toBe(false); // Sem atenção
      expect(activeSlot).not.toBeNull(); // Slot retido
      expect(mockBillingRepo.releasePlanChangeLock).toHaveBeenCalled();
    });

    it('4.4 reactivateSubscriptionStrict retorna CLIENT_ERROR: marca atenção provider_client_error e retém slot', async () => {
      mockProvider.reactivateSubscriptionStrict.mockResolvedValueOnce({
        outcome: 'CLIENT_ERROR',
        httpStatus: 400,
        errorMessage: 'Subscription already canceled',
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('provider_client_error');
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeSlot).not.toBeNull();
    });

    it('4.5 reactivateSubscriptionStrict retorna MALFORMED_RESPONSE: marca atenção malformed_provider_subscription', async () => {
      mockProvider.reactivateSubscriptionStrict.mockResolvedValueOnce({
        outcome: 'MALFORMED_RESPONSE',
        httpStatus: 200,
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('malformed_provider_subscription');
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeSlot).not.toBeNull();
    });
  });

  describe('5. Crash Windows & Recovery Scenarios', () => {
    it('5.1 Crash Window A: Provedor já está ACTIVE no primeiro GET (recupera sem PUT duplicado)', async () => {
      mockProvider.getSubscriptionState.mockResolvedValue({
        outcome: 'FOUND',
        status: 'ACTIVE',
        httpStatus: 200,
        rawSubscription: {
          status: 'ACTIVE',
          nextDueDate: effectiveBillingDate,
        },
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(true);
      expect(res.reason).toBe('reversal_completed');
      // Nenhum PUT foi emitido porque já estava ACTIVE
      expect(mockProvider.reactivateSubscriptionStrict).not.toHaveBeenCalled();
      expect(activeRecord.cancellation_reversal_status).toBe('completed');
    });

    it('5.2 Crash Window B (Recovery): PUT retorna TRANSIENT_ERROR, mas fresh GET confirma ACTIVE', async () => {
      // PUT falhou com erro de rede/timeout
      mockProvider.reactivateSubscriptionStrict.mockResolvedValueOnce({
        outcome: 'TRANSIENT_ERROR',
        errorMessage: 'Socket timeout',
      });

      // Fresh GET de recuperação descobre que o Asaas processou o PUT antes de cair
      mockProvider.getSubscriptionState
        .mockResolvedValueOnce({
          outcome: 'FOUND',
          status: 'INACTIVE',
          httpStatus: 200,
        })
        .mockResolvedValueOnce({
          outcome: 'FOUND',
          status: 'ACTIVE',
          httpStatus: 200,
          rawSubscription: {
            status: 'ACTIVE',
            nextDueDate: effectiveBillingDate,
          },
        })
        .mockResolvedValueOnce({
          outcome: 'FOUND',
          status: 'ACTIVE',
          httpStatus: 200,
          rawSubscription: {
            status: 'ACTIVE',
            nextDueDate: effectiveBillingDate,
          },
        });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(true);
      expect(res.reason).toBe('reversal_completed');
      expect(activeRecord.cancellation_reversal_status).toBe('completed');
    });

    it('5.3 Crash Window B (Fail Closed): PUT retorna TRANSIENT_ERROR e fresh GET mostra ainda INACTIVE', async () => {
      mockProvider.reactivateSubscriptionStrict.mockResolvedValueOnce({
        outcome: 'TRANSIENT_ERROR',
        errorMessage: 'Connection reset',
      });

      // Fresh GET confirma que continua INACTIVE
      mockProvider.getSubscriptionState
        .mockResolvedValueOnce({
          outcome: 'FOUND',
          status: 'INACTIVE',
          httpStatus: 200,
        })
        .mockResolvedValueOnce({
          outcome: 'FOUND',
          status: 'INACTIVE',
          httpStatus: 200,
        });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('transient_provider_mutation_error');
      // Permanece requested e sem atenção para retry posterior do reconciler
      expect(activeRecord.cancellation_reversal_status).toBe('requested');
      expect(activeRecord.financial_attention_required).toBe(false);
      expect(activeSlot).not.toBeNull();
      expect(mockBillingRepo.releasePlanChangeLock).toHaveBeenCalled();
    });

    it('5.4 Crash Window C: listagem de pagamentos retorna TRANSIENT com provedor já ACTIVE', async () => {
      mockProvider.listAllSubscriptionPaymentsStrict.mockResolvedValueOnce({
        outcome: 'TRANSIENT_ERROR',
        errorMessage: 'Service unavailable on payments list',
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('transient_payment_list_error');
      // Provedor foi ativado no gateway, transição permanece requested/live para reconciliação
      expect(activeRecord.cancellation_reversal_status).toBe('requested');
      expect(activeRecord.financial_attention_required).toBe(false);
      expect(activeSlot).not.toBeNull();
    });

    it('5.5 Divergência de nextDueDate: gateway retorna nextDueDate diferente da fronteira esperada', async () => {
      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'FOUND',
        status: 'ACTIVE',
        httpStatus: 200,
        rawSubscription: {
          status: 'ACTIVE',
          nextDueDate: '2026-11-01', // Esperava 2026-10-01
        },
      });

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe(CANCELLATION_REVERSAL_ATTENTION_REASONS.NEXT_DUE_DATE_DIVERGENCE);
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeSlot).not.toBeNull();
    });
  });

  describe('6. Payment Safety Conflict Hardening (Zero Deletion)', () => {
    it('6.1 Múltiplos pagamentos futuros PENDING detectados: aciona atenção e NÃO deleta nenhum pagamento', async () => {
      mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
        { id: 'pay_p1', subscriptionId: sourceSubId, dueDate: effectiveBillingDate, status: 'PENDING', amountCents: 3490 },
        { id: 'pay_p2', subscriptionId: sourceSubId, dueDate: effectiveBillingDate, status: 'PENDING', amountCents: 3490 },
      ]);

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('multiple_pending_payments');
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeRecord.financial_attention_reason).toBe(
        CANCELLATION_REVERSAL_ATTENTION_REASONS.MULTIPLE_PENDING_PAYMENTS
      );
      // NENHUM pagamento foi deletado
      expect(mockProvider.removePayment).not.toHaveBeenCalled();
      expect(activeSlot).not.toBeNull();
    });

    it('6.2 Pagamento liquidado futuro detectado: aciona atenção e NÃO faz auto-estorno', async () => {
      mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
        { id: 'pay_conf', subscriptionId: sourceSubId, dueDate: effectiveBillingDate, status: 'CONFIRMED', amountCents: 3490 },
      ]);

      const res = await billingService.requestScheduledCancellationReversal(ministryId, 'user_1', {
        now: beforeBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('unexpected_settled_payment');
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(mockProvider.refundPayment).not.toHaveBeenCalled();
      expect(activeSlot).not.toBeNull();
    });
  });

  describe('7. Boundary Outcome Model & Reconciler Safety (Case A vs Case B)', () => {
    it('7.1 Case A: Reconciler executa pós-fronteira e provedor continua INACTIVE -> marca "expired" e slot HELD', async () => {
      activeRecord.cancellation_reversal_status = 'requested';
      activeRecord.cancellation_reversal_requested_at = '2026-09-20T10:00:00.000Z';
      activeRecord.cancellation_reversal_requested_by = 'usr_admin';

      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'FOUND',
        status: 'INACTIVE',
        httpStatus: 200,
      });

      const res = await billingService.reconcileScheduledCancellationReversal(activeRecord.id, 'worker_1', {
        now: afterBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('boundary_expired');
      expect(activeRecord.cancellation_reversal_status).toBe('expired');
      expect(activeSlot).not.toBeNull(); // Slot mantido para o cutover para Free
    });

    it('7.2 Case B: Reconciler executa pós-fronteira e provedor está ACTIVE -> aciona atenção e NUNCA aplica Free', async () => {
      activeRecord.cancellation_reversal_status = 'requested';
      activeRecord.cancellation_reversal_requested_at = '2026-09-20T10:00:00.000Z';
      activeRecord.cancellation_reversal_requested_by = 'usr_admin';

      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'FOUND',
        status: 'ACTIVE',
        httpStatus: 200,
      });

      const res = await billingService.reconcileScheduledCancellationReversal(activeRecord.id, 'worker_1', {
        now: afterBoundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe(CANCELLATION_REVERSAL_ATTENTION_REASONS.PROVIDER_RESTORED_BUT_BOUNDARY_EXPIRED);
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeSlot).not.toBeNull();
      // Cotas Essential intactas no app
      expect(appSubRecord.plan_id).toBe('essential');
    });

    it('7.3 Boundary Reconciler (Case B): ao encontrar status ACTIVE na fronteira com reversão solicitada, aciona atenção sem cutover para Free', async () => {
      activeRecord.cancellation_reversal_status = 'requested';
      activeRecord.cancellation_reversal_requested_at = '2026-09-20T10:00:00.000Z';
      activeRecord.cancellation_reversal_requested_by = 'usr_admin';

      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'FOUND',
        status: 'ACTIVE',
        httpStatus: 200,
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker_1', {
        now: boundaryDate,
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe(CANCELLATION_REVERSAL_ATTENTION_REASONS.PROVIDER_RESTORED_BUT_BOUNDARY_EXPIRED);
      expect(activeRecord.cancellation_reversal_status).toBe('attention_required');
      expect(activeRecord.financial_attention_required).toBe(true);
      expect(activeSlot).not.toBeNull();
      expect(appSubRecord.plan_id).toBe('essential'); // NÃO virou Free
    });

    it('7.4 Boundary Reconciler (Case A): provedor continua INACTIVE na fronteira, cancelamento conclui e marca subworkflow como expired', async () => {
      activeRecord.cancellation_reversal_status = 'requested';
      activeRecord.cancellation_reversal_requested_at = '2026-09-20T10:00:00.000Z';
      activeRecord.cancellation_reversal_requested_by = 'usr_admin';

      mockProvider.getSubscriptionState.mockResolvedValueOnce({
        outcome: 'FOUND',
        status: 'INACTIVE',
        httpStatus: 200,
      });

      const res = await billingService.reconcileScheduledCancelToFreeBoundary(activeRecord.id, 'worker_1', {
        now: boundaryDate,
      });

      expect(res.success).toBe(true);
      expect(activeRecord.cancellation_reversal_status).toBe('expired');
      expect(activeRecord.transition_status).toBe('completed');
      expect(activeRecord.financial_safety_status).toBe('safe_terminal');
      expect(activeSlot).toBeNull(); // Slot liberado
      expect(appSubRecord.plan_id).toBe('free'); // Cutover para Free concluído normalmente
    });
  });

  describe('8. Worker Routing', () => {
    it('8.1 BillingReconcilerWorker roteia transição scheduled_cancel_to_free com "requested" para reconcileScheduledCancellationReversal', async () => {
      activeRecord.cancellation_reversal_status = 'requested';
      activeRecord.cancellation_reversal_requested_at = '2026-09-20T10:00:00.000Z';
      activeRecord.cancellation_reversal_requested_by = 'usr_admin';

      mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValueOnce([activeRecord]);

      const reversalSpy = vi
        .spyOn(billingService, 'reconcileScheduledCancellationReversal')
        .mockResolvedValueOnce({ success: true, reason: 'reversal_completed' });
      const boundarySpy = vi.spyOn(billingService, 'reconcileScheduledCancelToFreeBoundary');

      const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
      const res = await worker.runCycle();

      expect(res.processed).toBe(1);
      expect(res.succeeded).toBe(1);
      expect(reversalSpy).toHaveBeenCalledWith(activeRecord.id, expect.any(String));
      expect(boundarySpy).not.toHaveBeenCalled();
    });

    it('8.2 BillingReconcilerWorker roteia transição scheduled_cancel_to_free sem "requested" para reconcileScheduledCancelToFreeBoundary', async () => {
      activeRecord.cancellation_reversal_status = undefined;

      mockBillingRepo.getV1TransitionsNeedingReconciliation.mockResolvedValueOnce([activeRecord]);

      const reversalSpy = vi.spyOn(billingService, 'reconcileScheduledCancellationReversal');
      const boundarySpy = vi
        .spyOn(billingService, 'reconcileScheduledCancelToFreeBoundary')
        .mockResolvedValueOnce({ success: true, reason: 'waiting_for_period_boundary' });

      const worker = new BillingReconcilerWorker(billingService, mockBillingRepo);
      const res = await worker.runCycle();

      expect(res.processed).toBe(1);
      expect(res.succeeded).toBe(1);
      expect(boundarySpy).toHaveBeenCalledWith(activeRecord.id, expect.any(String));
      expect(reversalSpy).not.toHaveBeenCalled();
    });
  });
});