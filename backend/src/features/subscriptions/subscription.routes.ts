import { Router } from 'express';
import * as controller from './subscription.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';

const router = Router({ mergeParams: true });

// ─── Public Catalog ───────────────────────────────────────────
// Catálogo comercial público dos planos e quotas
router.get('/plans', controller.getPlans);

// ─── Ministry Subscription Status (Tenant-Scoped) ────────────
// Resumo resolvido de assinatura para um ministério específico
router.get(
  '/ministries/:ministryId/subscription',
  authenticate,
  requireMinistryRole('member'),
  controller.getMinistrySubscription
);

// Alias para compatibilidade com rotas /groups/:groupId/subscription
router.get(
  '/groups/:groupId/subscription',
  authenticate,
  requireMinistryRole('member'),
  controller.getMinistrySubscription
);

export default router;
