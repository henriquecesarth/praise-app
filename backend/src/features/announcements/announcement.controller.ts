import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AnnouncementService } from './announcement.service';
import { AppError } from '../../middleware/error-handler';

export class AnnouncementController extends BaseController {
  constructor(private readonly service: AnnouncementService = new AnnouncementService()) {
    super();
  }

  getAnnouncements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const queryLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const list = await this.service.getAnnouncements(ministryId, queryLimit);
      this.handleSuccess(res, list);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getAnnouncementById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const id = req.params.announcementId as string;
      const item = await this.service.getAnnouncementById(id, ministryId);
      this.handleSuccess(res, item);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createAnnouncement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const item = await this.service.createAnnouncement(
        ministryId,
        req.body,
        req.user.id,
        (req.user as any).name
      );
      this.handleCreated(res, item);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateAnnouncement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const id = req.params.announcementId as string;
      const updated = await this.service.updateAnnouncement(id, ministryId, req.body);
      this.handleSuccess(res, updated);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteAnnouncement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const id = req.params.announcementId as string;
      await this.service.deleteAnnouncement(id, ministryId);
      this.handleSuccess(res, { message: 'Aviso excluído com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new AnnouncementController();
export const getAnnouncements = instance.getAnnouncements;
export const getAnnouncementById = instance.getAnnouncementById;
export const createAnnouncement = instance.createAnnouncement;
export const updateAnnouncement = instance.updateAnnouncement;
export const deleteAnnouncement = instance.deleteAnnouncement;
