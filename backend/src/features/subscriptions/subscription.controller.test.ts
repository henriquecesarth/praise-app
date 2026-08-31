import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { AppError } from '../../middleware/error-handler';

describe('SubscriptionController & Tenant Isolation', () => {
  let controller: SubscriptionController;
  let mockSubscriptionService: any;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockSubscriptionService = {
      getSubscriptionSummary: vi.fn(),
    };

    controller = new SubscriptionController(mockSubscriptionService);

    mockReq = {
      params: { ministryId: 'min-alpha' },
      user: { id: 'user-alpha', email: 'alpha@test.com' },
    };
    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/v1/plans', () => {
    it('deve retornar o catálogo público dos 6 planos comerciais e parâmetros de add-on', async () => {
      await controller.getPlans(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledTimes(1);
      const response = mockRes.json.mock.calls[0][0];

      expect(response.plans).toHaveLength(6);
      expect(response.addonBlockSize).toBe(10);
      expect(response.defaultGracePeriodDays).toBe(7);

      const planIds = response.plans.map((p: any) => p.id);
      expect(planIds).toEqual(['free', 'lite', 'lite_plus', 'essential', 'pro', 'premium']);

      const premium = response.plans.find((p: any) => p.id === 'premium');
      expect(premium.baseMembers).toBe(300);
      expect(premium.baseSongs).toBe(1500);
      expect(premium.monthlyPriceCents).toBe(21490);
      expect(premium.annualPriceCents).toBe(232092);

      const essential = response.plans.find((p: any) => p.id === 'essential');
      expect(essential.allowMemberAddons).toBe(true);
      expect(essential.maxMemberAddonBlocks).toBe(4);
      expect(essential.monthlyPriceCents).toBe(3490);
      expect(essential.annualPriceCents).toBe(37692);
      expect(essential.addonBlockMonthlyPriceCents).toBe(990);
    });

  });

  describe('GET /api/v1/ministries/:ministryId/subscription', () => {
    it('deve retornar o resumo resolvido de assinatura para um integrante do ministério', async () => {
      const mockSummary = {
        plan: { id: 'free', name: 'Free' },
        subscription: { planId: 'free', accessMode: 'normal' },
        quotas: { members: 10, songs: 50 },
        usage: { membersCount: 3, songsCount: 15 },
        isOverLimit: false,
        graceDaysRemaining: null,
      };

      mockSubscriptionService.getSubscriptionSummary.mockResolvedValue(mockSummary);

      await controller.getMinistrySubscription(mockReq, mockRes, mockNext);

      expect(mockSubscriptionService.getSubscriptionSummary).toHaveBeenCalledWith('min-alpha');
      expect(mockRes.json).toHaveBeenCalledWith(mockSummary);
    });
  });

  describe('Tenant Isolation e Verificação de Pertencimento (MinistryRepository)', () => {
    it('deve impedir que User A acesse dados de Ministry B quando não for integrante', async () => {
      const realMinistryRepo = new MinistryRepository();

      (realMinistryRepo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'min-beta',
            data: () => ({ name: 'Ministry Beta', owner_user_id: 'user-beta' }),
          }),
        }),
      };

      (realMinistryRepo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true }), // Não é membro de min-beta!
            }),
          }),
        }),
      };

      await expect(realMinistryRepo.getMinistryById('min-beta', 'user-alpha')).rejects.toThrow(
        /Acesso negado\. Você não é integrante deste ministério/i
      );
    });

    it('deve permitir acesso para o proprietário mesmo sem doc explícito de membro', async () => {
      const realMinistryRepo = new MinistryRepository();

      (realMinistryRepo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'min-alpha',
            data: () => ({ name: 'Ministry Alpha', owner_user_id: 'user-alpha' }),
          }),
        }),
      };

      const result = await realMinistryRepo.getMinistryById('min-alpha', 'user-alpha');
      expect(result.id).toBe('min-alpha');
      expect(result.role).toBe('admin');
    });
  });
});
