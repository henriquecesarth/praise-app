import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from '../../middleware/auth';

export async function signUp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await AuthService.signUp(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await AuthService.login(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMe(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
    const user = await AuthService.getMe(token, req.user?.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
}
