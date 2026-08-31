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

describe('BillingService & Gateway Automation Tests', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockProvider: BillingProvider;

  beforeEach(() => {
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
      saveTransaction: vi.fn(),
      getTransactions: vi.fn(),
      getWebhookEvent: vi.fn(),
      getRecentPendingSubscription: vi.fn().mockResolvedValue(null),
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
      cancelSubscription: vi.fn().mockResolvedValue({ success: true, canceledAtPeriodEnd: true }),
      reactivateSubscription: vi.fn().mockResolvedValue({ success: true }),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
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

    it('deve gerar link de checkout e persistir assinatura pendente para plano pago', async () => {
      const result = await billingService.createCheckout('min-100', 'usr-1', {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 1,
        successUrl: 'https://louvaio.com/billing/success',
        cancelUrl: 'https://louvaio.com/billing/cancel',
      });

      expect(mockProvider.createCheckout).toHaveBeenCalledWith({
        ministryId: 'min-100',
        checkoutIntentId: expect.stringMatching(/^intent_min-100_/),
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 1,
        amountCents: 3490 + 990, // R$ 44,80
        successUrl: 'https://louvaio.com/billing/success',
        cancelUrl: 'https://louvaio.com/billing/cancel',
      });

      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          ministry_id: 'min-100',
          plan_id: 'essential',
          status: 'pending',
          provider_checkout_id: 'chk_123',
          provider_subscription_id: null,
          amount_cents: 4480,
          member_addon_blocks: 1,
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

    it('deve correlacionar SUBSCRIPTION_CREATED com checkout pendente via providerCheckoutId e persistir provider_subscription_id real', async () => {
      vi.spyOn(mockProvider, 'parseWebhookEvent').mockReturnValue({
        providerEventId: 'evt_sub_created',
        eventType: 'subscription_created',
        rawEventType: 'SUBSCRIPTION_CREATED',
        providerSubscriptionId: 'sub_asaas_real_123',
        providerCheckoutId: 'chk_session_123',
        providerCustomerId: 'cus_new_456',
        amountCents: 1490,
      });

      const pendingSub = {
        id: 'min-100_asaas',
        ministry_id: 'min-100',
        provider: 'asaas',
        checkout_intent_id: 'intent_min-100_123',
        provider_checkout_id: 'chk_session_123',
        provider_subscription_id: null,
        provider_customer_id: null,
        plan_id: 'lite',
        interval: 'monthly',
        member_addon_blocks: 0,
        amount_cents: 1490,
        status: 'pending',
      };

      mockBillingRepo.getSubscriptionByProviderSubscriptionId.mockResolvedValue(null);
      mockBillingRepo.getSubscriptionByCheckoutId.mockResolvedValue(pendingSub);
      mockSubscriptionRepo.getSubscription.mockResolvedValue({
        id: 'min-100',
        plan_id: 'free',
        billing_status: 'active',
      });

      const result = await billingService.handleWebhook({}, { id: 'evt_sub_created' });

      expect(result.processed).toBe(true);
      expect(mockBillingRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          ministry_id: 'min-100',
          provider_checkout_id: 'chk_session_123',
          provider_subscription_id: 'sub_asaas_real_123',
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
      expect(mockProvider.cancelSubscription).toHaveBeenCalledWith('sub_123', true);
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
      expect(mockProvider.reactivateSubscription).toHaveBeenCalledWith('sub_123');
      expect(mockSubscriptionRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          cancel_at_period_end: false,
        })
      );
    });
  });
});
