import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { MinistryService } from './ministry.service';

export class MinistryController extends BaseController {
  constructor(private readonly ministryService: MinistryService = new MinistryService()) {
    super();
  }

  getUserMinistries = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministries = await this.ministryService.getUserMinistries(userId);
      this.handleSuccess(res, ministries);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getMinistryById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const ministry = await this.ministryService.getMinistryById(ministryId, userId);
      this.handleSuccess(res, ministry);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createMinistry = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministry = await this.ministryService.createMinistry(userId, req.body);
      this.handleCreated(res, ministry);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateMinistry = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministryId = req.params.ministryId as string;
      const updated = await this.ministryService.updateMinistry(ministryId, userId, req.body);
      this.handleSuccess(res, updated);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteMinistry = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministryId = req.params.ministryId as string;
      await this.ministryService.deleteMinistry(ministryId, userId);
      this.handleSuccess(res, { message: 'Ministério excluído com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createInviteCode = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const invite = await this.ministryService.createInviteCode(ministryId, userId, req.body);
      this.handleCreated(res, invite);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  joinMinistryByCode = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const result = await this.ministryService.joinMinistryByCode(userId, req.body);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getMinistryMembers = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const members = await this.ministryService.getMinistryMembers(ministryId);
      this.handleSuccess(res, members);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  removeMember = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministryId = req.params.ministryId as string;
      const memberId = req.params.memberId as string;
      await this.ministryService.removeMember(ministryId, memberId, userId);
      this.handleSuccess(res, { message: 'Membro removido com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateMemberRole = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const memberId = req.params.memberId as string;
      const updated = await this.ministryService.updateMemberDetails(ministryId, memberId, req.body);
      this.handleSuccess(res, updated);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  addMemberManually = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const member = await this.ministryService.addMemberManually(ministryId, req.body);
      this.handleCreated(res, member);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  leaveMinistry = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const ministryId = req.params.ministryId as string;
      await this.ministryService.leaveMinistry(ministryId, userId);
      this.handleSuccess(res, { message: 'Você saiu do ministério com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new MinistryController();
export const getUserMinistries = instance.getUserMinistries;
export const getMinistryById = instance.getMinistryById;
export const createMinistry = instance.createMinistry;
export const updateMinistry = instance.updateMinistry;
export const deleteMinistry = instance.deleteMinistry;
export const createInviteCode = instance.createInviteCode;
export const joinMinistryByCode = instance.joinMinistryByCode;
export const getMinistryMembers = instance.getMinistryMembers;
export const removeMember = instance.removeMember;
export const updateMemberRole = instance.updateMemberRole;
export const addMemberManually = instance.addMemberManually;
export const leaveMinistry = instance.leaveMinistry;
