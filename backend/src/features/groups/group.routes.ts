import { Router } from 'express';
import * as controller from './group.controller';
import { authenticate } from '../../middleware/auth';
import { requireGroupRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { createGroupSchema, createInviteSchema, joinGroupSchema } from './group.types';

const router = Router();

router.use(authenticate);

// Listar grupos do usuário logado
router.get('/my-groups', controller.getUserGroups);

// Ingressar em um grupo usando código curto de convite (ex: PR-8X2K)
router.post('/join', validate(joinGroupSchema), controller.joinGroupByCode);

// Criar um novo grupo (Restrito)
router.post('/', validate(createGroupSchema), controller.createGroup);

// Detalhes do grupo
router.get('/:groupId', requireGroupRole('member'), controller.getGroupById);

// Membros do grupo
router.get('/:groupId/members', requireGroupRole('member'), controller.getGroupMembers);

// Gerar código de convite (Somente ADMIN do grupo)
router.post(
  '/:groupId/invites',
  requireGroupRole('admin'),
  validate(createInviteSchema),
  controller.createInviteCode
);

export default router;
