import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/unifiedConfig';
import { AppError } from './error-handler';

/**
 * Middleware para proteger rotas administrativas de super-admin da plataforma LouvAIO
 * (ex: concessão/revogação de planos cortesia complimentary e reconciliação de billing).
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  // Em produção, rotas administrativas HTTP ficam totalmente desativadas para eliminar superfície de ataque
  if (config.nodeEnv === 'production') {
    return next(
      new AppError(
        403,
        'Rotas administrativas HTTP desativadas em produção por política de segurança. Utilize o script CLI operacional seguro no servidor.'
      )
    );
  }

  const providedSecret = req.headers['x-platform-admin-secret'];

  if (!providedSecret || typeof providedSecret !== 'string') {
    return next(new AppError(403, 'Acesso restrito à autoridade da plataforma. Chave secreta não fornecida.'));
  }

  const expectedSecret = config.platformAdminSecret;

  if (!expectedSecret) {
    return next(new AppError(403, 'Acesso administrativo HTTP desativado no ambiente atual.'));
  }

  // Comparação segura em tempo constante
  const providedBuf = Buffer.from(providedSecret);
  const expectedBuf = Buffer.from(expectedSecret);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return next(new AppError(403, 'Chave de autoridade da plataforma inválida.'));
  }


  next();
}
