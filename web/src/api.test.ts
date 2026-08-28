import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, getFriendlyErrorMessage } from './api';

describe('API Client & Structured Error Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve mapear erros estruturados para mensagens amigáveis', () => {
    const memberQuotaErr = new ApiError('Quota excedida', 403, { code: 'PLAN_MEMBER_QUOTA_REACHED' });
    expect(getFriendlyErrorMessage(memberQuotaErr)).toMatch(/Você atingiu o limite de membros do seu plano/i);

    const songQuotaErr = new ApiError('Quota excedida', 403, { code: 'PLAN_SONG_QUOTA_REACHED' });
    expect(getFriendlyErrorMessage(songQuotaErr)).toMatch(/Você atingiu o limite de músicas do seu plano/i);

    const restrictedErr = new ApiError('Restricted', 403, { code: 'SUBSCRIPTION_RESTRICTED' });
    expect(getFriendlyErrorMessage(restrictedErr)).toMatch(/Seu ministério está acima dos limites do plano atual/i);

    const suspendedErr = new ApiError('Suspended', 403, { code: 'SUBSCRIPTION_SUSPENDED' });
    expect(getFriendlyErrorMessage(suspendedErr)).toMatch(/Este ministério está suspenso/i);

    const deniedErr = new ApiError('Denied', 403, { code: 'MINISTRY_ACCESS_DENIED' });
    expect(getFriendlyErrorMessage(deniedErr)).toMatch(/Acesso negado\. Você não é integrante/i);

    const genericErr = new Error('Erro genérico');
    expect(getFriendlyErrorMessage(genericErr)).toBe('Erro genérico');
  });

  it('deve consultar getPlans com sucesso', async () => {
    const mockPlans = {
      plans: [{ id: 'free', name: 'Free', baseMembers: 10, baseSongs: 50, allowMemberAddons: false, maxMemberAddonBlocks: 0 }],
      addonBlockSize: 10,
      defaultGracePeriodDays: 7,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockPlans)),
    } as any);

    const result = await api.getPlans();
    expect(result.plans).toHaveLength(1);
    expect(result.addonBlockSize).toBe(10);
  });

  it('deve consultar getMinistrySubscription com sucesso', async () => {
    const mockSub = {
      plan: { id: 'essential', name: 'Essential' },
      subscription: { planId: 'essential', accessMode: 'normal' },
      quotas: { members: 40, songs: 200 },
      usage: { membersCount: 12, songsCount: 30 },
      isOverLimit: false,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockSub)),
    } as any);

    const result = await api.getMinistrySubscription('min-123');
    expect(result.plan.id).toBe('essential');
    expect(result.usage.membersCount).toBe(12);
  });
});
