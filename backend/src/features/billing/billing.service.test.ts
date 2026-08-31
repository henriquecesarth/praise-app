import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { BillingProvider } from './providers/billing-provider.interface';
import {
  calculatePlanPriceCents,
  calculateAnnualDiscountPriceCents,
  PLANS_CATALOG,
} from '../../config/plans.config';
import { AppError } from '../../middleware/error-handler';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingWebhookEventRecord,
} from './billing.types';
import { config } from '../../config/unifiedConfig';

describe('BillingService & Gateway Automation Tests', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockProvider: BillingProvider;

  beforeEach(() => {
    (config as any).billingPublicApiUrl = 'https://tunnel.trycloudflare.com';
    mockBillingRepo = {
      getCustomer: vi.fn(),
      getCustomerByProviderId: vi.fn(),
      setCustomer: vi.fn(),
      getSubscription: vi.fn(),
      getSubscriptionByProviderSubscriptionId: vi.fn(),
      getSubscriptionByCheckoutId: vi.fn(),
      getSubscriptionByCheckoutIntentId: vi.fn(),
      getSubscriptionByProviderId: vi.fn(),
      setSubscription: vi.fn(),
      getPlanChange: vi.fn(),
      setPlanChange: vi.fn(),
      getRecentPendingPlanChange: vi.fn().mockResolvedValue(null),
      getPlanChangeByCheckoutIntentId: vi.fn(),
      getPlanChangeByCheckoutId: vi.fn(),
      getPlanChangeByNewSubscriptionId: vi.fn(),
      getFailedSupersedes: vi.fn().mockResolvedValue([]),
      getPendingOrFailedPlanChanges: vi.fn().mockResolvedValue([]),
      claimPlanChangeForRetry: vi.fn().mockImplementation(async (id: string, lockWorkerId: string) => {
        const change = await mockBillingRepo.getPlanChange(id);
        if (!change || change.status === 'completed') return null;
        return { ...change, retry_locked_by: lockWorkerId };
      }),
      releasePlanChangeLock: vi.fn(),
      saveTransaction: vi.fn(),
      getTransactions: vi.fn(),
      getWebhookEvent: vi.fn(),
      registerWebhookEvent: vi.fn().mockImplementation(async (evt: BillingWebhookEventRecord) => ({
        isDuplicate: false,
        event: evt,
      })),
      markWebhookEventProcessed: vi.fn(),
    };

    mockSubscriptionService = {
      getSubscriptionSummary: vi.fn().mockResolvedValue({
        plan: PLANS_CATALOG.free,
        subscription: {
          planId: 'free',
          memberAddonBlocks: 0,
          billingStatus: 'active',
          accessMode: 'normal',
          currentPeriodStart: '2026-08-29T00:00:00.000Z',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
        quotas: { members: 10, songs: 50 },
        usage: { membersCount: 5, songsCount: 20 },
        isOverLimit: false,
        overLimitDetails: { isOverLimit: false, membersOver: false, songsOver: false },
        graceDaysRemaining: null,
      }),
      changePlan: vi.fn(),
      changeMemberAddonBlocks: vi.fn(),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn(),
      setSubscription: vi.fn(),
    };

    mockMinistryRepo = {
      getMinistryById: vi.fn().mockResolvedValue({
        id: 'min-100',
        name: 'Ministério Central',
        owner_id: 'user-admin',
      }),
    };

    mockProvider = {
      name: 'asaas',
      createCustomer: vi.fn().mockResolvedValue({ providerCustomerId: 'cus_asaas_123' }),
      createCheckout: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_123',
        checkoutId: 'chk_123',
        expiresAt: '2026-09-05T00:00:00.000Z',
      }),
      inactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      removeSubscription: vi.fn().mockResolvedValue({ success: true }),
      cancelSubscription: vi.fn().mockResolvedValue({ success: true, canceledAtPeriodEnd: true }),
      reactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      removePayment: vi.fn().mockResolvedValue({ success: true }),
      getPayment: vi.fn().mockResolvedValue(null),
    };

    billingService = new BillingService(
      mockBillingRepo as unknown as BillingRepository,
      mockSubscriptionService as unknown as SubscriptionService,
      mockSubscriptionRepo as unknown as SubscriptionRepository,
      mockMinistryRepo as unknown as MinistryRepository,
      mockProvider
    );
  });

  // --------------------------------------------------------------------------
  // 1. Catálogo e Cálculo de Preços
  // --------------------------------------------------------------------------
  describe('1. Cálculo de Preços e Catálogo Financeiro', () => {
    it('deve calcular o desconto anual de 10% com exatidão determinística', () => {
      // Lite: R$ 14,90 * 12 * 0.9 = 160.92
      expect(calculateAnnualDiscountPriceCents(1490)).toBe(16092);

      // Lite+: R$ 24,90 * 12 * 0.9 = 268.92
      expect(calculateAnnualDiscountPriceCents(2490)).toBe(26892);

      // Essential: R$ 34,90 * 12 * 0.9 = 376.92
      expect(calculateAnnualDiscountPriceCents(3490)).toBe(37692);

      // Pro: R$ 89,90 * 12 * 0.9 = 970.92
      expect(calculateAnnualDiscountPriceCents(8990)).toBe(97092);

      // Premium: R$ 214,90 * 12 * 0.9 = 2320.92
      expect(calculateAnnualDiscountPriceCents(21490)).toBe(232092);
    });

    it('deve calcular decomposição financeira para planos mensais e anuais com add-ons', () => {
      // Essential com 2 blocos de add-on mensal: R$ 34,90 + 2 * R$ 9,90 = R$ 54,70 (5470 cents)
      const essentialMonthly = calculatePlanPriceCents('essential', 'monthly', 2);
      expect(essentialMonthly.basePriceCents).toBe(3490);
      expect(essentialMonthly.addonsPriceCents).toBe(1980);
      expect(essentialMonthly.totalPriceCents).toBe(5470);
      expect(essentialMonthly.fullMonthlyEquivalentCents).toBe(5470);
      expect(essentialMonthly.annualSavingsCents).toBe(0);

      // Essential com 2 blocos de add-on anual: (34.90*12*0.9) + 2*(9.90*12*0.9) = 376.92 + 213.84 = 590.76 (59076 cents)
      const essentialAnnual = calculatePlanPriceCents('essential', 'annual', 2);
      expect(essentialAnnual.basePriceCents).toBe(37692);
      expect(essentialAnnual.addonsPriceCents).toBe(21384);
      expect(essentialAnnual.totalPriceCents).toBe(59076);
      // Sem desconto seria: 54.70 * 12 = 656.40 (65640 cents). Economia: 65640 - 59076 = 6564 cents (R$ 65,64)
      expect(essentialAnnual.annualSavingsCents).toBe(6564);
    });

    it('deve limitar add-ons ao teto do plano ao calcular preço', () => {
      // Essential tem teto de 4 blocos. Pedir 10 blocos deve calcular exatamente 4 blocos
      const calc = calculatePlanPriceCents('essential', 'monthly', 10);
      expect(calc.addonBlocks).toBe(4);
      expect(calc.addonsPriceCents).toBe(4 * 990);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Checkout Preview
  // --------------------------------------------------------------------------
  describe('2. Checkout Preview', () => {
    it('deve retornar preview completo de upgrade para Pro Anual com 3 blocos de add-on', async () => {
      const preview = await billingService.getCheckoutPreview('min-100', 'pro', 'annual', 3);

      expect(preview.planId).toBe('pro');
      expect(preview.planName).toBe('Pro');
      expect(preview.interval).toBe('annual');
      expect(preview.addonBlocks).toBe(3);
      expect(preview.effectiveMembersQuota).toBe(130); // 100 base + 3*10
      expect(preview.effectiveSongsQuota).toBe(500);
      expect(preview.basePriceCents).toBe(97092); // R$ 970,92
      expect(preview.addonsPriceCents).toBe(3 * 7452); // R$ 223,56
      expect(preview.totalPriceCents).toBe(97092 + 3 * 7452);
      expect(preview.isDowngrade).toBe(false);
    });

    it('deve identificar downgrade e apontar risco de over-limit quando o uso excede a nova capacidade', async () => {
      mockSubscriptionService.getSubscriptionSummary.mockResolvedValue({
        plan: PLANS_CATALOG.pro,
        subscription: { planId: 'pro', memberAddonBlocks: 0, billingStatus: 'active' },
        quotas: { members: 100, songs: 500 },
        usage: { membersCount: 35, songsCount: 80 },
        isOverLimit: false,
        overLimitDetails: { isOverLimit: false, membersOver: false, songsOver: false },
        graceDaysRemaining: null,
      });

      // Downgrade de Pro para Free (capacidade 10 membros / 50 músicas) com uso atual de 35 membros / 80 músicas
      const preview = await billingService.getCheckoutPreview('min-100', 'free', 'monthly', 0);

      expect(preview.isDowngrade).toBe(true);
      expect(preview.downgradeImpact).toBeDefined();
      expect(preview.downgradeImpact?.isOverLimit).toBe(true);
      expect(preview.downgradeImpact?.membersOver).toBe(true);
      expect(preview.downgradeImpact?.songsOver).toBe(true);
      expect(preview.downgradeImpact?.gracePeriodDays).toBe(7);
    });

    it('deve rejeitar preview para plano inexistente', async () => {
      await expect(
        billingService.getCheckoutPreview('min-100', 'inexistente' as any, 'monthly', 0)
      ).rejects.toThrow(AppError);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Criação de Checkout
  // --------------------------------------------------------------------------
  describe('3. Criação de Checkout', () => {
    it('deve processar downgrade para plano Free diretamente sem acionar gateway', async () => {
      const result = await billingService.createCheckout('min-100', 'usr-1', {
        planId: 'free',
        interval: 'monthly',
      });

      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min-100', 'free');
      expect(mockProvider.createCheckout).not.toHaveBeenCalled();
      expect(result.totalPriceCents).toBe(0);
    });

    it('deve gerar link de checkout e persistir intenção de mudança em billing_plan_changes sem sobrescrever assinatura ativa', async () => {
      const activeBillingSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_old_123',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(activeBillingSub);

      const result = await billingService.createCheckout('min-100', 'usr-1', {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 1,
      });

      expect(mockProvider.createCheckout).toHaveBeenCalledWith({
        ministryId: 'min-100',
        checkoutIntentId: expect.stringMatching(/^intent_min-100_/),
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 1,
        amountCents: 3490 + 990, // R$ 44,80
        successUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/success',
        cancelUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/cancel',
        expiredUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/expired',
      });

      // NÃO deve sobrescrever ou alterar a assinatura ativa vigente
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();

      // DEVE persistir a intenção com previous_provider_subscription_id preservado
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          ministry_id: 'min-100',
          requested_plan_id: 'essential',
          requested_interval: 'monthly',
          requested_addon_blocks: 1,
          status: 'pending',
          previous_provider_subscription_id: 'sub_old_123',
          previous_plan_id: 'lite',
          supersede_status: 'pending',
          provider_checkout_id: 'chk_123',
        })
      );

      expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/c/chk_123');
      expect(result.totalPriceCents).toBe(4480);
    });

    it('deve rejeitar checkout com intervalo inválido', async () => {
      await expect(
        billingService.createCheckout('min-100', 'usr-1', {
          planId: 'essential',
          interval: 'weekly' as any,
        })
      ).rejects.toThrow(AppError);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Webhooks e Idempotência
  // --------------------------------------------------------------------------
  describe('4. Processamento de Webhooks e Idempotência', () => {
    it('deve rejeitar webhook quando a assinatura de segurança for inválida', async () => {
      vi.spyOn(mockProvider, 'validateWebhookRequest').mockReturnValue(false);

      await expect(
        billingService.handleWebhook({ 'asaas-access-token': 'wrong' }, { event: 'PAYMENT_CONFIRMED' })
      ).rejects.toThrow(AppError);
    });

    it('deve ignorar evento duplicado que já tenha sido processado com sucesso', async () => {
      mockBillingRepo.registerWebhookEvent.mockResolvedValue({
        isDuplicate: true,
        event: {
          id: 'asaas_evt_dup',
          processing_status: 'processed',
        },
      });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_dup',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_123',
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_dup' });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('duplicate_event');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it('deve ativar entitlement e atualizar status para active ao receber PAYMENT_CONFIRMED', async () => {
      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_100',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_asaas_100',
        providerPaymentId: 'pay_999',
        amountCents: 5470,
      });

      const subRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_asaas_100',
        plan_id: 'essential',
        interval: 'monthly',
        member_addon_blocks: 2,
        amount_cents: 5470,
        status: 'pending',
      };
      mockBillingRepo.getSubscriptionByProviderSubscriptionId.mockResolvedValue(subRecord);
      mockBillingRepo.getSubscriptionByProviderId.mockResolvedValue(subRecord);

      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        ministry_id: 'min-100',
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'trialing',
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_100' });

      expect(result.processed).toBe(true);
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min-100', 'essential');
      expect(mockSubscriptionService.changeMemberAddonBlocks).toHaveBeenCalledWith('min-100', 2);
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          billing_status: 'active',
          grace_period_expires_at: null,
        })
      );
      expect(mockBillingRepo.saveTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_payment_id: 'pay_999',
          status: 'paid',
        })
      );
      expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
        'asaas',
        'evt_100',
        'processed'
      );
    });

    it('deve correlacionar SUBSCRIPTION_CREATED com checkout pendente via providerCheckoutId e persistir provider_subscription_id real na transição', async () => {
      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_sub_created',
        eventType: 'subscription_created',
        rawEventType: 'SUBSCRIPTION_CREATED',
        providerSubscriptionId: 'sub_asaas_real_123',
        providerCheckoutId: 'chk_session_123',
        providerCustomerId: 'cus_new_456',
        amountCents: 1490,
      });

      const pendingChange = {
        id: 'intent_min-100_123',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_min-100_123',
        provider_checkout_id: 'chk_session_123',
        requested_plan_id: 'lite',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 1490,
        currency: 'BRL',
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockBillingRepo.getPlanChangeByCheckoutId.mockResolvedValue(pendingChange);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'free',
        billing_status: 'active',
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_sub_created' });

      expect(result.processed).toBe(true);
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'intent_min-100_123',
          new_provider_subscription_id: 'sub_asaas_real_123',
          provider_customer_id: 'cus_new_456',
        })
      );
      expect(mockBillingRepo.setCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          ministry_id: 'min-100',
          provider_customer_id: 'cus_new_456',
        })
      );
    });

    it('deve retornar histórico de transações através de getBillingHistory', async () => {
      const mockTxs = [
        {
          id: 'asaas_pay_1',
          ministry_id: 'min-100',
          provider: 'asaas',
          provider_payment_id: 'pay_1',
          amount_cents: 1490,
          currency: 'BRL',
          status: 'paid',
          due_date: '2026-08-30',
          paid_at: '2026-08-30T12:00:00.000Z',
          created_at: '2026-08-30T12:00:00.000Z',
          updated_at: '2026-08-30T12:00:00.000Z',
        },
      ];
      mockBillingRepo.getTransactions.mockResolvedValue(mockTxs);

      const history = await billingService.getBillingHistory('min-100');

      expect(mockBillingRepo.getTransactions).toHaveBeenCalledWith('min-100');
      expect(history).toEqual(mockTxs);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Cancelamento e Reativação
  // --------------------------------------------------------------------------
  describe('5. Cancelamento e Reativação de Assinatura', () => {
    it('deve agendar cancelamento para o fim do período sem cortar o acesso imediato', async () => {
      const activeBillingSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(activeBillingSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'pro',
        cancel_at_period_end: false,
      });

      const result = await billingService.cancelSubscription('min-100');

      expect(result.cancel_at_period_end).toBe(true);
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_123');
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          cancel_at_period_end: true,
        })
      );
    });

    it('deve reativar uma assinatura com cancelamento agendado', async () => {
      const pendingCancellationSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(pendingCancellationSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'pro',
        cancel_at_period_end: true,
      });

      const result = await billingService.reactivateSubscription('min-100');

      expect(result.cancel_at_period_end).toBe(false);
      expect(mockProvider.reactivateSubscription).toHaveBeenCalledWith('sub_123', '2026-08-31');
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          cancel_at_period_end: false,
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. Lifecycle de Mudança de Planos, Supersede e Proteção Financeira
  // --------------------------------------------------------------------------
  describe('6. Lifecycle de Mudança de Planos, Supersede e Proteção Financeira', () => {
    it('Cenário A: Free -> Lite com pagamento confirmado torna Lite vigente sem supersede', async () => {
      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_pay_free_to_lite',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_lite_123',
        providerPaymentId: 'pay_lite_123',
        externalReference: 'intent_free_to_lite',
        amountCents: 1490,
      });

      const planChange = {
        id: 'intent_free_to_lite',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_free_to_lite',
        requested_plan_id: 'lite',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 1490,
        previous_provider_subscription_id: null,
        status: 'pending',
        supersede_status: 'not_applicable',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(planChange);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({ id: 'min-100', plan_id: 'free', billing_status: 'active' });

      const result = await billingService.handleWebhook({}, { id: 'evt_pay_free_to_lite' });

      expect(result.processed).toBe(true);
      expect(mockProvider.cancelSubscription).not.toHaveBeenCalled();
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min-100', 'lite');
      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          ministry_id: 'min-100',
          plan_id: 'lite',
          provider_subscription_id: 'sub_lite_123',
          status: 'active',
        })
      );
    });

    it('Cenário B: Lite -> Premium checkout criado mantém Lite ativo e preserva assinatura atual', async () => {
      const activeLiteSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_lite_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(activeLiteSub);

      const checkout = await billingService.createCheckout('min-100', 'usr-1', {
        planId: 'premium',
        interval: 'monthly',
      });

      expect(checkout.checkoutUrl).toBeDefined();
      // Assinatura ativa NÃO é mutada nem sobrescrita
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          requested_plan_id: 'premium',
          previous_provider_subscription_id: 'sub_lite_old',
          supersede_status: 'pending',
          status: 'pending',
        })
      );
    });

    it('Cenário C & D: Lite -> Premium com pagamento pending ou checkout abandonado mantém Lite 100% ativo', async () => {
      const activeLiteSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_lite_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };

      const pendingChange = {
        id: 'intent_lite_to_prem',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_lite_to_prem',
        provider_checkout_id: 'chk_prem_123',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        currency: 'BRL',
        status: 'pending',
        previous_provider_subscription_id: 'sub_lite_old',
      };

      mockBillingRepo.getPlanChangeByCheckoutId.mockResolvedValue(pendingChange);
      mockBillingRepo.getSubscription.mockResolvedValue(activeLiteSub);

      // Evento de checkout expirado/cancelado
      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_chk_exp',
        eventType: 'checkout_expired',
        rawEventType: 'CHECKOUT_EXPIRED',
        providerCheckoutId: 'chk_prem_123',
      });

      await billingService.handleWebhook({}, { id: 'evt_chk_exp' });

      // Transição marcada como expired sem tocar em billing_subscriptions
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'expired' })
      );
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
      expect(mockProvider.cancelSubscription).not.toHaveBeenCalled();
    });

    it('Cenário E: Lite -> Premium com pagamento confirmado inativa sub_old no Asaas (PUT INACTIVE) e ativa sub_new', async () => {
      const activeLiteSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_lite_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };

      const planChange = {
        id: 'intent_lite_to_prem',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_lite_to_prem',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        previous_provider_subscription_id: 'sub_lite_old',
        status: 'pending',
        supersede_status: 'pending',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(planChange);
      mockBillingRepo.getSubscription.mockResolvedValue(activeLiteSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({ id: 'min-100', plan_id: 'lite', billing_status: 'active' });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_prem_paid',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_prem_new',
        providerPaymentId: 'pay_prem_123',
        externalReference: 'intent_lite_to_prem',
        amountCents: 21490,
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_prem_paid' });

      expect(result.processed).toBe(true);
      // Assinatura antiga DEVE ser inativada (PUT INACTIVE) no provedor
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_lite_old');
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min-100', 'premium');
      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: 'premium',
          provider_subscription_id: 'sub_prem_new',
          status: 'active',
        })
      );
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          supersede_status: 'completed',
          new_provider_subscription_id: 'sub_prem_new',
        })
      );
    });

    it('Cenário F: Lite monthly -> Lite annual inativa sub_old mensal (PUT INACTIVE) e ativa sub_new anual', async () => {
      const activeMonthlySub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_monthly_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };

      const planChange = {
        id: 'intent_lite_annual',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_lite_annual',
        requested_plan_id: 'lite',
        requested_interval: 'annual',
        requested_addon_blocks: 0,
        expected_amount_cents: 16092,
        previous_provider_subscription_id: 'sub_monthly_old',
        status: 'pending',
        supersede_status: 'pending',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(planChange);
      mockBillingRepo.getSubscription.mockResolvedValue(activeMonthlySub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({ id: 'min-100', plan_id: 'lite', billing_status: 'active' });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_lite_ann_paid',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_annual_new',
        providerPaymentId: 'pay_ann_123',
        externalReference: 'intent_lite_annual',
        amountCents: 16092,
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_lite_ann_paid' });

      expect(result.processed).toBe(true);
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_monthly_old');
      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: 'lite',
          interval: 'annual',
          provider_subscription_id: 'sub_annual_new',
          status: 'active',
        })
      );
    });

    it('Cenário H: Webhook duplicado não duplica cancelamento nem supersede', async () => {
      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_dup',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
      });
      mockBillingRepo.registerWebhookEvent.mockResolvedValue({ isDuplicate: true, event: {} });

      const result = await billingService.handleWebhook({}, { id: 'evt_dup' });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('duplicate_event');
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
    });

    it('Cenário I: Webhook atrasado de sub_old (SUBSCRIPTION_CANCELED / PAYMENT_OVERDUE) não sobrescreve sub_new', async () => {
      const currentActiveSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_prem_new',
        plan_id: 'premium',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 21490,
        status: 'active',
        started_at: '2026-08-30T00:00:00.000Z',
        current_period_start: '2026-08-30T00:00:00.000Z',
        current_period_end: '2026-09-30T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-30T00:00:00.000Z',
        updated_at: '2026-08-30T00:00:00.000Z',
      };

      mockBillingRepo.getSubscriptionByProviderSubscriptionId.mockResolvedValue(null);
      mockBillingRepo.getSubscription.mockResolvedValue(currentActiveSub);
      mockBillingRepo.getCustomerByProviderId.mockResolvedValue({ ministry_id: 'min-100' });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_old_canceled',
        eventType: 'subscription_canceled',
        rawEventType: 'SUBSCRIPTION_DELETED',
        providerSubscriptionId: 'sub_lite_old',
        providerCustomerId: 'cus_123',
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_old_canceled' });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('superseded_subscription_event_ignored');
      // Subscrição ativa continua intacta
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
    });

    it('Cenário J: Falha ao inativar sub_old retorna erro retryable para redelivery e é recuperada deterministicamente pelo reconciliador', async () => {
      vi.spyOn(mockProvider, 'inactivateSubscription').mockRejectedValueOnce(new Error('Gateway timeout'));

      const activeLiteSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_lite_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };

      const planChange = {
        id: 'intent_lite_to_prem_fail',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_lite_to_prem_fail',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        previous_provider_subscription_id: 'sub_lite_old',
        status: 'pending',
        supersede_status: 'pending',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(planChange);
      mockBillingRepo.getSubscription.mockResolvedValue(activeLiteSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({ id: 'min-100', plan_id: 'lite', billing_status: 'active' });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_prem_paid_fail_cancel',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_prem_new',
        providerPaymentId: 'pay_prem_123',
        externalReference: 'intent_lite_to_prem_fail',
        amountCents: 21490,
      });

      const webhookResult = await billingService.handleWebhook({}, { id: 'evt_prem_paid_fail_cancel' });

      // Deve falhar com reason retryable para que o Asaas redeliver aconteça
      expect(webhookResult.processed).toBe(false);
      expect(webhookResult.reason).toBe('supersede_inactivation_failed');

      // NÃO promove a nova assinatura enquanto sub_old não for inativada
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();

      // Registra transição com supersede_status = 'failed' e status = 'superseding' mantendo IDs
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'superseding',
          supersede_status: 'failed',
          previous_provider_subscription_id: 'sub_lite_old',
        })
      );

      // Agora o reconciliador processa a transição com sucesso
      mockBillingRepo.getFailedSupersedes.mockResolvedValue([
        {
          id: 'intent_lite_to_prem_fail',
          ministry_id: 'min-100',
          provider: 'asaas',
          requested_plan_id: 'premium',
          requested_interval: 'monthly',
          requested_addon_blocks: 0,
          previous_provider_subscription_id: 'sub_lite_old',
          new_provider_subscription_id: 'sub_prem_new',
          supersede_status: 'failed',
          status: 'superseding',
        },
      ]);
      mockBillingRepo.getPlanChange.mockResolvedValue({
        id: 'intent_lite_to_prem_fail',
        ministry_id: 'min-100',
        provider: 'asaas',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        previous_provider_subscription_id: 'sub_lite_old',
        new_provider_subscription_id: 'sub_prem_new',
        supersede_status: 'failed',
        status: 'superseding',
      });
      (mockProvider as any).getSubscription = vi.fn().mockResolvedValue({ status: 'ACTIVE' });

      await billingService.reconcileBillingSubscription('min-100');

      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_lite_old');
      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: 'premium',
          provider_subscription_id: 'sub_prem_new',
          status: 'active',
        })
      );
    });

    it('Cenário K: Paid -> Free inativa renovação no Asaas (PUT INACTIVE) e agenda cancelamento', async () => {
      const activeBillingSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_paid_123',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(activeBillingSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'pro',
        cancel_at_period_end: false,
      });

      const result = await billingService.createCheckout('min-100', 'usr-1', {
        planId: 'free',
        interval: 'monthly',
      });

      expect(result.totalPriceCents).toBe(0);
      expect(mockProvider.createCheckout).not.toHaveBeenCalled();
      // Deve ter chamado inactivateSubscription no Asaas
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_paid_123');
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          cancel_at_period_end: true,
        })
      );
    });

    it('Cenário M: Paid -> Free com falha de comunicação no Asaas lança erro e NÃO grava cancelamento falso', async () => {
      const activeBillingSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_paid_123',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(activeBillingSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'pro',
        cancel_at_period_end: false,
      });

      vi.spyOn(mockProvider, 'inactivateSubscription').mockRejectedValueOnce(new Error('Gateway timeout'));

      await expect(
        billingService.createCheckout('min-100', 'usr-1', {
          planId: 'free',
          interval: 'monthly',
        })
      ).rejects.toThrow();

      // NÃO deve ter gravado cancel_at_period_end = true no Firestore
      expect(mockSubscriptionRepo.setSubscription).not.toHaveBeenCalled();
    });

    it('Cenário N: Reativação antes do fim do período deriva nextDueDate no timezone e envia PUT ACTIVE', async () => {
      const pendingCancellationSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: '2026-08-01T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-30T23:59:59.000Z',
        cancel_at_period_end: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(pendingCancellationSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'pro',
        cancel_at_period_end: true,
      });

      const result = await billingService.reactivateSubscription('min-100');

      expect(result.cancel_at_period_end).toBe(false);
      expect(mockProvider.reactivateSubscription).toHaveBeenCalledWith('sub_123', '2026-09-30');
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          cancel_at_period_end: false,
        })
      );
    });

    it('Cenário O: Redelivery de webhook após worker já ter concluído supersede é tratado de forma idempotente (noop)', async () => {
      const completedPlanChange = {
        id: 'intent_already_done',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_already_done',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        previous_provider_subscription_id: 'sub_old',
        new_provider_subscription_id: 'sub_new',
        status: 'completed',
        supersede_status: 'completed',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(completedPlanChange);

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_redelivery_1',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_new',
        providerPaymentId: 'pay_redeliver_123',
        externalReference: 'intent_already_done',
        amountCents: 21490,
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_redelivery_1' });

      expect(result.processed).toBe(true);
      expect(result.reason).toBe('already_completed');
      // NÃO tenta inativar novamente
      expect(mockProvider.inactivateSubscription).not.toHaveBeenCalled();
    });
  });

  describe('4. Limpeza e Proteção de Cobranças Existentes Pré-Geradas (Payment Cleanup Safety)', () => {
    it('Regra de Classificação de Pagamentos: Somente PENDING com dueDate >= renewalCutoffDate são removidos', async () => {
      // current_period_end = 2026-09-30T00:00:00.000Z
      const paymentsMock: any[] = [
        { id: 'pay_1', status: 'PENDING', dueDate: '2026-09-15', subscriptionId: 'sub_old' }, // Ciclo passado/atual -> PRESERVAR
        { id: 'pay_2', status: 'PENDING', dueDate: '2026-09-29', subscriptionId: 'sub_old' }, // Ciclo atual -> PRESERVAR
        { id: 'pay_3', status: 'PENDING', dueDate: '2026-09-30', subscriptionId: 'sub_old' }, // Próxima renovação -> REMOVER
        { id: 'pay_4', status: 'PENDING', dueDate: '2026-10-30', subscriptionId: 'sub_old' }, // Próxima renovação -> REMOVER
        { id: 'pay_5', status: 'OVERDUE', dueDate: '2026-09-30', subscriptionId: 'sub_old' }, // Inadimplência legítima -> PRESERVAR
        { id: 'pay_6', status: 'CONFIRMED', dueDate: '2026-10-30', subscriptionId: 'sub_old' }, // Histórico pago -> PRESERVAR
        { id: 'pay_7', status: 'RECEIVED', dueDate: '2026-10-30', subscriptionId: 'sub_old' }, // Histórico pago -> PRESERVAR
      ];

      (mockProvider as any).listSubscriptionPayments = vi.fn().mockResolvedValue(paymentsMock);
      (mockProvider as any).removePayment = vi.fn().mockResolvedValue({ success: true });

      const result = await billingService.cleanupFuturePaymentsFromPreviousSubscription({
        oldProviderSubscriptionId: 'sub_old',
        currentPeriodEnd: '2026-09-30T15:00:00.000Z',
        ministryId: 'min-100',
      });

      expect(result.success).toBe(true);
      expect(result.removedPaymentIds).toEqual(['pay_3', 'pay_4']);
      expect(result.skippedPaymentIds).toEqual(['pay_1', 'pay_2', 'pay_5', 'pay_6', 'pay_7']);

      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_3');
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_4');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_1');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_2');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_5');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_6');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_7');
    });

    it('Paid -> Paid com Cleanup: Remove cobrança futura pré-gerada antes de promover a nova assinatura', async () => {
      const activeLiteSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_lite_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-30T00:00:00.000Z',
        current_period_start: '2026-08-30T00:00:00.000Z',
        current_period_end: '2026-09-30T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-30T00:00:00.000Z',
        updated_at: '2026-08-30T00:00:00.000Z',
      };

      const planChange = {
        id: 'intent_lite_to_prem_clean',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_lite_to_prem_clean',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        previous_provider_subscription_id: 'sub_lite_old',
        status: 'pending',
        supersede_status: 'pending',
        renewal_cutoff_date: '2026-09-30',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(planChange);
      mockBillingRepo.getSubscription.mockResolvedValue(activeLiteSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({ id: 'min-100', plan_id: 'lite', billing_status: 'active' });

      (mockProvider as any).listSubscriptionPayments = vi.fn().mockResolvedValue([
        { id: 'pay_lite_past', status: 'PENDING', dueDate: '2026-09-15', subscriptionId: 'sub_lite_old' },
        { id: 'pay_lite_future', status: 'PENDING', dueDate: '2026-09-30', subscriptionId: 'sub_lite_old' },
        { id: 'pay_lite_overdue', status: 'OVERDUE', dueDate: '2026-09-30', subscriptionId: 'sub_lite_old' },
      ]);
      (mockProvider as any).removePayment = vi.fn().mockResolvedValue({ success: true });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_prem_paid_clean',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_prem_new',
        providerPaymentId: 'pay_prem_123',
        externalReference: 'intent_lite_to_prem_clean',
        amountCents: 21490,
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_prem_paid_clean' });

      expect(result.processed).toBe(true);
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_lite_old');
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_lite_future');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_lite_past');
      expect(mockProvider.removePayment).not.toHaveBeenCalledWith('pay_lite_overdue');

      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: 'premium',
          provider_subscription_id: 'sub_prem_new',
          status: 'active',
        })
      );

      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          supersede_status: 'completed',
          payment_cleanup_status: 'completed',
          payment_cleanup_ids: ['pay_lite_future'],
        })
      );
    });

    it('Paid -> Free com Cleanup: Inativa no Asaas, remove cobrança futura PENDING e agenda cancel_at_period_end', async () => {
      const activeBillingSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_paid_clean_free',
        provider_customer_id: 'cus_123',
        plan_id: 'pro',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 8990,
        status: 'active',
        started_at: '2026-08-30T00:00:00.000Z',
        current_period_start: '2026-08-30T00:00:00.000Z',
        current_period_end: '2026-09-30T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-30T00:00:00.000Z',
        updated_at: '2026-08-30T00:00:00.000Z',
      };
      mockBillingRepo.getSubscription.mockResolvedValue(activeBillingSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'pro',
        cancel_at_period_end: false,
      });

      (mockProvider as any).listSubscriptionPayments = vi.fn().mockResolvedValue([
        { id: 'pay_pro_future', status: 'PENDING', dueDate: '2026-09-30', subscriptionId: 'sub_paid_clean_free' },
      ]);
      (mockProvider as any).removePayment = vi.fn().mockResolvedValue({ success: true });

      const updated = await billingService.cancelSubscription('min-100');

      expect(updated.cancel_at_period_end).toBe(true);
      expect(mockProvider.inactivateSubscription).toHaveBeenCalledWith('sub_paid_clean_free');
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_pro_future');
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          cancel_at_period_end: true,
        })
      );
    });

    it('Falha ao Deletar Payment PENDING: Fica retryable e não promove assinatura nova', async () => {
      const activeLiteSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_lite_old',
        provider_customer_id: 'cus_123',
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'active',
        started_at: '2026-08-30T00:00:00.000Z',
        current_period_start: '2026-08-30T00:00:00.000Z',
        current_period_end: '2026-09-30T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-30T00:00:00.000Z',
        updated_at: '2026-08-30T00:00:00.000Z',
      };

      const planChange = {
        id: 'intent_lite_to_prem_fail_del',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_lite_to_prem_fail_del',
        requested_plan_id: 'premium',
        requested_interval: 'monthly',
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        previous_provider_subscription_id: 'sub_lite_old',
        status: 'pending',
        supersede_status: 'pending',
        renewal_cutoff_date: '2026-09-30',
      };

      mockBillingRepo.getPlanChangeByCheckoutIntentId.mockResolvedValue(planChange);
      mockBillingRepo.getSubscription.mockResolvedValue(activeLiteSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({ id: 'min-100', plan_id: 'lite', billing_status: 'active' });

      (mockProvider as any).listSubscriptionPayments = vi.fn().mockResolvedValue([
        { id: 'pay_lite_future', status: 'PENDING', dueDate: '2026-09-30', subscriptionId: 'sub_lite_old' },
      ]);
      (mockProvider as any).removePayment = vi.fn().mockRejectedValue(new Error('Gateway timeout'));
      (mockProvider as any).getPayment = vi.fn().mockResolvedValue({
        id: 'pay_lite_future',
        status: 'PENDING',
      });

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_prem_fail_del',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerSubscriptionId: 'sub_prem_new',
        providerPaymentId: 'pay_prem_123',
        externalReference: 'intent_lite_to_prem_fail_del',
        amountCents: 21490,
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_prem_fail_del' });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('supersede_inactivation_failed');
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();

      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'superseding',
          supersede_status: 'failed',
          payment_cleanup_status: 'failed',
        })
      );
    });

    it('Race Financeira (PENDING -> CONFIRMED): Marca financial_attention_required sem refund automático', async () => {
      (mockProvider as any).listSubscriptionPayments = vi.fn().mockResolvedValue([
        { id: 'pay_captured', status: 'PENDING', dueDate: '2026-09-30', subscriptionId: 'sub_old', amountCents: 1490 },
      ]);
      (mockProvider as any).removePayment = vi.fn().mockRejectedValue(new Error('Payment already confirmed'));
      (mockProvider as any).getPayment = vi.fn().mockResolvedValue({
        id: 'pay_captured',
        status: 'CONFIRMED',
        amountCents: 1490,
      });

      const cleanupResult = await billingService.cleanupFuturePaymentsFromPreviousSubscription({
        oldProviderSubscriptionId: 'sub_old',
        currentPeriodEnd: '2026-09-30T00:00:00.000Z',
        ministryId: 'min-100',
      });

      expect(cleanupResult.success).toBe(false);
      expect(cleanupResult.financialAttentionRequired).toBe(true);
      expect(cleanupResult.financialAttentionReason).toContain('foi paga (CONFIRMED) antes do cancelamento');
    });

    it('Recuperação via Worker: Processa transição com cleanup pendente com sucesso', async () => {
      const planChangeRecord = {
        id: 'intent_recover_clean',
        ministry_id: 'min-100',
        provider: 'asaas' as const,
        checkout_intent_id: 'intent_recover_clean',
        requested_plan_id: 'premium' as const,
        requested_interval: 'monthly' as const,
        requested_addon_blocks: 0,
        expected_amount_cents: 21490,
        currency: 'BRL' as const,
        previous_provider_subscription_id: 'sub_lite_old',
        new_provider_subscription_id: 'sub_prem_new',
        status: 'superseding' as const,
        supersede_status: 'failed' as const,
        payment_cleanup_status: 'failed' as const,
        renewal_cutoff_date: '2026-09-30',
        created_at: '2026-08-30T00:00:00.000Z',
        expires_at: null,
        updated_at: '2026-08-30T00:00:00.000Z',
      };

      mockBillingRepo.claimPlanChangeForRetry.mockResolvedValue(planChangeRecord);
      (mockProvider as any).listSubscriptionPayments = vi.fn().mockResolvedValue([
        { id: 'pay_lite_future', status: 'PENDING', dueDate: '2026-09-30', subscriptionId: 'sub_lite_old' },
      ]);
      (mockProvider as any).removePayment = vi.fn().mockResolvedValue({ success: true });

      const procResult = await billingService.processPlanChangeSupersede('intent_recover_clean', 'worker_test');

      expect(procResult.success).toBe(true);
      expect(mockProvider.removePayment).toHaveBeenCalledWith('pay_lite_future');
      expect(mockBillingRepo.setPlanChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          supersede_status: 'completed',
          payment_cleanup_status: 'completed',
          payment_cleanup_ids: ['pay_lite_future'],
        })
      );
    });

    it('Webhook PAYMENT_DELETED de assinatura antiga NÃO afeta sub_new nem altera status', async () => {
      const activeSub: BillingSubscriptionRecord = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        provider_subscription_id: 'sub_prem_new',
        plan_id: 'premium',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 21490,
        status: 'active',
        started_at: '2026-08-30T00:00:00.000Z',
        current_period_start: '2026-08-30T00:00:00.000Z',
        current_period_end: '2026-09-30T00:00:00.000Z',
        cancel_at_period_end: false,
        created_at: '2026-08-30T00:00:00.000Z',
        updated_at: '2026-08-30T00:00:00.000Z',
      };

      mockBillingRepo.getSubscription.mockResolvedValue(activeSub);
      mockBillingRepo.getSubscriptionByProviderSubscriptionId.mockResolvedValue(activeSub);

      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_pay_del_1',
        eventType: 'payment_deleted',
        rawEventType: 'PAYMENT_DELETED',
        providerSubscriptionId: 'sub_lite_old',
        providerPaymentId: 'pay_deleted_123',
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_pay_del_1' });

      expect(result.processed).toBe(true);
      // Assinatura ativa não foi alterada
      expect(mockBillingRepo.setSubscription).not.toHaveBeenCalled();
      expect(mockSubscriptionRepo.setSubscription).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 5. Geração de Callbacks Públicos e Autoridade de Retorno
  // --------------------------------------------------------------------------
  describe('5. Callbacks Públicos de Checkout e Fail-Closed', () => {
    it('deve gerar URLs públicas HTTPS apontando para /checkout-return e nunca localhost', async () => {
      const { config } = await import('../../config/unifiedConfig');
      const originalPublicUrl = config.billingPublicApiUrl;
      try {
        (config as any).billingPublicApiUrl = 'https://tunnel.trycloudflare.com';

        const result = await billingService.createCheckout('min-100', 'usr-1', {
          planId: 'essential',
          interval: 'monthly',
          addonBlocks: 0,
        });

        expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/c/chk_123');
        expect(mockProvider.createCheckout).toHaveBeenCalledWith(
          expect.objectContaining({
            successUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/success',
            cancelUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/cancel',
            expiredUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/expired',
          })
        );
      } finally {
        (config as any).billingPublicApiUrl = originalPublicUrl;
      }
    });

    it('FAIL-CLOSED: deve lançar erro se BILLING_PUBLIC_API_URL não estiver configurada', async () => {
      const { config } = await import('../../config/unifiedConfig');
      const originalPublicUrl = config.billingPublicApiUrl;
      try {
        (config as any).billingPublicApiUrl = undefined;

        await expect(
          billingService.createCheckout('min-100', 'usr-1', {
            planId: 'essential',
            interval: 'monthly',
            addonBlocks: 0,
          })
        ).rejects.toThrow('URL pública de callback do Billing não configurada');

        expect(mockProvider.createCheckout).not.toHaveBeenCalled();
      } finally {
        (config as any).billingPublicApiUrl = originalPublicUrl;
      }
    });

    it('FAIL-CLOSED: deve rejeitar se BILLING_PUBLIC_API_URL for localhost', async () => {
      const { config } = await import('../../config/unifiedConfig');
      const originalPublicUrl = config.billingPublicApiUrl;
      try {
        (config as any).billingPublicApiUrl = 'http://localhost:3000';

        await expect(
          billingService.createCheckout('min-100', 'usr-1', {
            planId: 'essential',
            interval: 'monthly',
            addonBlocks: 0,
          })
        ).rejects.toThrow('não pode ser localhost');

        expect(mockProvider.createCheckout).not.toHaveBeenCalled();
      } finally {
        (config as any).billingPublicApiUrl = originalPublicUrl;
      }
    });

    it('plano Free não requer callback público nem aciona o provedor de pagamento', async () => {
      const result = await billingService.createCheckout('min-100', 'usr-1', {
        planId: 'free',
        interval: 'monthly',
      });

      expect(result.checkoutUrl).toBe('/ministerio/plano');
      expect(result.totalPriceCents).toBe(0);
      expect(mockProvider.createCheckout).not.toHaveBeenCalled();
    });
  });
});
