import { Response, NextFunction } from 'express';

export abstract class BaseController {
  /**
   * Envia resposta de sucesso padronizada (200 OK)
   */
  protected handleSuccess<T>(res: Response, data: T, statusCode = 200): void {
    res.status(statusCode).json(data);
  }

  /**
   * Envia resposta de recurso criado (201 Created)
   */
  protected handleCreated<T>(res: Response, data: T): void {
    res.status(201).json(data);
  }

  /**
   * Envia resposta sem conteúdo (204 No Content)
   */
  protected handleNoContent(res: Response): void {
    res.status(204).send();
  }

  /**
   * Propaga o erro para o middleware global de erros
   */
  protected handleError(error: unknown, _res: Response, next: NextFunction): void {
    next(error);
  }
}
