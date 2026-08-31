import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';
import { UserRepository } from '../repositories/UserRepository';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

const userRepository = new UserRepository();

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

    next();
  } catch (err) {
    next(err);
  }
}

