import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { RoleService } from './role.service';

export class RoleController extends BaseController {
  constructor(private readonly roleService: RoleService = new RoleService()) {
    super();
  }

  getRoles = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const roles = await this.roleService.getRoles(ministryId);
      this.handleSuccess(res, roles);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getRoleById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const roleId = req.params.roleId as string;
      const role = await this.roleService.getRoleById(roleId, ministryId);
      this.handleSuccess(res, role);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createRole = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const role = await this.roleService.createRole(ministryId, req.body);
      this.handleCreated(res, role);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateRole = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const roleId = req.params.roleId as string;
      const role = await this.roleService.updateRole(roleId, ministryId, req.body);
      this.handleSuccess(res, role);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteRole = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const roleId = req.params.roleId as string;
      await this.roleService.deleteRole(roleId, ministryId);
      this.handleSuccess(res, { message: 'Função excluída com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new RoleController();
export const getRoles = instance.getRoles;
export const getRoleById = instance.getRoleById;
export const createRole = instance.createRole;
export const updateRole = instance.updateRole;
export const deleteRole = instance.deleteRole;
