import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';
import { UserRepository } from '../repositories/UserRepository';
import { AccountDeletionRepository } from '../repositories/AccountDeletionRepository';
import { authAdmin } from '../lib/firebase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

const userRepository = new UserRepository();
const accountDeletionRepo = new AccountDeletionRepository();

export const MAX_AUTH_AGE_SECONDS = 300; // 5 minutos de janela para reautenticação recente

export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'Token de autenticação não fornecido.');
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      throw new AppError(401, 'Token de autenticação inválido.');
    }

    const decoded = await userRepository.verifyToken(token);

    if (!decoded || !decoded.uid) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    req.user = {
      id: decoded.uid,
      email: decoded.email,
    };

    // Access Guard: se a exclusão da conta foi iniciada ou concluída,
    // bloquear acesso a rotas normais da aplicação (exceto rotas de inspeção/status/exclusão).
    // Usa semântica estrita de caminho de rota (ignora query strings e previne injeção de parâmetros/rotas).
    const rawPath = (req.originalUrl || '').split('?')[0].split('#')[0];
    let normalizedPath: string;
    try {
      normalizedPath = decodeURIComponent(rawPath);
    } catch {
      normalizedPath = rawPath;
    }

    const isExemptAccountDeletion =
      normalizedPath === '/api/v1/auth/account-deletion' ||
      normalizedPath.startsWith('/api/v1/auth/account-deletion/') ||
      normalizedPath === '/auth/account-deletion' ||
      normalizedPath.startsWith('/auth/account-deletion/');

    if (!isExemptAccountDeletion) {
      const isPending = await accountDeletionRepo.isDeletionPending(decoded.uid);
      if (isPending) {
        throw new AppError(403, 'Sua conta está em processo de exclusão ou foi excluída.', {
          code: 'ACCOUNT_DELETION_IN_PROGRESS',
        });
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

export async function requireRecentFirebaseAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'Token de autenticação não fornecido.');
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      throw new AppError(401, 'Token de autenticação inválido.');
    }

    if (!authAdmin || typeof authAdmin.verifyIdToken !== 'function') {
      throw new AppError(500, 'Serviço de autenticação Firebase indisponível.');
    }

    let decoded: any;
    try {
      decoded = await authAdmin.verifyIdToken(token);
    } catch {
      throw new AppError(401, 'Reautenticação recente com Firebase necessária para esta operação.', {
        code: 'REAUTHENTICATION_REQUIRED',
      });
    }

    if (!decoded || !decoded.uid) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const authTime = decoded.auth_time;

    if (!authTime || (nowSeconds - authTime) > MAX_AUTH_AGE_SECONDS) {
      throw new AppError(401, 'Reautenticação recente necessária para esta operação.', {
        code: 'REAUTHENTICATION_REQUIRED',
        maxAgeSeconds: MAX_AUTH_AGE_SECONDS,
        authTime: authTime ?? null,
      });
    }

    req.user = {
      id: decoded.uid,
      email: decoded.email,
    };

    next();
  } catch (err) {
    next(err);
  }
}

