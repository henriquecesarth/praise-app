import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { LiturgyService } from './liturgy.service';

export class LiturgyController extends BaseController {
  constructor(private readonly liturgyService: LiturgyService = new LiturgyService()) {
    super();
  }

  listLiturgies = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const liturgies = await this.liturgyService.listLiturgies(groupId);
      this.handleSuccess(res, liturgies);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getLiturgyById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const liturgyId = req.params.liturgyId as string;
      const liturgy = await this.liturgyService.getLiturgyById(groupId, liturgyId);
      this.handleSuccess(res, liturgy);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createLiturgy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const userId = req.user!.id;
      const liturgy = await this.liturgyService.createLiturgy(groupId, userId, req.body);
      this.handleCreated(res, liturgy);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateLiturgy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const liturgyId = req.params.liturgyId as string;
      const liturgy = await this.liturgyService.updateLiturgy(groupId, liturgyId, req.body);
      this.handleSuccess(res, liturgy);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteLiturgy = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const liturgyId = req.params.liturgyId as string;
      const result = await this.liturgyService.deleteLiturgy(groupId, liturgyId);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const litInstance = new LiturgyController();
export const listLiturgies = litInstance.listLiturgies;
export const getLiturgyById = litInstance.getLiturgyById;
export const createLiturgy = litInstance.createLiturgy;
export const updateLiturgy = litInstance.updateLiturgy;
export const deleteLiturgy = litInstance.deleteLiturgy;
