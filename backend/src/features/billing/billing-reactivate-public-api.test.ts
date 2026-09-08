import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { requireMinistryRole } from '../../middleware/rbac';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { AuthenticatedRequest } from '../../middleware/auth';
import { Response } from 'express';
import { AppError } from '../../middleware/error-handler';
import { BillingTransitionV1Record } from './billing.types';

describe('Phase 4A.4.3 — Public V1 Cancellation Reversal API & Dispatch Matrix (Section 35)', () => {
  let billingService: BillingService;
  let controller: BillingController;
  let mockBillingRepo: any;
  let mockSubscriptionRepo: any;
  let mockProvider: any;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  const MINISTRY_ID = 'min_tenant_100';
  const OTHER_MINISTRY_ID = 'min_attacker_999';
  const USER_ADMIN_ID = 'usr_pastor_admin';
  const USER_MEMBER_ID = 'usr_musician_member';
  const TRANSITION_ID = 'tr_cancel_v1_test_001';
  const PROVIDER_SUB_ID = 'sub_asaas_active_123';

  function buildScheduledCancelTransition(overrides?: Partial<BillingTransitionV1Record>): BillingTransitionV1Record {
    return {
      id: TRANSITION_ID,
      transition_id: TRANSITION_ID,
      policy_version: 'billing_transition_v1',
      ministry_id: MINISTRY_ID,
      provider: 'asaas',
      currency: 'BRL',
      execution_strategy: 'scheduled_cancel_to_free',
      transition_status: 'scheduled',
      financial_safety_status: 'live',
      transition_type: 'downgrade',
      status: 'pending',
      early_activation_status: 'not_applicable',

      supersede_status: 'completed',
      payment_cleanup_status: 'completed',
      financial_attention_required: false,

      requested_plan_id: 'free',
      requested_interval: 'monthly',
      requested_addon_blocks: 0,
      expected_amount_cents: 0,

      source_plan_id: 'essential',
      source_interval: 'monthly',
      source_addon_blocks: 0,
      source_current_cycle_total_cents: 3490,
      source_entitlement_snapshot: {
        plan_id: 'essential',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 40,
        effective_song_quota: 200,
      },
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
      effective_at: '2026-10-01T00:00:00.000Z',
      effective_billing_date: '2026-10-01',

      target_plan_id: 'free',
      target_interval: 'monthly',
      target_addon_blocks: 0,
      target_future_recurring_price_cents: 0,
      target_current_cycle_total_cents: 0,
      target_entitlement_snapshot: {
        plan_id: 'free',
        addon_blocks: 0,
        interval: 'monthly',
        effective_member_quota: 10,
        effective_song_quota: 50,
      },

      cancellation_reversal_status: undefined,
      old_provider_subscription_id: PROVIDER_SUB_ID,
      ...overrides,
    } as BillingTransitionV1Record;
  }

  beforeEach(() => {
    mockBillingRepo = {
      getActiveTransitionForMinistry: vi.fn(),
      getSubscription: vi.fn(),
      setSubscription: vi.fn(),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn(),
      setSubscription: vi.fn(),
    };

    mockProvider = {
      name: 'asaas',
      reactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
    };

    billingService = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubscriptionRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    controller = new BillingController(billingService);

    mockReq = {
      params: { ministryId: MINISTRY_ID },
      query: {},
      body: {},
      headers: {},
      user: { id: USER_ADMIN_ID, email: 'admin@louvaio.com' },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('RBAC & Tenant Isolation (Items 3 & 4)', () => {
    it('3. Não-admin é rejeitado com HTTP 403 pelo middleware requireMinistryRole', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: MINISTRY_ID,
        role: 'member',
      } as any);

      mockReq.user = { id: USER_MEMBER_ID, email: 'member@louvaio.com' };
      const rbacMiddleware = requireMinistryRole('admin');
      await rbacMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    it('4. Usuário de Ministério A não pode reativar/desfazer em Ministério B (Tenant Isolation)', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockRejectedValue(
        new AppError(403, 'Acesso negado. Você não é integrante deste ministério.', {
          code: 'MINISTRY_ACCESS_DENIED',
          ministryId: OTHER_MINISTRY_ID,
        })
      );

      mockReq.params = { ministryId: OTHER_MINISTRY_ID };
      const rbacMiddleware = requireMinistryRole('admin');
      await rbacMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  describe('Service Dispatch & Execution (Items 1, 2, 6, 10)', () => {
    it('1 & 2. Admin com V1 cancellation chama motor canônico requestScheduledCancellationReversal com authenticated actorId', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      const reversalSpy = vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: true,
        reason: 'reversal_completed',
        transition: { ...activeTransition, cancellation_reversal_status: 'completed' },
      });

      mockBillingRepo.getSubscription.mockResolvedValue({
        id: 'sub_row_1',
        ministry_id: MINISTRY_ID,
        provider: 'asaas',
        plan_id: 'essential',
        status: 'active',
        cancel_at_period_end: false,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(reversalSpy).toHaveBeenCalledWith(MINISTRY_ID, USER_ADMIN_ID, undefined);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cancelamento desfeito com sucesso.',
          subscription: expect.objectContaining({
            cancel_at_period_end: false,
          }),
          reversalResult: expect.objectContaining({
            success: true,
            reason: 'reversal_completed',
          }),
        })
      );
    });

    it('6. V1 reversão bem-sucedida retorna resposta customer-safe com status HTTP 200', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: true,
        reason: 'reversal_completed',
        transition: { ...activeTransition, cancellation_reversal_status: 'completed' },
      });

      mockBillingRepo.getSubscription.mockResolvedValue({
        id: 'sub_row_1',
        ministry_id: MINISTRY_ID,
        provider: 'asaas',
        plan_id: 'essential',
        cancel_at_period_end: false,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cancelamento desfeito com sucesso.',
          subscription: expect.any(Object),
        })
      );
    });

    it('10. Reativação legada permanece disponível quando não existe cancelamento V1', async () => {
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue(null);
      mockBillingRepo.getSubscription.mockResolvedValue({
        id: 'sub_row_1',
        ministry_id: MINISTRY_ID,
        provider: 'asaas',
        plan_id: 'essential',
        cancel_at_period_end: true,
        provider_subscription_id: 'sub_legacy_123',
        current_period_end: '2026-10-01T00:00:00.000Z',
      });
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: MINISTRY_ID,
        plan_id: 'essential',
        cancel_at_period_end: true,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockProvider.reactivateSubscription).toHaveBeenCalledWith('sub_legacy_123', expect.any(String));
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Assinatura reativada com sucesso.',
          subscription: expect.objectContaining({
            cancel_at_period_end: false,
          }),
        })
      );
    });
  });

  describe('Error Mapping & Fail-Closed Safety (Items 5, 7, 8, 9, 11, 12, 13)', () => {
    it('5. no_active_cancellation_found mapeia para HTTP 400 com código e mensagem segura', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'no_active_cancellation_found',
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Não há cancelamento agendado para desfazer neste ministério.');
      expect(err.details?.code).toBe('NO_ACTIVE_CANCELLATION_FOUND');
    });

    it('7. concurrent lock outcome (locked_by_another_worker) mapeia para HTTP 409 seguro', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'locked_by_another_worker',
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(409);
      expect(err.message).toBe('Existe uma operação de faturamento em andamento. Tente novamente em instantes.');
      expect(err.details?.code).toBe('CONCURRENT_BILLING_OPERATION');
    });

    it('8. attention outcome (source_subscription_reactivated / divergence) mapeia para HTTP 409', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'source_subscription_reactivated',
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(409);
      expect(err.message).toBe('A assinatura requer verificação antes de continuar. Entre em contato com o suporte.');
      expect(err.details?.code).toBe('FINANCIAL_ATTENTION_REQUIRED');
    });

    it('9. transient outcome (transient_provider_mutation_error) mapeia para HTTP 503', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'transient_provider_mutation_error',
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(503);
      expect(err.message).toBe('Instabilidade temporária na comunicação com o provedor de pagamentos. Tente novamente em instantes.');
      expect(err.details?.code).toBe('PROVIDER_TRANSIENT_ERROR');
    });

    it('11. Detalhes brutos do provedor, stack traces e IDs de lock não são vazados na resposta', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'provider_resource_divergence',
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.message).not.toContain('asaas');
      expect(err.message).not.toContain('sub_');
      expect(err.message).not.toContain('lock');
    });

    it('12. Idempotência terminal: quando reversão já foi completada, responde HTTP 200', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'reversal_already_completed',
      });

      mockBillingRepo.getSubscription.mockResolvedValue({
        id: 'sub_row_1',
        ministry_id: MINISTRY_ID,
        provider: 'asaas',
        plan_id: 'essential',
        cancel_at_period_end: false,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cancelamento desfeito com sucesso.',
          subscription: expect.objectContaining({
            cancel_at_period_end: false,
          }),
        })
      );
    });

    it('13. Expiração na fronteira periódica (boundary_expired) mapeia para HTTP 400', async () => {
      const activeTransition = buildScheduledCancelTransition();
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      vi.spyOn(billingService, 'requestScheduledCancellationReversal').mockResolvedValue({
        success: false,
        reason: 'boundary_expired',
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(400);
      expect(err.details?.code).toBe('CANCELLATION_BOUNDARY_REACHED');
    });

    it('14. Transição em awaiting_old_inactivation rejeita diretamente com 409', async () => {
      const activeTransition = buildScheduledCancelTransition({
        transition_status: 'awaiting_old_inactivation',
      });
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(409);
      expect(err.details?.code).toBe('ACTIVE_CANCELLATION_TRANSITION_EXISTS');
    });

    it('15. Transição com financial_attention_required rejeita com 409', async () => {
      const activeTransition = buildScheduledCancelTransition({
        transition_status: 'financial_attention_required',
      });
      mockBillingRepo.getActiveTransitionForMinistry.mockResolvedValue({
        slot: { id: 'slot_1', plan_change_id: activeTransition.id },
        transition: activeTransition,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(409);
      expect(err.details?.code).toBe('FINANCIAL_ATTENTION_REQUIRED');
    });
  });
});
