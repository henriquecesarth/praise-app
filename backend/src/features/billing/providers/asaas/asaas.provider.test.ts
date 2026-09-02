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

    it('deve lançar AppError 500 (fail-closed) ao tentar createCheckout quando apiKey não for configurada', async () => {
      const provider = new AsaasBillingProvider({ apiKey: undefined });

      await expect(
        provider.createCheckout({
          ministryId: 'min_test',
          planId: 'lite',
          planName: 'Lite',
          interval: 'monthly',
          addonBlocks: 0,
          amountCents: 1490,
        })
      ).rejects.toThrow('Gateway Asaas não configurado.');
    });

    it('deve lançar AppError 500 (fail-closed) ao tentar createCustomer quando apiKey não for configurada', async () => {
      const provider = new AsaasBillingProvider({ apiKey: undefined });

      await expect(
        provider.createCustomer({
          ministryId: 'min_test',
          ministryName: 'Ministério Teste',
        })
      ).rejects.toThrow('Gateway Asaas não configurado.');
    });

    it('deve lançar AppError 500 (fail-closed) ao tentar cancelSubscription quando apiKey não for configurada', async () => {
      const provider = new AsaasBillingProvider({ apiKey: undefined });

      await expect(
        provider.cancelSubscription('sub_123', false)
      ).rejects.toThrow('Gateway Asaas não configurado.');
    });

    it('deve lançar AppError 500 (fail-closed) ao tentar getSubscription quando apiKey não for configurada', async () => {
      const provider = new AsaasBillingProvider({ apiKey: undefined });

      await expect(
        provider.getSubscription('sub_123')
      ).rejects.toThrow('Gateway Asaas não configurado.');
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

  // --------------------------------------------------------------------------
  // 8. Operações de Inativação, Reativação e Remoção no Asaas
  // --------------------------------------------------------------------------
  describe('8. Operações no Gateway Asaas: Inativação (PUT INACTIVE), Reativação (PUT ACTIVE) e Remoção (DELETE)', () => {
    let provider: AsaasBillingProvider;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      provider = new AsaasBillingProvider({
        apiKey: 'test_api_key_123',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });
      originalFetch = global.fetch;
    });

    it('A) inactivateSubscription / cancelSubscription: envia PUT /subscriptions/:id com body { status: "INACTIVE" }', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'sub_old_123', status: 'INACTIVE' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.cancelSubscription('sub_old_123', true);

      expect(result.success).toBe(true);
      expect(result.canceledAtPeriodEnd).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://sandbox.asaas.com/api/v3/subscriptions/sub_old_123', {
        method: 'PUT',
        headers: {
          access_token: 'test_api_key_123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'INACTIVE' }),
      });

      global.fetch = originalFetch;
    });

    it('B) reactivateSubscription: envia PUT /subscriptions/:id com body { status: "ACTIVE", nextDueDate: "YYYY-MM-DD" }', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'sub_old_123', status: 'ACTIVE', nextDueDate: '2026-09-30' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.reactivateSubscription('sub_old_123', '2026-09-30');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://sandbox.asaas.com/api/v3/subscriptions/sub_old_123', {
        method: 'PUT',
        headers: {
          access_token: 'test_api_key_123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'ACTIVE', nextDueDate: '2026-09-30' }),
      });

      global.fetch = originalFetch;
    });

    it('C) HTTP Asaas fail: lança AppError e fecha com falha sem sucesso falso', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ errors: [{ description: 'Assinatura já inativa ou inválida' }] }),
      });
      global.fetch = mockFetch as any;

      await expect(provider.inactivateSubscription('sub_invalid')).rejects.toThrow(AppError);

      global.fetch = originalFetch;
    });

    it('D) removeSubscription: envia DELETE /subscriptions/:id quando remoção definitiva for solicitada', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true, id: 'sub_del_123' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.removeSubscription('sub_del_123');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://sandbox.asaas.com/api/v3/subscriptions/sub_del_123', {
        method: 'DELETE',
        headers: {
          access_token: 'test_api_key_123',
        },
      });

      global.fetch = originalFetch;
    });
  });

  describe('10. Operações de Cobrança Individual e Limpeza de Renovação Futura (listSubscriptionPayments, removePayment, getPayment)', () => {
    const provider = new AsaasBillingProvider({
      apiUrl: 'https://sandbox.asaas.com/api/v3',
      apiKey: 'test_api_key_123',
      webhookToken: 'test_token',
    });

    it('A) listSubscriptionPayments: consulta pagamentos da assinatura com paginação automática', async () => {
      const page1 = {
        hasMore: true,
        totalCount: 2,
        limit: 50,
        offset: 0,
        data: [
          {
            id: 'pay_1',
            subscription: 'sub_old_123',
            customer: 'cus_123',
            status: 'PENDING',
            dueDate: '2026-09-30',
            value: 14.9,
            billingType: 'CREDIT_CARD',
          },
        ],
      };

      const page2 = {
        hasMore: false,
        totalCount: 2,
        limit: 50,
        offset: 50,
        data: [
          {
            id: 'pay_2',
            subscription: 'sub_old_123',
            customer: 'cus_123',
            status: 'PENDING',
            dueDate: '2026-10-30',
            value: 14.9,
            billingType: 'CREDIT_CARD',
          },
        ],
      };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => page1,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => page2,
        });
      global.fetch = mockFetch as any;

      const payments = await provider.listSubscriptionPayments('sub_old_123', { status: 'PENDING' });

      expect(payments).toHaveLength(2);
      expect(payments[0]).toEqual({
        id: 'pay_1',
        subscriptionId: 'sub_old_123',
        customerId: 'cus_123',
        status: 'PENDING',
        dueDate: '2026-09-30',
        amountCents: 1490,
        billingType: 'CREDIT_CARD',
        externalReference: undefined,
      });
      expect(payments[1].id).toBe('pay_2');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      global.fetch = originalFetch;
    });

    it('B) listSubscriptionPayments: retorna array vazio em 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      global.fetch = mockFetch as any;

      const payments = await provider.listSubscriptionPayments('sub_not_found');
      expect(payments).toEqual([]);

      global.fetch = originalFetch;
    });

    it('C) removePayment: envia DELETE /v3/payments/:id sem body e com access_token', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true, id: 'pay_future_1' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.removePayment('pay_future_1');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://sandbox.asaas.com/api/v3/payments/pay_future_1', {
        method: 'DELETE',
        headers: {
          access_token: 'test_api_key_123',
        },
      });

      global.fetch = originalFetch;
    });

    it('D) removePayment: falha HTTP lança AppError fail-closed', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ errors: [{ description: 'Cobrança confirmada não pode ser removida' }] }),
      });
      global.fetch = mockFetch as any;

      await expect(provider.removePayment('pay_confirmed')).rejects.toThrow(AppError);

      global.fetch = originalFetch;
    });

    it('E) getPayment: consulta cobrança individual e mapeia status e amountCents', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'pay_123',
          subscription: 'sub_123',
          customer: 'cus_123',
          status: 'CONFIRMED',
          dueDate: '2026-09-30',
          value: 29.9,
          billingType: 'CREDIT_CARD',
        }),
      });
      global.fetch = mockFetch as any;

      const payment = await provider.getPayment('pay_123');

      expect(payment).toEqual({
        id: 'pay_123',
        subscriptionId: 'sub_123',
        customerId: 'cus_123',
        status: 'CONFIRMED',
        dueDate: '2026-09-30',
        amountCents: 2990,
        billingType: 'CREDIT_CARD',
        externalReference: undefined,
      });

      global.fetch = originalFetch;
    });
  });

  describe('8. Asaas Checkout Callback Payload & Localhost Rejection', () => {
    it('deve enviar callback público HTTPS para Asaas POST /v3/checkouts', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'chk_123', link: 'https://sandbox.asaas.com/c/chk_123' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.createCheckout({
        ministryId: 'min-100',
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 3490,
        successUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/success',
        cancelUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/cancel',
        expiredUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/expired',
      });

      expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/c/chk_123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://sandbox.asaas.com/api/v3/checkouts',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"callback":{"successUrl":"https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/success","cancelUrl":"https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/cancel","expiredUrl":"https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/expired"}'),
        })
      );

      global.fetch = originalFetch;
    });

    it('deve rejeitar se successUrl contiver localhost ou 127.0.0.1', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      await expect(
        provider.createCheckout({
          ministryId: 'min-100',
          planId: 'essential',
          planName: 'Essential',
          interval: 'monthly',
          addonBlocks: 0,
          amountCents: 3490,
          successUrl: 'http://localhost:5173/ministerio/plano?status=success',
        })
      ).rejects.toThrow('URL de callback do Asaas inválida ou aponta para localhost');
    });
  });

  describe('9. Asaas Customer & Checkout Payload Mutex (GAP-011)', () => {
    it('createCustomer: deve enviar externalReference = ministryId para POST /v3/customers', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'cus_new_12345' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.createCustomer({
        ministryId: 'min_abc_123',
        ministryName: 'Igreja Vida Nova',
        email: 'contato@vidanova.org',
        taxId: '12345678000199',
        phone: '11999998888',
      });

      expect(result).toEqual({ providerCustomerId: 'cus_new_12345' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://sandbox.asaas.com/api/v3/customers',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            access_token: 'test_api_key',
          }),
          body: JSON.stringify({
            name: 'Igreja Vida Nova',
            email: 'contato@vidanova.org',
            cpfCnpj: '12345678000199',
            phone: '11999998888',
            mobilePhone: '11999998888',
            externalReference: 'min_abc_123',
            notificationDisabled: false,
          }),
        })
      );

      global.fetch = originalFetch;
    });

    it('createCheckout com providerCustomerId: deve enviar payload com "customer" e omitir "customerData"', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'chk_sess_999', link: 'https://sandbox.asaas.com/c/chk_sess_999' }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.createCheckout({
        ministryId: 'min-100',
        providerCustomerId: 'cus_existing_777',
        planId: 'pro',
        planName: 'Pro',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 8990,
        successUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/success',
        cancelUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/cancel',
      });

      expect(result.checkoutId).toBe('chk_sess_999');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.customer).toBe('cus_existing_777');
      expect(calledBody.customerData).toBeUndefined();

      global.fetch = originalFetch;
    });

    it('createCheckout: garante exclusão mútua absoluta entre customer e customerData', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'chk_sess_888', link: 'https://sandbox.asaas.com/c/chk_sess_888' }),
      });
      global.fetch = mockFetch as any;

      // Passando providerCustomerId e customerData simultaneamente: providerCustomerId deve prevalecer e customerData deve ser omitido
      await provider.createCheckout({
        ministryId: 'min-100',
        providerCustomerId: 'cus_canonical_555',
        customerData: {
          name: 'Nome Sobrescrito',
          email: 'email@teste.com',
        },
        planId: 'lite',
        planName: 'Lite',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 1490,
        successUrl: 'https://tunnel.trycloudflare.com/api/v1/billing/checkout-return/success',
      });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.customer).toBe('cus_canonical_555');
      expect(calledBody.customerData).toBeUndefined();

      global.fetch = originalFetch;
    });

    it('findCustomerByExternalReference: retorna customer id quando cliente já existe no gateway', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'cus_existing_gateway_111',
              name: 'Ministério Alpha',
              externalReference: 'min_alpha',
              deleted: false,
            },
          ],
        }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.findCustomerByExternalReference('min_alpha');
      expect(result).toEqual({ providerCustomerId: 'cus_existing_gateway_111' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/customers?externalReference=min_alpha'),
        expect.objectContaining({
          headers: expect.objectContaining({ access_token: 'test_api_key' }),
        })
      );

      global.fetch = originalFetch;
    });

    it('findCustomerByExternalReference: retorna null quando nenhum cliente com o externalReference for encontrado', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });
      global.fetch = mockFetch as any;

      const result = await provider.findCustomerByExternalReference('min_nonexistent');
      expect(result).toBeNull();

      global.fetch = originalFetch;
    });
  });

  describe('AsaasBillingProvider — Hosted Checkout & Future Authorization Payload', () => {
    const originalFetch = global.fetch;

    it('deve enviar payload com chargeTypes=RECURRENT, billingTypes=CREDIT_CARD, cycle e nextDueDate para POST /v3/checkouts', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      let capturedUrl = '';
      let capturedInit: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chk_future_auth_123',
            link: 'https://sandbox.asaas.com/checkoutSession/show/chk_future_auth_123',
          }),
        };
      });
      global.fetch = mockFetch as any;

      const result = await provider.createCheckout({
        ministryId: 'min_test_payload',
        checkoutIntentId: 'intent_fut_456',
        providerCustomerId: 'cus_can_789',
        planId: 'pro',
        planName: 'Pro',
        interval: 'monthly',
        addonBlocks: 2,
        amountCents: 10970, // R$ 89,90 + 2 * R$ 9,90 = 109,70
        successUrl: 'https://app.louvaio.com.br/billing/success',
        nextDueDate: '2026-10-02',
      });

      expect(result.checkoutId).toBe('chk_future_auth_123');
      expect(capturedUrl).toBe('https://sandbox.asaas.com/api/v3/checkouts');
      expect(capturedInit.method).toBe('POST');
      expect(capturedInit.headers.access_token).toBe('test_api_key');

      const body = JSON.parse(capturedInit.body);
      expect(body.chargeTypes).toEqual(['RECURRENT']);
      expect(body.billingTypes).toEqual(['CREDIT_CARD']);
      expect(body.customer).toBe('cus_can_789');
      expect(body.externalReference).toBe('intent_fut_456');
      expect(body.items[0].value).toBe(109.7);
      expect(body.subscription).toEqual({
        cycle: 'MONTHLY',
        nextDueDate: '2026-10-02',
      });

      global.fetch = originalFetch;
    });

    it('deve consultar cobranças vinculadas ao checkout via GET /v3/payments?checkoutSession=<checkoutId>', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      let capturedUrl = '';
      let capturedInit: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'pay_chk_123',
                customer: 'cus_can_789',
                subscription: 'sub_tgt_from_checkout_payment',
                value: 109.7,
                dueDate: '2026-10-02',
                status: 'PENDING',
                billingType: 'CREDIT_CARD',
                externalReference: 'intent_fut_456',
              },
            ],
            hasMore: false,
            totalCount: 1,
          }),
        };
      });
      global.fetch = mockFetch as any;

      const payments = await provider.listPaymentsByCheckoutSession('chk_future_auth_123');
      expect(capturedUrl).toContain('/payments?checkoutSession=chk_future_auth_123');
      expect(capturedInit.headers.access_token).toBe('test_api_key');
      expect(payments).toHaveLength(1);
      expect(payments[0].id).toBe('pay_chk_123');
      expect(payments[0].subscriptionId).toBe('sub_tgt_from_checkout_payment');
      expect(payments[0].amountCents).toBe(10970);
      expect(payments[0].dueDate).toBe('2026-10-02');
      expect(payments[0].status).toBe('PENDING');

      global.fetch = originalFetch;
    });
  });

  describe('16. Phase 3B.2 Provider Adapter Contract — Cutover & Pending Cleanup', () => {
    const originalFetch = global.fetch;

    it('A) inactivateSubscription: envia PUT /v3/subscriptions/{id} com status INACTIVE e SEM updatePendingPayments', async () => {
      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_api_key',
        webhookToken: 'test_token',
      });

      let capturedUrl = '';
      let capturedInit: any = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'sub_src_123', status: 'INACTIVE' }),
        };
      }) as any;

      const result = await provider.inactivateSubscription('sub_src_123');
      expect(result.success).toBe(true);
      expect(capturedUrl).toBe('https://sandbox.asaas.com/api/v3/subscriptions/sub_src_123');
      expect(capturedInit.method).toBe('PUT');
      expect(capturedInit.headers.access_token).toBe('test_api_key');
      expect(capturedInit.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(capturedInit.body);
      expect(body).toEqual({ status: 'INACTIVE' });
      expect(body.updatePendingPayments).toBeUndefined();

      global.fetch = originalFetch;
    });

    it('B) listSubscriptionPayments: envia GET /v3/subscriptions/{id}/payments?offset=0&limit=50&status=PENDING', async () => {
      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_api_key',
        webhookToken: 'test_token',
      });

      let capturedUrl = '';
      let capturedInit: any = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'pay_src_pend_1',
                customer: 'cus_123',
                subscription: 'sub_src_123',
                value: 34.9,
                dueDate: '2026-10-01',
                status: 'PENDING',
                billingType: 'CREDIT_CARD',
              },
            ],
            hasMore: false,
            totalCount: 1,
          }),
        };
      }) as any;

      const payments = await provider.listSubscriptionPayments('sub_src_123', { status: 'PENDING' });
      expect(capturedUrl).toBe('https://sandbox.asaas.com/api/v3/subscriptions/sub_src_123/payments?offset=0&limit=50&status=PENDING');
      expect(capturedInit.headers.access_token).toBe('test_api_key');
      expect(payments).toHaveLength(1);
      expect(payments[0].id).toBe('pay_src_pend_1');
      expect(payments[0].status).toBe('PENDING');

      global.fetch = originalFetch;
    });

    it('C) removePayment: envia DELETE /v3/payments/{id} sem body e com access_token', async () => {
      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_api_key',
        webhookToken: 'test_token',
      });

      let capturedUrl = '';
      let capturedInit: any = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ deleted: true, id: 'pay_src_pend_1' }),
        };
      }) as any;

      const result = await provider.removePayment('pay_src_pend_1');
      expect(result.success).toBe(true);
      expect(capturedUrl).toBe('https://sandbox.asaas.com/api/v3/payments/pay_src_pend_1');
      expect(capturedInit.method).toBe('DELETE');
      expect(capturedInit.headers.access_token).toBe('test_api_key');

      global.fetch = originalFetch;
    });

    it('D) listSubscriptionPayments com status: "ALL": omite o parâmetro status da URL para recuperar todas as cobranças da assinatura', async () => {
      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_api_key',
        webhookToken: 'test_token',
      });

      let capturedUrl = '';
      let capturedInit: any = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'pay_all_1',
                customer: 'cus_123',
                subscription: 'sub_src_123',
                value: 34.9,
                dueDate: '2026-10-01',
                status: 'CONFIRMED',
                billingType: 'CREDIT_CARD',
              },
            ],
            hasMore: false,
            totalCount: 1,
          }),
        };
      }) as any;

      const payments = await provider.listSubscriptionPayments('sub_src_123', { status: 'ALL' });
      expect(capturedUrl).toBe('https://sandbox.asaas.com/api/v3/subscriptions/sub_src_123/payments?offset=0&limit=50');
      expect(capturedUrl).not.toContain('status=');
      expect(capturedInit.headers.access_token).toBe('test_api_key');
      expect(payments).toHaveLength(1);
      expect(payments[0].id).toBe('pay_all_1');
      expect(payments[0].status).toBe('CONFIRMED');

      global.fetch = originalFetch;
    });
  });
});
