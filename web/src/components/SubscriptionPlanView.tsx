import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  MinistrySubscriptionSummary,
  PlansResponse,
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
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface Props {
  ministryId: string;
  onBack: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export const SubscriptionPlanView: React.FC<Props> = ({ ministryId, onBack }) => {
  const [summary, setSummary] = useState<MinistrySubscriptionSummary | null>(null);
  const [plansData, setPlansData] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
  const getStatusBadge = (accessMode?: string, suspended?: boolean) => {
    if (suspended || accessMode === 'suspended') {
      return {
        label: 'Ministério suspenso',
        icon: ShieldAlert,
        bg: 'rgba(184, 90, 60, 0.18)',
        color: 'var(--louvaio-terracotta, #B85A3C)',
        border: '1px solid var(--louvaio-terracotta, #B85A3C)',
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
  const statusBadge = getStatusBadge(subscription.accessMode, subscription.administrativelySuspended);
  const StatusIcon = statusBadge.icon;

  // Usage percentage helpers
  const membersLimitNum = typeof quotas.members === 'number' ? quotas.members : null;
  const songsLimitNum = typeof quotas.songs === 'number' ? quotas.songs : null;

  const getProgressColor = (current: number, limit: number | 'unlimited') => {
    if (limit === 'unlimited') return '#10B981';
    if (current > limit) return 'var(--louvaio-terracotta, #B85A3C)';
    if (current >= limit * 0.8) return '#F59E0B';
    return '#10B981';
  };

  return (
    <div className="subscription-view-container animate-fade-in" style={{ padding: '16px 0 40px 0', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header com link de retorno */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
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

      {/* Título Principal */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px 0', fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
          Plano e assinatura
        </h1>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary, #A0AAB0)' }}>
          Acompanhe o consumo de recursos e conheça os planos disponíveis para o seu ministério.
        </p>
      </div>

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

            {/* Detalhes de Add-on ou status */}
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

      {/* Comparativo de Planos Disponíveis */}
      <section aria-labelledby="available-plans-heading">
        <div style={{ marginBottom: '16px' }}>
          <h2 id="available-plans-heading" style={{ margin: '0 0 6px 0', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary, #F5EFE6)' }}>
            Planos disponíveis
          </h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary, #A0AAB0)' }}>
            Conheça as capacidades de cada plano LouvAIO.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '16px',
          }}
        >
          {plansData?.plans.map((p) => {
            const isCurrent = p.id === plan.id;
            return (
              <div
                key={p.id}
                style={{
                  background: isCurrent ? 'rgba(15, 42, 31, 0.4)' : 'var(--surface-color, #1A2421)',
                  borderRadius: '16px',
                  padding: '20px',
                  border: isCurrent
                    ? '2px solid var(--louvaio-terracotta, #B85A3C)'
                    : '1px solid var(--border-color, #2D3A34)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  position: 'relative',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary, #F5EFE6)' }}>
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

                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
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
                            Até <strong style={{ color: 'var(--text-primary, #F5EFE6)' }}>{p.baseMembers} membros</strong>
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

                    {p.allowMemberAddons && (
                      <li style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.82rem', color: '#F59E0B' }}>
                        <Sparkles size={16} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                        <span>
                          Add-ons de +10 membros disponíveis (até {p.maxMemberAddonBlocks} blocos adicionais)
                        </span>
                      </li>
                    )}
                  </ul>
                </div>

                <div
                  style={{
                    paddingTop: '12px',
                    borderTop: '1px solid var(--border-color, #2D3A34)',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    color: 'var(--text-muted, #7D8881)',
                  }}
                >
                  {isCurrent ? 'Plano ativo no momento' : 'Contratação em breve'}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
