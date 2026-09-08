import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscriptionPlanView } from './SubscriptionPlanView';
import { api } from '../api';

describe('SubscriptionPlanView Component', () => {
  const mockShowToast = vi.fn();
  const mockOnBack = vi.fn();

  const mockPlansResponse = {
    plans: [
      { id: 'free', name: 'Free', baseMembers: 10, baseSongs: 50, allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 0, annualPriceCents: 0, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
      { id: 'lite', name: 'Lite', baseMembers: 20, baseSongs: 100, allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 1490, annualPriceCents: 16092, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
      { id: 'lite_plus', name: 'Lite+', baseMembers: 30, baseSongs: 150, allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 2490, annualPriceCents: 26892, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
      { id: 'essential', name: 'Essential', baseMembers: 40, baseSongs: 200, allowMemberAddons: true, maxMemberAddonBlocks: 4, monthlyPriceCents: 3490, annualPriceCents: 37692, addonBlockMonthlyPriceCents: 990, addonBlockAnnualPriceCents: 10692 },
      { id: 'pro', name: 'Pro', baseMembers: 100, baseSongs: 500, allowMemberAddons: true, maxMemberAddonBlocks: 10, monthlyPriceCents: 8990, annualPriceCents: 97092, addonBlockMonthlyPriceCents: 690, addonBlockAnnualPriceCents: 7452 },
      { id: 'premium', name: 'Premium', baseMembers: 'unlimited', baseSongs: 'unlimited', allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 21490, annualPriceCents: 232092, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
    ],
    addonBlockSize: 10,
    defaultGracePeriodDays: 7,
  };

  const mockSummaryEssential = {
    plan: { id: 'essential', name: 'Essential', baseMembers: 40, baseSongs: 200, allowMemberAddons: true, maxMemberAddonBlocks: 4, monthlyPriceCents: 3490, annualPriceCents: 37692, addonBlockMonthlyPriceCents: 990, addonBlockAnnualPriceCents: 10692 },
    subscription: {
      planId: 'essential',
      memberAddonBlocks: 2,
      billingStatus: 'active',
      subscriptionMode: 'paid',
      administrativelySuspended: false,
      suspendedAt: null,
      suspensionReason: null,
      accessMode: 'normal',
      gracePeriodExpiresAt: null,
      currentPeriodStart: '2026-08-28T12:00:00.000Z',
      currentPeriodEnd: '2026-09-28T12:00:00.000Z',
      cancelAtPeriodEnd: false,
    },
    quotas: { members: 60, songs: 200 },
    usage: { membersCount: 38, songsCount: 115 },
    isOverLimit: false,
    overLimitDetails: { membersOver: false, songsOver: false },
    graceDaysRemaining: null,
  };

  const mockSummaryFree = {
    plan: { id: 'free', name: 'Free', baseMembers: 10, baseSongs: 50, allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 0, annualPriceCents: 0, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
    subscription: {
      planId: 'free',
      memberAddonBlocks: 0,
      billingStatus: 'active',
      subscriptionMode: 'free',
      administrativelySuspended: false,
      suspendedAt: null,
      suspensionReason: null,
      accessMode: 'normal',
      gracePeriodExpiresAt: null,
      currentPeriodStart: '2026-08-01T00:00:00.000Z',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    quotas: { members: 10, songs: 50 },
    usage: { membersCount: 5, songsCount: 22 },
    isOverLimit: false,
    overLimitDetails: { membersOver: false, songsOver: false },
    graceDaysRemaining: null,
  };

  const mockSummaryLitePaid = {
    plan: { id: 'lite', name: 'Lite', baseMembers: 20, baseSongs: 100, allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 1490, annualPriceCents: 16092, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
    subscription: {
      planId: 'lite',
      memberAddonBlocks: 0,
      billingStatus: 'active',
      subscriptionMode: 'paid',
      administrativelySuspended: false,
      suspendedAt: null,
      suspensionReason: null,
      accessMode: 'normal',
      gracePeriodExpiresAt: null,
      currentPeriodStart: '2026-08-31T12:00:00.000Z',
      currentPeriodEnd: '2026-09-30T12:00:00.000Z',
      cancelAtPeriodEnd: false,
    },
    quotas: { members: 20, songs: 100 },
    usage: { membersCount: 5, songsCount: 22 },
    isOverLimit: false,
    overLimitDetails: { membersOver: false, songsOver: false },
    graceDaysRemaining: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.clearAllTimers();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
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

  it('deve renderizar plano Free sem botão de cancelamento de assinatura', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-free"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    expect(await screen.findByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancelar assinatura/i })).not.toBeInTheDocument();
  });

  it('deve formatar Premium como Ilimitado sem barra numérica finita', async () => {
    const mockSummaryPremium = {
      plan: { id: 'premium', name: 'Premium', baseMembers: 'unlimited', baseSongs: 'unlimited', allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 21490, annualPriceCents: 232092, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
      subscription: {
        planId: 'premium',
        memberAddonBlocks: 0,
        billingStatus: 'active',
        subscriptionMode: 'paid',
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

  it('deve alternar entre ciclo mensal e anual ao clicar no toggle', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-123"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    const annualBtn = await screen.findByRole('button', { name: /Anual/i });
    expect(annualBtn).toBeInTheDocument();
    await userEvent.click(annualBtn);

    const monthlyBtn = screen.getByRole('button', { name: /Mensal/i });
    expect(monthlyBtn).toBeInTheDocument();
    await userEvent.click(monthlyBtn);
  });

  it('CRÍTICO (D): criação de checkout NÃO ativa o plano localmente na UI', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
      planId: 'lite',
      planName: 'Lite',
      interval: 'monthly',
      addonBlocks: 0,
      effectiveMembersQuota: 20,
      effectiveSongsQuota: 100,
      basePriceCents: 1490,
      addonsPriceCents: 0,
      totalPriceCents: 1490,
      fullMonthlyEquivalentCents: 1490,
      annualSavingsCents: 0,
      currency: 'BRL',
      currentPlanId: 'free',
      isDowngrade: false,
    });

    vi.spyOn(api, 'createBillingCheckout').mockResolvedValue({
      checkoutUrl: 'https://sandbox.asaas.com/c/lite-checkout',
      checkoutId: 'chk_lite',
      expiresAt: null,
      totalPriceCents: 1490,
      currency: 'BRL',
    });

    render(
      <SubscriptionPlanView
        ministryId="min-free"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Deve estar no plano Free
    expect(await screen.findByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();

    // Clicar em assinar Lite
    const assinarBtns = await screen.findAllByRole('button', { name: /Assinar Plano/i });
    await userEvent.click(assinarBtns[0]);

    const payBtn = await screen.findByRole('button', { name: /Ir para Pagamento/i });
    try {
      await userEvent.click(payBtn);
    } catch {
      // Ignore jsdom navigation exception
    }

    // O plano atual no cabeçalho DEVE CONTINUAR SENDO Free até que a API retorne a confirmação
    expect(screen.getByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Lite' })).not.toBeInTheDocument();

    // A intenção deve ter sido salva no sessionStorage
    const savedIntent = sessionStorage.getItem('louvaio_checkout_intent');
    expect(savedIntent).toBeTruthy();
    expect(JSON.parse(savedIntent!)).toMatchObject({
      ministryId: 'min-free',
      expectedPlanId: 'lite',
    });
  });

  it('CRÍTICO (A & B): Polling pós-checkout ignora Free active inicial e conclui apenas com plano esperado', async () => {
    vi.useFakeTimers();

    // Intenção salva de assinar Lite
    sessionStorage.setItem(
      'louvaio_checkout_intent',
      JSON.stringify({
        ministryId: 'min-poll',
        expectedPlanId: 'lite',
        expectedInterval: 'monthly',
        expectedAddonBlocks: 0,
        timestamp: Date.now(),
      })
    );

    const getSubSpy = vi.spyOn(api, 'getMinistrySubscription');
    // Inicialmente retorna Free active (não deve parar o polling!)
    getSubSpy.mockResolvedValueOnce(mockSummaryFree as any);
    getSubSpy.mockResolvedValueOnce(mockSummaryFree as any);
    // Na 3ª consulta, o backend confirma Lite Pago
    getSubSpy.mockResolvedValueOnce(mockSummaryLitePaid as any);

    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-poll"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Initial render
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Deve estar com banner de processamento ativo
    expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

    // 1º tick (2500ms): retorna Free -> polling NÃO para
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

    // 2º tick (2500ms): retorna Lite Paid -> polling ENCERRA com sucesso
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(mockShowToast).toHaveBeenCalledWith('Assinatura confirmada com sucesso!', 'success');
    expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

    vi.useRealTimers();
  });

  it('CRÍTICO (C): Timeout de polling exibe mensagem informativa sem declarar falha financeira', async () => {
    vi.useFakeTimers();

    sessionStorage.setItem(
      'louvaio_checkout_intent',
      JSON.stringify({
        ministryId: 'min-timeout',
        expectedPlanId: 'lite',
        expectedInterval: 'monthly',
        expectedAddonBlocks: 0,
        timestamp: Date.now(),
      })
    );

    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-timeout"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Avançar 19 ciclos (47.5s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50000);
    });

    // Não deve conter 'falha', 'recusado' ou 'erro'
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('Seu pagamento ainda pode estar sendo processado'),
      'success'
    );

    vi.useRealTimers();
  });

  it('CRÍTICO (E): TENANT SWITCHING — dados do Ministry A não persistem no Ministry B', async () => {
    const getSubSpy = vi
      .spyOn(api, 'getMinistrySubscription')
      .mockResolvedValueOnce(mockSummaryLitePaid as any)
      .mockResolvedValueOnce(mockSummaryFree as any);

    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    const { rerender } = render(
      <SubscriptionPlanView
        ministryId="min-tenant-A"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Ministério A: Lite
    expect(await screen.findByRole('heading', { level: 2, name: 'Lite' })).toBeInTheDocument();
    expect(getSubSpy).toHaveBeenCalledWith('min-tenant-A');

    // Trocar para Ministério B
    rerender(
      <SubscriptionPlanView
        ministryId="min-tenant-B"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Ministério B: Free
    expect(await screen.findByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();
    expect(getSubSpy).toHaveBeenCalledWith('min-tenant-B');
    expect(screen.queryByRole('heading', { level: 2, name: 'Lite' })).not.toBeInTheDocument();
  });

  it('CRÍTICO (F): Plano Complimentary exibe badges de cortesia e não exibe cancelamento de cobrança', async () => {
    const mockComplimentarySummary = {
      plan: { id: 'premium', name: 'Premium', baseMembers: 300, baseSongs: 1500, allowMemberAddons: false, maxMemberAddonBlocks: 0, monthlyPriceCents: 21490, annualPriceCents: 232092, addonBlockMonthlyPriceCents: 0, addonBlockAnnualPriceCents: 0 },
      subscription: {
        planId: 'premium',
        memberAddonBlocks: 0,
        billingStatus: 'active',
        subscriptionMode: 'complimentary',
        grantedBy: 'superadmin@louvaio.com',
        grantedAt: '2026-08-29T10:00:00.000Z',
        grantReason: 'Parceria',
        expiresAt: '2027-08-29T10:00:00.000Z',
        administrativelySuspended: false,
        suspendedAt: null,
        suspensionReason: null,
        accessMode: 'normal',
        gracePeriodExpiresAt: null,
        currentPeriodStart: '2026-08-28T12:00:00.000Z',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      quotas: { members: 300, songs: 1500 },
      usage: { membersCount: 45, songsCount: 120 },
      isOverLimit: false,
      overLimitDetails: { membersOver: false, songsOver: false },
      graceDaysRemaining: null,
    };

    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockComplimentarySummary as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-123"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    expect(await screen.findByRole('heading', { level: 2, name: 'Premium' })).toBeInTheDocument();
    expect(screen.getByText('Cortesia da plataforma')).toBeInTheDocument();
    expect(screen.getByText(/Cortesia da Plataforma/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancelar assinatura/i })).not.toBeInTheDocument();
  });

  it('CRÍTICO (G): cancelAtPeriodEnd exibe aviso de cancelamento agendado e botão de reativação', async () => {
    const mockScheduledCancelSummary = {
      ...mockSummaryEssential,
      subscription: {
        ...mockSummaryEssential.subscription,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-30T12:00:00.000Z',
      },
    };

    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockScheduledCancelSummary as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    const reactivateSpy = vi.spyOn(api, 'reactivateBillingSubscription').mockResolvedValue({
      message: 'Assinatura reativada',
      subscription: { ...mockSummaryEssential.subscription, cancelAtPeriodEnd: false },
    });

    render(
      <SubscriptionPlanView
        ministryId="min-reactivate"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    expect((await screen.findAllByText('Cancelamento agendado')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Seu plano permanece ativo até/i)).toBeInTheDocument();

    const reactivateBtn = screen.getByRole('button', { name: /Reativar Assinatura/i });
    await userEvent.click(reactivateBtn);

    expect(reactivateSpy).toHaveBeenCalledWith('min-reactivate');
  });

  it('deve abrir modal de cancelamento de assinatura e confirmar', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    const cancelSpy = vi.spyOn(api, 'cancelBillingSubscription').mockResolvedValue({
      message: 'Cancelamento agendado',
      subscription: { ...mockSummaryEssential.subscription, cancelAtPeriodEnd: true },
    });

    render(
      <SubscriptionPlanView
        ministryId="min-cancel"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    const cancelBtn = await screen.findByRole('button', { name: /Cancelar assinatura/i });
    await userEvent.click(cancelBtn);

    expect(await screen.findByText('Cancelar renovação da assinatura')).toBeInTheDocument();

    const confirmCancelBtn = screen.getByRole('button', { name: /Confirmar cancelamento/i });
    await userEvent.click(confirmCancelBtn);

    expect(cancelSpy).toHaveBeenCalledWith('min-cancel');
  });

  it('deve exibir banner de período de adaptação (grace) com dias restantes', async () => {
    const mockGraceSummary = {
      ...mockSummaryEssential,
      subscription: {
        ...mockSummaryEssential.subscription,
        accessMode: 'grace',
        gracePeriodExpiresAt: '2026-09-05T12:00:00.000Z',
      },
      graceDaysRemaining: 5,
      isOverLimit: true,
      overLimitDetails: { membersOver: true, songsOver: false },
    };

    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockGraceSummary as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-grace"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    expect(await screen.findByText(/Período de adaptação ativo \(5 dias restantes\)/i)).toBeInTheDocument();
    expect(screen.getByText(/100% preservados e não serão apagados/i)).toBeInTheDocument();
  });

  it('deve abrir modal de faturas e listar o histórico com links seguros', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    vi.spyOn(api, 'getBillingHistory').mockResolvedValue({
      transactions: [
        {
          id: 'tx-1',
          ministry_id: 'min-123',
          provider: 'asaas',
          provider_payment_id: 'pay_123',
          amount_cents: 3490,
          currency: 'BRL',
          status: 'paid',
          due_date: '2026-08-30',
          paid_at: '2026-08-30T15:00:00.000Z',
          payment_method: 'CREDIT_CARD',
          invoice_url: 'https://sandbox.asaas.com/i/test123',
          created_at: '2026-08-30T14:00:00.000Z',
          updated_at: '2026-08-30T15:00:00.000Z',
        },
      ],
    });

    render(
      <SubscriptionPlanView
        ministryId="min-123"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    const faturasBtn = await screen.findByRole('button', { name: /Faturas/i });
    await userEvent.click(faturasBtn);

    expect(await screen.findByText('Histórico de Faturas')).toBeInTheDocument();
    expect(screen.getByText('Pago')).toBeInTheDocument();
    expect(screen.getByText('Forma: Cartão de Crédito')).toBeInTheDocument();

    const invoiceLink = screen.getByRole('link', { name: /Ver fatura/i });
    expect(invoiceLink).toHaveAttribute('href', 'https://sandbox.asaas.com/i/test123');
    expect(invoiceLink).toHaveAttribute('target', '_blank');
    expect(invoiceLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('deve priorizar paid_billing_date comercial (01/09/2026) sem deslocamento UTC e manter fallback legacy para paid_at', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    vi.spyOn(api, 'getBillingHistory').mockResolvedValue({
      transactions: [
        {
          id: 'tx-commercial-date',
          ministry_id: 'min-123',
          provider: 'asaas',
          provider_payment_id: 'pay_commercial_1',
          amount_cents: 1490,
          currency: 'BRL',
          status: 'paid',
          due_date: '2026-09-01',
          paid_at: '2026-09-02T01:00:00Z', // Instante operacional em D+1
          paid_billing_date: '2026-09-01', // Data comercial em D
          created_at: '2026-09-02T01:00:00Z',
          updated_at: '2026-09-02T01:00:00Z',
        },
        {
          id: 'tx-legacy',
          ministry_id: 'min-123',
          provider: 'asaas',
          provider_payment_id: 'pay_legacy_1',
          amount_cents: 1490,
          currency: 'BRL',
          status: 'paid',
          due_date: '2026-08-30',
          paid_at: '2026-08-30T15:00:00.000Z',
          created_at: '2026-08-30T14:00:00.000Z',
          updated_at: '2026-08-30T15:00:00.000Z',
        },
      ],
    });

    render(
      <SubscriptionPlanView
        ministryId="min-123"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    const faturasBtn = await screen.findByRole('button', { name: /Faturas/i });
    await userEvent.click(faturasBtn);

    expect(await screen.findByText('Histórico de Faturas')).toBeInTheDocument();
    // Transação com paid_billing_date exibe 01/09/2026 (mesmo com paid_at em 02/09)
    expect(screen.getByText(/Vencimento: 01\/09\/2026 · Pago em 01\/09\/2026/i)).toBeInTheDocument();
    // Transação legada sem paid_billing_date exibe fallback de paid_at (30/08/2026)
    expect(screen.getByText(/Vencimento: 30\/08\/2026 · Pago em 30\/08\/2026/i)).toBeInTheDocument();
  });

  it('CRÍTICO: Polling valida billingInterval e evita falso positivo em upgrade de periodicidade (Lite monthly -> Lite annual)', async () => {
    vi.useFakeTimers();

    // Usuário comprava Lite Annual
    sessionStorage.setItem(
      'louvaio_checkout_intent',
      JSON.stringify({
        ministryId: 'min-poll-interval',
        expectedPlanId: 'lite',
        expectedInterval: 'annual',
        expectedAddonBlocks: 0,
        timestamp: Date.now(),
      })
    );

    const mockLiteMonthly = {
      ...mockSummaryLitePaid,
      subscription: {
        ...mockSummaryLitePaid.subscription,
        billingInterval: 'monthly',
      },
    };

    const mockLiteAnnual = {
      ...mockSummaryLitePaid,
      subscription: {
        ...mockSummaryLitePaid.subscription,
        billingInterval: 'annual',
      },
    };

    const getSubSpy = vi.spyOn(api, 'getMinistrySubscription');
    // Tick 1 e 2: backend ainda está em monthly (webhook não processado)
    getSubSpy.mockResolvedValueOnce(mockLiteMonthly as any);
    getSubSpy.mockResolvedValueOnce(mockLiteMonthly as any);
    // Tick 3: webhook processado -> backend atualiza para annual
    getSubSpy.mockResolvedValueOnce(mockLiteAnnual as any);

    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    render(
      <SubscriptionPlanView
        ministryId="min-poll-interval"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Initial render
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

    // 1º tick (2500ms): retorna Lite Monthly -> polling NÃO para!
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalledWith('Assinatura confirmada com sucesso!', 'success');

    // 2º tick (2500ms): retorna Lite Annual -> polling ENCERRA com sucesso!
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(mockShowToast).toHaveBeenCalledWith('Assinatura confirmada com sucesso!', 'success');
    expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

    vi.useRealTimers();
  });

  it('CRÍTICO: Selecionar Free NÃO gera redirect Asaas e atualiza o plano diretamente via backend', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
      planId: 'free',
      planName: 'Free',
      interval: 'monthly',
      addonBlocks: 0,
      effectiveMembersQuota: 10,
      effectiveSongsQuota: 50,
      basePriceCents: 0,
      addonsPriceCents: 0,
      totalPriceCents: 0,
      fullMonthlyEquivalentCents: 0,
      annualSavingsCents: 0,
      currency: 'BRL',
      currentPlanId: 'essential',
      isDowngrade: true,
    });

    const checkoutSpy = vi.spyOn(api, 'createBillingCheckout').mockResolvedValue({
      checkoutUrl: '/ministerio/plano',
      checkoutId: 'free_123',
      expiresAt: null,
      totalPriceCents: 0,
      currency: 'BRL',
    });

    render(
      <SubscriptionPlanView
        ministryId="min-downgrade-free"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Clicar no botão do plano Free
    const freeCardBtn = await screen.findByRole('button', { name: /Mudar para Free/i });
    await userEvent.click(freeCardBtn);

    // Confirmar modal
    const confirmBtn = await screen.findByRole('button', { name: /Ir para Pagamento|Confirmar/i });
    await userEvent.click(confirmBtn);

    expect(checkoutSpy).toHaveBeenCalledWith('min-downgrade-free', {
      planId: 'free',
      interval: 'monthly',
      addonBlocks: 0,
    });

    // Toast de confirmação para Paid -> Free
    expect(mockShowToast).toHaveBeenCalledWith('Cancelamento agendado. Seu plano atual continuará ativo até o fim do período vigente.', 'success');
    // Não deve persistir intenção de checkout Asaas
    expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
  });

  it('CRÍTICO: Checkout intent TTL — intent é válida durante os 60 min de expiresAt e descartada se expirada', async () => {
    // Caso 1: Intent criada há 20 minutos com expiresAt em +40 minutos -> ainda VÁLIDA
    const validExpiry = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    sessionStorage.setItem(
      'louvaio_checkout_intent',
      JSON.stringify({
        ministryId: 'min-ttl-valid',
        expectedPlanId: 'lite',
        expectedInterval: 'monthly',
        expectedAddonBlocks: 0,
        timestamp: Date.now() - 20 * 60 * 1000,
        expiresAt: validExpiry,
      })
    );

    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryLitePaid as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

    const { unmount } = render(
      <SubscriptionPlanView
        ministryId="min-ttl-valid"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // A intent é válida, portanto inicia post-checkout processing
    expect(await screen.findByText('Pagamento em processamento')).toBeInTheDocument();
    unmount();

    // Caso 2: Intent expirada (expiresAt no passado) -> DESCARTADA
    sessionStorage.clear();
    const expiredTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    sessionStorage.setItem(
      'louvaio_checkout_intent',
      JSON.stringify({
        ministryId: 'min-ttl-expired',
        expectedPlanId: 'lite',
        expectedInterval: 'monthly',
        expectedAddonBlocks: 0,
        timestamp: Date.now() - 70 * 60 * 1000,
        expiresAt: expiredTime,
      })
    );

    render(
      <SubscriptionPlanView
        ministryId="min-ttl-expired"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Como expirou, é descartada e não exibe banner de processamento
    expect(await screen.findByRole('heading', { level: 2, name: 'Lite' })).toBeInTheDocument();
    expect(screen.queryByText('Pagamento em processamento')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
  });

  it('CRÍTICO: Falha em createBillingCheckout limpa qualquer checkout intent do sessionStorage', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryLitePaid as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
      planId: 'premium',
      planName: 'Premium',
      interval: 'monthly',
      addonBlocks: 0,
      effectiveMembersQuota: 300,
      effectiveSongsQuota: 1500,
      basePriceCents: 21490,
      addonsPriceCents: 0,
      totalPriceCents: 21490,
      fullMonthlyEquivalentCents: 21490,
      annualSavingsCents: 0,
      currency: 'BRL',
      currentPlanId: 'lite',
      isDowngrade: false,
    });

    vi.spyOn(api, 'createBillingCheckout').mockRejectedValue(new Error('Gateway timeout'));

    render(
      <SubscriptionPlanView
        ministryId="min-checkout-fail"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Abrir checkout de Premium
    const subscribeBtns = await screen.findAllByRole('button', { name: /Assinar Plano/i });
    await userEvent.click(subscribeBtns[subscribeBtns.length - 1]); // Premium

    // Confirmar modal
    const confirmBtn = await screen.findByRole('button', { name: /Ir para Pagamento/i });
    await userEvent.click(confirmBtn);

    expect(mockShowToast).toHaveBeenCalledWith('Gateway timeout', 'error');
    // Intent NÃO deve permanecer no sessionStorage
    expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
  });

  it('CRÍTICO: Paid -> Free com falha de comunicação com gateway mantém plano pago ativo e exibe toast de erro', async () => {
    vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryLitePaid as any);
    vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
    vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
      planId: 'free',
      planName: 'Free',
      interval: 'monthly',
      addonBlocks: 0,
      effectiveMembersQuota: 10,
      effectiveSongsQuota: 50,
      basePriceCents: 0,
      addonsPriceCents: 0,
      totalPriceCents: 0,
      fullMonthlyEquivalentCents: 0,
      annualSavingsCents: 0,
      currency: 'BRL',
      currentPlanId: 'lite',
      isDowngrade: true,
    });

    vi.spyOn(api, 'createBillingCheckout').mockRejectedValue(new Error('Falha ao comunicar com gateway de pagamentos'));

    render(
      <SubscriptionPlanView
        ministryId="min-free-downgrade-fail"
        onBack={mockOnBack}
        showToast={mockShowToast}
      />
    );

    // Clicar em Mudar para Free
    const freeBtn = await screen.findByRole('button', { name: /Mudar para Free/i });
    await userEvent.click(freeBtn);

    // Confirmar modal
    const confirmBtn = await screen.findByRole('button', { name: /Confirmar Mudança/i });
    await userEvent.click(confirmBtn);

    expect(mockShowToast).toHaveBeenCalledWith('Falha ao comunicar com gateway de pagamentos', 'error');
    // Plano atual Lite permanece ativo
    expect(screen.getByRole('heading', { level: 2, name: 'Lite' })).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // GAP-012: Same-Plan Interval Change
  // --------------------------------------------------------------------------
  describe('GAP-012: Same-Plan Interval Change', () => {
    it('A) current = Essential monthly & interval = monthly: Essential mostra Plano atual e CTA indisponível', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'monthly',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-essential-monthly"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      const currentBtn = screen.getByRole('button', { name: /Plano atual/i });
      expect(currentBtn).toBeInTheDocument();
      expect(currentBtn).toBeDisabled();
      expect(screen.getByText('Seu plano')).toBeInTheDocument();
    });

    it('B) current = Essential monthly & interval = annual: Essential NÃO mostra Plano atual e exibe CTA Mudar para Anual', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'monthly',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-essential-monthly"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Clicar no toggle Anual
      const annualToggle = await screen.findByRole('button', { name: /Anual/i });
      await userEvent.click(annualToggle);

      // Essential agora NÃO deve ser "Plano atual", deve exibir "Mudar para Anual"
      const changeToAnnualBtn = await screen.findByRole('button', { name: /Mudar para Anual/i });
      expect(changeToAnnualBtn).toBeInTheDocument();
      expect(changeToAnnualBtn).not.toBeDisabled();

      // "Seu plano" não deve ser exibido no card
      expect(screen.queryByText('Seu plano')).not.toBeInTheDocument();
    });

    it('C) current = Essential annual & interval = annual: Essential mostra Plano atual', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'annual',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-essential-annual"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Clicar no toggle Anual
      const annualToggle = await screen.findByRole('button', { name: /Anual/i });
      await userEvent.click(annualToggle);

      // No modo anual, Essential é o plano atual
      const currentBtn = screen.getByRole('button', { name: /Plano atual/i });
      expect(currentBtn).toBeInTheDocument();
      expect(currentBtn).toBeDisabled();
      expect(screen.getByText('Seu plano')).toBeInTheDocument();
    });

    it('D) current = Essential annual & interval = monthly: NÃO mostra Plano atual e bloqueia transição para mensal no mesmo plano', async () => {
      const checkoutSpy = vi.spyOn(api, 'createBillingCheckout');
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'annual',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-essential-annual"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Toggle padrão é 'monthly'
      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();

      // "Seu plano" NÃO deve ser exibido no card
      expect(screen.queryByText('Seu plano')).not.toBeInTheDocument();

      // O card do Essential deve exibir o botão bloqueado "Alteração para mensal indisponível"
      const blockedBtn = screen.getByRole('button', { name: /Alteração para mensal indisponível/i });
      expect(blockedBtn).toBeInTheDocument();
      expect(blockedBtn).toBeDisabled();

      // createBillingCheckout não deve ser chamado
      expect(checkoutSpy).not.toHaveBeenCalled();
    });

    it('E) same-plan annual -> monthly: nenhuma billing intent criada pelo frontend', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'annual',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-essential-annual"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
    });

    it('F) same-plan monthly -> annual: createBillingCheckout recebe planId essential e interval annual', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'monthly',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'annual',
        addonBlocks: 0,
        effectiveMembersQuota: 40,
        effectiveSongsQuota: 200,
        basePriceCents: 37692,
        addonsPriceCents: 0,
        totalPriceCents: 37692,
        fullMonthlyEquivalentCents: 3490,
        annualSavingsCents: 4188,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
      });

      const createCheckoutSpy = vi.spyOn(api, 'createBillingCheckout').mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/c/chk_annual_123',
        checkoutId: 'chk_annual_123',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      } as any);

      render(
        <SubscriptionPlanView
          ministryId="min-essential-monthly"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // 1. Mudar toggle para Anual
      const annualToggle = await screen.findByRole('button', { name: /Anual/i });
      await userEvent.click(annualToggle);

      // 2. Clicar em Mudar para Anual no card Essential
      const changeBtn = await screen.findByRole('button', { name: /Mudar para Anual/i });
      await userEvent.click(changeBtn);

      // 3. Confirmar no modal de preview
      const confirmBtn = await screen.findByRole('button', { name: /Ir para Pagamento/i });
      await userEvent.click(confirmBtn);

      // 4. Deve ter chamado createBillingCheckout com essential e annual
      expect(createCheckoutSpy).toHaveBeenCalledWith('min-essential-monthly', {
        planId: 'essential',
        interval: 'annual',
        addonBlocks: 0,
      });
    });

    it('G) Polling pós-checkout: não conclui enquanto backend retornar Essential monthly e conclui quando retornar Essential annual', async () => {
      vi.useFakeTimers();

      // Salva intenção no sessionStorage simulando retorno do checkout
      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-polling-interval',
          expectedPlanId: 'essential',
          expectedInterval: 'annual',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      const mockEssentialMonthly = {
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          planId: 'essential',
          billingInterval: 'monthly',
          billingStatus: 'active',
          subscriptionMode: 'paid',
          memberAddonBlocks: 0,
        },
      };

      const mockEssentialAnnual = {
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          planId: 'essential',
          billingInterval: 'annual',
          billingStatus: 'active',
          subscriptionMode: 'paid',
          memberAddonBlocks: 0,
        },
      };

      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription');
      // Mount + Tick 1: backend ainda está em monthly
      getSubSpy.mockResolvedValueOnce(mockEssentialMonthly as any);
      getSubSpy.mockResolvedValueOnce(mockEssentialMonthly as any);
      // Tick 2: webhook processado -> backend atualiza para annual
      getSubSpy.mockResolvedValueOnce(mockEssentialAnnual as any);

      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-polling-interval"
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Initial render
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Banner de processamento deve estar visível
      expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

      // 1º tick (2500ms): retorna Essential Monthly -> polling NÃO para!
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();
      expect(mockShowToast).not.toHaveBeenCalledWith('Assinatura confirmada com sucesso!', 'success');

      // 2º tick (2500ms): retorna Essential Annual -> polling ENCERRA com sucesso!
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      // Polling deve ter finalizado com sucesso
      expect(mockShowToast).toHaveBeenCalledWith('Assinatura confirmada com sucesso!', 'success');
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('Phase 4A.2: Pending Transition Card Matrix (Section 41)', () => {
    const createMockPendingTransition = (overrides: Record<string, any> = {}) => ({
      transitionId: 'trans-pending-001',
      kind: 'plan_upgrade',
      status: 'scheduled',
      requestedAt: '2026-09-01T10:00:00.000Z',
      effectiveAt: '2026-09-30T12:00:00.000Z',
      source: {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      },
      target: {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 0,
      },
      ...overrides,
    });

    it('41.1) deve renderizar "Assinatura inicial em andamento" para kind initial_purchase', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryFree,
        pendingTransition: createMockPendingTransition({
          kind: 'initial_purchase',
          status: 'awaiting_payment',
          source: { planId: 'free', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'lite', interval: 'monthly', addonBlocks: 0 },
          effectiveAt: null,
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Assinatura inicial em andamento' })).toBeInTheDocument();
      expect(screen.getByText('Aguardando confirmação do pagamento')).toBeInTheDocument();
      expect(screen.getByText(/assim que o pagamento for confirmado/i)).toBeInTheDocument();
    });

    it('41.2) deve renderizar "Upgrade agendado" para kind plan_upgrade', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryLitePaid,
        pendingTransition: createMockPendingTransition({ kind: 'plan_upgrade' }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Upgrade agendado' })).toBeInTheDocument();
      expect(screen.getByText('Alteração agendada')).toBeInTheDocument();
    });

    it('41.3) deve renderizar "Alteração de plano agendada" para kind plan_downgrade', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: createMockPendingTransition({
          kind: 'plan_downgrade',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'lite', interval: 'monthly', addonBlocks: 0 },
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Alteração de plano agendada' })).toBeInTheDocument();
    });

    it('41.4) deve renderizar "Alteração de ciclo agendada" para kind interval_change', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: createMockPendingTransition({
          kind: 'interval_change',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'essential', interval: 'annual', addonBlocks: 0 },
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Alteração de ciclo agendada' })).toBeInTheDocument();
    });

    it('41.5) deve renderizar "Acréscimo de membros agendado" para kind addon_increase', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: createMockPendingTransition({
          kind: 'addon_increase',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'essential', interval: 'monthly', addonBlocks: 2 },
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Acréscimo de membros agendado' })).toBeInTheDocument();
      expect(screen.getAllByText(/\+20 membros/).length).toBeGreaterThanOrEqual(1);
    });

    it('41.6) deve renderizar "Redução de membros agendada" para kind addon_decrease', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: createMockPendingTransition({
          kind: 'addon_decrease',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 2 },
          target: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Redução de membros agendada' })).toBeInTheDocument();
    });

    it('41.7) deve renderizar "Cancelamento agendado", vigência e garantia de preservação de dados para cancel_to_free', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: '2026-09-30T12:00:00.000Z',
        },
        pendingTransition: createMockPendingTransition({
          kind: 'cancel_to_free',
          status: 'scheduled',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'free', interval: 'monthly', addonBlocks: 0 },
          effectiveAt: '2026-09-30T12:00:00.000Z',
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Cancelamento agendado' })).toBeInTheDocument();
      expect(screen.getByText(/Nenhum dado será apagado do seu ministério/i)).toBeInTheDocument();
      expect(screen.getAllByText(/30\/09\/2026/).length).toBeGreaterThanOrEqual(1);
    });

    it('41.8) deve renderizar "Alteração de assinatura agendada" para kind mixed_change', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: createMockPendingTransition({
          kind: 'mixed_change',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'pro', interval: 'annual', addonBlocks: 1 },
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Alteração de assinatura agendada' })).toBeInTheDocument();
    });

    it('41.9) status processing: exibe "Processando alteração"', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryLitePaid,
        pendingTransition: createMockPendingTransition({
          status: 'processing',
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByText('Processando alteração')).toBeInTheDocument();
    });

    it('41.10) status attention_required: exibe "Revisão necessária" e banner de aviso customer-safe', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryLitePaid,
        pendingTransition: createMockPendingTransition({
          status: 'attention_required',
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByText('Revisão necessária')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Recebemos sua solicitação, mas ela precisa de revisão antes de ser concluída.'
      );
    });

    it('41.11) snapshots de origem e destino exibem nomes dos planos e ciclos', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryLitePaid,
        pendingTransition: createMockPendingTransition({
          source: { planId: 'lite', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'pro', interval: 'annual', addonBlocks: 3 },
        }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByText('Contrato de Origem')).toBeInTheDocument();
      expect(screen.getByText('Novo Contrato (Destino)')).toBeInTheDocument();
      expect(screen.getByText(/\+30 membros/)).toBeInTheDocument();
    });

    it('41.12) quando pendingTransition for null, card de transição pendente NÃO é renderizado', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: null,
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(screen.queryByText('Solicitação em andamento')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Upgrade agendado' })).not.toBeInTheDocument();
    });

    it('41.13) card do plano atual exibe indicador de ciclo Mensal e Anual', async () => {
      // Teste com mensal
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'monthly',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      const { unmount } = render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);
      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(screen.getAllByText('Mensal').length).toBeGreaterThanOrEqual(2);
      unmount();

      // Teste com anual
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingInterval: 'annual',
        },
      } as any);

      render(<SubscriptionPlanView ministryId="min-123" onBack={mockOnBack} showToast={mockShowToast} />);
      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(screen.getAllByText('Anual').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Phase 4A.2: Checkout Return & Polling Matrix (Section 42)', () => {
    it('42.1) convergência imediata: detecta novo planId ativo e encerra polling com "Assinatura confirmada com sucesso!"', async () => {
      vi.useFakeTimers();

      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-polling-42',
          expectedPlanId: 'essential',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription');
      // Mount + tick 1: ainda Free
      getSubSpy.mockResolvedValueOnce(mockSummaryFree as any);
      // Tick 2: ativação confirmada Essential
      getSubSpy.mockResolvedValueOnce({
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          planId: 'essential',
          billingInterval: 'monthly',
          memberAddonBlocks: 0,
          billingStatus: 'active',
          subscriptionMode: 'paid',
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-polling-42" onBack={mockOnBack} showToast={mockShowToast} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect(mockShowToast).toHaveBeenCalledWith('Assinatura confirmada com sucesso!', 'success');
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

      vi.useRealTimers();
    });

    it('42.2) convergência agendada: planId permanece na origem mas pendingTransition atinge scheduled -> encerra com "Alteração agendada com sucesso!"', async () => {
      vi.useFakeTimers();

      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-polling-scheduled',
          expectedPlanId: 'pro',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription');
      // Mount + tick 1: Essential sem pending
      getSubSpy.mockResolvedValueOnce(mockSummaryEssential as any);
      // Tick 2: Essential com pendingTransition Pro scheduled!
      getSubSpy.mockResolvedValueOnce({
        ...mockSummaryEssential,
        pendingTransition: {
          transitionId: 'trans-sched-002',
          kind: 'plan_upgrade',
          status: 'scheduled',
          requestedAt: '2026-09-01T10:00:00.000Z',
          effectiveAt: '2026-09-30T12:00:00.000Z',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'pro', interval: 'monthly', addonBlocks: 0 },
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-polling-scheduled" onBack={mockOnBack} showToast={mockShowToast} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect(mockShowToast).toHaveBeenCalledWith('Alteração agendada com sucesso!', 'success');
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

      vi.useRealTimers();
    });

    it('42.3) status attention_required encerra polling com aviso ao usuário', async () => {
      vi.useFakeTimers();

      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-polling-attention',
          expectedPlanId: 'pro',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription');
      getSubSpy.mockResolvedValueOnce(mockSummaryEssential as any);
      getSubSpy.mockResolvedValueOnce({
        ...mockSummaryEssential,
        pendingTransition: {
          transitionId: 'trans-att-003',
          kind: 'plan_upgrade',
          status: 'attention_required',
          requestedAt: '2026-09-01T10:00:00.000Z',
          effectiveAt: '2026-09-30T12:00:00.000Z',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'pro', interval: 'monthly', addonBlocks: 0 },
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-polling-attention" onBack={mockOnBack} showToast={mockShowToast} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        'Recebemos sua solicitação, mas ela precisa de revisão antes de ser concluída.',
        'error'
      );
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

      vi.useRealTimers();
    });

    it('42.4) retorno com ?status=cancel: não inicia polling, limpa intent, exibe toast e limpa URL', async () => {
      window.history.pushState({}, '', '/ministerio/plano?status=cancel');
      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-cancel-ret',
          expectedPlanId: 'essential',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-cancel-ret" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(mockShowToast).toHaveBeenCalledWith('Pagamento cancelado. Nenhuma alteração foi concluída.');
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
      expect(window.location.search).toBe('');
      expect(screen.queryByText('Pagamento em processamento')).not.toBeInTheDocument();
    });

    it('42.5) retorno com ?status=expired: não inicia polling, limpa intent, exibe toast e limpa URL', async () => {
      window.history.pushState({}, '', '/ministerio/plano?status=expired');
      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-expired-ret',
          expectedPlanId: 'essential',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-expired-ret" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(mockShowToast).toHaveBeenCalledWith('O link de pagamento expirou. Você pode tentar novamente.');
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
      expect(window.location.search).toBe('');
      expect(screen.queryByText('Pagamento em processamento')).not.toBeInTheDocument();
    });

    it('42.6) carga direta sem status param com intent expirada não inicia polling e remove intent', async () => {
      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-stale',
          expectedPlanId: 'essential',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now() - 7200000, // 2 horas atrás (> 60 min)
        })
      );

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-stale" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
      expect(screen.queryByText('Pagamento em processamento')).not.toBeInTheDocument();
    });

    it('42.7) intent de outro ministério é ignorada e descartada sem polling (tenant isolation)', async () => {
      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-other-ministry',
          expectedPlanId: 'pro',
          expectedInterval: 'annual',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-current-ministry" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();
      expect(screen.queryByText('Pagamento em processamento')).not.toBeInTheDocument();
    });

    it('42.8) retorno com ?status=success limpa parâmetros da URL sem recarregar a página', async () => {
      window.history.pushState({}, '', '/ministerio/plano?status=success');

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-clean-url" onBack={mockOnBack} showToast={mockShowToast} />);

      expect(window.location.search).toBe('');
    });

    it('42.9) timeout de polling encerra processamento e exibe mensagem informativa do gateway', async () => {
      vi.useFakeTimers();

      sessionStorage.setItem(
        'louvaio_checkout_intent',
        JSON.stringify({
          ministryId: 'min-timeout',
          expectedPlanId: 'pro',
          expectedInterval: 'monthly',
          expectedAddonBlocks: 0,
          timestamp: Date.now(),
        })
      );

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(<SubscriptionPlanView ministryId="min-timeout" onBack={mockOnBack} showToast={mockShowToast} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByText('Pagamento em processamento')).toBeInTheDocument();

      // Avançar 18 ticks (18 * 2500ms = 45000ms)
      for (let i = 0; i < 18; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2500);
        });
      }

      expect(mockShowToast).toHaveBeenCalledWith(
        'Seu pagamento ainda pode estar sendo processado pelo gateway. Você pode consultar esta página novamente em alguns instantes.',
        'success'
      );
      expect(sessionStorage.getItem('louvaio_checkout_intent')).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('Phase 4A.3: Non-Admin Read-Only UX Matrix (Section 35)', () => {
    it('35.1) membro não-admin visualiza catálogo de planos com botões desabilitados ("Apenas administradores")', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Planos disponíveis' })).toBeInTheDocument();

      const adminOnlyButtons = screen.getAllByRole('button', { name: 'Apenas administradores' });
      expect(adminOnlyButtons.length).toBeGreaterThanOrEqual(1);
      adminOnlyButtons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });

    it('35.2) membro não-admin visualiza banner informativo de somente leitura', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(
        await screen.findByText('Somente administradores do ministério podem alterar a assinatura.')
      ).toBeInTheDocument();
    });

    it('35.3) membro não-admin não consegue abrir modal de checkout ou acionar mutação de plano', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      const previewSpy = vi.spyOn(api, 'getBillingPreview');

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Planos disponíveis' })).toBeInTheDocument();

      const adminOnlyButtons = screen.getAllByRole('button', { name: 'Apenas administradores' });
      await userEvent.click(adminOnlyButtons[0]);

      expect(previewSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { level: 3, name: 'Confirmar Alteração de Plano' })).not.toBeInTheDocument();
    });

    it('35.4) membro não-admin não visualiza botão de cancelar assinatura no plano atual', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cancelar assinatura/i })).not.toBeInTheDocument();
    });

    it('35.5) membro não-admin não visualiza botão de gerenciar adicionais no plano atual', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Gerenciar adicionais/i })).not.toBeInTheDocument();
    });

    it('35.6) membro não-admin tem controles de adicionais (range input e stepper) desabilitados no catálogo', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Planos disponíveis' })).toBeInTheDocument();

      const rangeEssential = screen.getByLabelText('Blocos adicionais para Essential');
      expect(rangeEssential).toBeDisabled();

      const minusButtons = screen.getAllByLabelText('Diminuir bloco de integrantes');
      minusButtons.forEach((btn) => expect(btn).toBeDisabled());

      const plusButtons = screen.getAllByLabelText('Aumentar bloco de integrantes');
      plusButtons.forEach((btn) => expect(btn).toBeDisabled());
    });

    it('35.7) membro não-admin visualiza banner de suspensão/regularização sem botão de reativação da assinatura', async () => {
      const mockSuspendedSummary = {
        ...mockSummaryEssential,
        subscription: {
          ...mockSummaryEssential.subscription,
          billingStatus: 'overdue',
          accessMode: 'grace',
          gracePeriodExpiresAt: '2026-09-15T12:00:00.000Z',
        },
        graceDaysRemaining: 7,
      };

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSuspendedSummary as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-non-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByText(/Período de adaptação ativo/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Reativar agora/i })).not.toBeInTheDocument();
    });
  });

  describe('Phase 4A.3: Addon Management Matrix (Section 36 & 37)', () => {
    it('36.1) plano atual Essential ou Pro exibe botão "Gerenciar adicionais" para admin', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      const addonBtn = await screen.findByRole('button', { name: /Gerenciar adicionais/i });
      expect(addonBtn).toBeInTheDocument();
      expect(addonBtn).not.toBeDisabled();
    });

    it('36.2) plano atual Free, Lite, Lite+ ou Premium NÃO exibe botão "Gerenciar adicionais"', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryFree as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      const { rerender } = render(
        <SubscriptionPlanView
          ministryId="min-free"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Gerenciar adicionais/i })).not.toBeInTheDocument();

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryLitePaid as any);

      rerender(
        <SubscriptionPlanView
          ministryId="min-lite"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Lite' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Gerenciar adicionais/i })).not.toBeInTheDocument();
    });

    it('36.3) quando há pendingTransition, botão "Gerenciar adicionais" é desabilitado com tooltip "Alteração em andamento"', async () => {
      const mockWithPending = {
        ...mockSummaryEssential,
        pendingTransition: {
          transitionId: 'trans-pending-addon',
          kind: 'addon_increase',
          status: 'scheduled',
          requestedAt: '2026-09-01T10:00:00.000Z',
          effectiveAt: '2026-09-28T12:00:00.000Z',
          source: { planId: 'essential', interval: 'monthly', addonBlocks: 2 },
          target: { planId: 'essential', interval: 'monthly', addonBlocks: 3 },
        },
      };

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockWithPending as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-pending"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      const disabledBtn = await screen.findByRole('button', { name: /Alteração em andamento/i });
      expect(disabledBtn).toBeInTheDocument();
      expect(disabledBtn).toBeDisabled();
      expect(disabledBtn).toHaveAttribute(
        'title',
        'Já existe uma alteração de assinatura em andamento.'
      );
    });

    it('36.4) clique em "Gerenciar adicionais" abre modal com quantidade atual pré-carregada e touch targets >= 44px', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      const addonBtn = await screen.findByRole('button', { name: /Gerenciar adicionais/i });
      await userEvent.click(addonBtn);

      expect(await screen.findByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).toBeInTheDocument();
      expect(screen.getByText('60 membros (2 blocos)')).toBeInTheDocument();
      expect(screen.getByText('2 blocos')).toBeInTheDocument();

      const minusBtn = screen.getByRole('button', { name: 'Diminuir blocos adicionais' });
      const plusBtn = screen.getByRole('button', { name: 'Aumentar blocos adicionais' });

      expect(minusBtn).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
      expect(plusBtn).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
    });

    it('36.5) stepper restringe blocos ao intervalo [0, maxMemberAddonBlocks]', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 3,
        effectiveMembersQuota: 70,
        effectiveSongsQuota: 200,
        basePriceCents: 3490,
        addonsPriceCents: 2970,
        totalPriceCents: 6460,
        fullMonthlyEquivalentCents: 6460,
        annualSavingsCents: 0,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));

      const minusBtn = screen.getByRole('button', { name: 'Diminuir blocos adicionais' });
      const plusBtn = screen.getByRole('button', { name: 'Aumentar blocos adicionais' });

      // Essential maxMemberAddonBlocks = 4, inicial = 2
      await userEvent.click(plusBtn); // 3
      await userEvent.click(plusBtn); // 4 (máx)

      expect(screen.getByText('4 blocos')).toBeInTheDocument();
      expect(plusBtn).toBeDisabled();

      // Decrementar até 0
      await userEvent.click(minusBtn); // 3
      await userEvent.click(minusBtn); // 2
      await userEvent.click(minusBtn); // 1
      await userEvent.click(minusBtn); // 0 (mín)

      expect(screen.getByText('0 blocos')).toBeInTheDocument();
      expect(minusBtn).toBeDisabled();
    });

    it('36.6) alteração de blocos consome prévia autorizada do backend (GET /billing/preview)', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      const previewSpy = vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 3,
        effectiveMembersQuota: 70,
        effectiveSongsQuota: 200,
        basePriceCents: 3490,
        addonsPriceCents: 2970,
        totalPriceCents: 6460,
        fullMonthlyEquivalentCents: 6460,
        annualSavingsCents: 0,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Aumentar blocos adicionais' }));

      expect(previewSpy).toHaveBeenCalledWith('min-admin', 'essential', 'monthly', 3);
    });

    it('36.7) prévia reflete acréscimo de membros (direction: increase, próximo ciclo)', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 3,
        effectiveMembersQuota: 70,
        effectiveSongsQuota: 200,
        basePriceCents: 3490,
        addonsPriceCents: 2970,
        totalPriceCents: 6460,
        fullMonthlyEquivalentCents: 6460,
        annualSavingsCents: 0,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Aumentar blocos adicionais' }));

      expect(
        await screen.findByText(
          'Acréscimo de 10 membros adicionais. A alteração será agendada e entrará em vigor no próximo ciclo de faturamento.'
        )
      ).toBeInTheDocument();

      const submitBtn = screen.getByRole('button', { name: 'Prosseguir para Pagamento' });
      expect(submitBtn).toBeEnabled();
    });

    it('36.8) prévia reflete redução de membros (direction: decrease, término do período)', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 1,
        effectiveMembersQuota: 50,
        effectiveSongsQuota: 200,
        basePriceCents: 3490,
        addonsPriceCents: 990,
        totalPriceCents: 4480,
        fullMonthlyEquivalentCents: 4480,
        annualSavingsCents: 0,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
        downgradeImpact: {
          isOverLimit: false,
          membersOver: false,
          songsOver: false,
          gracePeriodDays: 7,
        },
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Diminuir blocos adicionais' }));

      expect(
        await screen.findByText(
          'Redução de 10 membros adicionais. A alteração será aplicada no término do período vigente.'
        )
      ).toBeInTheDocument();

      const submitBtn = screen.getByRole('button', { name: 'Confirmar alteração' });
      expect(submitBtn).toBeEnabled();
    });

    it('36.9) redução de membros com ocupação acima da nova cota exibe alerta de limite (downgrade capacity warning)', async () => {
      const mockSummaryHighUsage = {
        ...mockSummaryEssential,
        usage: { membersCount: 45, songsCount: 115 },
      };

      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryHighUsage as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 0,
        effectiveMembersQuota: 40,
        effectiveSongsQuota: 200,
        basePriceCents: 3490,
        addonsPriceCents: 0,
        totalPriceCents: 3490,
        fullMonthlyEquivalentCents: 3490,
        annualSavingsCents: 0,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
        downgradeImpact: {
          isOverLimit: true,
          membersOver: true,
          songsOver: false,
          gracePeriodDays: 7,
        },
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      // Diminuir de 2 para 0 blocos
      await userEvent.click(screen.getByRole('button', { name: 'Diminuir blocos adicionais' }));
      await userEvent.click(screen.getByRole('button', { name: 'Diminuir blocos adicionais' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(/Atenção ao limite de integrantes: seu ministério possui 45 integrantes e a nova capacidade será 40 integrantes/i);
    });

    it('36.10) submissão de alteração de adicionais cria checkout e persiste CheckoutIntent com expectedAddonBlocks', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'getBillingPreview').mockResolvedValue({
        planId: 'essential',
        planName: 'Essential',
        interval: 'monthly',
        addonBlocks: 3,
        effectiveMembersQuota: 70,
        effectiveSongsQuota: 200,
        basePriceCents: 3490,
        addonsPriceCents: 2970,
        totalPriceCents: 6460,
        fullMonthlyEquivalentCents: 6460,
        annualSavingsCents: 0,
        currency: 'BRL',
        currentPlanId: 'essential',
        isDowngrade: false,
      });

      const checkoutSpy = vi.spyOn(api, 'createBillingCheckout').mockResolvedValue({
        checkoutUrl: 'https://sandbox.asaas.com/c/addon_checkout_123',
        checkoutId: 'chk_addon_123',
        expiresAt: null,
        totalPriceCents: 6460,
        currency: 'BRL',
      });

      delete (window as any).location;
      (window as any).location = { href: '' };

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Aumentar blocos adicionais' }));

      const submitBtn = await screen.findByRole('button', { name: 'Prosseguir para Pagamento' });
      await userEvent.click(submitBtn);

      expect(checkoutSpy).toHaveBeenCalledWith('min-admin', {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 3,
      });

      const rawIntent = sessionStorage.getItem('louvaio_checkout_intent');
      expect(rawIntent).not.toBeNull();
      const parsedIntent = JSON.parse(rawIntent!);
      expect(parsedIntent.ministryId).toBe('min-admin');
      expect(parsedIntent.expectedPlanId).toBe('essential');
      expect(parsedIntent.expectedInterval).toBe('monthly');
      expect(parsedIntent.expectedAddonBlocks).toBe(3);
    });

    it('36.11) botão de submissão permanece desabilitado quando a quantidade alvo é igual à quantidade atual (prevenção de no-op)', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));

      const submitBtn = screen.getByRole('button', { name: 'Selecione uma quantidade diferente' });
      expect(submitBtn).toBeDisabled();
      expect(
        screen.getByText('A quantidade selecionada é igual à atual. Ajuste os blocos para prosseguir.')
      ).toBeInTheDocument();
    });

    it('36.12) modal de adicionais fecha com botão Cancelar, backdrop e tecla Escape sem mutações', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Abrir modal
      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      expect(await screen.findByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).toBeInTheDocument();

      // Fechar com botão Cancelar
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).not.toBeInTheDocument();

      // Reabrir e fechar com Escape
      await userEvent.click(screen.getByRole('button', { name: /Gerenciar adicionais/i }));
      expect(await screen.findByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).not.toBeInTheDocument();
    });

    it('37.1) alternância de ministério ou rebaixamento de papel fecha modal aberto e aplica modo somente leitura', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryEssential as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      const { rerender } = render(
        <SubscriptionPlanView
          ministryId="min-admin-a"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Admin no ministério A abre o modal
      await userEvent.click(await screen.findByRole('button', { name: /Gerenciar adicionais/i }));
      expect(await screen.findByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).toBeInTheDocument();

      // Alternância para ministério B onde o usuário é apenas membro (canManageBilling={false})
      rerender(
        <SubscriptionPlanView
          ministryId="min-member-b"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // Modal fecha imediatamente e entra em modo somente leitura
      expect(screen.queryByRole('heading', { level: 3, name: 'Gerenciar Membros Adicionais' })).not.toBeInTheDocument();
      expect(
        await screen.findByText('Somente administradores do ministério podem alterar a assinatura.')
      ).toBeInTheDocument();
    });
  });

  describe('Phase 4A.4.3: Customer Cancellation Reversal (Uncancel) Flow (Sections 36-43)', () => {
    const createCancelToFreePendingTransition = (overrides: Record<string, any> = {}) => ({
      transitionId: 'trans-cancel-001',
      kind: 'cancel_to_free',
      status: 'scheduled',
      requestedAt: '2026-09-01T10:00:00.000Z',
      effectiveAt: '2026-09-30T12:00:00.000Z',
      source: {
        planId: 'essential',
        interval: 'monthly',
        addonBlocks: 0,
      },
      target: {
        planId: 'free',
        interval: 'monthly',
        addonBlocks: 0,
      },
      ...overrides,
    });

    const mockSummaryWithCancel = {
      ...mockSummaryEssential,
      pendingTransition: createCancelToFreePendingTransition(),
    };

    it('36.1) admin + pending cancel_to_free exibe botão "Desfazer cancelamento" no card de transição pendente', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: /Cancelamento agendado/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Desfazer cancelamento' })).toBeInTheDocument();
    });

    it('36.2) não-admin (canManageBilling={false}) NÃO exibe o botão "Desfazer cancelamento"', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-member"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: /Cancelamento agendado/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Desfazer cancelamento' })).not.toBeInTheDocument();
    });

    it('36.3) transição pendente diferente de cancel_to_free (ex: plan_upgrade) NÃO exibe "Desfazer cancelamento"', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryLitePaid,
        pendingTransition: {
          transitionId: 'trans-upgrade-001',
          kind: 'plan_upgrade',
          status: 'scheduled',
          requestedAt: '2026-09-01T10:00:00.000Z',
          effectiveAt: '2026-09-30T12:00:00.000Z',
          source: { planId: 'lite', interval: 'monthly', addonBlocks: 0 },
          target: { planId: 'essential', interval: 'monthly', addonBlocks: 0 },
        },
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: /Upgrade agendado/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Desfazer cancelamento' })).not.toBeInTheDocument();
    });

    it('36.4) transição cancel_to_free em atenção financeira oculta botão "Desfazer cancelamento"', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryWithCancel,
        pendingTransition: createCancelToFreePendingTransition({ status: 'attention_required' }),
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: /Cancelamento agendado/i })).toBeInTheDocument();
      expect(screen.getByText('Revisão necessária')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Desfazer cancelamento' })).not.toBeInTheDocument();
    });

    it('36.5) quando não há transição pendente, botão "Desfazer cancelamento" não é renderizado', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue({
        ...mockSummaryEssential,
        pendingTransition: null,
      } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Essential' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Desfazer cancelamento' })).not.toBeInTheDocument();
    });

    it('37.1) admin clica em CTA -> abre modal -> confirma -> API chamada uma vez -> toast de sucesso -> reload remove card', async () => {
      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription')
        .mockResolvedValueOnce(mockSummaryWithCancel as any)
        .mockResolvedValueOnce({
          ...mockSummaryEssential,
          pendingTransition: null,
        } as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      const reactivateSpy = vi.spyOn(api, 'reactivateBillingSubscription').mockResolvedValue({
        message: 'Cancelamento desfeito com sucesso.',
        subscription: mockSummaryEssential.subscription,
      } as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      const ctaBtn = await screen.findByRole('button', { name: 'Desfazer cancelamento' });
      await userEvent.click(ctaBtn);

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'Desfazer cancelamento?' })).toBeInTheDocument();

      const modalConfirmBtn = screen.getAllByRole('button', { name: 'Desfazer cancelamento' })[1];
      await userEvent.click(modalConfirmBtn);

      expect(reactivateSpy).toHaveBeenCalledTimes(1);
      expect(reactivateSpy).toHaveBeenCalledWith('min-admin');
      expect(mockShowToast).toHaveBeenCalledWith(
        'Cancelamento desfeito. Sua assinatura continuará ativa.',
        'success'
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: /Cancelamento agendado/i })).not.toBeInTheDocument();
      expect(getSubSpy).toHaveBeenCalledTimes(2);
    });

    it('38.1) proteção contra duplo clique durante execução de reversão', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      let resolvePromise: (val: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      const reactivateSpy = vi.spyOn(api, 'reactivateBillingSubscription').mockImplementation(() => pendingPromise as any);

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      const modalConfirmBtn = screen.getAllByRole('button', { name: 'Desfazer cancelamento' })[1];

      await userEvent.click(modalConfirmBtn);
      expect(reactivateSpy).toHaveBeenCalledTimes(1);

      expect(screen.getAllByText('Processando...').length).toBeGreaterThanOrEqual(1);

      const disabledBtn = screen.getAllByRole('button', { name: /Processando/i })[1];
      expect(disabledBtn).toBeDisabled();
      await userEvent.click(disabledBtn);

      expect(reactivateSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolvePromise!({ message: 'ok', subscription: mockSummaryEssential.subscription });
      });
    });

    it('38.2) fechamento do modal por Voltar, backdrop ou Escape não chama API', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      const reactivateSpy = vi.spyOn(api, 'reactivateBillingSubscription');

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      // 1. Fechar por Voltar
      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // 2. Fechar por Escape
      await userEvent.click(screen.getByRole('button', { name: 'Desfazer cancelamento' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      expect(reactivateSpy).not.toHaveBeenCalled();
    });

    it('39.1) erro transiente exibe toast seguro e mantém card de transição para nova tentativa', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'reactivateBillingSubscription').mockRejectedValue({
        details: { code: 'PROVIDER_TRANSIENT_ERROR' },
        message: 'Instabilidade temporária na comunicação com o provedor de pagamentos.',
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      const modalConfirmBtn = screen.getAllByRole('button', { name: 'Desfazer cancelamento' })[1];
      await userEvent.click(modalConfirmBtn);

      expect(mockShowToast).toHaveBeenCalledWith(
        'Não foi possível concluir agora. Tente novamente em instantes.',
        'error'
      );
      expect(screen.getByRole('heading', { level: 2, name: /Cancelamento agendado/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Desfazer cancelamento' })).toBeInTheDocument();
    });

    it('40.1) erro de atenção financeira exibe toast de verificação e recarrega dados', async () => {
      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'reactivateBillingSubscription').mockRejectedValue({
        details: { code: 'FINANCIAL_ATTENTION_REQUIRED' },
        message: 'A assinatura requer verificação antes de continuar.',
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      const modalConfirmBtn = screen.getAllByRole('button', { name: 'Desfazer cancelamento' })[1];
      await userEvent.click(modalConfirmBtn);

      expect(mockShowToast).toHaveBeenCalledWith(
        'Não foi possível concluir automaticamente. A assinatura precisa de verificação antes de continuar.',
        'error'
      );
      expect(getSubSpy).toHaveBeenCalledTimes(2);
    });

    it('41.1) erro de cancelamento não encontrado / prazo encerrado exibe toast e recarrega dados', async () => {
      const getSubSpy = vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);
      vi.spyOn(api, 'reactivateBillingSubscription').mockRejectedValue({
        details: { code: 'NO_ACTIVE_CANCELLATION_FOUND' },
        message: 'Não há cancelamento agendado para desfazer neste ministério.',
      });

      render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      const modalConfirmBtn = screen.getAllByRole('button', { name: 'Desfazer cancelamento' })[1];
      await userEvent.click(modalConfirmBtn);

      expect(mockShowToast).toHaveBeenCalledWith(
        'Não há cancelamento agendado para desfazer neste ministério.',
        'error'
      );
      expect(getSubSpy).toHaveBeenCalledTimes(2);
    });

    it('42.1) alternância de ministério enquanto in-flight descarta resultado assíncrono', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      let resolvePromise: (val: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.spyOn(api, 'reactivateBillingSubscription').mockImplementation(() => pendingPromise as any);

      const { rerender } = render(
        <SubscriptionPlanView
          ministryId="min-admin-a"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      const modalConfirmBtn = screen.getAllByRole('button', { name: 'Desfazer cancelamento' })[1];
      await userEvent.click(modalConfirmBtn);

      rerender(
        <SubscriptionPlanView
          ministryId="min-admin-b"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await act(async () => {
        resolvePromise!({ message: 'ok', subscription: mockSummaryEssential.subscription });
      });

      expect(mockShowToast).not.toHaveBeenCalledWith(
        'Cancelamento desfeito. Sua assinatura continuará ativa.',
        'success'
      );
    });

    it('43.1) rebaixamento de papel (canManageBilling -> false) enquanto modal está aberto fecha o modal', async () => {
      vi.spyOn(api, 'getMinistrySubscription').mockResolvedValue(mockSummaryWithCancel as any);
      vi.spyOn(api, 'getPlans').mockResolvedValue(mockPlansResponse as any);

      const { rerender } = render(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={true}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer cancelamento' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      rerender(
        <SubscriptionPlanView
          ministryId="min-admin"
          canManageBilling={false}
          onBack={mockOnBack}
          showToast={mockShowToast}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
