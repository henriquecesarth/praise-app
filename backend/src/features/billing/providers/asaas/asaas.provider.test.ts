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

    it('F) listSubscriptionPayments: com status=PENDING envia status=PENDING na query URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [], hasMore: false }),
      });
      global.fetch = mockFetch as any;

      await provider.listSubscriptionPayments('sub_123', { status: 'PENDING' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=PENDING'),
        expect.anything()
      );

      global.fetch = originalFetch;
    });

    it('G) listSubscriptionPayments: com status=ALL não envia parâmetro status retornando cobranças de qualquer estado', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'pay_settled',
              subscription: 'sub_123',
              customer: 'cus_123',
              status: 'CONFIRMED',
              dueDate: '2026-09-02',
              value: 34.9,
              billingType: 'CREDIT_CARD',
            },
          ],
          hasMore: false,
        }),
      });
      global.fetch = mockFetch as any;

      const payments = await provider.listSubscriptionPayments('sub_123', { status: 'ALL' });
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe('CONFIRMED');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('status=');

      global.fetch = originalFetch;
    });

    it('H) getPayment: mapeia status RECEIVED e originalDueDate corretamente', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'pay_rec_123',
          subscription: 'sub_123',
          customer: 'cus_123',
          status: 'RECEIVED',
          dueDate: '2026-09-01',
          originalDueDate: '2026-09-02',
          value: 34.9,
          billingType: 'BOLETO',
        }),
      });
      global.fetch = mockFetch as any;

      const payment = await provider.getPayment('pay_rec_123');

      expect(payment).toEqual({
        id: 'pay_rec_123',
        subscriptionId: 'sub_123',
        customerId: 'cus_123',
        status: 'RECEIVED',
        dueDate: '2026-09-01',
        originalDueDate: '2026-09-02',
        amountCents: 3490,
        billingType: 'BOLETO',
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

  describe('Phase 3C.2 — createDetachedCheckout (Early Activation One-Off Adjustment)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('1. DETACHED payload: chargeTypes DETACHED, CREDIT_CARD only, no subscription block', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
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
            id: 'chk_detached_123',
            checkoutUrl: 'https://sandbox.asaas.com/c/chk_detached_123',
            expiresAt: '2026-09-15T18:00:00.000Z',
          }),
        };
      }) as any;

      const result = await provider.createDetachedCheckout({
        ministryId: 'min_777',
        checkoutIntentId: 'intent_min_777_ea_001',
        providerCustomerId: 'cus_asaas_888',
        amountCents: 2097, // R$ 20,97
        description: 'Ajuste Pró-Rata de Ativação Antecipada (pro)',
        minutesToExpire: 45,
        successUrl: 'https://app.louvaio.com.br/billing/success',
        cancelUrl: 'https://app.louvaio.com.br/billing/cancel',
        expiredUrl: 'https://app.louvaio.com.br/billing/expired',
      });

      expect(capturedUrl).toBe('https://sandbox.asaas.com/api/v3/checkouts');
      expect(capturedInit.method).toBe('POST');
      expect(capturedInit.headers.access_token).toBe('test_api_key');

      const body = JSON.parse(capturedInit.body);

      // Invariantes estritas de checkout avulso
      expect(body.chargeTypes).toEqual(['DETACHED']);
      expect(body.billingTypes).toEqual(['CREDIT_CARD']);
      expect(body.subscription).toBeUndefined(); // SEM bloco subscription!
      expect(body.minutesToExpire).toBe(45);
      expect(body.externalReference).toBe('intent_min_777_ea_001');
      expect(body.customer).toBe('cus_asaas_888');
      expect(body.customerData).toBeUndefined();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].value).toBe(20.97);
      expect(body.items[0].description).toBe('Ajuste Pró-Rata de Ativação Antecipada (pro)');
      expect(body.callback).toEqual({
        successUrl: 'https://app.louvaio.com.br/billing/success',
        cancelUrl: 'https://app.louvaio.com.br/billing/cancel',
        expiredUrl: 'https://app.louvaio.com.br/billing/expired',
      });

      expect(result.checkoutId).toBe('chk_detached_123');
      expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/checkoutSession/show?id=chk_detached_123');
      expect(result.expiresAt).toBe('2026-09-15T18:00:00.000Z');
    });

    it('2. Money serialization: integer cents -> exact decimal BRL', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const testCases = [
        { cents: 1, expectedBrl: 0.01 },
        { cents: 67, expectedBrl: 0.67 },
        { cents: 1000, expectedBrl: 10 },
        { cents: 2097, expectedBrl: 20.97 },
        { cents: 8990, expectedBrl: 89.9 },
      ];

      for (const tc of testCases) {
        let sentBody: any = null;
        global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
          sentBody = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'chk_test', checkoutUrl: 'https://test' }),
          };
        }) as any;

        await provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: tc.cents,
          description: 'Ajuste',
          minutesToExpire: 30,
          successUrl: 'https://app.louvaio.com.br/success',
        });

        expect(sentBody.items[0].value).toBe(tc.expectedBrl);
      }
    });

    it('3. Exclusão mútua: envia customerData quando providerCustomerId não fornecido', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      let sentBody: any = null;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        sentBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'chk_customer_data', checkoutUrl: 'https://test' }),
        };
      }) as any;

      await provider.createDetachedCheckout({
        ministryId: 'min_1',
        checkoutIntentId: 'intent_1',
        amountCents: 5000,
        description: 'Ajuste',
        minutesToExpire: 60,
        successUrl: 'https://app.louvaio.com.br/success',
        customerData: {
          name: 'João Silva',
          email: 'joao@exemplo.com',
          cpfCnpj: '12345678901',
          phone: '11999999999',
        },
      });

      expect(sentBody.customer).toBeUndefined();
      expect(sentBody.customerData).toEqual({
        name: 'João Silva',
        email: 'joao@exemplo.com',
        cpfCnpj: '12345678901',
        phone: '11999999999',
      });
    });

    it('4. Classificação de erro determinístico (HTTP 400 Bad Request): DEFINITE_NO_RESOURCE_CREATED', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            errors: [{ code: 'invalid_parameter', description: 'Parâmetro minutesToExpire inválido' }],
          }),
        };
      }) as any;

      let caughtError: any = null;
      try {
        await provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 5000,
          description: 'Ajuste',
          minutesToExpire: 60,
          successUrl: 'https://app.louvaio.com.br/success',
        });
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.statusCode).toBe(400);

      const classification = provider.classifyErrorOutcome(caughtError);
      expect(classification).toBe('DEFINITE_NO_RESOURCE_CREATED');
    });

    it('5. Classificação de erro incerto (timeout / 5xx): OUTCOME_UNCERTAIN', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      // Simulação 500 Server Error
      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 500,
          json: async () => ({ errors: [{ description: 'Internal server error' }] }),
        };
      }) as any;

      let serverError: any = null;
      try {
        await provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 5000,
          description: 'Ajuste',
          minutesToExpire: 60,
          successUrl: 'https://app.louvaio.com.br/success',
        });
      } catch (err: any) {
        serverError = err;
      }

      expect(provider.classifyErrorOutcome(serverError)).toBe('OUTCOME_UNCERTAIN');

      // Simulação Timeout de rede
      const timeoutError = new Error('connect ETIMEDOUT 104.26.12.31:443');
      expect(provider.classifyErrorOutcome(timeoutError)).toBe('OUTCOME_UNCERTAIN');

      // Whitelist explícita de códigos determinísticos contratualmente respaldados do endpoint POST /v3/checkouts:
      // Apenas 400 e 401 com resposta comprovadamente vinda do Asaas
      for (const sc of [400, 401]) {
        const err = new AppError(sc, `Erro ${sc}`);
        (err as any).statusCode = sc;
        (err as any).isProviderResponse = true;
        expect(provider.classifyErrorOutcome(err)).toBe('DEFINITE_NO_RESOURCE_CREATED');
      }

      // 400 sem origem comprovada do gateway (ex: erro local de parse): FAIL CLOSED
      const local400 = new AppError(400, 'Local validation error');
      expect(provider.classifyErrorOutcome(local400)).toBe('OUTCOME_UNCERTAIN');

      // Códigos 4xx que NÃO possuem comprovação contratual de ausência de recurso (403, 404, 422, 408, 409, 429, 418, 499):
      // FAIL CLOSED como OUTCOME_UNCERTAIN
      for (const sc of [403, 404, 408, 409, 422, 429, 418, 499]) {
        const err = new AppError(sc, `Erro ${sc}`);
        (err as any).statusCode = sc;
        (err as any).isProviderResponse = true;
        expect(provider.classifyErrorOutcome(err)).toBe('OUTCOME_UNCERTAIN');
      }
    });

    it('6. Recurring checkout payload permanece rigorosamente inalterado', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      let capturedInit: any = null;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'chk_rec', checkoutUrl: 'https://rec' }),
        };
      }) as any;

      await provider.createCheckout({
        ministryId: 'min_1',
        planId: 'pro',
        planName: 'Pro',
        interval: 'monthly',
        addonBlocks: 0,
        amountCents: 8990,
        successUrl: 'https://app.louvaio.com.br/success',
      });

      const body = JSON.parse(capturedInit.body);
      expect(body.chargeTypes).toEqual(['RECURRENT']);
      expect(body.subscription).toBeDefined();
      expect(body.subscription.cycle).toBe('MONTHLY');
    });

    it('7. DETACHED payload: minutesToExpire < 10 é rejeitado antes de emitir fetch', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });
      global.fetch = vi.fn();

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 9, // Inválido (< 10)
          successUrl: 'https://app.louvaio.com.br/success',
        })
      ).rejects.toThrow(/minutesToExpire deve estar entre 10 e 1440/);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('8. DETACHED payload: minutesToExpire exatamente 10 é aceito e transmitido no payload', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      let capturedInit: any = null;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'chk_ea_10m' }),
        };
      }) as any;

      const res = await provider.createDetachedCheckout({
        ministryId: 'min_1',
        checkoutIntentId: 'intent_1',
        amountCents: 2500,
        description: 'Ajuste 10m',
        minutesToExpire: 10,
        successUrl: 'https://app.louvaio.com.br/success',
      });

      const body = JSON.parse(capturedInit.body);
      expect(body.minutesToExpire).toBe(10);
      expect(body.chargeTypes).toEqual(['DETACHED']);
      expect(body.billingTypes).toEqual(['CREDIT_CARD']);
      expect(res.checkoutId).toBe('chk_ea_10m');
    });

    it('9. DETACHED payload: callback inválido ou ausente é rejeitado antes de emitir fetch', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });
      global.fetch = vi.fn();

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 15,
          successUrl: '', // Vazio
        })
      ).rejects.toThrow(/Callback inválido/);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('10. DETACHED response: parser funciona com shape mínimo oficial { id: "..." } e gera builder oficial Sandbox', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'chk_official_minimal_999' }), // apenas 'id'
        };
      }) as any;

      const res = await provider.createDetachedCheckout({
        ministryId: 'min_1',
        checkoutIntentId: 'intent_1',
        amountCents: 2500,
        description: 'Ajuste',
        minutesToExpire: 30,
        successUrl: 'https://app.louvaio.com.br/success',
      });

      expect(res.checkoutId).toBe('chk_official_minimal_999');
      // Conforme contrato oficial Asaas Sandbox:
      expect(res.checkoutUrl).toBe('https://sandbox.asaas.com/checkoutSession/show?id=chk_official_minimal_999');
      // NUNCA gera /c/{id}
      expect(res.checkoutUrl).not.toContain('/c/');
    });

    it('11. Produção: shape mínimo { id } gera builder oficial de produção (https://asaas.com/checkoutSession/show?id=...) ', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_prod_key',
        apiUrl: 'https://api.asaas.com/api/v3',
      });

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'chk_prod_live_888' }),
        };
      }) as any;

      const res = await provider.createDetachedCheckout({
        ministryId: 'min_prod',
        checkoutIntentId: 'intent_prod_1',
        amountCents: 5000,
        description: 'Ajuste Produção',
        minutesToExpire: 40,
        successUrl: 'https://app.louvaio.com.br/success',
      });

      expect(res.checkoutId).toBe('chk_prod_live_888');
      expect(res.checkoutUrl).toBe('https://asaas.com/checkoutSession/show?id=chk_prod_live_888');
      expect(res.checkoutUrl).not.toContain('/c/');
    });

    it('12. Link documentado: quando response.link for host oficial esperado, usa diretamente', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      const officialLink = 'https://sandbox.asaas.com/checkoutSession/show/chk_doc_link_123';
      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chk_doc_link_123',
            link: officialLink,
          }),
        };
      }) as any;

      const res = await provider.createDetachedCheckout({
        ministryId: 'min_1',
        checkoutIntentId: 'intent_1',
        amountCents: 2500,
        description: 'Ajuste',
        minutesToExpire: 30,
        successUrl: 'https://app.louvaio.com.br/success',
      });

      expect(res.checkoutId).toBe('chk_doc_link_123');
      expect(res.checkoutUrl).toBe(officialLink);
    });

    it('13. Host inesperado no response.link: FAIL CLOSED com erro INVALID_CHECKOUT_LINK_HOST', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chk_phishing_123',
            link: 'https://malicious-gateway.com/checkoutSession/show/123',
          }),
        };
      }) as any;

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 30,
          successUrl: 'https://app.louvaio.com.br/success',
        })
      ).rejects.toThrow(/Host inesperado no link de checkout/);
    });

    it('14. Resposta 200 sem id: lança erro estruturado com PROVIDER_RESPONSE_MISSING_ID', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ link: 'https://sandbox.asaas.com/c/some_link' }), // sem id
        };
      }) as any;

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 30,
          successUrl: 'https://app.louvaio.com.br/success',
        })
      ).rejects.toThrow(/Gateway Asaas não retornou ID de checkout/);
    });

    it('15. Chamada de checkout emite exatamente UM fetch (sem retries automáticos ocultos em 500, 429 ou timeout)', async () => {
      const provider = new AsaasBillingProvider({
        apiKey: 'test_api_key',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
      });

      // A) Timeout
      const fetchTimeoutMock = vi.fn().mockRejectedValue(new Error('AbortError: signal timed out'));
      global.fetch = fetchTimeoutMock;

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 30,
          successUrl: 'https://app.louvaio.com.br/success',
        })
      ).rejects.toThrow();

      expect(fetchTimeoutMock).toHaveBeenCalledTimes(1);

      // B) 500 Server Error
      const fetch500Mock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ errors: [{ description: 'Internal Server Error' }] }),
      });
      global.fetch = fetch500Mock;

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 30,
          successUrl: 'https://app.louvaio.com.br/success',
        })
      ).rejects.toThrow();

      expect(fetch500Mock).toHaveBeenCalledTimes(1);

      // C) 429 Rate Limit
      const fetch429Mock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ errors: [{ description: 'Too Many Requests' }] }),
      });
      global.fetch = fetch429Mock;

      await expect(
        provider.createDetachedCheckout({
          ministryId: 'min_1',
          checkoutIntentId: 'intent_1',
          amountCents: 2500,
          description: 'Ajuste',
          minutesToExpire: 30,
          successUrl: 'https://app.louvaio.com.br/success',
        })
      ).rejects.toThrow();

      expect(fetch429Mock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Phase 3D.2 — Strict Provider Read & Inactivation Contract', () => {
    const provider = new AsaasBillingProvider({
      apiKey: 'test_api_key',
      apiUrl: 'https://sandbox.asaas.com/api/v3',
    });

    describe('getSubscriptionState', () => {
      it('1. Retorna FOUND e status ACTIVE quando HTTP 200 com payload válido', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'sub_active_123',
            status: 'ACTIVE',
            value: 59.9,
            cycle: 'MONTHLY',
            nextDueDate: '2026-10-01',
            customer: 'cus_123',
          }),
        });

        const res = await provider.getSubscriptionState('sub_active_123');
        expect(res.outcome).toBe('FOUND');
        expect(res.status).toBe('ACTIVE');
        expect(res.httpStatus).toBe(200);
        expect(res.rawSubscription?.valueCents).toBe(5990);
      });

      it('2. Retorna FOUND e status INACTIVE quando HTTP 200 com status INACTIVE', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'sub_inactive_123',
            status: 'INACTIVE',
            value: 59.9,
            cycle: 'MONTHLY',
          }),
        });

        const res = await provider.getSubscriptionState('sub_inactive_123');
        expect(res.outcome).toBe('FOUND');
        expect(res.status).toBe('INACTIVE');
      });

      it('3. Retorna NOT_FOUND e não silencia HTTP 404', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ errors: [{ description: 'Subscription not found' }] }),
        });

        const res = await provider.getSubscriptionState('sub_nonexistent');
        expect(res.outcome).toBe('NOT_FOUND');
        expect(res.httpStatus).toBe(404);
      });

      it('4. Retorna AUTH_ERROR para HTTP 401 e 403', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ errors: [{ description: 'Invalid API Key' }] }),
        });

        const res401 = await provider.getSubscriptionState('sub_auth');
        expect(res401.outcome).toBe('AUTH_ERROR');
        expect(res401.httpStatus).toBe(401);

        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          json: async () => ({ errors: [{ description: 'Forbidden' }] }),
        });

        const res403 = await provider.getSubscriptionState('sub_auth');
        expect(res403.outcome).toBe('AUTH_ERROR');
        expect(res403.httpStatus).toBe(403);
      });

      it('5. Retorna TRANSIENT_ERROR para HTTP 500, 502 e timeout', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ errors: [{ description: 'Internal error' }] }),
        });

        const res500 = await provider.getSubscriptionState('sub_500');
        expect(res500.outcome).toBe('TRANSIENT_ERROR');
        expect(res500.httpStatus).toBe(500);

        global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
        const resTimeout = await provider.getSubscriptionState('sub_timeout');
        expect(resTimeout.outcome).toBe('TRANSIENT_ERROR');
        expect(resTimeout.errorMessage).toContain('timeout');
      });

      it('6. Retorna MALFORMED_RESPONSE quando JSON não contém status válido', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ no_status: true }),
        });

        const res = await provider.getSubscriptionState('sub_malformed');
        expect(res.outcome).toBe('MALFORMED_RESPONSE');
      });
    });

    describe('inactivateSubscriptionStrict', () => {
      it('7. Retorna SUCCESS quando HTTP 200', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: 'sub_inact', status: 'INACTIVE' }),
        });

        const res = await provider.inactivateSubscriptionStrict('sub_inact');
        expect(res.outcome).toBe('SUCCESS');
        expect(res.httpStatus).toBe(200);
      });

      it('8. Retorna NOT_FOUND quando HTTP 404 e NÃO silencia o erro', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ errors: [{ description: 'Subscription not found' }] }),
        });

        const res = await provider.inactivateSubscriptionStrict('sub_not_found');
        expect(res.outcome).toBe('NOT_FOUND');
        expect(res.httpStatus).toBe(404);
      });

      it('9. Retorna AUTH_ERROR quando HTTP 401 ou 403', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ errors: [{ description: 'Unauthorized' }] }),
        });

        const res = await provider.inactivateSubscriptionStrict('sub_auth');
        expect(res.outcome).toBe('AUTH_ERROR');
      });

      it('10. Retorna CLIENT_ERROR quando HTTP 400', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ errors: [{ description: 'Cannot inactivate subscription' }] }),
        });

        const res = await provider.inactivateSubscriptionStrict('sub_bad_request');
        expect(res.outcome).toBe('CLIENT_ERROR');
        expect(res.httpStatus).toBe(400);
      });

      it('11. Retorna TRANSIENT_ERROR quando HTTP 500 ou timeout', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ errors: [{ description: 'Service unavailable' }] }),
        });

        const res503 = await provider.inactivateSubscriptionStrict('sub_503');
        expect(res503.outcome).toBe('TRANSIENT_ERROR');

        global.fetch = vi.fn().mockRejectedValue(new Error('Connection reset'));
        const resTimeout = await provider.inactivateSubscriptionStrict('sub_net_err');
        expect(resTimeout.outcome).toBe('TRANSIENT_ERROR');
      });

      it('12. Preserva compatibilidade do método legacy inactivateSubscription tolerando 404', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ errors: [{ description: 'Subscription not found' }] }),
        });

        const legacyRes = await provider.inactivateSubscription('sub_legacy_404');
        expect(legacyRes.success).toBe(true);
      });
    });

    describe('listAllSubscriptionPaymentsStrict (Phase 3D.2 Hardening)', () => {
      it('1. Enumera exaustivamente todas as páginas com limit 50 até hasMore=false', async () => {
        const page1Items = Array.from({ length: 50 }, (_, i) => ({
          id: `pay_p1_${i}`,
          subscription: 'sub_page_test',
          customer: 'cus_page_test',
          status: 'PENDING',
          dueDate: '2026-10-01',
          value: 29.9,
          billingType: 'CREDIT_CARD',
        }));
        const page2Items = [
          {
            id: 'pay_p2_1',
            subscription: 'sub_page_test',
            customer: 'cus_page_test',
            status: 'PENDING',
            dueDate: '2026-11-01',
            value: 29.9,
            billingType: 'CREDIT_CARD',
          },
        ];

        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              data: page1Items,
              hasMore: true,
              totalCount: 51,
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              data: page2Items,
              hasMore: false,
              totalCount: 51,
            }),
          });
        global.fetch = mockFetch as any;

        const res = await provider.listAllSubscriptionPaymentsStrict('sub_page_test');
        expect(res.outcome).toBe('SUCCESS');
        expect(res.payments).toHaveLength(51);
        expect(res.payments![0].id).toBe('pay_p1_0');
        expect(res.payments![50].id).toBe('pay_p2_1');
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('2. Retorna NOT_FOUND quando HTTP 404 (preservando distinção estrita)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ errors: [{ description: 'Subscription not found' }] }),
        });

        const res = await provider.listAllSubscriptionPaymentsStrict('sub_not_found');
        expect(res.outcome).toBe('NOT_FOUND');
        expect(res.httpStatus).toBe(404);
      });

      it('3. Retorna AUTH_ERROR quando HTTP 401 ou 403', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ errors: [{ description: 'Unauthorized' }] }),
        });

        const res = await provider.listAllSubscriptionPaymentsStrict('sub_auth');
        expect(res.outcome).toBe('AUTH_ERROR');
      });

      it('4. Retorna TRANSIENT_ERROR quando HTTP 500 ou timeout de rede', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ errors: [{ description: 'Internal server error' }] }),
        });

        const res = await provider.listAllSubscriptionPaymentsStrict('sub_500');
        expect(res.outcome).toBe('TRANSIENT_ERROR');

        global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
        const resTimeout = await provider.listAllSubscriptionPaymentsStrict('sub_timeout');
        expect(resTimeout.outcome).toBe('TRANSIENT_ERROR');
      });

      it('5. Retorna MALFORMED_RESPONSE quando encontra cobrança duplicada com status conflitante entre páginas', async () => {
        const page1Items = [
          {
            id: 'pay_conflict_1',
            subscription: 'sub_conf',
            customer: 'cus_conf',
            status: 'PENDING',
            dueDate: '2026-10-01',
            value: 29.9,
            billingType: 'CREDIT_CARD',
          },
        ];
        const page2Items = [
          {
            id: 'pay_conflict_1',
            subscription: 'sub_conf',
            customer: 'cus_conf',
            status: 'CONFIRMED',
            dueDate: '2026-10-01',
            value: 29.9,
            billingType: 'CREDIT_CARD',
          },
        ];

        global.fetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: page1Items, hasMore: true }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: page2Items, hasMore: false }),
          });

        const res = await provider.listAllSubscriptionPaymentsStrict('sub_conf');
        expect(res.outcome).toBe('MALFORMED_RESPONSE');
      });

      it('6. Retorna MALFORMED_RESPONSE se payload do provedor for malformado ou item sem ID', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ no_id: true }] }),
        });

        const res = await provider.listAllSubscriptionPaymentsStrict('sub_bad');
        expect(res.outcome).toBe('MALFORMED_RESPONSE');
      });
    });
  });
});
