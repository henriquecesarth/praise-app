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

