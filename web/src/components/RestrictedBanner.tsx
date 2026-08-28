import React from 'react';
import { MinistrySubscriptionSummary } from '../types';
import { AlertTriangle, Clock, ShieldAlert, ArrowRight } from 'lucide-react';

interface Props {
  summary: MinistrySubscriptionSummary | null;
  onNavigateToPlans?: () => void;
}

export const RestrictedBanner: React.FC<Props> = ({ summary, onNavigateToPlans }) => {
  if (!summary) return null;

  const { accessMode, administrativelySuspended, suspensionReason } = summary.subscription;

  // Em modo normal, não renderiza banner
  if (accessMode === 'normal' && !administrativelySuspended) {
    return null;
  }

  // 1. Suspensão Administrativa
  if (accessMode === 'suspended' || administrativelySuspended) {
    return (
      <aside
        role="alert"
        aria-live="polite"
        className="restricted-banner suspended animate-fade-in"
        style={{
          background: 'rgba(184, 90, 60, 0.12)',
          border: '1px solid var(--louvaio-terracotta, #B85A3C)',
          borderRadius: '12px',
          padding: '14px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div
            style={{
              padding: '6px',
              borderRadius: '8px',
              background: 'var(--louvaio-terracotta, #B85A3C)',
              color: '#FFFFFF',
              display: 'flex',
              flexShrink: 0,
            }}
          >
            <ShieldAlert size={18} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4
              style={{
                margin: 0,
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--text-primary, #F5EFE6)',
              }}
            >
              Ministério suspenso
            </h4>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-secondary, #A0AAB0)',
                lineHeight: 1.4,
              }}
            >
              Este ministério está temporariamente suspenso pela plataforma. As operações estão
              indisponíveis no momento.
              {suspensionReason ? ` Motivo: ${suspensionReason}` : ''}
            </p>
          </div>
        </div>

        {onNavigateToPlans && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onNavigateToPlans}
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'transparent',
                border: '1px solid var(--louvaio-terracotta, #B85A3C)',
                color: 'var(--louvaio-terracotta, #B85A3C)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>Ver detalhes da assinatura</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
    );
  }

  // 2. Período de Graça (Grace)
  if (accessMode === 'grace') {
    const days = summary.graceDaysRemaining ?? 0;
    return (
      <aside
        role="alert"
        aria-live="polite"
        className="restricted-banner grace animate-fade-in"
        style={{
          background: 'rgba(217, 119, 6, 0.12)',
          border: '1px solid #D97706',
          borderRadius: '12px',
          padding: '14px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div
            style={{
              padding: '6px',
              borderRadius: '8px',
              background: '#D97706',
              color: '#FFFFFF',
              display: 'flex',
              flexShrink: 0,
            }}
          >
            <Clock size={18} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4
              style={{
                margin: 0,
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--text-primary, #F5EFE6)',
              }}
            >
              Período de adaptação ativo
            </h4>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-secondary, #A0AAB0)',
                lineHeight: 1.4,
              }}
            >
              Seu ministério está acima dos limites do plano atual. Você tem{' '}
              <strong>
                {days} {days === 1 ? 'dia restante' : 'dias restantes'}
              </strong>{' '}
              para ajustar sua utilização antes que novas operações sejam restringidas.
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginTop: '8px',
              }}
            >
              {summary.overLimitDetails.membersOver && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(217, 119, 6, 0.2)',
                    color: '#F59E0B',
                    fontWeight: 600,
                  }}
                >
                  Membros: {summary.usage.membersCount} / {summary.quotas.members}
                </span>
              )}
              {summary.overLimitDetails.songsOver && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(217, 119, 6, 0.2)',
                    color: '#F59E0B',
                    fontWeight: 600,
                  }}
                >
                  Músicas: {summary.usage.songsCount} / {summary.quotas.songs}
                </span>
              )}
            </div>
          </div>
        </div>

        {onNavigateToPlans && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onNavigateToPlans}
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: '#D97706',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>Ver plano e utilização</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
    );
  }

  // 3. Modo Restrito por Excesso de Uso (Restricted Over Limit)
  if (accessMode === 'restricted_over_limit') {
    return (
      <aside
        role="alert"
        aria-live="polite"
        className="restricted-banner over-limit animate-fade-in"
        style={{
          background: 'rgba(184, 90, 60, 0.12)',
          border: '1px solid var(--louvaio-terracotta, #B85A3C)',
          borderRadius: '12px',
          padding: '14px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div
            style={{
              padding: '6px',
              borderRadius: '8px',
              background: 'var(--louvaio-terracotta, #B85A3C)',
              color: '#FFFFFF',
              display: 'flex',
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={18} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4
              style={{
                margin: 0,
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--text-primary, #F5EFE6)',
              }}
            >
              Uso acima do limite do plano
            </h4>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-secondary, #A0AAB0)',
                lineHeight: 1.4,
              }}
            >
              Seu ministério está acima dos limites do plano atual. Seus dados continuam disponíveis
              para consulta. Para retomar as operações do ministério, reduza a utilização até os
              limites do plano ou altere o plano quando essa opção estiver disponível.
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginTop: '8px',
              }}
            >
              {summary.overLimitDetails.membersOver && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(184, 90, 60, 0.2)',
                    color: 'var(--louvaio-terracotta, #B85A3C)',
                    fontWeight: 600,
                  }}
                >
                  Membros: {summary.usage.membersCount} / {summary.quotas.members}
                </span>
              )}
              {summary.overLimitDetails.songsOver && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(184, 90, 60, 0.2)',
                    color: 'var(--louvaio-terracotta, #B85A3C)',
                    fontWeight: 600,
                  }}
                >
                  Músicas: {summary.usage.songsCount} / {summary.quotas.songs}
                </span>
              )}
            </div>
          </div>
        </div>

        {onNavigateToPlans && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onNavigateToPlans}
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'var(--louvaio-terracotta, #B85A3C)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>Ver detalhes</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
    );
  }

  return null;
};
