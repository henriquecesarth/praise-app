import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { GroupService } from './group.service';

export class GroupController extends BaseController {
  constructor(private readonly groupService: GroupService = new GroupService()) {
    super();
  }

  getUserGroups = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const groups = await this.groupService.getUserGroups(userId);
      this.handleSuccess(res, groups);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getGroupById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const groupId = req.params.groupId as string;
      const group = await this.groupService.getGroupById(groupId, userId);
      this.handleSuccess(res, group);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createGroup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const group = await this.groupService.createGroup(userId, req.body);
      this.handleCreated(res, group);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createInviteCode = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const groupId = req.params.groupId as string;
      const invite = await this.groupService.createInviteCode(groupId, userId, req.body);
      this.handleCreated(res, invite);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  joinGroupByCode = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const result = await this.groupService.joinGroupByCode(userId, req.body);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getGroupMembers = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = req.params.groupId as string;
      const members = await this.groupService.getGroupMembers(groupId);
      this.handleSuccess(res, members);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new GroupController();
export const getUserGroups = instance.getUserGroups;
export const getGroupById = instance.getGroupById;
export const createGroup = instance.createGroup;
export const createInviteCode = instance.createInviteCode;
export const joinGroupByCode = instance.joinGroupByCode;
export const getGroupMembers = instance.getGroupMembers;
