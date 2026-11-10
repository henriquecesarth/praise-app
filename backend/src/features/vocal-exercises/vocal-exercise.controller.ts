import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { VocalExerciseService } from './vocal-exercise.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/error-handler';

export class VocalExerciseController extends BaseController {
  constructor(private readonly service = new VocalExerciseService()) {
    super();
  }

  list = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
      }
      const exercises = await this.service.list(req.user.id);
      this.handleSuccess(res, { exercises });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
      }
      const id = String(req.params.id);
      const exercise = await this.service.getById(req.user.id, id);
      this.handleSuccess(res, { exercise });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  create = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
      }
      const exercise = await this.service.create(req.user.id, req.body);
      this.handleCreated(res, { exercise });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  update = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
      }
      const id = String(req.params.id);
      const exercise = await this.service.update(req.user.id, id, req.body);
      this.handleSuccess(res, { exercise });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  delete = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
      }
      const id = String(req.params.id);
      await this.service.delete(req.user.id, id);
      this.handleSuccess(res, { success: true, message: 'Exercício vocal excluído com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}
