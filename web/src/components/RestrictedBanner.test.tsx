import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RestrictedBanner } from './RestrictedBanner';
import { MinistrySubscriptionSummary } from '../types';

describe('RestrictedBanner Component', () => {
  const mockOnNavigate = vi.fn();

  const baseSummary: MinistrySubscriptionSummary = {
    plan: {
      id: 'free',
      name: 'Free',
      baseMembers: 10,
      baseSongs: 50,
      allowMemberAddons: false,
      maxMemberAddonBlocks: 0,
      monthlyPriceCents: 0,
      annualPriceCents: 0,
      addonBlockMonthlyPriceCents: 0,
      addonBlockAnnualPriceCents: 0,
    },
    subscription: {
      planId: 'free',
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
    quotas: { members: 10, songs: 50 },
    usage: { membersCount: 5, songsCount: 20 },
    isOverLimit: false,
    overLimitDetails: { membersOver: false, songsOver: false },
    graceDaysRemaining: null,
  };

  it('não deve renderizar nada em modo normal', () => {
    const { container } = render(<RestrictedBanner summary={baseSummary} onNavigateToPlans={mockOnNavigate} />);
    expect(container.firstChild).toBeNull();
  });

  it('deve renderizar banner de GRACE com dias restantes e detalhes de excesso', async () => {
    const graceSummary: MinistrySubscriptionSummary = {
      ...baseSummary,
      subscription: { ...baseSummary.subscription, accessMode: 'grace' },
      isOverLimit: true,
      overLimitDetails: { membersOver: true, songsOver: true },
      graceDaysRemaining: 5,
      usage: { membersCount: 85, songsCount: 150 },
    };

    render(<RestrictedBanner summary={graceSummary} onNavigateToPlans={mockOnNavigate} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Período de adaptação ativo')).toBeInTheDocument();
    expect(screen.getByText(/5 dias restantes/i)).toBeInTheDocument();
    expect(screen.getByText('Membros: 85 / 10')).toBeInTheDocument();
    expect(screen.getByText('Músicas: 150 / 50')).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: /Ver plano e utilização/i });
    await userEvent.click(cta);
    expect(mockOnNavigate).toHaveBeenCalledTimes(1);
  });

  it('deve renderizar banner de RESTRICTED_OVER_LIMIT com CTA Ver detalhes', async () => {
    const restrictedSummary: MinistrySubscriptionSummary = {
      ...baseSummary,
      subscription: { ...baseSummary.subscription, accessMode: 'restricted_over_limit' },
      isOverLimit: true,
      overLimitDetails: { membersOver: true, songsOver: false },
      usage: { membersCount: 15, songsCount: 30 },
    };

    render(<RestrictedBanner summary={restrictedSummary} onNavigateToPlans={mockOnNavigate} />);

    expect(screen.getByText('Uso acima do limite do plano')).toBeInTheDocument();
    expect(screen.getByText('Membros: 15 / 10')).toBeInTheDocument();
    expect(screen.queryByText(/Músicas:/i)).toBeNull();

    const cta = screen.getByRole('button', { name: /Ver detalhes/i });
    await userEvent.click(cta);
    expect(mockOnNavigate).toHaveBeenCalled();
  });

  it('deve renderizar banner de SUSPENDED com aviso de suspensão administrativa', () => {
    const suspendedSummary: MinistrySubscriptionSummary = {
      ...baseSummary,
      subscription: {
        ...baseSummary.subscription,
        accessMode: 'suspended',
        administrativelySuspended: true,
        suspensionReason: 'Violação dos termos de uso',
      },
    };

    render(<RestrictedBanner summary={suspendedSummary} onNavigateToPlans={mockOnNavigate} />);

    expect(screen.getByText('Ministério suspenso')).toBeInTheDocument();
    expect(screen.getByText(/Violação dos termos de uso/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver detalhes da assinatura/i })).toBeInTheDocument();
  });

  it('deve renderizar banner de GRACE com mensagem de falha de pagamento quando graceReason for payment_failure', async () => {
    const gracePaymentSummary: MinistrySubscriptionSummary = {
      ...baseSummary,
      subscription: {
        ...baseSummary.subscription,
        billingStatus: 'past_due',
        accessMode: 'grace',
      },
      graceReason: 'payment_failure',
      graceDaysRemaining: 4,
      paymentStatus: {
        state: 'past_due',
        graceEndsAt: '2026-09-12T12:00:00.000Z',
        canRecoverPayment: true,
      },
    };

    render(<RestrictedBanner summary={gracePaymentSummary} onNavigateToPlans={mockOnNavigate} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Regularização de pagamento pendente')).toBeInTheDocument();
    expect(screen.getByText(/Não conseguimos confirmar a renovação da assinatura/i)).toBeInTheDocument();
    expect(screen.getByText(/4 dias restantes/i)).toBeInTheDocument();
    expect(screen.getByText(/Seus dados continuam 100% preservados/i)).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: /Regularizar pagamento/i });
    await userEvent.click(cta);
    expect(mockOnNavigate).toHaveBeenCalledTimes(1);
  });

  it('deve renderizar banner de RESTRICTED_OVER_LIMIT com mensagem de pendência financeira quando paymentStatus for past_due', async () => {
    const restrictedPaymentSummary: MinistrySubscriptionSummary = {
      ...baseSummary,
      subscription: {
        ...baseSummary.subscription,
        billingStatus: 'past_due',
        accessMode: 'restricted_over_limit',
      },
      paymentStatus: {
        state: 'past_due',
        graceEndsAt: null,
        canRecoverPayment: true,
      },
    };

    render(<RestrictedBanner summary={restrictedPaymentSummary} onNavigateToPlans={mockOnNavigate} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Acesso restrito por pendência financeira')).toBeInTheDocument();
    expect(screen.getByText(/O período de regularização expirou\. Seus dados continuam 100% preservados/i)).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: /Regularizar pagamento/i });
    await userEvent.click(cta);
    expect(mockOnNavigate).toHaveBeenCalledTimes(1);
  });
});
