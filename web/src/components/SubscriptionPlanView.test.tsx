import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscriptionPlanView } from './SubscriptionPlanView';
import { api } from '../api';

describe('SubscriptionPlanView Component', () => {
  const mockShowToast = vi.fn();
  const mockOnBack = vi.fn();

  const mockPlansResponse = {
    plans: [
      { id: 'free', name: 'Free', baseMembers: 10, baseSongs: 50, allowMemberAddons: false, maxMemberAddonBlocks: 0 },
      { id: 'lite', name: 'Lite', baseMembers: 20, baseSongs: 100, allowMemberAddons: false, maxMemberAddonBlocks: 0 },
      { id: 'lite_plus', name: 'Lite+', baseMembers: 30, baseSongs: 150, allowMemberAddons: false, maxMemberAddonBlocks: 0 },
      { id: 'essential', name: 'Essential', baseMembers: 40, baseSongs: 200, allowMemberAddons: true, maxMemberAddonBlocks: 4 },
      { id: 'pro', name: 'Pro', baseMembers: 100, baseSongs: 500, allowMemberAddons: true, maxMemberAddonBlocks: 10 },
      { id: 'premium', name: 'Premium', baseMembers: 'unlimited', baseSongs: 'unlimited', allowMemberAddons: false, maxMemberAddonBlocks: 0 },
    ],
    addonBlockSize: 10,
    defaultGracePeriodDays: 7,
  };

  const mockSummaryEssential = {
    plan: { id: 'essential', name: 'Essential', baseMembers: 40, baseSongs: 200, allowMemberAddons: true, maxMemberAddonBlocks: 4 },
    subscription: {
      planId: 'essential',
      memberAddonBlocks: 2,
      billingStatus: 'active',
      administrativelySuspended: false,
      suspendedAt: null,
      suspensionReason: null,
      accessMode: 'normal',
      gracePeriodExpiresAt: null,
      currentPeriodStart: '2026-08-28T12:00:00.000Z',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    quotas: { members: 60, songs: 200 },
    usage: { membersCount: 38, songsCount: 115 },
    isOverLimit: false,
    overLimitDetails: { membersOver: false, songsOver: false },
    graceDaysRemaining: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deve renderizar o plano atual, quotas, add-ons e os 6 planos disponíveis', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-123"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Plano atual Essential
    expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
    expect(screen.getByText(/^Ativo$/i)).toBeInTheDocument();

    // Membros (38 de 60) e add-ons (+20)
    expect(screen.getByText('38 de 60')).toBeInTheDocument();
    expect(screen.getByText('+20 membros adicionais (2 blocos)')).toBeInTheDocument();

    // Músicas (115 de 200)
    expect(screen.getByText('115 de 200')).toBeInTheDocument();

    // Comparativo dos 6 planos
    expect(screen.getByRole('heading', { level: 2, name: 'Planos disponíveis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Free' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Lite' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Lite\+/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Pro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Premium' })).toBeInTheDocument();

    // Destaque "Seu plano"
    expect(screen.getByText('Seu plano')).toBeInTheDocument();
  });

  it('deve formatar Premium como Ilimitado sem barra numérica finita', async () => {
    const mockSummaryPremium = {
      plan: { id: 'premium', name: 'Premium', baseMembers: 'unlimited', baseSongs: 'unlimited', allowMemberAddons: false, maxMemberAddonBlocks: 0 },
      subscription: {
        planId: 'premium',
        memberAddonBlocks: 0,
        billingStatus: 'active',
        administrativelySuspended: false,
        suspendedAt: null,
        suspensionReason: null,
        accessMode: 'normal',
        gracePeriodExpiresAt: null,
        currentPeriodStart: '2026-08-28T12:00:00.000Z',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      quotas: { members: 'unlimited', songs: 'unlimited' },
      usage: { membersCount: 45, songsCount: 320 },
      isOverLimit: false,
      overLimitDetails: { membersOver: false, songsOver: false },
      graceDaysRemaining: null,
    };

    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryPremium as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-premium"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    expect(await screen.findByText('45 · Ilimitado')).toBeInTheDocument();
    expect(screen.getByText('320 · Ilimitado')).toBeInTheDocument();
  });

  it('deve exibir mensagem de erro e permitir tentar novamente quando a API falhar', async () => {
    vi.spyOn(api, 'getMinistrySubscription')
      .mockRejectedValueOnce(new Error('Falha de rede ao consultar plano'))
      .mockResolvedValueOnce(mockSummaryEssential as any);

    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-err"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    expect(await screen.findByText('Erro ao carregar informações')).toBeInTheDocument();
    expect(screen.getByText('Falha de rede ao consultar plano')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Tentar novamente/i });
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);

    expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
  });
});
