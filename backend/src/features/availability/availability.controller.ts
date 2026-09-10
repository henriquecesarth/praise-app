import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AvailabilityService } from './availability.service';
import { AppError } from '../../middleware/error-handler';

export class AvailabilityController extends BaseController {
  constructor(private readonly service: AvailabilityService = new AvailabilityService()) {
    super();
  }

  listMyUnavailabilities = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;

      let limit = 50;
      if (req.query.limit !== undefined) {
        const rawLimitStr = String(req.query.limit).trim();
        if (!/^\d+$/.test(rawLimitStr)) {
          throw new AppError(400, 'O parâmetro limit deve ser um número inteiro entre 1 e 100.', {
            code: 'LIMIT_INVALID',
          });
        }
        const parsed = parseInt(rawLimitStr, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
          throw new AppError(400, 'O parâmetro limit deve ser um número inteiro entre 1 e 100.', {
            code: 'LIMIT_INVALID',
          });
        }
        limit = parsed;
      }

      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

      const result = await this.service.listMyUnavailabilities(ministryId, req.user.id, limit, cursor);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createMyUnavailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const result = await this.service.createMyUnavailability(ministryId, req.user.id, req.body);
      this.handleCreated(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateMyUnavailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const id = req.params.id as string;
      const result = await this.service.updateMyUnavailability(id, ministryId, req.user.id, req.body);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteMyUnavailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const id = req.params.id as string;
      await this.service.deleteMyUnavailability(id, ministryId, req.user.id);
      this.handleNoContent(res);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  checkScheduleConflicts = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const result = await this.service.checkScheduleConflicts(ministryId, req.body);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  listConsolidatedAvailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const result = await this.service.listConsolidatedAvailability(ministryId, req.query as any);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  // ─── Manual Member Availability Endpoints (Phase 6D-2) ─────────────────────

  listManualMemberUnavailabilities = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const memberId = req.params.memberId as string;

      let limit = 50;
      if (req.query.limit !== undefined) {
        const rawLimitStr = String(req.query.limit).trim();
        if (!/^\d+$/.test(rawLimitStr)) {
          throw new AppError(400, 'O parâmetro limit deve ser um número inteiro entre 1 e 100.', {
            code: 'LIMIT_INVALID',
          });
        }
        const parsed = parseInt(rawLimitStr, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
          throw new AppError(400, 'O parâmetro limit deve ser um número inteiro entre 1 e 100.', {
            code: 'LIMIT_INVALID',
          });
        }
        limit = parsed;
      }

      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
      const result = await this.service.listManualMemberUnavailabilities(ministryId, memberId, limit, cursor);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createManualMemberUnavailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const memberId = req.params.memberId as string;
      const actorUserId = req.user.id;

      // Sanitização em profundidade (defense in depth): rejeita/ignora campos de autoridade forjados
      const { startDate, endDate, startTime, endTime, allDay, reason } = req.body;
      const input = { startDate, endDate, startTime, endTime, allDay, reason };

      const result = await this.service.createManualMemberUnavailability(
        ministryId,
        memberId,
        actorUserId,
        input
      );
      this.handleCreated(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateManualMemberUnavailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const memberId = req.params.memberId as string;
      const id = req.params.id as string;
      const actorUserId = req.user.id;

      // Sanitização em profundidade: rejeita/ignora campos forjados
      const { startDate, endDate, startTime, endTime, allDay, reason } = req.body;
      const input = { startDate, endDate, startTime, endTime, allDay, reason };

      const result = await this.service.updateManualMemberUnavailability(
        id,
        ministryId,
        memberId,
        actorUserId,
        input
      );
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteManualMemberUnavailability = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Usuário não autenticado.');
      }
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const memberId = req.params.memberId as string;
      const id = req.params.id as string;
      const actorUserId = req.user.id;

      await this.service.deleteManualMemberUnavailability(id, ministryId, memberId, actorUserId);
      this.handleNoContent(res);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new AvailabilityController();
export const listMyUnavailabilities = instance.listMyUnavailabilities;
export const createMyUnavailability = instance.createMyUnavailability;
export const updateMyUnavailability = instance.updateMyUnavailability;
export const deleteMyUnavailability = instance.deleteMyUnavailability;
export const checkScheduleConflicts = instance.checkScheduleConflicts;
export const listConsolidatedAvailability = instance.listConsolidatedAvailability;
export const listManualMemberUnavailabilities = instance.listManualMemberUnavailabilities;
export const createManualMemberUnavailability = instance.createManualMemberUnavailability;
export const updateManualMemberUnavailability = instance.updateManualMemberUnavailability;
export const deleteManualMemberUnavailability = instance.deleteManualMemberUnavailability;
