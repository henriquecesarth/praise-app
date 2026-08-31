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

  it('REGRESSÃO HTTP: createBillingCheckout deve usar POST e enviar payload correto', async () => {
    const mockResult = {
      checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show/chk_real_123',
      checkoutId: 'chk_real_123',
      expiresAt: '2026-08-31T15:00:00.000Z',
      totalPriceCents: 1490,
      currency: 'BRL',
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockResult)),
    } as any);
    global.fetch = fetchSpy;

    const checkoutParams = {
      planId: 'lite',
      interval: 'monthly' as const,
      addonBlocks: 0,
      successUrl: 'http://localhost:5173/ministerio/plano?status=success',
      cancelUrl: 'http://localhost:5173/ministerio/plano',
    };

    const result = await api.createBillingCheckout('min-123', checkoutParams);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];

    expect(calledUrl).toMatch(/\/ministries\/min-123\/billing\/checkout$/);
    expect(calledOptions.method).toBe('POST');
    expect(calledOptions.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });
    expect(JSON.parse(calledOptions.body)).toEqual(checkoutParams);
    expect(result).toEqual(mockResult);
  });

  it('REGRESSÃO HTTP: cancelBillingSubscription e reactivateBillingSubscription devem usar POST', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'OK', subscription: {} })),
    } as any);
    global.fetch = fetchSpy;

    await api.cancelBillingSubscription('min-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/ministries\/min-123\/billing\/cancel$/),
      expect.objectContaining({ method: 'POST' })
    );

    await api.reactivateBillingSubscription('min-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/ministries\/min-123\/billing\/reactivate$/),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
