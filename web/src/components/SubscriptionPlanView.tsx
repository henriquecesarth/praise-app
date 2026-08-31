import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  MinistrySubscriptionSummary,
  PlansResponse,
  BillingInterval,
  CheckoutPreviewResult,
  BillingTransactionRecord,
  PlanDefinition,
} from '../types';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  ShieldAlert,
  Users,
  Music,
  RefreshCw,
  CreditCard,
  Check,
  ChevronRight,
  Receipt,
  X,
} from 'lucide-react';

interface Props {
  ministryId: string;
  onBack: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export const SubscriptionPlanView: React.FC<Props> = ({ ministryId, onBack, showToast }) => {
  const [summary, setSummary] = useState<MinistrySubscriptionSummary | null>(null);
  const [plansData, setPlansData] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Billing UI State
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [selectedAddonBlocks, setSelectedAddonBlocks] = useState<Record<string, number>>({});
  const [previewPlan, setPreviewPlan] = useState<PlanDefinition | null>(null);
  const [previewData, setPreviewData] = useState<CheckoutPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyTransactions, setHistoryTransactions] = useState<BillingTransactionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subSummary, plans] = await Promise.all([
        api.getMinistrySubscription(ministryId),
        api.getPlans(),
      ]);
      setSummary(subSummary);
      setPlansData(plans);
    } catch (err: any) {
      console.error('Erro ao carregar dados de plano e assinatura:', err);
      setError(err.message || 'Não foi possível carregar as informações do plano.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [ministryId]);

  // Status helper
  const getStatusBadge = (accessMode?: string, suspended?: boolean, cancelAtPeriodEnd?: boolean, subscriptionMode?: string) => {
    if (suspended || accessMode === 'suspended') {
      return {
        label: 'Ministério suspenso',
        icon: ShieldAlert,
        bg: 'rgba(184, 90, 60, 0.18)',
        color: 'var(--louvaio-terracotta, #B85A3C)',
        border: '1px solid var(--louvaio-terracotta, #B85A3C)',
      };
    }
    if (subscriptionMode === 'complimentary') {
      return {
        label: 'Cortesia da plataforma',
        icon: CheckCircle2,
        bg: 'rgba(52, 211, 153, 0.18)',
        color: '#34D399',
        border: '1px solid #10B981',
      };
    }
    if (cancelAtPeriodEnd) {
      return {
        label: 'Cancelamento agendado',
        icon: Clock,
        bg: 'rgba(217, 119, 6, 0.18)',
        color: '#F59E0B',
        border: '1px solid #D97706',
      };
    }
    if (accessMode === 'restricted_over_limit') {
      return {
        label: 'Uso acima do plano',
        icon: AlertTriangle,
        bg: 'rgba(184, 90, 60, 0.18)',
        color: 'var(--louvaio-terracotta, #B85A3C)',
        border: '1px solid var(--louvaio-terracotta, #B85A3C)',
      };
    }
    if (accessMode === 'grace') {
      return {
        label: 'Período de adaptação',
        icon: Clock,
        bg: 'rgba(217, 119, 6, 0.18)',
        color: '#F59E0B',
        border: '1px solid #D97706',
      };
    }
    return {
      label: 'Ativo',
      icon: CheckCircle2,
      bg: 'rgba(22, 59, 44, 0.25)',
      color: '#34D399',
      border: '1px solid #10B981',
    };
  };


  // Abre modal de preview de checkout
  const handleOpenCheckoutPreview = async (targetPlan: PlanDefinition) => {
    const addons = selectedAddonBlocks[targetPlan.id] || 0;
    setPreviewPlan(targetPlan);
    setPreviewLoading(true);
    try {
      const preview = await api.getBillingPreview(ministryId, targetPlan.id, interval, addons);
      setPreviewData(preview);
    } catch (err: any) {
      showToast?.(err.message || 'Erro ao carregar prévia do checkout', 'error');
      setPreviewPlan(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Inicia o checkout no gateway Asaas
  const handleStartCheckout = async () => {
    if (!previewPlan) return;
    setCheckoutLoading(true);
    try {
      const addons = selectedAddonBlocks[previewPlan.id] || 0;
      const result = await api.createBillingCheckout(ministryId, {
        planId: previewPlan.id,
        interval,
        addonBlocks: addons,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      });

      if (previewPlan.id === 'free') {
        showToast?.('Plano alterado para Free com sucesso!', 'success');
        setPreviewPlan(null);
        setPreviewData(null);
        await loadData();
      } else if (result.checkoutUrl) {
        showToast?.('Redirecionando para o checkout seguro...', 'success');
        window.location.href = result.checkoutUrl;
      }
    } catch (err: any) {
      showToast?.(err.message || 'Erro ao gerar checkout', 'error');
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Cancelar assinatura no fim do período
  const handleCancelSubscription = async () => {
    if (!window.confirm('Tem certeza que deseja cancelar a renovação da assinatura? Você continuará com acesso até o fim do período já pago.')) {
      return;
    }
    setActionLoading(true);
    try {
      await api.cancelBillingSubscription(ministryId);
      showToast?.('Cancelamento agendado para o fim do período vigente.', 'success');
      await loadData();
    } catch (err: any) {
      showToast?.(err.message || 'Erro ao cancelar assinatura', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Reativar assinatura
  const handleReactivateSubscription = async () => {
    setActionLoading(true);
    try {
      await api.reactivateBillingSubscription(ministryId);
      showToast?.('Assinatura reativada com sucesso!', 'success');
      await loadData();
    } catch (err: any) {
      showToast?.(err.message || 'Erro ao reativar assinatura', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Abrir histórico de faturas
  const handleOpenHistory = async () => {
    setShowHistoryModal(true);
    setHistoryLoading(true);
    try {
      const res = await api.getBillingHistory(ministryId);
      setHistoryTransactions(res.transactions || []);
    } catch (err: any) {
      showToast?.(err.message || 'Erro ao carregar histórico de faturas', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const formatCents = (cents?: number) => {
    if (cents === undefined || cents === null) return 'R$ 0,00';
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  if (loading) {
    return (
      <div className="subscription-view-container animate-fade-in" style={{ padding: '16px 0 40px 0' }}>
        <button
          type="button"
          onClick={onBack}
          className="back-link-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary, #A0AAB0)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            minHeight: '44px',
            padding: '0 8px',
          }}
        >
          <ArrowLeft size={18} />
          <span>Voltar para Ministério</span>
        </button>

        <div style={{ marginTop: '24px' }}>
          <div className="shimmer" style={{ height: '32px', width: '220px', borderRadius: '8px', marginBottom: '12px' }} />
          <div className="shimmer" style={{ height: '18px', width: '380px', borderRadius: '6px', marginBottom: '24px' }} />
          <div className="shimmer" style={{ height: '180px', width: '100%', borderRadius: '16px', marginBottom: '32px' }} />
          <div className="shimmer" style={{ height: '260px', width: '100%', borderRadius: '16px' }} />
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="subscription-view-container animate-fade-in" style={{ padding: '16px 0 40px 0' }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary, #A0AAB0)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            minHeight: '44px',
            padding: '0 8px',
          }}
        >
          <ArrowLeft size={18} />
          <span>Voltar para Ministério</span>
        </button>

        <div
          role="alert"
          style={{
            marginTop: '24px',
            background: 'rgba(184, 90, 60, 0.12)',
            border: '1px solid var(--louvaio-terracotta, #B85A3C)',
            borderRadius: '16px',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <AlertCircle size={36} color="var(--louvaio-terracotta, #B85A3C)" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: 'var(--text-primary, #F5EFE6)' }}>
            Erro ao carregar informações
          </h3>
          <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary, #A0AAB0)', fontSize: '0.9rem' }}>
            {error || 'Não foi possível carregar as informações do plano.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={loadData}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              margin: '0 auto',
            }}
          >
            <RefreshCw size={16} />
            <span>Tentar novamente</span>
          </button>
        </div>
      </div>
    );
  }

  const { plan, subscription, quotas, usage } = summary;
  const statusBadge = getStatusBadge(
    subscription.accessMode,
    subscription.administrativelySuspended,
    subscription.cancelAtPeriodEnd,
    subscription.subscriptionMode
  );
  const StatusIcon = statusBadge.icon;


  const membersLimitNum = typeof quotas.members === 'number' ? quotas.members : null;
  const songsLimitNum = typeof quotas.songs === 'number' ? quotas.songs : null;

  const getProgressColor = (current: number, limit: number | 'unlimited') => {
    if (limit === 'unlimited') return '#10B981';
    if (current > limit) return 'var(--louvaio-terracotta, #B85A3C)';
    if (current >= limit * 0.8) return '#F59E0B';
    return '#10B981';
  };

  return (
    <div className="subscription-view-container animate-fade-in" style={{ padding: '16px 0 40px 0', maxWidth: '960px', margin: '0 auto' }}>
      {/* Header com link de retorno e botão de histórico */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary, #A0AAB0)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            minHeight: '44px',
            padding: '0 8px',
          }}
        >
          <ArrowLeft size={18} />
          <span>Voltar para Ministério</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={handleOpenHistory}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color, #2D3A34)',
              color: 'var(--text-primary, #F5EFE6)',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <Receipt size={15} />
            <span>Faturas</span>
          </button>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '999px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: statusBadge.bg,
              color: statusBadge.color,
              border: statusBadge.border,
            }}
          >
            <StatusIcon size={14} aria-hidden="true" />
            <span>{statusBadge.label}</span>
          </span>
        </div>
      </div>

      {/* Título Principal */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px 0', fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
          Plano e assinatura
        </h1>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary, #A0AAB0)' }}>
          Acompanhe o consumo de recursos e gerencie a assinatura do seu ministério com segurança.
        </p>
      </div>

      {/* Banner de Cancelamento Agendado */}
      {subscription.cancelAtPeriodEnd && (
        <div
          style={{
            background: 'rgba(217, 119, 6, 0.15)',
            border: '1px solid #D97706',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Clock size={20} color="#F59E0B" />
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary, #F5EFE6)', fontSize: '0.95rem' }}>
                Cancelamento agendado
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #A0AAB0)' }}>
                Seu plano continuará ativo até o fim do período vigente. Você pode reativar a qualquer momento.
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleReactivateSubscription}
            disabled={actionLoading}
            style={{ fontSize: '0.85rem', padding: '6px 14px' }}
          >
            {actionLoading ? 'Processando...' : 'Reativar Assinatura'}
          </button>
        </div>
      )}

      {/* Card do Plano Atual */}
      <section
        aria-labelledby="current-plan-heading"
        style={{
          background: 'var(--surface-color, #1A2421)',
          borderRadius: '16px',
          padding: '24px',
          border: '1px solid var(--border-color, #2D3A34)',
          marginBottom: '32px',
          boxShadow: 'var(--brand-shadow, 0 12px 32px rgba(0,0,0,0.2))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
                color: 'var(--louvaio-terracotta, #B85A3C)',
              }}
            >
              Plano atual do seu ministério
            </span>
            <h2 id="current-plan-heading" style={{ margin: '4px 0 0 0', fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
              {plan.name}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {subscription.subscriptionMode === 'complimentary' && (
              <div
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'rgba(52, 211, 153, 0.15)',
                  border: '1px solid #10B981',
                  color: '#34D399',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                Cortesia da Plataforma
                {subscription.expiresAt ? ` · Válido até ${new Date(subscription.expiresAt).toLocaleDateString('pt-BR')}` : ''}
              </div>
            )}

            {subscription.memberAddonBlocks > 0 && (
              <div
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'rgba(184, 90, 60, 0.15)',
                  border: '1px solid var(--louvaio-terracotta, #B85A3C)',
                  color: 'var(--louvaio-terracotta, #B85A3C)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                {`+${subscription.memberAddonBlocks * 10} membros adicionais (${subscription.memberAddonBlocks} ${subscription.memberAddonBlocks === 1 ? 'bloco' : 'blocos'})`}
              </div>
            )}

            {plan.id !== 'free' && subscription.subscriptionMode !== 'complimentary' && !subscription.cancelAtPeriodEnd && (
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary, #A0AAB0)',
                  fontSize: '0.8rem',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancelar assinatura
              </button>
            )}
          </div>

        </div>

        {/* Seção de Uso */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {/* Membros Card */}
          <div
            style={{
              background: 'var(--surface-variant, #23322D)',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid var(--border-color, #2D3A34)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary, #F5EFE6)' }}>
                <Users size={16} color="var(--louvaio-terracotta, #B85A3C)" />
                <span>Membros</span>
              </span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary, #F5EFE6)' }}>
                {quotas.members === 'unlimited' ? (
                  `${usage.membersCount} · Ilimitado`
                ) : (
                  `${usage.membersCount} de ${quotas.members}`
                )}
              </span>
            </div>

            {membersLimitNum !== null && (
              <div style={{ marginBottom: '8px' }}>
                <div
                  role="progressbar"
                  aria-valuenow={usage.membersCount}
                  aria-valuemin={0}
                  aria-valuemax={membersLimitNum}
                  aria-label="Utilização de membros"
                  style={{
                    height: '8px',
                    width: '100%',
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (usage.membersCount / membersLimitNum) * 100)}%`,
                      background: getProgressColor(usage.membersCount, quotas.members),
                      borderRadius: '999px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #A0AAB0)', lineHeight: 1.4 }}>
              {quotas.members === 'unlimited' ? (
                'Capacidade sem limites de integrantes.'
              ) : subscription.memberAddonBlocks > 0 ? (
                `Plano base: ${plan.baseMembers} · Adicionais: +${subscription.memberAddonBlocks * 10} · Total: ${quotas.members}`
              ) : usage.membersCount > (membersLimitNum ?? 0) ? (
                <span style={{ color: 'var(--louvaio-terracotta, #B85A3C)', fontWeight: 600 }}>
                  Limite excedido em {usage.membersCount - (membersLimitNum ?? 0)} membros.
                </span>
              ) : (
                `Capacidade total: ${quotas.members} membros.`
              )}
            </div>
          </div>

          {/* Músicas Card */}
          <div
            style={{
              background: 'var(--surface-variant, #23322D)',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid var(--border-color, #2D3A34)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary, #F5EFE6)' }}>
                <Music size={16} color="var(--louvaio-terracotta, #B85A3C)" />
                <span>Músicas</span>
              </span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary, #F5EFE6)' }}>
                {quotas.songs === 'unlimited' ? (
                  `${usage.songsCount} · Ilimitado`
                ) : (
                  `${usage.songsCount} de ${quotas.songs}`
                )}
              </span>
            </div>

            {songsLimitNum !== null && (
              <div style={{ marginBottom: '8px' }}>
                <div
                  role="progressbar"
                  aria-valuenow={usage.songsCount}
                  aria-valuemin={0}
                  aria-valuemax={songsLimitNum}
                  aria-label="Utilização de músicas"
                  style={{
                    height: '8px',
                    width: '100%',
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (usage.songsCount / songsLimitNum) * 100)}%`,
                      background: getProgressColor(usage.songsCount, quotas.songs),
                      borderRadius: '999px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #A0AAB0)', lineHeight: 1.4 }}>
              {quotas.songs === 'unlimited' ? (
                'Repertório sem limite de músicas cadastradas.'
              ) : usage.songsCount > (songsLimitNum ?? 0) ? (
                <span style={{ color: 'var(--louvaio-terracotta, #B85A3C)', fontWeight: 600 }}>
                  Limite excedido em {usage.songsCount - (songsLimitNum ?? 0)} músicas.
                </span>
              ) : (
                `Capacidade total: ${quotas.songs} músicas no repertório.`
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Seção de Planos com Toggle Mensal / Anual */}
      <section aria-labelledby="available-plans-heading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 id="available-plans-heading" style={{ margin: '0 0 6px 0', fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
              Planos disponíveis
            </h2>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary, #A0AAB0)' }}>
              Escolha a capacidade ideal para o seu ministério.
            </p>
          </div>

          {/* Toggle Mensal / Anual */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '999px',
              padding: '4px',
              border: '1px solid var(--border-color, #2D3A34)',
            }}
          >
            <button
              type="button"
              onClick={() => setInterval('monthly')}
              style={{
                padding: '8px 16px',
                borderRadius: '999px',
                border: 'none',
                background: interval === 'monthly' ? 'var(--louvaio-terracotta, #B85A3C)' : 'transparent',
                color: interval === 'monthly' ? '#FFFFFF' : 'var(--text-secondary, #A0AAB0)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Mensal
            </button>
            <button
              type="button"
              onClick={() => setInterval('annual')}
              style={{
                padding: '8px 16px',
                borderRadius: '999px',
                border: 'none',
                background: interval === 'annual' ? 'var(--louvaio-terracotta, #B85A3C)' : 'transparent',
                color: interval === 'annual' ? '#FFFFFF' : 'var(--text-secondary, #A0AAB0)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>Anual</span>
              <span
                style={{
                  background: '#10B981',
                  color: '#062B1D',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: '999px',
                }}
              >
                10% OFF
              </span>
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {plansData?.plans.map((p) => {
            const isCurrent = p.id === plan.id;
            const addonBlocks = selectedAddonBlocks[p.id] || 0;
            const priceMonthly = p.monthlyPriceCents;
            const priceAnnual = p.annualPriceCents;
            const displayedPriceCents = interval === 'annual' ? priceAnnual : priceMonthly;

            const addonUnitPriceCents =
              interval === 'annual' ? p.addonBlockAnnualPriceCents : p.addonBlockMonthlyPriceCents;
            const totalPriceCents = displayedPriceCents + addonBlocks * addonUnitPriceCents;

            return (
              <div
                key={p.id}
                style={{
                  background: isCurrent ? 'rgba(15, 42, 31, 0.45)' : 'var(--surface-color, #1A2421)',
                  borderRadius: '16px',
                  padding: '24px',
                  border: isCurrent
                    ? '2px solid var(--louvaio-terracotta, #B85A3C)'
                    : '1px solid var(--border-color, #2D3A34)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '20px',
                  position: 'relative',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
                      {p.name}
                    </h3>
                    {isCurrent && (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '4px 10px',
                          borderRadius: '999px',
                          background: 'var(--louvaio-terracotta, #B85A3C)',
                          color: '#FFFFFF',
                        }}
                      >
                        Seu plano
                      </span>
                    )}
                  </div>

                  {/* Preço */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-primary, #F5EFE6)' }}>
                        {formatCents(totalPriceCents)}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #A0AAB0)' }}>
                        {interval === 'annual' ? '/ano' : '/mês'}
                      </span>
                    </div>

                    {interval === 'annual' && p.monthlyPriceCents > 0 && (
                      <div style={{ fontSize: '0.78rem', color: '#10B981', fontWeight: 600, marginTop: '2px' }}>
                        Equivalente a {formatCents(Math.round(totalPriceCents / 12))}/mês (10% de economia)
                      </div>
                    )}
                  </div>

                  {/* Lista de Recursos */}
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: '0 0 16px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      fontSize: '0.88rem',
                      color: 'var(--text-secondary, #A0AAB0)',
                    }}
                  >
                    <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Users size={16} color="var(--primary-light, #10B981)" aria-hidden="true" />
                      <span>
                        {p.baseMembers === 'unlimited' ? (
                          <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>Membros ilimitados</strong>
                        ) : (
                          <>
                            Até{' '}
                            <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>
                              {typeof p.baseMembers === 'number' ? p.baseMembers + addonBlocks * 10 : p.baseMembers} membros
                            </strong>
                          </>
                        )}
                      </span>
                    </li>

                    <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Music size={16} color="var(--primary-light, #10B981)" aria-hidden="true" />
                      <span>
                        {p.baseSongs === 'unlimited' ? (
                          <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>Músicas ilimitadas</strong>
                        ) : (
                          <>
                            Até <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>{p.baseSongs} músicas</strong>
                          </>
                        )}
                      </span>
                    </li>
                  </ul>

                  {/* Seletor de Add-ons para Essential e Pro */}
                  {p.allowMemberAddons && p.maxMemberAddonBlocks > 0 && (
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '10px',
                        padding: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        marginBottom: '16px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary, #F5EFE6)' }}>
                          Adicionar integrantes (+10)
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#F59E0B', fontWeight: 700 }}>
                          +{addonBlocks * 10} membros
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="range"
                          min={0}
                          max={p.maxMemberAddonBlocks}
                          value={addonBlocks}
                          onChange={(e) =>
                            setSelectedAddonBlocks((prev) => ({
                              ...prev,
                              [p.id]: parseInt(e.target.value, 10),
                            }))
                          }
                          style={{ flex: 1, accentColor: 'var(--louvaio-terracotta, #B85A3C)' }}
                        />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary, #F5EFE6)', width: '20px', textAlign: 'right' }}>
                          {addonBlocks}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #7D8881)', marginTop: '6px' }}>
                        {formatCents(addonUnitPriceCents)} por bloco de 10 ({interval === 'annual' ? 'ano' : 'mês'})
                      </div>
                    </div>
                  )}
                </div>

                {/* Botão de Ação */}
                <div>
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color, #2D3A34)',
                        color: 'var(--text-muted, #7D8881)',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        cursor: 'default',
                      }}
                    >
                      Plano atual
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleOpenCheckoutPreview(p)}
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                    >
                      <span>{p.id === 'free' ? 'Mudar para Free' : 'Assinar Plano'}</span>
                      <ChevronRight size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Modal de Preview de Checkout */}
      {previewPlan && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-preview-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'var(--surface-color, #1A2421)',
              borderRadius: '20px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              border: '1px solid var(--border-color, #2D3A34)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CreditCard size={22} color="var(--louvaio-terracotta, #B85A3C)" />
                <h3 id="checkout-preview-title" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
                  Confirmar Assinatura
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreviewPlan(null);
                  setPreviewData(null);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary, #A0AAB0)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {previewLoading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <RefreshCw size={30} className="animate-spin" style={{ margin: '0 auto 12px auto', color: 'var(--louvaio-terracotta, #B85A3C)' }} />
                <p style={{ color: 'var(--text-secondary, #A0AAB0)', margin: 0 }}>Calculando valores oficiais...</p>
              </div>
            ) : previewData ? (
              <div>
                {/* Resumo da compra */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    marginBottom: '20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.95rem' }}>
                    <span style={{ color: 'var(--text-secondary, #A0AAB0)' }}>Plano:</span>
                    <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>{previewData.planName}</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.95rem' }}>
                    <span style={{ color: 'var(--text-secondary, #A0AAB0)' }}>Ciclo de faturamento:</span>
                    <span style={{ color: 'var(--text-primary, #F5EFE6)', fontWeight: 600 }}>
                      {previewData.interval === 'annual' ? 'Anual (10% de desconto)' : 'Mensal'}
                    </span>
                  </div>

                  {previewData.addonBlocks > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.95rem' }}>
                      <span style={{ color: 'var(--text-secondary, #A0AAB0)' }}>Integrantes adicionais:</span>
                      <span style={{ color: 'var(--text-primary, #F5EFE6)' }}>
                        +{previewData.addonBlocks * 10} ({formatCents(previewData.addonsPriceCents)})
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.95rem' }}>
                    <span style={{ color: 'var(--text-secondary, #A0AAB0)' }}>Capacidade de membros:</span>
                    <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>
                      {previewData.effectiveMembersQuota === 'unlimited' ? 'Ilimitado' : `${previewData.effectiveMembersQuota} membros`}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '0.95rem' }}>
                    <span style={{ color: 'var(--text-secondary, #A0AAB0)' }}>Capacidade de músicas:</span>
                    <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>
                      {previewData.effectiveSongsQuota === 'unlimited' ? 'Ilimitado' : `${previewData.effectiveSongsQuota} músicas`}
                    </strong>
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                      paddingTop: '12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: 'var(--text-primary, #F5EFE6)' }}>Total:</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--louvaio-terracotta, #B85A3C)' }}>
                        {formatCents(previewData.totalPriceCents)}
                      </div>
                      {previewData.annualSavingsCents > 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#10B981', fontWeight: 600 }}>
                          Economia de {formatCents(previewData.annualSavingsCents)} no ano
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Aviso de Downgrade se aplicável */}
                {previewData.isDowngrade && previewData.downgradeImpact?.isOverLimit && (
                  <div
                    style={{
                      background: 'rgba(217, 119, 6, 0.15)',
                      border: '1px solid #D97706',
                      borderRadius: '10px',
                      padding: '12px',
                      marginBottom: '20px',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary, #F5EFE6)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#F59E0B', marginBottom: '4px' }}>
                      <AlertTriangle size={16} />
                      <span>Aviso de capacidade</span>
                    </div>
                    Seu uso atual excede os limites do novo plano. Seus dados <strong>não serão apagados</strong>, mas o ministério entrará no período de adaptação de 7 dias.
                  </div>
                )}

                {/* Botões de Ação */}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewPlan(null);
                      setPreviewData(null);
                    }}
                    style={{
                      flex: 1,
                      padding: '12px',
                      borderRadius: '10px',
                      background: 'transparent',
                      border: '1px solid var(--border-color, #2D3A34)',
                      color: 'var(--text-secondary, #A0AAB0)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Voltar
                  </button>

                  <button
                    type="button"
                    onClick={handleStartCheckout}
                    disabled={checkoutLoading}
                    className="btn btn-primary"
                    style={{
                      flex: 2,
                      padding: '12px',
                      borderRadius: '10px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    {checkoutLoading ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Gerando Checkout...</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        <span>{previewPlan.id === 'free' ? 'Confirmar Mudança' : 'Ir para Pagamento'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Modal de Histórico de Faturas */}
      {showHistoryModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'var(--surface-color, #1A2421)',
              borderRadius: '20px',
              maxWidth: '600px',
              width: '100%',
              padding: '24px',
              border: '1px solid var(--border-color, #2D3A34)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Receipt size={22} color="var(--louvaio-terracotta, #B85A3C)" />
                <h3 id="history-modal-title" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
                  Histórico de Faturas
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary, #A0AAB0)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 10px auto', color: 'var(--louvaio-terracotta, #B85A3C)' }} />
                  <p style={{ color: 'var(--text-secondary, #A0AAB0)', margin: 0 }}>Carregando faturas...</p>
                </div>
              ) : historyTransactions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary, #A0AAB0)' }}>
                  <Receipt size={36} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
                  <p style={{ margin: 0 }}>Nenhuma fatura registrada até o momento.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {historyTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '12px',
                        padding: '14px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary, #F5EFE6)', fontSize: '0.95rem' }}>
                          {formatCents(tx.amount_cents)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #A0AAB0)', marginTop: '2px' }}>
                          Vencimento: {tx.due_date || 'N/A'} {tx.paid_at ? `· Pago em ${new Date(tx.paid_at).toLocaleDateString('pt-BR')}` : ''}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: tx.status === 'paid' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(217, 119, 6, 0.15)',
                            color: tx.status === 'paid' ? '#10B981' : '#F59E0B',
                          }}
                        >
                          {tx.status === 'paid' ? 'Pago' : tx.status === 'overdue' ? 'Vencido' : tx.status}
                        </span>

                        {tx.invoice_url && (
                          <a
                            href={tx.invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--louvaio-terracotta, #B85A3C)',
                              textDecoration: 'none',
                              fontWeight: 600,
                            }}
                          >
                            Ver fatura
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
