import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforceOperationalAccess } from './quota-enforcement';
import { SubscriptionService } from '../features/subscriptions/subscription.service';
import { AppError } from './error-handler';

describe('Middleware: enforceOperationalAccess (Hardening & Semantic Enforcement)', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let getSubscriptionSummarySpy: any;

  beforeEach(() => {
    mockReq = {
      params: { ministryId: 'min-test' },
      body: {},
      method: 'POST',
      url: '/api/v1/ministries/min-test/schedules',
      path: '/schedules',
    };
    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    getSubscriptionSummarySpy = vi.spyOn(SubscriptionService.prototype, 'getSubscriptionSummary');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve permitir a requisição se não houver ministryId nos parâmetros ou corpo', async () => {
    mockReq.params = {};
    mockReq.body = {};

    await enforceOperationalAccess(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('deve permitir requisições normais no modo "normal"', async () => {
    getSubscriptionSummarySpy.mockResolvedValue({
      subscription: {
        accessMode: 'normal',
        administrativelySuspended: false,
      },
      quotas: { members: 10, songs: 50 },
      usage: { membersCount: 5, songsCount: 20 },
      isOverLimit: false,
    });

    await enforceOperationalAccess(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
    expect(mockReq.subscriptionSummary).toBeDefined();
  });

  it('deve permitir acesso operacional geral no modo "grace" (carência ativa)', async () => {
    getSubscriptionSummarySpy.mockResolvedValue({
      subscription: {
        accessMode: 'grace',
        administrativelySuspended: false,
      },
      quotas: { members: 10, songs: 50 },
      usage: { membersCount: 25, songsCount: 20 },
      isOverLimit: true,
      graceDaysRemaining: 5,
    });

    await enforceOperationalAccess(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  describe('Modo "restricted_over_limit" (Remediação estrita vs Deleção arbitrária)', () => {
    beforeEach(() => {
      getSubscriptionSummarySpy.mockResolvedValue({
        subscription: {
          accessMode: 'restricted_over_limit',
          administrativelySuspended: false,
        },
        quotas: { members: 10, songs: 50 },
        usage: { membersCount: 30, songsCount: 80 },
        isOverLimit: true,
        overLimitDetails: { membersOver: true, songsOver: true },
        graceDaysRemaining: 0,
      });
    });

    it('deve PERMITIR requisições GET de leitura pura', async () => {
      mockReq.method = 'GET';
      await enforceOperationalAccess(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('deve BLOQUEAR requisições POST com HTTP 403 SUBSCRIPTION_RESTRICTED', async () => {
      mockReq.method = 'POST';
      await enforceOperationalAccess(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = mockNext.mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(403);
      expect((error.details as any)?.code).toBe('SUBSCRIPTION_RESTRICTED');
      expect((error.details as any)?.accessMode).toBe('restricted_over_limit');
    });

    it('deve BLOQUEAR deleções operacionais arbitrárias (ex: DELETE templates/folders/artists) sem remediação', async () => {
      mockReq.method = 'DELETE';
      mockReq.path = '/templates/template-123';

      // Middleware padrão sem flag isRemediation
      await enforceOperationalAccess(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = mockNext.mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(403);
      expect((error.details as any)?.code).toBe('SUBSCRIPTION_RESTRICTED');
    });

    it('deve PERMITIR deleções explicitamente classificadas como remediação (ex: DELETE members ou DELETE songs)', async () => {
      mockReq.method = 'DELETE';
      mockReq.path = '/members/member-123';

      // Middleware com capability isRemediation
      await enforceOperationalAccess.remediation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('Modo "suspended" (Suspensão Administrativa da Plataforma)', () => {
    beforeEach(() => {
      getSubscriptionSummarySpy.mockResolvedValue({
        subscription: {
          accessMode: 'suspended',
          administrativelySuspended: true,
        },
        quotas: { members: 10, songs: 50 },
        usage: { membersCount: 5, songsCount: 20 },
        isOverLimit: false,
      });
    });

    it('deve permitir GET exclusivamente na rota de status de subscription ou inspeção inicial', async () => {
      mockReq.method = 'GET';
      mockReq.path = '/subscription';
      await enforceOperationalAccess(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('deve BLOQUEAR GET de rotas operacionais (ex: /schedules, /songs) com HTTP 403 SUBSCRIPTION_SUSPENDED', async () => {
      mockReq.method = 'GET';
      mockReq.path = '/schedules';
      await enforceOperationalAccess(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = mockNext.mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(403);
      expect((error.details as any)?.code).toBe('SUBSCRIPTION_SUSPENDED');
      expect((error.details as any)?.accessMode).toBe('suspended');
    });

    it('deve BLOQUEAR todas as mutações e até mesmo deleções de remediação em ministério suspenso', async () => {
      mockReq.method = 'DELETE';
      mockReq.path = '/members/member-123';

      await enforceOperationalAccess.remediation(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = mockNext.mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(403);
      expect((error.details as any)?.code).toBe('SUBSCRIPTION_SUSPENDED');
    });
  });
});
