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
}

const controllerInstance = new ScheduleController();
export const listSchedules = controllerInstance.listSchedules;
export const getScheduleById = controllerInstance.getScheduleById;
export const createSchedule = controllerInstance.createSchedule;
export const updateSchedule = controllerInstance.updateSchedule;
export const deleteSchedule = controllerInstance.deleteSchedule;
