import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { BaseController } from '../../controllers/BaseController';
import * as smartChordService from './smart_chord.service';
import {
  createSmartChordSchema,
  updateSmartChordSchema,
  smartChordsQuerySchema,
  singleDocumentIdSchema,
} from './smart_chord.types';

import { AppError } from '../../middleware/error-handler';

function getUserId(req: Request): string {
  const anyReq = req as any;
  if (!anyReq.user?.id) {
    throw new AppError(401, 'Usuário não autenticado.');
  }
  return anyReq.user.id;
}


export class SmartChordController extends BaseController {
  protected override handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof ZodError) {
      return next(
        new AppError(400, 'Dados inválidos.', {
          errors: error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        })
      );
    }
    super.handleError(error, res, next);
  }

  listSmartChords = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const query = smartChordsQuerySchema.parse(req.query);

      const result = await smartChordService.getSmartChords(userId, {
        search: query.search,
        page: query.page ? Number(query.page) : undefined,
        limit: query.limit ? Number(query.limit) : undefined,
      });
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getSmartChord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = singleDocumentIdSchema.parse(req.params.id);

      const result = await smartChordService.getSmartChordById(id, userId);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getSmartChordsBySong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const songId = singleDocumentIdSchema.parse(req.params.songId);

      const result = await smartChordService.getSmartChordsBySong(songId, userId);
      this.handleSuccess(res, { data: result });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  createSmartChord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const body = createSmartChordSchema.parse(req.body);

      const result = await smartChordService.createSmartChord(userId, body);
      this.handleCreated(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  updateSmartChord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = singleDocumentIdSchema.parse(req.params.id);
      const body = updateSmartChordSchema.parse(req.body);

      const result = await smartChordService.updateSmartChord(id, userId, body);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  deleteSmartChord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = singleDocumentIdSchema.parse(req.params.id);

      await smartChordService.deleteSmartChord(id, userId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}

const scInstance = new SmartChordController();
export const listSmartChords = scInstance.listSmartChords;
export const getSmartChord = scInstance.getSmartChord;
export const getSmartChordsBySong = scInstance.getSmartChordsBySong;
export const createSmartChord = scInstance.createSmartChord;
export const updateSmartChord = scInstance.updateSmartChord;
export const deleteSmartChord = scInstance.deleteSmartChord;
