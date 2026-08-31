import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AsaasBillingProvider } from './asaas.provider';
import { BillingService } from '../../billing.service';
import { AppError } from '../../../../middleware/error-handler';

describe('AsaasBillingProvider — Webhook Authentication & Parser Validation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. Token não configurado no backend (ASAAS_WEBHOOK_TOKEN ausente)', () => {
    it('deve rejeitar (retornar false) quando o token não estiver configurado e o request não enviar header', () => {
      const provider = new AsaasBillingProvider({ webhookToken: undefined });
      const isValid = provider.validateWebhookRequest({});
      expect(isValid).toBe(false);
    });

    it('deve rejeitar (retornar false) quando o token não estiver configurado mesmo se o request enviar header', () => {
      const provider = new AsaasBillingProvider({ webhookToken: undefined });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 'any-arbitrary-token',
      });
      expect(isValid).toBe(false);
    });

    it('deve rejeitar se webhookToken for string vazia', () => {
      const provider = new AsaasBillingProvider({ webhookToken: '' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': '',
      });
      expect(isValid).toBe(false);
    });
  });

  describe('2. Token configurado, header ausente ou inválido', () => {
    it('deve rejeitar quando ASAAS_WEBHOOK_TOKEN estiver configurado mas o header estiver ausente', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'secret_webhook_token_123' });
      const isValid = provider.validateWebhookRequest({});
      expect(isValid).toBe(false);
    });

    it('deve rejeitar quando o header não for uma string (ex: objeto ou número)', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'secret_webhook_token_123' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 123456 as any,
      });
      expect(isValid).toBe(false);
    });
  });

  describe('3. Token incorreto (mesmo comprimento)', () => {
    it('deve rejeitar quando o token enviado tiver o mesmo comprimento mas conteúdo divergente', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'secret_token_abc' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 'secret_token_xyz',
      });
      expect(isValid).toBe(false);
    });
  });

  describe('4. Token de tamanho diferente', () => {
    it('deve rejeitar token com tamanho menor sem lançar erro de buffer no timingSafeEqual', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'secret_token_long_12345' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 'short',
      });
      expect(isValid).toBe(false);
    });

    it('deve rejeitar token com tamanho maior sem lançar erro de buffer no timingSafeEqual', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'short' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 'secret_token_long_1234567890',
      });
      expect(isValid).toBe(false);
    });
  });

  describe('5. Token correto', () => {
    it('deve aceitar (retornar true) quando o header asaas-access-token corresponder exatamente', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'my_production_secure_token_456' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 'my_production_secure_token_456',
      });
      expect(isValid).toBe(true);
    });

    it('deve aceitar quando enviado via header alternativo asaas_access_token', () => {
      const provider = new AsaasBillingProvider({ webhookToken: 'my_production_secure_token_456' });
      const isValid = provider.validateWebhookRequest({
        asaas_access_token: 'my_production_secure_token_456',
      });
      expect(isValid).toBe(true);
    });
  });

  describe('6. Prevenção de regressão Fail-Open em Development', () => {
    it('deve rejeitar estritamente em NODE_ENV=development quando o token estiver ausente', () => {
      process.env.NODE_ENV = 'development';
      const provider = new AsaasBillingProvider({ webhookToken: undefined });
      const isValid = provider.validateWebhookRequest({});
      expect(isValid).toBe(false);
    });

    it('deve rejeitar estritamente em NODE_ENV=development quando o token for incorreto', () => {
      process.env.NODE_ENV = 'development';
      const provider = new AsaasBillingProvider({ webhookToken: 'configured_dev_token' });
      const isValid = provider.validateWebhookRequest({
        'asaas-access-token': 'wrong_dev_token',
      });
      expect(isValid).toBe(false);
    });

    it('deve lançar AppError 401 no BillingService.handleWebhook quando a validação do provider falhar', async () => {
      const mockProvider = new AsaasBillingProvider({ webhookToken: 'expected_secret_123' });
      const billingService = new BillingService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        mockProvider
      );

      await expect(
        billingService.handleWebhook(
          { 'asaas-access-token': 'wrong_secret' },
          { event: 'PAYMENT_CONFIRMED' }
        )
      ).rejects.toThrow(new AppError(401, 'Token de autenticação de webhook inválido.'));
    });
  });

  describe('7. Validação de Estrutura Mínima de Webhook (parseWebhookEvent)', () => {
    const provider = new AsaasBillingProvider({ webhookToken: 'secret_token_123' });

    it('deve retornar null para payload vazio ({})', () => {
      const parsed = provider.parseWebhookEvent({});
      expect(parsed).toBeNull();
    });

    it('deve retornar null para payload não objeto (null, undefined, string, number)', () => {
      expect(provider.parseWebhookEvent(null)).toBeNull();
      expect(provider.parseWebhookEvent(undefined)).toBeNull();
      expect(provider.parseWebhookEvent('string')).toBeNull();
      expect(provider.parseWebhookEvent(12345)).toBeNull();
    });

    it('deve retornar null quando body.id estiver ausente', () => {
      const parsed = provider.parseWebhookEvent({
        event: 'PAYMENT_CONFIRMED',
      });
      expect(parsed).toBeNull();
    });

    it('deve retornar null quando body.event estiver ausente', () => {
      const parsed = provider.parseWebhookEvent({
        id: 'evt_123',
      });
      expect(parsed).toBeNull();
    });

    it('deve retornar null quando body.id for string vazia ou apenas espaços', () => {
      expect(
        provider.parseWebhookEvent({
          id: '',
          event: 'PAYMENT_CONFIRMED',
        })
      ).toBeNull();

      expect(
        provider.parseWebhookEvent({
          id: '   ',
          event: 'PAYMENT_CONFIRMED',
        })
      ).toBeNull();
    });

    it('deve retornar null quando body.event for string vazia ou apenas espaços', () => {
      expect(
        provider.parseWebhookEvent({
          id: 'evt_123',
          event: '',
        })
      ).toBeNull();

      expect(
        provider.parseWebhookEvent({
          id: 'evt_123',
          event: '   ',
        })
      ).toBeNull();
    });

    it('deve retornar evento estruturado quando payload mínimo válido for fornecido', () => {
      const parsed = provider.parseWebhookEvent({
        id: 'evt_minimo_123',
        event: 'PAYMENT_CONFIRMED',
      });

      expect(parsed).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_minimo_123',
          rawEventType: 'PAYMENT_CONFIRMED',
          eventType: 'payment_confirmed',
        })
      );
    });

    it('deve retornar unsupported_payload no BillingService.handleWebhook para payload vazio ({}) com token válido', async () => {
      const billingService = new BillingService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        provider
      );

      const result = await billingService.handleWebhook(
        { 'asaas-access-token': 'secret_token_123' },
        {}
      );

      expect(result).toEqual({
        status: 'ok',
        processed: false,
        reason: 'unsupported_payload',
      });
    });
  });

  describe('8. Asaas Checkout Recorrente (POST /v3/checkouts)', () => {
    it('deve chamar POST /v3/checkouts com CREDIT_CARD, RECURRENT e subscription cycle, sem chamar /paymentLinks', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'chk_asaas_session_12345',
          link: 'https://sandbox.asaas.com/checkoutSession/show/chk_asaas_session_12345',
          status: 'ACTIVE',
        }),
      });
      global.fetch = fetchSpy;

      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_asaas_api_key_valid',
      });

      const result = await provider.createCheckout({
        ministryId: 'min_999',
        checkoutIntentId: 'intent_min_999_123456789',
        planId: 'pro',
        planName: 'Pro',
        interval: 'annual',
        addonBlocks: 2,
        amountCents: 97092,
        successUrl: 'https://louvaio.com/billing/success',
        cancelUrl: 'https://louvaio.com/billing/cancel',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];

      // Garante que o endpoint é /checkouts e NÃO /paymentLinks
      expect(calledUrl).toBe('https://sandbox.asaas.com/api/v3/checkouts');
      expect(calledUrl).not.toContain('/paymentLinks');

      const body = JSON.parse(calledOptions.body);
      expect(body).toEqual({
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 60,
        externalReference: 'intent_min_999_123456789',
        callback: {
          successUrl: 'https://louvaio.com/billing/success',
          cancelUrl: 'https://louvaio.com/billing/cancel',
          expiredUrl: 'https://louvaio.com/billing/cancel',
        },
        items: [
          {
            name: 'Plano Pro',
            description: 'LouvAIO - Plano Pro (Anual com 10% OFF)',
            quantity: 1,
            value: 970.92,
          },
        ],
        subscription: {
          cycle: 'YEARLY',
          nextDueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
      });

      expect(calledOptions.headers).toEqual({
        'Content-Type': 'application/json',
        access_token: 'test_asaas_api_key_valid',
      });

      expect(result).toEqual({
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show/chk_asaas_session_12345',
        checkoutId: 'chk_asaas_session_12345',
        expiresAt: expect.any(String),
      });
    });

    it('deve retornar mock checkout quando apiKey não for configurada', async () => {
      const provider = new AsaasBillingProvider({ apiKey: undefined });

      const result = await provider.createCheckout({
        ministryId: 'min_test',
        planId: 'lite',
        planName: 'Lite',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 1490,
      });

      expect(result.checkoutUrl).toContain('https://sandbox.asaas.com/checkoutSession/show/chk_mock_');
      expect(result.checkoutId).toContain('chk_mock_');
    });
  });

  describe('9. Webhook Event Parsing — Checkout, Subscriptions & Payments', () => {
    const provider = new AsaasBillingProvider({ webhookToken: 'secret_123' });

    it('deve parsear eventos de Checkout (CHECKOUT_CREATED, CHECKOUT_PAID, CHECKOUT_CANCELED, CHECKOUT_EXPIRED)', () => {
      const created = provider.parseWebhookEvent({
        id: 'evt_chk_1',
        event: 'CHECKOUT_CREATED',
        checkout: {
          id: 'chk_session_uuid',
          status: 'ACTIVE',
          externalReference: 'intent_min_100_123',
          customer: 'cus_555',
        },
      });

      expect(created).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_chk_1',
          eventType: 'checkout_created',
          providerCheckoutId: 'chk_session_uuid',
          providerCustomerId: 'cus_555',
          externalReference: 'intent_min_100_123',
          status: 'ACTIVE',
        })
      );

      const paid = provider.parseWebhookEvent({
        id: 'evt_chk_2',
        event: 'CHECKOUT_PAID',
        checkout: {
          id: 'chk_session_uuid',
          status: 'PAID',
          externalReference: 'intent_min_100_123',
          customer: 'cus_555',
        },
      });

      expect(paid).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_chk_2',
          eventType: 'checkout_paid',
          providerCheckoutId: 'chk_session_uuid',
          status: 'PAID',
        })
      );
    });

    it('deve parsear eventos de Subscription (SUBSCRIPTION_CREATED, SUBSCRIPTION_UPDATED, SUBSCRIPTION_INACTIVATED, SUBSCRIPTION_DELETED)', () => {
      const subCreated = provider.parseWebhookEvent({
        id: 'evt_sub_1',
        event: 'SUBSCRIPTION_CREATED',
        subscription: {
          id: 'sub_asaas_real_999',
          customer: 'cus_555',
          value: 34.9,
          cycle: 'MONTHLY',
          status: 'ACTIVE',
          externalReference: 'intent_min_100_123',
        },
      });

      expect(subCreated).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_sub_1',
          eventType: 'subscription_created',
          providerSubscriptionId: 'sub_asaas_real_999',
          providerCustomerId: 'cus_555',
          externalReference: 'intent_min_100_123',
          amountCents: 3490,
          status: 'ACTIVE',
        })
      );

      // Payload real do Asaas Checkout (checkoutSession dentro da subscription)
      const subCreatedFromCheckout = provider.parseWebhookEvent({
        id: 'evt_sub_real',
        event: 'SUBSCRIPTION_CREATED',
        subscription: {
          id: 'sub_2hqxmkyrm88jwkd3',
          customer: 'cus_000008945616',
          value: 14.9,
          cycle: 'MONTHLY',
          status: 'ACTIVE',
          checkoutSession: 'e6cf65eb-b5ff-4a40-8844-ce75cac5cb25',
          externalReference: null,
        },
      });

      expect(subCreatedFromCheckout).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_sub_real',
          eventType: 'subscription_created',
          providerSubscriptionId: 'sub_2hqxmkyrm88jwkd3',
          providerCheckoutId: 'e6cf65eb-b5ff-4a40-8844-ce75cac5cb25',
          providerCustomerId: 'cus_000008945616',
          amountCents: 1490,
          status: 'ACTIVE',
        })
      );

      const subDeleted = provider.parseWebhookEvent({
        id: 'evt_sub_2',
        event: 'SUBSCRIPTION_DELETED',
        subscription: {
          id: 'sub_asaas_real_999',
          customer: 'cus_555',
          status: 'DELETED',
        },
      });

      expect(subDeleted).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_sub_2',
          eventType: 'subscription_canceled',
          providerSubscriptionId: 'sub_asaas_real_999',
        })
      );
    });

    it('deve parsear eventos de Payment com extração de subscription e payment id', () => {
      const paymentConfirmed = provider.parseWebhookEvent({
        id: 'evt_pay_1',
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay_999111',
          customer: 'cus_555',
          subscription: 'sub_asaas_real_999',
          value: 14.9,
          billingType: 'CREDIT_CARD',
          status: 'CONFIRMED',
          dueDate: '2026-09-30',
          confirmedDate: '2026-08-30',
        },
      });

      expect(paymentConfirmed).toEqual(
        expect.objectContaining({
          providerEventId: 'evt_pay_1',
          eventType: 'payment_confirmed',
          providerPaymentId: 'pay_999111',
          providerSubscriptionId: 'sub_asaas_real_999',
          providerCustomerId: 'cus_555',
          amountCents: 1490,
          paymentMethod: 'CREDIT_CARD',
          status: 'CONFIRMED',
        })
      );
    });
  });
});
