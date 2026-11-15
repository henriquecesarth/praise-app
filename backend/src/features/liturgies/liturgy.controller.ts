import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/error-handler';
import { LiturgyService } from './liturgy.service';

export const STANDALONE_LITURGY_MODULE_DISCONTINUED_CODE =
  'STANDALONE_LITURGY_MODULE_DISCONTINUED';

export const STANDALONE_LITURGY_DISCONTINUED_MESSAGE =
  'O módulo independente de Liturgias foi descontinuado. Utilize o Roteiro dentro de Escalas e os Modelos de Roteiro. Os registros históricos permanecem preservados.';

export class LiturgyController extends BaseController {
  constructor(_liturgyService?: LiturgyService) {
    super();
  }

  private buildDiscontinuedError(): AppError {
    return new AppError(410, STANDALONE_LITURGY_DISCONTINUED_MESSAGE, {
      code: STANDALONE_LITURGY_MODULE_DISCONTINUED_CODE,
      module: 'liturgies',
      status: 'discontinued',
      firestoreDataPreserved: true,
      replacements: {
        schedulesPath: '/escalas',
        scheduleTemplatesPath: '/schedule-templates',
      },
    });
  }

  discontinued = async (
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    this.handleError(this.buildDiscontinuedError(), res, next);
  };

  listLiturgies = this.discontinued;
  getLiturgyById = this.discontinued;
  createLiturgy = this.discontinued;
  updateLiturgy = this.discontinued;
  deleteLiturgy = this.discontinued;
}

const litInstance = new LiturgyController();
export const discontinued = litInstance.discontinued;
export const listLiturgies = litInstance.listLiturgies;
export const getLiturgyById = litInstance.getLiturgyById;
export const createLiturgy = litInstance.createLiturgy;
export const updateLiturgy = litInstance.updateLiturgy;
export const deleteLiturgy = litInstance.deleteLiturgy;
