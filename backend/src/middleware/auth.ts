import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';
import { getSupabaseClient } from '../lib/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-user-id'] as string;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token && token !== 'dev-jwt-token-access') {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data.user) {
          req.user = {
            id: data.user.id,
            email: data.user.email,
          };
          return next();
        }
      }
    }

    // Fallback de desenvolvimento ou header customizado
    const userId = customHeader || 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    req.user = {
      id: userId,
    };

    next();
  } catch (err) {
    next(err);
  }
}
