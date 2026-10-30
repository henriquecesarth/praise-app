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

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const parserError = err as Error & { type?: unknown };
  if (parserError.type === 'entity.too.large' || parserError.type === 'entity.parse.failed') {
    const tooLarge = parserError.type === 'entity.too.large';
    // Body-parser errors may carry the original body. Never log that payload.
    res.status(tooLarge ? 413 : 400).json({
      error: {
        message: tooLarge ? 'O corpo da requisição excede o limite permitido.' : 'JSON inválido na requisição.',
        details: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' },
      },
    });
    return;
  }
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

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Erro interno do servidor.',
    },
  });
}

