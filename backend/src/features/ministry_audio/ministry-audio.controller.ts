import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/error-handler';
import {
  completeStemSchema, listSchema, metadataSchema, ministryIdSchema, recordingIdSchema, stemIdSchema, uploadSchema,
} from './ministry-audio.schema';
import type { MinistryAudioService } from './ministry-audio.service';

const IO_LIMIT = 12;
const REQUEST_LIMIT_MS = 120_000;
const DIRECT_SEAL_LIMIT = 2;
const ticketSchema = z.string().max(80);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'Dados da biblioteca inválidos.', result.error.issues.map(({ path, message }) => ({ path, message })));
  }
  return result.data;
}

function scope(req: AuthenticatedRequest) {
  if (!req.user) throw new AppError(401, 'Usuário não autenticado.');
  return { ministryId: parse(ministryIdSchema, req.params.ministryId), userId: req.user.id };
}

function recording(req: AuthenticatedRequest) {
  return parse(recordingIdSchema, req.params.id);
}

export class MinistryAudioController {
  private activeIO = 0;
  private activeSeals = 0;

  constructor(private readonly service: MinistryAudioService) {}

  private async withIO<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeIO >= IO_LIMIT) throw new AppError(429, 'Biblioteca ocupada. Tente novamente.');
    this.activeIO += 1;
    try {
      return await work();
    } finally {
      this.activeIO -= 1;
    }
  }

  list = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.list(scope(req), parse(listSchema, req.query)));
  };

  reserve = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.reserve(scope(req), parse(uploadSchema, req.body)));
  };

  uploadStatus = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.uploadStatus(scope(req), recording(req)));
  };

  upload = async (req: AuthenticatedRequest, res: Response) => {
    const timeout = setTimeout(() => {
      if (!req.complete) req.destroy();
    }, REQUEST_LIMIT_MS);
    try {
      if (!req.is(['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream']) ||
        (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
        throw new AppError(415, 'Envie os bytes WAV sem codificação adicional.');
      }
      const stemId = parse(stemIdSchema, req.params.stemId);
      const view = await this.withIO(() =>
        this.service.upload(scope(req), recording(req), stemId, req, req.headers['content-length'])
      );
      if (!res.destroyed) res.json(view);
    } catch (error) {
      if (!req.complete && !res.destroyed) res.setHeader('Connection', 'close');
      if (!res.destroyed) throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  finalize = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.withIO(() => this.service.finalize(scope(req), recording(req))));
  };

  issueUploadUrl = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.issueUploadUrl(scope(req), recording(req), parse(stemIdSchema, req.params.stemId)));
  };

  completeUpload = async (req: AuthenticatedRequest, res: Response) => {
    const { attempt } = parse(completeStemSchema, req.body);
    if (this.activeSeals >= DIRECT_SEAL_LIMIT) throw new AppError(429, 'Verificação ocupada. Tente novamente.');
    this.activeSeals += 1;
    try {
      res.json(await this.withIO(() =>
        this.service.completeUpload(scope(req), recording(req), parse(stemIdSchema, req.params.stemId), attempt)
      ));
    } finally {
      this.activeSeals -= 1;
    }
  };

  edit = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.edit(scope(req), recording(req), parse(metadataSchema, req.body)));
  };

  archive = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.archive(scope(req), recording(req)));
  };

  playback = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.service.playback(scope(req), recording(req)));
  };

  download = async (req: AuthenticatedRequest, res: Response) => {
    await this.withIO(async () => {
      const scopeForRequest = scope(req);
      const stemId = parse(stemIdSchema, req.params.stemId);
      const ticket = parse(ticketSchema, req.query.ticket);
      const { stream, sizeBytes } = await this.service.open(scopeForRequest, recording(req), stemId, ticket);
      if (res.destroyed) {
        stream.destroy();
        return;
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', sizeBytes);
      const timeout = setTimeout(() => res.destroy(), REQUEST_LIMIT_MS);
      try {
        await pipeline(stream, res);
      } catch (error) {
        if (!res.destroyed && !res.headersSent) throw error;
      } finally {
        clearTimeout(timeout);
      }
    });
  };

  cleanup = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.withIO(() => this.service.cleanup(scope(req))));
  };
}
