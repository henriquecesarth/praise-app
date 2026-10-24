import { Request, Response, NextFunction } from 'express';
import { isPreviewEnvironment } from '../config/unifiedConfig';
import { AppError } from './error-handler';

/**
 * Middleware that blocks prohibited operations when running in a Vercel Preview environment.
 * Ensures fail-closed isolation for financial operations, external messaging, and background jobs.
 */
export function blockInPreview(operationName: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    if (isPreviewEnvironment()) {
      return next(
        new AppError(
          403,
          `PREVIEW_MODE_BLOCKED: ${operationName} desabilitado(a) no ambiente de Preview.`,
          { code: 'PREVIEW_MODE_BLOCKED' }
        )
      );
    }
    next();
  };
}
