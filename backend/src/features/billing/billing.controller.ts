import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { BillingService } from './billing.service';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { PlanId, BillingInterval } from '../../config/plans.config';
import { AppError } from '../../middleware/error-handler';

export class BillingController {
  constructor(
    private readonly billingService: BillingService = new BillingService(),
    private readonly subscriptionService: SubscriptionService = new SubscriptionService()
  ) {}

  private getMinistryId(req: Request): string {
    const raw = req.params.ministryId || req.params.groupId;
    if (!raw) {
      throw new AppError(400, 'ministryId é obrigatório nos parâmetros da rota.');
    }
    return Array.isArray(raw) ? raw[0] : String(raw);
  }

  /**
   * GET /api/v1/ministries/:ministryId/billing/preview
   */
  getCheckoutPreview = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const planId = (req.query.planId as PlanId) || 'essential';
      const interval = ((req.query.interval as BillingInterval) || 'monthly');
      const addonBlocks = req.query.addonBlocks ? parseInt(String(req.query.addonBlocks), 10) : 0;

      const preview = await this.billingService.getCheckoutPreview(
        ministryId,
        planId,
        interval,
        isNaN(addonBlocks) ? 0 : addonBlocks
      );

      res.json(preview);
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/ministries/:ministryId/billing/checkout
   */
  createCheckout = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      const { planId, interval = 'monthly', addonBlocks = 0, successUrl, cancelUrl } = req.body || {};

      if (!planId) {
        throw new AppError(400, 'planId é obrigatório no corpo da requisição.');
      }

      const result = await this.billingService.createCheckout(ministryId, userId, {
        planId,
        interval,
        addonBlocks: parseInt(String(addonBlocks), 10) || 0,
        successUrl,
        cancelUrl,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/ministries/:ministryId/billing/cancel
   */
  cancelSubscription = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const result = await this.billingService.cancelSubscription(ministryId);
      res.json({
        message: 'Cancelamento agendado para o final do período vigente.',
        subscription: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/ministries/:ministryId/billing/reactivate
   */
  reactivateSubscription = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const result = await this.billingService.reactivateSubscription(ministryId);
      res.json({
        message: 'Assinatura reativada com sucesso.',
        subscription: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/ministries/:ministryId/billing/reconcile
   */
  reconcileSubscription = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const result = await this.billingService.reconcileBillingSubscription(ministryId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/ministries/:ministryId/billing/history
   */
  getBillingHistory = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const history = await this.billingService.getBillingHistory(ministryId);
      res.json({ transactions: history });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/admin/ministries/:ministryId/complimentary/grant
   * Operação administrativa exclusiva da plataforma
   */
  grantComplimentary = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const { planId, grantedBy = 'platform_admin', grantReason, expiresAt } = req.body || {};

      if (!planId) {
        throw new AppError(400, 'planId é obrigatório para conceder plano cortesia.');
      }

      const result = await this.subscriptionService.grantComplimentaryPlan(
        ministryId,
        planId,
        grantedBy,
        grantReason,
        expiresAt
      );

      res.json({
        message: 'Plano de cortesia concedido com sucesso.',
        subscription: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/admin/ministries/:ministryId/complimentary/revoke
   * Operação administrativa exclusiva da plataforma
   */
  revokeComplimentary = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = this.getMinistryId(req);
      const { revokedBy = 'platform_admin' } = req.body || {};

      const result = await this.subscriptionService.revokeComplimentaryPlan(
        ministryId,
        revokedBy
      );

      res.json({
        message: 'Plano de cortesia revogado com sucesso.',
        subscription: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/billing/webhooks/asaas
   */
  handleAsaasWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.billingService.handleWebhook(req.headers, req.body);
      if (
        result.status === 'error' ||
        (!result.processed && result.reason === 'supersede_inactivation_failed')
      ) {
        res.status(500).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/billing/checkout-return/:status
   * Ponte de redirecionamento HTTP 302 do gateway para a aplicação web.
   * Não altera entitlements nem confirma pagamentos.
   */
  handleCheckoutReturn = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const rawStatus = req.params.status;
      const status = Array.isArray(rawStatus) ? rawStatus[0] : (rawStatus ? String(rawStatus) : '');
      const validStatuses = ['success', 'cancel', 'expired'];

      if (!status || !validStatuses.includes(status)) {
        throw new AppError(400, 'Status de retorno inválido. Valores aceitos: success, cancel, expired.');
      }

      const { config } = await import('../../config/unifiedConfig');
      const webAppUrl = (config.webAppUrl || 'http://localhost:5173').trim().replace(/\/+$/, '');
      const redirectUrl = `${webAppUrl}/ministerio/plano?status=${status}`;

      res.redirect(302, redirectUrl);
    } catch (err) {
      next(err);
    }
  };
}
