import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import { blockInPreview } from '../../middleware/preview-guard';
import { BillingController } from './billing.controller';

const controller = new BillingController();

// ----------------------------------------------------------------------------
// Rotas Públicas de Retorno do Checkout (Redirecionamento 302 para o Frontend)
// ----------------------------------------------------------------------------
export const billingPublicRouter = Router();
billingPublicRouter.get('/checkout-return/:status', controller.handleCheckoutReturn);

// ----------------------------------------------------------------------------
// Rotas de Webhook (Acesso pelo Gateway de Pagamento, autenticado pelo token Asaas)
// ----------------------------------------------------------------------------
export const webhookRouter = Router();
webhookRouter.post('/asaas', blockInPreview('Webhooks de pagamento Asaas'), controller.handleAsaasWebhook);

// ----------------------------------------------------------------------------
// Rotas de Gestão de Billing do Ministério (Autenticadas por JWT e RBAC)
// ----------------------------------------------------------------------------
const router = Router({ mergeParams: true });
router.use(authenticate);

router.get('/preview', requireMinistryRole('member'), controller.getCheckoutPreview);
router.post('/checkout', blockInPreview('Operação de checkout'), requireMinistryRole('admin'), controller.createCheckout);
router.post('/cancel', blockInPreview('Cancelamento de assinatura'), requireMinistryRole('admin'), controller.cancelSubscription);
router.post('/reactivate', blockInPreview('Reativação de assinatura'), requireMinistryRole('admin'), controller.reactivateSubscription);
router.put('/contact', blockInPreview('Atualização de contato de faturamento'), requireMinistryRole('admin'), controller.setBillingContact);
router.post('/reconcile', blockInPreview('Reconciliação de faturamento'), requireMinistryRole('admin'), controller.reconcileSubscription);
router.get('/history', requireMinistryRole('member'), controller.getBillingHistory);

// Phase 3C.3 — Early Activation Endpoints (Tenant-Scoped, RBAC Admin, Locked Economic Transition Basis)
router.post(
  '/transitions/:transitionId/early-activation/quote',
  blockInPreview('Cotação de ativação antecipada'),
  requireMinistryRole('admin'),
  controller.createEarlyActivationQuote
);
router.post(
  '/transitions/:transitionId/early-activation/checkout',
  blockInPreview('Checkout de ativação antecipada'),
  requireMinistryRole('admin'),
  controller.createEarlyActivationCheckout
);


// ----------------------------------------------------------------------------
// Rotas Administrativas da Plataforma (Protegidas por PLATFORM_ADMIN_SECRET)
// ----------------------------------------------------------------------------
export const platformAdminRouter = Router({ mergeParams: true });
platformAdminRouter.use(requirePlatformAdmin);

platformAdminRouter.post('/complimentary/grant', blockInPreview('Concessão de plano cortesia'), controller.grantComplimentary);
platformAdminRouter.post('/complimentary/revoke', blockInPreview('Revogação de plano cortesia'), controller.revokeComplimentary);

export default router;
