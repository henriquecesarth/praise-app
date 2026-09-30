import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { PushDeviceRepository } from '../../repositories/PushDeviceRepository';
import { PushDeviceController } from './push-device.controller';
import { PushNotificationService } from './push-notification.service';
import { PushDeviceRecord, RegisterPushDeviceInput } from './push-notifications.types';
import { AppError } from '../../middleware/error-handler';

describe('Push Notifications Backend Feature Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. PushDeviceRepository Unit & Security Logic', () => {
    let repo: PushDeviceRepository;

    beforeEach(() => {
      repo = new PushDeviceRepository();
    });

    it('generates deterministic device document ID from FCM token SHA-256', () => {
      const token = 'test-fcm-token-1234567890abcdef';
      const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
      const docId = PushDeviceRepository.generateDeviceId(token);
      expect(docId).toBe(`dev_${expectedHash}`);
      expect(PushDeviceRepository.generateDeviceId(token)).toBe(docId);
    });

    it('redacts tokens safely for logs without leaking secret values', () => {
      expect(PushDeviceRepository.redactToken('')).toBe('***');
      expect(PushDeviceRepository.redactToken('short')).toBe('***');
      expect(PushDeviceRepository.redactToken('fcm_token_abcdef123456')).toBe('fcm_to...3456');
    });

    it('upsertDevice creates a new record when token does not exist', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      const mockDoc = vi.fn().mockReturnValue({
        get: mockGet,
        set: mockSet,
      });

      (repo as any).collection = {
        doc: mockDoc,
      };

      const input: RegisterPushDeviceInput = {
        fcm_token: 'valid-fcm-token-alpha',
        platform: 'android',
        app_version: '1.1.0',
        device_model: 'Lenovo TB-X606F',
      };

      const result = await repo.upsertDevice('user-1', input);

      expect(result.user_id).toBe('user-1');
      expect(result.fcm_token).toBe('valid-fcm-token-alpha');
      expect(result.platform).toBe('android');
      expect(result.app_version).toBe('1.1.0');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          platform: 'android',
        })
      );
    });

    it('upsertDevice rejects cross-user token registration with 409 PUSH_TOKEN_CONFLICT', async () => {
      const existingData: PushDeviceRecord = {
        id: 'dev_123',
        user_id: 'user-original-owner',
        fcm_token: 'shared-fcm-token',
        platform: 'android',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
        last_seen_at: '2026-09-01T10:00:00Z',
      };

      const mockSet = vi.fn();
      const mockGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => existingData,
      });

      (repo as any).collection = {
        doc: vi.fn().mockReturnValue({
          get: mockGet,
          set: mockSet,
        }),
      };

      await expect(
        repo.upsertDevice('user-attacker', {
          fcm_token: 'shared-fcm-token',
          platform: 'android',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: 'PUSH_TOKEN_CONFLICT',
      });

      expect(mockSet).not.toHaveBeenCalled();
    });

    it('upsertDevice updates last_seen_at and metadata when token is re-registered by same user', async () => {
      const existingData: PushDeviceRecord = {
        id: 'dev_123',
        user_id: 'user-owner',
        fcm_token: 'my-fcm-token',
        platform: 'android',
        created_at: '2026-08-01T10:00:00Z',
        updated_at: '2026-08-01T10:00:00Z',
        last_seen_at: '2026-08-01T10:00:00Z',
      };

      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => existingData,
      });

      (repo as any).collection = {
        doc: vi.fn().mockReturnValue({
          get: mockGet,
          set: mockSet,
        }),
      };

      const result = await repo.upsertDevice('user-owner', {
        fcm_token: 'my-fcm-token',
        platform: 'android',
        app_version: '1.2.0',
      });

      expect(result.user_id).toBe('user-owner');
      expect(result.created_at).toBe('2026-08-01T10:00:00Z');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-owner',
          app_version: '1.2.0',
        }),
        { merge: true }
      );
    });

    it('deleteDeviceByToken returns false when document does not exist', async () => {
      (repo as any).collection = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: false }),
        }),
      };

      const deleted = await repo.deleteDeviceByToken('user-1', 'non-existent-token');
      expect(deleted).toBe(false);
    });

    it('deleteDeviceByToken prevents cross-user deletion (fails closed)', async () => {
      const mockDelete = vi.fn();
      (repo as any).collection = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ user_id: 'victim-user', fcm_token: 'victim-token' }),
          }),
          delete: mockDelete,
        }),
      };

      const deleted = await repo.deleteDeviceByToken('attacker-user', 'victim-token');
      expect(deleted).toBe(false);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('deleteDeviceByToken succeeds when token belongs to authenticated user', async () => {
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      (repo as any).collection = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ user_id: 'user-1', fcm_token: 'user-token' }),
          }),
          delete: mockDelete,
        }),
      };

      const deleted = await repo.deleteDeviceByToken('user-1', 'user-token');
      expect(deleted).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('getDevicesByUserId queries push_devices filtered by user_id and can filter active lease', async () => {
      const now = new Date('2026-09-30T12:00:00Z');
      const mockDocs = [
        {
          data: () => ({
            id: 'd1',
            user_id: 'user-1',
            fcm_token: 't1',
            last_seen_at: '2026-09-29T12:00:00Z',
          }),
        },
        {
          data: () => ({
            id: 'd2',
            user_id: 'user-1',
            fcm_token: 't2',
            last_seen_at: '2026-06-01T12:00:00Z', // stale (> 60 days)
          }),
        },
      ];

      (repo as any).collection = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: mockDocs }),
        }),
      };

      const allDevices = await repo.getDevicesByUserId('user-1');
      expect(allDevices).toHaveLength(2);

      const activeDevices = await repo.getDevicesByUserId('user-1', { onlyActive: true, now });
      expect(activeDevices).toHaveLength(1);
      expect(activeDevices[0].fcm_token).toBe('t1');
    });
  });

  describe('2. PushDeviceController & Endpoint Security', () => {
    let controller: PushDeviceController;
    let mockRepo: PushDeviceRepository;

    beforeEach(() => {
      mockRepo = new PushDeviceRepository();
      controller = new PushDeviceController(mockRepo);
    });

    it('registerDevice rejects unauthenticated requests with 401', async () => {
      const req: any = { user: undefined, body: {} };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.registerDevice(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, message: 'Autenticação necessária.' })
      );
    });

    it('registerDevice derives user ID strictly from authenticated context, ignoring body overrides', async () => {
      const req: any = {
        user: { id: 'auth-user-id' },
        body: {
          user_id: 'attacker-injected-id',
          fcm_token: 'my-fcm-token',
          platform: 'android',
        },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      const upsertSpy = vi.spyOn(mockRepo, 'upsertDevice').mockResolvedValue({
        id: 'dev_mock_id',
        user_id: 'auth-user-id',
        fcm_token: 'my-fcm-token',
        platform: 'android',
        created_at: '2026-09-30T10:00:00Z',
        updated_at: '2026-09-30T10:00:00Z',
        last_seen_at: '2026-09-30T10:00:00Z',
      });

      await controller.registerDevice(req, res, next);

      expect(upsertSpy).toHaveBeenCalledWith('auth-user-id', req.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          device: expect.objectContaining({ id: 'dev_mock_id' }),
        })
      );
    });

    it('unregisterDevice rejects missing body token with 400', async () => {
      const req: any = {
        user: { id: 'auth-user-id' },
        params: {},
        body: {},
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.unregisterDevice(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: 'Token FCM não informado.' })
      );
    });

    it('unregisterDevice returns 404 when device not found or belongs to another user', async () => {
      const req: any = {
        user: { id: 'auth-user-id' },
        body: { fcm_token: 'victim-token' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      vi.spyOn(mockRepo, 'deleteDeviceByToken').mockResolvedValue(false);

      await controller.unregisterDevice(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Dispositivo não encontrado ou não pertence ao usuário.',
        })
      );
    });

    it('unregisterDevice unregisters successfully via body token (fcmToken or fcm_token)', async () => {
      const req: any = {
        user: { id: 'auth-user-id' },
        body: { fcmToken: 'my-token' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      const deleteSpy = vi.spyOn(mockRepo, 'deleteDeviceByToken').mockResolvedValue(true);

      await controller.unregisterDevice(req, res, next);

      expect(deleteSpy).toHaveBeenCalledWith('auth-user-id', 'my-token');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Dispositivo desvinculado com sucesso.' })
      );
    });
  });

  describe('3. PushNotificationService Multicast Chunking & Dead Token Pruning', () => {
    let service: PushNotificationService;
    let mockRepo: PushDeviceRepository;
    let mockMessaging: any;

    beforeEach(() => {
      mockRepo = new PushDeviceRepository();
      mockMessaging = {
        sendEachForMulticast: vi.fn(),
      };
      service = new PushNotificationService(mockRepo, mockMessaging);
    });

    it('returns zero counts if user has no registered devices', async () => {
      vi.spyOn(mockRepo, 'getDevicesByUserId').mockResolvedValue([]);

      const result = await service.sendToUser('user-without-devices', {
        title: 'Nova Escala',
        body: 'Você foi escalado.',
        data: { type: 'schedule' },
      });

      expect(result.totalDevices).toBe(0);
      expect(result.successCount).toBe(0);
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('sends multicast notification to active user devices successfully', async () => {
      const devices: PushDeviceRecord[] = [
        {
          id: 'dev-1',
          user_id: 'user-1',
          fcm_token: 'token-phone',
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: new Date().toISOString(),
        },
        {
          id: 'dev-2',
          user_id: 'user-1',
          fcm_token: 'token-tablet',
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(mockRepo, 'getDevicesByUserId').mockResolvedValue(devices);
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        responses: [{ success: true }, { success: true }],
      });

      const result = await service.sendToUser('user-1', {
        title: 'Escala Atualizada',
        body: 'Domingo Manhã',
        data: { type: 'schedule', scheduleId: 'sch-101' },
      });

      expect(result.totalDevices).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.invalidTokensRemoved).toBe(0);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['token-phone', 'token-tablet'],
        notification: { title: 'Escala Atualizada', body: 'Domingo Manhã' },
        data: { type: 'schedule', scheduleId: 'sch-101' },
      });
    });

    it('chunks multicast sends when total devices exceed 500 chunk limit', async () => {
      const devices: PushDeviceRecord[] = [];
      for (let i = 0; i < 505; i++) {
        devices.push({
          id: `dev-${i}`,
          user_id: 'user-popular',
          fcm_token: `token-${i}`,
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: new Date().toISOString(),
        });
      }

      vi.spyOn(mockRepo, 'getDevicesByUserId').mockResolvedValue(devices);

      mockMessaging.sendEachForMulticast
        .mockResolvedValueOnce({
          responses: new Array(500).fill({ success: true }),
        })
        .mockResolvedValueOnce({
          responses: new Array(5).fill({ success: true }),
        });

      const result = await service.sendToUser('user-popular', {
        title: 'Anúncio Geral',
        body: 'Muitos dispositivos',
        data: { type: 'announcement' },
      });

      expect(result.totalDevices).toBe(505);
      expect(result.successCount).toBe(505);
      expect(result.failureCount).toBe(0);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(mockMessaging.sendEachForMulticast.mock.calls[0][0].tokens).toHaveLength(500);
      expect(mockMessaging.sendEachForMulticast.mock.calls[1][0].tokens).toHaveLength(5);
    });

    it('automatically prunes invalid/unregistered FCM tokens when provider reports registration error', async () => {
      const devices: PushDeviceRecord[] = [
        {
          id: 'dev-valid',
          user_id: 'user-1',
          fcm_token: 'token-valid',
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: new Date().toISOString(),
        },
        {
          id: 'dev-stale',
          user_id: 'user-1',
          fcm_token: 'token-stale',
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(mockRepo, 'getDevicesByUserId').mockResolvedValue(devices);
      const deleteByIdSpy = vi.spyOn(mockRepo, 'deleteDeviceById').mockResolvedValue(undefined);

      mockMessaging.sendEachForMulticast.mockResolvedValue({
        responses: [
          { success: true },
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
        ],
      });

      const result = await service.sendToUser('user-1', {
        title: 'Alerta',
        body: 'Teste',
        data: { type: 'announcement' },
      });

      expect(result.totalDevices).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.invalidTokensRemoved).toBe(1);
      expect(deleteByIdSpy).toHaveBeenCalledWith('dev-stale');
    });

    it('does NOT prune tokens on transient FCM errors', async () => {
      const devices: PushDeviceRecord[] = [
        {
          id: 'dev-transient',
          user_id: 'user-1',
          fcm_token: 'token-transient',
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(mockRepo, 'getDevicesByUserId').mockResolvedValue(devices);
      const deleteByIdSpy = vi.spyOn(mockRepo, 'deleteDeviceById');

      mockMessaging.sendEachForMulticast.mockResolvedValue({
        responses: [
          {
            success: false,
            error: { code: 'messaging/server-unavailable' },
          },
        ],
      });

      const result = await service.sendToUser('user-1', {
        title: 'Alerta',
        body: 'Teste',
        data: { type: 'announcement' },
      });

      expect(result.totalDevices).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.invalidTokensRemoved).toBe(0);
      expect(deleteByIdSpy).not.toHaveBeenCalled();
    });

    it('handles unexpected messaging client exceptions without corrupting registrations', async () => {
      const devices: PushDeviceRecord[] = [
        {
          id: 'dev-1',
          user_id: 'user-1',
          fcm_token: 'token-1',
          platform: 'android',
          created_at: '',
          updated_at: '',
          last_seen_at: '',
        },
      ];

      vi.spyOn(mockRepo, 'getDevicesByUserId').mockResolvedValue(devices);
      const deleteByIdSpy = vi.spyOn(mockRepo, 'deleteDeviceById');
      mockMessaging.sendEachForMulticast.mockRejectedValue(new Error('Firebase service unavailable'));

      const result = await service.sendToUser('user-1', {
        title: 'Alerta',
        body: 'Teste',
        data: { type: 'announcement' },
      });

      expect(result.totalDevices).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.invalidTokensRemoved).toBe(0);
      expect(deleteByIdSpy).not.toHaveBeenCalled();
    });
  });
});
