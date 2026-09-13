import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../../config/unifiedConfig';
import { WhatsAppCleanupService } from './whatsapp-cleanup.service';
import { WhatsAppReconciliationService } from './whatsapp-reconciliation.service';
import { AppError } from '../../middleware/error-handler';

export function verifyBearerSecret(authHeader: string | undefined, expectedSecret: string | undefined): boolean {
  if (!authHeader || !expectedSecret || typeof authHeader !== 'string') return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return false;
  const provided = parts[1];
  if (!provided) return false;
  const providedHash = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expectedSecret, 'utf8').digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

export class InternalWhatsAppController {
  constructor(
    private readonly cleanupService: WhatsAppCleanupService = new WhatsAppCleanupService(),
    private readonly reconService: WhatsAppReconciliationService = new WhatsAppReconciliationService()
  ) {}

  executeCleanupJobs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const cronSecret = config.cronSecret || process.env.CRON_SECRET;

      if (!verifyBearerSecret(authHeader, cronSecret)) {
        throw new AppError(401, 'UNAUTHORIZED: Credencial de cron inválida ou ausente.', {
          code: 'UNAUTHORIZED',
        });
      }

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const batchSize = req.query.batchSize ? Number(req.query.batchSize) : undefined;
      const cleanupSummary = await this.cleanupService.executeDueJobs({ batchSize });
      const reconSummary = await this.reconService.executeDueJobs({ batchSize });

      res.status(200).json({
        success: true,
        cleanup: cleanupSummary,
        reconciliation: reconSummary,
      });
    } catch (err) {
      next(err);
    }
  };

  executeReconciliationJobs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const cronSecret = config.cronSecret || process.env.CRON_SECRET;

      if (!verifyBearerSecret(authHeader, cronSecret)) {
        throw new AppError(401, 'UNAUTHORIZED: Credencial de cron inválida ou ausente.', {
          code: 'UNAUTHORIZED',
        });
      }

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const batchSize = req.query.batchSize ? Number(req.query.batchSize) : undefined;
      const summary = await this.reconService.executeDueJobs({ batchSize });

      res.status(200).json({
        success: true,
        reconciliation: summary,
      });
    } catch (err) {
      next(err);
    }
  };

  retryCleanupJob = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const operatorSecret = config.internalOperatorSecret || process.env.INTERNAL_OPERATOR_SECRET;

      if (!verifyBearerSecret(authHeader, operatorSecret)) {
        throw new AppError(403, 'FORBIDDEN: Credencial de operador interno inválida ou ausente.', {
          code: 'FORBIDDEN',
        });
      }

      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const result = await this.cleanupService.retryJob(jobId, 'internal_operator', req.body?.reason);

      res.status(200).json({
        job_id: result.id,
        status: result.status,
        manual_action_by: result.manual_action_by,
        manual_action_at: result.manual_action_at,
        manual_action_reason: result.manual_action_reason,
      });
    } catch (err) {
      next(err);
    }
  };

  abandonCleanupJob = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const operatorSecret = config.internalOperatorSecret || process.env.INTERNAL_OPERATOR_SECRET;

      if (!verifyBearerSecret(authHeader, operatorSecret)) {
        throw new AppError(403, 'FORBIDDEN: Credencial de operador interno inválida ou ausente.', {
          code: 'FORBIDDEN',
        });
      }

      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const result = await this.cleanupService.abandonJob(jobId, {
        forceAbandon: req.body?.force_abandon,
        overrideReason: req.body?.override_reason,
      });

      res.status(200).json({
        job_id: result.id,
        status: result.status,
        provider_cleanup_proof: result.provider_cleanup_proof,
        override_reason: result.override_reason,
        manual_action_by: result.manual_action_by,
        manual_action_at: result.manual_action_at,
      });
    } catch (err) {
      next(err);
    }
  };
}
