import { Request, Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from '../../middleware/auth';

export class AuthController extends BaseController {
  constructor(private readonly authService: AuthService = new AuthService()) {
    super();
  }

  signUp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.signUp(req.body);
      this.handleCreated(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.login(req.body);
      this.handleSuccess(res, result);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getMe = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
      const user = await this.authService.getMe(token);
      this.handleSuccess(res, user);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new AuthController();
export const signUp = instance.signUp;
export const login = instance.login;
export const getMe = instance.getMe;
