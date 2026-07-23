import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { TemplateService } from './template.service';

export class TemplateController extends BaseController {
  constructor(private readonly service: TemplateService = new TemplateService()) {
    super();
  }

  getTemplates = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const list = await this.service.getTemplates(ministryId);
      this.handleSuccess(res, list);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getTemplateById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const id = req.params.templateId as string;
      const item = await this.service.getTemplateById(id, ministryId);
      this.handleSuccess(res, item);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const item = await this.service.createTemplate(ministryId, req.body);
      this.handleCreated(res, item);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const id = req.params.templateId as string;
      const updated = await this.service.updateTemplate(id, ministryId, req.body);
      this.handleSuccess(res, updated);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const id = req.params.templateId as string;
      await this.service.deleteTemplate(id, ministryId);
      this.handleSuccess(res, { message: 'Modelo de roteiro excluído com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new TemplateController();
export const getTemplates = instance.getTemplates;
export const getTemplateById = instance.getTemplateById;
export const createTemplate = instance.createTemplate;
export const updateTemplate = instance.updateTemplate;
export const deleteTemplate = instance.deleteTemplate;
