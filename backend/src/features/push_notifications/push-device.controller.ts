import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error-handler';
import { PushDeviceRepository } from '../../repositories/PushDeviceRepository';
import { RegisterPushDeviceInput } from './push-notifications.types';

export class PushDeviceController {
  constructor(
    private readonly pushDeviceRepo: PushDeviceRepository = new PushDeviceRepository()
  ) {}

  registerDevice = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw new AppError(401, 'Autenticação necessária.');
      }

      const input: RegisterPushDeviceInput = req.body;
      const device = await this.pushDeviceRepo.upsertDevice(userId, input);

      res.status(200).json({
        success: true,
        message: 'Dispositivo registrado com sucesso.',
        device: {
          id: device.id,
          platform: device.platform,
          created_at: device.created_at,
          updated_at: device.updated_at,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  unregisterDevice = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw new AppError(401, 'Autenticação necessária.');
      }

      const rawParam = req.params.token;
      const paramToken = Array.isArray(rawParam) ? rawParam[0] : rawParam;
      const rawToken =
        (paramToken && decodeURIComponent(paramToken)) ||
        req.body?.fcm_token ||
        req.body?.token;

      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        throw new AppError(400, 'Token FCM não informado.');
      }
      const token = rawToken.trim();

      const deleted = await this.pushDeviceRepo.deleteDeviceByToken(
        userId,
        token.trim()
      );

      if (!deleted) {
        throw new AppError(
          404,
          'Dispositivo não encontrado ou não pertence ao usuário.'
        );
      }

      res.status(200).json({
        success: true,
        message: 'Dispositivo desvinculado com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  };
}

export const pushDeviceController = new PushDeviceController();
