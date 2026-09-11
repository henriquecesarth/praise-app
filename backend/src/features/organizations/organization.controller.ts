import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { OrganizationService } from './organization.service';
import { AppError } from '../../middleware/error-handler';

function getParam(param: string | string[] | undefined): string {
  if (!param) return '';
  return Array.isArray(param) ? param[0] : String(param);
}

export class OrganizationController {
  constructor(private readonly orgService: OrganizationService = new OrganizationService()) {}

  getOrganizationById = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const org = await this.orgService.getOrganizationById(organizationId);
      res.json(org);
    } catch (err) {
      next(err);
    }
  };

  listOrganizationMembers = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const members = await this.orgService.listOrganizationMembers(organizationId);
      res.json(members);
    } catch (err) {
      next(err);
    }
  };

  addOrganizationAdmin = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const { userId, role } = req.body;
      const actorUserId = req.user?.id;

      if (!actorUserId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      if (role !== 'admin') {
        throw new AppError(400, 'Apenas a função admin pode ser atribuída por este endpoint.', {
          code: 'CANNOT_ASSIGN_OWNER_VIA_MEMBER_API',
        });
      }

      const member = await this.orgService.addOrganizationAdmin(organizationId, userId, actorUserId);
      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  };

  removeOrganizationAdmin = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const userId = getParam(req.params.userId);
      const actorUserId = req.user?.id;

      if (!actorUserId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      await this.orgService.removeOrganizationAdmin(organizationId, userId, actorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  getWhatsAppCapacity = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const capacity = await this.orgService.getWhatsAppCapacity(organizationId);
      res.json(capacity);
    } catch (err) {
      next(err);
    }
  };

  provisionForMinistry = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = getParam(req.params.ministryId);
      const actorUserId = req.user?.id;

      if (!actorUserId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      const org = await this.orgService.lazyProvisionForMinistry(ministryId, actorUserId);
      res.status(201).json(org);
    } catch (err) {
      next(err);
    }
  };

  getMinistryOrganization = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ministryId = getParam(req.params.ministryId);
      const org = await this.orgService.getOrganizationByMinistryId(ministryId);
      if (!org) {
        res.json({ hasOrganization: false, organization: null });
        return;
      }
      res.json({ hasOrganization: true, organization: org });
    } catch (err) {
      next(err);
    }
  };

  attachMinistry = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const ministryId = getParam(req.params.ministryId);
      const actorUserId = req.user?.id;

      if (!actorUserId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      await this.orgService.attachMinistry(organizationId, ministryId, actorUserId);
      res.status(200).json({ success: true, organizationId, ministryId });
    } catch (err) {
      next(err);
    }
  };

  detachMinistry = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const organizationId = getParam(req.params.organizationId);
      const ministryId = getParam(req.params.ministryId);
      const actorUserId = req.user?.id;

      if (!actorUserId) {
        throw new AppError(401, 'Usuário não autenticado.');
      }

      await this.orgService.detachMinistry(organizationId, ministryId, actorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
