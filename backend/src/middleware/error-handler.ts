import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface BodyParserLikeError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
  code?: string;
}

function logSanitizedError(label: string, err: Error, extra?: Record<string, unknown>): void {
  const errRecord = err as BodyParserLikeError;
  console.error(label, {
    name: err.name,
    message: err.message,
    ...(typeof errRecord.type === 'string' ? { type: errRecord.type } : {}),
    ...(typeof errRecord.code === 'string' ? { code: errRecord.code } : {}),
    ...extra,
    ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
  });
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('API Error:', err.message);
  if (err instanceof AppError) {
    if (err.details) {
      console.error('API Error Details:', JSON.stringify(err.details, null, 2));
    }
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  const parsedErr = err as BodyParserLikeError;
  const isJsonSyntaxError =
    parsedErr.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && 'body' in (err as unknown as Record<string, unknown>));

  if (isJsonSyntaxError) {
    logSanitizedError('Request JSON parse error:', err, { statusCode: 400 });
    res.status(400).json({
      error: {
        message: 'JSON inválido no corpo da requisição.',
      },
    });
    return;
  }

  const rawStatus = parsedErr.statusCode ?? parsedErr.status;
  if (parsedErr.type === 'entity.too.large' || rawStatus === 413) {
    logSanitizedError('Request payload too large:', err, { statusCode: 413 });
    res.status(413).json({
      error: {
        message: 'Corpo da requisição excede o limite permitido.',
      },
    });
    return;
  }

  if (typeof parsedErr.type === 'string' && typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500) {
    logSanitizedError('Request body error:', err, { statusCode: rawStatus });
    res.status(rawStatus).json({
      error: {
        message: 'Corpo da requisição inválido.',
      },
    });
    return;
  }

  logSanitizedError('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Erro interno do servidor.',
    },
  });
}

