import { Router } from 'express';
import * as controller from './liturgy.controller';
import { authenticate } from '../../middleware/auth';
import { requireGroupRole, requireActiveSubscription } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { createLiturgySchema, updateLiturgySchema } from './liturgy.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

// Leitura de liturgias (acesso para todos os membros do grupo)
router.get('/', requireGroupRole('member'), controller.listLiturgies);
router.get('/:liturgyId', requireGroupRole('member'), controller.getLiturgyById);

// Escrita de liturgias (Restrito a ADMIN do grupo com assinatura ativa)
router.post(
  '/',
  requireGroupRole('admin'),
  requireActiveSubscription,
  validate(createLiturgySchema),
  controller.createLiturgy
);

router.put(
  '/:liturgyId',
  requireGroupRole('admin'),
  requireActiveSubscription,
  validate(updateLiturgySchema),
  controller.updateLiturgy
);

router.delete(
  '/:liturgyId',
  requireGroupRole('admin'),
  requireActiveSubscription,
  controller.deleteLiturgy
);

export default router;
