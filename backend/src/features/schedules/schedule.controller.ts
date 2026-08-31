import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ScheduleService } from './schedule.service';

export class ScheduleController extends BaseController {
  constructor(private readonly scheduleService: ScheduleService = new ScheduleService()) {
    super();
  }

  listSchedules = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const schedules = await this.scheduleService.listSchedules(groupId);
      this.handleSuccess(res, schedules);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getScheduleById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.groupId || req.params.ministryId) as string;
      const scheduleId = req.params.scheduleId as string;
      const schedule = await this.scheduleService.getScheduleById(scheduleId, ministryId);
      this.handleSuccess(res, schedule);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = (req.params.groupId || req.params.ministryId) as string;
      const userId = req.user!.id;
      const schedule = await this.scheduleService.createSchedule(groupId, userId, req.body);
      this.handleCreated(res, schedule);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.groupId || req.params.ministryId) as string;
      const scheduleId = req.params.scheduleId as string;
      const schedule = await this.scheduleService.updateSchedule(scheduleId, ministryId, req.body);
      this.handleSuccess(res, schedule);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.groupId || req.params.ministryId) as string;
      const scheduleId = req.params.scheduleId as string;
      await this.scheduleService.deleteSchedule(scheduleId, ministryId);
      this.handleNoContent(res);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateConfirmation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.groupId || req.params.ministryId) as string;
      const scheduleId = req.params.scheduleId as string;
      const userId = req.user!.id;

      // Buscar perfil e nome do usuário no Firestore
      const { db } = await import('../../lib/firebase');
      const userDoc = await db.collection('users').doc(userId).get();
      const userName = userDoc.exists
        ? (userDoc.data()?.name || userDoc.data()?.displayName || req.user?.email || 'Usuário')
        : (req.user as any)?.name || req.user?.email || 'Usuário';

      const schedule = await this.scheduleService.updateConfirmation(
        scheduleId,
        ministryId,
        userId,
        userName,
        req.body.confirmed
      );
      this.handleSuccess(res, schedule);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getScheduleComments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.groupId || req.params.ministryId) as string;
      const scheduleId = req.params.scheduleId as string;
      const query = req.query as { limit?: string; cursor?: string };
      const limitCount = query.limit ? parseInt(query.limit, 10) : 50;

      const comments = await this.scheduleService.getScheduleComments(scheduleId, ministryId, limitCount, query.cursor);
      this.handleSuccess(res, comments);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  addScheduleComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.groupId || req.params.ministryId) as string;
      const scheduleId = req.params.scheduleId as string;
      const userId = req.user!.id;
      const userName = (req.user as any)?.name || req.user!.email || 'Usuário';

      const comment = await this.scheduleService.addScheduleComment(
        ministryId,
        scheduleId,
        userId,
        userName,
        req.body.content
      );
      this.handleCreated(res, comment);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const controllerInstance = new ScheduleController();
export const listSchedules = controllerInstance.listSchedules;
export const getScheduleById = controllerInstance.getScheduleById;
export const createSchedule = controllerInstance.createSchedule;
export const updateSchedule = controllerInstance.updateSchedule;
export const deleteSchedule = controllerInstance.deleteSchedule;
export const updateConfirmation = controllerInstance.updateConfirmation;
export const getScheduleComments = controllerInstance.getScheduleComments;
export const addScheduleComment = controllerInstance.addScheduleComment;

