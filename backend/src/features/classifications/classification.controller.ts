import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ClassificationService } from './classification.service';

export class ClassificationController extends BaseController {
  constructor(private readonly service: ClassificationService = new ClassificationService()) {
    super();
  }

  getClassifications = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const list = await this.service.getClassifications(ministryId);
      this.handleSuccess(res, list);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getClassificationById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const id = req.params.classificationId as string;
      const item = await this.service.getClassificationById(id, ministryId);
      this.handleSuccess(res, item);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createClassification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const item = await this.service.createClassification(ministryId, req.body);
      this.handleCreated(res, item);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateClassification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const id = req.params.classificationId as string;
      const updated = await this.service.updateClassification(id, ministryId, req.body);
      this.handleSuccess(res, updated);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteClassification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const id = req.params.classificationId as string;
      await this.service.deleteClassification(id, ministryId);
      this.handleSuccess(res, { message: 'Classificação excluída com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new ClassificationController();
export const getClassifications = instance.getClassifications;
export const getClassificationById = instance.getClassificationById;
export const createClassification = instance.createClassification;
export const updateClassification = instance.updateClassification;
export const deleteClassification = instance.deleteClassification;
