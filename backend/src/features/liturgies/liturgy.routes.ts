import { Router } from 'express';
import * as controller from './liturgy.controller';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole, requireActiveSubscription } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { createLiturgySchema, updateLiturgySchema } from './liturgy.types';

const router = Router({ mergeParams: true });

router.use(authenticate);

// Leitura de liturgias (acesso para todos os membros do ministério)
router.get('/', requireMinistryRole('member'), controller.listLiturgies);
router.get('/:liturgyId', requireMinistryRole('member'), controller.getLiturgyById);

// Escrita de liturgias (Restrito a ADMIN do ministério com assinatura ativa)
router.post(
  '/',
  requireMinistryRole('admin'),
  requireActiveSubscription,
  validate(createLiturgySchema),
  controller.createLiturgy
);

router.put(
  '/:liturgyId',
  requireMinistryRole('admin'),
  requireActiveSubscription,
  validate(updateLiturgySchema),
  controller.updateLiturgy
);

router.delete(
  '/:liturgyId',
  requireMinistryRole('admin'),
  requireActiveSubscription,
  controller.deleteLiturgy
);

export default router;
