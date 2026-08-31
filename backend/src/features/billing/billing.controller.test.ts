import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/error-handler';

describe('BillingController Tests', () => {
  let controller: BillingController;
  let mockBillingService: any;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockBillingService = {
      getCheckoutPreview: vi.fn(),
      createCheckout: vi.fn(),
      cancelSubscription: vi.fn(),
      reactivateSubscription: vi.fn(),
      getBillingHistory: vi.fn(),
      handleWebhook: vi.fn(),
    };

    controller = new BillingController(mockBillingService as unknown as BillingService);

    mockReq = {
      params: { ministryId: 'min-100' },
      query: {},
      body: {},
      headers: {},
      user: { id: 'usr-1', email: 'admin@louvaio.com' },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/v1/ministries/:ministryId/billing/preview', () => {
    it('deve chamar getCheckoutPreview com os parâmetros da query string', async () => {
      mockReq.query = { planId: 'pro', interval: 'annual', addonBlocks: '2' };
      mockBillingService.getCheckoutPreview.mockResolvedValue({
        planId: 'pro',
        totalPriceCents: 97092 + 2 * 7452,
      });

      await controller.getCheckoutPreview(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockBillingService.getCheckoutPreview).toHaveBeenCalledWith('min-100', 'pro', 'annual', 2);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'pro',
        })
      );
    });
  });

  describe('POST /api/v1/ministries/:ministryId/billing/checkout', () => {
    it('deve rejeitar se o usuário não estiver autenticado', async () => {
      mockReq.user = undefined;
      mockReq.body = { planId: 'essential', interval: 'monthly' };

      await controller.createCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
    });

    it('deve rejeitar se planId não for fornecido', async () => {
      mockReq.body = { interval: 'monthly' };

      await controller.createCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(400);
    });

    it('deve criar checkout com status 201 quando dados são válidos', async () => {
      mockReq.body = {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 1,
        successUrl: 'https://louvaio.com/sucesso',
      };
      mockBillingService.createCheckout.mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_123',
        checkoutId: 'chk_123',
        totalPriceCents: 4480,
      });

      await controller.createCheckout(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockBillingService.createCheckout).toHaveBeenCalledWith('min-100', 'usr-1', {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 1,
        successUrl: 'https://louvaio.com/sucesso',
        cancelUrl: undefined,
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checkoutUrl: 'https://sandbox.asaas.com/c/chk_123',
          totalPriceCents: 4480,
        })
      );
    });
  });

  describe('POST /api/v1/ministries/:ministryId/billing/cancel', () => {
    it('deve agendar cancelamento e retornar mensagem explicativa', async () => {
      mockBillingService.cancelSubscription.mockResolvedValue({
        cancel_at_period_end: true,
      });

      await controller.cancelSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockBillingService.cancelSubscription).toHaveBeenCalledWith('min-100');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cancelamento agendado para o final do período vigente.',
        })
      );
    });
  });

  describe('POST /api/v1/ministries/:ministryId/billing/reactivate', () => {
    it('deve reativar assinatura e retornar mensagem de sucesso', async () => {
      mockBillingService.reactivateSubscription.mockResolvedValue({
        cancel_at_period_end: false,
      });

      await controller.reactivateSubscription(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockBillingService.reactivateSubscription).toHaveBeenCalledWith('min-100');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Assinatura reativada com sucesso.',
        })
      );
    });
  });

  describe('GET /api/v1/ministries/:ministryId/billing/history', () => {
    it('deve retornar a lista de transações do ministério', async () => {
      mockBillingService.getBillingHistory.mockResolvedValue([
        { id: 'tx-1', amount_cents: 3490, status: 'paid' },
      ]);

      await controller.getBillingHistory(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockBillingService.getBillingHistory).toHaveBeenCalledWith('min-100');
      expect(mockRes.json).toHaveBeenCalledWith({
        transactions: [{ id: 'tx-1', amount_cents: 3490, status: 'paid' }],
      });
    });
  });

  describe('POST /api/v1/billing/webhooks/asaas', () => {
    it('deve repassar headers e body para handleWebhook', async () => {
      mockReq.headers = { 'asaas-access-token': 'token-123' };
      mockReq.body = { event: 'PAYMENT_CONFIRMED' };
      mockBillingService.handleWebhook.mockResolvedValue({ status: 'ok', processed: true });

      await controller.handleAsaasWebhook(mockReq as Request, mockRes as Response, mockNext);

      expect(mockBillingService.handleWebhook).toHaveBeenCalledWith(
        { 'asaas-access-token': 'token-123' },
        { event: 'PAYMENT_CONFIRMED' }
      );
      expect(mockRes.json).toHaveBeenCalledWith({ status: 'ok', processed: true });
    });
  });

  describe('GET /api/v1/billing/checkout-return/:status (Ponte de Retorno)', () => {
    it('deve responder com 302 redirecionando para /ministerio/plano?status=success no status success', async () => {
      mockReq.params = { status: 'success' };

      await controller.handleCheckoutReturn(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'http://localhost:5173/ministerio/plano?status=success');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('deve responder com 302 redirecionando para /ministerio/plano?status=cancel no status cancel', async () => {
      mockReq.params = { status: 'cancel' };

      await controller.handleCheckoutReturn(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'http://localhost:5173/ministerio/plano?status=cancel');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('deve responder com 302 redirecionando para /ministerio/plano?status=expired no status expired', async () => {
      mockReq.params = { status: 'expired' };

      await controller.handleCheckoutReturn(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'http://localhost:5173/ministerio/plano?status=expired');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('deve lançar AppError 400 se o status for inválido', async () => {
      mockReq.params = { status: 'unknown_status' };

      await controller.handleCheckoutReturn(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = mockNext.mock.calls[0][0];
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('Status de retorno inválido');
      expect(mockRes.redirect).not.toHaveBeenCalled();
    });

    it('SEGURANÇA: deve ignorar parâmetros de query arbitrários e previnir open redirect', async () => {
      mockReq.params = { status: 'success' };
      mockReq.query = { redirect: 'https://evil-hacker.com', returnUrl: 'https://phishing.com', next: '/admin' };

      await controller.handleCheckoutReturn(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'http://localhost:5173/ministerio/plano?status=success');
      expect(mockRes.redirect).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('evil-hacker'));
      expect(mockRes.redirect).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('phishing'));
    });

    it('SEGURANÇA: não deve interagir com serviços de billing, ativar entitlements ou processar pagamentos', async () => {
      mockReq.params = { status: 'success' };

      await controller.handleCheckoutReturn(mockReq as Request, mockRes as Response, mockNext);

      expect(mockBillingService.createCheckout).not.toHaveBeenCalled();
      expect(mockBillingService.cancelSubscription).not.toHaveBeenCalled();
      expect(mockBillingService.reactivateSubscription).not.toHaveBeenCalled();
      expect(mockBillingService.handleWebhook).not.toHaveBeenCalled();
    });
  });
});
