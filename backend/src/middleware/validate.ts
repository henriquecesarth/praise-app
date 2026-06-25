import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './error-handler';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new AppError(400, 'Dados inválidos.', {
            errors: error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          })
        );
      } else {
        next(error);
      }
    }
  };
}
