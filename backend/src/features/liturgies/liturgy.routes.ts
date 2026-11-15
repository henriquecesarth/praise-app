import { Router, Response, NextFunction } from 'express';
import * as controller from './liturgy.controller';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';

const router = Router({ mergeParams: true });

router.use(authenticate);

// Módulo independente de Liturgias descontinuado (HTTP 410 Gone), preservando
// autenticação, isolamento multitenant/RBAC e 100% dos documentos históricos no Firestore.
router.get('/', requireMinistryRole('member'), controller.listLiturgies);
router.get('/:liturgyId', requireMinistryRole('member'), controller.getLiturgyById);

router.post('/', requireMinistryRole('admin'), controller.createLiturgy);
router.put('/:liturgyId', requireMinistryRole('admin'), controller.updateLiturgy);
router.delete('/:liturgyId', requireMinistryRole('admin'), controller.deleteLiturgy);

router.use(
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requiredRole = req.method === 'GET' || req.method === 'HEAD' ? 'member' : 'admin';
    return requireMinistryRole(requiredRole)(req, res, next);
  },
  controller.discontinued
);

export default router;
