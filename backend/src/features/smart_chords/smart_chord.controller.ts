import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { BaseController } from '../../controllers/BaseController';
import * as smartChordService from './smart_chord.service';
import {
  createSmartChordSchema,
  updateSmartChordSchema,
  smartChordsQuerySchema,
  singleDocumentIdSchema,
  setSmartChordRepertoireLinkSchema,
} from './smart_chord.types';
import { importTextPayloadSchema } from './smart_chord_import.types';
import { normalizeChordText } from './smart_chord_normalizer';
import { extractSmartChordDraftFromPdf, MAX_PDF_FILE_SIZE } from './smart_chord_pdf_extractor';

import { AppError } from '../../middleware/error-handler';

function getUserId(req: Request): string {
  const anyReq = req as any;
  if (!anyReq.user?.id) {
    throw new AppError(401, 'Usuário não autenticado.');
  }
  return anyReq.user.id;
}


export class SmartChordController extends BaseController {
  private service: typeof smartChordService;

  constructor(service: typeof smartChordService = smartChordService) {
    super();
    this.service = service;
  }

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

      const result = await this.service.getSmartChords(userId, {
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

      const result = await this.service.getSmartChordById(id, userId);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getSmartChordsBySong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const songId = singleDocumentIdSchema.parse(req.params.songId);

      const result = await this.service.getSmartChordsBySong(songId, userId);
      this.handleSuccess(res, { data: result });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  createSmartChord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const body = createSmartChordSchema.parse(req.body);

      const result = await this.service.createSmartChord(userId, body);
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

      const result = await this.service.updateSmartChord(id, userId, body);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  deleteSmartChord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const id = singleDocumentIdSchema.parse(req.params.id);

      await this.service.deleteSmartChord(id, userId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getRepertoireLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const chordId = singleDocumentIdSchema.parse(req.params.chordId);

      const result = await this.service.getRepertoireLink(userId, chordId, ministryId);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  setRepertoireLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const chordId = singleDocumentIdSchema.parse(req.params.chordId);
      const body = setSmartChordRepertoireLinkSchema.parse(req.body);

      const result = await this.service.setRepertoireLink(userId, chordId, ministryId, body.song_id);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  removeRepertoireLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const chordId = singleDocumentIdSchema.parse(req.params.chordId);

      await this.service.removeRepertoireLink(userId, chordId, ministryId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getMySmartChordsForSong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getUserId(req);
      const ministryId = (req.params.ministryId || req.params.groupId) as string;
      const songId = singleDocumentIdSchema.parse(req.params.songId);

      const result = await this.service.getMySmartChordsForSong(userId, ministryId, songId);
      this.handleSuccess(res, { data: result });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  importPdfDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      getUserId(req);
      const anyReq = req as any;
      let buffer: Buffer | null = null;

      if (anyReq.file && anyReq.file.buffer) {
        buffer = anyReq.file.buffer;
      } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        buffer = req.body;
      }

      if (!buffer) {
        throw new AppError(400, 'Nenhum arquivo PDF foi enviado na requisição.');
      }

      if (buffer.length > MAX_PDF_FILE_SIZE) {
        throw new AppError(400, 'Arquivo PDF excede o limite máximo permitido de 3 MB.');
      }

      const draft = await extractSmartChordDraftFromPdf(buffer);
      this.handleSuccess(res, draft);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  importTextDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      getUserId(req);
      const parsed = importTextPayloadSchema.parse(req.body);
      const draft = normalizeChordText(parsed.text);
      this.handleSuccess(res, draft);
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
export const getRepertoireLink = scInstance.getRepertoireLink;
export const setRepertoireLink = scInstance.setRepertoireLink;
export const removeRepertoireLink = scInstance.removeRepertoireLink;
export const getMySmartChordsForSong = scInstance.getMySmartChordsForSong;
export const importPdfDraft = scInstance.importPdfDraft;
export const importTextDraft = scInstance.importTextDraft;
