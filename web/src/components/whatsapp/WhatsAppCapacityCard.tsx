import { CheckCircle2, AlertCircle, Layers } from 'lucide-react';
import type { OrganizationWhatsAppCapacity } from '../../whatsapp.types';

export interface WhatsAppCapacityCardProps {
  capacity: OrganizationWhatsAppCapacity;
}

export function WhatsAppCapacityCard({ capacity }: WhatsAppCapacityCardProps) {
  const configured = capacity?.configuredConnectionsCount ?? 0;
  const total = capacity?.totalAllowedConnections ?? 0;
  const remaining = capacity?.remainingCapacity ?? Math.max(0, total - configured);
  const included = capacity?.includedConnections ?? total;
  const additional = capacity?.additionalConnections ?? 0;
  const canSend = Boolean(capacity?.canSendMessages);

  const percentage = total > 0 ? Math.min(100, Math.round((configured / total) * 100)) : 0;
  const isOverLimit = configured > total;
  const isAtLimit = configured === total && total > 0;

  let usageStatusLabel = `${remaining} disponível(is)`;
  if (isOverLimit) {
    usageStatusLabel = 'Limite excedido';
  } else if (isAtLimit) {
    usageStatusLabel = 'Limite atingido';
  } else if (total === 0) {
    usageStatusLabel = 'Sem conexões inclusas';
  }

  return (
    <div
      className="card whatsapp-capacity-card"
      data-testid="whatsapp-capacity-card"
      role="region"
      aria-label="Capacidade de conexões do WhatsApp"
      style={{
        padding: '18px 20px',
        borderRadius: '12px',
        background: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        marginBottom: '20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={18} style={{ color: 'var(--primary-color)' }} />
          <h4
            style={{
              margin: 0,
              fontSize: '0.96rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            Capacidade de Linhas
          </h4>
        </div>

        <span
          data-testid="capacity-remaining-badge"
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: '12px',
            background: isOverLimit
              ? 'rgba(239, 68, 68, 0.15)'
              : isAtLimit
              ? 'rgba(245, 158, 11, 0.15)'
              : 'rgba(16, 185, 129, 0.15)',
            color: isOverLimit
              ? 'var(--error-color, #ef4444)'
              : isAtLimit
              ? '#f59e0b'
              : 'var(--success-color, #10b981)',
          }}
        >
          {usageStatusLabel}
        </span>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '6px',
            fontSize: '0.9rem',
          }}
        >
          <span
            data-testid="capacity-usage-text"
            style={{ color: 'var(--text-primary)', fontWeight: 600 }}
          >
            {configured} de {total} {total === 1 ? 'conexão utilizada' : 'conexões utilizadas'}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            {percentage}%
          </span>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            height: '6px',
            width: '100%',
            background: 'var(--surface-variant, #1e293b)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, percentage)}%`,
              background: isOverLimit
                ? 'var(--error-color, #ef4444)'
                : isAtLimit
                ? '#f59e0b'
                : 'var(--primary-color)',
              borderRadius: '3px',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Composition & Message Status Footer */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          paddingTop: '10px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '0.82rem',
        }}
      >
        <div style={{ color: 'var(--text-secondary)' }}>
          {additional > 0 ? (
            <span>
              {included} inclusa(s) + {additional} adicional(is)
            </span>
          ) : (
            <span>{total} inclusa(s) na assinatura</span>
          )}
        </div>

        <div
          data-testid="capacity-send-status"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: canSend ? 'var(--success-color, #10b981)' : 'var(--error-color, #ef4444)',
            fontWeight: 500,
          }}
        >
          {canSend ? (
            <>
              <CheckCircle2 size={14} />
              <span>Envio de notificações: Ativo</span>
            </>
          ) : (
            <>
              <AlertCircle size={14} />
              <span>Envio de notificações: Pausado</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
