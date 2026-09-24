import {
  AlertTriangle,
  AlertCircle,
  Clock,
  CreditCard,
  Lock,
  ShieldAlert,
  LifeBuoy,
  Info,
} from 'lucide-react';
import type { OrganizationWhatsAppCapacity } from '../../whatsapp.types';
import { formatDatePtBR } from '../../utils/locale';
import { formatRestrictionReason } from '../../whatsapp-errors';

export interface WhatsAppCommercialStatusBannerProps {
  capacity: OrganizationWhatsAppCapacity;
  isAdmin: boolean;
  onNavigateToBilling?: () => void;
}

export function WhatsAppCommercialStatusBanner({
  capacity,
  isAdmin,
  onNavigateToBilling,
}: WhatsAppCommercialStatusBannerProps) {
  const handleNavigateToBilling = () => {
    if (onNavigateToBilling) {
      onNavigateToBilling();
    } else {
      window.location.assign('/ministerio/plano');
    }
  };

  const handleContactSupport = () => {
    window.location.href = 'mailto:contato@louvaio.com.br?subject=Suporte%20WhatsApp%20LouvAIO';
  };

  const {
    commercialState,
    canSendMessages,
    canCreateConnection,
    canResumeAuthorizedOnboarding,
    gracePeriodExpiresBillingDate,
    configuredConnectionsCount,
    totalAllowedConnections,
    restrictionReason,
  } = capacity;

  // 1. HEALTHY STATE
  if (commercialState === 'healthy') {
    // Healthy at capacity notice
    if (!canCreateConnection && configuredConnectionsCount >= totalAllowedConnections) {
      return (
        <div
          className="commercial-status-banner commercial-healthy-at-capacity"
          role="status"
          data-testid="commercial-banner-healthy-at-capacity"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '14px 16px',
            borderRadius: '10px',
            marginBottom: '20px',
            background: 'var(--surface-variant, #0f172a)',
            border: '1px solid var(--border-color)',
            fontSize: '0.9rem',
          }}
        >
          <Info size={20} style={{ color: 'var(--primary-color)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '2px' }}>
              Limite de Conexões Atingido
            </strong>
            <span style={{ color: 'var(--text-secondary)' }}>
              Todas as {totalAllowedConnections} conexão(ões) do plano estão configuradas. O envio de notificações automáticas permanece ativo.
            </span>
          </div>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-secondary min-h-[44px]"
              data-testid="commercial-billing-cta"
              onClick={handleNavigateToBilling}
              style={{
                minHeight: '44px',
                padding: '6px 14px',
                fontSize: '0.84rem',
                flexShrink: 0,
              }}
            >
              Adicionar conexões
            </button>
          )}
        </div>
      );
    }
    return null;
  }

  // 2. PAYMENT GRACE
  if (commercialState === 'payment_grace') {
    const formattedDeadline = gracePeriodExpiresBillingDate
      ? formatDatePtBR(gracePeriodExpiresBillingDate)
      : null;

    return (
      <div
        className="commercial-status-banner commercial-payment-grace"
        role="alert"
        data-testid="commercial-banner-payment-grace"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: 'rgba(245, 158, 11, 0.09)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <Clock size={22} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
              }}
            >
              Período de Carência por Pagamento Pendente
            </h4>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Identificamos uma pendência no faturamento da sua assinatura.
              {formattedDeadline && (
                <>
                  {' '}O envio de notificações continuará ativo até{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>{formattedDeadline}</strong>. Após esta data, o envio será interrompido caso o pagamento não seja regularizado.
                </>
              )}
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '0.82rem',
                marginBottom: '8px',
              }}
            >
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: canSendMessages ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: canSendMessages ? 'var(--success-color, #10b981)' : 'var(--error-color, #ef4444)',
                  fontWeight: 600,
                }}
              >
                Envio de mensagens: {canSendMessages ? 'Ativo' : 'Pausado'}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#f59e0b',
                  fontWeight: 600,
                }}
              >
                Novas conexões: Desabilitadas
              </span>
              {canResumeAuthorizedOnboarding && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: '#60a5fa',
                    fontWeight: 600,
                  }}
                >
                  Conexões em andamento: Retomáveis
                </span>
              )}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="commercial-billing-cta"
              onClick={handleNavigateToBilling}
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                fontSize: '0.88rem',
                fontWeight: 600,
              }}
            >
              <CreditCard size={16} />
              <span>Regularizar Assinatura</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // 3. POST PAYMENT GRACE
  if (commercialState === 'post_payment_grace') {
    return (
      <div
        className="commercial-status-banner commercial-post-payment-grace"
        role="alert"
        data-testid="commercial-banner-post-payment-grace"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: 'rgba(239, 68, 68, 0.09)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <AlertCircle size={22} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
              }}
            >
              Assinatura Suspensa por Inadimplência
            </h4>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              O período de carência expirou sem a regularização do pagamento. O envio de notificações automáticas via WhatsApp está <strong>pausado</strong>. Suas conexões e configurações anteriores foram preservadas com segurança.
            </p>
            <div style={{ display: 'flex', gap: '8px', fontSize: '0.82rem' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--error-color, #ef4444)',
                  fontWeight: 600,
                }}
              >
                Envio de mensagens: Pausado
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--error-color, #ef4444)',
                  fontWeight: 600,
                }}
              >
                Conexões: Bloqueadas
              </span>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="commercial-billing-cta"
              onClick={handleNavigateToBilling}
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                fontSize: '0.88rem',
                fontWeight: 600,
              }}
            >
              <CreditCard size={16} />
              <span>Reativar Assinatura</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // 4. PLAN EXCLUDED
  if (commercialState === 'plan_excluded') {
    return (
      <div
        className="commercial-status-banner commercial-plan-excluded"
        role="alert"
        data-testid="commercial-banner-plan-excluded"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: 'var(--surface-variant, #0f172a)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <Lock size={22} style={{ color: 'var(--primary-color)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
              }}
            >
              Recurso Não Incluso no Plano Atual
            </h4>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              A integração oficial com WhatsApp não está disponível para o plano atual da sua organização. Realize o upgrade de plano para habilitar conexões de WhatsApp e envio automático de escalas.
            </p>
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="commercial-billing-cta"
              onClick={handleNavigateToBilling}
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                fontSize: '0.88rem',
                fontWeight: 600,
              }}
            >
              <CreditCard size={16} />
              <span>Ver Planos de Assinatura</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // 5. ADMINISTRATIVELY SUSPENDED
  if (commercialState === 'administratively_suspended') {
    return (
      <div
        className="commercial-status-banner commercial-admin-suspended"
        role="alert"
        data-testid="commercial-banner-administratively-suspended"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: 'rgba(100, 116, 139, 0.1)',
          border: '1px solid #64748b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <ShieldAlert size={22} style={{ color: '#94a3b8', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
              }}
            >
              Acesso Suspenso Administrativamente
            </h4>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              O acesso aos recursos do WhatsApp para esta organização foi suspenso pela administração da plataforma. Para entender a razão desta suspensão e solicitar análise, contate nossa equipe de suporte.
            </p>
            {restrictionReason && (
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '0.8rem',
                  color: '#94a3b8',
                  background: 'rgba(100, 116, 139, 0.15)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                }}
              >
                Motivo: {formatRestrictionReason(restrictionReason)}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary min-h-[44px]"
            data-testid="commercial-support-cta"
            onClick={handleContactSupport}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 18px',
              fontSize: '0.88rem',
            }}
          >
            <LifeBuoy size={16} />
            <span>Falar com o Suporte</span>
          </button>
        </div>
      </div>
    );
  }

  // 6. RESTRICTED OVER LIMIT
  if (commercialState === 'restricted_over_limit') {
    return (
      <div
        className="commercial-status-banner commercial-over-limit"
        role="alert"
        data-testid="commercial-banner-restricted-over-limit"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: 'rgba(249, 115, 22, 0.09)',
          border: '1px solid rgba(249, 115, 22, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <AlertTriangle size={22} style={{ color: '#f97316', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
              }}
            >
              Limite de Conexões Excedido
            </h4>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              A organização possui <strong>{configuredConnectionsCount}</strong> conexão(ões) configurada(s), excedendo a cota contratada de <strong>{totalAllowedConnections}</strong>. Suas conexões existentes continuam salvas, mas novas configurações e envios podem estar bloqueados.
            </p>
            <div style={{ display: 'flex', gap: '8px', fontSize: '0.82rem' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: canSendMessages ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: canSendMessages ? 'var(--success-color, #10b981)' : 'var(--error-color, #ef4444)',
                  fontWeight: 600,
                }}
              >
                Envio de mensagens: {canSendMessages ? 'Ativo' : 'Pausado'}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(249, 115, 22, 0.15)',
                  color: '#f97316',
                  fontWeight: 600,
                }}
              >
                Novas conexões: Bloqueadas
              </span>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="commercial-billing-cta"
              onClick={handleNavigateToBilling}
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                fontSize: '0.88rem',
                fontWeight: 600,
              }}
            >
              <CreditCard size={16} />
              <span>Gerenciar Plano e Adicionais</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // 7. INTEGRITY FAILURE
  if (commercialState === 'integrity_failure') {
    return (
      <div
        className="commercial-status-banner commercial-integrity-failure"
        role="alert"
        data-testid="commercial-banner-integrity-failure"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          background: 'rgba(148, 163, 184, 0.08)',
          border: '1px solid #64748b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <AlertCircle size={22} style={{ color: '#94a3b8', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
              }}
            >
              Verificação de Direitos Indisponível
            </h4>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Não foi possível validar as permissões de uso do WhatsApp para esta organização no momento devido a uma inconsistência temporária. Por precaução, novas operações estão pausadas.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary min-h-[44px]"
            data-testid="commercial-support-cta"
            onClick={handleContactSupport}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 18px',
              fontSize: '0.88rem',
            }}
          >
            <LifeBuoy size={16} />
            <span>Contatar Suporte</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
