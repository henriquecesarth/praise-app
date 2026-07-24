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
      const scheduleId = req.params.scheduleId as string;
      const schedule = await this.scheduleService.getScheduleById(scheduleId);
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
      const scheduleId = req.params.scheduleId as string;
      const schedule = await this.scheduleService.updateSchedule(scheduleId, req.body);
      this.handleSuccess(res, schedule);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteSchedule = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scheduleId = req.params.scheduleId as string;
      await this.scheduleService.deleteSchedule(scheduleId);
      this.handleNoContent(res);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getScheduleComments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scheduleId = req.params.scheduleId as string;
      const userId = req.user!.id;
      const userName = (req.user as any)?.name || req.user!.email || 'Usuário';
      const userRole = (req as any).ministryRole || 'member';

      const comments = await this.scheduleService.getScheduleComments(scheduleId, userId, userName, userRole);
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
      const userRole = (req as any).ministryRole || 'member';

      const comment = await this.scheduleService.addScheduleComment(
        ministryId,
        scheduleId,
        userId,
        userName,
        req.body.content,
        userRole
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
export const getScheduleComments = controllerInstance.getScheduleComments;
export const addScheduleComment = controllerInstance.addScheduleComment;
